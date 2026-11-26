import { SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/local.js';
import { seedProducts } from '../src/db/seed.js';
import { users } from '../src/db/schema.js';
import { createGateways } from '../src/modules/commerce/providers/index.js';
import { createCommerceService } from '../src/modules/commerce/service.js';
import { createRewardsService } from '../src/modules/rewards/service.js';
import { createTossRewardsService, TOSS_REWARD_MIN_WATCH_MS } from '../src/modules/rewards/toss.js';
import { createTossClient } from '../src/modules/toss/client.js';
import { createFakeToss } from './helpers/tossFake.js';

const ENV = { __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', REWARDED_AD_DAILY_LIMIT: '2', TOSS_USER_KEY_SECRET: 'test-toss-user-key-secret-0123456789' };

describe('토스 보상형 광고 지급 (일회용 토큰)', () => {
  const config = loadConfig(ENV);
  const { db } = createDb(':memory:');
  let clock = Date.now();
  const watch = (ms = TOSS_REWARD_MIN_WATCH_MS + 500) => {
    clock += ms;
  };
  let svc: ReturnType<typeof createTossRewardsService>;
  /** 질문권 보상을 켜지 않은 기본 설정 */
  let svcDefault: ReturnType<typeof createTossRewardsService>;

  beforeAll(async () => {
    await runMigrations(db);
    await seedProducts(db);
    await db.insert(users).values([
      { id: 'toss-1', nickname: '토스1', provider: 'toss', providerUserId: 'h1' },
      { id: 'toss-2', nickname: '토스2', provider: 'toss', providerUserId: 'h2' },
      { id: 'toss-3', nickname: '토스3', provider: 'toss', providerUserId: 'h3' },
      { id: 'toss-4', nickname: '토스4', provider: 'toss', providerUserId: 'h4' },
      { id: 'web-1', nickname: '웹', provider: 'email' },
    ]);
    const commerce = createCommerceService(config, db, createGateways(config));
    const rewards = createRewardsService(config, db, commerce);
    svc = createTossRewardsService(config, db, commerce, rewards, createTossClient(config, createFakeToss().fetch), { now: () => clock, creditRewards: true });
    svcDefault = createTossRewardsService(config, db, commerce, rewards, createTossClient(config, createFakeToss().fetch), { now: () => clock });
  });

  it('광고를 본 뒤 토큰으로 무상 질문권을 받는다 — 같은 토큰은 한 번만', async () => {
    const start = await svc.start('toss-1', { kind: 'credit' });
    expect(start.minWatchMs).toBe(TOSS_REWARD_MIN_WATCH_MS);
    expect(Date.parse(start.expiresAt)).toBeGreaterThan(clock);
    watch();
    expect(await svc.claim('toss-1', start.token)).toEqual({ granted: true, kind: 'credit', credits: 1 });
    expect(await svc.claim('toss-1', start.token)).toEqual({ granted: false, reason: 'DUPLICATE' });
  });

  it('시작하자마자 지급을 요청하면 거절한다 — 시간이 지나면 같은 토큰으로 받을 수 있다', async () => {
    const start = await svc.start('toss-2', { kind: 'credit' });
    expect(await svc.claim('toss-2', start.token)).toEqual({ granted: false, reason: 'TOO_EARLY' });
    watch();
    expect(await svc.claim('toss-2', start.token)).toMatchObject({ granted: true, kind: 'credit' });
  });

  it('위조하거나 다른 사용자의 토큰은 거부한다', async () => {
    const start = await svc.start('toss-2', { kind: 'credit' });
    watch();
    await expect(svc.claim('toss-1', start.token)).rejects.toThrow('광고 보상을 확인하지 못했어요');
    await expect(svc.claim('toss-2', `${start.token.slice(0, -4)}AAAA`)).rejects.toThrow('광고 보상을 확인하지 못했어요');
    await expect(svc.claim('toss-2', 'not-a-token')).rejects.toThrow('광고 보상을 확인하지 못했어요');
    // 로그인 토큰용 비밀값으로 직접 만든 토큰도 통하지 않는다(키와 발급자가 다르다)
    const forged = await new SignJWT({ kind: 'credit', st: clock - 60_000 })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('toss-2')
      .setJti('forged')
      .setIssuer('saju-api')
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode(config.JWT_ACCESS_SECRET));
    await expect(svc.claim('toss-2', forged)).rejects.toThrow('광고 보상을 확인하지 못했어요');
  });

  it('만료된 토큰은 거부한다', async () => {
    const start = await svc.start('toss-3', { kind: 'credit' });
    watch(11 * 60_000);
    await expect(svc.claim('toss-3', start.token)).rejects.toThrow('광고 보상을 확인하지 못했어요');
  });

  it('하루 한도를 넘으면 시작부터 막고, 미리 받아 둔 토큰으로도 넘지 못한다', async () => {
    // toss-1 은 위에서 1회 받았다(한도 2)
    const a = await svc.start('toss-1', { kind: 'credit' });
    const b = await svc.start('toss-1', { kind: 'credit' });
    watch();
    expect(await svc.claim('toss-1', a.token)).toEqual({ granted: true, kind: 'credit', credits: 2 });
    expect(await svc.claim('toss-1', b.token)).toEqual({ granted: false, reason: 'DAILY_LIMIT' });
    await expect(svc.start('toss-1', { kind: 'credit' })).rejects.toMatchObject({ statusCode: 409, details: { reason: 'DAILY_LIMIT' } });
  });

  it('미리 받아 둔 토큰 여러 개로 동시에 요청해도 하루 한도를 넘지 않는다', async () => {
    const tokens = await Promise.all(Array.from({ length: 5 }, () => svc.start('toss-4', { kind: 'credit' })));
    watch();
    const rs = await Promise.all(tokens.map((t) => svc.claim('toss-4', t.token)));
    expect(rs.filter((r) => r.granted)).toHaveLength(2);
    expect(rs.filter((r) => !r.granted && r.reason === 'DAILY_LIMIT')).toHaveLength(3);
  });

  it('무료 콘텐츠 열기는 슬롯마다 하루 1회 — 질문권 한도와는 따로 센다', async () => {
    const start = await svc.start('toss-1', { kind: 'unlock', slot: 'tomorrow_fortune' });
    watch();
    const dateKey = new Date(clock + 9 * 3_600_000).toISOString().slice(0, 10);
    expect(await svc.claim('toss-1', start.token)).toEqual({ granted: true, kind: 'unlock', slot: 'tomorrow_fortune', dateKey });
    // 같은 날 다시 요청해도 열린 상태를 그대로 알려 준다
    expect(await svc.claim('toss-1', start.token)).toEqual({ granted: true, kind: 'unlock', slot: 'tomorrow_fortune', dateKey });
    await expect(svc.start('toss-1', { kind: 'unlock', slot: 'tomorrow_fortune' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('질문권 보상은 부르는 화면이 없어 기본으로 꺼져 있다(토큰 발급·지급 모두 403)', async () => {
    await expect(svcDefault.start('toss-1', { kind: 'credit' })).rejects.toMatchObject({ statusCode: 403, details: { reason: 'CREDIT_REWARD_OFF' } });
    // 켜 둔 설정에서 받은 토큰이라도 꺼진 설정에서는 지급하지 않는다
    const token = (await svc.start('toss-3', { kind: 'credit' }).catch(() => null))?.token;
    if (token) {
      watch();
      await expect(svcDefault.claim('toss-3', token)).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('토스 계정이 아니면 받을 수 없다', async () => {
    await expect(svc.start('web-1', { kind: 'credit' })).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('토스 보상형 광고 경로', () => {
  it('로그인이 필요하고, 본문을 검증하고, 설정이 없으면 501', async () => {
    const { db } = createDb(':memory:');
    await runMigrations(db);
    await seedProducts(db);
    const toss = createFakeToss();
    toss.codes.set('code-a', 'anon-A');
    const app = buildApp({ config: loadConfig(ENV), db, deps: { tossFetch: toss.fetch } });
    const post = async (url: string, payload: unknown, token?: string) => {
      const res = await app.inject({ method: 'POST', url: `/api/v1${url}`, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: payload as object });
      return { status: res.statusCode, body: res.json() as any };
    };
    expect((await post('/rewards/toss/start', { kind: 'credit' })).status).toBe(401);
    const token = (await post('/auth/toss', { code: 'code-a' })).body.accessToken as string;
    expect((await post('/rewards/toss/start', { kind: 'unlock', slot: 'unknown_slot' }, token)).status).toBe(400);
    expect((await post('/rewards/toss/start', { kind: 'unlock' }, token)).status).toBe(400);
    const start = await post('/rewards/toss/start', { kind: 'unlock', slot: 'tomorrow_fortune' }, token);
    expect(start.status).toBe(200);
    // 실제 시계에서는 바로 요청하면 아직 이르다
    expect((await post('/rewards/toss/claim', { token: start.body.token }, token)).body).toEqual({ granted: false, reason: 'TOO_EARLY' });
    expect((await post('/rewards/toss/claim', {}, token)).status).toBe(400);

    const plain = buildApp({ config: loadConfig(ENV), db });
    const res = await plain.inject({ method: 'POST', url: '/api/v1/rewards/toss/start', headers: { authorization: `Bearer ${token}` }, payload: { kind: 'credit' } });
    expect(res.statusCode).toBe(501);
  });
});
