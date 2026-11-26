/**
 * 멱등성 — 같은 요청·알림이 두 번(재전송·두 번 누름·두 탭·응답 유실 뒤 재시도) 들어와도 돈·질문권·권한·세션이 한 번만 바뀌는지.
 * 동시에 들어오는 경우는 Promise.all 로 겹쳐 보낸다. 기본은 인메모리 SQLite, TEST_D1=1 이면 진짜 D1(Miniflare)로 돈다.
 *   TEST_D1=1 npx vitest run test/idempotency.test.ts
 */
import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations, type Db } from '../src/db/local.js';
import { creditLedger, orders, users, webhookEvents } from '../src/db/schema.js';
import { seedProducts } from '../src/db/seed.js';

const SECRET = 'groble-idem-secret';
const BONUS = 3;
const BIRTH = { calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' } as const;

let app: App;
let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  const config = loadConfig({
    __SKIP_ENV_FILE: '1',
    NODE_ENV: 'test',
    PAYMENT_PROVIDER: 'groble',
    GROBLE_WEBHOOK_SECRET: SECRET,
    GROBLE_PRODUCT_LINKS: 'chat_pack_10=https://groble.im/payment/chat10,report_saju_lifetime=https://groble.im/payment/life99',
    ANTHROPIC_API_KEY: '',
    SIGNUP_BONUS_CREDITS: String(BONUS),
  });
  ({ db, close } = createDb(':memory:'));
  await runMigrations(db);
  await seedProducts(db);
  app = await buildApp({ config, db });
});
afterAll(async () => {
  await app.close();
  await close();
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
const statuses = (rs: Array<{ status: number }>) => rs.map((r) => r.status).sort();

let seq = 0;
async function member() {
  const r = await api('POST', '/auth/signup', { body: { email: `idem${++seq}@example.com`, password: 'password123' } });
  expect(r.status).toBe(201);
  const token = r.body.accessToken as string;
  const p = await api('POST', '/profiles', { token, body: { name: '본인', relation: 'self', birth: BIRTH } });
  return { token, userId: r.body.user.id as string, refreshToken: r.body.refreshToken as string, profileId: p.body.id as string };
}
const order = async (token: string, productId: string, profileId?: string) => (await api('POST', '/orders', { token, body: { productId, profileId } })).body.order as { id: string; amount: number };
const credits = async (token: string) => (await api('GET', '/wallet', { token })).body.credits as number;
const orderRow = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!;
const ledger = async (userId: string, reason: string) => db.select().from(creditLedger).where(and(eq(creditLedger.userId, userId), eq(creditLedger.reason, reason)));

/** 그로블이 보내는 것처럼 서명한 웹훅 */
async function send(body: object) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex');
  const res = await app.inject({ method: 'POST', url: '/api/v1/payments/webhooks/groble', headers: { 'content-type': 'application/json', 'x-groble-timestamp': ts, 'x-groble-signature': sig }, payload: raw });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null };
}
const completed = (ref: string, merchantUid: string, o: { id?: string; amount?: number; contentId?: string } = {}) => ({
  id: o.id ?? `evt_${++seq}`,
  type: 'payment.completed',
  data: { object: { merchantUid, sellerReference: ref, content: { id: o.contentId ?? 'chat10' }, pricing: { currency: 'KRW', finalAmount: o.amount ?? 3900 } } },
});
const refunded = (merchantUid: string, o: { id?: string } = {}) => ({
  id: o.id ?? `evt_${++seq}`,
  type: 'payment.refunded',
  data: { object: { merchantUid, content: { id: 'chat10' }, refund: { amount: 3900, currency: 'KRW', partialRefund: false } } },
});

describe('결제 웹훅 — 같은 알림이 여러 번 와도 지급·회수는 한 번', () => {
  it('같은 알림(같은 이벤트 ID) 5개가 동시에 와도 질문권은 한 번만 지급하고 원장도 한 줄', async () => {
    const m = await member();
    const o = await order(m.token, 'chat_pack_10');
    const evt = completed(o.id, `mu-same-${seq}`);
    const rs = await Promise.all(Array.from({ length: 5 }, () => send(evt)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(await credits(m.token)).toBe(BONUS + 10);
    expect(await ledger(m.userId, 'purchase')).toHaveLength(1);
    expect((await orderRow(o.id)).status).toBe('paid');
  });

  it('같은 결제의 알림이 이벤트 ID 만 다르게 동시에 와도(그로블 재발송) 한 번만 지급', async () => {
    const m = await member();
    const o = await order(m.token, 'chat_pack_10');
    const key = `mu-resend-${seq}`;
    await Promise.all(Array.from({ length: 4 }, () => send(completed(o.id, key))));
    expect(await credits(m.token)).toBe(BONUS + 10);
    expect(await ledger(m.userId, 'purchase')).toHaveLength(1);
  });

  it('환불 알림이 두 번(다른 이벤트 ID, 동시) 와도 회수는 한 번', async () => {
    const m = await member();
    const o = await order(m.token, 'chat_pack_10');
    const key = `mu-refund-twice-${seq}`;
    await send(completed(o.id, key));
    await Promise.all([send(refunded(key)), send(refunded(key)), send(refunded(key))]);
    expect((await orderRow(o.id)).status).toBe('refunded');
    expect(await credits(m.token)).toBe(BONUS);
    expect(await ledger(m.userId, 'refund')).toHaveLength(1);
  });

  it('결제 완료와 환불 알림이 동시에 와도 최종 결과는 "지급 없음" — 질문권·권한이 남지 않는다', async () => {
    for (let i = 0; i < 6; i++) {
      const m = await member();
      const o = await order(m.token, 'chat_pack_10');
      const key = `mu-race-${seq}`;
      // 순서를 바꿔 가며 겹쳐 보낸다
      await Promise.all(i % 2 === 0 ? [send(completed(o.id, key)), send(refunded(key))] : [send(refunded(key)), send(completed(o.id, key))]);
      const row = await orderRow(o.id);
      expect(row.status).toBe('refunded');
      expect(await credits(m.token)).toBe(BONUS);
      const wallet = (await api('GET', '/wallet', { token: m.token })).body;
      expect(wallet.entitlements).toEqual([]);
    }
  });

  it('이미 지급된 리포트 주문에 같은 결제창 링크로 한 번 더 결제하면 — 두 번 지급하지 않고 환불할 결제로 남긴다', async () => {
    const m = await member();
    const o = await order(m.token, 'report_saju_lifetime', m.profileId);
    const first = `mu-first-${seq}`;
    const second = `mu-second-${seq}`;
    await send(completed(o.id, first, { amount: o.amount, contentId: 'life99' }));
    expect((await send(completed(o.id, second, { amount: o.amount, contentId: 'life99' }))).status).toBe(200);
    expect((await orderRow(o.id)).providerPaymentKey).toBe(first);
    const [dup] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, `groble:duplicate:${second}`));
    expect(dup?.eventType).toBe('DUPLICATE_PAYMENT');
    expect((dup?.payload as { orderId?: string }).orderId).toBe(o.id);
    // 두 번째 결제를 환불해도 첫 결제의 지급분은 그대로다
    await send(refunded(second));
    expect((await orderRow(o.id)).status).toBe('paid');
    expect((await api('GET', '/wallet', { token: m.token })).body.entitlements).toHaveLength(1);
  });

  it('지급된 주문에 금액이 다른 알림이 와도 주문을 실패로 덮어쓰지 않는다', async () => {
    const m = await member();
    const o = await order(m.token, 'chat_pack_10');
    await send(completed(o.id, `mu-ok-${seq}`));
    await send(completed(o.id, `mu-cheap-${seq}`, { amount: 100 }));
    const row = await orderRow(o.id);
    expect(row.status).toBe('paid');
    expect(row.failureReason).toBeNull();
    expect(await credits(m.token)).toBe(BONUS + 10);
  });

  it('리포트 상품 — 같은 결제 알림이 동시에 와도 권한·저장된 리포트는 하나', async () => {
    const m = await member();
    const o = await order(m.token, 'report_saju_lifetime', m.profileId);
    const evt = completed(o.id, `mu-report-${seq}`, { amount: o.amount, contentId: 'life99' });
    await Promise.all([send(evt), send({ ...evt, id: `evt_${++seq}` }), send(evt)]);
    const wallet = (await api('GET', '/wallet', { token: m.token })).body;
    expect(wallet.entitlements.map((e: { key: string }) => e.key)).toEqual([`report:lifetime:${m.profileId}`]);
    const reports = (await api('GET', '/reports', { token: m.token })).body as unknown[];
    expect(reports).toHaveLength(1);
  });
});

describe('가입·로그인 — 두 번 누름·두 탭', () => {
  it('게스트에서 가입을 동시에 두 번 보내도 계정은 하나, 가입 보너스도 한 번', async () => {
    const g = await api('POST', '/auth/guest', { body: { deviceId: `idem-device-signup-${seq}` } });
    const email = `idem-guest-${++seq}@example.com`;
    const rs = await Promise.all([0, 1].map(() => api('POST', '/auth/signup', { token: g.body.accessToken, body: { email, password: 'password123' } })));
    expect(statuses(rs)).toEqual([201, 409]);
    const ok = rs.find((r) => r.status === 201)!;
    expect(ok.body.user.id).toBe(g.body.user.id);
    expect(await credits(ok.body.accessToken)).toBe(BONUS);
    expect(await ledger(g.body.user.id, 'bonus')).toHaveLength(1);
  });

  it('게스트로 기존 계정에 동시에 세 번 로그인해도 게스트 질문권은 한 번만 옮겨진다', async () => {
    const m = await member();
    const g = await api('POST', '/auth/guest', { body: { deviceId: `idem-device-merge-${seq}` } });
    const guestId = g.body.user.id as string;
    await app.ctx.services.commerce.grantFreeCredits(guestId, 2, '테스트 무상 지급');
    const email = (await api('GET', '/auth/me', { token: m.token })).body.email as string;
    const rs = await Promise.all(Array.from({ length: 3 }, () => api('POST', '/auth/login', { token: g.body.accessToken, body: { email, password: 'password123' } })));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(await credits(m.token)).toBe(BONUS + 2);
    const [guest] = await db.select().from(users).where(eq(users.id, guestId));
    expect(guest!.credits).toBe(0);
    expect(guest!.deletedAt).not.toBeNull();
    expect((await ledger(m.userId, 'admin')).filter((l) => l.memo === '게스트로 받은 질문권 이동')).toHaveLength(1);
    // 게스트 프로필은 한 번만 옮겨진다(중복 없음)
    expect((await api('GET', '/profiles', { token: m.token })).body).toHaveLength(1);
  });
});

describe('refresh 토큰 — 응답 유실·두 탭은 봐주고, 끊긴 세션은 봐주지 않는다', () => {
  it('같은 토큰으로 다시 갱신(응답 유실)하면 새 토큰을 주고, 다른 기기 로그인은 유지된다', async () => {
    const m = await member();
    const other = await api('POST', '/auth/login', { body: { email: (await api('GET', '/auth/me', { token: m.token })).body.email, password: 'password123' } });
    const first = await api('POST', '/auth/refresh', { body: { refreshToken: m.refreshToken } });
    const retry = await api('POST', '/auth/refresh', { body: { refreshToken: m.refreshToken } });
    expect([first.status, retry.status]).toEqual([200, 200]);
    expect((await api('POST', '/auth/refresh', { body: { refreshToken: other.body.refreshToken } })).status).toBe(200);
  });

  it('비밀번호를 바꾼 뒤에는 방금 회전된 옛 토큰이라도 받지 않는다', async () => {
    const m = await member();
    const rotated = await api('POST', '/auth/refresh', { body: { refreshToken: m.refreshToken } });
    expect(rotated.status).toBe(200);
    const ch = await api('POST', '/auth/password/change', { token: rotated.body.accessToken, body: { currentPassword: 'password123', newPassword: 'password456' } });
    expect(ch.status).toBe(200);
    expect((await api('POST', '/auth/refresh', { body: { refreshToken: m.refreshToken } })).status).toBe(401);
    expect((await api('POST', '/auth/refresh', { body: { refreshToken: rotated.body.refreshToken } })).status).toBe(401);
  });

  it('로그아웃한 토큰은 바로 다시 써도 받지 않는다', async () => {
    const m = await member();
    await api('POST', '/auth/logout', { body: { refreshToken: m.refreshToken } });
    expect((await api('POST', '/auth/refresh', { body: { refreshToken: m.refreshToken } })).status).toBe(401);
  });
});

describe('요청 ID 선점 기록 — 탈퇴하면 지운다', () => {
  it('상담·꿈풀이 선점 행과 토스 날짜 열기 기록은 탈퇴 때 함께 지우고, 다른 사용자의 기록은 남긴다', async () => {
    const a = await member();
    const b = await member();
    await db.insert(webhookEvents).values([
      { id: `chat:${a.userId}:req-a1`, provider: 'app', eventType: 'chat_request', payload: { replyId: 'x' }, processedAt: Date.now() },
      { id: `dream:${a.userId}:req-a2`, provider: 'app', eventType: 'dream_request', payload: { paragraphs: ['풀이'], profileName: '본인' }, processedAt: Date.now() },
      { id: `tossad:unlock:tomorrow_fortune:${a.userId}:2026-11-26`, provider: 'toss_ad', eventType: 'unlock:tomorrow_fortune', payload: {}, processedAt: Date.now() },
      { id: `dream:${b.userId}:req-b1`, provider: 'app', eventType: 'dream_request', payload: {}, processedAt: Date.now() },
    ]);
    const res = await app.inject({ method: 'DELETE', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${a.token}` } });
    expect(res.statusCode).toBe(204);
    const left = (await db.select({ id: webhookEvents.id }).from(webhookEvents)).map((r) => r.id);
    expect(left.filter((id) => id.includes(a.userId))).toEqual([]);
    expect(left).toContain(`dream:${b.userId}:req-b1`);
  });
});

describe('질문권 한도가 있는 무상 지급(광고 보상)', () => {
  it('보상 요청 8개가 동시에 와도 하루 한도(3)만큼만 지급한다', async () => {
    const m = await member();
    const { commerce } = app.ctx.services;
    const since = Date.now() - 60_000;
    const rs = await Promise.all(Array.from({ length: 8 }, () => commerce.grantDailyCapped(m.userId, 1, '광고 보상', 3, since)));
    expect(rs.filter((r) => r !== null)).toHaveLength(3);
    expect(await credits(m.token)).toBe(BONUS + 3);
  });
});
