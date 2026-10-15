/**
 * 주제별 리포트(연애·결혼운 · 재물·직업운) API — 판매 상품, 구매 전 402, 결제 직후 미리 만들기(보관함),
 * 프로필·주제마다 따로 열리는 권한, 인앱결제 상품 연결, 환불 후 열람 차단. AI 키 없음 → 규칙 기반 최종본.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { seedProducts } from '../src/db/seed.js';

let app: FastifyInstance;
const BIRTH = { calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' } as const;
const OTHER = { calendar: 'solar', year: 1992, month: 8, day: 21, hour: 9, minute: 0, gender: 'female' } as const;
const LOVE_KEYS = ['summary', 'loveNature', 'spousePalace', 'tenGodBalance', 'attraction', 'idealPartner', 'pattern', 'friction', 'decade', 'threeYears', 'advice', 'closing'];
const CAREER_KEYS = ['summary', 'moneyFlow', 'strength', 'earnKeep', 'workStyle', 'fields', 'employment', 'decade', 'threeYears', 'risks', 'habits', 'closing'];

beforeAll(async () => {
  const config = loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: '', SIGNUP_BONUS_CREDITS: '0', ADMIN_API_TOKEN: 'admin-secret' });
  const { db } = createDb(':memory:');
  runMigrations(db);
  seedProducts(db);
  app = await buildApp({ config, db, logger: false });
});
afterAll(async () => {
  await app.close();
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
  const r = await api('POST', '/auth/signup', { body: { email: `topic${++seq}@example.com`, password: 'password123', nickname: '테스트' } });
  return r.body.accessToken as string;
}
async function profile(token: string, name = '민수', birth: object = BIRTH) {
  return (await api('POST', '/profiles', { token, body: { name, relation: 'self', birth } })).body.id as string;
}
async function buy(token: string, productId: string, profileId: string) {
  const o = await api('POST', '/orders', { token, body: { productId, profileId } });
  expect(o.status).toBe(201);
  const c = await api('POST', '/payments/confirm', { token, body: { provider: 'mock', orderId: o.body.order.id, amount: o.body.order.amount } });
  expect(c.status).toBe(200);
  return { orderId: o.body.order.id as string, granted: c.body.granted as { entitlements: string[]; credits: number } };
}

describe('상품', () => {
  it('두 리포트를 4,900원 일회성 상품으로 판다 (출시 예정 아님, 스토어 상품 ID 연결)', async () => {
    const products = (await api('GET', '/products')).body as any[];
    const love = products.find((p) => p.id === 'report_love');
    const cw = products.find((p) => p.id === 'report_career_wealth');
    expect(love).toMatchObject({ type: 'one_time', price: 4900, listPrice: null, credits: 0, grants: ['report:love'], comingSoon: false, purchasable: true, requiresProfile: true, requiresPartner: false, iosProductId: 'kr.dalbitsaju.report.love', androidProductId: 'report_love' });
    expect(cw).toMatchObject({ type: 'one_time', price: 4900, listPrice: null, credits: 0, grants: ['report:career_wealth'], comingSoon: false, purchasable: true, requiresProfile: true, requiresPartner: false, iosProductId: 'kr.dalbitsaju.report.careerwealth', androidProductId: 'report_career_wealth' });
    expect(love.description).toMatch(/10년/);
    expect(cw.description).toMatch(/10년/);
  });

  it('대상 프로필 없이 주문할 수 없다', async () => {
    const token = await member();
    const r = await api('POST', '/orders', { token, body: { productId: 'report_love' } });
    expect(r.status).toBe(400);
  });
});

describe('연애·결혼운 리포트 — 구매 → 미리 만들기 → 열기', () => {
  it('구매 전 402(필요한 상품 ID), 구매하면 보관함에 이미 있고 같은 리포트가 열린다', async () => {
    const token = await member();
    const me = await profile(token);
    const before = await api('POST', '/reports', { token, body: { type: 'love', profileId: me } });
    expect(before.status).toBe(402);
    expect(before.body.error.details.productId).toBe('report_love');

    const { granted } = await buy(token, 'report_love', me);
    expect(granted.entitlements).toEqual([`report:love:${me}`]);
    expect(granted.credits).toBe(0);

    // 결제가 확정되면 서버가 바로 만들어 보관함에 둔다
    const list = (await api('GET', '/reports', { token })).body;
    expect(list).toEqual([expect.objectContaining({ type: 'love', title: '민수님의 연애·결혼운 리포트', profileName: '민수' })]);

    const opened = await api('POST', '/reports', { token, body: { type: 'love', profileId: me } });
    expect(opened.status).toBe(201);
    expect(opened.body.id).toBe(list[0].id);
    expect(opened.body).toMatchObject({ type: 'love', status: 'ready', generator: 'rule', progress: null, year: null, partnerProfileId: null });
    expect(opened.body.sections.map((s: { key: string }) => s.key)).toEqual(LOVE_KEYS);
    // 프로필 이름으로 부른다 — 첫 장 첫 문장, 용어는 '사주로 보면'(basis)에만
    expect(opened.body.sections[0].paragraphs[0]).toMatch(/^민수님은 /);
    expect(opened.body.sections[0].basis).toMatch(/일간 .+ · 일지\(배우자 자리\)/);
    const got = await api('GET', `/reports/${opened.body.id}`, { token });
    expect(got.body.sections).toEqual(opened.body.sections);
    expect((await api('GET', `/reports/${opened.body.id}/progress`, { token })).body).toEqual({ status: 'ready', progress: null });
  });

  it('권한은 프로필·주제마다 따로 — 다른 프로필, 재물·직업운, 사주분석서는 열리지 않는다', async () => {
    const token = await member();
    const me = await profile(token);
    const other = await profile(token, '지은', OTHER);
    await buy(token, 'report_love', me);
    expect((await api('POST', '/reports', { token, body: { type: 'love', profileId: other } })).body.error.details.productId).toBe('report_love');
    const cw = await api('POST', '/reports', { token, body: { type: 'career_wealth', profileId: me } });
    expect(cw.status).toBe(402);
    expect(cw.body.error.details.productId).toBe('report_career_wealth');
    expect((await api('POST', '/reports', { token, body: { type: 'lifetime', profileId: me } })).status).toBe(402);
    // 남의 프로필로는 만들 수 없다
    const stranger = await member();
    expect((await api('POST', '/reports', { token: stranger, body: { type: 'love', profileId: me } })).status).toBe(404);
  });

  it('환불하면 보관함에서 빠지고 다시 열 수 없다', async () => {
    const token = await member();
    const me = await profile(token);
    const { orderId } = await buy(token, 'report_love', me);
    const id = (await api('GET', '/reports', { token })).body[0].id;
    const refund = await api('POST', `/admin/orders/${orderId}/refund`, { headers: { 'x-admin-token': 'admin-secret' }, body: { reason: '단순 변심' } });
    expect(refund.status).toBe(200);
    expect((await api('GET', '/reports', { token })).body).toHaveLength(0);
    expect((await api('GET', `/reports/${id}`, { token })).status).toBe(402);
    expect((await api('POST', '/reports', { token, body: { type: 'love', profileId: me } })).status).toBe(402);
  });
});

describe('재물·직업운 리포트', () => {
  it('웹 결제 → 미리 만들어 두고, 열면 12개 장', async () => {
    const token = await member();
    const me = await profile(token);
    const { granted } = await buy(token, 'report_career_wealth', me);
    expect(granted.entitlements).toEqual([`report:career_wealth:${me}`]);
    const list = (await api('GET', '/reports', { token })).body;
    expect(list).toEqual([expect.objectContaining({ type: 'career_wealth', title: '민수님의 재물·직업운 리포트' })]);
    const opened = await api('POST', '/reports', { token, body: { type: 'career_wealth', profileId: me } });
    expect(opened.body.id).toBe(list[0].id);
    expect(opened.body.sections.map((s: { key: string }) => s.key)).toEqual(CAREER_KEYS);
    expect(opened.body.sections[0].paragraphs[0]).toMatch(/^민수님은 /);
  });

  it('인앱결제(Google Play 목업)로 사도 같은 권한이 생기고 미리 만들어진다', async () => {
    const token = await member();
    const me = await profile(token);
    const r = await api('POST', '/payments/iap/verify', { token, body: { platform: 'android', productId: 'report_career_wealth', receipt: `mock:gp-cw-${me}`, profileId: me } });
    expect(r.status).toBe(200);
    expect(r.body.granted.entitlements).toEqual([`report:career_wealth:${me}`]);
    expect((await api('GET', '/reports', { token })).body.map((x: { type: string }) => x.type)).toEqual(['career_wealth']);
    const ios = await api('POST', '/payments/iap/verify', { token, body: { platform: 'ios', productId: 'kr.dalbitsaju.report.love', receipt: `mock:as-love-${me}`, profileId: me } });
    expect(ios.body.granted.entitlements).toEqual([`report:love:${me}`]);
    expect((await api('GET', '/reports', { token })).body.map((x: { type: string }) => x.type).sort()).toEqual(['career_wealth', 'love']);
  });

  it('없는 리포트 종류는 400', async () => {
    const token = await member();
    const me = await profile(token);
    expect((await api('POST', '/reports', { token, body: { type: 'wealth', profileId: me } })).status).toBe(400);
  });
});
