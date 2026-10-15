import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { calculateSaju, computePillars, dayPillarOf, ganzhiHanja, isValidSolarDate, solarTermsOfYear, solarToLunar, utcToZoned, yearPillarOf, type SajuChart } from '@saju/core';
import { chartRequestSchema, type ManseDto } from '@saju/shared';
import { unauthorized } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { buildBasicReading, yearList, type ReadingAccess } from '../interpretation/reading.js';
import { birthDtoToInput } from '../profiles/service.js';

/** birth 또는 profileId 로 원국 계산. profileId 는 로그인 필요 */
export function resolveChart(app: FastifyInstance, req: FastifyRequest, body: z.output<typeof chartRequestSchema>): { chart: SajuChart; profileId: string | null; name: string | null } {
  if (body.profileId) {
    if (!req.user) throw unauthorized();
    const p = app.ctx.services.profiles.getOwned(req.user.id, body.profileId);
    return { chart: app.ctx.services.profiles.chartOf(p), profileId: p.id, name: p.name };
  }
  return { chart: calculateSaju(birthDtoToInput(body.birth!)), profileId: null, name: body.name ?? null };
}

export function todayInSeoul(): { year: number; month: number; day: number } {
  const t = utcToZoned(Date.now(), 'Asia/Seoul');
  return { year: t.year, month: t.month, day: t.day };
}

export const parseDate = (s: string) => {
  const [year, month, day] = s.split('-').map(Number) as [number, number, number];
  return { year, month, day };
};
export const dateQuery = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD 형식이어야 해요.')
  .refine((s) => {
    const d = parseDate(s);
    return d.year >= 1900 && d.year <= 2100 && isValidSolarDate(d.year, d.month, d.day);
  }, '존재하지 않는 날짜예요.');

export const sajuRoutes: FastifyPluginAsync = async (app) => {
  /** 만세력 원국 계산 (무료, 비회원 가능) */
  app.post('/chart', { preHandler: app.optionalAuth }, async (req) => {
    const body = parse(chartRequestSchema, req.body);
    return resolveChart(app, req, body).chart;
  });

  /** 기본 풀이 — 구매 여부에 따라 유료 섹션 잠금 */
  app.post('/reading', { preHandler: app.optionalAuth }, async (req) => {
    const body = parse(chartRequestSchema, req.body);
    const { chart, profileId, name } = resolveChart(app, req, body);
    const access: ReadingAccess = req.user && profileId ? app.ctx.services.reports.access(req.user.id, profileId) : 'none';
    return buildBasicReading(chart, { access, name });
  });

  /** 세운 목록 (연도별 점수) */
  app.post('/years', { preHandler: app.optionalAuth }, async (req) => {
    const body = parse(chartRequestSchema, req.body);
    const q = parse(
      z.object({ from: z.coerce.number().int().min(1900).max(2100).optional(), to: z.coerce.number().int().min(1900).max(2100).optional() }),
      req.query,
    );
    const { chart } = resolveChart(app, req, body);
    const now = new Date().getFullYear();
    const from = q.from ?? now - 2;
    const to = Math.min(q.to ?? now + 7, from + 30);
    return yearList(chart, from, to);
  });

  /** 만세력 — 특정 날짜의 년·월·일 간지와 그 해 절기 */
  app.get('/manse', async (req): Promise<ManseDto> => {
    const q = parse(z.object({ date: dateQuery.optional() }), req.query);
    const d = q.date ? parseDate(q.date) : todayInSeoul();
    const raw = computePillars({ calendar: 'solar', ...d, hour: 12, minute: 0, gender: 'male', timeCorrection: 'clock' });
    const dp = dayPillarOf(d);
    const yp = yearPillarOf(raw.sajuYear);
    return {
      date: `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`,
      lunar: solarToLunar(d),
      yearPillar: ganzhiHanja(yp.stem, yp.branch),
      monthPillar: ganzhiHanja(raw.month.stem, raw.month.branch),
      dayPillar: ganzhiHanja(dp.stem, dp.branch),
      solarTerms: solarTermsOfYear(d.year).map((t) => ({ name: t.name, at: new Date(t.utcMs).toISOString() })),
    };
  });
};
