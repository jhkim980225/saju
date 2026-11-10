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

beforeAll(async () => {
  const config = loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: '' });
  const created = createDb(':memory:');
  close = created.close;
  await runMigrations(created.db);
  await seedProducts(created.db);
  app = buildApp({ config, db: created.db, rateLimiters: { general: general.limiter, auth: auth.limiter } });
});
afterAll(async () => {
  await close();
});

const guest = (ip: string) => app.inject({ method: 'POST', url: '/api/v1/auth/guest', headers: { 'cf-connecting-ip': ip }, payload: {} });

describe('요청 수 제한', () => {
  it('인증 경로는 IP 마다 따로 세고, 넘으면 429 RATE_LIMITED', async () => {
    expect((await guest('203.0.113.1')).statusCode).toBe(200);
    expect((await guest('203.0.113.1')).statusCode).toBe(200);
    const blocked = await guest('203.0.113.1');
    expect(blocked.statusCode).toBe(429);
    expect((blocked.json() as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
    // 다른 IP 는 영향 없음
    expect((await guest('203.0.113.2')).statusCode).toBe(200);
    expect([...auth.seen.keys()].sort()).toEqual(['auth:203.0.113.1', 'auth:203.0.113.2']);
  });

  it('전체 API 제한은 모든 /api 경로에 걸리고, /health 에는 걸리지 않는다', async () => {
    const get = (url: string) => app.inject({ method: 'GET', url, headers: { 'cf-connecting-ip': '198.51.100.7' } });
    for (let i = 0; i < 5; i++) expect((await get('/api/v1/config')).statusCode).toBe(200);
    expect((await get('/api/v1/products')).statusCode).toBe(429);
    expect((await get('/health')).statusCode).toBe(200);
  });
});
