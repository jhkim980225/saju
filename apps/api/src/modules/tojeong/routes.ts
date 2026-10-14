import type { FastifyPluginAsync } from 'fastify';
import { TOJEONG_DEFAULT_YEAR, tojeongRequestSchema, type TojeongDto } from '@saju/shared';
import { unauthorized } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { profileToBirth } from '../profiles/service.js';
import { tojeongFor } from './reading.js';

export const tojeongRoutes: FastifyPluginAsync = async (app) => {
  const { profiles } = app.ctx.services;

  /**
   * 토정비결 (무료) — 비회원은 birth(음력/양력 생년월일), 로그인·게스트 세션은 저장한 profileId 로 본다.
   * 대상 연도 기본값 2027(丁未).
   */
  app.post('/', { preHandler: app.optionalAuth }, async (req): Promise<TojeongDto> => {
    const body = parse(tojeongRequestSchema, req.body);
    const year = body.year ?? TOJEONG_DEFAULT_YEAR;
    if (body.profileId) {
      if (!req.user) throw unauthorized();
      const p = profiles.getOwned(req.user.id, body.profileId);
      return tojeongFor(profileToBirth(p), year, p.id);
    }
    return tojeongFor(body.birth!, year);
  });
};
