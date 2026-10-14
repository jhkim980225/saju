/**
 * 네이티브 초기화 본체 — index.ts 의 initNative() 가 앱(Capacitor)에서만 동적 import 한다.
 * 이 파일이 정적으로 import 하는 플러그인들은 별도 청크로 분리되어 웹 번들 초기 로드에 포함되지 않는다.
 */
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Keyboard, KeyboardStyle } from '@capacitor/keyboard';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { nativePlatform, registerNative } from '../lib/platform';
import { reloadSessionFromStorage } from '../lib/session';
import { STORAGE_KEYS, setStorageAdapter, storage } from '../lib/storage';
import { type ThemeMode, useTheme } from '../lib/theme';
import { hasAbsoluteApiBase } from './env';
import { handleBackButton, navigateTo, resolveDeepLink } from './navigation';
import { initPush, requestPushToken } from './push';
import { createPreferencesAdapter } from './storage';

const noop = () => undefined;

/** Preferences → 메모리 hydrate → lib/storage 어댑터 교체 → 모듈 로드 시점에 읽어 둔 상태(세션·테마) 다시 읽기 */
export async function hydrateStorage(): Promise<void> {
  let legacy: Storage | null = null;
  try {
    legacy = window.localStorage;
  } catch {
    legacy = null;
  }
  const adapter = await createPreferencesAdapter({ migrateFrom: legacy });
  setStorageAdapter(adapter);
  reloadSessionFromStorage();
  // theme.ts 의 useTheme 초기값은 import 시점(localStorage)에 읽혔으므로 다시 맞춘다 — 이후 initTheme() 가 적용
  useTheme.setState({
    mode: (storage.get(STORAGE_KEYS.theme) as ThemeMode | null) ?? 'system',
    fontScale: Number(storage.get(STORAGE_KEYS.fontScale) ?? 1) || 1,
  });
}

let lastLink: { url: string; at: number } | null = null;

/** 딥링크/알림 링크 열기 — 같은 URL 이 짧은 간격으로 두 번 오면(getLaunchUrl + appUrlOpen) 한 번만 처리 */
export function openDeepLink(url: string): boolean {
  const now = Date.now();
  if (lastLink && lastLink.url === url && now - lastLink.at < 2000) return false;
  lastLink = { url, at: now };
  const path = resolveDeepLink(url);
  if (!path) return false;
  // 소셜 로그인·외부 결제 후 돌아온 경우 인앱 브라우저(SFSafariViewController)를 닫는다 (Android 는 미지원 → 무시)
  if (path.startsWith('/auth/callback/') || path.startsWith('/payments/')) void Browser.close().catch(noop);
  navigateTo(path);
  return true;
}

function isCancel(e: unknown): boolean {
  return /cancel/i.test(String((e as { message?: unknown } | null)?.message ?? e));
}

function registerBridge() {
  const ios = nativePlatform() === 'ios';
  registerNative({
    haptic(kind) {
      const p = kind === 'success' ? Haptics.notification({ type: NotificationType.Success }) : Haptics.impact({ style: ImpactStyle.Light });
      void p.catch(noop);
    },
    async share({ title, text, url }) {
      try {
        const { value } = await Share.canShare();
        if (!value) return false;
        await Share.share({ title, text, url, dialogTitle: title });
        return true;
      } catch (e) {
        // 사용자가 공유 시트를 닫은 것도 '처리됨' — false 를 주면 lib/share 가 웹 공유/클립보드로 다시 시도한다
        return isCancel(e);
      }
    },
    setStatusBar(theme) {
      // Style.Light = 밝은 배경 위 어두운 글자. (Android 15+ edge-to-edge 에서는 배경색 지정 불가 → 웹뷰 배경이 비친다)
      void StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light }).catch(noop);
      if (ios) void Keyboard.setStyle({ style: theme === 'dark' ? KeyboardStyle.Dark : KeyboardStyle.Light }).catch(noop);
    },
    async openExternal(url) {
      // iOS SFSafariViewController / Android Custom Tabs — 소셜 로그인·약관·외부 링크용 (결제 유도 링크 금지)
      await Browser.open({ url });
    },
    requestPush: requestPushToken,
    async purchase(storeProductId) {
      const { purchaseConsumable } = await import('./purchases');
      return purchaseConsumable(storeProductId);
    },
  });
}

async function registerAppListeners() {
  await App.addListener('backButton', (ev) => {
    handleBackButton(ev, () => void App.minimizeApp().catch(noop));
  });
  await App.addListener('appUrlOpen', ({ url }) => {
    openDeepLink(url);
  });
  // 콜드 스타트로 열린 링크 (appUrlOpen 이 이미 전달됐다면 openDeepLink 가 중복을 걸러 낸다)
  const launch = await App.getLaunchUrl().catch(() => undefined);
  if (launch?.url) openDeepLink(launch.url);
}

function scheduleSplashHide() {
  // main.tsx 는 initNative() 직후 React 를 렌더한다 — 첫 화면이 그려질 여유를 두고 숨긴다
  const hide = () => void SplashScreen.hide({ fadeOutDuration: 200 }).catch(noop);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(hide, 120));
  else setTimeout(hide, 120);
}

export async function bootstrapNative(): Promise<void> {
  try {
    // 번들 실행(capacitor://localhost, https://localhost)에서는 상대 경로 API 가 동작하지 않는다. 라이브 리로드(http://IP:5173)는 Vite 프록시로 동작
    const bundled = window.location.hostname === 'localhost' && !window.location.port;
    if (bundled && !hasAbsoluteApiBase()) console.error('[native] VITE_API_BASE_URL 이 절대 주소가 아니에요. 앱에서는 API 호출이 실패합니다 (docs/APP_PORTING.md §2).');
    try {
      await hydrateStorage();
    } catch (e) {
      console.error('[native] Preferences 를 읽지 못해 localStorage 로 계속합니다', e);
    }
    registerBridge();
    await registerAppListeners();
    await initPush((link) => void openDeepLink(link)).catch((e: unknown) => console.warn('[native] 푸시 초기화 실패(Firebase 설정 확인)', e));
    void import('./purchases').then((m) => m.configurePurchases()).catch(noop);
  } finally {
    scheduleSplashHide();
  }
}
