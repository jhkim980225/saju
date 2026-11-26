/**
 * 라우트 공용 — Hono 컨텍스트 타입, 로그인 사용자, 요청 본문 읽기, 요청 수 제한.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { ERROR_CODES } from '@saju/shared';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/client.js';
import type { Services } from '../services.js';
import { AppError, badRequest, unauthorized } from './errors.js';

export interface AuthUser {
  id: string;
  role: 'user' | 'admin';
}

export type AppEnv = { Variables: { user: AuthUser | null } };
export type Ctx = Context<AppEnv>;

export interface AppContext {
  config: AppConfig;
  db: Db;
  services: Services;
}

/** Cloudflare Rate Limiting 바인딩과 같은 모양 — 테스트·Node 에서는 넘기지 않는다(제한 없음) */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** 라우트 모듈이 받는 것 — 서비스·설정과 공용 미들웨어 */
export interface RouteKit {
  ctx: AppContext;
  /** 로그인 필수 */
  authenticate: MiddlewareHandler<AppEnv>;
  /** 로그인했으면 사용자를 채운다 */
  optionalAuth: MiddlewareHandler<AppEnv>;
  /** 무차별 대입 방지용 엄격 제한(로그인·가입·소셜·토스 로그인·비밀번호) */
  authLimit: MiddlewareHandler<AppEnv>;
  /** 세션 유지 경로 제한(게스트 시작·토큰 갱신) — 한 IP 를 여럿이 쓰는 곳(회사·학교)에서 막히지 않게 인증 제한보다 넉넉하다 */
  sessionLimit: MiddlewareHandler<AppEnv>;
  /** 관리자 경로 제한 */
  adminLimit: MiddlewareHandler<AppEnv>;
}

/** 인증된 요청에서 사용자 꺼내기 (authenticate 이후) */
export function requireUser(c: Ctx): AuthUser {
  const u = c.get('user');
  if (!u) throw unauthorized();
  return u;
}

/** JSON 본문 — 비어 있으면 undefined, 잘못된 JSON 이면 400 */
export async function readJson(c: Ctx): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw badRequest('요청 본문이 올바른 JSON 형식이 아니에요.');
  }
}

/** 요청 헤더(이름은 소문자) — 결제사·스토어 서명 검증용 */
export const headersOf = (c: Ctx): Record<string, string> => Object.fromEntries(c.req.raw.headers);

export const noContent = (c: Ctx) => c.body(null, 204);

/** 접속 IP — Cloudflare 가 넣어 주는 헤더(위조 불가). 로컬·테스트는 'local' */
export const clientIp = (c: Ctx) => c.req.header('cf-connecting-ip') ?? 'local';

export function rateLimit(limiter: RateLimiter | undefined, scope: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (limiter) {
      const { success } = await limiter.limit({ key: `${scope}:${clientIp(c)}` });
      if (!success) throw new AppError(429, ERROR_CODES.RATE_LIMITED, '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.');
    }
    await next();
  };
}
