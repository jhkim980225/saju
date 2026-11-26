import { Hono } from 'hono';
import { TojeongYearError } from '@saju/core';
import { tojeongDefaultYear, tojeongRequestSchema, type TojeongDto } from '@saju/shared';
import { badRequest, unauthorized } from '../../lib/errors.js';
import { readJson, type AppEnv, type RouteKit } from '../../lib/http.js';
import { parse } from '../../lib/validate.js';
import { profileToBirth } from '../profiles/service.js';
import { tojeongFor } from './reading.js';

export function tojeongRoutes({ ctx, optionalAuth }: RouteKit) {
  const { profiles } = ctx.services;
  const app = new Hono<AppEnv>();

  /**
   * 토정비결 (무료) — 비회원은 birth(음력/양력 생년월일), 로그인·게스트 세션은 저장한 profileId 로 본다.
   * 대상 연도 기본값은 tojeongDefaultYear()(KST 10월부터 다음 해). 연도 때문에 볼 수 없으면 details.field='year' 인 400 —
   * 화면이 생년월일 오류와 구분해 기억해 둔 생년월일을 지우지 않게 한다.
   */
  app.post('/', optionalAuth, async (c) => {
    const body = parse(tojeongRequestSchema, await readJson(c));
    const year = body.year ?? tojeongDefaultYear();
    const user = c.get('user');
    let dto: TojeongDto;
    try {
      if (body.profileId) {
        if (!user) throw unauthorized();
        const p = await profiles.getOwned(user.id, body.profileId);
        dto = tojeongFor(profileToBirth(p), year, p.id);
      } else {
        dto = tojeongFor(body.birth!, year);
      }
    } catch (e) {
      if (e instanceof TojeongYearError) throw badRequest(e.message, { field: 'year', defaultYear: tojeongDefaultYear() });
      throw e;
    }
    return c.json(dto);
  });

  return app;
}
