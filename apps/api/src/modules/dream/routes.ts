import type { FastifyPluginAsync } from 'fastify';
import { dreamInterpretSchema } from '@saju/shared/dream';
import { requireUser } from '../../app.js';
import { parse } from '../../lib/validate.js';
import { createDreamService } from './service.js';

/**
 * 꿈해몽 — 사전은 웹이 @saju/shared/dream 을 직접 번들하므로 여기에는 AI 꿈풀이만 둔다.
 * 서비스 조립(services.ts)을 건드리지 않도록 이 플러그인 안에서 만든다.
 */
export const dreamRoutes: FastifyPluginAsync = async (app) => {
  const { config, services } = app.ctx;
  const dream = createDreamService(config, services.profiles, services.commerce, services.ai);

  /** AI 꿈풀이 — AI 연동 시 질문권 1회 차감, 미연동이면 사전 기반 기본 풀이(무료) */
  app.post('/interpret', { preHandler: app.authenticate }, async (req) => dream.interpret(requireUser(req).id, parse(dreamInterpretSchema, req.body)));
};
