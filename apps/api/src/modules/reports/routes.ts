import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { reportCreateSchema } from '@saju/shared';
import { requireUser } from '../../app.js';
import { parse } from '../../lib/validate.js';

export const reportRoutes: FastifyPluginAsync = async (app) => {
  const { reports } = app.ctx.services;
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => reports.list(requireUser(req).id));

  /**
   * 리포트 생성(열람) — 구매 권한이 없으면 402 + 필요한 상품 ID.
   * 규칙 기반 본문을 바로 돌려주고, AI 가 설정돼 있으면 status 'polishing' 으로 뒤에서 다듬는다.
   */
  app.post('/', async (req, reply) => {
    const body = parse(reportCreateSchema, req.body);
    reply.status(201);
    return reports.create(requireUser(req).id, body);
  });

  app.get('/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    return reports.get(requireUser(req).id, id);
  });

  /** 다듬기 진행(본문 없이 가볍게) — 화면이 2초마다 폴링한다 */
  app.get('/:id/progress', async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    return reports.progress(requireUser(req).id, id);
  });
};
