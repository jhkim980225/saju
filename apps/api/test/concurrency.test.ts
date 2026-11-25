/**
 * 동시 요청 — 같은 자원에 요청이 겹쳐도 돈·질문권·권한·토큰이 한 번만 처리되는지.
 * D1 에는 대화형 트랜잭션이 없어 읽고 → 묶음(batch) 실행 사이에 다른 요청이 끼어든다. db/atomic.ts 의 전제 확인·재시도가 이를 막는다.
 * 기본은 인메모리 SQLite(libSQL)로 돌고, TEST_D1=1 이면 진짜 D1(Miniflare)로 돈다.
 *   TEST_D1=1 npx vitest run test/concurrency.test.ts
 */
import { and, eq } from 'drizzle-orm';
import type { App } from '../src/app.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations, type Db } from '../src/db/local.js';
import { creditLedger, entitlements, orders, reports } from '../src/db/schema.js';
import { seedProducts } from '../src/db/seed.js';

let app: App;
let db: Db;
let close: () => Promise<void>;
const BIRTH = { calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' } as const;

beforeAll(async () => {
  const config = loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: '', SIGNUP_BONUS_CREDITS: '0' });
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
let seq = 0;
async function member() {
  const r = await api('POST', '/auth/signup', { body: { email: `race${++seq}@example.com`, password: 'password123', nickname: '테스트' } });
  expect(r.status).toBe(201);
  return { token: r.body.accessToken as string, refreshToken: r.body.refreshToken as string, userId: r.body.user.id as string };
}
const order = async (token: string, productId: string, body: Record<string, unknown> = {}) => (await api('POST', '/orders', { token, body: { productId, ...body } })).body.order as { id: string; amount: number };
const confirm = (token: string, o: { id: string; amount: number }) => api('POST', '/payments/confirm', { token, body: { provider: 'mock', orderId: o.id, amount: o.amount } });
const statuses = (rs: Array<{ status: number }>) => rs.map((r) => r.status).sort();

describe('동시 요청', () => {
  it('질문권을 동시에 써도 잔액을 덮어쓰지 않는다 — 가진 만큼만 차감되고 원장과 잔액이 맞는다', async () => {
    const { userId } = await member();
    const { commerce } = app.ctx.services;
    await commerce.grantFreeCredits(userId, 10, '테스트 지급');
    const results = await Promise.allSettled(Array.from({ length: 15 }, (_, i) => commerce.consumeCredits(userId, 1, `동시 차감 ${i}`)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(5);
    const wallet = await commerce.wallet(userId);
    expect(wallet.credits).toBe(0);
    const ledger = await db.select().from(creditLedger).where(eq(creditLedger.userId, userId));
    expect(ledger.reduce((s, l) => s + l.delta, 0)).toBe(0);
    // 차감 후 잔액은 9,8,…,0 이 한 번씩 — 같은 잔액을 두 번 기록했다면 덮어쓰기가 일어난 것
    expect(ledger.filter((l) => l.reason === 'consume').map((l) => l.balanceAfter).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('같은 주문을 동시에 승인해도 지급은 한 번', async () => {
    const { token, userId } = await member();
    const o = await order(token, 'chat_pack_10');
    const rs = await Promise.all(Array.from({ length: 5 }, () => confirm(token, o)));
    expect(statuses(rs)).toEqual([200, 200, 200, 200, 200]);
    expect((await app.ctx.services.commerce.wallet(userId)).credits).toBe(10);
    expect(rs.filter((r) => r.body.granted.credits === 10)).toHaveLength(1);
  });

  it('계정당 1회 상품을 두 주문으로 동시에 결제해도 하나만 지급하고 나머지는 취소', async () => {
    const { token, userId } = await member();
    const profileId = (await api('POST', '/profiles', { token, body: { name: '민수', relation: 'self', birth: BIRTH } })).body.id as string;
    const a = await order(token, 'report_saju_mini', { profileId });
    const b = await order(token, 'report_saju_mini', { profileId });
    const rs = await Promise.all([confirm(token, a), confirm(token, b)]);
    expect(statuses(rs)).toEqual([200, 409]);
    const paid = await db.select().from(orders).where(and(eq(orders.userId, userId), eq(orders.status, 'paid')));
    expect(paid).toHaveLength(1);
    expect(await db.select().from(entitlements).where(eq(entitlements.userId, userId))).toHaveLength(1);
  });

  it('같은 리포트를 동시에 열어도(결제 직후 미리 만들기 포함) 저장본은 하나', async () => {
    const { token, userId } = await member();
    const profileId = (await api('POST', '/profiles', { token, body: { name: '민수', relation: 'self', birth: BIRTH } })).body.id as string;
    const o = await order(token, 'report_saju_lifetime', { profileId });
    // 결제 확정 직후 뒤에서 미리 만들기가 돌기 시작한다 — 그와 겹치게 열람 요청을 한꺼번에 보낸다
    expect((await confirm(token, o)).status).toBe(200);
    const opened = await Promise.all(Array.from({ length: 5 }, () => api('POST', '/reports', { token, body: { type: 'lifetime', profileId } })));
    expect(opened.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    const rowsOf = () => db.select().from(reports).where(and(eq(reports.userId, userId), eq(reports.type, 'lifetime')));
    await vi.waitFor(async () => expect(await rowsOf()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 200)); // 늦게 끝난 미리 만들기가 하나 더 넣지 않는지
    const rows = await rowsOf();
    expect(rows).toHaveLength(1);
    // 모든 열람이 같은 저장본을 받는다
    expect(new Set(opened.map((r) => r.body.id))).toEqual(new Set([rows[0]!.id]));
  });

  it('같은 refresh 토큰을 동시에 써도(탭 두 개) 로그아웃되지 않는다 — 모두 서로 다른 새 토큰을 받고, 토큰은 한 번만 회전된다', async () => {
    const { refreshToken } = await member();
    const rs = await Promise.all(Array.from({ length: 3 }, () => api('POST', '/auth/refresh', { body: { refreshToken } })));
    expect(statuses(rs)).toEqual([200, 200, 200]);
    expect(new Set(rs.map((r) => r.body.refreshToken)).size).toBe(3);
    // 받은 토큰은 모두 다음 갱신에 쓸 수 있다(전체 세션 폐기가 일어나지 않았다)
    for (const r of rs) expect((await api('POST', '/auth/refresh', { body: { refreshToken: r.body.refreshToken } })).status).toBe(200);
  });

  it('같은 이메일로 동시에 가입하면 하나만 만들어지고 나머지는 409', async () => {
    const email = `same${Date.now()}@example.com`;
    const rs = await Promise.all(Array.from({ length: 3 }, () => api('POST', '/auth/signup', { body: { email, password: 'password123', nickname: '동시' } })));
    expect(statuses(rs)).toEqual([201, 409, 409]);
  });
});
