/**
 * 결제 규칙 회귀 테스트(2026-11-26 조치)
 * - 같은 권한 키를 두 주문이 줄 때 한 주문을 환불해도 다른 유효 주문의 권한은 남는다
 * - 한도 초과 미지급 주문의 상태 규칙(결제사에서 취소했으면 canceled)
 * - 인앱결제: 결제 전 확인(/payments/iap/check), 이미 가진 콘텐츠·판매 중지·한도 초과 거절과 details.finish,
 *   같은 거래를 다시 검증해도 같은 답, 대상 프로필을 잃은 복구는 대표 프로필로 채움, 이미 처리한 거래는 대상 확인 없이 마무리
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations, type Db } from '../src/db/local.js';
import { orders, products, webhookEvents } from '../src/db/schema.js';
import { seedProducts } from '../src/db/seed.js';

const BIRTH = { calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' } as const;
const OTHER = { calendar: 'solar', year: 1992, month: 8, day: 21, hour: 9, minute: 0, gender: 'female' } as const;
const ADMIN = { 'x-admin-token': 'admin-secret-for-commerce-rules' };

let app: App;
let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  const config = loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: '', SIGNUP_BONUS_CREDITS: '0', ADMIN_API_TOKEN: ADMIN['x-admin-token'] });
  ({ db, close } = createDb(':memory:'));
  await runMigrations(db);
  await seedProducts(db);
  app = buildApp({ config, db });
});
afterAll(async () => {
  await app.close();
  await close();
});

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
  const r = await api('POST', '/auth/signup', { body: { email: `rules${++seq}@example.com`, password: 'password123' } });
  const token = r.body.accessToken as string;
  const profileId = (await api('POST', '/profiles', { token, body: { name: '본인', relation: 'self', birth: BIRTH } })).body.id as string;
  const otherProfileId = (await api('POST', '/profiles', { token, body: { name: '친구', relation: 'friend', birth: OTHER } })).body.id as string;
  return { token, profileId, otherProfileId };
}
/** mock 결제로 주문 생성 → 승인 */
async function buy(token: string, productId: string, profileId?: string) {
  const o = await api('POST', '/orders', { token, body: { productId, profileId } });
  expect(o.status).toBe(201);
  const r = await api('POST', '/payments/confirm', { token, body: { provider: 'mock', orderId: o.body.order.id, amount: o.body.order.amount } });
  return { orderId: o.body.order.id as string, confirm: r };
}
const keys = async (token: string) => ((await api('GET', '/wallet', { token })).body.entitlements as { key: string }[]).map((e) => e.key);
const refund = (orderId: string) => api('POST', `/admin/orders/${orderId}/refund`, { headers: ADMIN, body: { reason: '테스트 환불' } });

describe('같은 권한 키를 주는 두 주문', () => {
  it('평생 사주분석서를 산 뒤 신년 패키지를 사고 평생 사주분석서를 환불해도, 패키지가 준 평생 권한은 남는다', async () => {
    const m = await member();
    const lifetime = await buy(m.token, 'report_saju_lifetime', m.profileId);
    expect(lifetime.confirm.status).toBe(200);
    const bundle = await buy(m.token, 'bundle_newyear_2027', m.profileId);
    expect(bundle.confirm.status).toBe(200);
    expect(await keys(m.token)).toContain(`report:lifetime:${m.profileId}`);

    expect((await refund(lifetime.orderId)).status).toBe(200);
    const after = await keys(m.token);
    expect(after).toContain(`report:lifetime:${m.profileId}`);
    expect(after).toContain(`report:yearly:${m.profileId}:2027`);

    // 패키지까지 환불하면 그제야 지워진다
    expect((await refund(bundle.orderId)).status).toBe(200);
    const none = await keys(m.token);
    expect(none).not.toContain(`report:lifetime:${m.profileId}`);
    expect(none).not.toContain(`report:yearly:${m.profileId}:2027`);
  });

  it('두 주문을 동시에 환불해도 권한이 남지 않는다', async () => {
    const m = await member();
    const lifetime = await buy(m.token, 'report_saju_lifetime', m.profileId);
    const bundle = await buy(m.token, 'bundle_newyear_2027', m.profileId);
    const rs = await Promise.all([refund(lifetime.orderId), refund(bundle.orderId)]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect(await keys(m.token)).not.toContain(`report:lifetime:${m.profileId}`);
  });
});

describe('한도 초과 미지급 주문의 상태', () => {
  it('결제사에서 결제를 취소했으면 canceled(PER_USER_LIMIT) 이고 409 에 사유가 있다', async () => {
    const m = await member();
    const a = await api('POST', '/orders', { token: m.token, body: { productId: 'report_saju_mini', profileId: m.profileId } });
    const b = await api('POST', '/orders', { token: m.token, body: { productId: 'report_saju_mini', profileId: m.otherProfileId } });
    expect((await api('POST', '/payments/confirm', { token: m.token, body: { provider: 'mock', orderId: a.body.order.id, amount: 990 } })).status).toBe(200);
    const second = await api('POST', '/payments/confirm', { token: m.token, body: { provider: 'mock', orderId: b.body.order.id, amount: 990 } });
    expect(second.status).toBe(409);
    expect(second.body.error.details.reason).toBe('PER_USER_LIMIT');
    const [row] = await db.select().from(orders).where(eq(orders.id, b.body.order.id));
    expect(row).toMatchObject({ status: 'canceled', failureReason: 'PER_USER_LIMIT' });
  });
});

describe('인앱결제 — 결제 전 확인과 거절', () => {
  const ios = (productId: string, receipt: string, extra: object = {}) => ({ platform: 'ios', productId, receipt: `mock:${receipt}`, ...extra });

  it('이미 가진 리포트는 결제 전 확인에서 막고(환불 안내 없음), 결제 뒤 검증도 지급하지 않는다', async () => {
    const m = await member();
    await buy(m.token, 'report_saju_lifetime', m.profileId);
    const check = await api('POST', '/payments/iap/check', { token: m.token, body: { platform: 'ios', productId: 'com.daldalsaju.report.lifetime', profileId: m.profileId } });
    expect(check.status).toBe(409);
    expect(check.body.error.details).toMatchObject({ reason: 'ALREADY_OWNED' });
    expect(check.body.error.message).not.toContain('환불');
    // 다른 프로필은 살 수 있다
    expect((await api('POST', '/payments/iap/check', { token: m.token, body: { platform: 'ios', productId: 'com.daldalsaju.report.lifetime', profileId: m.otherProfileId } })).status).toBe(200);

    // iOS: 지급하지 않고 거래를 끝내라고(finish) 알리며 App Store 환불 요청을 안내한다. 다시 검증해도 같은 답이다
    const body = ios('com.daldalsaju.report.lifetime', `owned-${seq}`, { profileId: m.profileId });
    const v1 = await api('POST', '/payments/iap/verify', { token: m.token, body });
    expect(v1.status).toBe(409);
    expect(v1.body.error.details).toMatchObject({ reason: 'ALREADY_OWNED', finish: true });
    expect(v1.body.error.message).toContain('App Store');
    const v2 = await api('POST', '/payments/iap/verify', { token: m.token, body });
    expect(v2.status).toBe(409);
    expect(v2.body.error.details).toMatchObject({ reason: 'ALREADY_OWNED', finish: true });
    const [row] = await db.select().from(orders).where(eq(orders.providerPaymentKey, `owned-${seq}`));
    expect(row).toMatchObject({ status: 'failed', failureReason: 'ALREADY_OWNED', provider: 'iap_apple' });
  });

  it('Android 는 거래를 그대로 두라고(finish=false) 알리고 3일 안 자동 환불을 안내한다', async () => {
    const m = await member();
    await buy(m.token, 'report_saju_lifetime', m.profileId);
    const r = await api('POST', '/payments/iap/verify', { token: m.token, body: { platform: 'android', productId: 'report_saju_lifetime', receipt: `mock:and-owned-${seq}`, profileId: m.profileId } });
    expect(r.status).toBe(409);
    expect(r.body.error.details).toMatchObject({ reason: 'ALREADY_OWNED', finish: false });
    expect(r.body.error.message).toContain('3일');
  });

  it('계정당 1회 상품을 다시 사면 거절하고, 같은 거래를 다시 검증해도 200 으로 바뀌지 않는다', async () => {
    const m = await member();
    expect((await api('POST', '/payments/iap/verify', { token: m.token, body: ios('com.daldalsaju.report.mini', `mini-a-${seq}`, { profileId: m.profileId }) })).status).toBe(200);
    expect((await api('POST', '/payments/iap/check', { token: m.token, body: { platform: 'ios', productId: 'com.daldalsaju.report.mini', profileId: m.otherProfileId } })).body.error.details.reason).toBe('PER_USER_LIMIT');
    const body = ios('com.daldalsaju.report.mini', `mini-b-${seq}`, { profileId: m.otherProfileId });
    for (let i = 0; i < 2; i++) {
      const r = await api('POST', '/payments/iap/verify', { token: m.token, body });
      expect(r.status).toBe(409);
      expect(r.body.error.details).toMatchObject({ reason: 'PER_USER_LIMIT', finish: true });
    }
  });

  it('판매 중지·출시 예정 상품은 결제 전 확인과 검증에서 거절한다', async () => {
    const m = await member();
    await db.update(products).set({ comingSoon: true }).where(eq(products.id, 'chat_pack_30'));
    try {
      expect((await api('POST', '/payments/iap/check', { token: m.token, body: { platform: 'ios', productId: 'com.daldalsaju.chat.30' } })).body.error.details.reason).toBe('NOT_FOR_SALE');
      const r = await api('POST', '/payments/iap/verify', { token: m.token, body: ios('com.daldalsaju.chat.30', `soon-${seq}`) });
      expect(r.status).toBe(409);
      expect(r.body.error.details.reason).toBe('NOT_FOR_SALE');
      expect((await api('GET', '/wallet', { token: m.token })).body.credits).toBe(0);
    } finally {
      await db.update(products).set({ comingSoon: false }).where(eq(products.id, 'chat_pack_30'));
    }
  });

  it('검증 전에 환불된 거래는 402 REVOKED 와 finish=true', async () => {
    const m = await member();
    await db.insert(webhookEvents).values({ id: `iap_apple:voided:revoked-${seq}`, provider: 'iap_apple', eventType: 'VOIDED', payload: {}, processedAt: Date.now() });
    const r = await api('POST', '/payments/iap/verify', { token: m.token, body: ios('com.daldalsaju.chat.10', `revoked-${seq}`) });
    expect(r.status).toBe(402);
    expect(r.body.error.details).toMatchObject({ code: 'REVOKED', reason: 'REVOKED', finish: true });
  });

  it('끊긴 결제 복구에서 대상 프로필을 잃었으면 대표 프로필로 지급하고, 이미 지급한 거래는 대상 없이도 마무리된다', async () => {
    const m = await member();
    const body = ios('com.daldalsaju.report.love', `recover-${seq}`);
    const r = await api('POST', '/payments/iap/verify', { token: m.token, body });
    expect(r.status).toBe(200);
    expect(r.body.granted.entitlements).toEqual([`report:love:${m.profileId}`]);
    // 같은 거래를 대상 없이 다시 검증해도(앱이 finish 전에 꺼진 경우) 200
    const again = await api('POST', '/payments/iap/verify', { token: m.token, body });
    expect(again.status).toBe(200);
    expect(again.body.order.status).toBe('paid');
  });

  it('저장한 사주가 없으면 400 이고 거래를 끝내라는 표시가 없다(사주를 저장한 뒤 복구된다)', async () => {
    const r0 = await api('POST', '/auth/signup', { body: { email: `rules-noprofile${++seq}@example.com`, password: 'password123' } });
    const r = await api('POST', '/payments/iap/verify', { token: r0.body.accessToken, body: ios('com.daldalsaju.report.love', `noprofile-${seq}`) });
    expect(r.status).toBe(400);
    expect(r.body.error.details?.finish).toBeUndefined();
  });
});
