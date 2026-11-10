import { Hono } from 'hono';
import { TOJEONG_DEFAULT_YEAR, tojeongRequestSchema, type TojeongDto } from '@saju/shared';
import { unauthorized } from '../../lib/errors.js';
import { readJson, type AppEnv, type RouteKit } from '../../lib/http.js';
import { parse } from '../../lib/validate.js';
import { profileToBirth } from '../profiles/service.js';
import { tojeongFor } from './reading.js';

export function tojeongRoutes({ ctx, optionalAuth }: RouteKit) {
  const { profiles } = ctx.services;
  const app = new Hono<AppEnv>();

  /**
   * 토정비결 (무료) — 비회원은 birth(음력/양력 생년월일), 로그인·게스트 세션은 저장한 profileId 로 본다.
   * 대상 연도 기본값 2027(丁未).
   */
  app.post('/', optionalAuth, async (c) => {
    const body = parse(tojeongRequestSchema, await readJson(c));
    const year = body.year ?? TOJEONG_DEFAULT_YEAR;
    const user = c.get('user');
    let dto: TojeongDto;
    if (body.profileId) {
      if (!user) throw unauthorized();
      const p = await profiles.getOwned(user.id, body.profileId);
      dto = tojeongFor(profileToBirth(p), year, p.id);
    } else {
      dto = tojeongFor(body.birth!, year);
    }
    return c.json(dto);
  });

  return app;
}
