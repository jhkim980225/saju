import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { tarotDrawSchema, tarotShuffleSchema } from '@saju/shared';
import { requireUser } from '../../app.js';
import { parse } from '../../lib/validate.js';

export const tarotRoutes: FastifyPluginAsync = async (app) => {
  const { tarot } = app.ctx.services;

  /** 오늘의 카드 — 같은 사람·같은 날은 같은 카드 */
  app.get('/daily', { preHandler: app.authenticate }, async (req) => {
    const q = parse(z.object({ profileId: z.string().optional() }), req.query);
    return tarot.daily(requireUser(req).id, q.profileId);
  });

  /** 카드 섞기 — 덱 토큰 발급(카드 순서는 보내지 않는다) */
  app.post('/shuffle', { preHandler: app.authenticate }, async (req) => tarot.shuffle(requireUser(req).id, parse(tarotShuffleSchema, req.body)));

  /** 고른 자리로 카드를 꺼내 리딩 생성 */
  app.post('/readings', { preHandler: app.authenticate }, async (req) => tarot.draw(requireUser(req).id, parse(tarotDrawSchema, req.body)));

  app.get('/readings', { preHandler: app.authenticate }, async (req) => tarot.history(requireUser(req).id));

  app.get('/readings/:id', { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    return tarot.get(requireUser(req).id, id);
  });

  app.delete('/readings/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = parse(z.object({ id: z.string() }), req.params);
    tarot.remove(requireUser(req).id, id);
    reply.status(204);
  });
};
