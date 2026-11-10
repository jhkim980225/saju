import { Hono } from 'hono';
import { z } from 'zod';
import { calculateSaju } from '@saju/core';
import { birthInputSchema } from '@saju/shared';
import { readJson, requireUser, type AppEnv, type RouteKit } from '../../lib/http.js';
import { parse } from '../../lib/validate.js';
import { buildDailyFortune, buildYearlyFortune, targetFortuneYear } from '../interpretation/reading.js';
import { birthDtoToInput } from '../profiles/service.js';
import { dateQuery, parseDate, todayInSeoul } from '../saju/routes.js';

export function fortuneRoutes({ ctx, authenticate }: RouteKit) {
  const { profiles, reports } = ctx.services;
  const app = new Hono<AppEnv>();

  /** 오늘의 운세 — 저장된 프로필 기준 (프로필 미지정 시 대표 프로필) */
  app.get('/daily', authenticate, async (c) => {
    const q = parse(z.object({ profileId: z.string().optional(), date: dateQuery.optional() }), c.req.query());
    const user = requireUser(c);
    const profile = q.profileId ? await profiles.getOwned(user.id, q.profileId) : await profiles.primary(user.id);
    if (!profile) return c.json({ needsProfile: true });
    return c.json(buildDailyFortune(profiles.chartOf(profile), q.date ? parseDate(q.date) : todayInSeoul(), profile.id, profile.name));
  });

  /** 오늘의 운세 — 비회원(생년월일 직접 입력). name 은 풀이에서 부를 이름(선택) */
  app.post('/daily', async (c) => {
    const body = parse(z.object({ birth: birthInputSchema, date: dateQuery.optional(), name: z.string().max(20).optional() }), await readJson(c));
    return c.json(buildDailyFortune(calculateSaju(birthDtoToInput(body.birth)), body.date ? parseDate(body.date) : todayInSeoul(), null, body.name ?? null));
  });

  /** 신년운세 — 미구매 시 총운·첫 두 달만 공개 */
  app.get('/yearly', authenticate, async (c) => {
    const q = parse(z.object({ profileId: z.string(), year: z.coerce.number().int().min(1900).max(2100).optional() }), c.req.query());
    const user = requireUser(c);
    const profile = await profiles.getOwned(user.id, q.profileId);
    const year = q.year ?? targetFortuneYear();
    return c.json(buildYearlyFortune(profiles.chartOf(profile), year, await reports.yearlyUnlocked(user.id, profile.id, year), profile.name));
  });

  return app;
}
