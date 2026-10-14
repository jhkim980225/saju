/**
 * 네이티브(Capacitor) 진입점. 웹 브라우저에서는 아무 것도 하지 않는다.
 *
 * 이 파일은 main.tsx 가 정적으로 import 하므로 Capacitor 플러그인을 정적으로 import 하지 않는다.
 * 실제 구현(bootstrap/purchases/ads)은 앱에서만 동적 import 되어 별도 청크로 분리된다.
 *
 * 연결 지점(팀장):
 *  - IAP 후처리  : lib/payments startCheckout 의 api.verifyIap 성공 직후 `await finishPurchase(purchased.receipt)`
 *  - IAP 복구    : 로그인 세션이 있을 때 앱 시작·복귀 시 `recoverUnfinishedPurchases(p => api.verifyIap({ ...p, profileId }))`
 *  - 보상형 광고 : AI 질문권 소진 시 "광고 보고 1회 추가" → `if (await showRewardedAd()) …서버 지급(SSV)`
 *  - 배너        : 무료 결과 화면 진입/이탈 시 showBannerAd / removeBannerAd
 *  - 소셜 로그인 : 앱에서는 redirectUri 를 `${appWebOrigin()}/auth/callback/{provider}` 로, 인증 URL 은 native.openExternal 로 연다
 */
import { isNativeApp } from '../lib/platform';
import type { StorePurchase } from './purchases';

export { appWebOrigin } from './env';
export type { StorePurchase } from './purchases';

let started: Promise<void> | null = null;

/** 앱 시작 시 1회 (main.tsx 가 렌더 전에 await). 저장소 hydrate·상태바·뒤로가기·딥링크·푸시·IAP 를 연결한다 */
export function initNative(): Promise<void> {
  if (!isNativeApp()) return Promise.resolve();
  started ??= import('./bootstrap')
    .then((m) => m.bootstrapNative())
    .catch((e: unknown) => console.error('[native] 초기화 실패', e));
  return started;
}

// ── 인앱결제 ─────────────────────────────────────────────────

/**
 * 서버 검증(api.verifyIap) 성공 후 반드시 호출 — iOS finishTransaction / Android consumePurchase.
 * Google Play 는 3일 안에 확인하지 않으면 자동 환불되고, iOS 는 미완료 거래가 큐에 남는다.
 * 검증 실패 시에는 호출하지 말 것(다음 recoverUnfinishedPurchases 에서 재시도).
 *
 * 연결 예 (lib/payments/index.ts):
 *   const purchased = await native.purchase(storeId);
 *   if (!purchased) throw new Error('결제를 취소했어요.');
 *   const result = await api.verifyIap({ platform, productId: storeId, receipt: purchased.receipt, profileId: input.profileId });
 *   await finishPurchase(purchased.receipt);
 *   return result;
 */
export async function finishPurchase(receipt: string): Promise<boolean> {
  if (!isNativeApp()) return false;
  return (await import('./purchases')).finishPurchase(receipt);
}

/** 끊긴 결제(검증 전 앱 종료·네트워크 오류·Ask to Buy 승인 등) 복구. verify 성공 시 finish 까지 처리 */
export async function recoverUnfinishedPurchases(verify: (p: StorePurchase) => Promise<unknown>): Promise<{ recovered: number; failed: number }> {
  if (!isNativeApp()) return { recovered: 0, failed: 0 };
  return (await import('./purchases')).recoverUnfinishedPurchases(verify);
}

// ── 광고 (AdMob) ─────────────────────────────────────────────

/** 보상형 광고 — 보상을 받았으면 true. 웹에서는 항상 false. 하루 3회 한도 */
export async function showRewardedAd(opts?: { ssvCustomData?: string }): Promise<boolean> {
  if (!isNativeApp()) return false;
  return (await import('./ads')).showRewardedAd(opts);
}

/** 오늘 남은 보상형 광고 횟수 (웹은 0) */
export async function rewardedAdsRemaining(): Promise<number> {
  if (!isNativeApp()) return 0;
  return (await import('./ads')).rewardedAdsRemaining();
}

/** 결과 화면 하단 적응형 배너 (네이티브 오버레이). margin = 하단 탭바 높이 */
export async function showBannerAd(opts?: { margin?: number }): Promise<boolean> {
  if (!isNativeApp()) return false;
  return (await import('./ads')).showBannerAd(opts);
}

export async function hideBannerAd(): Promise<void> {
  if (!isNativeApp()) return;
  await (await import('./ads')).hideBannerAd();
}

export async function removeBannerAd(): Promise<void> {
  if (!isNativeApp()) return;
  await (await import('./ads')).removeBannerAd();
}

/** 배너 높이 변화 구독 — 본문 하단 여백 보정용. 반환 함수로 해제 */
export function onBannerSizeChanged(cb: (height: number) => void): () => void {
  if (!isNativeApp()) return () => undefined;
  let off: (() => void) | null = null;
  let cancelled = false;
  void import('./ads').then((m) => {
    if (!cancelled) off = m.onBannerSizeChanged(cb);
  });
  return () => {
    cancelled = true;
    off?.();
  };
}

// ── 인쇄(PDF 저장) ───────────────────────────────────────────

/**
 * 지금 화면을 시스템 인쇄 화면으로 연다(Android 'PDF로 저장' / iOS 공유 → '파일에 저장'). 인쇄 화면이 닫히면 끝난다.
 * 웹에서는 false — 호출부가 window.print() 를 쓴다.
 */
export async function printCurrentPage(name: string): Promise<boolean> {
  if (!isNativeApp()) return false;
  await (await import('./print')).printWebView(name);
  return true;
}
