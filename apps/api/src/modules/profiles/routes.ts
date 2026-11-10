import { Hono } from 'hono';
import { z } from 'zod';
import { profileCreateSchema, profileUpdateSchema } from '@saju/shared';
import { noContent, readJson, requireUser, type AppEnv, type RouteKit } from '../../lib/http.js';
import { parse } from '../../lib/validate.js';

const idParam = z.object({ id: z.string().min(1) });

export function profileRoutes({ ctx, authenticate }: RouteKit) {
  const { profiles } = ctx.services;
  const app = new Hono<AppEnv>();
  app.use('*', authenticate);

  app.get('/', async (c) => c.json((await profiles.list(requireUser(c).id)).map((p) => profiles.toDto(p))));

  app.post('/', async (c) => {
    const body = parse(profileCreateSchema, await readJson(c));
    return c.json(profiles.toDto(await profiles.create(requireUser(c).id, body)), 201);
  });

  app.get('/:id', async (c) => {
    const { id } = parse(idParam, c.req.param());
    return c.json(profiles.toDto(await profiles.getOwned(requireUser(c).id, id)));
  });

  app.patch('/:id', async (c) => {
    const { id } = parse(idParam, c.req.param());
    const body = parse(profileUpdateSchema, await readJson(c));
    return c.json(profiles.toDto(await profiles.update(requireUser(c).id, id, body)));
  });

  app.delete('/:id', async (c) => {
    const { id } = parse(idParam, c.req.param());
    await profiles.remove(requireUser(c).id, id);
    return noContent(c);
  });

  return app;
}
