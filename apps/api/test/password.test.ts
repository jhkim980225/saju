/**
 * 비밀번호 재설정(메일 링크) · 변경
 *  - 테스트 환경에서는 메일을 보내지 않고 mail.outbox 에 쌓이므로 본문에서 토큰을 읽어 흐름을 끝까지 검증한다
 *  - 계정 유무는 응답으로 드러나지 않아야 한다(없는 이메일도 200, 메일만 안 감)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { seedProducts } from '../src/db/seed.js';

const BASE_ENV = { __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: '', SIGNUP_BONUS_CREDITS: '0', PUBLIC_WEB_URL: 'https://dalbitsaju.test/' };
const MAIL_ENV = { RESEND_API_KEY: 're_test_key', MAIL_FROM: '달빛사주 <no-reply@dalbitsaju.test>', SUPPORT_EMAIL: 'help@dalbitsaju.test' };

async function makeApp(overrides: Record<string, string>) {
  const config = loadConfig({ ...BASE_ENV, ...overrides });
  const { db } = createDb(':memory:');
  runMigrations(db);
  seedProducts(db);
  return buildApp({ config, db, logger: false });
}

const call = (app: FastifyInstance) => async (method: 'GET' | 'POST', url: string, opts: { token?: string; body?: unknown } = {}) => {
  const res = await app.inject({ method, url: `/api/v1${url}`, headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {}, ...(opts.body !== undefined ? { payload: opts.body as object } : {}) });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null };
};

let app: FastifyInstance;
let api: ReturnType<typeof call>;
const outbox = () => app.ctx.services.mail.outbox;
const tokenFrom = (text: string) => /password\/reset\?token=([A-Za-z0-9_-]+)/.exec(text)?.[1];

beforeAll(async () => {
  app = await makeApp(MAIL_ENV);
  api = call(app);
});
afterAll(async () => {
  await app.close();
});

describe('공개 설정', () => {
  it('메일 연동 여부와 문의 주소를 알려 준다', async () => {
    const r = await api('GET', '/config');
    expect(r.status).toBe(200);
    expect(r.body.features.mail).toBe(true);
    expect(r.body.supportEmail).toBe('help@dalbitsaju.test');
  });
});

describe('재설정 메일 흐름', () => {
  const email = 'reset-me@example.com';
  const oldPassword = 'old-password-1';
  const newPassword = 'new-password-2';
  let firstTokens: { accessToken: string; refreshToken: string };
  let resetToken: string;

  it('가입한 이메일로 요청하면 메일 1통에 재설정 링크가 담긴다', async () => {
    const signup = await api('POST', '/auth/signup', { body: { email, password: oldPassword, nickname: '재설정' } });
    expect(signup.status).toBe(201);
    firstTokens = signup.body;

    const r = await api('POST', '/auth/password/forgot', { body: { email: email.toUpperCase() } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(outbox()).toHaveLength(1);
    const mail = outbox()[0]!;
    expect(mail.to).toBe(email);
    expect(mail.subject).toBe('달빛사주 비밀번호 재설정');
    expect(mail.text).toContain('https://dalbitsaju.test/password/reset?token=');
    expect(mail.text).toContain('30분');
    expect(mail.text).toContain('본인이 요청하지 않았다면');
    expect(mail.html).toContain('새 비밀번호 정하기');
    resetToken = tokenFrom(mail.text)!;
    expect(resetToken.length).toBeGreaterThanOrEqual(32);
  });

  it('가입하지 않은 이메일도 200 이고 메일은 가지 않는다 (계정 유무 비노출)', async () => {
    const r = await api('POST', '/auth/password/forgot', { body: { email: 'nobody@example.com' } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(outbox()).toHaveLength(1);
  });

  it('잘못된 이메일 형식은 400', async () => {
    const r = await api('POST', '/auth/password/forgot', { body: { email: 'not-an-email' } });
    expect(r.status).toBe(400);
    expect(outbox()).toHaveLength(1);
  });

  it('다시 요청하면 이전 링크는 무효가 되고 최신 링크만 유효하다', async () => {
    const r = await api('POST', '/auth/password/forgot', { body: { email } });
    expect(r.status).toBe(200);
    expect(outbox()).toHaveLength(2);
    const latest = tokenFrom(outbox()[1]!.text)!;
    expect(latest).not.toBe(resetToken);

    const stale = await api('POST', '/auth/password/reset', { body: { token: resetToken, password: newPassword } });
    expect(stale.status).toBe(400);
    expect(stale.body.error.message).toBe('링크가 만료됐거나 이미 사용됐습니다. 다시 요청해 주세요.');
    resetToken = latest;
  });

  it('짧은 새 비밀번호는 400 이고 토큰은 소비되지 않는다', async () => {
    const r = await api('POST', '/auth/password/reset', { body: { token: resetToken, password: 'short' } });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe('비밀번호는 8자 이상이어야 해요.');
  });

  it('유효한 링크로 비밀번호를 바꾸면 옛 비밀번호·옛 세션이 모두 막힌다', async () => {
    const r = await api('POST', '/auth/password/reset', { body: { token: resetToken, password: newPassword } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });

    const oldLogin = await api('POST', '/auth/login', { body: { email, password: oldPassword } });
    expect(oldLogin.status).toBe(401);
    const newLogin = await api('POST', '/auth/login', { body: { email, password: newPassword } });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.user.email).toBe(email);

    // 재설정 전에 발급된 refresh 토큰은 폐기됐다
    const refresh = await api('POST', '/auth/refresh', { body: { refreshToken: firstTokens.refreshToken } });
    expect(refresh.status).toBe(401);
  });

  it('같은 링크를 다시 쓰면 400', async () => {
    const r = await api('POST', '/auth/password/reset', { body: { token: resetToken, password: 'another-pass-3' } });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe('링크가 만료됐거나 이미 사용됐습니다. 다시 요청해 주세요.');
    // 비밀번호는 그대로
    expect((await api('POST', '/auth/login', { body: { email, password: newPassword } })).status).toBe(200);
  });

  it('존재하지 않는 토큰은 400', async () => {
    const r = await api('POST', '/auth/password/reset', { body: { token: 'x'.repeat(43), password: newPassword } });
    expect(r.status).toBe(400);
  });

  it('게스트 계정은 이메일이 없어 메일이 가지 않는다', async () => {
    const before = outbox().length;
    await api('POST', '/auth/guest', { body: { deviceId: 'guest-device-0001' } });
    const r = await api('POST', '/auth/password/forgot', { body: { email: 'guest-nothing@example.com' } });
    expect(r.status).toBe(200);
    expect(outbox()).toHaveLength(before);
  });
});

describe('비밀번호 변경 (로그인 상태)', () => {
  const email = 'change-me@example.com';
  const password = 'first-password-1';
  const changed = 'second-password-2';
  let access: string;
  let refresh: string;

  it('현재 비밀번호가 맞으면 바뀌고 현재 세션은 유지된다', async () => {
    const signup = await api('POST', '/auth/signup', { body: { email, password } });
    expect(signup.status).toBe(201);
    access = signup.body.accessToken;
    refresh = signup.body.refreshToken;

    const r = await api('POST', '/auth/password/change', { token: access, body: { currentPassword: password, newPassword: changed } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });

    expect((await api('POST', '/auth/login', { body: { email, password } })).status).toBe(401);
    expect((await api('POST', '/auth/login', { body: { email, password: changed } })).status).toBe(200);
    // 현재 기기의 세션은 그대로 쓸 수 있다
    expect((await api('GET', '/auth/me', { token: access })).status).toBe(200);
    expect((await api('POST', '/auth/refresh', { body: { refreshToken: refresh } })).status).toBe(200);
  });

  it('현재 비밀번호가 틀리면 400', async () => {
    const r = await api('POST', '/auth/password/change', { token: access, body: { currentPassword: 'wrong-password', newPassword: 'third-password-3' } });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe('현재 비밀번호가 일치하지 않아요.');
    expect((await api('POST', '/auth/login', { body: { email, password: changed } })).status).toBe(200);
  });

  it('새 비밀번호가 8자 미만이면 400', async () => {
    const r = await api('POST', '/auth/password/change', { token: access, body: { currentPassword: changed, newPassword: 'short' } });
    expect(r.status).toBe(400);
  });

  it('로그인하지 않으면 401', async () => {
    const r = await api('POST', '/auth/password/change', { body: { currentPassword: changed, newPassword: 'third-password-3' } });
    expect(r.status).toBe(401);
  });

  it('게스트 계정은 400', async () => {
    const guest = await api('POST', '/auth/guest', { body: { deviceId: 'guest-device-0002' } });
    const r = await api('POST', '/auth/password/change', { token: guest.body.accessToken, body: { currentPassword: 'whatever-1', newPassword: 'whatever-22' } });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe('이메일로 가입한 계정만 비밀번호를 바꿀 수 있어요.');
  });
});

describe('메일 미설정', () => {
  let bare: FastifyInstance;
  beforeAll(async () => {
    bare = await makeApp({ RESEND_API_KEY: '', MAIL_FROM: '' });
  });
  afterAll(async () => {
    await bare.close();
  });

  it('공개 설정의 mail 이 false 이고 문의 주소는 null', async () => {
    const r = await call(bare)('GET', '/config');
    expect(r.body.features.mail).toBe(false);
    expect(r.body.supportEmail).toBeNull();
  });

  it('재설정 요청은 501 NOT_CONFIGURED', async () => {
    const r = await call(bare)('POST', '/auth/password/forgot', { body: { email: 'anyone@example.com' } });
    expect(r.status).toBe(501);
    expect(r.body.error.code).toBe('NOT_CONFIGURED');
    expect(r.body.error.details.envKeys).toEqual(['RESEND_API_KEY', 'MAIL_FROM']);
    expect(bare.ctx.services.mail.outbox).toHaveLength(0);
  });

  it('비밀번호 변경은 메일 없이도 된다', async () => {
    const c = call(bare);
    const signup = await c('POST', '/auth/signup', { body: { email: 'nomail@example.com', password: 'password-1' } });
    const r = await c('POST', '/auth/password/change', { token: signup.body.accessToken, body: { currentPassword: 'password-1', newPassword: 'password-2' } });
    expect(r.status).toBe(200);
  });
});
