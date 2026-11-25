/**
 * 운영 알림 — 가입·결제 완료·환불·결제 확인 지연·AI 장애·서버 오류·웹훅 검증 실패를 바로 알리고, 하루 요약을 만든다.
 * 알림에는 이메일 같은 개인정보가 들어가지 않는다. 같은 사건이 몰리면 창 하나에 한 번만 보내고 나머지는 'N건 더'로 묶는다.
 *   TEST_D1=1 npx vitest run test/ops-alerts.test.ts
 */
import { createHmac } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../src/app.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations, type Db } from '../src/db/local.js';
import { opsCounters, orders, users } from '../src/db/schema.js';
import { seedProducts } from '../src/db/seed.js';
import { flushBackground } from '../src/lib/alert.js';
import { aiFailureKind } from '../src/modules/ai/service.js';
import { LOGIN_MAX_FAILURES } from '../src/modules/auth/loginThrottle.js';
import { ERROR_ALERT_WINDOW_MS, kstDate, PAYMENT_DELAY_MS, routeOf } from '../src/modules/ops/service.js';

const SECRET = 'groble-ops-secret';
const ALERT_URL = 'https://alerts.example.com/ops';
const BIRTH = { calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' } as const;

let app: App;
let db: Db;
let close: () => Promise<void>;
const alerts: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const config = loadConfig({
    __SKIP_ENV_FILE: '1',
    NODE_ENV: 'test',
    PAYMENT_PROVIDER: 'groble',
    GROBLE_WEBHOOK_SECRET: SECRET,
    GROBLE_PRODUCT_LINKS: 'chat_pack_10=https://groble.im/payment/chat10,report_saju_lifetime=https://groble.im/payment/life99',
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
        alerts.push((JSON.parse(String(init?.body)) as { content: string }).content);
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
beforeEach(async () => {
  await flushBackground();
  alerts.length = 0;
});

const ops = () => app.ctx.services.ops;
/** 응답 뒤에 보내는 알림까지 끝난 뒤의 알림 목록 */
const sent = async () => {
  await flushBackground();
  return [...alerts];
};
const api = async (method: 'GET' | 'POST', url: string, opts: { token?: string; body?: unknown } = {}) => {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null };
};
/** Date.now 를 앞으로 옮겨 실행 */
async function later<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + ms);
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}

let seq = 0;
async function member() {
  const email = `ops${++seq}@example.com`;
  const r = await api('POST', '/auth/signup', { body: { email, password: 'password123' } });
  expect(r.status).toBe(201);
  const token = r.body.accessToken as string;
  const profileId = (await api('POST', '/profiles', { token, body: { name: '본인', relation: 'self', birth: BIRTH } })).body.id as string;
  return { email, token, userId: r.body.user.id as string, profileId };
}
async function sendWebhook(body: object, secret = SECRET) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
  const res = await app.inject({ method: 'POST', url: '/api/v1/payments/webhooks/groble', headers: { 'content-type': 'application/json', 'x-groble-timestamp': ts, 'x-groble-signature': sig }, payload: raw });
  return res.statusCode;
}
const paid = (orderId: string, merchantUid: string, amount = 3900, contentId = 'chat10') =>
  sendWebhook({ id: `evt_ops_${++seq}`, type: 'payment.completed', data: { object: { merchantUid, sellerReference: orderId, content: { id: contentId }, pricing: { currency: 'KRW', finalAmount: amount } } } });
const refunded = (merchantUid: string, id = `evt_ops_${++seq}`) =>
  sendWebhook({ id, type: 'payment.refunded', data: { object: { merchantUid, content: { id: 'chat10' }, refund: { amount: 3900, currency: 'KRW', partialRefund: false } } } });

describe('회원 가입 알림', () => {
  it('이메일로 가입하면 바로 알린다 — 가입 방식과 전체 회원 수만, 이메일은 넣지 않는다', async () => {
    const m = await member();
    const out = (await sent()).filter((a) => a.includes('새 회원'));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/👤 새 회원이 가입했어요 · 이메일 · 전체 회원 \d+명/);
    expect(out[0]).not.toContain(m.email);
    expect(out[0]).not.toMatch(/@/);
    const [row] = await db.select().from(users).where(eq(users.id, m.userId));
    expect(row!.registeredAt).toBeTypeOf('number');
  });

  it('게스트 시작은 알리지 않고, 게스트가 회원으로 전환하면 "게스트에서 전환"으로 알린다', async () => {
    const guest = await api('POST', '/auth/guest', { body: {} });
    expect(guest.status).toBe(200);
    expect((await sent()).filter((a) => a.includes('새 회원'))).toHaveLength(0);
    const [g] = await db.select().from(users).where(eq(users.id, guest.body.user.id));
    expect(g!.registeredAt).toBeNull();

    const r = await api('POST', '/auth/signup', { token: guest.body.accessToken, body: { email: `ops-guest${++seq}@example.com`, password: 'password123' } });
    expect(r.status).toBe(201);
    expect(r.body.user.id).toBe(guest.body.user.id);
    const out = (await sent()).filter((a) => a.includes('새 회원'));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('이메일 (게스트에서 전환)');
  });

  it('같은 이메일로 다시 가입하면(409) 알리지 않는다', async () => {
    const m = await member();
    await sent();
    alerts.length = 0;
    const again = await api('POST', '/auth/signup', { body: { email: m.email, password: 'password123' } });
    expect(again.status).toBe(409);
    expect((await sent()).filter((a) => a.includes('새 회원'))).toHaveLength(0);
  });
});

describe('결제 완료·환불 알림', () => {
  it('결제가 확정되면 상품·금액·결제사·주문 번호로 알리고, 같은 결제 알림이 다시 와도 한 번이다', async () => {
    const m = await member();
    const order = (await api('POST', '/orders', { token: m.token, body: { productId: 'chat_pack_10' } })).body.order;
    alerts.length = 0;
    expect(await paid(order.id, 'mu-ops-paid')).toBe(200);
    expect(await paid(order.id, 'mu-ops-paid')).toBe(200); // 같은 결제의 재전송(이벤트 ID 는 다름)
    const out = (await sent()).filter((a) => a.includes('결제 완료'));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('3,900원');
    expect(out[0]).toContain('웹(그로블)');
    expect(out[0]).toContain(order.id);
    expect(out[0]).not.toMatch(/@/);
  });

  it('결제사에서 환불하면 회수 후 알리고, 같은 환불 알림이 다시 와도 한 번이다', async () => {
    const m = await member();
    const order = (await api('POST', '/orders', { token: m.token, body: { productId: 'chat_pack_10' } })).body.order;
    await paid(order.id, 'mu-ops-refund');
    alerts.length = 0;
    expect(await refunded('mu-ops-refund')).toBe(200);
    expect(await refunded('mu-ops-refund')).toBe(200);
    const out = (await sent()).filter((a) => a.includes('↩️'));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('환불');
    expect(out[0]).toContain('지급분 회수 완료');
    expect(out[0]).toContain(order.id);
  });
});

describe('결제 확인 지연', () => {
  it('결제 확인 화면에 들어온 뒤 30분이 지나도 결제 알림이 없으면 한 번 알린다', async () => {
    const m = await member();
    const order = (await api('POST', '/orders', { token: m.token, body: { productId: 'chat_pack_10' } })).body.order;
    // 결제 확인 화면이 주문을 조회한다(처음 조회 시각을 남긴다)
    expect((await api('GET', `/orders/${order.id}`, { token: m.token })).status).toBe(200);
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect((row!.metadata as { awaitingAt?: number }).awaitingAt).toBeTypeOf('number');
    alerts.length = 0;

    expect(await ops().checkPendingPayments()).toBe(0); // 아직 30분 전
    expect(await later(PAYMENT_DELAY_MS + 60_000, () => ops().checkPendingPayments())).toBeGreaterThanOrEqual(1);
    expect(await later(PAYMENT_DELAY_MS + 120_000, () => ops().checkPendingPayments())).toBe(0); // 주문마다 한 번
    const out = (await sent()).filter((a) => a.includes('결제 확인 지연'));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain(order.id);
  });

  it('결제 확인 화면에 들어오지 않은(결제창을 열기만 한) 주문이나 결제된 주문은 알리지 않는다', async () => {
    const m = await member();
    const open = (await api('POST', '/orders', { token: m.token, body: { productId: 'chat_pack_10' } })).body.order;
    const done = (await api('POST', '/orders', { token: m.token, body: { productId: 'report_saju_lifetime', profileId: m.profileId } })).body.order;
    await api('GET', `/orders/${done.id}`, { token: m.token });
    await paid(done.id, 'mu-ops-delay-paid', done.amount, 'life99');
    alerts.length = 0;
    await later(PAYMENT_DELAY_MS + 60_000, () => ops().checkPendingPayments());
    const out = (await sent()).filter((a) => a.includes('결제 확인 지연'));
    expect(out.join('\n')).not.toContain(open.id);
    expect(out.join('\n')).not.toContain(done.id);
  });
});

describe('웹훅 검증 실패·서버 오류·AI 장애 — 몰리면 묶어서', () => {
  it('서명이 틀린 결제 웹훅은 거절하고 30분 창에 한 번만 알린다', async () => {
    const body = { id: 'evt_forged', type: 'payment.completed', data: { object: { merchantUid: 'mu-forged', sellerReference: 'x', content: { id: 'chat10' }, pricing: { currency: 'KRW', finalAmount: 3900 } } } };
    expect(await sendWebhook(body, 'wrong-secret')).toBe(400);
    expect(await sendWebhook(body, 'wrong-secret')).toBe(400);
    const out = (await sent()).filter((a) => a.includes('웹훅 검증 실패'));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('웹(그로블)');
  });

  it('처리하지 못한 서버 오류는 첫 건만 바로 알리고, 창이 끝나면 나머지를 "N건 더"로 알린다', async () => {
    const profiles = app.ctx.services.profiles;
    const original = profiles.list;
    profiles.list = async () => {
      throw new Error('db exploded');
    };
    try {
      const m = await member();
      for (let i = 0; i < 3; i++) expect((await api('GET', '/profiles', { token: m.token })).status).toBe(500);
    } finally {
      profiles.list = original;
    }
    const first = (await sent()).filter((a) => a.includes('서버 오류'));
    expect(first).toHaveLength(1);
    expect(first[0]).toContain('GET /api/v1/profiles');
    expect(first[0]).toContain('db exploded');

    alerts.length = 0;
    await later(ERROR_ALERT_WINDOW_MS + 1_000, () => ops().flushWindows());
    const more = (await sent()).filter((a) => a.includes('같은 알림'));
    expect(more.some((a) => a.includes('2건 더') && a.includes('서버 오류'))).toBe(true);
  });

  it('주소의 주문 번호·ID 는 :id 로 바꿔 같은 오류로 묶는다', () => {
    expect(routeOf('/api/v1/orders/ORD-20261015-GROBLE0001')).toBe('/api/v1/orders/:id');
    expect(routeOf('/api/v1/profiles')).toBe('/api/v1/profiles');
  });

  it('AI 잔액 부족은 30분 창에 한 번 알린다', async () => {
    ops().aiFailure('credit', 'chat');
    ops().aiFailure('credit', 'dream');
    const out = (await sent()).filter((a) => a.includes('AI 장애'));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('잔액');
    expect(out[0]).toContain('AI 상담');
  });

  it('Anthropic 오류를 알림 종류로 나눈다(요청 내용 탓인 400 은 알리지 않는다)', () => {
    const err = (status: number | undefined, message: string) => Anthropic.APIError.generate(status, { error: { type: 'x', message } }, message, new Headers());
    expect(aiFailureKind(err(400, 'Your credit balance is too low to access the Anthropic API.'))).toBe('credit');
    expect(aiFailureKind(err(400, 'messages: text content blocks must be non-empty'))).toBeNull();
    expect(aiFailureKind(err(401, 'invalid x-api-key'))).toBe('auth');
    expect(aiFailureKind(err(429, 'rate limited'))).toBe('rate');
    expect(aiFailureKind(err(529, 'overloaded'))).toBe('outage');
    expect(aiFailureKind(new Anthropic.APIConnectionError({ message: 'Connection error.' }))).toBe('outage');
    expect(aiFailureKind(new Error('not an API error'))).toBeNull();
  });
});

describe('하루 요약(08:00 KST)', () => {
  it('어제 하루의 가입·매출·환불·이용량·AI 비용·보안 지표를 한 메시지로 보낸다', async () => {
    const DAY = 24 * 3_600_000;
    // 오늘 일어난 일을 만들고, 내일 아침 기준으로 요약한다
    const m = await member();
    const order = (await api('POST', '/orders', { token: m.token, body: { productId: 'chat_pack_10' } })).body.order;
    await paid(order.id, 'mu-ops-summary');
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await api('POST', '/auth/login', { body: { email: m.email, password: 'wrong-password' } });
    ops().aiUsage('dream', 'claude-haiku-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
    ops().aiUsage('chat', 'claude-haiku-5-5', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 });
    await flushBackground();

    const today = kstDate(Date.now());
    const counters = await db.select().from(opsCounters).where(like(opsCounters.key, `d:${today}:%`));
    expect(counters.find((c) => c.key.endsWith(':auth.locked'))?.value).toBeGreaterThanOrEqual(1);

    alerts.length = 0;
    const text = await later(DAY, () => ops().dailySummaryText());
    expect(text).toContain(`📊 어제(${today}) 요약`);
    expect(text).toMatch(/👤 가입 \d+명 \(이메일 \d+/);
    expect(text).toMatch(/💰 결제 \d+건 [\d,]+원/);
    expect(text).toContain('질문권');
    expect(text).toMatch(/AI 꿈풀이 1회/);
    // 하이쿠 5.5: 입력 100만 $0.10 + 출력 100만 $0.50 + 캐시 읽기 100만 $0.01 = $0.61
    expect(text).toContain('AI 호출 2회');
    expect(text).toContain('($0.61)');
    expect(text).toMatch(/로그인 잠금 [1-9]\d*회/);
    expect(text).not.toMatch(/@/);

    await later(DAY, () => ops().sendDailySummary());
    expect((await sent()).some((a) => a.includes('📊 어제'))).toBe(true);
  });

  it('오래된 하루 집계는 지운다', async () => {
    await ops().cleanup(); // 지울 것이 없어도 오류 없이 끝난다
    await later(41 * 24 * 3_600_000, () => ops().cleanup());
    expect(await db.select().from(opsCounters).where(like(opsCounters.key, 'd:%'))).toHaveLength(0);
  });
});
