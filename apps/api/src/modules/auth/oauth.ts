/**
 * 소셜 로그인(OAuth 2.0 / OIDC) 어댑터 — 카카오·네이버·구글·애플.
 * 키가 설정되지 않은 제공자는 NOT_CONFIGURED(501)를 반환한다. 앱 등록·키 설정은 docs/AUTH_PUSH.md 참고.
 *
 * 흐름: GET /auth/oauth/:provider/authorize → getAuthorizeUrl() → 프론트가 제공자 로그인 페이지로 이동
 *      → 제공자가 redirectUri 로 code 전달 → 프론트가 POST /auth/oauth/:provider/callback → exchangeCode()
 * 네이티브 SDK(Sign in with Apple, Google Sign-In)가 id_token 을 직접 준 경우에는 코드 교환 없이 서명만 검증한다.
 */
import { ERROR_CODES, type SocialProvider } from '@saju/shared';
import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify, type CryptoKey, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { randomBytes } from 'node:crypto';
import type { AppConfig } from '../../config/env.js';
import { AppError, notConfigured } from '../../lib/errors.js';

export interface OAuthProfile {
  providerUserId: string;
  email: string | null;
  nickname: string | null;
  /** Apple refresh_token — 회원 탈퇴 시 토큰 철회(App Store 심사 5.1.1(v))에 사용 */
  refreshToken?: string | null;
}

export interface OAuthExchangeInput {
  code: string;
  redirectUri: string;
  /** 네이티브 SDK 가 발급한 id_token (Apple·Google). 있으면 코드 교환 없이 바로 검증 */
  idToken?: string;
  /** Apple 은 최초 로그인 때만 이름을 주므로 클라이언트가 넘겨준 값을 사용 */
  name?: string;
  /** 인가 요청 때 보낸 state — 네이버 토큰 요청 필수 파라미터 */
  state?: string;
}

export interface OAuthService {
  isEnabled(provider: SocialProvider): boolean;
  /** 인가(로그인) 페이지 URL */
  getAuthorizeUrl(provider: SocialProvider, redirectUri: string, state: string): string;
  /** 인가 코드 → 사용자 프로필 */
  exchangeCode(provider: SocialProvider, input: OAuthExchangeInput): Promise<OAuthProfile>;
  /** 회원 탈퇴 시 제공자 토큰 철회(현재 Apple 만 — 실패해도 탈퇴는 진행) */
  revoke(provider: string, refreshToken: string): Promise<boolean>;
}

/** 테스트용 의존성 주입(생략 시 전역 fetch · 원격 JWKS 사용) */
export interface OAuthDeps {
  fetch?: typeof fetch;
  jwks?: { google?: JWTVerifyGetKey; apple?: JWTVerifyGetKey };
}

export const OAUTH_ENV_KEYS: Record<SocialProvider, string[]> = {
  kakao: ['KAKAO_REST_API_KEY', 'KAKAO_CLIENT_SECRET(선택)'],
  naver: ['NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET'],
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  apple: ['APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'],
};

const PROVIDER_LABEL: Record<SocialProvider, string> = { kakao: '카카오 로그인', naver: '네이버 로그인', google: '구글 로그인', apple: 'Apple 로그인' };

const TIMEOUT_MS = 10_000;
const CLOCK_TOLERANCE_SEC = 60;
const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', Accept: 'application/json' };

const ENDPOINTS = {
  kakao: { authorize: 'https://kauth.kakao.com/oauth/authorize', token: 'https://kauth.kakao.com/oauth/token', me: 'https://kapi.kakao.com/v2/user/me' },
  naver: { authorize: 'https://nid.naver.com/oauth2.0/authorize', token: 'https://nid.naver.com/oauth2.0/token', me: 'https://openapi.naver.com/v1/nid/me' },
  google: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', jwks: 'https://www.googleapis.com/oauth2/v3/certs' },
  apple: { authorize: 'https://appleid.apple.com/auth/authorize', token: 'https://appleid.apple.com/auth/token', jwks: 'https://appleid.apple.com/auth/keys' },
} as const;

/** 카카오 동의항목 ID (콘솔 [동의항목]에서 둘 다 설정돼 있어야 함 — 미설정 시 KOE205) */
const KAKAO_SCOPE = 'profile_nickname,account_email';
const GOOGLE_SCOPE = 'openid email profile';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const APPLE_SCOPE = 'name email';
const APPLE_ISSUER = 'https://appleid.apple.com';
/** Apple client_secret 유효기간 — Apple 허용 최대치는 6개월(15,777,000초). 짧게 만들고 메모리 캐시 */
const APPLE_CLIENT_SECRET_TTL_SEC = 60 * 60;

// ── JWKS: 모듈 레벨 캐시 (jose 가 키 회전·재조회 쿨다운을 처리) ──────────────
let googleJwks: JWTVerifyGetKey | undefined;
let appleJwks: JWTVerifyGetKey | undefined;
const remoteJwks = (url: string): JWTVerifyGetKey => createRemoteJWKSet(new URL(url), { timeoutDuration: TIMEOUT_MS });
const getGoogleJwks = () => (googleJwks ??= remoteJwks(ENDPOINTS.google.jwks));
const getAppleJwks = () => (appleJwks ??= remoteJwks(ENDPOINTS.apple.jwks));

// ── 유틸 ────────────────────────────────────────────────────────────────────

/** env 에 한 줄로 넣은 PEM(`\n` 이스케이프, 따옴표 포함, 헤더 없는 base64)을 정상 PEM 으로 */
export function normalizePem(raw: string): string {
  let key = raw.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1).trim();
  key = key.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
  if (!key.includes('-----BEGIN')) {
    const body = key.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') ?? '';
    key = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
  }
  return key;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const isTrue = (v: unknown) => v === true || v === 'true';

/** 쿼리스트링 — 공백은 %20 (Apple/Google scope 호환) */
function buildUrl(base: string, params: Record<string, string>): string {
  return `${base}?${new URLSearchParams(params).toString().replace(/\+/g, '%20')}`;
}

function formBody(params: Record<string, string | undefined>): string {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) form.set(k, v);
  return form.toString();
}

/** 내부 실패 사유(서버 로그용) — 클라이언트에는 노출하지 않는다 */
class ProviderError extends Error {}

function loginFailed(provider: SocialProvider, cause?: unknown): AppError {
  const err = new AppError(401, ERROR_CODES.UNAUTHORIZED, `${PROVIDER_LABEL[provider]}에 실패했어요. 다시 시도해 주세요.`);
  if (cause !== undefined) err.cause = cause;
  return err;
}

export function createOAuthService(config: AppConfig, deps: OAuthDeps = {}): OAuthService {
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => fetch(input, init));
  const googleKeys = () => deps.jwks?.google ?? getGoogleJwks();
  const appleKeys = () => deps.jwks?.apple ?? getAppleJwks();

  const isEnabled = (p: SocialProvider) => config.features[p];
  const ensure = (p: SocialProvider) => {
    if (!isEnabled(p)) throw notConfigured(PROVIDER_LABEL[p], OAUTH_ENV_KEYS[p]);
  };

  async function requestJson(url: string, init: RequestInit): Promise<Json> {
    const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new ProviderError(`${url} → HTTP ${res.status}: JSON 이 아닌 응답`);
    }
    if (!res.ok) {
      const b = obj(body);
      const reason = str(b.error_description) ?? str(b.error) ?? str(b.msg) ?? str(b.message) ?? '';
      throw new ProviderError(`${url} → HTTP ${res.status} ${reason}`.trim());
    }
    return obj(body);
  }

  const postForm = (url: string, params: Record<string, string | undefined>) =>
    requestJson(url, { method: 'POST', headers: FORM_HEADERS, body: formBody(params) });
  const getWithBearer = (url: string, accessToken: string) =>
    requestJson(url, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });

  // ── Apple client_secret (ES256 JWT) ──
  let appleKey: Promise<CryptoKey> | undefined;
  let appleSecret: { value: string; exp: number } | undefined;
  async function appleClientSecret(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (appleSecret && appleSecret.exp - 300 > now) return appleSecret.value;
    appleKey ??= importPKCS8(normalizePem(config.APPLE_PRIVATE_KEY!), 'ES256').catch((e: unknown) => {
      appleKey = undefined;
      throw e;
    });
    const exp = now + APPLE_CLIENT_SECRET_TTL_SEC;
    const value = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: config.APPLE_KEY_ID! })
      .setIssuer(config.APPLE_TEAM_ID!)
      .setSubject(config.APPLE_CLIENT_ID!)
      .setAudience(APPLE_ISSUER)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .sign(await appleKey);
    appleSecret = { value, exp };
    return value;
  }

  // ── 제공자별 구현 ──
  async function kakao(input: OAuthExchangeInput): Promise<OAuthProfile> {
    const token = await postForm(ENDPOINTS.kakao.token, {
      grant_type: 'authorization_code',
      client_id: config.KAKAO_REST_API_KEY!,
      redirect_uri: input.redirectUri,
      code: input.code,
      client_secret: config.KAKAO_CLIENT_SECRET, // 콘솔에서 Client Secret 을 '사용함'으로 둔 경우만
    });
    const accessToken = str(token.access_token);
    if (!accessToken) throw new ProviderError('kakao: access_token 없음');
    const me = await getWithBearer(ENDPOINTS.kakao.me, accessToken);
    const id = typeof me.id === 'number' || typeof me.id === 'string' ? String(me.id) : null;
    if (!id) throw new ProviderError('kakao: 사용자 id 없음');
    const account = obj(me.kakao_account);
    const emailUsable = account.is_email_valid !== false && account.is_email_verified !== false;
    return {
      providerUserId: id,
      email: emailUsable ? str(account.email) : null,
      nickname: str(obj(account.profile).nickname) ?? str(obj(me.properties).nickname),
    };
  }

  async function naver(input: OAuthExchangeInput): Promise<OAuthProfile> {
    const token = await postForm(ENDPOINTS.naver.token, {
      grant_type: 'authorization_code',
      client_id: config.NAVER_CLIENT_ID!,
      client_secret: config.NAVER_CLIENT_SECRET!,
      code: input.code,
      // 네이버는 state 가 필수 파라미터. 라우트가 전달하지 않으면 임의 값으로 채운다(CSRF 검증은 프론트 책임)
      state: input.state ?? randomBytes(16).toString('hex'),
    });
    // 네이버는 실패도 HTTP 200 + { error, error_description } 으로 응답한다
    if (token.error) throw new ProviderError(`naver: ${String(token.error)} ${String(token.error_description ?? '')}`);
    const accessToken = str(token.access_token);
    if (!accessToken) throw new ProviderError('naver: access_token 없음');
    const me = await getWithBearer(ENDPOINTS.naver.me, accessToken);
    if (me.resultcode !== '00') throw new ProviderError(`naver: 프로필 조회 실패 ${String(me.resultcode)} ${String(me.message ?? '')}`);
    const r = obj(me.response);
    const id = str(r.id);
    if (!id) throw new ProviderError('naver: 사용자 id 없음');
    return { providerUserId: id, email: str(r.email), nickname: str(r.nickname) ?? str(r.name) };
  }

  async function verifyIdToken(idToken: string, keys: JWTVerifyGetKey, issuer: string | string[], audience: string[]): Promise<JWTPayload> {
    const { payload } = await jwtVerify(idToken, keys, { issuer, audience, algorithms: ['RS256'], clockTolerance: CLOCK_TOLERANCE_SEC });
    if (!str(payload.sub)) throw new ProviderError('id_token: sub 없음');
    return payload;
  }

  async function google(input: OAuthExchangeInput): Promise<OAuthProfile> {
    let idToken = str(input.idToken);
    if (!idToken) {
      const token = await postForm(ENDPOINTS.google.token, {
        grant_type: 'authorization_code',
        code: input.code,
        client_id: config.GOOGLE_CLIENT_ID!,
        client_secret: config.GOOGLE_CLIENT_SECRET!,
        redirect_uri: input.redirectUri,
      });
      idToken = str(token.id_token);
      if (!idToken) throw new ProviderError('google: id_token 없음');
    }
    const payload = await verifyIdToken(idToken, googleKeys(), GOOGLE_ISSUERS, [config.GOOGLE_CLIENT_ID!]);
    return {
      providerUserId: payload.sub!,
      email: isTrue(payload.email_verified) ? str(payload.email) : null,
      nickname: str(payload.name) ?? str(payload.given_name),
    };
  }

  async function apple(input: OAuthExchangeInput): Promise<OAuthProfile> {
    let idToken = str(input.idToken);
    let refreshToken: string | null = null;
    if (!idToken) {
      const token = await postForm(ENDPOINTS.apple.token, {
        grant_type: 'authorization_code',
        code: input.code,
        client_id: config.APPLE_CLIENT_ID!,
        client_secret: await appleClientSecret(),
        redirect_uri: input.redirectUri,
      });
      idToken = str(token.id_token);
      refreshToken = str(token.refresh_token) ?? null;
      if (!idToken) throw new ProviderError('apple: id_token 없음');
    }
    // 웹은 Services ID(APPLE_CLIENT_ID), iOS 네이티브는 번들 ID(APPLE_BUNDLE_ID)가 aud 로 들어온다
    const audience = [config.APPLE_CLIENT_ID!, ...(config.APPLE_BUNDLE_ID ? [config.APPLE_BUNDLE_ID] : [])];
    const payload = await verifyIdToken(idToken, appleKeys(), APPLE_ISSUER, audience);
    return {
      providerUserId: payload.sub!,
      // Apple 이 주는 이메일은 검증된 주소(또는 privaterelay.appleid.com 릴레이 주소)
      email: str(payload.email),
      nickname: str(input.name)?.slice(0, 50) ?? null,
      refreshToken,
    };
  }

  const exchangers: Record<SocialProvider, (input: OAuthExchangeInput) => Promise<OAuthProfile>> = { kakao, naver, google, apple };

  return {
    isEnabled,
    getAuthorizeUrl(provider, redirectUri, state) {
      ensure(provider);
      switch (provider) {
        case 'kakao':
          return buildUrl(ENDPOINTS.kakao.authorize, {
            response_type: 'code',
            client_id: config.KAKAO_REST_API_KEY!,
            redirect_uri: redirectUri,
            state,
            scope: KAKAO_SCOPE,
          });
        case 'naver':
          return buildUrl(ENDPOINTS.naver.authorize, {
            response_type: 'code',
            client_id: config.NAVER_CLIENT_ID!,
            redirect_uri: redirectUri,
            state,
          });
        case 'google':
          return buildUrl(ENDPOINTS.google.authorize, {
            response_type: 'code',
            client_id: config.GOOGLE_CLIENT_ID!,
            redirect_uri: redirectUri,
            scope: GOOGLE_SCOPE,
            state,
            access_type: 'online',
            include_granted_scopes: 'true',
            prompt: 'select_account',
          });
        case 'apple':
          return buildUrl(ENDPOINTS.apple.authorize, {
            response_type: 'code',
            response_mode: 'form_post', // scope(name/email) 요청 시 Apple 이 강제 — redirectUri 가 POST 를 받아야 함
            client_id: config.APPLE_CLIENT_ID!,
            redirect_uri: redirectUri,
            scope: APPLE_SCOPE,
            state,
          });
      }
    },
    async revoke(provider, refreshToken) {
      if (provider !== 'apple' || !isEnabled('apple') || !refreshToken) return false;
      try {
        await postForm('https://appleid.apple.com/auth/revoke', {
          client_id: config.APPLE_CLIENT_ID!,
          client_secret: await appleClientSecret(),
          token: refreshToken,
          token_type_hint: 'refresh_token',
        });
        return true;
      } catch {
        return false;
      }
    },
    async exchangeCode(provider, input) {
      ensure(provider);
      try {
        return await exchangers[provider](input);
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw loginFailed(provider, err);
      }
    },
  };
}
