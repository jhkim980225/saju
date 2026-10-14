/**
 * 포트원(PortOne) V2 게이트웨이 — KCP/나이스 등 PG 채널 연동용 2순위 결제 수단.
 * 필요한 env: PORTONE_STORE_ID, PORTONE_CHANNEL_KEY, PORTONE_API_SECRET, PORTONE_WEBHOOK_SECRET(웹훅 수신 시 필수)
 *
 * - 승인: 포트원 V2 는 브라우저 SDK(requestPayment)에서 결제가 끝나므로, 서버는 결제 단건 조회
 *   GET /payments/{paymentId} 로 status === 'PAID' · amount.total · 주문 일치 여부를 검증한다.
 *   프론트 규칙: requestPayment({ paymentId: checkout.orderId, ... }) — paymentId 를 주문 ID 와 같게 쓴다.
 *   (다르게 쓰려면 customData 에 JSON.stringify({ orderId }) 를 넣어야 한다)
 * - 취소: POST /payments/{paymentId}/cancel
 * - 웹훅: Standard Webhooks 서명(webhook-id / webhook-timestamp / webhook-signature) 검증 후 결제를 재조회한다.
 * 문서: https://developers.portone.io/api/rest-v2
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../../../config/env.js';
import { notConfigured } from '../../../lib/errors.js';
import { GatewayError, type PaymentGateway, type WebhookEvent } from './types.js';

export const PORTONE_ENV_KEYS = ['PORTONE_STORE_ID', 'PORTONE_CHANNEL_KEY', 'PORTONE_API_SECRET'];
export const PORTONE_API_BASE = 'https://api.portone.io';
const TIMEOUT_MS = 10_000;
/** Standard Webhooks 권장 허용 오차 — 재전송 공격(replay) 방지 */
export const WEBHOOK_TOLERANCE_SEC = 5 * 60;
const NETWORK_ERROR_MESSAGE = '결제사와 통신에 실패했어요. 잠시 후 다시 시도해 주세요.';

/** 포트원 V2 Payment 객체 중 사용하는 필드 */
interface PortOnePayment {
  /** READY | PAY_PENDING | VIRTUAL_ACCOUNT_ISSUED | PAID | FAILED | PARTIAL_CANCELLED | CANCELLED */
  status: string;
  id: string;
  transactionId?: string;
  method?: { type?: string; provider?: string } | null;
  amount?: { total?: number; paid?: number; cancelled?: number } | null;
  /** 'KRW' 등 ISO 통화 코드 */
  currency?: string;
  paidAt?: string | null;
  customData?: string | null;
  failure?: { reason?: string | null; pgCode?: string | null; pgMessage?: string | null } | null;
}

const METHOD_LABEL: Record<string, string> = {
  PaymentMethodCard: '카드',
  PaymentMethodEasyPay: '간편결제',
  PaymentMethodTransfer: '계좌이체',
  PaymentMethodVirtualAccount: '가상계좌',
  PaymentMethodMobile: '휴대폰',
  PaymentMethodGiftCertificate: '상품권',
  PaymentMethodConvenienceStore: '편의점',
};

const parseJson = (text: string): unknown => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const header = (headers: Record<string, string | string[] | undefined>, name: string): string | null => {
  const v = headers[name] ?? headers[name.toLowerCase()];
  return str(Array.isArray(v) ? v[0] : v);
};
const toTime = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : Date.now();
};

export function portOneStatusToEvent(status: string): WebhookEvent['status'] {
  if (status === 'PAID') return 'paid';
  if (status === 'CANCELLED' || status === 'PARTIAL_CANCELLED') return 'canceled';
  if (status === 'FAILED') return 'failed';
  return 'other';
}

/** customData 에 넣은 주문 ID (JSON 문자열 { orderId }) */
function customOrderId(customData: string | null | undefined): string | null {
  const parsed = customData ? parseJson(customData) : null;
  return isObject(parsed) ? str(parsed.orderId) : null;
}

function methodLabel(m: PortOnePayment['method']): string | null {
  if (!m?.type) return null;
  const label = METHOD_LABEL[m.type] ?? m.type;
  return m.type === 'PaymentMethodEasyPay' && m.provider ? `${label}(${m.provider})` : label;
}

/**
 * Standard Webhooks 서명 검증 (https://www.standardwebhooks.com)
 * 서명 대상: `${webhook-id}.${webhook-timestamp}.${rawBody}` / 키: 시크릿에서 whsec_ 접두사를 뗀 base64 디코드 값
 * 헤더 형식: "v1,<base64> v1,<base64>" (키 교체 기간에는 여러 개). 통과하면 webhook-id, 아니면 null.
 */
export function verifyStandardWebhook(
  secret: string,
  headers: Record<string, string | string[] | undefined>,
  rawBody: string,
  nowMs = Date.now(),
): string | null {
  const id = header(headers, 'webhook-id');
  const timestamp = header(headers, 'webhook-timestamp');
  const signatures = header(headers, 'webhook-signature');
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return null;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > WEBHOOK_TOLERANCE_SEC) return null;

  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret, 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest();
  for (const part of signatures.split(' ')) {
    const [version, sig] = part.split(',', 2);
    if (version !== 'v1' || !sig) continue;
    const given = Buffer.from(sig, 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return id;
  }
  return null;
}

export function createPortOneGateway(config: AppConfig): PaymentGateway {
  const fail = () => notConfigured('포트원 결제', PORTONE_ENV_KEYS);

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Authorization: `PortOne ${config.PORTONE_API_SECRET ?? ''}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let status: number;
    let text: string;
    try {
      const res = await fetch(`${PORTONE_API_BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
      text = await res.text();
    } catch {
      throw new GatewayError(NETWORK_ERROR_MESSAGE, 'NETWORK_ERROR');
    }
    const data = parseJson(text);
    if (status >= 200 && status < 300) return data as T;
    // 포트원 V2 오류 형식: { type: 'PAYMENT_NOT_FOUND', message: '...' }
    const err = isObject(data) ? data : {};
    throw new GatewayError(str(err.message) ?? `결제사 응답 오류 (HTTP ${status})`, str(err.type) ?? `HTTP_${status}`);
  }

  const storeQuery = () => (config.PORTONE_STORE_ID ? `?storeId=${encodeURIComponent(config.PORTONE_STORE_ID)}` : '');
  const getPayment = (paymentId: string) => request<PortOnePayment>('GET', `/payments/${encodeURIComponent(paymentId)}${storeQuery()}`);

  async function cancelPayment(paymentId: string, reason: string, amount?: number) {
    const body: Record<string, unknown> = { reason: reason.slice(0, 200) };
    if (config.PORTONE_STORE_ID) body.storeId = config.PORTONE_STORE_ID;
    if (amount !== undefined) body.amount = amount;
    try {
      await request('POST', `/payments/${encodeURIComponent(paymentId)}/cancel`, body);
    } catch (e) {
      // 이미 취소된 결제 → 성공으로 간주(전액 취소 재시도 멱등)
      if (e instanceof GatewayError && e.code === 'PAYMENT_ALREADY_CANCELLED') return;
      throw e;
    }
  }

  return {
    id: 'portone',
    envKeys: PORTONE_ENV_KEYS,
    isConfigured: () => config.features.portone,

    async confirm({ orderId, amount, paymentKey }) {
      if (!config.features.portone) throw fail();
      const paymentId = paymentKey || orderId;
      const payment = await getPayment(paymentId);

      // 같은 금액의 다른 주문 결제건(paymentId)을 재사용해 지급받는 것을 막는다
      if (payment.id !== orderId && customOrderId(payment.customData) !== orderId) {
        throw new GatewayError('주문 정보와 결제 정보가 일치하지 않아요.', 'ORDER_MISMATCH');
      }
      if (payment.status === 'FAILED') {
        const f = payment.failure;
        throw new GatewayError(f?.pgMessage || f?.reason || '결제에 실패했어요.', f?.pgCode || 'PAYMENT_FAILED');
      }
      if (payment.status !== 'PAID') {
        throw new GatewayError(`결제가 완료되지 않았어요. (상태: ${payment.status})`, 'PAYMENT_NOT_DONE');
      }
      // 클라이언트가 currency 를 바꿔 결제하는 것 방지 — 원화만 허용
      if (payment.currency && payment.currency !== 'KRW' && payment.currency !== 'CURRENCY_KRW') {
        await cancelPayment(payment.id, '통화 불일치').catch(() => undefined);
        throw new GatewayError('원화(KRW) 결제만 지원해요.', 'CURRENCY_MISMATCH');
      }
      const total = payment.amount?.total;
      if (total !== amount) {
        // 토스와 달리 금액 대조를 결제사가 해 주지 않으므로 여기서 검증하고, 불일치면 즉시 취소한다.
        await cancelPayment(payment.id, '결제 금액 불일치').catch(() => undefined);
        throw new GatewayError('결제 금액이 주문 금액과 달라 결제를 취소했어요.', 'AMOUNT_MISMATCH');
      }
      return { paymentKey: payment.id, method: methodLabel(payment.method), approvedAt: toTime(payment.paidAt), totalAmount: total, raw: payment };
    },

    async cancel({ paymentKey, reason, amount }) {
      if (!config.features.portone) throw fail();
      await cancelPayment(paymentKey, reason, amount);
    },

    /**
     * 웹훅 본문(2024-04-25 버전): { type: 'Transaction.Paid', timestamp, data: { paymentId, transactionId, storeId } }
     * 구버전(2023-08-24): { tx_id, payment_id, status } 도 함께 처리한다.
     */
    async parseWebhook({ headers, rawBody }) {
      const secret = config.PORTONE_WEBHOOK_SECRET;
      if (!secret || !config.features.portone) return null;
      const webhookId = verifyStandardWebhook(secret, headers, rawBody);
      if (!webhookId) return null;
      const body = parseJson(rawBody);
      if (!isObject(body)) return null;
      const data = isObject(body.data) ? body.data : {};
      const type = str(body.type) ?? (str(body.status) ? `Transaction.${String(body.status)}` : 'UNKNOWN');
      const paymentId = str(data.paymentId) ?? str(body.payment_id);
      // 빌링키 발급 등 결제 외 이벤트 — 서명은 유효하므로 기록만 한다
      if (!paymentId) return { id: webhookId, type, orderId: null, paymentKey: null, status: 'other', amount: null, raw: body };

      // 서명이 맞아도 상태는 결제 조회로 확정한다(순서 뒤바뀐 웹훅·재전송 대비). 조회 실패는 throw → 5xx → 포트원 재전송.
      const payment = await getPayment(paymentId);
      return {
        // webhook-id 는 서명에 포함되고 재전송 시에도 같으므로 중복 처리 키로 쓴다
        id: webhookId,
        type,
        orderId: customOrderId(payment.customData) ?? payment.id,
        paymentKey: payment.id,
        status: portOneStatusToEvent(payment.status),
        amount: typeof payment.amount?.total === 'number' ? payment.amount.total : null,
        raw: { ...body, verified: { paymentId: payment.id, status: payment.status, amount: payment.amount ?? null } },
      };
    },
  };
}
