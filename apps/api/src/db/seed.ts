import { eq } from 'drizzle-orm';
import { CATALOG } from '../modules/commerce/catalog.js';
import { seedCatalog } from '../modules/commerce/service.js';
import type { Db } from './client.js';
import { appMeta } from './schema.js';

/** 상품 카탈로그 upsert (멱등) */
export async function seedProducts(db: Db) {
  await seedCatalog(db);
}

/** 카탈로그 지문 — 판매가·상품 구성이 바뀌면 달라진다(FNV-1a) */
export function catalogHash(): string {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify(CATALOG)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/**
 * Worker 가 처음 요청을 받을 때 — 저장된 카탈로그 지문이 지금 코드와 다를 때만 다시 넣는다
 * (인스턴스가 뜰 때마다 상품 행을 다시 쓰지 않게. 배포로 카탈로그가 바뀌면 첫 요청에서 반영)
 */
export async function ensureCatalog(db: Db) {
  const hash = catalogHash();
  const [saved] = await db.select({ value: appMeta.value }).from(appMeta).where(eq(appMeta.key, 'catalog_hash'));
  if (saved?.value === hash) return;
  await seedCatalog(db);
  await db.insert(appMeta).values({ key: 'catalog_hash', value: hash }).onConflictDoUpdate({ target: appMeta.key, set: { value: hash } });
}
