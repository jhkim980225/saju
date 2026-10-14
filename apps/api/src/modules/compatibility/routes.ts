import type { FastifyPluginAsync } from 'fastify';
import { calculateCompatibility, calculateSaju, type SajuChart } from '@saju/core';
import { compatibilityRequestSchema, type CompatibilityDto } from '@saju/shared';
import { unauthorized } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { buildCompatibilitySections } from '../interpretation/reading.js';
import { birthDtoToInput } from '../profiles/service.js';

export const compatibilityRoutes: FastifyPluginAsync = async (app) => {
  const { profiles, reports } = app.ctx.services;

  /** 궁합 — 점수·요약은 무료, 상세는 구매 시 공개 */
  app.post('/', { preHandler: app.optionalAuth }, async (req): Promise<CompatibilityDto> => {
    const body = parse(compatibilityRequestSchema, req.body);
    const side = (profileId: string | undefined, birth: typeof body.birthA, name: string | undefined, fallback: string): { chart: SajuChart; name: string; id: string | null } => {
      if (profileId) {
        if (!req.user) throw unauthorized();
        const p = profiles.getOwned(req.user.id, profileId);
        return { chart: profiles.chartOf(p), name: p.name, id: p.id };
      }
      return { chart: calculateSaju(birthDtoToInput(birth!)), name: name ?? fallback, id: null };
    };
    const a = side(body.profileIdA, body.birthA, body.nameA, '나');
    const b = side(body.profileIdB, body.birthB, body.nameB, '상대');
    const result = calculateCompatibility(a.chart, b.chart);
    const unlocked = Boolean(req.user && a.id && b.id && reports.compatUnlocked(req.user.id, a.id, b.id));
    const built = buildCompatibilitySections(a.chart, b.chart, result, { a: a.name, b: b.name }, unlocked);
    const pack = (x: typeof a) => ({ name: x.name, dayPillar: x.chart.pillars.day.ganzhi.hanja, zodiac: x.chart.zodiac.animal, chart: x.chart });
    // 잠겨 있으면 근거(factors)는 무료 요약에 쓰인 긍정 요인 2개까지만 — 유료 섹션 본문과 같은 내용이 새지 않게
    const visible = unlocked ? result : { ...result, factors: result.factors.filter((f) => f.tone === 'positive').slice(0, 2) };
    return { a: pack(a), b: pack(b), result: visible, gradeLabel: built.gradeLabel, headline: built.headline, sections: built.sections, locked: !unlocked };
  });
};
