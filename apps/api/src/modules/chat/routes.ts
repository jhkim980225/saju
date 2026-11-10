import { Hono } from 'hono';
import { z } from 'zod';
import { chatSendSchema } from '@saju/shared';
import { noContent, readJson, requireUser, type AppEnv, type RouteKit } from '../../lib/http.js';
import { parse } from '../../lib/validate.js';

export function chatRoutes({ ctx, authenticate }: RouteKit) {
  const { chat } = ctx.services;
  const app = new Hono<AppEnv>();
  app.use('*', authenticate);

  app.get('/', async (c) => {
    const q = parse(z.object({ profileId: z.string() }), c.req.query());
    return c.json(await chat.history(requireUser(c).id, q.profileId));
  });

  app.post('/', async (c) => {
    const body = parse(chatSendSchema, await readJson(c));
    return c.json(await chat.send(requireUser(c).id, body));
  });

  app.delete('/', async (c) => {
    const q = parse(z.object({ profileId: z.string() }), c.req.query());
    await chat.clear(requireUser(c).id, q.profileId);
    return noContent(c);
  });

  return app;
}
