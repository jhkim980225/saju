/**
 * 서비스 조립(간단한 DI). 라우트는 app.ctx.services 로 접근한다.
 */
import type { AppConfig } from './config/env.js';
import type { Db } from './db/client.js';
import { createAiService } from './modules/ai/service.js';
import { createAuthService } from './modules/auth/service.js';
import { createOAuthService } from './modules/auth/oauth.js';
import { createChatService } from './modules/chat/service.js';
import { createGateways } from './modules/commerce/providers/index.js';
import { createCommerceService } from './modules/commerce/service.js';
import { createProfileService } from './modules/profiles/service.js';
import { createPushService } from './modules/push/service.js';
import { createReportService } from './modules/reports/service.js';
import { createRewardsService } from './modules/rewards/service.js';
import { createTarotService } from './modules/tarot/service.js';
import { createUserService } from './modules/users/service.js';

export function createServices(config: AppConfig, db: Db) {
  const users = createUserService(config, db);
  const auth = createAuthService(config, db, users);
  const oauth = createOAuthService(config);
  const profiles = createProfileService(db);
  const gateways = createGateways(config);
  const commerce = createCommerceService(config, db, gateways);
  const ai = createAiService(config);
  const reports = createReportService(db, profiles, commerce, ai);
  const chat = createChatService(config, db, profiles, commerce, ai, reports.access);
  const push = createPushService(config, db);
  const rewards = createRewardsService(config, db, commerce);
  const tarot = createTarotService(config, db, profiles, commerce, ai);
  commerce.setReadingCheck(tarot.assertPurchasable);
  return { users, auth, oauth, profiles, gateways, commerce, ai, reports, chat, push, rewards, tarot };
}

export type Services = ReturnType<typeof createServices>;
