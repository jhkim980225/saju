/**
 * 공유 — 앱(Capacitor Share) → Web Share API → 클립보드 순으로 폴백.
 * 카카오톡 공유는 웹에서 VITE_KAKAO_JS_KEY 가 있을 때만 활성화(shareKakao).
 *  - Kakao JS SDK 는 공식 CDN 에서 처음 필요할 때 1회만 동적 로드하고 Kakao.init(키) 한다.
 *  - 카카오 디벨로퍼스 > 앱 > 플랫폼 > Web 에 서비스 도메인을 등록해야 동작한다(미등록 도메인은 SDK 오류 → false 반환).
 *  - 데스크톱에서는 공유 팝업이 열리므로, 시트가 열릴 때 preloadKakao() 로 미리 로드해 두면 클릭 즉시(사용자 제스처 안에서) 호출된다.
 *  - 생년월일·태어난 시각은 공유 내용에 넣지 않는다(share.privacyNote).
 */
import { t } from './copy';
import { loadScript, track } from './analytics';
import { isNativeApp, native } from './platform';

export interface SharePayload {
  title: string;
  text: string;
  url: string;
  /** 카카오 피드 카드 이미지(절대/상대 URL, PNG·JPG — SVG 불가). 없으면 텍스트 카드로 보낸다 */
  imageUrl?: string;
  /** 카카오 카드 버튼명(8자 이하로 잘림). 기본값: '자세히 보기' */
  buttonTitle?: string;
  /** 카카오 카드 버튼을 직접 지정(최대 2개, 예: [{ title: '결과 보기', url }, { title: '내 사주 보기', url: '/input' }]) */
  buttons?: { title: string; url: string }[];
}

const KAKAO_SDK_SRC = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js';

interface KakaoSdk {
  init: (key: string) => void;
  isInitialized: () => boolean;
  Share: { sendDefault: (settings: Record<string, unknown>) => void };
}

const kakaoKey = () => {
  const v: unknown = import.meta.env.VITE_KAKAO_JS_KEY;
  return typeof v === 'string' ? v.trim() : '';
};

/** 시스템 공유(앱 네이티브 공유 또는 Web Share API) 가능 여부 — 공유 시트의 '더보기' 노출 기준 */
export function systemShareAvailable(): boolean {
  return Boolean(native.share) || (typeof navigator !== 'undefined' && typeof navigator.share === 'function');
}

export async function shareLink(p: SharePayload): Promise<'shared' | 'copied' | 'cancelled'> {
  if (native.share && (await native.share({ title: p.title, text: p.text, url: p.url }))) {
    track('share', { channel: 'system' });
    return 'shared';
  }
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title: p.title, text: p.text, url: p.url });
      track('share', { channel: 'system' });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  await writeClipboard(`${p.text}\n${p.url}`);
  track('share', { channel: 'clipboard' });
  return 'copied';
}

/** 링크(URL)만 복사 — 공유 시트의 '링크 복사' */
export async function copyLink(url: string): Promise<boolean> {
  const ok = await writeClipboard(url);
  if (ok) track('share', { channel: 'copy_link' });
  return ok;
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 권한 거부·비보안 컨텍스트 → 아래 폴백 */
  }
  // 인앱 브라우저 등 Clipboard API 가 없는 환경
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 카카오톡 공유
// ---------------------------------------------------------------------------

export function kakaoAvailable(): boolean {
  return !isNativeApp() && kakaoKey() !== '';
}

let kakaoLoading: Promise<KakaoSdk | null> | null = null;

/** 이미 로드된 SDK 를 (필요하면 init 후) 돌려준다 */
function readyKakao(): KakaoSdk | null {
  const sdk = (window as unknown as { Kakao?: KakaoSdk }).Kakao;
  if (!sdk?.Share) return null;
  try {
    if (!sdk.isInitialized()) sdk.init(kakaoKey());
    return sdk;
  } catch {
    return null;
  }
}

function loadKakao(): Promise<KakaoSdk | null> {
  kakaoLoading ??= loadScript(KAKAO_SDK_SRC).then(readyKakao, () => null);
  return kakaoLoading;
}

/** 공유 UI 가 열릴 때 미리 SDK 를 받아 둔다(키가 없거나 앱이면 아무 것도 안 함) */
export function preloadKakao(): void {
  if (kakaoAvailable()) void loadKakao();
}

const clip = (s: string, max: number) => Array.from(s.trim()).slice(0, max).join('').trim();

function absUrl(u: string): string {
  try {
    return new URL(u, window.location.origin).href;
  } catch {
    return window.location.origin;
  }
}

/** Kakao.Share.sendDefault 설정 — 이미지가 있으면 feed, 없으면 text 템플릿 */
export function buildKakaoTemplate(p: SharePayload): Record<string, unknown> {
  const url = absUrl(p.url);
  const link = { mobileWebUrl: url, webUrl: url };
  const buttonDefs = p.buttons?.length ? p.buttons.slice(0, 2) : [{ title: p.buttonTitle || t('common.learnMore'), url }];
  const buttons = buttonDefs.map((b) => {
    const href = absUrl(b.url);
    return { title: clip(b.title, 8), link: { mobileWebUrl: href, webUrl: href } };
  });
  if (p.imageUrl) {
    return {
      objectType: 'feed',
      content: { title: p.title, description: p.text, imageUrl: absUrl(p.imageUrl), link },
      buttons,
    };
  }
  // 피드 템플릿은 content.imageUrl 이 사실상 필수이고 기본 OG 이미지(og-image.svg)는 카카오가 지원하지 않는 형식이라 텍스트 템플릿을 쓴다
  return { objectType: 'text', text: clip(`${p.title}\n${p.text}`, 200), link, buttons };
}

export async function shareKakao(p: SharePayload): Promise<boolean> {
  if (!kakaoAvailable()) return false;
  // 이미 로드돼 있으면 await 없이 바로 호출해 사용자 제스처를 유지(데스크톱 팝업 차단 방지)
  const sdk = readyKakao() ?? (await loadKakao());
  if (!sdk) return false;
  try {
    sdk.Share.sendDefault(buildKakaoTemplate(p));
    track('share', { channel: 'kakao' });
    return true;
  } catch {
    return false;
  }
}
