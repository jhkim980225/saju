import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { reportCreateSchema } from '@saju/shared';
import { requireUser } from '../../app.js';
import { parse } from '../../lib/validate.js';

export const reportRoutes: FastifyPluginAsync = async (app) => {
  const { reports } = app.ctx.services;
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => reports.list(requireUser(req).id));

  /** 리포트 생성(열람) — 구매 권한이 없으면 402 + 필요한 상품 ID */
  app.post('/', async (req, reply) => {
    const body = parse(reportCreateSchema, req.body);
    reply.status(201);
    return reports.create(requireUser(req).id, body);
  });

  app.get('/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    return reports.get(requireUser(req).id, id);
  });
};
