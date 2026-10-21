import { loadConfig } from '../config/env.js';
import { createDb, runMigrations } from './client.js';
import { seedProducts } from './seed.js';

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL);
await runMigrations(db);
await seedProducts(db);
await close();
console.log('✔ 마이그레이션 + 상품 시드 완료');
