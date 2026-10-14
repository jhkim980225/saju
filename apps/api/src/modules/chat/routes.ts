import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { chatSendSchema } from '@saju/shared';
import { requireUser } from '../../app.js';
import { parse } from '../../lib/validate.js';

export const chatRoutes: FastifyPluginAsync = async (app) => {
  const { chat } = app.ctx.services;
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => {
    const q = parse(z.object({ profileId: z.string() }), req.query);
    return chat.history(requireUser(req).id, q.profileId);
  });

  app.post('/', async (req) => {
    const body = parse(chatSendSchema, req.body);
    return chat.send(requireUser(req).id, body);
  });

  app.delete('/', async (req, reply) => {
    const q = parse(z.object({ profileId: z.string() }), req.query);
    chat.clear(requireUser(req).id, q.profileId);
    reply.status(204);
  });
};
