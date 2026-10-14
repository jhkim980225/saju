import type { FastifyPluginAsync } from 'fastify';
import { requireUser } from '../../app.js';

export const rewardRoutes: FastifyPluginAsync = async (app) => {
  const { rewards } = app.ctx.services;

  /** AdMob 서버 측 확인 콜백 (GET, Google 이 호출). 200 이외 응답이면 AdMob 이 재시도한다 */
  app.get('/admob-ssv', async (req) => {
    const raw = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '';
    const result = await rewards.handleAdmobSsv(raw);
    req.log.info({ result }, 'AdMob 보상 콜백');
    return { ok: true, ...result };
  });

  /** 오늘 남은 광고 보상 횟수 (앱 UI 용) */
  app.get('/status', { preHandler: app.authenticate }, async (req) => {
    const used = rewards.todayCount(requireUser(req).id);
    const limit = app.ctx.config.REWARDED_AD_DAILY_LIMIT;
    return { used, limit, remaining: Math.max(0, limit - used), creditsPerReward: app.ctx.config.REWARDED_AD_CREDITS };
  });
};
