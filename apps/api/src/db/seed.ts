import type { Db } from './client.js';
import { seedCatalog } from '../modules/commerce/service.js';

/** 상품 카탈로그 upsert (멱등) */
export function seedProducts(db: Db) {
  seedCatalog(db);
}
