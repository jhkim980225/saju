/**
 * PG 결제창 연동 — 토스페이먼츠 v2 SDK(결제창) / 포트원 V2 브라우저 SDK.
 * 여기서는 결제창만 연다. 승인은 결제창이 successUrl 로 돌려보낸 뒤 /payments/success 페이지가
 * 서버 confirm API(POST /api/v1/payments/confirm)로 처리한다.
 *
 * 공통 주의
 * - 가상계좌는 서버가 지원하지 않는다 → 토스 method 'CARD'(카드·간편결제 통합창), 포트원 payMethod 'CARD' 만 쓴다.
 * - 인앱 브라우저(카카오톡·인스타그램·네이버 앱 등): 앱카드/간편결제 앱 전환(intent://, ispmobile:// 등)이 막히거나
 *   결제 후 다른 브라우저로 돌아가 pendingCheckout(localStorage)을 못 찾는 경우가 있다. 결과 페이지는 쿼리만으로도
 *   승인할 수 있게 해 두었지만, 문제가 잦으면 결제 전에 외부 브라우저로 열기를 안내한다
 *   (카카오톡: kakaotalk://web/openExternal?url=…, 안드로이드 기타: intent://…#Intent;scheme=https;end).
 * - Capacitor 앱에서는 이 경로를 쓰지 않는다(디지털 콘텐츠는 인앱결제 — startCheckout 참고).
 */
import type { CheckoutDto } from '@saju/shared';

type Checkout = CheckoutDto['checkout'];

export const TOSS_SDK_URL = 'https://js.tosspayments.com/v2/standard';
export const PORTONE_SDK_URL = 'https://cdn.portone.io/v2/browser-sdk.js';
const SCRIPT_TIMEOUT_MS = 15_000;
const LOAD_ERROR = '결제 모듈을 불러오지 못했어요. 네트워크 상태를 확인하거나 광고 차단 기능을 끈 뒤 다시 시도해 주세요.';

// ── SDK 최소 타입 (쓰는 것만) ────────────────────────────────

interface TossPaymentRequest {
  method: 'CARD';
  amount: { currency: 'KRW'; value: number };
  orderId: string;
  orderName: string;
  successUrl: string;
  failUrl: string;
  customerEmail?: string;
  customerName?: string;
  card?: { flowMode: 'DEFAULT'; useEscrow: boolean; useCardPoint: boolean; useAppCardOnly: boolean };
}
interface TossPaymentsInstance {
  payment(opts: { customerKey: string }): { requestPayment(req: TossPaymentRequest): Promise<unknown> };
}
type TossPaymentsFactory = (clientKey: string) => TossPaymentsInstance;

interface PortOnePaymentRequest {
  storeId: string;
  channelKey: string;
  paymentId: string;
  orderName: string;
  totalAmount: number;
  currency: 'CURRENCY_KRW';
  payMethod: 'CARD';
  redirectUrl: string;
  customer?: { email?: string; fullName?: string };
}
/** code 가 있으면 실패(사용자 취소 포함), 없으면 성공 */
interface PortOnePaymentResponse {
  transactionType?: string;
  txId?: string;
  paymentId?: string;
  code?: string;
  message?: string;
}
interface PortOneSdk {
  requestPayment(req: PortOnePaymentRequest): Promise<PortOnePaymentResponse | undefined>;
}

/** SDK 가 window 에 등록하는 전역 (테스트에서는 가짜 객체를 주입) */
const sdk = () => window as unknown as { TossPayments?: TossPaymentsFactory; PortOne?: PortOneSdk };

// ── 스크립트 로더 ────────────────────────────────────────────

const loading = new Map<string, Promise<void>>();

/** 외부 SDK 스크립트를 1회만 로드. 동시 호출은 같은 Promise 를 공유하고, 실패하면 캐시를 비워 재시도할 수 있게 한다 */
function loadScript(src: string, isReady: () => boolean): Promise<void> {
  if (isReady()) return Promise.resolve();
  const existing = loading.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      loading.delete(src);
      reject(new Error(LOAD_ERROR));
    };
    timer = setTimeout(fail, SCRIPT_TIMEOUT_MS);
    script.onload = () => {
      if (!isReady()) return fail();
      clearTimeout(timer);
      resolve();
    };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  loading.set(src, promise);
  return promise;
}

/** SDK 오류({ code, message }) → 사용자에게 보여줄 Error */
function toUserError(e: unknown, fallback: string): Error {
  const err = typeof e === 'object' && e !== null ? (e as { code?: unknown; message?: unknown }) : {};
  if (typeof err.code === 'string' && /CANCEL/i.test(err.code)) return new Error('결제를 취소했어요.');
  return new Error(typeof err.message === 'string' && err.message ? err.message : fallback);
}

/** 결과 페이지로 이동 — mock 결제와 같이 현재 출처 기준 경로로 이동(pendingCheckout 저장소 유지) */
function redirect(base: string, params: Record<string, string>) {
  const url = new URL(base, window.location.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  window.location.assign(`${url.pathname}${url.search}`);
}

// ── 토스페이먼츠 ─────────────────────────────────────────────

/**
 * 토스페이먼츠 v2 결제창(리다이렉트) 방식.
 * - 성공: successUrl?paymentKey=…&orderId=…&amount=… / 실패·취소: failUrl?code=…&message=…&orderId=…
 * - 키: 결제창(payment)은 "API 개별 연동 키"(test_ck_/live_ck_)를 쓴다. 서버 TOSS_SECRET_KEY 도 같은 쌍(test_sk_)이어야 한다.
 *
 * 결제위젯(UI) 방식으로 바꾸려면(결제위젯 연동 키 test_gck_/test_gsk_ 쌍 필요):
 *   결제 페이지에 <div id="payment-method" /> <div id="agreement" /> 컨테이너를 두고
 *   const widgets = TossPayments(clientKey).widgets({ customerKey });
 *   await widgets.setAmount({ currency: 'KRW', value: c.amount });
 *   await Promise.all([widgets.renderPaymentMethods({ selector: '#payment-method', variantKey: 'DEFAULT' }), widgets.renderAgreement({ selector: '#agreement' })]);
 *   await widgets.requestPayment({ orderId, orderName, successUrl, failUrl, customerEmail, customerName });
 *   (가상계좌는 토스 상점관리자의 위젯 결제수단 설정에서 끈다)
 */
export async function openToss(c: Checkout): Promise<void> {
  const clientKey = c.clientKey || (import.meta.env.VITE_TOSS_CLIENT_KEY as string | undefined);
  if (!clientKey) throw new Error('토스페이먼츠 클라이언트 키(VITE_TOSS_CLIENT_KEY)가 설정되지 않았어요.');
  await loadScript(TOSS_SDK_URL, () => typeof sdk().TossPayments === 'function');

  const request: TossPaymentRequest = {
    method: 'CARD', // 카드·간편결제 통합창 — 가상계좌 미노출
    amount: { currency: 'KRW', value: c.amount },
    orderId: c.orderId,
    orderName: c.orderName,
    successUrl: c.successUrl,
    failUrl: c.failUrl,
    card: { flowMode: 'DEFAULT', useEscrow: false, useCardPoint: false, useAppCardOnly: false },
  };
  if (c.customerEmail) request.customerEmail = c.customerEmail;
  if (c.customerName) request.customerName = c.customerName;

  try {
    const payment = sdk().TossPayments!(clientKey).payment({ customerKey: c.customerKey });
    // 리다이렉트 방식이라 정상이면 페이지가 이동한다. 파라미터 오류 등은 { code, message } 로 reject 된다.
    await payment.requestPayment(request);
  } catch (e) {
    throw toUserError(e, '토스페이먼츠 결제창을 열지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
}

// ── 포트원 V2 ────────────────────────────────────────────────

/**
 * 포트원 V2 브라우저 SDK.
 * - paymentId 는 반드시 주문 ID 와 같아야 한다(서버가 paymentId === orderId 로 검증).
 * - 모바일: 결제 후 redirectUrl(successUrl)?paymentId=…(&code=…&message=… 실패 시) 로 돌아온다 → 결과 페이지가 처리.
 * - PC: Promise 로 결과가 온다 → code 유무에 따라 failUrl / successUrl 로 직접 이동한다.
 * - 간편결제 버튼을 따로 두려면 payMethod: 'EASY_PAY' (+ easyPay.easyPayProvider) 로 한 번 더 호출하면 된다.
 *   일부 PG 채널은 구매자 이름·연락처가 필수이니 채널 연동 시 customer 필드를 확인한다.
 */
export async function openPortOne(c: Checkout): Promise<void> {
  if (!c.storeId || !c.channelKey) throw new Error('포트원 storeId/channelKey 가 설정되지 않았어요.');
  await loadScript(PORTONE_SDK_URL, () => typeof sdk().PortOne?.requestPayment === 'function');

  const customer: { email?: string; fullName?: string } = {};
  if (c.customerEmail) customer.email = c.customerEmail;
  if (c.customerName) customer.fullName = c.customerName;

  let res: PortOnePaymentResponse | undefined;
  try {
    res = await sdk().PortOne!.requestPayment({
      storeId: c.storeId,
      channelKey: c.channelKey,
      paymentId: c.orderId,
      orderName: c.orderName,
      totalAmount: c.amount,
      currency: 'CURRENCY_KRW',
      payMethod: 'CARD',
      redirectUrl: c.successUrl,
      ...(customer.email || customer.fullName ? { customer } : {}),
    });
  } catch (e) {
    throw toUserError(e, '포트원 결제창을 열지 못했어요. 잠시 후 다시 시도해 주세요.');
  }

  if (!res) return; // 모바일 리다이렉트 진행 중
  if (res.code) {
    redirect(c.failUrl, { orderId: c.orderId, code: res.code, message: res.message ?? '' });
    return;
  }
  // amount·provider 도 함께 넘겨 pendingCheckout 이 없어도 결과 페이지가 승인할 수 있게 한다(서버가 금액을 재검증)
  redirect(c.successUrl, { paymentId: res.paymentId ?? c.orderId, orderId: c.orderId, amount: String(c.amount), provider: 'portone' });
}
