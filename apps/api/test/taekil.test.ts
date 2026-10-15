import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { seedProducts } from '../src/db/seed.js';
import { CATALOG } from '../src/modules/commerce/catalog.js';

let app: FastifyInstance;
const BIRTH = { calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' } as const;
const PARTNER = { calendar: 'solar', year: 1992, month: 8, day: 20, hour: 9, minute: 15, gender: 'female' } as const;

beforeAll(async () => {
  const config = loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: '', SIGNUP_BONUS_CREDITS: '0' });
  const { db } = createDb(':memory:');
  runMigrations(db);
  seedProducts(db);
  app = await buildApp({ config, db, logger: false });
});
afterAll(async () => {
  await app.close();
});

const api = async (method: 'GET' | 'POST' | 'DELETE', url: string, opts: { token?: string; body?: unknown } = {}) => {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null };
};

/** 오늘(KST)로부터 n일 뒤 'YYYY-MM-DD' — 택일은 지난 날짜를 받지 않으므로 테스트 날짜를 오늘 기준으로 잡는다 */
const kstDay = (n: number) => new Date(Date.now() + 9 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

describe('택일', () => {
  let guest: string;
  let token: string;
  let profileId: string;
  let partnerId: string;
  let previewId: string;

  beforeAll(async () => {
    guest = (await api('POST', '/auth/guest', { body: { deviceId: 'taekil-device-0001' } })).body.accessToken;
    profileId = (await api('POST', '/profiles', { token: guest, body: { name: '민수', relation: 'self', birth: BIRTH } })).body.id;
    partnerId = (await api('POST', '/profiles', { token: guest, body: { name: '지현', relation: 'partner', birth: PARTNER } })).body.id;
  });

  it('상품 — 990원, 결과 1건을 여는 상품, 스토어 ID', async () => {
    const p = (await api('GET', '/products')).body.find((x: any) => x.id === 'report_taekil');
    expect(p).toMatchObject({ price: 990, requiresReading: true, requiresProfile: false, iosProductId: 'kr.dalbitsaju.report.taekil', androidProductId: 'report_taekil', grants: ['taekil:reading'] });
    // 스토어 상품 ID 규칙: iOS 는 kr.dalbitsaju.*, Android 는 카탈로그 ID 와 같다
    for (const c of CATALOG.filter((x) => x.iosProductId)) {
      expect(c.iosProductId).toMatch(/^kr\.dalbitsaju\./);
      expect(c.androidProductId).toBe(c.id);
    }
  });

  it('무료 미리보기 — 날짜마다 등급과 Top 3 날짜만, 근거·점수·조언은 잠김', async () => {
    const r = await api('POST', '/taekil', { token: guest, body: { profileId, purpose: 'move', from: kstDay(3), to: kstDay(62) } });
    expect(r.status).toBe(201);
    const b = r.body;
    previewId = b.id;
    expect(b).toMatchObject({ purpose: 'move', purposeLabel: '이사', mode: 'range', locked: true, productId: 'report_taekil', generator: 'rule', profileName: '민수' });
    expect(b.days).toHaveLength(60);
    expect(b.title).toContain('민수님의 이사 택일');
    expect(b.basis).toMatch(/^일주 庚辰 · 띠 말\(午\) · 용신/);
    expect(b.top.length).toBe(3);
    expect(b.headline).toContain('가장 좋은 날은');
    expect(Object.values(b.counts as Record<string, number>).reduce((a, x) => a + x, 0)).toBe(60);
    for (const d of b.days) {
      expect(['best', 'good', 'normal', 'caution', 'avoid']).toContain(d.grade);
      expect(d.score).toBeNull();
      expect(d.reasons).toBeNull();
      expect(d.summary).toBeNull();
      expect(d.dropReason).toBeNull();
      expect(d.goodHours).toBeNull();
      expect(d.officer).toBeNull();
    }
    expect(b.days.filter((d: any) => d.rank !== null).map((d: any) => d.date).sort()).toEqual([...b.top].sort());
    expect(b.sections.map((s: any) => s.key)).toEqual(['taekil_overview', 'taekil_advice', 'taekil_turn', 'taekil_dropped']);
    expect(b.sections.every((s: any) => s.locked === true && s.unlockProductId === 'report_taekil')).toBe(true);
    // 종합 분석만 첫 문단(등급 개수) 미리보기, 나머지는 문단 없음
    expect(b.sections[0].paragraphs).toHaveLength(1);
    expect(b.sections[0].paragraphs[0]).toMatch(/아주 좋은 날 \d+일, 좋은 날 \d+일/);
    expect(b.sections.slice(1).every((s: any) => s.paragraphs.length === 0)).toBe(true);
  });

  it('같은 입력은 저장본으로, 목록에 잠김 표시', async () => {
    const again = await api('POST', '/taekil', { token: guest, body: { profileId, purpose: 'move', from: kstDay(3), to: kstDay(62) } });
    expect(again.body.id).toBe(previewId);
    const list = await api('GET', '/taekil', { token: guest });
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id: previewId, purpose: 'move', locked: true });
  });

  it('입력 검증 — 지난 날짜, 92일 초과, 후보 1개, 기간·후보 동시, 남의 프로필', async () => {
    const bad = (body: object) => api('POST', '/taekil', { token: guest, body: { profileId, purpose: 'contract', ...body } });
    expect((await bad({ from: kstDay(-3), to: kstDay(10) })).status).toBe(400);
    expect((await bad({ from: kstDay(1), to: kstDay(93) })).status).toBe(400);
    expect((await bad({ dates: [kstDay(5)] })).status).toBe(400);
    expect((await bad({ dates: [kstDay(5), kstDay(5)] })).status).toBe(400);
    expect((await bad({ dates: Array.from({ length: 11 }, (_, i) => kstDay(i + 1)) })).status).toBe(400);
    expect((await bad({ from: kstDay(1), to: kstDay(10), dates: [kstDay(2), kstDay(3)] })).status).toBe(400);
    expect((await bad({ from: kstDay(1), to: kstDay(800) })).status).toBe(400);
    expect((await api('POST', '/taekil', { token: guest, body: { profileId, purpose: 'nap', from: kstDay(1), to: kstDay(5) } })).status).toBe(400);
    const other = (await api('POST', '/auth/guest', { body: { deviceId: 'taekil-device-0002' } })).body.accessToken;
    expect((await api('POST', '/taekil', { token: other, body: { profileId, purpose: 'move', from: kstDay(1), to: kstDay(5) } })).status).toBe(404);
    expect((await api('GET', `/taekil/${previewId}`, { token: other })).status).toBe(404);
    expect((await api('GET', '/taekil')).status).toBe(401);
  });

  it('후보 날짜 비교 + 결혼 상대 사주', async () => {
    const dates = [kstDay(20), kstDay(9), kstDay(14), kstDay(30)];
    const r = await api('POST', '/taekil', { token: guest, body: { profileId, partnerProfileId: partnerId, purpose: 'wedding', dates } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ mode: 'dates', partnerName: '지현', from: kstDay(9), to: kstDay(30) });
    expect(r.body.title).toBe('민수·지현님의 결혼 택일');
    expect(r.body.days.map((d: any) => d.date)).toEqual([...dates].sort());
    expect(r.body.top.length).toBeLessThanOrEqual(3);
    // 결혼이 아니면 상대는 쓰지 않는다
    const move = await api('POST', '/taekil', { token: guest, body: { profileId, partnerProfileId: partnerId, purpose: 'move', dates } });
    expect(move.body.partnerName).toBeNull();
  });

  it('결제 — 게스트는 로그인 필요, readingId 없거나 남의 결과면 거절, 결제하면 그 결과 하나만 열린다', async () => {
    expect((await api('POST', '/orders', { token: guest, body: { productId: 'report_taekil', readingId: previewId } })).status).toBe(403);
    const signup = await api('POST', '/auth/signup', { token: guest, body: { email: 'taekil@example.com', password: 'password123', nickname: '민수' } });
    expect(signup.status).toBe(201);
    token = signup.body.accessToken;
    // 게스트로 만든 미리보기가 회원 계정으로 옮겨진다
    expect((await api('GET', `/taekil/${previewId}`, { token })).body.locked).toBe(true);

    expect((await api('POST', '/orders', { token, body: { productId: 'report_taekil' } })).status).toBe(400);
    const stranger = (await api('POST', '/auth/signup', { body: { email: 'taekil-other@example.com', password: 'password123' } })).body.accessToken;
    expect((await api('POST', '/orders', { token: stranger, body: { productId: 'report_taekil', readingId: previewId } })).status).toBe(404);
    // 타로 상품으로 택일 결과를 열 수 없다
    expect((await api('POST', '/orders', { token, body: { productId: 'tarot_question_3', readingId: previewId } })).status).toBe(404);

    const o = await api('POST', '/orders', { token, body: { productId: 'report_taekil', readingId: previewId } });
    expect(o.status).toBe(201);
    expect(o.body.order.amount).toBe(990);
    const c = await api('POST', '/payments/confirm', { token, body: { provider: 'mock', orderId: o.body.order.id, amount: 990, paymentKey: 'mock_taekil_1' } });
    expect(c.status).toBe(200);
    expect(c.body.granted.entitlements).toEqual([`taekil:reading:${previewId}`]);

    const opened = (await api('GET', `/taekil/${previewId}`, { token })).body;
    expect(opened.locked).toBe(false);
    expect(opened.generator).toBe('rule');
    expect(opened.sections.every((s: any) => !s.locked && s.paragraphs.length > 0)).toBe(true);
    expect(opened.sections.find((s: any) => s.key === 'taekil_advice').title).toBe('이사 맞춤 조언');
    for (const d of opened.days) {
      expect(typeof d.score).toBe('number');
      expect(d.reasons.length).toBeGreaterThan(0);
      expect(d.summary.length).toBeGreaterThan(5);
      expect(d.officer).not.toBeNull();
      if (d.rank === null) expect(d.dropReason.length).toBeGreaterThan(5);
      else {
        expect(d.dropReason).toBeNull();
        expect(d.goodHours.length).toBeGreaterThan(0);
      }
    }
    // 탈락일은 이유에 탈락 사유가 들어 있다
    const excluded = opened.days.find((d: any) => d.reasons.some((x: any) => x.excludes));
    expect(excluded.grade).toBe('avoid');
    expect(excluded.dropReason).toContain('후보에서 빼요');
    // 등급·Top 3 는 미리보기와 같다
    const preview = (await api('GET', '/taekil', { token })).body.find((x: any) => x.id === previewId);
    expect(preview.locked).toBe(false);
    expect(preview.top).toEqual(opened.top);

    // 다른 택일 결과는 여전히 잠겨 있다(결과 1건 단위)
    const other = await api('POST', '/taekil', { token, body: { profileId, purpose: 'opening', from: kstDay(5), to: kstDay(20) } });
    expect(other.body.locked).toBe(true);
  });

  it('리포트 목록·조회에는 섞이지 않는다', async () => {
    const reports = await api('GET', '/reports', { token });
    expect(reports.body.every((r: any) => r.type !== 'taekil')).toBe(true);
    expect((await api('GET', `/reports/${previewId}`, { token })).status).toBe(402);
  });

  it('인앱결제(목업) — readingId 로 해당 결과를 연다', async () => {
    const r = await api('POST', '/taekil', { token, body: { profileId, purpose: 'travel', dates: [kstDay(7), kstDay(8), kstDay(9)] } });
    expect(r.body.locked).toBe(true);
    const v = await api('POST', '/payments/iap/verify', { token, body: { platform: 'android', productId: 'report_taekil', receipt: 'mock:tx-taekil-1', readingId: r.body.id } });
    expect(v.status).toBe(200);
    expect(v.body.granted.entitlements).toEqual([`taekil:reading:${r.body.id}`]);
    expect((await api('GET', `/taekil/${r.body.id}`, { token })).body.locked).toBe(false);
  });
});
