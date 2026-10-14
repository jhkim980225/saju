/**
 * 띠별 운세 · 별자리 운세 — 로그인 없이 보는 공개 콘텐츠(검색 유입용). 개인 정보는 받지 않는다.
 *
 * GET /zodiac?period&date               12띠 한 줄 요약
 * GET /zodiac/:animal?period&date       띠 하나 (rat … pig)
 * GET /horoscope?period&date            12별자리 한 줄 요약
 * GET /horoscope/:sign?period&date      별자리 하나 (aries … pisces)
 */
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { FREE_FORTUNE_PERIODS, starSignBySlug, zodiacAnimalBySlug } from '@saju/shared';
import { notFound } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { dateQuery, parseDate, todayInSeoul } from '../saju/routes.js';
import { buildHoroscope, buildHoroscopeOverview } from './horoscope.js';
import { buildZodiacFortune, buildZodiacOverview } from './zodiacFortune.js';

const querySchema = z.object({
  period: z.enum(FREE_FORTUNE_PERIODS).default('today'),
  date: dateQuery.optional(),
});

/** 같은 날 같은 응답이므로 짧게 캐시해도 된다(날짜를 넘기면 내용이 바뀌므로 10분) */
const cache = (reply: FastifyReply) => reply.header('cache-control', 'public, max-age=600');

export const zodiacRoutes: FastifyPluginAsync = async (app) => {
  const read = (query: unknown) => {
    const q = parse(querySchema, query);
    return { period: q.period, base: q.date ? parseDate(q.date) : todayInSeoul() };
  };

  app.get('/zodiac', async (req, reply) => {
    const { period, base } = read(req.query);
    cache(reply);
    return buildZodiacOverview(period, base);
  });

  app.get('/zodiac/:animal', async (req, reply) => {
    const { animal: slug } = parse(z.object({ animal: z.string() }), req.params);
    const animal = zodiacAnimalBySlug(slug);
    if (!animal) throw notFound('없는 띠예요. rat, ox, tiger … pig 중에서 골라 주세요.');
    const { period, base } = read(req.query);
    cache(reply);
    return buildZodiacFortune(animal, period, base);
  });

  app.get('/horoscope', async (req, reply) => {
    const { period, base } = read(req.query);
    cache(reply);
    return buildHoroscopeOverview(period, base);
  });

  app.get('/horoscope/:sign', async (req, reply) => {
    const { sign: slug } = parse(z.object({ sign: z.string() }), req.params);
    const sign = starSignBySlug(slug);
    if (!sign) throw notFound('없는 별자리예요. aries, taurus … pisces 중에서 골라 주세요.');
    const { period, base } = read(req.query);
    cache(reply);
    return buildHoroscope(sign, period, base);
  });
};
