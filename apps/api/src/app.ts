/**
 * Hono 앱 조립. Worker(src/worker.ts)와 테스트가 같은 buildApp 을 쓴다 — 테스트는 인메모리 SQLite 를 넣는다.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { ERROR_CODES } from '@saju/shared';
import { SajuInputError } from '@saju/core';
import type { AppConfig } from './config/env.js';
import type { Db } from './db/client.js';
import { AppError, unauthorized } from './lib/errors.js';
import { rateLimit, type AppContext, type AppEnv, type AuthUser, type RateLimiter, type RouteKit } from './lib/http.js';
import { verifyAccessToken } from './lib/tokens.js';
import { createServices, type ServiceDeps } from './services.js';
import { authRoutes } from './modules/auth/routes.js';
import { profileRoutes } from './modules/profiles/routes.js';
import { sajuRoutes } from './modules/saju/routes.js';
import { fortuneRoutes } from './modules/fortune/routes.js';
import { compatibilityRoutes } from './modules/compatibility/routes.js';
import { reportRoutes } from './modules/reports/routes.js';
import { chatRoutes } from './modules/chat/routes.js';
import { tarotRoutes } from './modules/tarot/routes.js';
import { commerceRoutes } from './modules/commerce/routes.js';
import { pushRoutes } from './modules/push/routes.js';
import { configRoutes } from './modules/config/routes.js';
import { rewardRoutes } from './modules/rewards/routes.js';
import { tojeongRoutes } from './modules/tojeong/routes.js';
import { dreamRoutes } from './modules/dream/routes.js';
import { zodiacRoutes } from './modules/zodiac/routes.js';
import { taekilRoutes } from './modules/taekil/routes.js';

export type { AppContext, AuthUser } from './lib/http.js';

/** 요청 수 제한 — Worker 는 wrangler.jsonc 의 ratelimits 바인딩, 테스트·Node 는 비워 둔다(제한 없음) */
export interface RateLimiters {
  general?: RateLimiter;
  auth?: RateLimiter;
  admin?: RateLimiter;
}

export interface InjectResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  json: () => unknown;
}

export interface App {
  fetch: (request: Request) => Response | Promise<Response>;
  ctx: AppContext;
  /** 테스트·스크립트용 — 네트워크 없이 요청 하나를 보내 본다 */
  inject(request: { method: string; url: string; headers?: Record<string, string>; payload?: unknown }): Promise<InjectResponse>;
  close(): Promise<void>;
}

export function buildApp(opts: { config: AppConfig; db: Db; deps?: ServiceDeps; rateLimiters?: RateLimiters }): App {
  const { config } = opts;
  const services = createServices(config, opts.db, opts.deps);
  const ctx: AppContext = { config, db: opts.db, services };
  const limits = opts.rateLimiters ?? {};

  const readUser = async (header: string | undefined): Promise<AuthUser | null | undefined> => {
    if (!header?.startsWith('Bearer ')) return null;
    try {
      const claims = await verifyAccessToken(header.slice(7), config.JWT_ACCESS_SECRET);
      return { id: claims.sub, role: claims.role } satisfies AuthUser;
    } catch {
      return undefined; // 토큰이 있으나 유효하지 않음
    }
  };
  const kit: RouteKit = {
    ctx,
    authenticate: async (c, next) => {
      const u = await readUser(c.req.header('authorization'));
      if (!u) throw new AppError(401, ERROR_CODES.UNAUTHORIZED, u === undefined ? '로그인이 만료되었어요. 다시 로그인해 주세요.' : '로그인이 필요해요.');
      if (!(await services.users.isActive(u.id))) throw unauthorized('탈퇴했거나 존재하지 않는 계정이에요.');
      c.set('user', u);
      await next();
    },
    optionalAuth: async (c, next) => {
      const u = await readUser(c.req.header('authorization'));
      if (u && (await services.users.isActive(u.id))) c.set('user', u);
      await next();
    },
    authLimit: rateLimit(limits.auth, 'auth'),
    adminLimit: rateLimit(limits.admin, 'admin'),
  };

  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('user', null);
    await next();
  });
  app.use('*', secureHeaders());
  app.use(
    '*',
    cors({
      // 앱(WebView)·서버 간 호출은 Origin 이 없을 수 있다
      origin: (origin) => (!origin || config.corsOrigins.includes(origin) || config.corsOrigins.includes('*') ? origin : null),
      credentials: true,
    }),
  );
  app.use(
    '*',
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => c.json({ error: { code: ERROR_CODES.VALIDATION, message: '요청 본문이 너무 커요.' } }, 413),
    }),
  );

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.statusCode as 400);
    }
    if (err instanceof SajuInputError) {
      return c.json({ error: { code: ERROR_CODES.VALIDATION, message: err.message } }, 400);
    }
    if (err instanceof HTTPException && err.status < 500) {
      return c.json({ error: { code: ERROR_CODES.VALIDATION, message: err.message || '잘못된 요청이에요.' } }, err.status);
    }
    console.error(`[api] ${c.req.method} ${c.req.path}`, err);
    return c.json({ error: { code: ERROR_CODES.INTERNAL, message: '일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: ERROR_CODES.NOT_FOUND, message: `경로를 찾을 수 없어요: ${c.req.method} ${c.req.path}` } }, 404));

  app.get('/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

  const api = new Hono<AppEnv>();
  api.use('*', rateLimit(limits.general, 'api'));
  api.route('/', configRoutes(kit));
  api.route('/auth', authRoutes(kit));
  api.route('/profiles', profileRoutes(kit));
  api.route('/saju', sajuRoutes(kit));
  api.route('/fortune', fortuneRoutes(kit));
  api.route('/compatibility', compatibilityRoutes(kit));
  api.route('/reports', reportRoutes(kit));
  api.route('/chat', chatRoutes(kit));
  api.route('/tarot', tarotRoutes(kit));
  api.route('/', commerceRoutes(kit));
  api.route('/push', pushRoutes(kit));
  api.route('/rewards', rewardRoutes(kit));
  api.route('/tojeong', tojeongRoutes(kit));
  api.route('/dream', dreamRoutes(kit));
  api.route('/', zodiacRoutes(kit));
  api.route('/taekil', taekilRoutes(kit));
  app.route('/api/v1', api);

  return {
    fetch: (request) => app.fetch(request),
    ctx,
    async inject({ method, url, headers, payload }) {
      const h = new Headers(headers);
      let body: string | undefined;
      if (payload !== undefined) {
        body = typeof payload === 'string' ? payload : JSON.stringify(payload);
        if (!h.has('content-type') && typeof payload !== 'string') h.set('content-type', 'application/json');
      }
      const res = await app.request(url, { method, headers: h, body });
      const text = await res.text();
      return { statusCode: res.status, body: text, headers: Object.fromEntries(res.headers), json: () => JSON.parse(text) as unknown };
    },
    async close() {},
  };
}
