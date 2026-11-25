/**
 * 토스 인앱 결제 상품 연결 — 우리 상품 ID ↔ 토스 콘솔이 발급한 SKU, 그리고 토스 판매가.
 *
 * SKU 는 콘솔에서 상품을 등록하면 나온다 → 서버 환경 변수 TOSS_IAP_SKUS(`상품ID=SKU` 콤마 구분)에 넣는다.
 * 연결하지 않은 상품은 토스 상점에 보이지 않는다(그로블의 GROBLE_PRODUCT_LINKS 와 같은 방식).
 *
 * 토스 판매가: 콘솔에는 공급가(10원 단위)를 넣고 판매가는 자동 계산된다. 여기서는
 * "판매가 = 공급가 × 1.1" 이라고 가정하고, 공급가를 100원 단위로 맞춘 값을 쓴다(990·9,900원은 그대로).
 * 이 금액은 주문 기록용이다 — 토스의 주문 상태 조회 API 는 금액을 돌려주지 않는다.
 * 콘솔에서 실제로 정한 판매가가 다르면 TOSS_PRICE_OVERRIDES 를 고친다.
 */
export function parseTossSkus(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of (raw ?? '').split(',')) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    const productId = pair.slice(0, i).trim();
    const sku = pair.slice(i + 1).trim();
    if (productId && sku) map.set(productId, sku);
  }
  return map;
}

/** 콘솔 판매가를 계산값과 다르게 정했을 때만 적는다: { 상품 ID: 판매가 } */
export const TOSS_PRICE_OVERRIDES: Record<string, number> = {};

/** 웹 판매가 → 토스 판매가(가정: 공급가 100원 단위, 판매가 = 공급가 × 1.1) */
export function tossPriceFor(productId: string, webPrice: number): number {
  const fixed = TOSS_PRICE_OVERRIDES[productId];
  if (fixed !== undefined) return fixed;
  const supply = Math.round(webPrice / 1.1 / 100) * 100;
  return Math.round(supply * 1.1);
}
