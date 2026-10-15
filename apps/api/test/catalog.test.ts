/**
 * 상품 카탈로그 시드 — 카탈로그에서 뺀 상품(예: 플러스 구독·질문권 100회)은 지우지 않고 판매 중지한다.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, runMigrations } from '../src/db/client.js';
import { products } from '../src/db/schema.js';
import { seedProducts } from '../src/db/seed.js';
import { CATALOG } from '../src/modules/commerce/catalog.js';

describe('seedProducts', () => {
  it('카탈로그에 없는 기존 상품은 active=false, 카탈로그 상품은 active=true', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    db.insert(products).values({ id: 'sub_plus_monthly', name: '플러스 월 구독', description: '', type: 'subscription', price: 6900, active: true, sortOrder: 99 }).run();
    seedProducts(db);
    expect(db.select().from(products).where(eq(products.id, 'sub_plus_monthly')).get()?.active).toBe(false);
    const active = db.select().from(products).where(eq(products.active, true)).all().map((p) => p.id).sort();
    expect(active).toEqual(CATALOG.map((c) => c.id).sort());
    expect(CATALOG.some((c) => c.type === 'subscription')).toBe(false);
  });
});
