/** 단독 실행: npm run db:seed — 마이그레이션 후 상품 카탈로그 upsert */
import { loadConfig } from '../config/env.js';
import { createDb, runMigrations } from './client.js';
import { seedProducts } from './seed.js';

const config = loadConfig();
const { db, sqlite } = createDb(config.DATABASE_PATH);
runMigrations(db);
seedProducts(db);
sqlite.close();
console.log('✔ 상품 카탈로그 시드 완료');
