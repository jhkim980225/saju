/**
 * 토스페이먼츠 결제위젯 (v2) 게이트웨이 — 서버는 코어 API v1 으로 승인/취소/조회한다.
 * 필요한 env: TOSS_CLIENT_KEY(프론트 결제위젯), TOSS_SECRET_KEY(서버 승인)
 * TOSS_WEBHOOK_SECRET 은 현재 사용하지 않는다 — 결제 상태 웹훅에는 서명이 없어서 결제 조회 API 재조회로 검증한다.
 *
 * - 승인: POST /v1/payments/confirm — orderId·amount 를 결제 요청 시점 값과 토스 서버가 대조한다.
 * - 취소: POST /v1/payments/{paymentKey}/cancel — Idempotency-Key 로 중복 취소 방지.
 * - 웹훅: 본문은 "어떤 결제가 바뀌었는지" 힌트로만 쓰고, 상태는 GET /v1/payments/{paymentKey} 로 확정한다.
 * 문서: https://docs.tosspayments.com/reference
 */
import { createHash } from 'node:crypto';
import type { AppConfig } from '../../../config/env.js';
import { notConfigured } from '../../../lib/errors.js';
import { GatewayError, type ConfirmResult, type PaymentGateway, type WebhookEvent } from './types.js';

export const TOSS_ENV_KEYS = ['TOSS_CLIENT_KEY', 'TOSS_SECRET_KEY'];
export const TOSS_API_BASE = 'https://api.tosspayments.com';
const TIMEOUT_MS = 10_000;
const NETWORK_ERROR_MESSAGE = '결제사와 통신에 실패했어요. 잠시 후 다시 시도해 주세요.';

/** 토스 Payment 객체 중 사용하는 필드 */
interface TossPayment {
  paymentKey: string;
  orderId: string;
  /** READY | IN_PROGRESS | WAITING_FOR_DEPOSIT | DONE | CANCELED | PARTIAL_CANCELED | ABORTED | EXPIRED */
  status: string;
  totalAmount: number;
  method?: string | null;
  approvedAt?: string | null;
  lastTransactionKey?: string | null;
  /** 가상계좌 웹훅(DEPOSIT_CALLBACK) 검증용 값 */
  secret?: string | null;
  easyPay?: { provider?: string | null } | null;
}

/** 토스 API 오류 — HTTP 상태를 함께 보관한다(웹훅 재조회 404 판별용) */
class TossApiError extends GatewayError {
  constructor(
    message: string,
    code: string,
    public readonly status: number,
  ) {
    super(message, code);
  }
}

const parseJson = (text: string): unknown => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const toTime = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : Date.now();
};

export function tossStatusToEvent(status: string): WebhookEvent['status'] {
  if (status === 'DONE') return 'paid';
  if (status === 'CANCELED' || status === 'PARTIAL_CANCELED') return 'canceled';
  if (status === 'ABORTED' || status === 'EXPIRED') return 'failed';
  return 'other';
}

function toConfirmResult(p: TossPayment): ConfirmResult {
  const method = p.method === '간편결제' && p.easyPay?.provider ? `간편결제(${p.easyPay.provider})` : (p.method ?? null);
  return { paymentKey: p.paymentKey, method, approvedAt: toTime(p.approvedAt), totalAmount: p.totalAmount, raw: p };
}

export function createTossGateway(config: AppConfig): PaymentGateway {
  const fail = () => notConfigured('토스페이먼츠 결제', TOSS_ENV_KEYS);

  async function request<T>(method: 'GET' | 'POST', path: string, opts: { body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
    const headers: Record<string, string> = {
      // Basic 인증: base64("{secretKey}:") — 콜론 뒤 비밀번호는 비운다
      Authorization: `Basic ${Buffer.from(`${config.TOSS_SECRET_KEY ?? ''}:`).toString('base64')}`,
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    let status: number;
    let text: string;
    try {
      const res = await fetch(`${TOSS_API_BASE}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
      text = await res.text();
    } catch {
      // 타임아웃(AbortSignal.timeout) · DNS · 연결 끊김 모두 여기로 온다
      throw new GatewayError(NETWORK_ERROR_MESSAGE, 'NETWORK_ERROR');
    }
    const data = parseJson(text);
    if (status >= 200 && status < 300) return data as T;
    const err = isObject(data) ? data : {};
    throw new TossApiError(str(err.message) ?? `결제사 응답 오류 (HTTP ${status})`, str(err.code) ?? `HTTP_${status}`, status);
  }

  const getPayment = (paymentKey: string) => request<TossPayment>('GET', `/v1/payments/${encodeURIComponent(paymentKey)}`);
  const getPaymentByOrderId = (orderId: string) => request<TossPayment>('GET', `/v1/payments/orders/${encodeURIComponent(orderId)}`);

  async function cancelPayment(paymentKey: string, reason: string, amount?: number) {
    const body: Record<string, unknown> = { cancelReason: reason.slice(0, 200) };
    if (amount !== undefined) body.cancelAmount = amount;
    try {
      // 같은 결제·금액의 취소 재시도는 같은 키 → 토스가 이전 결과를 그대로 돌려준다(이중 취소 방지)
      await request('POST', `/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, {
        body,
        idempotencyKey: `cancel-${sha256(`${paymentKey}:${amount ?? 'ALL'}`)}`,
      });
    } catch (e) {
      if (e instanceof GatewayError && e.code === 'ALREADY_CANCELED_PAYMENT') return;
      throw e;
    }
  }

  return {
    id: 'toss',
    envKeys: TOSS_ENV_KEYS,
    isConfigured: () => config.features.toss,

    async confirm({ orderId, amount, paymentKey }) {
      if (!config.features.toss) throw fail();
      if (!paymentKey) throw new GatewayError('결제 정보(paymentKey)가 없어요. 다시 결제해 주세요.', 'INVALID_REQUEST');

      let payment: TossPayment;
      try {
        payment = await request<TossPayment>('POST', '/v1/payments/confirm', {
          body: { paymentKey, orderId, amount },
          idempotencyKey: `confirm-${sha256(`${orderId}:${paymentKey}`)}`,
        });
      } catch (e) {
        // 응답 유실(타임아웃) 또는 이미 승인된 결제 — 실제로 승인됐는지 조회해서, 승인 완료면 성공으로 처리한다.
        // (돈은 빠져나갔는데 주문은 실패로 남는 상황 방지)
        if (!(e instanceof GatewayError) || (e.code !== 'NETWORK_ERROR' && e.code !== 'ALREADY_PROCESSED_PAYMENT')) throw e;
        const found = await getPayment(paymentKey).catch(() => null);
        if (!found || found.status !== 'DONE' || found.orderId !== orderId) throw e;
        payment = found;
      }

      if (payment.status !== 'DONE') {
        // 가상계좌는 승인 시 WAITING_FOR_DEPOSIT 으로 끝난다. 현재 서비스는 입금 완료 웹훅으로 지급하지 않으므로
        // 발급된 계좌를 바로 취소해 "입금했는데 지급 안 됨"을 막는다. (결제위젯 설정에서 가상계좌를 끄는 것을 권장)
        if (payment.status === 'WAITING_FOR_DEPOSIT') await cancelPayment(payment.paymentKey, '가상계좌 미지원').catch(() => undefined);
        throw new GatewayError(`결제가 완료되지 않았어요. (상태: ${payment.status})`, 'PAYMENT_NOT_DONE');
      }
      return toConfirmResult(payment);
    },

    async cancel({ paymentKey, reason, amount }) {
      if (!config.features.toss) throw fail();
      await cancelPayment(paymentKey, reason, amount);
    },

    /**
     * 토스 웹훅 본문 형식
     * - PAYMENT_STATUS_CHANGED: { eventType, createdAt, data: Payment }
     * - DEPOSIT_CALLBACK(가상계좌): { createdAt, secret, status, transactionKey, orderId }
     * 서명이 없으므로 본문 값은 조회 대상 식별에만 쓰고, 상태·이벤트 ID 는 재조회한 결제로 만든다.
     */
    async parseWebhook({ rawBody }) {
      if (!config.features.toss) return null;
      const body = parseJson(rawBody);
      if (!isObject(body)) return null;
      const data = isObject(body.data) ? body.data : body;
      const type = str(body.eventType) ?? (str(body.transactionKey) && str(body.secret) ? 'DEPOSIT_CALLBACK' : 'UNKNOWN');
      const hintedKey = str(data.paymentKey);
      const hintedOrderId = str(data.orderId);
      if (!hintedKey && !hintedOrderId) return null;

      let payment: TossPayment;
      try {
        payment = hintedKey ? await getPayment(hintedKey) : await getPaymentByOrderId(hintedOrderId!);
      } catch (e) {
        // 존재하지 않는 결제 → 위조/타 상점 웹훅으로 보고 거부. 통신 오류 등은 throw → 5xx → 토스가 재전송한다.
        if (e instanceof TossApiError && e.status === 404) return null;
        throw e;
      }
      if (hintedOrderId && payment.orderId !== hintedOrderId) return null;
      const hintedSecret = str(data.secret);
      if (hintedSecret && payment.secret && hintedSecret !== payment.secret) return null;

      return {
        // 본문 값으로 ID 를 만들면 위조 본문으로 "앞으로 올 이벤트 ID"를 선점해 실제 이벤트를 중복 처리로 막을 수 있다.
        // 그래서 재조회한 결제의 고유값(lastTransactionKey — 승인/취소마다 새로 발급)으로 만든다.
        id: [payment.paymentKey, payment.status, payment.lastTransactionKey ?? payment.approvedAt ?? ''].join(':'),
        type,
        orderId: payment.orderId,
        paymentKey: payment.paymentKey,
        status: tossStatusToEvent(payment.status),
        amount: typeof payment.totalAmount === 'number' ? payment.totalAmount : null,
        raw: {
          eventType: type,
          createdAt: body.createdAt ?? null,
          verified: {
            paymentKey: payment.paymentKey,
            orderId: payment.orderId,
            status: payment.status,
            totalAmount: payment.totalAmount,
            method: payment.method ?? null,
            approvedAt: payment.approvedAt ?? null,
            lastTransactionKey: payment.lastTransactionKey ?? null,
          },
        },
      };
    },
  };
}
