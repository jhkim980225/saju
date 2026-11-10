import { Hono } from 'hono';
import { z } from 'zod';
import { reportCreateSchema } from '@saju/shared';
import { readJson, requireUser, type AppEnv, type RouteKit } from '../../lib/http.js';
import { parse } from '../../lib/validate.js';

export function reportRoutes({ ctx, authenticate }: RouteKit) {
  const { reports } = ctx.services;
  const app = new Hono<AppEnv>();
  app.use('*', authenticate);

  app.get('/', async (c) => c.json(await reports.list(requireUser(c).id)));

  /**
   * 리포트 생성(열람) — 구매 권한이 없으면 402 + 필요한 상품 ID.
   * 규칙 기반 본문을 바로 돌려주고, AI 가 설정돼 있으면 status 'polishing' 으로 뒤에서 다듬는다.
   */
  app.post('/', async (c) => {
    const body = parse(reportCreateSchema, await readJson(c));
    return c.json(await reports.create(requireUser(c).id, body), 201);
  });

  app.get('/:id', async (c) => {
    const { id } = parse(z.object({ id: z.string() }), c.req.param());
    return c.json(await reports.get(requireUser(c).id, id));
  });

  /** 다듬기 진행(본문 없이 가볍게) — 화면이 2초마다 폴링한다 */
  app.get('/:id/progress', async (c) => {
    const { id } = parse(z.object({ id: z.string() }), c.req.param());
    return c.json(await reports.progress(requireUser(c).id, id));
  });

  return app;
}
