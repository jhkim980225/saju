import type { FastifyPluginAsync } from 'fastify';
import type { PublicConfigDto } from '@saju/shared';

/** 서버 주도 설정 — 앱 업데이트 없이 결제수단·광고·기능 플래그를 바꿀 수 있다 */
export const configRoutes: FastifyPluginAsync = async (app) => {
  app.get('/config', async (): Promise<PublicConfigDto> => {
    const c = app.ctx.config;
    return {
      appName: c.APP_NAME,
      paymentProvider: c.PAYMENT_PROVIDER,
      tossClientKey: c.TOSS_CLIENT_KEY ?? null,
      portone: { storeId: c.PORTONE_STORE_ID ?? null, channelKey: c.PORTONE_CHANNEL_KEY ?? null },
      socialLogin: { kakao: c.features.kakao, naver: c.features.naver, google: c.features.google, apple: c.features.apple },
      ai: { enabled: c.features.ai },
      ads: { enabled: c.ADS_ENABLED && c.ADS_PROVIDER !== 'none', provider: c.ADS_PROVIDER },
      features: {
        chat: true,
        compatibility: true,
        yearly: true,
        manse: true,
        push: c.features.push,
        iapApple: c.features.appleIap || (c.PAYMENT_PROVIDER === 'mock' && !c.isProd),
        iapGoogle: c.features.googleIap || (c.PAYMENT_PROVIDER === 'mock' && !c.isProd),
      },
      notices: [],
    };
  });
};
