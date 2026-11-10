import { Hono } from 'hono';
import { z } from 'zod';
import { tarotDrawSchema, tarotShuffleSchema } from '@saju/shared';
import { noContent, readJson, requireUser, type AppEnv, type RouteKit } from '../../lib/http.js';
import { parse } from '../../lib/validate.js';

export function tarotRoutes({ ctx, authenticate }: RouteKit) {
  const { tarot } = ctx.services;
  const app = new Hono<AppEnv>();
  app.use('*', authenticate);

  /** 오늘의 카드 — 같은 사람·같은 날은 같은 카드 */
  app.get('/daily', async (c) => {
    const q = parse(z.object({ profileId: z.string().optional() }), c.req.query());
    return c.json(await tarot.daily(requireUser(c).id, q.profileId));
  });

  /** 카드 섞기 — 덱 토큰 발급(카드 순서는 보내지 않는다) */
  app.post('/shuffle', async (c) => c.json(await tarot.shuffle(requireUser(c).id, parse(tarotShuffleSchema, await readJson(c)))));

  /** 고른 자리로 카드를 꺼내 리딩 생성 */
  app.post('/readings', async (c) => c.json(await tarot.draw(requireUser(c).id, parse(tarotDrawSchema, await readJson(c)))));

  app.get('/readings', async (c) => c.json(await tarot.history(requireUser(c).id)));

  app.get('/readings/:id', async (c) => {
    const { id } = parse(z.object({ id: z.string() }), c.req.param());
    return c.json(await tarot.get(requireUser(c).id, id));
  });

  app.delete('/readings/:id', async (c) => {
    const { id } = parse(z.object({ id: z.string() }), c.req.param());
    await tarot.remove(requireUser(c).id, id);
    return noContent(c);
  });

  return app;
}
