import { Hono } from 'hono';
import { requireUser, type AppEnv, type RouteKit } from '../../lib/http.js';

export function rewardRoutes({ ctx, authenticate }: RouteKit) {
  const { rewards } = ctx.services;
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

  return app;
}
