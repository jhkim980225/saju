/**
 * 토스 상점의 상품 목록 — hooks/queries 의 useProducts 가 토스 빌드에서 부른다.
 *  - 서버 상품(GET /products)에 토스 SKU 연결(GET /payments/iap/toss/products)과 토스 SDK 의 가격을 합친다.
 *  - SKU 가 연결되지 않았거나 인앱 결제를 쓸 수 없는 환경이면 '준비 중'으로 보여 주고 구매 버튼을 막는다.
 *  - 화면 가격은 콘솔에 등록한 가격(SDK displayAmount)을 쓴다(앱인토스: 주문 금액과 결제창 금액이 같아야 한다).
 *  - 토스 첫 버전에 없는 기능의 상품(질문권 팩·타로)은 목록에서 뺀다.
 */
import type { ProductDto } from '@saju/shared';
import { api } from '@/lib/api';
import { tossApi } from './api';
import { createSdkIap, type IapLike } from './iap';

/** 토스 첫 버전에서 팔지 않는 상품 */
export function isTossExcludedProduct(p: ProductDto): boolean {
  // 묶음 상품은 질문권(AI 상담)을 함께 주는 구성이라 첫 버전에서 뺀다
  return p.type === 'credit_pack' || p.id.startsWith('tarot_') || p.id.startsWith('chat_') || p.id.startsWith('bundle_');
}

/** 토스 첫 버전에 없는 기능(PDF 저장·질문권)을 말하는 문장을 상품 설명에서 뺀다 */
export function tossDescription(text: string): string {
  const kept = text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/PDF|질문권|AI 상담/.test(sentence));
  return kept.length > 0 ? kept.join(' ') : text;
}

/** "9,900원" → 9900. 숫자를 읽지 못하면 null */
export function parseDisplayAmount(text: string | undefined): number | null {
  if (!text) return null;
  const n = Number(text.replace(/[^0-9]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type TossSkuMap = Record<string, { sku: string; amount: number }>;

/** 상품 ID → SKU. 결제할 때 다시 조회하지 않도록 기억해 둔다 */
let skuMap: TossSkuMap = {};
export const tossSkuOf = (productId: string): string | undefined => skuMap[productId]?.sku;

export function mergeTossProducts(base: ProductDto[], links: TossSkuMap, sdkPrices: Record<string, number>, iapReady: boolean): ProductDto[] {
  return base
    .filter((p) => !isTossExcludedProduct(p))
    .map((p) => ({ ...p, description: tossDescription(p.description) }))
    .map((p) => {
      const link = links[p.id];
      if (!iapReady || !link) return { ...p, purchasable: false, comingSoon: true, listPrice: null, saleEndsAt: null, badge: null };
      // 정가 대비 할인 표시는 콘솔 가격과 어긋날 수 있어 토스에서는 보여 주지 않는다
      return { ...p, price: sdkPrices[link.sku] ?? link.amount, listPrice: null, saleEndsAt: null };
    });
}

export async function tossProducts(iap: IapLike | null = createSdkIap()): Promise<ProductDto[]> {
  const base = await api.products();
  let links: TossSkuMap = {};
  const sdkPrices: Record<string, number> = {};
  // 서버가 토스 인앱 결제를 켰는지 먼저 본다(GET /config 의 features.tossIap) — 꺼져 있으면 모두 '준비 중'
  const enabled = iap ? await api.config().then((c) => c.features.tossIap === true, () => false) : false;
  if (iap && enabled) {
    try {
      links = Object.fromEntries((await tossApi.iapProducts()).map((l) => [l.productId, { sku: l.sku, amount: l.amount }]));
    } catch {
      links = {}; // 서버에 토스 연동이 없으면(501) 모두 '준비 중'
    }
    try {
      for (const item of (await iap.getProductItemList())?.products ?? []) {
        const price = parseDisplayAmount(item.displayAmount);
        if (price) sdkPrices[item.sku] = price;
      }
    } catch {
      /* 가격을 못 받으면 서버가 아는 토스 판매가를 쓴다 */
    }
  }
  skuMap = links;
  return mergeTossProducts(base, links, sdkPrices, iap !== null && enabled);
}
