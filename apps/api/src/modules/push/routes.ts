import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pushRegisterSchema } from '@saju/shared';
import { requireUser } from '../../app.js';
import { parse } from '../../lib/validate.js';

export const pushRoutes: FastifyPluginAsync = async (app) => {
  const { push } = app.ctx.services;
  app.addHook('preHandler', app.authenticate);

  app.post('/tokens', async (req, reply) => {
    const body = parse(pushRegisterSchema, req.body);
    push.register(requireUser(req).id, body.token, body.platform);
    reply.status(204);
  });

  app.delete('/tokens', async (req, reply) => {
    const body = parse(z.object({ token: z.string() }), req.body);
    push.unregister(body.token);
    reply.status(204);
  });
};
