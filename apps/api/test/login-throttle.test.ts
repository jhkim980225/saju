/**
 * 이메일 로그인 무차별 대입 방지(modules/auth/loginThrottle.ts) — 같은 이메일로 10번 틀리면 15분 동안 막힌다.
 * IP 기준 요청 제한은 테스트에서 꺼져 있으므로(rateLimiters 없음) 이 동작만 따로 확인한다.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/local.js';
import { seedProducts } from '../src/db/seed.js';
import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, createLoginThrottle } from '../src/modules/auth/loginThrottle.js';

let app: App;
let db: ReturnType<typeof createDb>['db'];

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

const login = async (email: string, password: string) => {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  return res.statusCode;
};

describe('로그인 실패 횟수 제한', () => {
  it('10번 틀리면 맞는 비밀번호도 막히고, 다른 이메일은 영향이 없다', async () => {
    const signup = await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'brute@example.com', password: 'password123' } });
    expect(signup.statusCode).toBe(201);
    await app.inject({ method: 'POST', url: '/api/v1/auth/signup', payload: { email: 'other@example.com', password: 'password123' } });

    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect(await login('brute@example.com', `wrong-${i}-pass`)).toBe(401);
    expect(await login('brute@example.com', 'password123')).toBe(429);
    expect(await login('BRUTE@example.com', 'password123')).toBe(429); // 대소문자를 바꿔도 같은 계정
    expect(await login('other@example.com', 'password123')).toBe(200);
  });

  it('가입하지 않은 이메일도 똑같이 막혀 계정 존재 여부가 드러나지 않는다', async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect(await login('ghost@example.com', 'whatever123')).toBe(401);
    expect(await login('ghost@example.com', 'whatever123')).toBe(429);
  });

  it('창이 지나면 다시 1부터 세고, 성공하면 기록을 지운다', async () => {
    let t = 1_000_000;
    const throttle = createLoginThrottle(db, () => t);
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await throttle.recordFailure('window@example.com');
    await expect(throttle.assertAllowed('window@example.com')).rejects.toMatchObject({ statusCode: 429 });
    t += LOGIN_WINDOW_MS + 1;
    await expect(throttle.assertAllowed('window@example.com')).resolves.toBeUndefined();
    await throttle.recordFailure('window@example.com'); // 새 창의 1번째
    for (let i = 0; i < LOGIN_MAX_FAILURES - 2; i++) await throttle.recordFailure('window@example.com');
    await expect(throttle.assertAllowed('window@example.com')).resolves.toBeUndefined(); // 9번
    await throttle.clear('window@example.com');
    await throttle.recordFailure('window@example.com');
    await expect(throttle.assertAllowed('window@example.com')).resolves.toBeUndefined();
  });
});
