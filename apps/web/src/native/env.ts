/**
 * 앱 빌드용 환경 값 (vite build --mode app → apps/web/.env.app).
 * 플러그인을 import 하지 않는 순수 모듈이라 웹 번들에 들어가도 무방하다.
 */
const env = import.meta.env as Record<string, string | undefined>;

/** Capacitor appId — 커스텀 스킴(kr.dalbitsaju.app://)의 기본값으로도 쓴다 */
export const APP_ID = 'kr.dalbitsaju.app';

const trimSlash = (s: string) => s.replace(/\/+$/, '');

/**
 * 웹 서비스 공개 주소 (예: https://dalbitsaju.kr).
 * 앱 웹뷰의 origin 은 capacitor://localhost / https://localhost 이므로
 * 소셜 로그인 redirectUri·공유 링크·유니버설 링크 호스트는 이 값을 기준으로 만든다.
 */
export function appWebOrigin(): string {
  const v = env.VITE_PUBLIC_WEB_URL?.trim();
  if (v) return trimSlash(v);
  return typeof window !== 'undefined' ? window.location.origin : '';
}

/** 딥링크로 받아들일 호스트 — 유니버설 링크/App Links 도메인 */
export function deepLinkHosts(): string[] {
  const hosts = new Set<string>();
  for (const raw of [env.VITE_PUBLIC_WEB_URL, ...(env.VITE_DEEPLINK_HOSTS ?? '').split(',')]) {
    const v = raw?.trim();
    if (!v) continue;
    try {
      hosts.add(new URL(v.includes('://') ? v : `https://${v}`).host.toLowerCase());
    } catch {
      /* 잘못된 값은 무시 */
    }
  }
  return [...hosts];
}

/** 딥링크로 받아들일 커스텀 스킴 (콜론 제외, 소문자) */
export function deepLinkSchemes(): string[] {
  const schemes = new Set<string>([APP_ID]);
  const custom = env.VITE_APP_URL_SCHEME?.trim().replace(/:\/*$/, '');
  if (custom) schemes.add(custom.toLowerCase());
  return [...schemes];
}

/** API 주소가 절대 URL 인지 (앱에서는 상대 경로 /api/v1 이 capacitor://localhost 로 가 버린다) */
export function hasAbsoluteApiBase(): boolean {
  return /^https?:\/\//i.test(env.VITE_API_BASE_URL ?? '');
}

// ── AdMob ────────────────────────────────────────────────────
/** Google 공식 테스트 광고 단위 — 실제 ID 가 없을 때 사용(실서비스 노출 금지) */
const ADMOB_TEST_UNITS = {
  rewarded: { ios: 'ca-app-pub-3940256099942544/1712485313', android: 'ca-app-pub-3940256099942544/5224354917' },
  banner: { ios: 'ca-app-pub-3940256099942544/2435281174', android: 'ca-app-pub-3940256099942544/9214589741' },
} as const;

export type AdUnitKind = keyof typeof ADMOB_TEST_UNITS;

const ADMOB_ENV_KEYS: Record<AdUnitKind, Record<'ios' | 'android', string>> = {
  // docs/research/03-pricing-payments-ads.md §5.9 의 ADMOB_UNIT_* 이름에 VITE_ 접두사
  rewarded: { ios: 'VITE_ADMOB_UNIT_REWARDED_CHAT_IOS', android: 'VITE_ADMOB_UNIT_REWARDED_CHAT_ANDROID' },
  banner: { ios: 'VITE_ADMOB_UNIT_BANNER_RESULT_IOS', android: 'VITE_ADMOB_UNIT_BANNER_RESULT_ANDROID' },
};

export function adUnitId(kind: AdUnitKind, platform: 'ios' | 'android'): { adId: string; isTesting: boolean } {
  const configured = env[ADMOB_ENV_KEYS[kind][platform]]?.trim();
  const forceTest = env.VITE_ADMOB_TESTING === '1' || env.VITE_ADMOB_TESTING === 'true';
  if (configured) return { adId: configured, isTesting: forceTest };
  return { adId: ADMOB_TEST_UNITS[kind][platform], isTesting: true };
}
