/**
 * 띠별 운세 · 별자리 운세 — 로그인 없이 보는 공개 콘텐츠(검색 유입용). 개인 정보는 받지 않는다.
 *
 * GET /zodiac?period&date               12띠 한 줄 요약
 * GET /zodiac/:animal?period&date       띠 하나 (rat … pig)
 * GET /horoscope?period&date            12별자리 한 줄 요약
 * GET /horoscope/:sign?period&date      별자리 하나 (aries … pisces)
 *
 * date 범위: 띠는 1900~2100년, 별자리는 천문 근사가 맞는 ASTRO_MIN_YEAR~ASTRO_MAX_YEAR(1900~2049)년.
 * date 없이 부르면 서버의 오늘(KST)로 계산하고, 캐시는 KST 자정을 넘기지 않게 짧게 준다(자정 직후 전날 결과가 나오지 않게).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { ASTRO_MAX_YEAR, ASTRO_MIN_YEAR } from '@saju/core';
import { FREE_FORTUNE_PERIODS, starSignBySlug, zodiacAnimalBySlug } from '@saju/shared';
import { notFound } from '../../lib/errors.js';
import type { AppEnv, Ctx, RouteKit } from '../../lib/http.js';
import { parse } from '../../lib/validate.js';
import { dateQuery, parseDate, todayInSeoul } from '../saju/routes.js';
import { buildHoroscope, buildHoroscopeOverview } from './horoscope.js';
import { buildZodiacFortune, buildZodiacOverview } from './zodiacFortune.js';

const querySchema = z.object({
  period: z.enum(FREE_FORTUNE_PERIODS).default('today'),
  date: dateQuery.optional(),
});
/** 별자리 — 행성 궤도 근사가 맞는 범위의 날짜만 받는다 */
const horoscopeQuerySchema = querySchema.extend({
  date: dateQuery
    .refine((s) => {
      const y = parseDate(s).year;
      return y >= ASTRO_MIN_YEAR && y <= ASTRO_MAX_YEAR;
    }, `별자리 운세는 ${ASTRO_MIN_YEAR}~${ASTRO_MAX_YEAR}년 날짜만 볼 수 있어요.`)
    .optional(),
});

/** 캐시 시간(초) 상한 — 같은 날 같은 응답이라 짧게 캐시해도 된다 */
const CACHE_SECONDS = 600;
/** KST 다음 자정까지 남은 초 */
export const secondsToKstMidnight = (nowMs = Date.now()) => {
  const day = 86_400_000;
  const kst = nowMs + 9 * 3_600_000;
  return Math.max(1, Math.ceil((day - (kst % day)) / 1000));
};
/**
 * 캐시 헤더를 붙여 응답 — date 를 주면 내용이 정해져 있으니 10분, date 없이 '오늘'로 계산했으면 KST 자정까지 남은 시간과 10분 중 짧은 쪽
 * (자정 직후 캐시에서 전날 결과가 나오지 않게)
 */
const cached = (c: Ctx, body: unknown, datedRequest: boolean) => {
  c.header('cache-control', `public, max-age=${datedRequest ? CACHE_SECONDS : Math.min(CACHE_SECONDS, secondsToKstMidnight())}`);
  return c.json(body);
};

export function zodiacRoutes(_kit: RouteKit) {
  const app = new Hono<AppEnv>();
  const read = (c: Ctx, schema: typeof querySchema | typeof horoscopeQuerySchema = querySchema) => {
    const q = parse(schema, c.req.query());
    return { period: q.period, base: q.date ? parseDate(q.date) : todayInSeoul(), dated: Boolean(q.date) };
  };

  app.get('/zodiac', (c) => {
    const { period, base, dated } = read(c);
    return cached(c, buildZodiacOverview(period, base), dated);
  });

  app.get('/zodiac/:animal', (c) => {
    const { animal: slug } = parse(z.object({ animal: z.string() }), c.req.param());
    const animal = zodiacAnimalBySlug(slug);
    if (!animal) throw notFound('없는 띠예요. rat, ox, tiger … pig 중에서 골라 주세요.');
    const { period, base, dated } = read(c);
    return cached(c, buildZodiacFortune(animal, period, base), dated);
  });

  app.get('/horoscope', (c) => {
    const { period, base, dated } = read(c, horoscopeQuerySchema);
    return cached(c, buildHoroscopeOverview(period, base), dated);
  });

  app.get('/horoscope/:sign', (c) => {
    const { sign: slug } = parse(z.object({ sign: z.string() }), c.req.param());
    const sign = starSignBySlug(slug);
    if (!sign) throw notFound('없는 별자리예요. aries, taurus … pisces 중에서 골라 주세요.');
    const { period, base, dated } = read(c, horoscopeQuerySchema);
    return cached(c, buildHoroscope(sign, period, base), dated);
  });

  return app;
}
