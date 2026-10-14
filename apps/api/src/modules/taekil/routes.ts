import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { taekilCreateSchema } from '@saju/shared';
import { requireUser } from '../../app.js';
import { parse } from '../../lib/validate.js';

export const taekilRoutes: FastifyPluginAsync = async (app) => {
  const { taekil } = app.ctx.services;
  app.addHook('preHandler', app.authenticate);

  /** 택일 계산 — 무료 미리보기(등급·Top 3 날짜)로 저장하고 돌려준다. 같은 입력은 저장본 */
  app.post('/', async (req, reply) => {
    const body = parse(taekilCreateSchema, req.body);
    reply.status(201);
    return taekil.create(requireUser(req).id, body);
  });

  app.get('/', async (req) => taekil.list(requireUser(req).id));

  app.get('/:id', async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    return taekil.get(requireUser(req).id, id);
  });
};
