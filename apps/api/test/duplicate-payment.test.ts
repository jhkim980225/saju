/**
 * 중복 결제 막기 — 그로블은 같은 ref 로 두 번 결제하는 것을 막지 못한다(ref 는 멱등 키가 아니고, 결제·환불 API 가 없다).
 * 그래서 결제창으로 보내기 전에 막고(진행 중인 결제·이미 가진 콘텐츠), 그래도 생긴 중복 결제는 질문권 팩이면 지급하고
 * 나머지는 지급하지 않고 기록·운영 알림을 보낸다. AI 상담·꿈풀이는 요청 ID 로 같은 요청을 한 번만 차감한다.
 *   TEST_D1=1 npx vitest run test/duplicate-payment.test.ts
 */
import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../src/app.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations, type Db } from '../src/db/local.js';
import { creditLedger, orders, webhookEvents } from '../src/db/schema.js';
import { seedProducts } from '../src/db/seed.js';
import { CHECKOUT_RESUME_WINDOW_MS } from '../src/modules/commerce/service.js';

const SECRET = 'groble-dup-secret';
const ALERT_URL = 'https://alerts.example.com/hook';
const BIRTH = { calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' } as const;

let app: App;
let db: Db;
let close: () => Promise<void>;
/** 운영 알림으로 나간 글 */
const allAlerts: string[] = [];
/** 이 파일이 확인하는 '환불 필요' 알림만 — 가입·결제 완료 알림은 test/ops-alerts.test.ts 가 확인한다 */
const refundAlerts = () => allAlerts.filter((a) => a.includes('환불 필요') || a.includes('금액'));
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const config = loadConfig({
    __SKIP_ENV_FILE: '1',
    NODE_ENV: 'test',
    PAYMENT_PROVIDER: 'groble',
    GROBLE_WEBHOOK_SECRET: SECRET,
    GROBLE_PRODUCT_LINKS: 'chat_pack_10=https://groble.im/payment/chat10,report_saju_lifetime=https://groble.im/payment/life99',
    ANTHROPIC_API_KEY: 'sk-ant-test-not-real',
    SIGNUP_BONUS_CREDITS: '0',
    OPS_ALERT_WEBHOOK_URL: ALERT_URL,
  });
  ({ db, close } = createDb(':memory:'));
  await runMigrations(db);
  await seedProducts(db);
  app = await buildApp({ config, db });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith(ALERT_URL)) {
        allAlerts.push((JSON.parse(String(init?.body)) as { content: string }).content);
        return new Response(null, { status: 204 });
      }
      return realFetch(input, init);
    }),
  );
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await app.close();
  await close();
});
beforeEach(() => {
  allAlerts.length = 0;
});

const api = async (method: 'GET' | 'POST', url: string, opts: { token?: string; body?: unknown } = {}) => {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null };
};

let seq = 0;
async function member() {
  const r = await api('POST', '/auth/signup', { body: { email: `dup${++seq}@example.com`, password: 'password123' } });
  expect(r.status).toBe(201);
  const token = r.body.accessToken as string;
  const profile = async (name: string) => (await api('POST', '/profiles', { token, body: { name, relation: 'self', birth: BIRTH } })).body.id as string;
  return { token, userId: r.body.user.id as string, profileId: await profile('본인'), otherProfileId: await profile('동생') };
}
const createOrder = (token: string, body: Record<string, unknown>) => api('POST', '/orders', { token, body });
const credits = async (token: string) => (await api('GET', '/wallet', { token })).body.credits as number;
const orderRow = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!;
/** Date.now 를 앞으로 옮겨 실행 — 주문 생성 시각(DB 시계)보다 나중인 것처럼 */
async function later<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + ms);
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}

async function send(body: object) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex');
  const res = await app.inject({ method: 'POST', url: '/api/v1/payments/webhooks/groble', headers: { 'content-type': 'application/json', 'x-groble-timestamp': ts, 'x-groble-signature': sig }, payload: raw });
  expect(res.statusCode).toBe(200);
}
const paid = (orderId: string, merchantUid: string, o: { amount?: number; contentId?: string } = {}) =>
  send({ id: `evt_${++seq}`, type: 'payment.completed', data: { object: { merchantUid, sellerReference: orderId, content: { id: o.contentId ?? 'chat10' }, pricing: { currency: 'KRW', finalAmount: o.amount ?? 3900 } } } });
const refunded = (merchantUid: string) =>
  send({ id: `evt_${++seq}`, type: 'payment.refunded', data: { object: { merchantUid, content: { id: 'chat10' }, refund: { amount: 3900, currency: 'KRW', partialRefund: false } } } });
const duplicates = async (merchantUid: string) => db.select().from(webhookEvents).where(eq(webhookEvents.id, `groble:duplicate:${merchantUid}`));

describe('결제창으로 보내기 전에 막기 — 진행 중인 결제', () => {
  it('같은 상품을 30분 안에 다시 사려 하면 새 주문 대신 409 PAYMENT_IN_PROGRESS(진행 중인 주문 ID)', async () => {
    const m = await member();
    const first = await createOrder(m.token, { productId: 'chat_pack_10' });
    expect(first.status).toBe(201);
    const again = await createOrder(m.token, { productId: 'chat_pack_10' });
    expect(again.status).toBe(409);
    expect(again.body.error.details).toMatchObject({ reason: 'PAYMENT_IN_PROGRESS', orderId: first.body.order.id, amount: 3900, productId: 'chat_pack_10' });
    expect(await db.select().from(orders).where(eq(orders.userId, m.userId))).toHaveLength(1);
  });

  it('"결제하지 않았어요"로 이어서 결제하면 같은 주문·같은 ref 로 결제창을 다시 연다', async () => {
    const m = await member();
    const first = await createOrder(m.token, { productId: 'chat_pack_10' });
    const resumed = await createOrder(m.token, { productId: 'chat_pack_10', resumeOrderId: first.body.order.id });
    expect(resumed.status).toBe(201);
    expect(resumed.body.order.id).toBe(first.body.order.id);
    expect(resumed.body.checkout.redirectUrl).toBe(first.body.checkout.redirectUrl);
    expect(await db.select().from(orders).where(eq(orders.userId, m.userId))).toHaveLength(1);
  });

  it('남의 주문 ID 로는 이어서 결제할 수 없다(진행 중 안내만)', async () => {
    const a = await member();
    const b = await member();
    const ao = await createOrder(a.token, { productId: 'chat_pack_10' });
    await createOrder(b.token, { productId: 'chat_pack_10' });
    const r = await createOrder(b.token, { productId: 'chat_pack_10', resumeOrderId: ao.body.order.id });
    expect(r.status).toBe(409);
    expect(r.body.error.details.orderId).not.toBe(ao.body.order.id);
  });

  it('대상이 다르면(다른 사주의 리포트) 따로 결제할 수 있다', async () => {
    const m = await member();
    expect((await createOrder(m.token, { productId: 'report_saju_lifetime', profileId: m.profileId })).status).toBe(201);
    expect((await createOrder(m.token, { productId: 'report_saju_lifetime', profileId: m.otherProfileId })).status).toBe(201);
    expect((await createOrder(m.token, { productId: 'report_saju_lifetime', profileId: m.profileId })).status).toBe(409);
  });

  it('30분이 지나면 새 주문을 만든다', async () => {
    const m = await member();
    await createOrder(m.token, { productId: 'chat_pack_10' });
    const r = await later(CHECKOUT_RESUME_WINDOW_MS + 60_000, () => createOrder(m.token, { productId: 'chat_pack_10' }));
    expect(r.status).toBe(201);
  });

  it('결제가 확인된 뒤에는 질문권 팩을 또 살 수 있고, 확인된 주문으로 이어서 결제하려 하면 409 ALREADY_PAID', async () => {
    const m = await member();
    const first = await createOrder(m.token, { productId: 'chat_pack_10' });
    await paid(first.body.order.id, `mu-paid-${seq}`);
    expect((await createOrder(m.token, { productId: 'chat_pack_10', resumeOrderId: first.body.order.id })).body.error.details.reason).toBe('ALREADY_PAID');
    expect((await createOrder(m.token, { productId: 'chat_pack_10' })).status).toBe(201);
  });

  it('두 탭에서 동시에 눌러도 결제창으로 가는 주문은 하나', async () => {
    const m = await member();
    const rs = await Promise.all(Array.from({ length: 3 }, () => createOrder(m.token, { productId: 'chat_pack_10' })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(2);
    const pending = await db.select().from(orders).where(and(eq(orders.userId, m.userId), eq(orders.status, 'pending')));
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe(rs.find((r) => r.status === 201)!.body.order.id);
  });
});

describe('결제창으로 보내기 전에 막기 — 이미 가진 콘텐츠', () => {
  it('이미 산 리포트는 같은 사주로 다시 주문할 수 없다(409 ALREADY_OWNED), 다른 사주는 살 수 있다', async () => {
    const m = await member();
    const o = await createOrder(m.token, { productId: 'report_saju_lifetime', profileId: m.profileId });
    await paid(o.body.order.id, `mu-owned-${seq}`, { amount: o.body.order.amount, contentId: 'life99' });
    const again = await createOrder(m.token, { productId: 'report_saju_lifetime', profileId: m.profileId });
    expect(again.status).toBe(409);
    expect(again.body.error.details.reason).toBe('ALREADY_OWNED');
    expect((await createOrder(m.token, { productId: 'report_saju_lifetime', profileId: m.otherProfileId })).status).toBe(201);
  });
});

describe('그래도 생긴 중복 결제', () => {
  it('질문권 팩을 같은 결제창(같은 ref)으로 한 번 더 결제하면 — 환불 대신 새 주문으로 지급, 같은 알림이 다시 와도 한 번', async () => {
    const m = await member();
    const o = await createOrder(m.token, { productId: 'chat_pack_10' });
    const second = `mu-again-${seq}`;
    await paid(o.body.order.id, `mu-once-${seq}`);
    await Promise.all([paid(o.body.order.id, second), paid(o.body.order.id, second)]);
    expect(await credits(m.token)).toBe(20);
    const mine = await db.select().from(orders).where(eq(orders.userId, m.userId));
    expect(mine.filter((x) => x.status === 'paid')).toHaveLength(2);
    expect(mine.find((x) => x.providerPaymentKey === second)?.metadata).toMatchObject({ repeatOf: o.body.order.id });
    expect(await duplicates(second)).toHaveLength(0);
    expect(refundAlerts()).toHaveLength(0);
    // 두 번째 결제를 환불하면 그 몫만 회수한다
    await refunded(second);
    expect(await credits(m.token)).toBe(10);
    expect((await orderRow(o.body.order.id)).status).toBe('paid');
  });

  it('리포트를 같은 결제창으로 한 번 더 결제하면 — 지급하지 않고 환불할 결제로 기록 + 운영 알림(한 번)', async () => {
    const m = await member();
    const o = await createOrder(m.token, { productId: 'report_saju_lifetime', profileId: m.profileId });
    const amount = o.body.order.amount as number;
    const second = `mu-report-again-${seq}`;
    await paid(o.body.order.id, `mu-report-once-${seq}`, { amount, contentId: 'life99' });
    await paid(o.body.order.id, second, { amount, contentId: 'life99' });
    await paid(o.body.order.id, second, { amount, contentId: 'life99' });
    const [dup] = await duplicates(second);
    expect(dup?.payload).toMatchObject({ orderId: o.body.order.id, reason: 'DUPLICATE_PAYMENT', amount });
    expect(refundAlerts()).toHaveLength(1);
    expect(refundAlerts()[0]).toContain('환불 필요');
    expect(refundAlerts()[0]).toContain(second);
    expect(refundAlerts()[0]).not.toMatch(/@/); // 이메일 같은 개인정보는 넣지 않는다
    const wallet = (await api('GET', '/wallet', { token: m.token })).body;
    expect(wallet.entitlements).toHaveLength(1);
  });

  it('같은 리포트를 두 주문으로 각각 결제하면(30분 뒤 다시 주문) — 두 번째는 지급하지 않고 실패(ALREADY_OWNED)로 닫고 알림', async () => {
    const m = await member();
    const a = await createOrder(m.token, { productId: 'report_saju_lifetime', profileId: m.profileId });
    const b = await later(CHECKOUT_RESUME_WINDOW_MS + 60_000, () => createOrder(m.token, { productId: 'report_saju_lifetime', profileId: m.profileId }));
    expect(b.status).toBe(201);
    const amount = a.body.order.amount as number;
    await paid(a.body.order.id, `mu-a-${seq}`, { amount, contentId: 'life99' });
    const keyB = `mu-b-${seq}`;
    await paid(b.body.order.id, keyB, { amount, contentId: 'life99' });
    const rowB = await orderRow(b.body.order.id);
    expect(rowB.status).toBe('failed');
    expect(rowB.failureReason).toBe('ALREADY_OWNED');
    expect(rowB.providerPaymentKey).toBe(keyB);
    expect((await duplicates(keyB))[0]?.payload).toMatchObject({ reason: 'ALREADY_OWNED' });
    expect(refundAlerts()).toHaveLength(1);
  });

  it('금액이 다른 결제는 지급하지 않고 운영 알림', async () => {
    const m = await member();
    const o = await createOrder(m.token, { productId: 'chat_pack_10' });
    await paid(o.body.order.id, `mu-cheap-${seq}`, { amount: 100 });
    expect((await orderRow(o.body.order.id)).status).toBe('failed');
    expect(refundAlerts().some((a) => a.includes('금액'))).toBe(true);
  });
});

describe('AI 상담·꿈풀이 — 같은 요청 ID 는 한 번만 차감', () => {
  let chatCalls = 0;
  let dreamCalls = 0;
  beforeAll(() => {
    app.ctx.services.ai.chat = async () => {
      chatCalls++;
      await new Promise((r) => setTimeout(r, 20));
      return { text: '하반기에 움직이는 편이 낫습니다.', generator: 'ai' as const };
    };
    app.ctx.services.ai.dreamInterpret = async () => {
      dreamCalls++;
      return { headline: '새로운 기회', paragraphs: ['뱀은 재물과 기회를 뜻하는 상징으로 봅니다.'] };
    };
  });
  const funded = async (n: number) => {
    const m = await member();
    await app.ctx.services.commerce.grantFreeCredits(m.userId, n, '테스트 지급');
    return m;
  };
  const consumes = async (userId: string) => (await db.select().from(creditLedger).where(and(eq(creditLedger.userId, userId), eq(creditLedger.reason, 'consume')))).length;

  it('상담 — 같은 요청 ID 로 다시 보내면 차감 없이 처음 답을 돌려준다', async () => {
    const m = await funded(3);
    const body = { profileId: m.profileId, message: '올해 이직해도 될까요?', requestId: `req-chat-${seq}-0001` };
    const before = chatCalls;
    const r1 = await api('POST', '/chat', { token: m.token, body });
    const r2 = await api('POST', '/chat', { token: m.token, body });
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r2.body.reply.id).toBe(r1.body.reply.id);
    expect(r2.body.creditsLeft).toBe(2);
    expect(chatCalls - before).toBe(1);
    expect(await consumes(m.userId)).toBe(1);
    expect((await api('GET', `/chat?profileId=${m.profileId}`, { token: m.token })).body).toHaveLength(2);
  });

  it('상담 — 같은 요청이 동시에 오면 하나만 처리하고 나머지는 409(처리 중)', async () => {
    const m = await funded(3);
    const body = { profileId: m.profileId, message: '연애운이 궁금해요', requestId: `req-chat-${seq}-0002` };
    const rs = await Promise.all([0, 1, 2].map(() => api('POST', '/chat', { token: m.token, body })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(2);
    expect(await consumes(m.userId)).toBe(1);
    expect(await credits(m.token)).toBe(2);
  });

  it('상담 — 요청 ID 가 다르면 각각 차감한다, 질문권이 모자라 실패한 요청 ID 는 다시 쓸 수 있다', async () => {
    const m = await funded(1);
    expect((await api('POST', '/chat', { token: m.token, body: { profileId: m.profileId, message: '하나', requestId: `req-a-${seq}-0001` } })).status).toBe(200);
    const id = `req-b-${seq}-0001`;
    expect((await api('POST', '/chat', { token: m.token, body: { profileId: m.profileId, message: '둘', requestId: id } })).status).toBe(402);
    await app.ctx.services.commerce.grantFreeCredits(m.userId, 1, '테스트 지급');
    expect((await api('POST', '/chat', { token: m.token, body: { profileId: m.profileId, message: '둘', requestId: id } })).status).toBe(200);
    expect(await consumes(m.userId)).toBe(2);
  });

  it('상담 — 다른 사용자가 같은 요청 ID 를 써도 서로 영향이 없다', async () => {
    const a = await funded(1);
    const b = await funded(1);
    const requestId = `req-shared-${seq}-0001`;
    const ra = await api('POST', '/chat', { token: a.token, body: { profileId: a.profileId, message: '가', requestId } });
    const rb = await api('POST', '/chat', { token: b.token, body: { profileId: b.profileId, message: '나', requestId } });
    expect([ra.status, rb.status]).toEqual([200, 200]);
    expect(rb.body.reply.id).not.toBe(ra.body.reply.id);
  });

  it('꿈풀이 — 같은 요청 ID 로 다시 보내면 차감·AI 호출 없이 기본 풀이를 돌려주고, 선점 기록에는 풀이를 남기지 않는다', async () => {
    const m = await funded(3);
    const body = { text: '큰 뱀이 집 안으로 들어왔어요', requestId: `req-dream-${seq}-0001` };
    const before = dreamCalls;
    const r1 = await api('POST', '/dream/interpret', { token: m.token, body });
    const r2 = await api('POST', '/dream/interpret', { token: m.token, body });
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r2.body).toMatchObject({ generator: 'rule', creditsCharged: r1.body.creditsCharged, creditsLeft: 2, profileName: null });
    expect(r2.body.symbols.map((s: any) => s.slug)).toEqual(r1.body.symbols.map((s: any) => s.slug));
    expect(dreamCalls - before).toBe(1);
    expect(await consumes(m.userId)).toBe(1);
    // 꿈 이야기·풀이 문단·상징은 저장하지 않는다 — 생성 방식과 차감 수만
    const [claim] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, `dream:${m.userId}:${body.requestId}`));
    expect(claim!.payload).toEqual({ generator: r1.body.generator, creditsCharged: r1.body.creditsCharged });
  });

  it('요청 ID 형식이 틀리면 400', async () => {
    const m = await funded(1);
    expect((await api('POST', '/chat', { token: m.token, body: { profileId: m.profileId, message: '가', requestId: 'x' } })).status).toBe(400);
    expect((await api('POST', '/dream/interpret', { token: m.token, body: { text: '큰 뱀이 집 안으로 들어왔어요', requestId: '../../etc' } })).status).toBe(400);
  });
});
