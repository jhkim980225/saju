/**
 * 앱 내비게이션 보조 — 하드웨어 뒤로가기와 딥링크.
 * react-router 를 직접 import 하지 않고 history.pushState + popstate 로 라우터에 알린다.
 * (플러그인 import 없음 — 순수 DOM 코드라 테스트·웹 번들에 안전)
 */
import { deepLinkHosts, deepLinkSchemes } from './env';

/** 하단 탭의 첫 화면 — 여기서 뒤로가기를 누르면 앱을 백그라운드로 보낸다 */
export const HOME_PATHS = ['/', '/today'];

/**
 * 딥링크로 열 수 있는 경로. '/' 로 끝나면 접두사, 아니면 정확히 일치(하위 경로 포함).
 * 목록에 없는 경로는 무시한다(외부 앱이 임의 경로를 열지 못하게).
 */
const ALLOWED_PATHS = [
  '/auth/callback/',
  '/payments/',
  '/today',
  '/saju',
  '/yearly/',
  '/compatibility',
  '/ask',
  '/my',
  '/reports/',
  '/store',
  '/manse',
  '/result',
  '/input',
  '/login',
  '/signup',
  '/legal/',
];

/** 서버 푸시 문서 예시 등 옛 경로 → 실제 라우트 */
const PATH_ALIASES: Record<string, string> = {
  '/fortune/today': '/today',
  '/fortune': '/today',
};

function isAllowedPath(pathname: string): boolean {
  return ALLOWED_PATHS.some((p) => (p.endsWith('/') ? pathname.startsWith(p) && pathname.length > p.length : pathname === p || pathname.startsWith(`${p}/`)));
}

/**
 * 딥링크 URL → 앱 내부 경로(pathname+search+hash). 처리할 수 없으면 null.
 *  - https://{웹 도메인}/today            (유니버설 링크 / App Links)
 *  - kr.dalbitsaju.app://auth/callback/kakao?code=… (커스텀 스킴: host 가 첫 경로 조각)
 *  - /reports/abc                          (푸시 data.link 같은 상대 경로)
 */
export function resolveDeepLink(raw: string): string | null {
  const input = raw?.trim();
  if (!input) return null;
  let url: URL;
  try {
    url = new URL(input, 'https://app.invalid');
  } catch {
    return null;
  }
  const protocol = url.protocol.replace(/:$/, '').toLowerCase();
  let pathname: string;
  if (protocol === 'http' || protocol === 'https' || protocol === 'capacitor') {
    const host = url.host.toLowerCase();
    const internal = url.hostname === 'app.invalid' || url.hostname === 'localhost';
    const hosts = deepLinkHosts();
    // 유니버설 링크/App Links 는 OS 가 도메인 소유를 검증하므로, 허용 목록이 비어 있으면 호스트를 따지지 않는다
    if (!internal && hosts.length > 0 && !hosts.includes(host)) return null;
    pathname = url.pathname;
  } else if (deepLinkSchemes().includes(protocol)) {
    pathname = `${url.host ? `/${url.host}` : ''}${url.pathname}`;
  } else {
    return null;
  }
  pathname = pathname.replace(/\/{2,}/g, '/');
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
  pathname = PATH_ALIASES[pathname] ?? pathname;
  if (!isAllowedPath(pathname)) return null;
  return `${pathname}${url.search}${url.hash}`;
}

interface RouterHistoryState {
  usr?: unknown;
  key?: string;
  idx?: number;
}

/**
 * react-router(createBrowserRouter) 에 경로 이동을 알린다.
 * 라우터가 쓰는 history.state 형식({ usr, key, idx })을 맞춰 두면 이후 뒤로가기 인덱스도 어긋나지 않는다.
 */
export function navigateTo(path: string, opts: { replace?: boolean } = {}): void {
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === path) return;
  const prev = window.history.state as RouterHistoryState | null;
  const prevIdx = typeof prev?.idx === 'number' ? prev.idx : 0;
  const state: RouterHistoryState = { usr: null, key: Math.random().toString(36).slice(2, 10), idx: opts.replace ? prevIdx : prevIdx + 1 };
  if (opts.replace) window.history.replaceState(state, '', path);
  else window.history.pushState(state, '', path);
  window.dispatchEvent(new PopStateEvent('popstate', { state }));
}

/** 열린 바텀시트/모달이 있는지 (BottomSheet 는 role="dialog" aria-modal="true" 로 렌더된다) */
export function hasOpenSheet(): boolean {
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
}

export type BackAction = 'sheet' | 'back' | 'minimize';

/**
 * 안드로이드 하드웨어 뒤로가기.
 *  1) 시트가 열려 있으면 'yd:back' 이벤트 → BottomSheet 가 스스로 닫힘
 *  2) 첫 화면(홈 탭 또는 더 돌아갈 기록 없음)이면 앱 최소화
 *  3) 그 밖에는 history.back()
 */
export function handleBackButton(ev: { canGoBack: boolean }, minimize: () => void): BackAction {
  if (hasOpenSheet()) {
    window.dispatchEvent(new Event('yd:back'));
    return 'sheet';
  }
  const idx = (window.history.state as RouterHistoryState | null)?.idx;
  if (HOME_PATHS.includes(window.location.pathname) || !ev.canGoBack || idx === 0) {
    minimize();
    return 'minimize';
  }
  window.history.back();
  return 'back';
}
