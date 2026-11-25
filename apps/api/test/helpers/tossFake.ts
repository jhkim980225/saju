/**
 * 테스트용 가짜 토스 파트너 API — 실제와 같은 봉투(resultType / success / error)로 응답한다.
 * 업무 오류도 HTTP 200 으로 주는 것까지 흉내 낸다.
 */
import type { TossFetch, TossOrderStatus } from '../../src/modules/toss/client.js';

export interface FakeToss {
  fetch: TossFetch;
  /** 인증 코드 → 사용자 식별키 */
  codes: Map<string, string>;
  /** 토스 주문 ID → 상태 */
  orders: Map<string, { status: TossOrderStatus; sku?: string; statusDeterminedAt?: string }>;
  calls: { url: string; body: unknown }[];
  /** true 면 다음 요청이 네트워크 오류로 실패한다 */
  failNetwork: boolean;
}

export function createFakeToss(): FakeToss {
  const fake: FakeToss = {
    codes: new Map(),
    orders: new Map(),
    calls: [],
    failNetwork: false,
    fetch: async (url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { code?: string; orderId?: string };
      fake.calls.push({ url, body });
      if (fake.failNetwork) throw new Error('connect ECONNREFUSED');
      const ok = (success: unknown) => new Response(JSON.stringify({ resultType: 'SUCCESS', success }), { status: 200 });
      const fail = (errorCode: string, reason: string) => new Response(JSON.stringify({ resultType: 'FAIL', success: null, error: { errorCode, reason } }), { status: 200 });
      if (url.endsWith('/api-partner/v1/apps-in-toss/users/anon-key/exchange')) {
        const anonKey = fake.codes.get(body.code ?? '');
        return anonKey ? ok({ anonKey }) : fail('INVALID_AUTH_CODE', '유효하지 않은 인증 코드예요.');
      }
      if (url.endsWith('/api-partner/v1/apps-in-toss/order/get-order-status')) {
        const order = fake.orders.get(body.orderId ?? '');
        if (!order) return ok({ orderId: body.orderId, status: 'NOT_FOUND', reason: '주문을 찾을 수 없어요.' });
        return ok({ orderId: body.orderId, reason: '', statusDeterminedAt: '2026-11-17T01:00:00.000Z', ...order });
      }
      return new Response('not found', { status: 404 });
    },
  };
  return fake;
}
