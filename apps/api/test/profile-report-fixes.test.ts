/**
 * 사주·프로필·리포트 알려진 이슈의 회귀 테스트 (2026-11-26 수정분, AI 키 없음 → 규칙 기반 최종본)
 * - 프로필: PATCH 의 관계 유지, 대표 넘기기, 50개 제한 동시 요청, 택일 구매 뒤 출생 정보 수정 차단
 * - 만세력: /saju/years 기본 범위의 KST 기준 연도
 * - 리포트: 궁합 A×B·B×A 재사용과 동시 생성, 상품 없는 연도, 낡은 저장본 갱신, 평생 권한이 있는 프로필의 미니 구매 차단,
 *   프로필 삭제 전 산 리포트 만들어 두기, 무료 궁합의 같은 프로필 두 번
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { App } from '../src/app.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations, type Db } from '../src/db/local.js';
import { entitlements, profiles, reports } from '../src/db/schema.js';
import { seedProducts } from '../src/db/seed.js';
import { newId } from '../src/lib/ids.js';

let app: App;
let db: Db;
const BIRTH = { calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' } as const;
const OTHER = { calendar: 'solar', year: 1992, month: 8, day: 21, hour: 9, minute: 0, gender: 'female' } as const;

beforeAll(async () => {
  const config = loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: '', SIGNUP_BONUS_CREDITS: '0' });
  db = createDb(':memory:').db;
  await runMigrations(db);
  await seedProducts(db);
  app = await buildApp({ config, db });
});
afterAll(async () => {
  await app.close();
});
afterEach(() => {
  vi.useRealTimers();
});

const api = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, opts: { token?: string; body?: unknown } = {}) => {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null };
};

let seq = 0;
const userIds = new Map<string, string>();
async function member() {
  const r = await api('POST', '/auth/signup', { body: { email: `fixes${++seq}@example.com`, password: 'password123', nickname: '테스트' } });
  userIds.set(r.body.accessToken, r.body.user.id);
  return r.body.accessToken as string;
}
async function profile(token: string, name = '민수', birth: object = BIRTH, relation = 'self') {
  const r = await api('POST', '/profiles', { token, body: { name, relation, birth } });
  expect(r.status).toBe(201);
  return r.body.id as string;
}
async function buy(token: string, productId: string, body: Record<string, unknown>) {
  const o = await api('POST', '/orders', { token, body: { productId, ...body } });
  expect(o.status).toBe(201);
  const c = await api('POST', '/payments/confirm', { token, body: { provider: 'mock', orderId: o.body.order.id, amount: o.body.order.amount } });
  expect(c.status).toBe(200);
}
const listProfiles = async (token: string) => (await api('GET', '/profiles', { token })).body as { id: string; name: string; relation: string; isPrimary: boolean }[];
const userIdOf = async (token: string) => userIds.get(token)!;

describe('프로필', () => {
  it('PATCH 에서 관계를 빼면 관계를 바꾸지 않는다(이름만 수정)', async () => {
    const token = await member();
    await profile(token, '나');
    const id = await profile(token, '지은', OTHER, 'partner');
    const r = await api('PATCH', `/profiles/${id}`, { token, body: { name: '지은이' } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: '지은이', relation: 'partner', isPrimary: false });
  });

  it('대표를 지우거나 대표를 끄면 다른 사주(본인 우선)를 대표로 올린다. 하나뿐이면 대표로 남긴다', async () => {
    const token = await member();
    const me = await profile(token, '나');
    const friend = await profile(token, '친구', OTHER, 'friend');
    const me2 = await profile(token, '나2', { ...BIRTH, year: 1991 }, 'self');
    // 본인 관계로 나중에 저장한 사주가 대표다
    expect((await listProfiles(token)).find((p) => p.isPrimary)?.id).toBe(me2);

    // 대표를 끄면 남은 사주 중 관계가 '본인'인 사주가 대표가 된다
    expect((await api('PATCH', `/profiles/${me2}`, { token, body: { isPrimary: false } })).body.isPrimary).toBe(false);
    expect((await listProfiles(token)).filter((p) => p.isPrimary).map((p) => p.id)).toEqual([me]);

    // 대표를 지우면 남은 사주가 대표가 된다
    expect((await api('DELETE', `/profiles/${me}`, { token })).status).toBe(204);
    expect((await listProfiles(token)).filter((p) => p.isPrimary).map((p) => p.id)).toEqual([me2]);
    expect((await api('DELETE', `/profiles/${me2}`, { token })).status).toBe(204);
    expect((await listProfiles(token)).filter((p) => p.isPrimary).map((p) => p.id)).toEqual([friend]);

    // 하나만 남았으면 대표를 끌 수 없다(대표가 비지 않게)
    expect((await api('PATCH', `/profiles/${friend}`, { token, body: { isPrimary: false } })).body.isPrimary).toBe(true);
  });

  it('50개 제한은 동시에 저장해도 넘지 않는다', async () => {
    const token = await member();
    const userId = await userIdOf(token);
    // 48개는 바로 넣어 둔다 — D1 은 한 문장에 변수 100개까지라 여섯 개씩 나눠 넣는다
    const rows = Array.from({ length: 48 }, (_, i) => ({ id: newId(), userId, name: `사람${i}`, relation: 'other', isPrimary: i === 0, gender: 'male', calendar: 'solar', birthYear: 1990, birthMonth: 1, birthDay: 1 + (i % 28) }));
    for (let i = 0; i < rows.length; i += 6) await db.insert(profiles).values(rows.slice(i, i + 6));
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => api('POST', '/profiles', { token, body: { name: `추가${i}`, relation: 'friend', birth: BIRTH } })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status !== 201).every((r) => r.status === 400 || r.status === 409)).toBe(true);
    expect(await listProfiles(token)).toHaveLength(50);
  });

  it('택일 상세를 산 사주(본인·상대)는 출생 정보를 바꿀 수 없다. 이름은 바꿀 수 있다', async () => {
    const token = await member();
    const userId = await userIdOf(token);
    const me = await profile(token, '나');
    const partner = await profile(token, '지은', OTHER, 'partner');
    const readingId = newId();
    await db.insert(reports).values({ id: readingId, userId, profileId: me, partnerProfileId: partner, type: 'taekil', year: null, title: '택일', content: [], generator: 'rule', model: null });
    // 상세를 열기 전(권한 없음)에는 막지 않는다
    expect((await api('PATCH', `/profiles/${partner}`, { token, body: { birth: { ...OTHER, day: 22 } } })).status).toBe(200);
    await db.insert(entitlements).values({ id: newId(), userId, key: `taekil:reading:${readingId}`, orderId: null });
    for (const id of [me, partner]) {
      expect((await api('PATCH', `/profiles/${id}`, { token, body: { birth: { ...BIRTH, day: 20 } } })).status).toBe(409);
      expect((await api('PATCH', `/profiles/${id}`, { token, body: { name: '새이름' } })).status).toBe(200);
    }
  });
});

describe('세운 목록 기본 범위', () => {
  it('기준 연도는 KST — 1월 1일 01:00 KST(전날 16:00 UTC)에는 새해가 기준이다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-31T16:00:00Z'));
    const r = await api('POST', '/saju/years', { body: { birth: BIRTH } });
    expect(r.status).toBe(200);
    const years = (r.body as { year: number }[]).map((y) => y.year);
    expect(years[0]).toBe(2025);
    expect(years[years.length - 1]).toBe(2034);
  });
});

describe('궁합 리포트: 두 사람 순서', () => {
  it('A×B 로 산 뒤 B×A 로 열어도 같은 리포트를 쓴다', async () => {
    const token = await member();
    const me = await profile(token);
    const partner = await profile(token, '지은', OTHER, 'partner');
    await buy(token, 'report_compat', { profileId: me, partnerProfileId: partner });
    const ab = await api('POST', '/reports', { token, body: { type: 'compatibility', profileId: me, partnerProfileId: partner } });
    const ba = await api('POST', '/reports', { token, body: { type: 'compatibility', profileId: partner, partnerProfileId: me } });
    expect(ba.status).toBe(201);
    expect(ba.body.id).toBe(ab.body.id);
    expect((await api('GET', '/reports', { token })).body).toHaveLength(1);
  });

  it('A×B 와 B×A 를 동시에 처음 만들어도 하나만 남는다', async () => {
    const token = await member();
    const me = await profile(token);
    const partner = await profile(token, '지은', OTHER, 'partner');
    await buy(token, 'report_compat', { profileId: me, partnerProfileId: partner });
    // 결제 직후 미리 만든 것을 지워 '아직 없음'에서 시작한다
    await db.delete(reports).where(eq(reports.profileId, me));
    const [ab, ba] = await Promise.all([
      api('POST', '/reports', { token, body: { type: 'compatibility', profileId: me, partnerProfileId: partner } }),
      api('POST', '/reports', { token, body: { type: 'compatibility', profileId: partner, partnerProfileId: me } }),
    ]);
    expect(ab.status).toBe(201);
    expect(ba.status).toBe(201);
    expect(ba.body.id).toBe(ab.body.id);
    expect((await api('GET', '/reports', { token })).body).toHaveLength(1);
  });

  it('무료 궁합에 같은 프로필을 두 번 보내면 400', async () => {
    const token = await member();
    const me = await profile(token);
    expect((await api('POST', '/compatibility', { token, body: { profileIdA: me, profileIdB: me } })).status).toBe(400);
  });
});

describe('신년운세 리포트 — 상품이 없는 연도', () => {
  it('판매하는 해는 402 + 상품 ID, 상품이 없는 해는 없는 상품 ID 대신 400', async () => {
    const token = await member();
    const me = await profile(token);
    const sold = await api('POST', '/reports', { token, body: { type: 'yearly', profileId: me, year: 2027 } });
    expect(sold.status).toBe(402);
    expect(sold.body.error.details).toMatchObject({ productId: 'report_newyear_2027' });
    const none = await api('POST', '/reports', { token, body: { type: 'yearly', profileId: me, year: 2030 } });
    expect(none.status).toBe(400);
    expect(none.body.error.message).toBe('2030년 신년운세는 판매하지 않아요.');
    // 무료 미리보기는 어느 해든 열린다
    expect((await api('GET', `/fortune/yearly?profileId=${me}&year=2030`, { token })).status).toBe(200);
  });
});

describe('저장본 갱신', () => {
  it('프로필 이름을 바꾸면 다음 열람 때 제목과 본문을 새 이름으로 다시 만든다', async () => {
    const token = await member();
    const me = await profile(token, '민수');
    await buy(token, 'report_saju_lifetime', { profileId: me });
    const [saved] = (await api('GET', '/reports', { token })).body;
    expect(saved.title).toBe('민수님의 사주분석서');
    await api('PATCH', `/profiles/${me}`, { token, body: { name: '민준' } });
    const opened = await api('GET', `/reports/${saved.id}`, { token });
    expect(opened.body).toMatchObject({ id: saved.id, title: '민준님의 사주분석서', status: 'ready' });
    expect(JSON.stringify(opened.body.sections)).not.toContain('민수');
  });

  it('만든 해와 지금의 기준 연도가 다르면 같은 행을 지금 기준으로 다시 만든다(신년운세는 연도가 정해져 있어 그대로)', async () => {
    const token = await member();
    const me = await profile(token, '민수');
    await buy(token, 'bundle_newyear_2027', { profileId: me });
    const list = (await api('GET', '/reports', { token })).body as { id: string; type: string }[];
    const lifetime = list.find((r) => r.type === 'lifetime')!;
    const yearly = list.find((r) => r.type === 'yearly')!;
    const old = new Date('2025-11-01T00:00:00Z').getTime(); // 그때 기준은 '올해 2025, 대상 2026'
    await db.update(reports).set({ createdAt: old }).where(eq(reports.userId, await userIdOf(token)));

    const opened = await api('POST', '/reports', { token, body: { type: 'lifetime', profileId: me } });
    expect(opened.body.id).toBe(lifetime.id);
    expect(new Date(opened.body.createdAt).getTime()).toBeGreaterThan(old);
    const after = (await db.select().from(reports).where(eq(reports.id, lifetime.id)))[0]!;
    expect(after.createdAt).toBeGreaterThan(old);

    // 신년운세는 연도가 정해진 문서라 다시 만들지 않는다
    const y = await api('GET', `/reports/${yearly.id}`, { token });
    expect(new Date(y.body.createdAt).getTime()).toBe(old);
  });
});

describe('미니 리포트', () => {
  it('평생 사주분석서가 있는 프로필에는 미니 리포트를 살 수 없다(계정당 1회 기회를 지킨다)', async () => {
    const token = await member();
    const me = await profile(token);
    const other = await profile(token, '지은', OTHER, 'partner');
    await buy(token, 'report_saju_lifetime', { profileId: me });
    const r = await api('POST', '/orders', { token, body: { productId: 'report_saju_mini', profileId: me } });
    expect(r.status).toBe(409);
    expect(r.body.error.details).toMatchObject({ reason: 'ALREADY_OWNED' });
    // 다른 프로필에는 살 수 있다
    expect((await api('POST', '/orders', { token, body: { productId: 'report_saju_mini', profileId: other } })).status).toBe(201);
  });
});

describe('프로필 삭제', () => {
  it('지우기 전에 산 리포트 중 아직 없는 것을 만들어 보관함에 남긴다', async () => {
    const token = await member();
    const me = await profile(token, '나');
    const partner = await profile(token, '지은', OTHER, 'partner');
    await buy(token, 'report_saju_lifetime', { profileId: partner });
    await buy(token, 'report_compat', { profileId: me, partnerProfileId: partner });
    // 결제 직후 미리 만들기가 실패했다고 보고 저장본을 지운다
    await db.delete(reports).where(eq(reports.userId, await userIdOf(token)));
    expect((await api('DELETE', `/profiles/${partner}`, { token })).status).toBe(204);
    const list = (await api('GET', '/reports', { token })).body as { id: string; type: string; profileName: string }[];
    expect(list.map((r) => r.type).sort()).toEqual(['compatibility', 'lifetime']);
    const lifetime = list.find((r) => r.type === 'lifetime')!;
    expect(lifetime.profileName).toBe('삭제된 프로필');
    // 본문은 그대로 열린다(근거 표에 쓰는 원국은 프로필이 없어 다시 계산할 수 없다)
    expect((await api('GET', `/reports/${lifetime.id}`, { token })).status).toBe(200);
    expect((await api('POST', '/saju/chart', { token, body: { profileId: partner } })).status).toBe(404);
  });
});
