import { Hono } from 'hono';
import type { PublicConfigDto } from '@saju/shared';
import type { AppEnv, RouteKit } from '../../lib/http.js';

/** 서버 주도 설정 — 앱 업데이트 없이 결제수단·광고·기능 플래그를 바꿀 수 있다 */
export function configRoutes({ ctx }: RouteKit) {
  const app = new Hono<AppEnv>();
  app.get('/config', (c) => {
    const cfg = ctx.config;
    const dto: PublicConfigDto = {
      appName: cfg.APP_NAME,
      paymentProvider: cfg.PAYMENT_PROVIDER,
      tossClientKey: cfg.TOSS_CLIENT_KEY ?? null,
      portone: { storeId: cfg.PORTONE_STORE_ID ?? null, channelKey: cfg.PORTONE_CHANNEL_KEY ?? null },
      socialLogin: { kakao: cfg.features.kakao, naver: cfg.features.naver, google: cfg.features.google, apple: cfg.features.apple },
      ai: { enabled: cfg.features.ai },
      ads: { enabled: cfg.ADS_ENABLED && cfg.ADS_PROVIDER !== 'none', provider: cfg.ADS_PROVIDER },
      features: {
        chat: true,
        compatibility: true,
        yearly: true,
        manse: true,
        push: cfg.features.push,
        iapApple: cfg.features.appleIap || (cfg.PAYMENT_PROVIDER === 'mock' && !cfg.isProd),
        iapGoogle: cfg.features.googleIap || (cfg.PAYMENT_PROVIDER === 'mock' && !cfg.isProd),
        /** 비밀번호 재설정 메일(Resend) — false 면 웹이 문의 안내로 대체 */
        mail: cfg.features.mail,
      },
      supportEmail: cfg.SUPPORT_EMAIL ?? null,
      notices: [],
    };
    return c.json(dto);
  });
  return app;
}
