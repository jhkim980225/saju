/**
 * 요청 수 제한 — 운영 Worker 는 Cloudflare Rate Limiting 바인딩을 넘긴다(src/worker.ts). 여기서는 같은 모양의 가짜 제한기로
 * 경로별 제한(전체 API · 인증 경로)과 IP 별 집계, 429 응답 형식을 확인한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import type { RateLimiter } from '../src/lib/http.js';
import { createDb, runMigrations } from '../src/db/local.js';
import { seedProducts } from '../src/db/seed.js';

/** 키마다 limit 번까지 통과 */
function fakeLimiter(limit: number) {
  const seen = new Map<string, number>();
  const limiter: RateLimiter = {
    async limit({ key }) {
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      return { success: n <= limit };
    },
  };
  return { limiter, seen };
}

let app: App;
let close: () => Promise<void>;
const general = fakeLimiter(5);
const auth = fakeLimiter(2);
const session = fakeLimiter(3);

beforeAll(async () => {
  const config = loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: '' });
  const created = createDb(':memory:');
  close = created.close;
  await runMigrations(created.db);
  await seedProducts(created.db);
  app = buildApp({ config, db: created.db, rateLimiters: { general: general.limiter, auth: auth.limiter, session: session.limiter } });
});
afterAll(async () => {
  await close();
});

const guest = (ip: string) => app.inject({ method: 'POST', url: '/api/v1/auth/guest', headers: { 'cf-connecting-ip': ip }, payload: {} });
const login = (ip: string) => app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'cf-connecting-ip': ip }, payload: { email: 'nobody@example.com', password: 'password123' } });

describe('요청 수 제한', () => {
  it('인증 경로(로그인 등)는 IP 마다 따로 세고, 넘으면 429 RATE_LIMITED', async () => {
    expect((await login('203.0.113.1')).statusCode).toBe(401);
    expect((await login('203.0.113.1')).statusCode).toBe(401);
    const blocked = await login('203.0.113.1');
    expect(blocked.statusCode).toBe(429);
    expect((blocked.json() as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
    // 다른 IP 는 영향 없음
    expect((await login('203.0.113.2')).statusCode).toBe(401);
    expect([...auth.seen.keys()].sort()).toEqual(['auth:203.0.113.1', 'auth:203.0.113.2']);
  });

  it('게스트 시작·토큰 갱신은 인증 제한이 아니라 더 넉넉한 세션 제한을 받는다', async () => {
    for (let i = 0; i < 3; i++) expect((await guest('203.0.113.9')).statusCode).toBe(200);
    expect((await guest('203.0.113.9')).statusCode).toBe(429);
    const refresh = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { 'cf-connecting-ip': '203.0.113.10' }, payload: { refreshToken: 'x'.repeat(40) } });
    expect(refresh.statusCode).toBe(401);
    expect([...auth.seen.keys()].some((k) => k.endsWith('203.0.113.9') || k.endsWith('203.0.113.10'))).toBe(false);
    expect([...session.seen.keys()].sort()).toEqual(['session:203.0.113.10', 'session:203.0.113.9']);
  });

  it('결제 웹훅·스토어 알림·AdMob SSV 는 IP 요청 수 제한에서 뺀다', async () => {
    const ip = { 'cf-connecting-ip': '192.0.2.50' };
    for (let i = 0; i < 8; i++) {
      const webhook = await app.inject({ method: 'POST', url: '/api/v1/payments/webhooks/mock', headers: { ...ip, 'content-type': 'application/json' }, payload: '{}' });
      expect(webhook.statusCode).not.toBe(429);
      const ssv = await app.inject({ method: 'GET', url: '/api/v1/rewards/admob-ssv?x=1', headers: ip });
      expect(ssv.statusCode).not.toBe(429);
    }
    expect(general.seen.has('api:192.0.2.50')).toBe(false);
  });

  it('소셜 콜백과 Apple form-post 도 인증 경로 제한을 받는다', async () => {
    const callback = (ip: string) =>
      app.inject({ method: 'POST', url: '/api/v1/auth/oauth/kakao/callback', headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json' }, payload: { code: 'c' } });
    const formPost = (ip: string) =>
      app.inject({ method: 'POST', url: '/api/v1/auth/oauth/apple/form-post', headers: { 'cf-connecting-ip': ip, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'code=abc&state=xyz' });
    // 카카오 키가 없어 501 이지만 제한 확인은 그 전에 한다
    expect((await callback('203.0.113.21')).statusCode).not.toBe(429);
    expect((await callback('203.0.113.21')).statusCode).not.toBe(429);
    expect((await callback('203.0.113.21')).statusCode).toBe(429);
    expect((await formPost('203.0.113.22')).statusCode).toBe(302);
    expect((await formPost('203.0.113.22')).statusCode).toBe(302);
    expect((await formPost('203.0.113.22')).statusCode).toBe(429);
  });

  it('전체 API 제한은 모든 /api 경로에 걸리고, /health 에는 걸리지 않는다', async () => {
    const get = (url: string) => app.inject({ method: 'GET', url, headers: { 'cf-connecting-ip': '198.51.100.7' } });
    for (let i = 0; i < 5; i++) expect((await get('/api/v1/config')).statusCode).toBe(200);
    expect((await get('/api/v1/products')).statusCode).toBe(429);
    expect((await get('/health')).statusCode).toBe(200);
  });
});
