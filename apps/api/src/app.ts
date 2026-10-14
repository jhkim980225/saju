/**
 * Fastify 앱 조립. 테스트에서는 buildApp({ config, db }) 로 인메모리 DB 를 주입한다.
 */
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@saju/shared';
import { SajuInputError } from '@saju/core';
import type { AppConfig } from './config/env.js';
import type { Db } from './db/client.js';
import { AppError, unauthorized } from './lib/errors.js';
import { verifyAccessToken } from './lib/tokens.js';
import { createServices, type ServiceDeps, type Services } from './services.js';
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

export interface AuthUser {
  id: string;
  role: 'user' | 'admin';
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    optionalAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export interface AppContext {
  config: AppConfig;
  db: Db;
  services: Services;
}

/** 인증된 요청에서 사용자 꺼내기 (authenticate preHandler 이후) */
export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export async function buildApp(opts: { config: AppConfig; db: Db; logger?: boolean; deps?: ServiceDeps }): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? !opts.config.isTest,
    // 프록시 홉 수만큼만 X-Forwarded-For 를 신뢰 (0 이면 신뢰 안 함)
    trustProxy: (_address: string, hop: number) => hop < opts.config.TRUST_PROXY_HOPS,
    bodyLimit: 1024 * 1024,
  });
  const services = createServices(opts.config, opts.db, opts.deps);
  app.decorate('ctx', { config: opts.config, db: opts.db, services });
  app.decorateRequest('user', null);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: (origin, cb) => {
      // 앱(WebView)·서버 간 호출은 Origin 이 없을 수 있다
      if (!origin || opts.config.corsOrigins.includes(origin) || opts.config.corsOrigins.includes('*')) cb(null, true);
      else cb(null, false);
    },
    credentials: true,
  });
  if (!opts.config.isTest) {
    await app.register(rateLimit, {
      max: opts.config.RATE_LIMIT_PER_MIN,
      timeWindow: '1 minute',
      // statusCode 를 포함해야 오류 핸들러가 429 로 응답한다(없으면 500)
      errorResponseBuilder: () => ({ statusCode: 429, error: { code: ERROR_CODES.RATE_LIMITED, message: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' } }),
    });
  }

  const readUser = async (req: FastifyRequest) => {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return null;
    try {
      const claims = await verifyAccessToken(h.slice(7), opts.config.JWT_ACCESS_SECRET);
      return { id: claims.sub, role: claims.role } satisfies AuthUser;
    } catch {
      return undefined; // 토큰이 있으나 유효하지 않음
    }
  };
  app.decorate('authenticate', async (req: FastifyRequest) => {
    const u = await readUser(req);
    if (!u) throw new AppError(401, ERROR_CODES.UNAUTHORIZED, u === undefined ? '로그인이 만료되었어요. 다시 로그인해 주세요.' : '로그인이 필요해요.');
    if (!services.users.isActive(u.id)) throw unauthorized('탈퇴했거나 존재하지 않는 계정이에요.');
    req.user = u;
  });
  app.decorate('optionalAuth', async (req: FastifyRequest) => {
    const u = await readUser(req);
    if (u && services.users.isActive(u.id)) req.user = u;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof SajuInputError) {
      return reply.status(400).send({ error: { code: ERROR_CODES.VALIDATION, message: err.message } });
    }
    const e = err as { statusCode?: number; validation?: unknown; message?: string };
    if (e.statusCode === 429) {
      return reply.status(429).send({ error: { code: ERROR_CODES.RATE_LIMITED, message: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.' } });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: { code: ERROR_CODES.VALIDATION, message: e.message ?? '잘못된 요청이에요.' } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: ERROR_CODES.INTERNAL, message: '일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' } });
  });
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: { code: ERROR_CODES.NOT_FOUND, message: `경로를 찾을 수 없어요: ${req.method} ${req.url}` } });
  });

  app.get('/health', async () => ({ ok: true, time: new Date().toISOString() }));

  await app.register(
    async (api) => {
      await api.register(configRoutes);
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(profileRoutes, { prefix: '/profiles' });
      await api.register(sajuRoutes, { prefix: '/saju' });
      await api.register(fortuneRoutes, { prefix: '/fortune' });
      await api.register(compatibilityRoutes, { prefix: '/compatibility' });
      await api.register(reportRoutes, { prefix: '/reports' });
      await api.register(chatRoutes, { prefix: '/chat' });
      await api.register(tarotRoutes, { prefix: '/tarot' });
      await api.register(commerceRoutes);
      await api.register(pushRoutes, { prefix: '/push' });
      await api.register(rewardRoutes, { prefix: '/rewards' });
      await api.register(tojeongRoutes, { prefix: '/tojeong' });
      await api.register(dreamRoutes, { prefix: '/dream' });
      await api.register(zodiacRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
