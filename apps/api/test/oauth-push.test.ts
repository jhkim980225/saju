/**
 * 소셜 로그인 어댑터 + FCM 푸시 발송 테스트.
 * 외부 네트워크는 전부 모킹한다(전역 fetch 는 호출되면 실패하도록 막아 둠).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SignJWT, createLocalJWKSet, decodeProtectedHeader, exportJWK, exportPKCS8, generateKeyPair, jwtVerify, type CryptoKey } from 'jose';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { pushTokens, users } from '../src/db/schema.js';
import { AppError } from '../src/lib/errors.js';
import { createOAuthService } from '../src/modules/auth/oauth.js';
import { createPushService, type PushMessage } from '../src/modules/push/service.js';

// ── 공통 헬퍼 ────────────────────────────────────────────────────────────────

const BASE_ENV = { __SKIP_ENV_FILE: '1', NODE_ENV: 'test' } as const;
/** 프로세스 env 에 키가 있어도 테스트가 흔들리지 않도록 모든 연동 키를 비워 둔다 */
const EMPTY_KEYS = {
  KAKAO_REST_API_KEY: '',
  KAKAO_CLIENT_SECRET: '',
  NAVER_CLIENT_ID: '',
  NAVER_CLIENT_SECRET: '',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  APPLE_CLIENT_ID: '',
  APPLE_TEAM_ID: '',
  APPLE_KEY_ID: '',
  APPLE_PRIVATE_KEY: '',
  APPLE_BUNDLE_ID: '',
  FCM_PROJECT_ID: '',
  FCM_CLIENT_EMAIL: '',
  FCM_PRIVATE_KEY: '',
};
const config = (env: Record<string, string> = {}) => loadConfig({ ...BASE_ENV, ...EMPTY_KEYS, ...env });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Call {
  url: string;
  init: RequestInit;
}
/** URL → 응답 핸들러로 fetch 모킹. 호출 기록을 남긴다 */
function mockFetch(routes: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const call = { url, init };
    calls.push(call);
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!key) throw new Error(`예상하지 못한 요청: ${url}`);
    return routes[key]!(call);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const form = (init: RequestInit) => new URLSearchParams(String(init.body));
const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name);
/** PEM 을 env 한 줄 형식(`\n` 이스케이프)으로 */
const escapePem = (pem: string) => pem.trim().replace(/\n/g, '\\n');

async function expectAppError(p: Promise<unknown> | (() => unknown), status: number, code: string, message?: string) {
  let caught: unknown;
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(AppError);
  const err = caught as AppError;
  expect(err.statusCode).toBe(status);
  expect(err.code).toBe(code);
  if (message) expect(err.message).toBe(message);
}

beforeAll(() => {
  // 실제 외부 호출 차단 — 모든 네트워크는 주입한 fetch 로만
  vi.stubGlobal('fetch', () => {
    throw new Error('테스트에서 실제 네트워크 호출은 금지');
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

// ── 미설정 ───────────────────────────────────────────────────────────────────

describe('키 미설정', () => {
  it('모든 소셜 로그인은 NOT_CONFIGURED(501)', async () => {
    const oauth = createOAuthService(config());
    for (const p of ['kakao', 'naver', 'google', 'apple'] as const) {
      expect(oauth.isEnabled(p)).toBe(false);
      await expectAppError(() => oauth.getAuthorizeUrl(p, 'https://saju.example.com/auth/callback/x', 'state-12345'), 501, 'NOT_CONFIGURED');
      await expectAppError(oauth.exchangeCode(p, { code: 'c', redirectUri: 'https://saju.example.com/cb' }), 501, 'NOT_CONFIGURED');
    }
  });

  it('푸시 발송은 NOT_CONFIGURED(501)', async () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const push = createPushService(config(), db);
    expect(push.enabled).toBe(false);
    await expectAppError(push.sendToUser('u', { title: 't', body: 'b' }), 501, 'NOT_CONFIGURED');
    await expectAppError(push.sendDailyFortuneDigest(() => null), 501, 'NOT_CONFIGURED');
  });
});

// ── 카카오 ───────────────────────────────────────────────────────────────────

describe('카카오 로그인', () => {
  const redirectUri = 'https://saju.example.com/auth/callback/kakao';

  it('authorize URL', () => {
    const oauth = createOAuthService(config({ KAKAO_REST_API_KEY: 'k' }));
    const url = new URL(oauth.getAuthorizeUrl('kakao', redirectUri, 'state-12345'));
    expect(url.origin + url.pathname).toBe('https://kauth.kakao.com/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('k');
    expect(url.searchParams.get('redirect_uri')).toBe(redirectUri);
    expect(url.searchParams.get('state')).toBe('state-12345');
    expect(url.searchParams.get('scope')).toContain('account_email');
  });

  it('코드 교환 → 프로필 매핑 (client_secret 미설정 시 미전송)', async () => {
    const { fetch, calls } = mockFetch({
      'https://kauth.kakao.com/oauth/token': () => json({ access_token: 'kakao-at', token_type: 'bearer', expires_in: 21599 }),
      'https://kapi.kakao.com/v2/user/me': () =>
        json({
          id: 1234567890,
          properties: { nickname: '속성닉' },
          kakao_account: { email: 'user@kakao.com', is_email_valid: true, is_email_verified: true, profile: { nickname: '카카오유저' } },
        }),
    });
    const oauth = createOAuthService(config({ KAKAO_REST_API_KEY: 'k' }), { fetch });
    const profile = await oauth.exchangeCode('kakao', { code: 'auth-code', redirectUri });
    expect(profile).toEqual({ providerUserId: '1234567890', email: 'user@kakao.com', nickname: '카카오유저' });

    const [tokenCall, meCall] = calls;
    expect(tokenCall!.init.method).toBe('POST');
    const body = form(tokenCall!.init);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('client_id')).toBe('k');
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('redirect_uri')).toBe(redirectUri);
    expect(body.has('client_secret')).toBe(false);
    expect(tokenCall!.init.signal).toBeInstanceOf(AbortSignal);
    expect(header(meCall!.init, 'authorization')).toBe('Bearer kakao-at');
  });

  it('client_secret 설정 시 전송, 미검증 이메일은 버림', async () => {
    const { fetch, calls } = mockFetch({
      'https://kauth.kakao.com/oauth/token': () => json({ access_token: 'kakao-at' }),
      'https://kapi.kakao.com/v2/user/me': () => json({ id: 42, kakao_account: { email: 'x@kakao.com', is_email_verified: false } }),
    });
    const oauth = createOAuthService(config({ KAKAO_REST_API_KEY: 'k', KAKAO_CLIENT_SECRET: 'kakao-secret' }), { fetch });
    const profile = await oauth.exchangeCode('kakao', { code: 'c', redirectUri });
    expect(form(calls[0]!.init).get('client_secret')).toBe('kakao-secret');
    expect(profile).toEqual({ providerUserId: '42', email: null, nickname: null });
  });

  it('토큰 오류 → 401 UNAUTHORIZED', async () => {
    const { fetch } = mockFetch({
      'https://kauth.kakao.com/oauth/token': () => json({ error: 'invalid_grant', error_code: 'KOE320' }, 400),
    });
    const oauth = createOAuthService(config({ KAKAO_REST_API_KEY: 'k' }), { fetch });
    await expectAppError(oauth.exchangeCode('kakao', { code: 'bad', redirectUri }), 401, 'UNAUTHORIZED', '카카오 로그인에 실패했어요. 다시 시도해 주세요.');
  });
});

// ── 네이버 ───────────────────────────────────────────────────────────────────

describe('네이버 로그인', () => {
  const env = { NAVER_CLIENT_ID: 'naver-id', NAVER_CLIENT_SECRET: 'naver-secret' };
  const redirectUri = 'https://saju.example.com/auth/callback/naver';

  it('authorize URL', () => {
    const url = new URL(createOAuthService(config(env)).getAuthorizeUrl('naver', redirectUri, 'state-12345'));
    expect(url.origin + url.pathname).toBe('https://nid.naver.com/oauth2.0/authorize');
    expect(url.searchParams.get('client_id')).toBe('naver-id');
    expect(url.searchParams.get('state')).toBe('state-12345');
    expect(url.searchParams.get('redirect_uri')).toBe(redirectUri);
  });

  it('코드 교환 → 프로필 매핑', async () => {
    const { fetch, calls } = mockFetch({
      'https://nid.naver.com/oauth2.0/token': () => json({ access_token: 'naver-at', token_type: 'bearer', expires_in: '3600' }),
      'https://openapi.naver.com/v1/nid/me': () =>
        json({ resultcode: '00', message: 'success', response: { id: 'naver-uid-1', email: 'user@naver.com', nickname: '네이버유저', name: '홍길동' } }),
    });
    const oauth = createOAuthService(config(env), { fetch });
    const profile = await oauth.exchangeCode('naver', { code: 'auth-code', redirectUri, state: 'state-12345' });
    expect(profile).toEqual({ providerUserId: 'naver-uid-1', email: 'user@naver.com', nickname: '네이버유저' });

    const body = form(calls[0]!.init);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('client_id')).toBe('naver-id');
    expect(body.get('client_secret')).toBe('naver-secret');
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('state')).toBe('state-12345');
    expect(header(calls[1]!.init, 'authorization')).toBe('Bearer naver-at');
  });

  it('state 미전달이어도 필수 파라미터는 채워서 보냄', async () => {
    const { fetch, calls } = mockFetch({
      'https://nid.naver.com/oauth2.0/token': () => json({ access_token: 'naver-at' }),
      'https://openapi.naver.com/v1/nid/me': () => json({ resultcode: '00', response: { id: 'u2', name: '이름만' } }),
    });
    const profile = await createOAuthService(config(env), { fetch }).exchangeCode('naver', { code: 'c', redirectUri });
    expect(form(calls[0]!.init).get('state')).toBeTruthy();
    expect(profile).toEqual({ providerUserId: 'u2', email: null, nickname: '이름만' });
  });

  it('HTTP 200 + error 응답 → 401', async () => {
    const { fetch } = mockFetch({
      'https://nid.naver.com/oauth2.0/token': () => json({ error: 'invalid_request', error_description: 'no valid data in session' }),
    });
    const oauth = createOAuthService(config(env), { fetch });
    await expectAppError(oauth.exchangeCode('naver', { code: 'c', redirectUri, state: 's' }), 401, 'UNAUTHORIZED', '네이버 로그인에 실패했어요. 다시 시도해 주세요.');
  });
});

// ── 구글 ─────────────────────────────────────────────────────────────────────

describe('구글 로그인', () => {
  const env = { GOOGLE_CLIENT_ID: 'google-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'google-secret' };
  const redirectUri = 'https://saju.example.com/auth/callback/google';
  let googleKey: CryptoKey;
  let jwks: ReturnType<typeof createLocalJWKSet>;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    googleKey = privateKey;
    jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'google-kid-1', alg: 'RS256', use: 'sig' }] });
  });

  const idToken = (aud: string, claims: Record<string, unknown> = {}) =>
    new SignJWT({ email: 'user@gmail.com', email_verified: true, name: '구글유저', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'google-kid-1' })
      .setIssuer('https://accounts.google.com')
      .setAudience(aud)
      .setSubject('google-sub-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(googleKey);

  it('authorize URL (openid email profile)', () => {
    const url = new URL(createOAuthService(config(env)).getAuthorizeUrl('google', redirectUri, 'state-12345'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('client_id')).toBe(env.GOOGLE_CLIENT_ID);
  });

  it('코드 교환 → id_token 검증 → 프로필', async () => {
    const token = await idToken(env.GOOGLE_CLIENT_ID);
    const { fetch, calls } = mockFetch({ 'https://oauth2.googleapis.com/token': () => json({ access_token: 'g-at', id_token: token }) });
    const oauth = createOAuthService(config(env), { fetch, jwks: { google: jwks } });
    const profile = await oauth.exchangeCode('google', { code: 'auth-code', redirectUri });
    expect(profile).toEqual({ providerUserId: 'google-sub-1', email: 'user@gmail.com', nickname: '구글유저' });
    const body = form(calls[0]!.init);
    expect(body.get('client_secret')).toBe('google-secret');
    expect(body.get('redirect_uri')).toBe(redirectUri);
  });

  it('미검증 이메일은 버림', async () => {
    const token = await idToken(env.GOOGLE_CLIENT_ID, { email_verified: false });
    const { fetch } = mockFetch({ 'https://oauth2.googleapis.com/token': () => json({ id_token: token }) });
    const profile = await createOAuthService(config(env), { fetch, jwks: { google: jwks } }).exchangeCode('google', { code: 'c', redirectUri });
    expect(profile.email).toBeNull();
  });

  it('aud 불일치 → 401', async () => {
    const token = await idToken('someone-else.apps.googleusercontent.com');
    const { fetch } = mockFetch({ 'https://oauth2.googleapis.com/token': () => json({ id_token: token }) });
    const oauth = createOAuthService(config(env), { fetch, jwks: { google: jwks } });
    await expectAppError(oauth.exchangeCode('google', { code: 'c', redirectUri }), 401, 'UNAUTHORIZED', '구글 로그인에 실패했어요. 다시 시도해 주세요.');
  });

  it('다른 키로 서명된 id_token → 401', async () => {
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({}).setProtectedHeader({ alg: 'RS256', kid: 'google-kid-1' }).setIssuer('https://accounts.google.com').setAudience(env.GOOGLE_CLIENT_ID).setSubject('x').setIssuedAt().setExpirationTime('5m').sign(other.privateKey);
    const { fetch } = mockFetch({});
    const oauth = createOAuthService(config(env), { fetch, jwks: { google: jwks } });
    await expectAppError(oauth.exchangeCode('google', { code: 'c', redirectUri, idToken: forged }), 401, 'UNAUTHORIZED');
  });
});

// ── 애플 ─────────────────────────────────────────────────────────────────────

describe('Apple 로그인', () => {
  const redirectUri = 'https://saju.example.com/auth/callback/apple';
  const APPLE = { APPLE_CLIENT_ID: 'com.example.saju.web', APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567', APPLE_BUNDLE_ID: 'com.example.saju' };
  let env: Record<string, string>;
  let clientSecretPublicKey: CryptoKey;
  let appleIdKey: CryptoKey;
  let jwks: ReturnType<typeof createLocalJWKSet>;

  beforeAll(async () => {
    // 개발자 계정의 Sign in with Apple 키(.p8, ES256) — env 에는 `\n` 이스케이프된 한 줄로 들어온다고 가정
    const signing = await generateKeyPair('ES256', { extractable: true });
    clientSecretPublicKey = signing.publicKey;
    env = { ...APPLE, APPLE_PRIVATE_KEY: escapePem(await exportPKCS8(signing.privateKey)) };
    // Apple 이 id_token 서명에 쓰는 키(RS256)
    const idKeys = await generateKeyPair('RS256');
    appleIdKey = idKeys.privateKey;
    jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(idKeys.publicKey)), kid: 'apple-kid-1', alg: 'RS256', use: 'sig' }] });
  });

  const idToken = (aud: string) =>
    new SignJWT({ email: 'abc123@privaterelay.appleid.com', email_verified: 'true', is_private_email: 'true' })
      .setProtectedHeader({ alg: 'RS256', kid: 'apple-kid-1' })
      .setIssuer('https://appleid.apple.com')
      .setAudience(aud)
      .setSubject('001234.apple-sub.0001')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(appleIdKey);

  it('authorize URL (form_post, name email)', () => {
    const raw = createOAuthService(config(env)).getAuthorizeUrl('apple', redirectUri, 'state-12345');
    expect(raw).toContain('scope=name%20email');
    const url = new URL(raw);
    expect(url.origin + url.pathname).toBe('https://appleid.apple.com/auth/authorize');
    expect(url.searchParams.get('response_mode')).toBe('form_post');
    expect(url.searchParams.get('client_id')).toBe(APPLE.APPLE_CLIENT_ID);
  });

  it('코드 교환 — ES256 client_secret 생성 + id_token 검증 + 최초 로그인 이름 사용', async () => {
    const token = await idToken(APPLE.APPLE_CLIENT_ID);
    let clientSecret = '';
    const { fetch, calls } = mockFetch({
      'https://appleid.apple.com/auth/token': ({ init }) => {
        clientSecret = form(init).get('client_secret') ?? '';
        return json({ access_token: 'a-at', token_type: 'Bearer', expires_in: 3600, id_token: token, refresh_token: 'a-rt' });
      },
      'https://appleid.apple.com/auth/revoke': () => json({}),
    });
    const oauth = createOAuthService(config(env), { fetch, jwks: { apple: jwks } });
    const profile = await oauth.exchangeCode('apple', { code: 'auth-code', redirectUri, name: '  김사주 ' });
    expect(profile).toEqual({ providerUserId: '001234.apple-sub.0001', email: 'abc123@privaterelay.appleid.com', nickname: '김사주', refreshToken: 'a-rt' });
    // 탈퇴 시 토큰 철회
    expect(await oauth.revoke('apple', 'a-rt')).toBe(true);
    const revokeCall = calls.find((c) => String(c.url).includes('/auth/revoke'))!;
    expect(form(revokeCall.init).get('token_type_hint')).toBe('refresh_token');
    expect(await oauth.revoke('kakao', 'x')).toBe(false);

    const body = form(calls[0]!.init);
    expect(body.get('client_id')).toBe(APPLE.APPLE_CLIENT_ID);
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('grant_type')).toBe('authorization_code');
    // client_secret = ES256 JWT (iss=팀 ID, sub=client_id, aud=appleid, kid=키 ID, 수명 ≤ 6개월)
    expect(decodeProtectedHeader(clientSecret)).toMatchObject({ alg: 'ES256', kid: APPLE.APPLE_KEY_ID });
    const { payload } = await jwtVerify(clientSecret, clientSecretPublicKey, {
      issuer: APPLE.APPLE_TEAM_ID,
      subject: APPLE.APPLE_CLIENT_ID,
      audience: 'https://appleid.apple.com',
    });
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(15_777_000);

    // 두 번째 로그인: client_secret 은 캐시 재사용, 이름 미전달 → null
    const second = await oauth.exchangeCode('apple', { code: 'auth-code-2', redirectUri });
    expect(form(calls[1]!.init).get('client_secret')).toBe(clientSecret);
    expect(second.nickname).toBeNull();
  });

  it('네이티브 앱 idToken 만 전달 — 코드 교환 없이 검증 (aud=번들 ID)', async () => {
    const { fetch, calls } = mockFetch({});
    const oauth = createOAuthService(config(env), { fetch, jwks: { apple: jwks } });
    const profile = await oauth.exchangeCode('apple', { code: 'unused', redirectUri, idToken: await idToken(APPLE.APPLE_BUNDLE_ID) });
    expect(profile.providerUserId).toBe('001234.apple-sub.0001');
    expect(calls).toHaveLength(0);
  });

  it('aud 불일치 → 401', async () => {
    const { fetch } = mockFetch({});
    const oauth = createOAuthService(config(env), { fetch, jwks: { apple: jwks } });
    await expectAppError(
      oauth.exchangeCode('apple', { code: 'c', redirectUri, idToken: await idToken('com.attacker.app') }),
      401,
      'UNAUTHORIZED',
      'Apple 로그인에 실패했어요. 다시 시도해 주세요.',
    );
  });
});

// ── FCM 푸시 ─────────────────────────────────────────────────────────────────

describe('FCM 푸시 발송', () => {
  const CLIENT_EMAIL = 'push@saju-test.iam.gserviceaccount.com';
  let env: Record<string, string>;
  let serviceAccountPublicKey: CryptoKey;

  beforeAll(async () => {
    const sa = await generateKeyPair('RS256', { extractable: true });
    serviceAccountPublicKey = sa.publicKey;
    env = {
      FCM_PROJECT_ID: 'saju-test',
      FCM_CLIENT_EMAIL: CLIENT_EMAIL,
      FCM_PRIVATE_KEY: escapePem(await exportPKCS8(sa.privateKey)),
      PUBLIC_WEB_URL: 'https://saju.example.com',
    };
  });

  function setup(opts: { now?: () => number } = {}) {
    const { db } = createDb(':memory:');
    runMigrations(db);
    db.insert(users)
      .values([
        { id: 'u1', nickname: '하나', provider: 'kakao' },
        { id: 'u2', nickname: '둘', provider: 'guest', pushEnabled: false },
        { id: 'u3', nickname: '셋', provider: 'google' },
      ])
      .run();
    const sentMessages: Array<{ token: string; message: Record<string, any> }> = [];
    const assertions: string[] = [];
    const { fetch, calls } = mockFetch({
      'https://oauth2.googleapis.com/token': ({ init }) => {
        const body = form(init);
        expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
        assertions.push(body.get('assertion')!);
        return json({ access_token: `ya29.token-${assertions.length}`, expires_in: 3599, token_type: 'Bearer' });
      },
      'https://fcm.googleapis.com/v1/projects/saju-test/messages:send': ({ init }) => {
        const { message } = JSON.parse(String(init.body)) as { message: Record<string, any> };
        sentMessages.push({ token: message.token, message });
        if (message.token.startsWith('dead-')) {
          return json(
            { error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } },
            404,
          );
        }
        if (message.token.startsWith('flaky-')) return json({ error: { code: 503, status: 'UNAVAILABLE' } }, 503);
        return json({ name: `projects/saju-test/messages/${sentMessages.length}` });
      },
    });
    const push = createPushService(config(env), db, { fetch, now: opts.now });
    return { db, push, calls, sentMessages, assertions };
  }

  const tokensOf = (db: ReturnType<typeof setup>['db']) => db.select({ token: pushTokens.token }).from(pushTokens).all().map((r) => r.token).sort();

  it('발송 + UNREGISTERED 토큰 정리 + 메시지 형식', async () => {
    const { db, push, calls, sentMessages, assertions } = setup();
    expect(push.enabled).toBe(true);
    push.register('u1', 'alive-token-0001', 'android');
    push.register('u1', 'dead-token-0002', 'ios');

    const message: PushMessage = { title: '오늘의 운세', body: '좋은 기운이 들어와요', link: '/fortune/today', data: { kind: 'daily' } };
    const result = await push.sendToUser('u1', message);
    expect(result).toEqual({ sent: 1, failed: 0, removed: 1 });
    expect(tokensOf(db)).toEqual(['alive-token-0001']);

    // 액세스 토큰 assertion: 서비스 계정 키로 RS256 서명, scope = firebase.messaging
    expect(assertions).toHaveLength(1);
    const { payload } = await jwtVerify(assertions[0]!, serviceAccountPublicKey, { issuer: CLIENT_EMAIL, audience: 'https://oauth2.googleapis.com/token' });
    expect(payload.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');

    const sendCall = calls.find((c) => c.url.includes('messages:send'))!;
    expect(header(sendCall.init, 'authorization')).toBe('Bearer ya29.token-1');
    const alive = sentMessages.find((m) => m.token === 'alive-token-0001')!.message;
    expect(alive.notification).toEqual({ title: '오늘의 운세', body: '좋은 기운이 들어와요' });
    expect(alive.data).toEqual({ kind: 'daily', link: '/fortune/today' });
    expect(alive.webpush.fcm_options.link).toBe('https://saju.example.com/fortune/today');
    expect(alive.apns.payload.aps.sound).toBe('default');
    expect(alive.android.priority).toBe('HIGH');
  });

  it('액세스 토큰 메모리 캐시 — 만료 전 재사용, 만료 임박 시 재발급', async () => {
    let clock = Date.UTC(2026, 9, 12, 0, 0, 0);
    const { push, assertions } = setup({ now: () => clock });
    push.register('u1', 'alive-token-0001', 'web');
    push.register('u3', 'alive-token-0003', 'web');

    // 동시 요청도 토큰 발급은 한 번만
    await Promise.all([push.sendToUser('u1', { title: 't', body: 'b' }), push.sendToUser('u3', { title: 't', body: 'b' })]);
    await push.sendToUser('u1', { title: 't', body: 'b' });
    await push.sendToUser('u3', { title: 't', body: 'b' });
    expect(assertions).toHaveLength(1);

    clock += 3599 * 1000 - 30_000; // 만료 30초 전 → 재발급
    await push.sendToUser('u1', { title: 't', body: 'b' });
    expect(assertions).toHaveLength(2);
  });

  it('푸시 수신 거부(pushEnabled=false) 사용자에게는 보내지 않음', async () => {
    const { push, calls } = setup();
    push.register('u2', 'alive-token-optout', 'web');
    expect(await push.sendToUser('u2', { title: 't', body: 'b' })).toEqual({ sent: 0, failed: 0, removed: 0 });
    expect(await push.sendToUser('nobody', { title: 't', body: 'b' })).toEqual({ sent: 0, failed: 0, removed: 0 });
    expect(calls).toHaveLength(0);
  });

  it('sendDailyFortuneDigest — 수신 동의 사용자만, null 은 건너뜀, 일시 오류 토큰은 유지', async () => {
    const { db, push, sentMessages } = setup();
    push.register('u1', 'alive-token-0001', 'android');
    push.register('u1', 'dead-token-0002', 'ios');
    push.register('u2', 'alive-token-optout', 'web');
    push.register('u3', 'flaky-token-0003', 'web');
    db.insert(users).values({ id: 'u4', nickname: '넷', provider: 'naver' }).run();
    push.register('u4', 'alive-token-0004', 'web');

    const build = vi.fn((userId: string): PushMessage | null => (userId === 'u4' ? null : { title: `${userId} 오늘의 운세`, body: '확인해 보세요', link: '/fortune/today' }));
    const result = await push.sendDailyFortuneDigest(build);

    expect(build.mock.calls.map(([id]) => id).sort()).toEqual(['u1', 'u3', 'u4']);
    expect(result).toEqual({ users: 2, skipped: 1, sent: 1, failed: 1, removed: 1 });
    expect(sentMessages.map((m) => m.token).sort()).toEqual(['alive-token-0001', 'dead-token-0002', 'flaky-token-0003']);
    expect(tokensOf(db)).toEqual(['alive-token-0001', 'alive-token-0004', 'alive-token-optout', 'flaky-token-0003']);
    expect(db.select().from(pushTokens).where(eq(pushTokens.token, 'dead-token-0002')).get()).toBeUndefined();
  });
});
