/**
 * 그로블(groble.im) 결제창 게이트웨이 — 사업자 등록 없이 쓰는 링크형 디지털 콘텐츠 결제.
 * 필요한 env: GROBLE_WEBHOOK_SECRET(내 스토어 → 연동), GROBLE_PRODUCT_LINKS(우리 상품 ID → 결제창 링크)
 *
 * PG 와 다른 점
 * - 결제창마다 가격이 그로블에 고정돼 있다 → 우리 상품마다 결제창을 하나씩 만들고 링크를 연결한다.
 * - 승인·취소·조회 API 가 없다 → 결제 확정은 서명된 웹훅(payment.completed)으로만 한다(confirm 미지원),
 *   환불은 그로블 판매자 화면에서 하고 payment.refunded 웹훅으로 지급분을 회수한다(cancel 미지원).
 * - 주문 연결: 결제 링크에 ?ref=<우리 주문 ID> 를 붙이면 payment.completed 의 data.object.sellerReference 로 돌아온다.
 *   payment.refunded 에는 sellerReference 가 없어서 merchantUid(완료 때 providerPaymentKey 로 저장)로 주문을 찾는다.
 *
 * - 여러 서비스가 한 그로블 계정을 같이 쓰면(GROBLE_REF_PREFIX) ref 를 `<접두어>-<주문 ID>` 로 보내고,
 *   다른 접두어의 결제 완료 알림은 foreign 으로 건너뛴다. 환불 알림은 merchantUid 로 우리 주문이 없으면 그냥 넘어간다.
 *
 * 웹훅 서명: HEX(HMAC-SHA256(secret, "{X-Groble-Timestamp}.{raw body}")) 를 X-Groble-Signature 와 비교한다.
 * 시크릿 재발급 뒤 24시간은 X-Groble-Signature-Previous(이전 시크릿 서명)도 함께 오므로 둘 중 하나만 맞으면 된다
 * → 서버의 GROBLE_WEBHOOK_SECRET 을 새 값으로 바꾸기 전·후 모두 검증된다. timestamp 는 ±5분.
 * 문서: https://groble.im/help/guides/webhook · https://groble.im/help/guides/webhook-events · https://groble.im/help/guides/payment-module
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../../../config/env.js';
import { GatewayError, type PaymentGateway, type WebhookEvent } from './types.js';

export const GROBLE_ENV_KEYS = ['GROBLE_WEBHOOK_SECRET', 'GROBLE_PRODUCT_LINKS'];
/** 서명 시각 허용 오차(초) — 그로블 문서 ±5분 */
export const GROBLE_TIMESTAMP_TOLERANCE_SEC = 300;
/** ?ref= 허용 형식 — 어긋나면 그로블이 값을 버려 웹훅에 sellerReference 가 오지 않는다 */
export const GROBLE_REF_PATTERN = /^[A-Za-z0-9\-_.:=~]{1,128}$/;
const CONTENT_ID_PATTERN = /^[A-Za-z0-9\-_]{1,128}$/;

export interface GrobleProductLink {
  /** 결제창 링크 (https://groble.im/payment/<결제창 ID>) */
  url: string;
  /** 웹훅 content.id 와 대조할 값 — 기본은 링크의 결제창 ID */
  contentId: string;
}

/**
 * GROBLE_PRODUCT_LINKS 해석 — `상품ID=링크` 를 콤마로 구분. 링크 대신 결제창 ID 만 써도 된다.
 * 웹훅의 content.id 가 링크의 ID 와 다르면 `상품ID=링크|콘텐츠ID` 로 대조값을 따로 적는다.
 */
export function parseGrobleProductLinks(raw: string | undefined): Map<string, GrobleProductLink> {
  const links = new Map<string, GrobleProductLink>();
  for (const part of (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf('=');
    const productId = eq > 0 ? part.slice(0, eq).trim() : '';
    const [target = '', explicitRef] = part.slice(eq + 1).split('|').map((s) => s.trim());
    const url = grobleCheckoutBase(target);
    const contentId = explicitRef ?? (url ? url.slice(url.lastIndexOf('/') + 1) : '');
    if (!productId || !url || !CONTENT_ID_PATTERN.test(contentId)) {
      throw new Error(`GROBLE_PRODUCT_LINKS 형식 오류: "${part}" — 상품ID=https://groble.im/payment/<결제창 ID> 형식으로 적어 주세요.`);
    }
    links.set(productId, { url, contentId });
  }
  return links;
}

/** 결제 링크 또는 결제창 ID → 쿼리 없는 결제 링크. groble.im 이 아니거나 형식이 틀리면 null */
function grobleCheckoutBase(v: string): string | null {
  if (CONTENT_ID_PATTERN.test(v)) return `https://groble.im/payment/${v}`;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' || !/(^|\.)groble\.im$/i.test(u.hostname)) return null;
    const id = /^\/payment\/([^/]+)\/?$/.exec(u.pathname)?.[1];
    return id && CONTENT_ID_PATTERN.test(id) ? `https://groble.im/payment/${id}` : null;
  } catch {
    return null;
  }
}

const header = (headers: Record<string, string | string[] | undefined>, name: string): string | null => {
  const v = headers[name];
  return typeof v === 'string' ? v : Array.isArray(v) ? (v[0] ?? null) : null;
};

/** 16진수 서명 비교(상수 시간). 'sha256=' 접두어는 허용 */
const sameHex = (given: string, expected: string) => {
  const a = Buffer.from(given.trim().replace(/^sha256=/i, '').toLowerCase(), 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};

/** 그로블 웹훅 서명·시각 검증 — 현재 서명 또는 (시크릿 교체 중) 이전 서명 중 하나가 맞고, timestamp 가 ±5분 이내 */
export function verifyGrobleSignature(secret: string, headers: Record<string, string | string[] | undefined>, rawBody: string, now = Date.now()): boolean {
  const ts = header(headers, 'x-groble-timestamp');
  if (!ts || !/^\d{1,12}$/.test(ts)) return false;
  if (Math.abs(now / 1000 - Number(ts)) > GROBLE_TIMESTAMP_TOLERANCE_SEC) return false;
  const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return [header(headers, 'x-groble-signature'), header(headers, 'x-groble-signature-previous')].some((s) => s !== null && sameHex(s, expected));
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** webhook_events 에 남길 사본 — 구매자 연락처·배송지·설문 답·카드번호는 지운다 */
function redact(body: Record<string, unknown>): Record<string, unknown> {
  const data = isObject(body.data) ? body.data : {};
  const obj = isObject(data.object) ? data.object : {};
  const { buyer, shipping: _shipping, questionAnswers: _answers, paymentMethod, ...rest } = obj;
  const pm = isObject(paymentMethod) ? { type: paymentMethod.type, cardName: paymentMethod.cardName } : undefined;
  return { ...body, data: { ...data, object: { ...rest, buyer: isObject(buyer) ? { type: buyer.type } : undefined, paymentMethod: pm } } };
}

export function createGrobleGateway(config: AppConfig): PaymentGateway {
  const links = parseGrobleProductLinks(config.GROBLE_PRODUCT_LINKS);
  const prefix = config.GROBLE_REF_PREFIX ? `${config.GROBLE_REF_PREFIX}-` : '';
  /** 웹훅 sellerReference → 우리 주문 ID. 접두어를 쓰는데 다른 접두어(또는 없음)면 다른 서비스의 결제 */
  const toOrderId = (ref: string | null): { orderId: string | null; foreign: boolean } => {
    if (!prefix) return { orderId: ref, foreign: false };
    return ref?.startsWith(prefix) ? { orderId: ref.slice(prefix.length), foreign: false } : { orderId: null, foreign: true };
  };
  return {
    id: 'groble',
    envKeys: GROBLE_ENV_KEYS,
    isConfigured: () => Boolean(config.GROBLE_WEBHOOK_SECRET) && links.size > 0,

    async confirm() {
      throw new GatewayError('그로블 결제는 그로블이 보내는 결제 완료 알림(웹훅)으로 확정돼요.', 'WEBHOOK_ONLY');
    },
    async cancel() {
      throw new GatewayError('그로블 결제는 그로블 판매자 화면에서 환불해 주세요. 환불되면 웹훅으로 지급분이 자동 회수돼요.', 'MANUAL_REFUND');
    },

    checkoutUrl(productId, orderId) {
      const link = links.get(productId);
      if (!link) return null;
      const ref = `${prefix}${orderId}`;
      if (!GROBLE_REF_PATTERN.test(ref)) throw new Error(`그로블 ref 로 쓸 수 없는 주문 ID 예요: ${ref}`);
      const u = new URL(link.url);
      u.searchParams.set('ref', ref);
      return u.toString();
    },
    productRef: (productId) => links.get(productId)?.contentId ?? null,

    async parseWebhook({ headers, rawBody }): Promise<WebhookEvent | null> {
      const secret = config.GROBLE_WEBHOOK_SECRET;
      if (!secret || !verifyGrobleSignature(secret, headers, rawBody)) return null;
      const body = parseJson(rawBody);
      if (!isObject(body)) return null;
      const id = str(body.id);
      if (!id) return null;
      const type = str(body.type) ?? 'UNKNOWN';
      const obj = isObject(body.data) && isObject(body.data.object) ? body.data.object : {};
      const merchantUid = str(obj.merchantUid);
      const productRef = isObject(obj.content) ? str(obj.content.id) : null;
      const base = { id, type, paymentKey: merchantUid, productRef, raw: redact(body) };
      const { orderId, foreign } = toOrderId(str(obj.sellerReference));
      if (type === 'payment.completed') {
        const pricing = isObject(obj.pricing) ? obj.pricing : {};
        if (foreign) return { ...base, orderId: null, status: 'other', amount: null, foreign };
        return { ...base, orderId, status: 'paid', amount: num(pricing.finalAmount) };
      }
      if (type === 'payment.refunded') {
        // ref 가 오지 않는 알림 — merchantUid 로 찾고, 우리 주문이 없으면(다른 서비스) 아무것도 하지 않는다
        const refund = isObject(obj.refund) ? obj.refund : {};
        return { ...base, orderId: null, status: 'refunded', amount: num(refund.amount), partial: refund.partialRefund === true };
      }
      // 취소 요청(payment.cancel_requested)·정기결제 이벤트 등 — 판매자가 그로블에서 처리할 일이라 기록만 한다
      return { ...base, orderId, status: 'other', amount: null, foreign };
    },
  };
}
