/**
 * 그로블 결제창 — 결제 링크(?ref=주문 ID), 웹훅 서명(HMAC-SHA256 "{timestamp}.{body}"), 결제 완료로 지급,
 * 금액·결제창 불일치 거부, 환불 웹훅(merchantUid 로 주문 찾기) 회수. 외부 호출 없음.
 */
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { orders, webhookEvents } from '../src/db/schema.js';
import { seedProducts } from '../src/db/seed.js';
import { parseGrobleProductLinks, verifyGrobleSignature } from '../src/modules/commerce/providers/groble.js';

const SECRET = 'groble-test-secret';
const LINKS = 'chat_pack_10=https://groble.im/payment/chat10,report_saju_lifetime=https://groble.im/payment/life99|content-life-99';
const BIRTH = { calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' } as const;

let app: FastifyInstance;
let db: ReturnType<typeof createDb>['db'];

beforeAll(async () => {
  const config = loadConfig({
    __SKIP_ENV_FILE: '1',
    NODE_ENV: 'test',
    PAYMENT_PROVIDER: 'groble',
    GROBLE_WEBHOOK_SECRET: SECRET,
    GROBLE_PRODUCT_LINKS: LINKS,
    ANTHROPIC_API_KEY: '',
    SIGNUP_BONUS_CREDITS: '0',
    ADMIN_API_TOKEN: 'admin-secret',
  });
  ({ db } = createDb(':memory:'));
  runMigrations(db);
  seedProducts(db);
  app = await buildApp({ config, db, logger: false });
});
afterAll(() => app.close());

const api = async (method: 'GET' | 'POST', url: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) },
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null };
};

let seq = 0;
async function member() {
  const r = await api('POST', '/auth/signup', { body: { email: `groble${++seq}@example.com`, password: 'password123' } });
  const token = r.body.accessToken as string;
  const p = await api('POST', '/profiles', { token, body: { name: '본인', relation: 'self', birth: BIRTH } });
  return { token, profileId: p.body.id as string };
}
const order = async (token: string, productId: string, profileId?: string) => (await api('POST', '/orders', { token, body: { productId, profileId } })).body;

const sign = (raw: string, ts: string, secret = SECRET) => createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
const now = () => String(Math.floor(Date.now() / 1000));

/** 그로블이 보내는 것처럼 서명해 웹훅을 보낸다 */
async function send(body: object, opts: { secret?: string; ts?: string; previousOnly?: boolean; tamper?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const ts = opts.ts ?? now();
  const sig = sign(raw, ts, opts.secret);
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-groble-timestamp': ts, 'x-groble-idempotency-key': `idem-${++seq}` };
  if (opts.previousOnly) {
    headers['x-groble-signature'] = '00'.repeat(32);
    headers['x-groble-signature-previous'] = sig;
  } else headers['x-groble-signature'] = sig;
  const res = await app.inject({ method: 'POST', url: '/api/v1/payments/webhooks/groble', headers, payload: opts.tamper ? raw.replace('"KRW"', '"USD"') : raw });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null };
}

const completed = (ref: string | undefined, o: { amount?: number; contentId?: string; merchantUid?: string; id?: string } = {}) => ({
  id: o.id ?? `evt_${++seq}`,
  type: 'payment.completed',
  version: '2026-04-30',
  occurredAt: '2026-10-15T10:00:00+09:00',
  data: {
    object: {
      merchantUid: o.merchantUid ?? `mu_${++seq}`,
      ...(ref ? { sellerReference: ref } : {}),
      buyer: { type: 'GUEST', displayName: '홍길동', email: 'buyer@example.com', phoneNumber: '010-1234-5678' },
      content: { id: o.contentId ?? 'chat10', title: 'AI 상담 질문권 10회', type: 'DOCUMENT', paymentType: 'ONE_TIME', inputMode: 'PAYMENT_WINDOW' },
      options: [],
      pricing: { currency: 'KRW', originalAmount: o.amount ?? 3900, optionDiscountAmount: 0, finalAmount: o.amount ?? 3900, couponDiscountAmount: 0 },
      paymentMethod: { type: 'CARD', cardName: '신한카드', maskedCardNumber: '1234-56**-****-7890' },
      questionAnswers: [{ question: '연락처', questionType: 'TEXT', answer: '010-1234-5678', required: false, displayOrder: 1 }],
      payment: { purchasedAt: '2026-10-15T10:00:00+09:00' },
    },
  },
});
const refunded = (merchantUid: string, o: { partial?: boolean; amount?: number } = {}) => ({
  id: `evt_${++seq}`,
  type: 'payment.refunded',
  version: '2026-04-30',
  occurredAt: '2026-10-16T10:00:00+09:00',
  data: {
    object: {
      merchantUid,
      buyer: { type: 'GUEST', displayName: '홍길동', email: 'buyer@example.com', phoneNumber: '010-1234-5678' },
      content: { id: 'chat10', title: 'AI 상담 질문권 10회', type: 'DOCUMENT', paymentType: 'ONE_TIME', inputMode: 'PAYMENT_WINDOW' },
      options: [],
      pricing: { currency: 'KRW', originalAmount: 3900, optionDiscountAmount: 0, finalAmount: 3900, couponDiscountAmount: 0 },
      refund: { amount: o.amount ?? 3900, currency: 'KRW', partialRefund: o.partial ?? false, cancelledBy: 'SELLER', refundedAt: '2026-10-16T10:00:00+09:00' },
    },
  },
});

const credits = async (token: string) => (await api('GET', '/wallet', { token })).body.credits as number;
const status = async (token: string, id: string) => (await api('GET', `/orders/${id}`, { token })).body.status as string;

describe('GROBLE_PRODUCT_LINKS 해석', () => {
  it('링크·결제창 ID·대조값(|) 형식을 읽는다', () => {
    const m = parseGrobleProductLinks('a=https://groble.im/payment/abc, b=def ,c=https://www.groble.im/payment/ghi/|content-9');
    expect(m.get('a')).toEqual({ url: 'https://groble.im/payment/abc', contentId: 'abc' });
    expect(m.get('b')).toEqual({ url: 'https://groble.im/payment/def', contentId: 'def' });
    expect(m.get('c')).toEqual({ url: 'https://groble.im/payment/ghi', contentId: 'content-9' });
    expect(parseGrobleProductLinks(undefined).size).toBe(0);
  });

  it('그로블이 아닌 주소·형식 오류는 기동 시 바로 알린다', () => {
    expect(() => parseGrobleProductLinks('a=https://evil.example.com/payment/abc')).toThrow(/형식 오류/);
    expect(() => parseGrobleProductLinks('a=http://groble.im/payment/abc')).toThrow(/형식 오류/);
    expect(() => parseGrobleProductLinks('https://groble.im/payment/abc')).toThrow(/형식 오류/);
    expect(() => parseGrobleProductLinks('a=https://groble.im/store/abc')).toThrow(/형식 오류/);
  });
});

describe('그로블 웹훅 서명 (verifyGrobleSignature)', () => {
  const raw = '{"id":"evt_1"}';
  const ts = now();
  const h = (sig: string, t = ts, prev?: string) => ({ 'x-groble-timestamp': t, 'x-groble-signature': sig, ...(prev ? { 'x-groble-signature-previous': prev } : {}) });

  it('현재 시크릿 서명이 맞으면 통과, sha256= 접두어·대문자도 허용', () => {
    expect(verifyGrobleSignature(SECRET, h(sign(raw, ts)), raw)).toBe(true);
    expect(verifyGrobleSignature(SECRET, h(`sha256=${sign(raw, ts).toUpperCase()}`), raw)).toBe(true);
  });

  it('시크릿 교체 중 — 이전 서명 헤더만 맞아도 통과', () => {
    expect(verifyGrobleSignature(SECRET, h(sign(raw, ts, 'new-secret'), ts, sign(raw, ts)), raw)).toBe(true);
  });

  it('다른 시크릿·본문 변조·5분 넘은 시각·헤더 누락은 거부', () => {
    expect(verifyGrobleSignature(SECRET, h(sign(raw, ts, 'wrong')), raw)).toBe(false);
    expect(verifyGrobleSignature(SECRET, h(sign(raw, ts)), '{"id":"evt_2"}')).toBe(false);
    const old = String(Math.floor(Date.now() / 1000) - 301);
    expect(verifyGrobleSignature(SECRET, h(sign(raw, old), old), raw)).toBe(false);
    expect(verifyGrobleSignature(SECRET, { 'x-groble-signature': sign(raw, ts) }, raw)).toBe(false);
    expect(verifyGrobleSignature(SECRET, h('not-hex'), raw)).toBe(false);
  });
});

describe('그로블 결제 흐름', () => {
  it('주문 생성 → 결제창 링크에 ?ref=주문 ID', async () => {
    const { token } = await member();
    const c = await order(token, 'chat_pack_10');
    expect(c.provider).toBe('groble');
    expect(c.checkout.redirectUrl).toBe(`https://groble.im/payment/chat10?ref=${c.order.id}`);
    expect(c.order.id).toMatch(/^[A-Za-z0-9\-_.:=~]{1,128}$/);
  });

  it('결제창이 연결되지 않은 상품은 주문을 만들지 않는다(501)', async () => {
    const { token } = await member();
    const r = await api('POST', '/orders', { token, body: { productId: 'chat_pack_30' } });
    expect(r.status).toBe(501);
    expect((await api('GET', '/orders', { token })).body).toHaveLength(0);
  });

  it('payment.completed → 지급, 같은 알림 재전송·같은 결제의 다른 알림에도 1회만', async () => {
    const { token } = await member();
    const c = await order(token, 'chat_pack_10');
    const evt = completed(c.order.id, { merchantUid: 'mu-dup' });
    const r = await send(evt);
    expect(r.status).toBe(200);
    expect(await status(token, c.order.id)).toBe('paid');
    expect(await credits(token)).toBe(10);

    expect((await send(evt)).body.duplicate).toBe(true);
    await send(completed(c.order.id, { merchantUid: 'mu-dup' }));
    expect(await credits(token)).toBe(10);
    const saved = db.select().from(orders).where(eq(orders.id, c.order.id)).get()!;
    expect(saved.providerPaymentKey).toBe('mu-dup');
  });

  it('webhook_events 에는 구매자 연락처·카드번호·설문 답을 남기지 않는다', async () => {
    const { token } = await member();
    const c = await order(token, 'chat_pack_10');
    const evt = completed(c.order.id);
    await send(evt);
    const row = db.select().from(webhookEvents).where(eq(webhookEvents.id, `groble:${evt.id}`)).get()!;
    const text = JSON.stringify(row.payload);
    expect(text).not.toContain('buyer@example.com');
    expect(text).not.toContain('010-1234-5678');
    expect(text).not.toContain('1234-56**');
    expect(text).toContain('"type":"GUEST"');
  });

  it('서명이 틀리거나 본문이 바뀐 알림은 400, 아무것도 바뀌지 않는다', async () => {
    const { token } = await member();
    const c = await order(token, 'chat_pack_10');
    expect((await send(completed(c.order.id), { secret: 'attacker' })).status).toBe(400);
    expect((await send(completed(c.order.id), { tamper: true })).status).toBe(400);
    expect((await send(completed(c.order.id), { ts: String(Math.floor(Date.now() / 1000) - 600) })).status).toBe(400);
    expect(await status(token, c.order.id)).toBe('pending');
    expect(await credits(token)).toBe(0);
  });

  it('시크릿 교체 중(이전 서명만 맞음)에도 받는다', async () => {
    const { token } = await member();
    const c = await order(token, 'chat_pack_10');
    expect((await send(completed(c.order.id), { previousOnly: true })).status).toBe(200);
    expect(await status(token, c.order.id)).toBe('paid');
  });

  it('결제 금액이 다르면(쿠폰·가격 미동기화) 지급하지 않고 결제 키와 사유를 남긴다', async () => {
    const { token } = await member();
    const c = await order(token, 'chat_pack_10');
    expect((await send(completed(c.order.id, { amount: 1000, merchantUid: 'mu-cheap' }))).status).toBe(200);
    const saved = db.select().from(orders).where(eq(orders.id, c.order.id)).get()!;
    expect(saved.status).toBe('failed');
    expect(saved.failureReason).toContain('WEBHOOK_AMOUNT_MISMATCH');
    expect(saved.providerPaymentKey).toBe('mu-cheap');
    expect(await credits(token)).toBe(0);
  });

  it('다른 결제창(상품)으로 결제한 알림에 이 주문 ref 를 붙여도 지급하지 않는다', async () => {
    const { token } = await member();
    const c = await order(token, 'chat_pack_10');
    await send(completed(c.order.id, { contentId: 'some-other-window' }));
    const saved = db.select().from(orders).where(eq(orders.id, c.order.id)).get()!;
    expect(saved.status).toBe('failed');
    expect(saved.failureReason).toContain('WEBHOOK_PRODUCT_MISMATCH');
  });

  it('대조값(|)을 따로 적은 결제창 — 리포트 상품도 지급된다', async () => {
    const { token, profileId } = await member();
    const c = await order(token, 'report_saju_lifetime', profileId);
    expect(c.checkout.redirectUrl).toBe(`https://groble.im/payment/life99?ref=${c.order.id}`);
    await send(completed(c.order.id, { amount: c.order.amount, contentId: 'content-life-99' }));
    expect(await status(token, c.order.id)).toBe('paid');
  });

  it('ref 없는 결제·모르는 주문은 기록만 하고 200 (그로블이 재전송하지 않게)', async () => {
    expect((await send(completed(undefined))).status).toBe(200);
    expect((await send(completed('ORD-20261015-UNKNOWN000'))).status).toBe(200);
  });

  it('payment.refunded(전액) → merchantUid 로 주문을 찾아 회수, 부분 환불은 기록만', async () => {
    const full = await member();
    const a = await order(full.token, 'chat_pack_10');
    await send(completed(a.order.id, { merchantUid: 'mu-refund-full' }));
    expect(await credits(full.token)).toBe(10);
    expect((await send(refunded('mu-refund-full'))).status).toBe(200);
    expect(await status(full.token, a.order.id)).toBe('refunded');
    expect(await credits(full.token)).toBe(0);

    const part = await member();
    const b = await order(part.token, 'chat_pack_10');
    await send(completed(b.order.id, { merchantUid: 'mu-refund-part' }));
    await send(refunded('mu-refund-part', { partial: true, amount: 1950 }));
    expect(await status(part.token, b.order.id)).toBe('paid');
    expect(await credits(part.token)).toBe(10);
  });

  it('취소 요청(payment.cancel_requested)은 기록만 한다', async () => {
    const { token } = await member();
    const c = await order(token, 'chat_pack_10');
    await send(completed(c.order.id, { merchantUid: 'mu-cancel-req' }));
    const req = completed(c.order.id, { merchantUid: 'mu-cancel-req' });
    expect((await send({ ...req, type: 'payment.cancel_requested' })).status).toBe(200);
    expect(await status(token, c.order.id)).toBe('paid');
  });

  it('관리자 환불 API 는 그로블 판매자 화면으로 안내한다(환불 API 없음)', async () => {
    const { token } = await member();
    const c = await order(token, 'chat_pack_10');
    await send(completed(c.order.id));
    const r = await api('POST', `/admin/orders/${c.order.id}/refund`, { headers: { 'x-admin-token': 'admin-secret' }, body: { reason: '테스트' } });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain('그로블 판매자 화면');
    expect(await status(token, c.order.id)).toBe('paid');
  });
});
