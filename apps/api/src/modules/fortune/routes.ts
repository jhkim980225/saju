import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { calculateSaju } from '@saju/core';
import { birthInputSchema } from '@saju/shared';
import { requireUser } from '../../app.js';
import { parse } from '../../lib/validate.js';
import { buildDailyFortune, buildYearlyFortune, targetFortuneYear } from '../interpretation/reading.js';
import { birthDtoToInput } from '../profiles/service.js';
import { dateQuery, parseDate, todayInSeoul } from '../saju/routes.js';

export const fortuneRoutes: FastifyPluginAsync = async (app) => {
  const { profiles, reports } = app.ctx.services;

  /** 오늘의 운세 — 저장된 프로필 기준 (프로필 미지정 시 대표 프로필) */
  app.get('/daily', { preHandler: app.authenticate }, async (req) => {
    const q = parse(z.object({ profileId: z.string().optional(), date: dateQuery.optional() }), req.query);
    const user = requireUser(req);
    const profile = q.profileId ? profiles.getOwned(user.id, q.profileId) : profiles.primary(user.id);
    if (!profile) return { needsProfile: true };
    return buildDailyFortune(profiles.chartOf(profile), q.date ? parseDate(q.date) : todayInSeoul(), profile.id);
  });

  /** 오늘의 운세 — 비회원(생년월일 직접 입력) */
  app.post('/daily', async (req) => {
    const body = parse(z.object({ birth: birthInputSchema, date: dateQuery.optional() }), req.body);
    return buildDailyFortune(calculateSaju(birthDtoToInput(body.birth)), body.date ? parseDate(body.date) : todayInSeoul(), null);
  });

  /** 신년운세 — 미구매 시 총운·첫 두 달만 공개 */
  app.get('/yearly', { preHandler: app.authenticate }, async (req) => {
    const q = parse(z.object({ profileId: z.string(), year: z.coerce.number().int().min(1900).max(2100).optional() }), req.query);
    const user = requireUser(req);
    const profile = profiles.getOwned(user.id, q.profileId);
    const year = q.year ?? targetFortuneYear();
    return buildYearlyFortune(profiles.chartOf(profile), year, reports.yearlyUnlocked(user.id, profile.id, year));
  });
};
