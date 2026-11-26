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
    const userId = requireUser(c).id;
    await profiles.getOwned(userId, id);
    // 지우면 출생 정보가 사라져 산 리포트를 다시 만들 수 없다 — 아직 만들지 않은 리포트를 먼저 만들어 보관함에 남긴다
    await ctx.services.reports.materializeForProfile(userId, id);
    await profiles.remove(userId, id);
    return noContent(c);
  });

  return app;
}
