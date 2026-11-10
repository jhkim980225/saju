import { Hono } from 'hono';
import { dreamInterpretSchema } from '@saju/shared/dream';
import { readJson, requireUser, type AppEnv, type RouteKit } from '../../lib/http.js';
import { parse } from '../../lib/validate.js';
import { createDreamService } from './service.js';

/**
 * 꿈해몽 — 사전은 웹이 @saju/shared/dream 을 직접 번들하므로 여기에는 AI 꿈풀이만 둔다.
 * 서비스 조립(services.ts)을 건드리지 않도록 이 라우트 안에서 만든다.
 */
export function dreamRoutes({ ctx, authenticate }: RouteKit) {
  const { config, services } = ctx;
  const dream = createDreamService(config, services.profiles, services.commerce, services.ai);
  const app = new Hono<AppEnv>();

  /** AI 꿈풀이 — AI 연동 시 질문권 1회 차감, 미연동이면 사전 기반 기본 풀이(무료) */
  app.post('/interpret', authenticate, async (c) => c.json(await dream.interpret(requireUser(c).id, parse(dreamInterpretSchema, await readJson(c)))));

  return app;
}
