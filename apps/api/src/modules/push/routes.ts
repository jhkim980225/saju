import { Hono } from 'hono';
import { z } from 'zod';
import { pushRegisterSchema } from '@saju/shared';
import { noContent, readJson, requireUser, type AppEnv, type RouteKit } from '../../lib/http.js';
import { parse } from '../../lib/validate.js';

export function pushRoutes({ ctx, authenticate }: RouteKit) {
  const { push } = ctx.services;
  const app = new Hono<AppEnv>();
  app.use('*', authenticate);

  app.post('/tokens', async (c) => {
    const body = parse(pushRegisterSchema, await readJson(c));
    await push.register(requireUser(c).id, body.token, body.platform);
    return noContent(c);
  });

  app.delete('/tokens', async (c) => {
    const body = parse(z.object({ token: z.string() }), await readJson(c));
    await push.unregister(requireUser(c).id, body.token);
    return noContent(c);
  });

  return app;
}
