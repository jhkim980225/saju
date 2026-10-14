import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { seedProducts } from '../src/db/seed.js';

let app: FastifyInstance;
const BIRTH = { calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' } as const;
const PARTNER = { calendar: 'solar', year: 1992, month: 8, day: 21, hour: 9, minute: 0, gender: 'female' } as const;

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

const api = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) },
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null };
};

describe('공개 API', () => {
  it('health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
  it('공개 설정', async () => {
    const r = await api('GET', '/config');
    expect(r.status).toBe(200);
    expect(r.body.paymentProvider).toBe('mock');
    expect(r.body.ai.enabled).toBe(false);
  });
  it('비회원 원국 계산', async () => {
    const r = await api('POST', '/saju/chart', { body: { birth: BIRTH } });
    expect(r.status).toBe(200);
    expect(r.body.pillars.day.ganzhi.hanja).toBe('庚辰');
  });
  it('잘못된 날짜는 400', async () => {
    const r = await api('POST', '/saju/chart', { body: { birth: { ...BIRTH, month: 2, day: 30 } } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });
  it('비회원 기본 풀이는 유료 섹션이 잠겨 있다', async () => {
    const r = await api('POST', '/saju/reading', { body: { birth: BIRTH } });
    expect(r.status).toBe(200);
    const wealth = r.body.sections.find((s: any) => s.key === 'wealth');
    expect(wealth.locked).toBe(true);
    expect(wealth.unlockProductId).toBe('report_saju_mini');
    expect(r.body.sections.find((s: any) => s.key === 'personality').locked).toBeUndefined();
  });
  it('비회원 오늘의 운세', async () => {
    const r = await api('POST', '/fortune/daily', { body: { birth: BIRTH, date: '2026-10-12' } });
    expect(r.status).toBe(200);
    expect(r.body.categories).toHaveLength(5);
    expect(r.body.headline.length).toBeGreaterThan(3);
  });
  it('비회원 궁합 — 점수 공개, 상세 잠금', async () => {
    const r = await api('POST', '/compatibility', { body: { birthA: BIRTH, birthB: PARTNER, nameA: '민수', nameB: '지은' } });
    expect(r.status).toBe(200);
    expect(r.body.result.score).toBeGreaterThan(0);
    expect(r.body.locked).toBe(true);
  });
  it('만세력', async () => {
    const r = await api('GET', '/saju/manse?date=2027-02-04');
    expect(r.status).toBe(200);
    expect(r.body.solarTerms.length).toBe(24);
  });
  it('상품 목록', async () => {
    const r = await api('GET', '/products');
    expect(r.status).toBe(200);
    expect(r.body.map((p: any) => p.id)).toContain('report_saju_lifetime');
  });
});

describe('회원 흐름 — 게스트 → 가입 → 결제 → 리포트', () => {
  let guest: string;
  let token: string;
  let refresh: string;
  let profileId: string;
  let partnerId: string;

  it('게스트 시작 + 프로필 생성', async () => {
    const g = await api('POST', '/auth/guest', { body: { deviceId: 'device-test-0001' } });
    expect(g.status).toBe(200);
    guest = g.body.accessToken;
    const p = await api('POST', '/profiles', { token: guest, body: { name: '민수', relation: 'self', birth: BIRTH } });
    expect(p.status).toBe(201);
    expect(p.body.dayPillar).toBe('庚辰');
    expect(p.body.isPrimary).toBe(true);
    profileId = p.body.id;
  });

  it('게스트는 결제할 수 없다', async () => {
    const r = await api('POST', '/orders', { token: guest, body: { productId: 'report_saju_mini', profileId } });
    expect(r.status).toBe(403);
    expect(r.body.error.details.reason).toBe('LOGIN_REQUIRED');
  });

  it('가입하면 게스트 데이터가 유지된다', async () => {
    const r = await api('POST', '/auth/signup', { token: guest, body: { email: 'minsu@example.com', password: 'password123', nickname: '민수' } });
    expect(r.status).toBe(201);
    token = r.body.accessToken;
    refresh = r.body.refreshToken;
    expect(r.body.user.provider).toBe('email');
    const list = await api('GET', '/profiles', { token });
    expect(list.body).toHaveLength(1);
  });

  it('중복 가입 409, 잘못된 비밀번호 401', async () => {
    expect((await api('POST', '/auth/signup', { body: { email: 'minsu@example.com', password: 'password123' } })).status).toBe(409);
    expect((await api('POST', '/auth/login', { body: { email: 'minsu@example.com', password: 'wrong-pass' } })).status).toBe(401);
    expect((await api('POST', '/auth/login', { body: { email: 'minsu@example.com', password: 'password123' } })).status).toBe(200);
  });

  it('refresh token 회전 + 재사용 탐지', async () => {
    const r1 = await api('POST', '/auth/refresh', { body: { refreshToken: refresh } });
    expect(r1.status).toBe(200);
    const reuse = await api('POST', '/auth/refresh', { body: { refreshToken: refresh } });
    expect(reuse.status).toBe(401);
    // 재사용 탐지로 새 토큰도 폐기됨
    expect((await api('POST', '/auth/refresh', { body: { refreshToken: r1.body.refreshToken } })).status).toBe(401);
  });

  it('오늘의 운세 (대표 프로필)', async () => {
    const r = await api('GET', '/fortune/daily?date=2026-10-12', { token });
    expect(r.status).toBe(200);
    expect(r.body.profileId).toBe(profileId);
  });

  it('미니 리포트 결제(목업) → 재물·연애·직업 공개', async () => {
    const o = await api('POST', '/orders', { token, body: { productId: 'report_saju_mini', profileId } });
    expect(o.status).toBe(201);
    expect(o.body.checkout.amount).toBe(990);
    const c = await api('POST', '/payments/confirm', { token, body: { provider: 'mock', orderId: o.body.order.id, amount: 990, paymentKey: 'mock_pay_1' } });
    expect(c.status).toBe(200);
    expect(c.body.order.status).toBe('paid');
    expect(c.body.granted.entitlements).toEqual([`report:mini:${profileId}`]);
    const reading = await api('POST', '/saju/reading', { token, body: { profileId } });
    expect(reading.body.sections.find((s: any) => s.key === 'wealth').locked).toBeUndefined();
    expect(reading.body.sections.find((s: any) => s.key === 'daeun').locked).toBe(true);
    // 승인 재호출은 멱등
    const again = await api('POST', '/payments/confirm', { token, body: { provider: 'mock', orderId: o.body.order.id, amount: 990, paymentKey: 'mock_pay_1' } });
    expect(again.status).toBe(200);
  });

  it('계정당 1회 상품은 재구매 불가', async () => {
    const r = await api('POST', '/orders', { token, body: { productId: 'report_saju_mini', profileId } });
    expect(r.status).toBe(409);
  });

  it('금액 위변조는 400', async () => {
    const o = await api('POST', '/orders', { token, body: { productId: 'report_saju_lifetime', profileId } });
    const c = await api('POST', '/payments/confirm', { token, body: { provider: 'mock', orderId: o.body.order.id, amount: 100 } });
    expect(c.status).toBe(400);
    expect((await api('GET', `/orders/${o.body.order.id}`, { token })).body.status).toBe('failed');
  });

  it('승인 거절은 402', async () => {
    const o = await api('POST', '/orders', { token, body: { productId: 'chat_pack_10' } });
    const c = await api('POST', '/payments/confirm', { token, body: { provider: 'mock', orderId: o.body.order.id, amount: 3900, paymentKey: 'mock_fail' } });
    expect(c.status).toBe(402);
    expect(c.body.error.code).toBe('PAYMENT_FAILED');
  });

  it('평생 리포트 구매 전 402, 구매 후 생성 + 질문권 3회', async () => {
    const before = await api('POST', '/reports', { token, body: { type: 'lifetime', profileId } });
    expect(before.status).toBe(402);
    expect(before.body.error.details.productId).toBe('report_saju_lifetime');
    const o = await api('POST', '/orders', { token, body: { productId: 'report_saju_lifetime', profileId } });
    const c = await api('POST', '/payments/confirm', { token, body: { provider: 'mock', orderId: o.body.order.id, amount: 9900 } });
    expect(c.body.creditsBalance).toBe(3);
    // 결제가 확정되면 바로 만들어 보관함에 둔다 (AI 키가 없으면 규칙 기반 최종본)
    const prewarmed = await api('GET', '/reports', { token });
    expect(prewarmed.body).toHaveLength(1);
    const rep = await api('POST', '/reports', { token, body: { type: 'lifetime', profileId } });
    expect(rep.status).toBe(201);
    expect(rep.body.id).toBe(prewarmed.body[0].id);
    expect(rep.body).toMatchObject({ status: 'ready', generator: 'rule', progress: null });
    expect(rep.body.sections.length).toBeGreaterThan(10);
    expect(rep.body.sections.every((s: any) => !s.locked)).toBe(true);
    expect((await api('GET', `/reports/${rep.body.id}/progress`, { token })).body).toEqual({ status: 'ready', progress: null });
    // 같은 조건이면 저장본 재사용
    const rep2 = await api('POST', '/reports', { token, body: { type: 'lifetime', profileId } });
    expect(rep2.body.id).toBe(rep.body.id);
    const list = await api('GET', '/reports', { token });
    expect(list.body).toHaveLength(1);
  });

  it('신년 패키지 → 신년운세 + 궁합 1회권 사용', async () => {
    const partner = await api('POST', '/profiles', { token, body: { name: '지은', relation: 'partner', birth: PARTNER } });
    partnerId = partner.body.id;
    const locked = await api('GET', `/fortune/yearly?profileId=${profileId}&year=2027`, { token });
    expect(locked.body.locked).toBe(true);
    const o = await api('POST', '/orders', { token, body: { productId: 'bundle_newyear_2027', profileId } });
    const c = await api('POST', '/payments/confirm', { token, body: { provider: 'mock', orderId: o.body.order.id, amount: o.body.order.amount } });
    expect(c.status).toBe(200);
    expect(c.body.creditsBalance).toBe(13);
    const yearly = await api('GET', `/fortune/yearly?profileId=${profileId}&year=2027`, { token });
    expect(yearly.body.locked).toBe(false);
    expect(yearly.body.yearPillar.hanja).toBe('丁未');
    const comp = await api('POST', '/reports', { token, body: { type: 'compatibility', profileId, partnerProfileId: partnerId } });
    expect(comp.status).toBe(201);
    // 티켓 사용 후 궁합 화면 잠금 해제
    const view = await api('POST', '/compatibility', { token, body: { profileIdA: profileId, profileIdB: partnerId } });
    expect(view.body.locked).toBe(false);
    // 다른 조합은 다시 402 (티켓 소진)
    const other = await api('POST', '/profiles', { token, body: { name: '친구', relation: 'friend', birth: { ...PARTNER, year: 1995 } } });
    const comp2 = await api('POST', '/reports', { token, body: { type: 'compatibility', profileId, partnerProfileId: other.body.id } });
    expect(comp2.status).toBe(402);
  });

  it('AI 미설정 시 상담은 규칙 기반 답변 + 질문권 차감 없음', async () => {
    const r = await api('POST', '/chat', { token, body: { profileId, message: '올해 이직해도 될까요?' } });
    expect(r.status).toBe(200);
    expect(r.body.generator).toBe('rule');
    expect(r.body.creditsLeft).toBe(13);
    const h = await api('GET', `/chat?profileId=${profileId}`, { token });
    expect(h.body).toHaveLength(2);
  });

  it('지갑 — 유상/무상 구분', async () => {
    const w = await api('GET', '/wallet', { token });
    expect(w.body.credits).toBe(13);
    expect(w.body.paidCredits).toBe(13);
    expect(w.body.entitlements.length).toBeGreaterThanOrEqual(3);
  });

  it('인앱결제(목업) 검증은 거래 ID 로 멱등', async () => {
    const body = { platform: 'ios', productId: 'kr.saju.chat.10', receipt: 'mock:tx-1001' };
    const r1 = await api('POST', '/payments/iap/verify', { token, body });
    expect(r1.status).toBe(200);
    expect(r1.body.creditsBalance).toBe(23);
    const r2 = await api('POST', '/payments/iap/verify', { token, body });
    expect(r2.body.creditsBalance).toBe(23);
  });

  it('관리자 환불 → 권한·질문권 회수', async () => {
    const orders = await api('GET', '/orders', { token });
    const lifetime = orders.body.find((o: any) => o.productId === 'report_saju_lifetime' && o.status === 'paid');
    expect((await api('POST', `/admin/orders/${lifetime.id}/refund`, { token, body: { reason: '테스트' } })).status).toBe(403);
    const r = await api('POST', `/admin/orders/${lifetime.id}/refund`, { headers: { 'x-admin-token': 'admin-secret' }, body: { reason: '단순 변심' } });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('refunded');
    const w = await api('GET', '/wallet', { token });
    expect(w.body.credits).toBe(20);
  });

  it('프로필 소유권 — 다른 사용자는 접근 불가', async () => {
    const other = await api('POST', '/auth/guest', { body: {} });
    const r = await api('GET', `/profiles/${profileId}`, { token: other.body.accessToken });
    expect(r.status).toBe(404);
  });

  it('회원 탈퇴 후 토큰은 무효', async () => {
    expect((await api('DELETE', '/auth/me', { token })).status).toBe(204);
    expect((await api('GET', '/auth/me', { token })).status).toBe(401);
    expect((await api('POST', '/auth/login', { body: { email: 'minsu@example.com', password: 'password123' } })).status).toBe(401);
  });
});

describe('Apple form_post 브리지', () => {
  it('POST 결과를 웹 콜백으로 302 리다이렉트', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/apple/form-post',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `code=abc&state=xyz&user=${encodeURIComponent(JSON.stringify({ name: { firstName: '서윤', lastName: '김' } }))}`,
    });
    expect(res.statusCode).toBe(302);
    const loc = new URL(res.headers.location as string);
    expect(loc.pathname).toBe('/auth/callback/apple');
    expect(loc.searchParams.get('code')).toBe('abc');
    expect(loc.searchParams.get('name')).toBe('김서윤');
  });
});

describe('웹훅 — 취소 시 회수, 결제 완료 시 복구', () => {
  it('mock 웹훅 취소 이벤트는 지급분을 회수하고 중복 이벤트는 무시', async () => {
    const g = await api('POST', '/auth/signup', { body: { email: 'hook@example.com', password: 'password123' } });
    const token = g.body.accessToken;
    const o = await api('POST', '/orders', { token, body: { productId: 'chat_pack_10' } });
    await api('POST', '/payments/confirm', { token, body: { provider: 'mock', orderId: o.body.order.id, amount: 3900 } });
    expect((await api('GET', '/wallet', { token })).body.credits).toBe(10);
    const hook = (id: string) =>
      app.inject({ method: 'POST', url: '/api/v1/payments/webhooks/mock', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ id, orderId: o.body.order.id, status: 'CANCELED' }) });
    expect((await hook('evt-1')).statusCode).toBe(200);
    expect((await api('GET', '/wallet', { token })).body.credits).toBe(0);
    expect(JSON.parse((await hook('evt-1')).body).duplicate).toBe(true);
    expect((await api('GET', `/orders/${o.body.order.id}`, { token })).body.status).toBe('canceled');
  });
});

describe('오늘의 운세 푸시 스케줄', () => {
  it('다음 08:00 KST 까지의 시간 계산', async () => {
    const { msUntilNextRun } = await import('../src/jobs/dailyPush.js');
    // 2026-10-12 07:00 KST = 2026-10-11 22:00 UTC → 1시간 뒤
    expect(msUntilNextRun(Date.UTC(2026, 9, 11, 22, 0))).toBe(3_600_000);
    // 08:00 KST 정각 직후면 다음 날
    expect(msUntilNextRun(Date.UTC(2026, 9, 11, 23, 0, 1))).toBe(86_400_000 - 1000);
  });
});

describe('웹훅 paid 복구 — 금액 검증', () => {
  it('금액이 다르면 지급하지 않고, 같으면 복구 지급', async () => {
    const g = await api('POST', '/auth/signup', { body: { email: 'recover@example.com', password: 'password123' } });
    const token = g.body.accessToken;
    const hook = (id: string, orderId: string, amount: number) =>
      app.inject({ method: 'POST', url: '/api/v1/payments/webhooks/mock', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ id, orderId, status: 'DONE', amount }) });
    const o1 = await api('POST', '/orders', { token, body: { productId: 'chat_pack_30' } });
    await hook('tamper-1', o1.body.order.id, 100);
    expect((await api('GET', `/orders/${o1.body.order.id}`, { token })).body.status).toBe('failed');
    expect((await api('GET', '/wallet', { token })).body.credits).toBe(0);
    const o2 = await api('POST', '/orders', { token, body: { productId: 'chat_pack_30' } });
    await hook('ok-1', o2.body.order.id, 9900);
    expect((await api('GET', `/orders/${o2.body.order.id}`, { token })).body.status).toBe('paid');
    expect((await api('GET', '/wallet', { token })).body.credits).toBe(30);
  });
});

describe('웹훅 위조 방지', () => {
  it('다른 결제사 주문은 웹훅으로 상태가 바뀌지 않는다', async () => {
    // 이 앱은 mock 결제사로 주문을 만든다 → portone 웹훅(서명 키 없음)은 검증 실패로 거부
    const res = await app.inject({ method: 'POST', url: '/api/v1/payments/webhooks/portone', headers: { 'content-type': 'application/json' }, payload: '{"type":"Transaction.Paid","data":{"paymentId":"x"}}' });
    expect(res.statusCode).toBe(400);
  });
});
