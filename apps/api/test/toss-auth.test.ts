import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/local.js';
import { seedProducts } from '../src/db/seed.js';
import { users } from '../src/db/schema.js';
import { createFakeToss } from './helpers/tossFake.js';

const BIRTH = { calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' } as const;
const ENV = { __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: '', TOSS_USER_KEY_SECRET: 'test-toss-user-key-secret-0123456789' };

const makeApi =
  (app: App) =>
  async (method: 'GET' | 'POST' | 'DELETE', url: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await app.inject({ method, url: `/api/v1${url}`, headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {}, ...(opts.body !== undefined ? { payload: opts.body as object } : {}) });
    return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null };
  };

describe('토스 미니앱 로그인 (사용자 식별키 인증 코드)', () => {
  const toss = createFakeToss();
  const { db } = createDb(':memory:');
  let api: ReturnType<typeof makeApi>;

  beforeAll(async () => {
    await runMigrations(db);
    await seedProducts(db);
    api = makeApi(buildApp({ config: loadConfig(ENV), db, deps: { tossFetch: toss.fetch } }));
    toss.codes.set('code-a1', 'anon-key-A').set('code-a2', 'anon-key-A').set('code-a3', 'anon-key-A').set('code-b1', 'anon-key-B').set('code-c1', 'anon-key-C').set('code-c2', 'anon-key-C').set('code-d1', 'anon-key-D');
  });

  it('공개 설정에 토스 기능이 켜진 것으로 나온다', async () => {
    const r = await api('GET', '/config');
    expect(r.body.features.tossAuth).toBe(true);
    expect(r.body.features.tossRewards).toBe(true);
    // 상품 SKU 를 연결하지 않았으므로 인앱 결제는 꺼져 있다
    expect(r.body.features.tossIap).toBe(false);
  });

  it('인증 코드로 로그인하면 기존 로그인과 같은 토큰 형식을 받는다', async () => {
    const r = await api('POST', '/auth/toss', { body: { code: 'code-a1' } });
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toBeTruthy();
    expect(r.body.refreshToken).toBeTruthy();
    expect(r.body.expiresIn).toBeGreaterThan(0);
    expect(r.body.user.provider).toBe('toss');
    const me = await api('GET', '/auth/me', { token: r.body.accessToken });
    expect(me.body.id).toBe(r.body.user.id);
    // 토스 서버에는 코드만 보낸다
    expect(toss.calls.at(-1)).toEqual({ url: 'https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss/users/anon-key/exchange', body: { code: 'code-a1' } });
  });

  it('식별키 원문은 저장하지 않는다 (HMAC 값만)', async () => {
    const rows = await db.select().from(users).where(eq(users.provider, 'toss'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.providerUserId).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain('anon-key-A');
  });

  it('같은 토스 사용자는 다시 들어와도 같은 계정이고, 다른 사용자는 다른 계정이다', async () => {
    const first = await api('POST', '/auth/toss', { body: { code: 'code-a2' } });
    const other = await api('POST', '/auth/toss', { body: { code: 'code-b1' } });
    const [a] = await db.select().from(users).where(eq(users.id, first.body.user.id));
    expect(a!.provider).toBe('toss');
    expect((await db.select().from(users).where(eq(users.provider, 'toss'))).length).toBe(2);
    expect(other.body.user.id).not.toBe(first.body.user.id);
  });

  it('토스가 HTTP 200 으로 실패(resultType: FAIL)를 주면 401 — 계정을 만들지 않는다', async () => {
    const before = (await db.select().from(users)).length;
    const r = await api('POST', '/auth/toss', { body: { code: 'expired-code' } });
    expect(r.status).toBe(401);
    expect(r.body.error.details).toEqual({ reason: 'TOSS_AUTH_FAILED', tossErrorCode: 'INVALID_AUTH_CODE' });
    expect((await db.select().from(users)).length).toBe(before);
  });

  it('토스 서버에 연결하지 못해도 401 로 알려 준다', async () => {
    toss.failNetwork = true;
    const r = await api('POST', '/auth/toss', { body: { code: 'code-a1' } });
    toss.failNetwork = false;
    expect(r.status).toBe(401);
    expect(r.body.error.details.tossErrorCode).toBe('NETWORK_ERROR');
  });

  it('코드가 비어 있으면 400', async () => {
    expect((await api('POST', '/auth/toss', { body: { code: '  ' } })).status).toBe(400);
    expect((await api('POST', '/auth/toss', { body: {} })).status).toBe(400);
  });

  it('게스트로 쓰다가 처음 토스 로그인을 하면 게스트 계정이 그대로 토스 계정이 된다', async () => {
    const guest = await api('POST', '/auth/guest', { body: { deviceId: 'device-guest-c-0001' } });
    const profile = await api('POST', '/profiles', { token: guest.body.accessToken, body: { name: '민수', relation: 'self', birth: BIRTH } });
    expect(profile.status).toBe(201);
    const r = await api('POST', '/auth/toss', { token: guest.body.accessToken, body: { code: 'code-c1' } });
    expect(r.status).toBe(200);
    expect(r.body.user.id).toBe(guest.body.user.id);
    expect(r.body.user.provider).toBe('toss');
    expect(r.body.user.nickname).toBe(guest.body.user.nickname);
    const list = await api('GET', '/profiles', { token: r.body.accessToken });
    expect(list.body.map((p: any) => p.id)).toEqual([profile.body.id]);
  });

  it('이미 있는 토스 계정으로 들어오면 게스트의 프로필을 그 계정으로 옮긴다', async () => {
    const guest = await api('POST', '/auth/guest', { body: { deviceId: 'device-guest-c-0002' } });
    const extra = await api('POST', '/profiles', { token: guest.body.accessToken, body: { name: '지은', relation: 'friend', birth: BIRTH } });
    const r = await api('POST', '/auth/toss', { token: guest.body.accessToken, body: { code: 'code-c2' } });
    expect(r.body.user.id).not.toBe(guest.body.user.id);
    const list = await api('GET', '/profiles', { token: r.body.accessToken });
    expect(list.body.map((p: any) => p.id)).toContain(extra.body.id);
    expect(list.body).toHaveLength(2);
    // 게스트 토큰은 더 쓸 수 없다
    expect((await api('GET', '/auth/me', { token: guest.body.accessToken })).status).toBe(401);
  });

  it('탈퇴한 뒤 다시 들어오면 새 계정이 만들어진다 (유니크 충돌 없음)', async () => {
    const first = await api('POST', '/auth/toss', { body: { code: 'code-d1' } });
    expect((await api('DELETE', '/auth/me', { token: first.body.accessToken })).status).toBe(204);
    toss.codes.set('code-d2', 'anon-key-D').set('code-d3', 'anon-key-D');
    const again = await api('POST', '/auth/toss', { body: { code: 'code-d2' } });
    expect(again.status).toBe(200);
    expect(again.body.user.id).not.toBe(first.body.user.id);
    const third = await api('POST', '/auth/toss', { body: { code: 'code-d3' } });
    expect(third.body.user.id).toBe(again.body.user.id);
  });
});

describe('토스 연동이 설정되지 않은 서버', () => {
  it('mTLS 바인딩이 없으면 501 을 주고, 나머지 기능은 그대로 돈다', async () => {
    const { db } = createDb(':memory:');
    await runMigrations(db);
    await seedProducts(db);
    const api = makeApi(buildApp({ config: loadConfig(ENV), db }));
    const cfg = await api('GET', '/config');
    expect(cfg.body.features.tossAuth).toBe(false);
    expect(cfg.body.features.tossIap).toBe(false);
    expect(cfg.body.features.tossRewards).toBe(false);
    const r = await api('POST', '/auth/toss', { body: { code: 'anything' } });
    expect(r.status).toBe(501);
    expect(r.body.error.code).toBe('NOT_CONFIGURED');
    expect((await api('GET', '/payments/iap/toss/products')).body).toEqual([]);
    expect((await api('POST', '/auth/guest', { body: { deviceId: 'device-plain-0001' } })).status).toBe(200);
  });

  it('바인딩이 있어도 식별키 비밀값이 없으면 꺼져 있다', async () => {
    const { db } = createDb(':memory:');
    await runMigrations(db);
    const api = makeApi(buildApp({ config: loadConfig({ ...ENV, TOSS_USER_KEY_SECRET: '' }), db, deps: { tossFetch: createFakeToss().fetch } }));
    expect((await api('POST', '/auth/toss', { body: { code: 'x' } })).status).toBe(501);
  });

  it('운영 환경에서는 개발용 모의 모드가 켜지지 않는다', async () => {
    const { db } = createDb(':memory:');
    await runMigrations(db);
    const config = loadConfig({ ...ENV, NODE_ENV: 'production', PAYMENT_PROVIDER: 'groble', TOSS_DEV_MOCK: 'true', JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40) });
    const api = makeApi(buildApp({ config, db }));
    expect((await api('POST', '/auth/toss', { body: { code: 'mock-anon-code-1' } })).status).toBe(501);
  });
});
