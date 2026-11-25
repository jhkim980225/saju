/**
 * 토스(앱인토스) 파트너 API 클라이언트 — 서버 간 통신은 mTLS 인증서가 필요하다.
 * Worker 는 wrangler.jsonc 의 mtls_certificates 바인딩(TOSS_MTLS)의 fetch 를 넘겨 준다(src/worker.ts).
 * 바인딩이 없으면 isConfigured() 가 false — 토스 기능은 꺼진 채로 나머지 서비스는 그대로 돈다.
 *
 * 주의: 업무 오류도 HTTP 200 으로 온다 — 반드시 resultType 을 본다(SUCCESS 가 아니면 모두 실패).
 * 문서: apps-in-toss-docs/pages/api/iap.md, summary/03-인증-수익화-마케팅-정산.md
 */
import type { AppConfig } from '../../config/env.js';

/** mTLS 인증서가 붙는 fetch (Cloudflare Fetcher.fetch 와 같은 모양) */
export type TossFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type TossOrderStatus = 'MINIAPP_MISMATCH' | 'NOT_FOUND' | 'ORDER_IN_PROGRESS' | 'PAYMENT_COMPLETED' | 'PURCHASED' | 'FAILED' | 'REFUNDED' | 'ERROR';

export interface TossOrder {
  orderId: string;
  status: TossOrderStatus;
  /** 상태를 확정하지 못하면(MINIAPP_MISMATCH·NOT_FOUND·ERROR) 오지 않는다 */
  sku?: string;
  statusDeterminedAt?: string;
  reason?: string;
}

export class TossApiError extends Error {
  constructor(
    public readonly code: string,
    reason: string,
  ) {
    super(reason);
  }
}

export interface TossClient {
  envKeys: string[];
  isConfigured(): boolean;
  /** 개발용 모의 모드 — 토스 서버를 부르지 않는다 */
  isMock: boolean;
  /** 미니앱이 SDK 로 받은 일회용 코드 → 사용자 식별키(anonKey) */
  exchangeAnonKey(code: string): Promise<string>;
  /** 인앱 결제 주문 상태 조회 */
  getOrderStatus(orderId: string): Promise<TossOrder>;
}

type TossResult<T> = { resultType?: string; success?: T | null; error?: { errorCode?: string; reason?: string } | null };

const TIMEOUT_MS = 10_000;

export function createTossClient(config: AppConfig, tossFetch?: TossFetch): TossClient {
  const isMock = !tossFetch && config.TOSS_DEV_MOCK && !config.isProd;
  const base = config.TOSS_API_BASE.replace(/\/$/, '');

  const post = async <T>(path: string, body: unknown): Promise<T> => {
    if (!tossFetch) throw new TossApiError('NOT_CONFIGURED', '토스 mTLS 바인딩이 없어요.');
    let res: Response;
    try {
      res = await tossFetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new TossApiError('NETWORK_ERROR', e instanceof Error ? e.message : '토스 서버에 연결하지 못했어요.');
    }
    const json = (await res.json().catch(() => null)) as TossResult<T> | null;
    if (!json || json.resultType !== 'SUCCESS' || json.success === null || json.success === undefined) {
      throw new TossApiError(json?.error?.errorCode ?? json?.resultType ?? `HTTP_${res.status}`, json?.error?.reason ?? '토스 서버가 요청을 처리하지 못했어요.');
    }
    return json.success;
  };

  return {
    envKeys: ['TOSS_MTLS(mtls_certificates 바인딩)', 'TOSS_USER_KEY_SECRET'],
    isMock,
    isConfigured: () => isMock || Boolean(tossFetch && config.TOSS_USER_KEY_SECRET),
    async exchangeAnonKey(code) {
      if (isMock) return 'dev-user';
      const out = await post<{ anonKey?: string }>('/api-partner/v1/apps-in-toss/users/anon-key/exchange', { code });
      if (!out.anonKey) throw new TossApiError('EMPTY_ANON_KEY', '토스 서버가 사용자 식별키를 주지 않았어요.');
      return out.anonKey;
    },
    async getOrderStatus(orderId) {
      if (isMock) return { orderId, status: 'PAYMENT_COMPLETED', statusDeterminedAt: new Date().toISOString() };
      const out = await post<Partial<TossOrder>>('/api-partner/v1/apps-in-toss/order/get-order-status', { orderId });
      if (!out.status) throw new TossApiError('EMPTY_STATUS', '토스 서버가 주문 상태를 주지 않았어요.');
      return { orderId, status: out.status, sku: out.sku, statusDeterminedAt: out.statusDeterminedAt, reason: out.reason };
    },
  };
}
