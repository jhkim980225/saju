/**
 * 분석/전환 추적 — GA4(gtag.js) · Meta Pixel · Kakao Pixel.
 *
 * - 키(VITE_GA4_MEASUREMENT_ID / VITE_META_PIXEL_ID / VITE_KAKAO_PIXEL_ID)가 없는 매체는 스크립트를 로드하지 않고 아무 것도 보내지 않는다.
 * - 개발 모드(import.meta.env.DEV)는 디버그 모드: 스크립트를 로드하지 않고 매체별로 "보낼 내용"을 console.debug 로만 출력한다.
 * - SPA 이므로 GA4 자동 page_view 는 끄고(send_page_view:false) 라우트 변경 때 track('page_view') 로 수동 전송한다(App.tsx RootLayout).
 *   Meta Pixel 의 history 자동 PageView 도 끈다(disablePushState) — 중복 집계 방지.
 * - 개인정보(생년월일·이메일·이름·전화번호 등)는 보내지 않는다: sanitize() 가 키 이름/값 형태로 걸러내고,
 *   page_location 은 utm_* 등 캠페인 파라미터만 남기고 나머지 쿼리(OAuth code, 결제키 등)와 해시를 지운다.
 * - purchase / checkout_started 는 props.price(또는 value, 원 단위)를 value 로, currency 는 항상 'KRW'.
 *   props.orderId 가 있으면 GA4 transaction_id · Meta eventID 로 써서 중복 집계를 막는다.
 *
 * 이벤트 매핑 표
 * | AnalyticsEvent       | GA4 (gtag)                     | Meta Pixel (fbq)                | Kakao Pixel                   |
 * |----------------------|--------------------------------|---------------------------------|-------------------------------|
 * | page_view            | page_view (수동, page_location) | PageView                        | pageView()                    |
 * | birth_submitted      | birth_submitted                | —                               | —                             |
 * | reading_viewed       | reading_viewed                 | ViewContent {content_name}      | viewContent({id:'reading'})   |
 * | daily_viewed         | daily_viewed                   | ViewContent {content_name}      | viewContent({id:'daily'})     |
 * | compatibility_viewed | compatibility_viewed           | ViewContent {content_name}      | viewContent({id:'compat...'}) |
 * | paywall_viewed       | paywall_viewed                 | —                               | —                             |
 * | checkout_started     | begin_checkout {value, KRW}    | InitiateCheckout {value, KRW}   | —                             |
 * | purchase             | purchase {value, KRW, items}   | Purchase {value, KRW}           | purchase({total_price, KRW})  |
 * | signup               | sign_up {method}               | CompleteRegistration            | signUp()                      |
 * | login                | login {method}                 | —                               | —                             |
 * | share                | share {method}                 | —                               | —                             |
 * | chat_sent            | chat_sent                      | —                               | —                             |
 * | tarot_drawn          | tarot_drawn                    | —                               | —                             |
 * | tarot_daily_drawn    | tarot_daily_drawn              | —                               | —                             |
 * | tarot_result_viewed  | tarot_result_viewed            | —                               | —                             |
 */
export type AnalyticsEvent =
  | 'page_view'
  | 'birth_submitted'
  | 'reading_viewed'
  | 'paywall_viewed'
  | 'checkout_started'
  | 'purchase'
  | 'share'
  | 'signup'
  | 'login'
  | 'daily_viewed'
  | 'compatibility_viewed'
  | 'chat_sent'
  | 'tarot_drawn'
  | 'tarot_daily_drawn'
  | 'tarot_result_viewed';

type Props = Record<string, string | number | boolean | undefined>;
type Params = Record<string, unknown>;

// ---------------------------------------------------------------------------
// 외부 스크립트 로더 (광고·공유 모듈에서도 사용) — 같은 src 는 한 번만 삽입, 실패하면 거부된 Promise(호출부에서 조용히 무시)
// ---------------------------------------------------------------------------

const scriptCache = new Map<string, Promise<void>>();

export function loadScript(src: string, attrs: { crossOrigin?: 'anonymous' } = {}): Promise<void> {
  const cached = scriptCache.get(src);
  if (cached) return cached;
  const p = new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new Error('no document'));
    if (Array.from(document.getElementsByTagName('script')).some((s) => s.getAttribute('src') === src)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    if (attrs.crossOrigin) s.crossOrigin = attrs.crossOrigin;
    s.onload = () => resolve();
    s.onerror = () => {
      s.remove();
      reject(new Error(`script load failed: ${src}`));
    };
    document.head.appendChild(s);
  });
  p.catch(() => {}); // 광고 차단기 등으로 실패해도 unhandled rejection 을 남기지 않는다
  scriptCache.set(src, p);
  return p;
}

// ---------------------------------------------------------------------------
// 전역(gtag / fbq / kakaoPixel) — Window 전역 선언은 다른 모듈과 충돌하지 않도록 로컬 타입으로만 다룬다
// ---------------------------------------------------------------------------

type Gtag = (...args: unknown[]) => void;
type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  push: unknown;
  loaded: boolean;
  version: string;
  disablePushState?: boolean;
};
type KakaoPixel = (id: string) => Record<string, ((arg?: unknown) => void) | undefined>;

interface TrackingGlobals {
  dataLayer?: unknown[];
  gtag?: Gtag;
  fbq?: Fbq;
  _fbq?: Fbq;
  kakaoPixel?: KakaoPixel;
}

const g = () => window as unknown as TrackingGlobals;

const GTAG_SRC = 'https://www.googletagmanager.com/gtag/js';
const META_SRC = 'https://connect.facebook.net/en_US/fbevents.js';
const KAKAO_PIXEL_SRC = 'https://t1.daumcdn.net/kas/static/kp.js';

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function envIds() {
  return {
    ga4: str(import.meta.env.VITE_GA4_MEASUREMENT_ID),
    meta: str(import.meta.env.VITE_META_PIXEL_ID),
    kakao: str(import.meta.env.VITE_KAKAO_PIXEL_ID),
  };
}

const state = {
  initialized: false,
  debug: false,
  ids: { ga4: '', meta: '', kakao: '' },
  kakaoQueue: [] as KakaoCall[],
  kakaoFailed: false,
};

export function initAnalytics(): void {
  if (state.initialized || typeof window === 'undefined') return;
  const ids = envIds();
  state.initialized = true;
  state.ids = ids;

  if (import.meta.env.DEV) {
    state.debug = true;
    console.debug('[analytics] 디버그 모드 — 스크립트 로드·전송 없이 콘솔로만 출력합니다.', {
      ga4: Boolean(ids.ga4),
      meta: Boolean(ids.meta),
      kakao: Boolean(ids.kakao),
    });
    return;
  }

  if (ids.ga4) initGa4(ids.ga4);
  if (ids.meta) initMeta(ids.meta);
  if (ids.kakao) initKakao();
}

function initGa4(id: string) {
  const w = g();
  w.dataLayer = w.dataLayer || [];
  if (!w.gtag) {
    // gtag.js 는 배열이 아닌 arguments 객체를 dataLayer 에 넣어야 인식한다(공식 스니펫과 동일)
    w.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      w.dataLayer!.push(arguments);
    };
  }
  w.gtag('js', new Date());
  w.gtag('config', id, { send_page_view: false, page_location: safeLocation() });
  loadScript(`${GTAG_SRC}?id=${encodeURIComponent(id)}`).catch(() => {});
}

function initMeta(id: string) {
  const w = g();
  if (!w.fbq) {
    // 공식 Meta Pixel 스니펫의 큐 스텁 — fbevents.js 가 로드되면 queue 를 처리한다
    const n = function () {
      // eslint-disable-next-line prefer-rest-params
      const args = arguments as unknown as unknown[];
      if (n.callMethod) n.callMethod.apply(n, args);
      else n.queue.push(args);
    } as unknown as Fbq;
    n.push = n;
    n.loaded = true;
    n.version = '2.0';
    n.queue = [];
    n.disablePushState = true; // SPA: history 변경 자동 PageView 끔(수동 PageView 와 중복 방지)
    w.fbq = n;
    if (!w._fbq) w._fbq = n;
  }
  w.fbq('set', 'autoConfig', false, id); // 버튼 텍스트·페이지 메타데이터 자동 수집 끔(개인정보 보호)
  w.fbq('init', id);
  loadScript(META_SRC).catch(() => {});
}

function initKakao() {
  loadScript(KAKAO_PIXEL_SRC).then(
    () => flushKakao(),
    () => {
      state.kakaoFailed = true;
      state.kakaoQueue = [];
    },
  );
}

// ---------------------------------------------------------------------------
// 개인정보 필터
// ---------------------------------------------------------------------------

const PII_KEY = /^(e-?mail|email_?address|birth\w*|dob|phone\w*|tel|mobile|name|full_?name|user_?name|nickname|address|gender|sex|year|month|day|hour|minute|password|token)$/i;
const EMAIL_VALUE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const DATE_VALUE = /^(\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{8})$/;

function sanitize(props: Props): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || PII_KEY.test(k)) continue;
    if (typeof v === 'string') {
      if (EMAIL_VALUE.test(v) || DATE_VALUE.test(v.trim())) continue;
      out[k] = v.slice(0, 100);
    } else if (typeof v === 'number') {
      if (Number.isFinite(v)) out[k] = v;
    } else out[k] = v;
  }
  return out;
}

function omit(p: Params, keys: string[]): Params {
  return Object.fromEntries(Object.entries(p).filter(([k]) => !keys.includes(k)));
}

const CAMPAIGN_PARAMS = /^(utm_[a-z]+|gclid|gbraid|wbraid|fbclid)$/i;

/** 현재 URL(또는 path)에서 캠페인 파라미터만 남긴 page_location */
function safeLocation(path?: string): string {
  const loc = window.location;
  const url = new URL(path && path.startsWith('/') ? path : loc.pathname, loc.origin);
  const src = new URLSearchParams(loc.search);
  for (const [k, v] of src) if (CAMPAIGN_PARAMS.test(k)) url.searchParams.append(k, v);
  return url.href;
}

// ---------------------------------------------------------------------------
// 이벤트 매핑
// ---------------------------------------------------------------------------

type GaCall = { name: string; params: Params };
type MetaCall = { method: 'track' | 'trackCustom'; name: string; params: Params; eventID?: string };
type KakaoCall = { method: 'pageView' | 'viewContent' | 'purchase' | 'signUp'; arg?: unknown };
interface Dispatch {
  ga4?: GaCall;
  meta?: MetaCall;
  kakao?: KakaoCall;
}

const CONTENT_OF: Partial<Record<AnalyticsEvent, string>> = {
  reading_viewed: 'reading',
  daily_viewed: 'daily',
  compatibility_viewed: 'compatibility',
};

function toDispatch(event: AnalyticsEvent, raw: Props): Dispatch {
  const props = sanitize(raw);
  const value = typeof props.value === 'number' ? props.value : typeof props.price === 'number' ? props.price : undefined;
  const product = typeof props.product === 'string' ? props.product : undefined;
  const orderId = typeof props.orderId === 'string' ? props.orderId : undefined;
  const rest = omit(props, ['value', 'price', 'product', 'orderId']);
  const money = value !== undefined ? { value, currency: 'KRW' } : { currency: 'KRW' };
  const items = product ? [{ item_id: product, item_name: product, price: value, quantity: 1 }] : undefined;

  switch (event) {
    case 'page_view': {
      const page_location = safeLocation(typeof props.path === 'string' ? props.path : undefined);
      return {
        ga4: { name: 'page_view', params: { page_location } },
        meta: { method: 'track', name: 'PageView', params: {} },
        kakao: { method: 'pageView' },
      };
    }
    case 'reading_viewed':
    case 'daily_viewed':
    case 'compatibility_viewed': {
      const kind = CONTENT_OF[event]!;
      return {
        ga4: { name: event, params: props },
        meta: { method: 'track', name: 'ViewContent', params: { content_name: kind, content_category: 'saju' } },
        kakao: { method: 'viewContent', arg: { id: kind } },
      };
    }
    case 'checkout_started':
      return {
        ga4: { name: 'begin_checkout', params: { ...rest, ...money, ...(items && { items }) } },
        meta: { method: 'track', name: 'InitiateCheckout', params: { ...money, ...(product && { content_ids: [product], content_type: 'product', num_items: 1 }) } },
      };
    case 'purchase':
      return {
        ga4: { name: 'purchase', params: { ...rest, ...money, ...(orderId && { transaction_id: orderId }), ...(items && { items }) } },
        meta: { method: 'track', name: 'Purchase', params: { ...money, ...(product && { content_ids: [product], content_type: 'product', num_items: 1 }) }, eventID: orderId },
        kakao: {
          method: 'purchase',
          arg: {
            total_quantity: '1',
            total_price: String(value ?? 0),
            currency: 'KRW',
            ...(product && { products: [{ id: product, name: product, quantity: '1', price: String(value ?? 0) }] }),
          },
        },
      };
    case 'signup':
      return {
        ga4: { name: 'sign_up', params: props },
        meta: { method: 'track', name: 'CompleteRegistration', params: {} },
        kakao: { method: 'signUp' },
      };
    case 'login':
      return { ga4: { name: 'login', params: props } };
    case 'share':
      return { ga4: { name: 'share', params: { ...omit(props, ['channel']), ...(props.channel !== undefined && { method: props.channel }) } } };
    default:
      return { ga4: { name: event, params: props } };
  }
}

// ---------------------------------------------------------------------------
// 전송
// ---------------------------------------------------------------------------

export function track(event: AnalyticsEvent, props: Props = {}): void {
  if (!state.initialized) return;
  const d = toDispatch(event, props);

  if (state.debug) {
    console.debug(`[analytics] ${event}`, props, d);
    return;
  }

  const { ids } = state;
  const w = g();
  try {
    if (ids.ga4 && d.ga4 && w.gtag) {
      if (d.ga4.name === 'page_view') w.gtag('set', { page_location: d.ga4.params.page_location });
      w.gtag('event', d.ga4.name, d.ga4.params);
    }
  } catch {
    /* 분석 실패는 서비스에 영향을 주지 않는다 */
  }
  try {
    if (ids.meta && d.meta && w.fbq) {
      if (d.meta.eventID) w.fbq(d.meta.method, d.meta.name, d.meta.params, { eventID: d.meta.eventID });
      else w.fbq(d.meta.method, d.meta.name, d.meta.params);
    }
  } catch {
    /* noop */
  }
  if (ids.kakao && d.kakao && !state.kakaoFailed) {
    if (w.kakaoPixel) sendKakao(d.kakao);
    else if (state.kakaoQueue.length < 50) state.kakaoQueue.push(d.kakao); // kp.js 로드 전에는 큐에 보관
  }
}

function sendKakao(call: KakaoCall) {
  try {
    const px = g().kakaoPixel?.(state.ids.kakao);
    const fn = px?.[call.method];
    if (typeof fn === 'function') {
      if (call.arg === undefined) fn.call(px);
      else fn.call(px, call.arg);
    }
  } catch {
    /* noop */
  }
}

function flushKakao() {
  if (!g().kakaoPixel) return;
  const q = state.kakaoQueue;
  state.kakaoQueue = [];
  q.forEach(sendKakao);
}
