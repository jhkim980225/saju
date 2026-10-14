/**
 * 결제 게이트웨이 추상화 — 토스페이먼츠 / 포트원 / 목업을 동일 인터페이스로 다룬다.
 * 승인(confirm)과 금액 검증은 반드시 서버에서 수행한다.
 */
export interface ConfirmResult {
  /** 결제사 결제 키 (토스 paymentKey / 포트원 paymentId) */
  paymentKey: string;
  method: string | null;
  approvedAt: number;
  /** 결제사가 확인한 금액 — 주문 금액과 다르면 승인 취소해야 한다 */
  totalAmount: number;
  raw?: unknown;
}

export interface WebhookEvent {
  /** 중복 처리 방지용 이벤트 ID */
  id: string;
  type: string;
  orderId: string | null;
  paymentKey: string | null;
  status: 'paid' | 'canceled' | 'failed' | 'other';
  /** 결제사에서 재조회로 확인한 결제 총액(원). 확인 불가면 null — paid 복구 시 주문 금액과 대조한다 */
  amount: number | null;
  raw: unknown;
}

export interface PaymentGateway {
  id: 'mock' | 'toss' | 'portone';
  /** 필요한 env 키 (미설정 시 안내용) */
  envKeys: string[];
  isConfigured(): boolean;
  confirm(input: { orderId: string; amount: number; paymentKey: string }): Promise<ConfirmResult>;
  cancel(input: { paymentKey: string; reason: string; amount?: number }): Promise<void>;
  /** 웹훅 서명/출처 검증 후 이벤트로 변환. 검증 실패 시 null */
  parseWebhook(input: { headers: Record<string, string | string[] | undefined>; rawBody: string }): Promise<WebhookEvent | null>;
}

export interface IapVerification {
  transactionId: string;
  productId: string;
  purchasedAt: number;
  raw?: unknown;
}

export interface IapVerifier {
  platform: 'ios' | 'android';
  envKeys: string[];
  isConfigured(): boolean;
  /** 영수증/구매 토큰을 스토어 서버 API 로 검증 */
  verify(input: { productId: string; receipt: string }): Promise<IapVerification>;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly code = 'PAYMENT_FAILED',
  ) {
    super(message);
  }
}
