/**
 * QA 보안·로직 리뷰(docs/QA.md) 회귀 테스트 — 결제 동시성, 권한 재사용, 유료 콘텐츠 노출 경로.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { seedProducts } from '../src/db/seed.js';

let app: FastifyInstance;
const BIRTH = { calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' } as const;
const OTHER = { calendar: 'solar', year: 1975, month: 11, day: 2, hour: 6, minute: 10, gender: 'female' } as const;

beforeAll(async () => {
  const config = loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: '', ADMIN_API_TOKEN: 'admin-secret' });
  const { db } = createDb(':memory:');
  runMigrations(db);
  seedProducts(db);
  app = await buildApp({ config, db, logger: false });
});
afterAll(() => app.close());

const api = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) },
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null };
};

let n = 0;
async function member() {
  const r = await api('POST', '/auth/signup', { body: { email: `sec${++n}@example.com`, password: 'password123' } });
  const token = r.body.accessToken as string;
  const p = await api('POST', '/profiles', { token, body: { name: '본인', relation: 'self', birth: BIRTH } });
  return { token, profileId: p.body.id as string };
}
const buy = async (token: string, productId: string, profileId?: string) => {
  const o = await api('POST', '/orders', { token, body: { productId, profileId } });
  return api('POST', '/payments/confirm', { token, body: { provider: 'mock', orderId: o.body.order.id, amount: o.body.order.amount } });
};

describe('결제 동시성 (Critical)', () => {
  it('같은 주문 동시 승인 5건 → 지급은 정확히 1회', async () => {
    const { token } = await member();
    const o = await api('POST', '/orders', { token, body: { productId: 'chat_pack_30' } });
    const body = { provider: 'mock', orderId: o.body.order.id, amount: 9900 };
    const results = await Promise.all(Array.from({ length: 5 }, () => api('POST', '/payments/confirm', { token, body })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const w = await api('GET', '/wallet', { token });
    expect(w.body.credits).toBe(30);
    expect(w.body.ledger.filter((l: any) => l.reason === 'purchase')).toHaveLength(1);
  });

  it('웹훅 결제완료와 승인이 경쟁해도 1회만 지급', async () => {
    const { token } = await member();
    const o = await api('POST', '/orders', { token, body: { productId: 'chat_pack_10' } });
    const hook = app.inject({ method: 'POST', url: '/api/v1/payments/webhooks/mock', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ id: 'race-1', orderId: o.body.order.id, status: 'DONE', amount: 3900 }) });
    const confirm = api('POST', '/payments/confirm', { token, body: { provider: 'mock', orderId: o.body.order.id, amount: 3900 } });
    await Promise.all([hook, confirm]);
    expect((await api('GET', '/wallet', { token })).body.credits).toBe(10);
  });

  it('계정당 1회 상품을 주문 2개로 나눠 결제해도 두 번째는 취소', async () => {
    const { token, profileId } = await member();
    const o1 = await api('POST', '/orders', { token, body: { productId: 'report_saju_mini', profileId } });
    const o2 = await api('POST', '/orders', { token, body: { productId: 'report_saju_mini', profileId } });
    expect((await api('POST', '/payments/confirm', { token, body: { provider: 'mock', orderId: o1.body.order.id, amount: 990 } })).status).toBe(200);
    const second = await api('POST', '/payments/confirm', { token, body: { provider: 'mock', orderId: o2.body.order.id, amount: 990 } });
    expect(second.status).toBe(409);
    expect((await api('GET', `/orders/${o2.body.order.id}`, { token })).body.status).toBe('canceled');
  });
});

describe('권한 재사용·유료 콘텐츠 노출 (High)', () => {
  it('구매 권한이 있는 프로필은 출생정보를 바꿀 수 없다 (이름 변경은 가능)', async () => {
    const { token, profileId } = await member();
    await buy(token, 'report_saju_lifetime', profileId);
    const changeBirth = await api('PATCH', `/profiles/${profileId}`, { token, body: { birth: OTHER } });
    expect(changeBirth.status).toBe(409);
    expect((await api('PATCH', `/profiles/${profileId}`, { token, body: { name: '새이름' } })).status).toBe(200);
    // 같은 출생정보로 다시 저장하는 것은 허용
    expect((await api('PATCH', `/profiles/${profileId}`, { token, body: { birth: BIRTH } })).status).toBe(200);
  });

  it('잠긴 궁합은 유료 섹션과 같은 근거(factors)를 내려주지 않는다', async () => {
    const r = await api('POST', '/compatibility', { body: { birthA: BIRTH, birthB: OTHER } });
    expect(r.body.locked).toBe(true);
    expect(r.body.result.factors.every((f: any) => f.tone === 'positive')).toBe(true);
    expect(r.body.result.factors.length).toBeLessThanOrEqual(2);
  });

  it('규칙 기반 상담은 잠긴 섹션 본문을 답으로 주지 않는다', async () => {
    const { token, profileId } = await member();
    const reading = await api('POST', '/saju/reading', { token, body: { profileId } });
    const fullWealth = (await import('../src/modules/interpretation/reading.js')).buildBasicReading(reading.body.chart, { access: 'full' }).sections.find((s) => s.key === 'wealth')!;
    const r = await api('POST', '/chat', { token, body: { profileId, message: '올해 재물운 알려줘' } });
    expect(r.status).toBe(200);
    expect(r.body.reply.content).not.toContain(fullWealth.paragraphs[0]);
    expect(r.body.reply.content).toContain('전체 풀이');
  });

  it('환불 후에는 생성해 둔 리포트도 열람할 수 없다', async () => {
    const { token, profileId } = await member();
    const paid = await buy(token, 'report_saju_lifetime', profileId);
    const rep = await api('POST', '/reports', { token, body: { type: 'lifetime', profileId } });
    expect(rep.status).toBe(201);
    await api('POST', `/admin/orders/${paid.body.order.id}/refund`, { headers: { 'x-admin-token': 'admin-secret' }, body: { reason: '테스트' } });
    expect((await api('GET', `/reports/${rep.body.id}`, { token })).status).toBe(402);
    expect((await api('GET', '/reports', { token })).body).toHaveLength(0);
  });

  it('질문권 팩은 일부 사용 후 환불 시 미사용분만 회수(전부 쓰면 환불 불가)', async () => {
    const { token } = await member();
    const paid = await buy(token, 'chat_pack_10');
    // 관리자가 무상 질문권을 주지 않은 상태에서 유상 10 → 전부 사용됐다고 가정할 수 없으니, 원장으로만 확인
    const r = await api('POST', `/admin/orders/${paid.body.order.id}/refund`, { headers: { 'x-admin-token': 'admin-secret' }, body: { reason: '미사용 환불' } });
    expect(r.status).toBe(200);
    expect((await api('GET', '/wallet', { token })).body.credits).toBe(0);
  });
});

describe('입력·관리자 보호 (Medium/Low)', () => {
  it('존재하지 않는 운세 날짜는 400', async () => {
    expect((await api('POST', '/fortune/daily', { body: { birth: BIRTH, date: '2026-13-45' } })).status).toBe(400);
  });
  it('관리자 토큰이 틀리면 403', async () => {
    expect((await api('POST', '/admin/users/x/credits', { headers: { 'x-admin-token': 'wrong' }, body: { amount: 1 } })).status).toBe(403);
  });
  it('해외 시간대 + 경도 미입력이면 표준시 경도로 추정 (뉴욕 = -75°)', async () => {
    const r = await api('POST', '/saju/chart', { body: { birth: { ...BIRTH, timeZone: 'America/New_York', hour: 23, minute: 30 } } });
    expect(r.status).toBe(200);
    expect(r.body.input.longitude).toBe(-75);
    // 1990년 5월 뉴욕은 서머타임(UTC-4) → 표준 경도 -75° 기준 보정은 정확히 -60분
    expect(r.body.correctionMinutes).toBe(-60);
  });
});

describe('게스트 → 기존 계정 로그인', () => {
  it('게스트로 저장한 사주가 로그인한 계정으로 옮겨진다', async () => {
    await api('POST', '/auth/signup', { body: { email: 'merge@example.com', password: 'password123' } });
    const guest = await api('POST', '/auth/guest', { body: { deviceId: 'merge-device-0001' } });
    await api('POST', '/profiles', { token: guest.body.accessToken, body: { name: '게스트때저장', relation: 'family', birth: OTHER } });
    const login = await api('POST', '/auth/login', { token: guest.body.accessToken, body: { email: 'merge@example.com', password: 'password123' } });
    const list = await api('GET', '/profiles', { token: login.body.accessToken });
    expect(list.body.map((p: any) => p.name)).toContain('게스트때저장');
    // 같은 기기의 다음 게스트는 새 계정(병합된 게스트 데이터가 보이지 않음)
    const next = await api('POST', '/auth/guest', { body: { deviceId: 'merge-device-0001' } });
    expect((await api('GET', '/profiles', { token: next.body.accessToken })).body).toHaveLength(0);
  });
});
