import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/local.js';
import { seedProducts } from '../src/db/seed.js';
import { creditLedger, orders } from '../src/db/schema.js';
import { parseTossSkus, tossPriceFor } from '../src/modules/commerce/tossCatalog.js';
import { createFakeToss } from './helpers/tossFake.js';

const BIRTH = { calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' } as const;
const SKUS = 'report_saju_lifetime=sku-lifetime,report_saju_mini=sku-mini,chat_pack_10=sku-chat10,tarot_question_3=sku-tarot3';
const ENV = { __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: '', TOSS_USER_KEY_SECRET: 'test-toss-user-key-secret-0123456789', TOSS_IAP_SKUS: SKUS };

describe('토스 인앱 결제', () => {
  const toss = createFakeToss();
  const { db } = createDb(':memory:');
  let app: App;
  let token: string;
  let userId: string;
  let otherToken: string;
  let profileId: string;

  const api = async (method: 'GET' | 'POST', url: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await app.inject({ method, url: `/api/v1${url}`, headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {}, ...(opts.body !== undefined ? { payload: opts.body as object } : {}) });
    return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null };
  };
  const verify = (t: string, body: Record<string, unknown>) => api('POST', '/payments/iap/verify', { token: t, body: { platform: 'toss', ...body } });
  const paid = (orderId: string, sku: string) => toss.orders.set(orderId, { status: 'PAYMENT_COMPLETED', sku });
  const statusCalls = () => toss.calls.filter((c) => c.url.endsWith('/get-order-status')).length;

  beforeAll(async () => {
    await runMigrations(db);
    await seedProducts(db);
    app = buildApp({ config: loadConfig(ENV), db, deps: { tossFetch: toss.fetch } });
    toss.codes.set('code-a', 'anon-A').set('code-b', 'anon-B');
    const a = await api('POST', '/auth/toss', { body: { code: 'code-a' } });
    token = a.body.accessToken;
    userId = a.body.user.id;
    otherToken = (await api('POST', '/auth/toss', { body: { code: 'code-b' } })).body.accessToken;
    profileId = (await api('POST', '/profiles', { token, body: { name: '민수', relation: 'self', birth: BIRTH } })).body.id;
  });

  it('SKU 설정을 읽는다 / 토스 판매가는 공급가 100원 단위 × 1.1', () => {
    expect([...parseTossSkus(' a=1 , b = two ,broken,=x,c=')]).toEqual([
      ['a', '1'],
      ['b', 'two'],
    ]);
    expect(tossPriceFor('x', 990)).toBe(990);
    expect(tossPriceFor('x', 9900)).toBe(9900);
    expect(tossPriceFor('x', 5900)).toBe(5940);
    expect(tossPriceFor('x', 16900)).toBe(16940);
  });

  it('SKU 를 연결한 상품만 토스 상점에 나온다', async () => {
    const cfg = await api('GET', '/config');
    expect(cfg.body.features.tossIap).toBe(true);
    const r = await api('GET', '/payments/iap/toss/products');
    expect(r.status).toBe(200);
    expect(r.body.map((p: any) => p.productId).sort()).toEqual(['chat_pack_10', 'report_saju_lifetime', 'report_saju_mini', 'tarot_question_3']);
    expect(r.body.find((p: any) => p.productId === 'report_saju_lifetime')).toEqual({ productId: 'report_saju_lifetime', sku: 'sku-lifetime', amount: 9900 });
  });

  it('주문 의도 — 프로필이 필요한 상품은 프로필 없이 만들 수 없고, 연결 안 된 상품은 501', async () => {
    expect((await api('POST', '/payments/iap/toss/orders', { token, body: { productId: 'report_saju_lifetime' } })).status).toBe(400);
    expect((await api('POST', '/payments/iap/toss/orders', { token, body: { productId: 'report_saju_lifetime', profileId: 'not-mine' } })).status).toBe(400);
    const unlinked = await api('POST', '/payments/iap/toss/orders', { token, body: { productId: 'report_compat', profileId } });
    expect(unlinked.status).toBe(501);
    expect((await api('POST', '/payments/iap/toss/orders', { body: { productId: 'chat_pack_10' } })).status).toBe(401);
  });

  it('게스트는 살 수 없다', async () => {
    const guest = await api('POST', '/auth/guest', { body: { deviceId: 'device-guest-iap-01' } });
    const r = await api('POST', '/payments/iap/toss/orders', { token: guest.body.accessToken, body: { productId: 'chat_pack_10' } });
    expect(r.status).toBe(403);
    expect(r.body.error.details.reason).toBe('LOGIN_REQUIRED');
    paid('toss-guest-1', 'sku-chat10');
    expect((await verify(guest.body.accessToken, { orderId: 'toss-guest-1' })).status).toBe(403);
  });

  it('결제 완료 주문 → 지급, 같은 주문을 다시 보내면 멱등', async () => {
    const intent = await api('POST', '/payments/iap/toss/orders', { token, body: { productId: 'report_saju_lifetime', profileId } });
    expect(intent.status).toBe(201);
    expect(intent.body).toMatchObject({ productId: 'report_saju_lifetime', sku: 'sku-lifetime', amount: 9900 });
    paid('toss-order-1', 'sku-lifetime');

    const r1 = await verify(token, { orderId: 'toss-order-1', intentId: intent.body.intentId });
    expect(r1.status).toBe(200);
    expect(r1.body.order).toMatchObject({ id: intent.body.intentId, status: 'paid', provider: 'iap_toss', amount: 9900 });
    expect(r1.body.granted.entitlements).toEqual([`report:lifetime:${profileId}`]);
    // 토스 첫 버전에는 AI 상담이 없다 — 사주분석서에 딸린 질문권 3회는 지급하지 않는다(상점 설명과 지급 내용을 맞춘다)
    expect(r1.body.granted.credits).toBe(0);
    expect(r1.body.creditsBalance).toBe(0);
    expect(await db.select().from(creditLedger).where(and(eq(creditLedger.refType, 'order'), eq(creditLedger.refId, intent.body.intentId)))).toHaveLength(0);
    // 토스 서버에는 주문 ID 만 보낸다 (사용자 헤더 없음)
    expect(toss.calls.at(-1)).toEqual({ url: 'https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss/order/get-order-status', body: { orderId: 'toss-order-1' } });

    const before = statusCalls();
    const r2 = await verify(token, { orderId: 'toss-order-1', intentId: intent.body.intentId });
    expect(r2.status).toBe(200);
    expect(r2.body.granted).toEqual({ credits: 0, entitlements: [], premiumUntil: null });
    expect(r2.body.creditsBalance).toBe(0);
    // 이미 지급한 주문은 토스 서버에 다시 묻지 않는다
    expect(statusCalls()).toBe(before);
    const wallet = await api('GET', '/wallet', { token });
    expect(wallet.body.entitlements.filter((e: any) => (e.key ?? e) === `report:lifetime:${profileId}`)).toHaveLength(1);
  });

  it('다른 계정이 같은 토스 주문을 쓰면 409', async () => {
    const r = await verify(otherToken, { orderId: 'toss-order-1' });
    expect(r.status).toBe(409);
    expect(r.body.error.details.reason).toBe('OTHER_ACCOUNT');
    expect((await api('GET', '/wallet', { token: otherToken })).body.credits).toBe(0);
  });

  it('결제되지 않았거나 찾을 수 없는 주문은 지급하지 않는다', async () => {
    const notFound = await verify(token, { orderId: 'toss-unknown' });
    expect(notFound.status).toBe(402);
    expect(notFound.body.error.details.code).toBe('NOT_PAID');

    toss.orders.set('toss-failed', { status: 'FAILED', sku: 'sku-chat10' });
    expect((await verify(token, { orderId: 'toss-failed' })).body.error.details.code).toBe('NOT_PAID');
    toss.orders.set('toss-foreign', { status: 'MINIAPP_MISMATCH' });
    expect((await verify(token, { orderId: 'toss-foreign' })).body.error.details.code).toBe('NOT_PAID');
    toss.orders.set('toss-progress', { status: 'ORDER_IN_PROGRESS', sku: 'sku-chat10' });
    expect((await verify(token, { orderId: 'toss-progress' })).body.error.details.code).toBe('IN_PROGRESS');
    toss.orders.set('toss-refunded', { status: 'REFUNDED', sku: 'sku-chat10' });
    expect((await verify(token, { orderId: 'toss-refunded' })).body.error.details.code).toBe('REVOKED');
    expect((await api('GET', '/wallet', { token })).body.credits).toBe(0);
  });

  it('토스 서버가 일시적으로 안 되면 502 — 지급하지 않고 다음에 다시 시도할 수 있다', async () => {
    paid('toss-retry', 'sku-chat10');
    toss.failNetwork = true;
    const r = await verify(token, { orderId: 'toss-retry' });
    toss.failNetwork = false;
    expect(r.status).toBe(502);
    expect(r.body.error.details.code).toBe('VERIFY_UNAVAILABLE');
    const again = await verify(token, { orderId: 'toss-retry' });
    expect(again.status).toBe(200);
    expect(again.body.creditsBalance).toBe(10);
  });

  it('주문 의도와 다른 상품의 결제는 거절한다 (SKU 불일치)', async () => {
    const intent = await api('POST', '/payments/iap/toss/orders', { token, body: { productId: 'chat_pack_10' } });
    paid('toss-mismatch', 'sku-lifetime');
    const r = await verify(token, { orderId: 'toss-mismatch', intentId: intent.body.intentId });
    expect(r.status).toBe(402);
    expect(r.body.error.details.code).toBe('SKU_MISMATCH');
  });

  it('요청의 sku 는 믿지 않는다 — 토스가 알려 준 SKU 로만 지급한다', async () => {
    paid('toss-cheap', 'sku-tarot3');
    // 싼 상품을 결제하고 비싼 상품의 sku 를 보내도, 토스가 알려 준 상품(타로)으로 처리한다 → 대상(리딩)이 없어 지급 불가
    const r = await verify(token, { orderId: 'toss-cheap', sku: 'sku-lifetime' });
    expect(r.status).toBe(409);
    expect(r.body.error.details.reason).toBe('TARGET_REQUIRED');
  });

  it('연결되지 않은 SKU 는 404', async () => {
    paid('toss-unknown-sku', 'sku-something-else');
    expect((await verify(token, { orderId: 'toss-unknown-sku' })).status).toBe(404);
  });

  it('복구 — 주문 의도 ID 를 몰라도 최근 대기 주문에서 대상을 찾아 지급한다', async () => {
    const second = (await api('POST', '/profiles', { token, body: { name: '지은', relation: 'friend', birth: { ...BIRTH, year: 1992 } } })).body.id;
    const intent = await api('POST', '/payments/iap/toss/orders', { token, body: { productId: 'report_saju_lifetime', profileId: second } });
    paid('toss-recover-1', 'sku-lifetime');
    const r = await verify(token, { orderId: 'toss-recover-1' });
    expect(r.status).toBe(200);
    expect(r.body.order.id).toBe(intent.body.intentId);
    expect(r.body.granted.entitlements).toEqual([`report:lifetime:${second}`]);
  });

  it('복구 — 대기 주문도 없으면 대상이 필요 없는 상품만 바로 지급한다', async () => {
    paid('toss-recover-2', 'sku-chat10');
    const before = (await api('GET', '/wallet', { token })).body.credits;
    const r = await verify(token, { orderId: 'toss-recover-2' });
    expect(r.status).toBe(200);
    expect(r.body.creditsBalance).toBe(before + 10);
    // 대상을 모르는 타로 상품은 지급하지 못한다 — 앱이 대상을 골라 다시 요청한다
    paid('toss-recover-3', 'sku-tarot3');
    const t = await verify(token, { orderId: 'toss-recover-3' });
    expect(t.status).toBe(409);
    expect(t.body.error.details.reason).toBe('TARGET_REQUIRED');
  });

  it('계정당 1회 상품 — 이미 샀으면 결제 전에 막는다', async () => {
    const intent = await api('POST', '/payments/iap/toss/orders', { token, body: { productId: 'report_saju_mini', profileId } });
    expect(intent.status).toBe(201);
    paid('toss-mini-1', 'sku-mini');
    expect((await verify(token, { orderId: 'toss-mini-1', intentId: intent.body.intentId })).status).toBe(200);
    const again = await api('POST', '/payments/iap/toss/orders', { token, body: { productId: 'report_saju_mini', profileId } });
    expect(again.status).toBe(409);
    expect(again.body.error.details.reason).toBe('PER_USER_LIMIT');
    // 그래도 결제가 들어오면(다른 기기 등) 지급하지 않고 알려 준다
    paid('toss-mini-2', 'sku-mini');
    const late = await verify(token, { orderId: 'toss-mini-2' });
    expect(late.status).toBe(409);
    expect(late.body.error.details.reason).toBe('PER_USER_LIMIT');
  });

  it('같은 주문 검증이 동시에 와도 한 번만 지급한다', async () => {
    paid('toss-race', 'sku-chat10');
    const before = (await api('GET', '/wallet', { token })).body.credits;
    const results = await Promise.all([verify(token, { orderId: 'toss-race' }), verify(token, { orderId: 'toss-race' }), verify(token, { orderId: 'toss-race' })]);
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect((await api('GET', '/wallet', { token })).body.credits).toBe(before + 10);
    expect(await db.select().from(orders).where(and(eq(orders.provider, 'iap_toss'), eq(orders.providerPaymentKey, 'toss-race')))).toHaveLength(1);
  });

  it('환불 확인 — 토스에서 환불된 주문의 권한을 회수한다(지급하지 않은 질문권은 차감하지 않는다)', async () => {
    const before = (await api('GET', '/wallet', { token })).body;
    expect(before.entitlements.some((e: any) => (e.key ?? e) === `report:lifetime:${profileId}`)).toBe(true);
    toss.orders.set('toss-order-1', { status: 'REFUNDED', sku: 'sku-lifetime' });
    const result = await app.ctx.services.tossIap.syncRefunds();
    expect(result.revoked).toBe(1);
    expect(result.failed).toBe(0);
    const after = (await api('GET', '/wallet', { token })).body;
    expect(after.entitlements.some((e: any) => (e.key ?? e) === `report:lifetime:${profileId}`)).toBe(false);
    // 사주분석서로는 질문권을 주지 않았으므로, 다른 주문(질문권 팩)으로 받은 질문권을 깎지 않는다
    expect(before.credits).toBeGreaterThanOrEqual(3);
    expect(after.credits).toBe(before.credits);
    const [order] = await db.select().from(orders).where(and(eq(orders.provider, 'iap_toss'), eq(orders.providerPaymentKey, 'toss-order-1')));
    expect(order!.status).toBe('refunded');
    expect(order!.userId).toBe(userId);
    // 다시 돌려도 또 회수하지 않는다
    expect((await app.ctx.services.tossIap.syncRefunds()).revoked).toBe(0);
    // 환불된 주문을 다시 검증해도 지급하지 않는다
    const again = await verify(token, { orderId: 'toss-order-1' });
    expect(again.status).toBe(402);
    expect(again.body.error.details.code).toBe('REVOKED');
  });

  it('관리자 환불 API 는 토스 인앱 결제를 직접 취소하지 않는다', async () => {
    const [order] = await db.select().from(orders).where(and(eq(orders.provider, 'iap_toss'), eq(orders.status, 'paid')));
    await expect(app.ctx.services.commerce.refund(order!.id, '테스트')).rejects.toThrow('인앱결제');
  });

  it('기존 스토어 인앱 결제 검증(ios)은 그대로 동작한다', async () => {
    const r = await api('POST', '/payments/iap/verify', { token, body: { platform: 'ios', productId: 'com.daldalsaju.chat.10', receipt: 'mock:tx-toss-suite-1' } });
    expect(r.status).toBe(200);
  });
});

describe('토스 인앱 결제가 설정되지 않은 서버', () => {
  it('바인딩이 없으면 주문 의도와 검증이 501', async () => {
    const { db } = createDb(':memory:');
    await runMigrations(db);
    await seedProducts(db);
    const app = buildApp({ config: loadConfig(ENV), db });
    const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'plain@example.com', password: 'password-1234', nickname: '일반' } });
    const token = (signup.json() as any).accessToken as string;
    const headers = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: 'POST', url: '/api/v1/payments/iap/toss/orders', headers, payload: { productId: 'chat_pack_10' } })).statusCode).toBe(501);
    expect((await app.inject({ method: 'POST', url: '/api/v1/payments/iap/verify', headers, payload: { platform: 'toss', orderId: 'x' } })).statusCode).toBe(501);
    expect(await app.ctx.services.tossIap.syncRefunds()).toEqual({ checked: 0, revoked: 0, failed: 0 });
  });

  it('개발용 모의 모드 — mTLS 없이 요청의 sku 로 지급 흐름을 확인할 수 있다', async () => {
    const { db } = createDb(':memory:');
    await runMigrations(db);
    await seedProducts(db);
    const app = buildApp({ config: loadConfig({ ...ENV, TOSS_DEV_MOCK: 'true' }), db });
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/toss', payload: { code: 'mock-anon-code-1' } });
    expect(login.statusCode).toBe(200);
    const headers = { authorization: `Bearer ${(login.json() as any).accessToken}` };
    const r = await app.inject({ method: 'POST', url: '/api/v1/payments/iap/verify', headers, payload: { platform: 'toss', orderId: 'mock-order-1', sku: 'sku-chat10' } });
    expect(r.statusCode).toBe(200);
    expect((r.json() as any).creditsBalance).toBe(10);
  });
});
