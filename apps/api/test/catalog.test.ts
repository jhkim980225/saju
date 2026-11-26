/**
 * 상품 카탈로그 시드 — 카탈로그에서 뺀 상품(예: 플러스 구독·질문권 100회)은 지우지 않고 판매 중지한다.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createDb, runMigrations } from '../src/db/local.js';
import { products } from '../src/db/schema.js';
import { seedProducts } from '../src/db/seed.js';
import { CATALOG } from '../src/modules/commerce/catalog.js';
import { currentPrice } from '../src/modules/commerce/service.js';

describe('seedProducts', () => {
  it('카탈로그에 없는 기존 상품은 active=false, 카탈로그 상품은 active=true', async () => {
    const { db } = createDb(':memory:');
    await runMigrations(db);
    await db.insert(products).values({ id: 'sub_plus_monthly', name: '플러스 월 구독', description: '', type: 'subscription', price: 6900, active: true, sortOrder: 99 });
    await seedProducts(db);
    expect((await db.select().from(products).where(eq(products.id, 'sub_plus_monthly')))[0]?.active).toBe(false);
    const active = (await db.select().from(products).where(eq(products.active, true))).map((p) => p.id).sort();
    expect(active).toEqual(CATALOG.map((c) => c.id).sort());
    expect(CATALOG.some((c) => c.type === 'subscription')).toBe(false);
  });

  it('2027 신년운세는 기한 없이 5,900원 — 정가·할인 마감·얼리버드 표시가 없고 해가 바뀌어도 값이 같다', async () => {
    const item = CATALOG.find((c) => c.id === 'report_newyear_2027')!;
    expect(item).toMatchObject({ price: 5900 });
    expect(item.listPrice).toBeUndefined();
    expect(item.saleEndsAt).toBeUndefined();
    expect(item.badge).toBeUndefined();
    // 기한이 지나면 값이 오르는 상품이 없다(그로블 결제창 가격을 날짜에 맞춰 바꿀 일이 없게)
    expect(CATALOG.filter((c) => c.saleEndsAt)).toEqual([]);
    const { db } = createDb(':memory:');
    await runMigrations(db);
    await seedProducts(db);
    const [row] = await db.select().from(products).where(eq(products.id, 'report_newyear_2027'));
    expect(row).toMatchObject({ price: 5900, listPrice: null, saleEndsAt: null, badge: null });
    expect(currentPrice(row!, Date.parse('2027-01-01T00:00:00+09:00'))).toBe(5900);
  });
});
