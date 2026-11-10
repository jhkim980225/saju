import { Hono } from 'hono';
import { z } from 'zod';
import { taekilCreateSchema } from '@saju/shared';
import { readJson, requireUser, type AppEnv, type RouteKit } from '../../lib/http.js';
import { parse } from '../../lib/validate.js';

export function taekilRoutes({ ctx, authenticate }: RouteKit) {
  const { taekil } = ctx.services;
  const app = new Hono<AppEnv>();
  app.use('*', authenticate);

  /** 택일 계산 — 무료 미리보기(등급·Top 3 날짜)로 저장하고 돌려준다. 같은 입력은 저장본 */
  app.post('/', async (c) => {
    const body = parse(taekilCreateSchema, await readJson(c));
    return c.json(await taekil.create(requireUser(c).id, body), 201);
  });

  app.get('/', async (c) => c.json(await taekil.list(requireUser(c).id)));

  app.get('/:id', async (c) => {
    const { id } = parse(z.object({ id: z.string() }), c.req.param());
    return c.json(await taekil.get(requireUser(c).id, id));
  });

  return app;
}
