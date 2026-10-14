import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createDb, runMigrations } from './db/client.js';
import { seedProducts } from './db/seed.js';
import { scheduleDailyPush } from './jobs/dailyPush.js';

const config = loadConfig();
const { db, sqlite } = createDb(config.DATABASE_PATH);
runMigrations(db);
seedProducts(db);

const app = await buildApp({ config, db });
const missing = Object.entries(config.features).filter(([, on]) => !on).map(([k]) => k);
app.log.info(`결제: ${config.PAYMENT_PROVIDER} · AI: ${config.features.ai ? `상담·리포트 ${config.ANTHROPIC_MODEL} · 타로 ${config.ANTHROPIC_MODEL_PREMIUM}` : '미설정(규칙 기반)'} · 미설정 연동: ${missing.join(', ') || '없음'}`);

// 매일 08:00 KST 오늘의 운세 푸시 (FCM 키 + DAILY_PUSH_ENABLED=true 일 때)
const stopDailyPush = config.features.push && config.DAILY_PUSH_ENABLED ? scheduleDailyPush(app.ctx.services, app.log) : () => undefined;

const shutdown = async () => {
  stopDailyPush();
  await app.close();
  sqlite.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
