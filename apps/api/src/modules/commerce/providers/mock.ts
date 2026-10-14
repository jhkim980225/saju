/**
 * 개발·테스트용 목업 결제. PAYMENT_PROVIDER=mock 일 때만 사용되며 운영 환경에서는 env 검증에서 막힌다.
 * paymentKey 가 'mock_fail' 이면 승인 실패를 흉내낸다.
 */
import { GatewayError, type IapVerifier, type PaymentGateway } from './types.js';

export function createMockGateway(): PaymentGateway {
  return {
    id: 'mock',
    envKeys: [],
    isConfigured: () => true,
    async confirm({ orderId, amount, paymentKey }) {
      if (paymentKey === 'mock_fail') throw new GatewayError('[목업] 카드 승인이 거절되었어요.', 'REJECT_CARD_PAYMENT');
      return { paymentKey: paymentKey || `mock_${orderId}`, method: '목업결제', approvedAt: Date.now(), totalAmount: amount };
    },
    async cancel() {},
    async parseWebhook({ rawBody }) {
      const body = JSON.parse(rawBody) as { id?: string; orderId?: string; status?: string; amount?: number };
      return {
        id: body.id ?? `mock-${Date.now()}`,
        type: 'MOCK',
        orderId: body.orderId ?? null,
        paymentKey: null,
        status: body.status === 'CANCELED' ? 'canceled' : body.status === 'DONE' ? 'paid' : 'other',
        amount: typeof body.amount === 'number' ? body.amount : null,
        raw: body,
      };
    },
  };
}

/** 목업 IAP — 영수증이 "mock:<transactionId>" 형식이면 통과 */
export function createMockIapVerifier(platform: 'ios' | 'android'): IapVerifier {
  return {
    platform,
    envKeys: [],
    isConfigured: () => true,
    async verify({ productId, receipt }) {
      if (!receipt.startsWith('mock:')) throw new GatewayError('[목업] 유효하지 않은 영수증이에요.');
      return { transactionId: receipt.slice(5), productId, purchasedAt: Date.now() };
    },
  };
}
