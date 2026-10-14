import { loadConfig } from '../config/env.js';
import { createDb, runMigrations } from './client.js';
import { seedProducts } from './seed.js';

const config = loadConfig();
const { db, sqlite } = createDb(config.DATABASE_PATH);
runMigrations(db);
seedProducts(db);
sqlite.close();
console.log(`✔ 마이그레이션 + 상품 시드 완료 (${config.DATABASE_PATH})`);
