import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { profileCreateSchema, profileUpdateSchema } from '@saju/shared';
import { requireUser } from '../../app.js';
import { parse } from '../../lib/validate.js';

const idParam = z.object({ id: z.string().min(1) });

export const profileRoutes: FastifyPluginAsync = async (app) => {
  const { profiles } = app.ctx.services;
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => profiles.list(requireUser(req).id).map((p) => profiles.toDto(p)));

  app.post('/', async (req, reply) => {
    const body = parse(profileCreateSchema, req.body);
    reply.status(201);
    return profiles.toDto(profiles.create(requireUser(req).id, body));
  });

  app.get('/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    return profiles.toDto(profiles.getOwned(requireUser(req).id, id));
  });

  app.patch('/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(profileUpdateSchema, req.body);
    return profiles.toDto(profiles.update(requireUser(req).id, id, body));
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    profiles.remove(requireUser(req).id, id);
    reply.status(204);
  });
};
