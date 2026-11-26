/**
 * 토스 빌드 — native/index.ts(Capacitor 진입점)를 대신한다. Capacitor 플러그인 코드가 토스 번들에 들어가지 않게 한다.
 * 토스의 결제·광고는 src/toss/purchases.ts · ads.ts 가 맡으므로 여기 함수는 모두 "하지 않음"을 돌려준다.
 */
export interface StorePurchase {
  platform: 'ios' | 'android';
  productId: string;
  receipt: string;
}

export function appWebOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : '';
}

export function initNative(): Promise<void> {
  return Promise.resolve();
}

export async function finishPurchase(_receipt: string): Promise<boolean> {
  return false;
}

export async function recoverUnfinishedPurchases(_verify: (p: StorePurchase) => Promise<unknown>): Promise<{ recovered: number; failed: number }> {
  return { recovered: 0, failed: 0 };
}

export async function showRewardedAd(_opts?: { ssvCustomData?: string; dailyLimit?: number }): Promise<boolean> {
  return false;
}

export async function rewardedAdsRemaining(_dailyLimit?: number): Promise<number> {
  return 0;
}

export async function showBannerAd(_opts?: { margin?: number }): Promise<boolean> {
  return false;
}

export async function hideBannerAd(): Promise<void> {}

export async function removeBannerAd(): Promise<void> {}

export function onBannerSizeChanged(_cb: (height: number) => void): () => void {
  return () => undefined;
}

/** 토스 첫 버전에는 PDF 저장이 없다 — 인쇄 버튼은 스타일(.toss-hide)로 숨기고, 눌려도 아무 일도 하지 않는다 */
export async function printCurrentPage(_name: string): Promise<boolean> {
  return true;
}
