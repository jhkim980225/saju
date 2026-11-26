/**
 * 토스 빌드 — lib/analytics.ts(GA4·Meta Pixel·Kakao Pixel)를 대신한다.
 * 미니앱 번들에는 외부 추적 스크립트를 넣지 않는다. 핵심 행동만 앱인토스 SDK 의 Analytics.log 로 기록한다.
 *
 *  - 화면 이동은 SDK 가 자동으로 기록하므로 page_view 는 보내지 않는다(앱인토스 '로그(이벤트) 가이드').
 *  - 이벤트 이름(log_name)은 콘솔의 분석 > 이벤트와 핵심 지표(전환 지표) 설정에서 그대로 쓴다.
 *    이름을 바꾸면 toss/daldal-saju/store/listing.md 의 ⑧과 콘솔에 등록한 전환 지표도 함께 바꿔야 한다.
 *  - 개인정보(이름·생년월일·프로필 ID·주문 ID)는 보내지 않는다. 상품 ID·가격·등급처럼 식별할 수 없는 값만 보낸다.
 *  - 출시 전(샌드박스)에는 집계되지 않고, 지원하지 않는 토스앱에서는 조용히 무시된다.
 */
import { Analytics } from '@apps-in-toss/web-framework';

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
type LogParams = Record<string, string | number | boolean>;

/** 콘솔에 보이는 이벤트 이름 — 전환 지표로 등록하는 이름이기도 하다 */
export const TOSS_EVENTS = {
  /** 생년월일 입력을 마쳤다 */
  birthSubmit: 'birth_submit',
  /** 사주 풀이 결과를 봤다 (대표 전환) */
  sajuResultView: 'saju_result_view',
  /** 오늘의 운세를 봤다 */
  dailyFortuneView: 'daily_fortune_view',
  /** 궁합 결과를 봤다 */
  compatibilityView: 'compatibility_view',
  /** 구매 창을 열었다 */
  paywallView: 'paywall_view',
  /** 결제를 시작했다 */
  checkoutStart: 'checkout_start',
  /** 유료 리포트 구매를 마쳤다(서버가 지급을 확인한 뒤) */
  purchaseComplete: 'purchase_complete',
  /** 공유했다 */
  share: 'share',
} as const;

const pick = (props: Props, keys: string[]): LogParams => {
  const out: LogParams = {};
  for (const k of keys) if (props[k] !== undefined) out[k] = props[k]!;
  return out;
};

/** 공용 이벤트 → 토스 이벤트. 보내지 않는 이벤트는 null (테스트할 수 있게 순수 함수로 둔다) */
export function toTossEvent(event: AnalyticsEvent, props: Props = {}): { log_name: string; params: LogParams } | null {
  switch (event) {
    case 'birth_submitted':
      return { log_name: TOSS_EVENTS.birthSubmit, params: pick(props, ['mode', 'calendar', 'timeKnown']) };
    case 'reading_viewed':
      return { log_name: TOSS_EVENTS.sajuResultView, params: pick(props, ['locked']) };
    case 'daily_viewed':
      return { log_name: TOSS_EVENTS.dailyFortuneView, params: pick(props, ['grade']) };
    case 'compatibility_viewed':
      return { log_name: TOSS_EVENTS.compatibilityView, params: {} };
    case 'paywall_viewed':
      return { log_name: TOSS_EVENTS.paywallView, params: pick(props, ['products']) };
    case 'checkout_started':
      return { log_name: TOSS_EVENTS.checkoutStart, params: pick(props, ['product', 'price']) };
    case 'purchase':
      return { log_name: TOSS_EVENTS.purchaseComplete, params: pick(props, ['product', 'price']) };
    case 'share':
      return { log_name: TOSS_EVENTS.share, params: pick(props, ['channel']) };
    default:
      // page_view 는 SDK 가 자동 기록한다. 로그인·타로·AI 상담 이벤트는 토스 첫 버전에 없다
      return null;
  }
}

/** 외부 스크립트는 불러오지 않는다 */
export function loadScript(_src: string, _attrs: { crossOrigin?: 'anonymous' } = {}): Promise<void> {
  return Promise.reject(new Error('토스 빌드에서는 외부 스크립트를 불러오지 않아요.'));
}

export function initAnalytics(): void {
  /* SDK 가 스스로 준비한다 — 따로 불러올 것이 없다 */
}

/** 웹 그로블 결제 전환 복구 — 토스는 인앱결제라 해당하지 않는다 */
export async function recoverWebPurchase(): Promise<boolean> {
  return false;
}

export function track(event: AnalyticsEvent, props: Props = {}): void {
  const mapped = toTossEvent(event, props);
  if (!mapped) return;
  try {
    // 기록 실패가 화면 동작을 막지 않게 한다(토스앱 밖·낮은 버전·네트워크 오류)
    void Promise.resolve(Analytics.log({ log_name: mapped.log_name, log_type: 'event', params: mapped.params })).catch(() => undefined);
  } catch {
    /* noop */
  }
}
