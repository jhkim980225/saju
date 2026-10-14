/**
 * 서비스 조립(간단한 DI). 라우트는 app.ctx.services 로 접근한다.
 */
import type { AppConfig } from './config/env.js';
import type { Db } from './db/client.js';
import { createAiService } from './modules/ai/service.js';
import { createAuthService } from './modules/auth/service.js';
import { createOAuthService } from './modules/auth/oauth.js';
import { createChatService } from './modules/chat/service.js';
import { createGateways, type GatewayDeps } from './modules/commerce/providers/index.js';
import { createCommerceService } from './modules/commerce/service.js';
import { createProfileService } from './modules/profiles/service.js';
import { createPushService } from './modules/push/service.js';
import { createReportService } from './modules/reports/service.js';
import { createRewardsService } from './modules/rewards/service.js';
import { createTarotService } from './modules/tarot/service.js';
import { createUserService } from './modules/users/service.js';
import { createTaekilService } from './modules/taekil/service.js';

/** 테스트용 외부 의존성 주입 (생략 시 실제 값) */
export interface ServiceDeps {
  gateways?: GatewayDeps;
}

export function createServices(config: AppConfig, db: Db, deps: ServiceDeps = {}) {
  const users = createUserService(config, db);
  const auth = createAuthService(config, db, users);
  const oauth = createOAuthService(config);
  const profiles = createProfileService(db);
  const gateways = createGateways(config, deps.gateways);
  const commerce = createCommerceService(config, db, gateways);
  const ai = createAiService(config);
  const reports = createReportService(db, profiles, commerce, ai);
  const chat = createChatService(config, db, profiles, commerce, ai, reports.access);
  const push = createPushService(config, db);
  const rewards = createRewardsService(config, db, commerce);
  const tarot = createTarotService(config, db, profiles, commerce, ai);
  commerce.setReadingCheck(tarot.assertPurchasable);
  const taekil = createTaekilService(db, profiles, commerce, ai);
  commerce.setGrantReadingCheck('taekil:reading', taekil.assertPurchasable);
  // 결제가 확정되면 산 리포트를 바로 만들기 시작한다(처음 열 때 기다리지 않게)
  commerce.setFulfilledListener((e) => reports.prewarm(e));
  return { users, auth, oauth, profiles, gateways, commerce, ai, reports, chat, push, rewards, tarot, taekil };
}

export type Services = ReturnType<typeof createServices>;
