import { Hono } from 'hono';
import { tossRewardClaimSchema, tossRewardStartSchema } from '@saju/shared';
import { readJson, requireUser, type AppEnv, type RouteKit } from '../../lib/http.js';
import { parse } from '../../lib/validate.js';

export function rewardRoutes({ ctx, authenticate }: RouteKit) {
  const { rewards, tossRewards } = ctx.services;
  const app = new Hono<AppEnv>();

  /** AdMob 서버 측 확인 콜백 (GET, Google 이 호출). 200 이외 응답이면 AdMob 이 재시도한다 */
  app.get('/admob-ssv', async (c) => {
    // 서명은 받은 쿼리 문자열 원문 그대로 검증해야 한다
    const result = await rewards.handleAdmobSsv(new URL(c.req.url).search.slice(1));
    console.info('[rewards] AdMob 보상 콜백', result);
    return c.json({ ok: true, ...result });
  });

  /** 오늘 남은 광고 보상 횟수 (앱 UI 용) */
  app.get('/status', authenticate, async (c) => {
    const used = await rewards.todayCount(requireUser(c).id);
    const limit = ctx.config.REWARDED_AD_DAILY_LIMIT;
    return c.json({ used, limit, remaining: Math.max(0, limit - used), creditsPerReward: ctx.config.REWARDED_AD_CREDITS });
  });

  /** 토스 미니앱 보상형 광고 — 광고를 띄우기 직전에 일회용 토큰을 받는다 */
  app.post('/toss/start', authenticate, async (c) => c.json(await tossRewards.start(requireUser(c).id, parse(tossRewardStartSchema, await readJson(c)))));

  /** 토스 미니앱 보상형 광고 — 끝까지 본 뒤 토큰으로 지급을 요청한다 */
  app.post('/toss/claim', authenticate, async (c) => {
    const body = parse(tossRewardClaimSchema, await readJson(c));
    return c.json(await tossRewards.claim(requireUser(c).id, body.token));
  });

  return app;
}
