/**
 * 결제 클라이언트 — 서버가 내려준 CheckoutDto(provider 별 파라미터)로 결제창을 연다.
 *  - mock   : 개발용. 결제창 없이 successUrl 로 바로 이동
 *  - toss   : 토스페이먼츠 결제위젯/결제창 (VITE_TOSS_CLIENT_KEY 또는 서버 config.tossClientKey)
 *  - portone: 포트원 V2 브라우저 SDK
 *  - groble : 그로블 결제창 링크로 이동(?ref=주문 ID). 승인 API 가 없어 결제는 서버가 웹훅으로 확정하고,
 *             돌아온 /payments/success 페이지는 주문 상태를 조회하며 기다린다
 *  - 앱(IAP): native.purchase → 서버 영수증 검증
 * 결제 승인은 /payments/success 페이지에서 서버 confirm API 로 처리한다(그로블 제외).
 */
import type { CheckoutDto, IapRejectDetails, PaymentResultDto, ProductDto } from '@saju/shared';
import { ApiError, api } from '../api';
import { IS_TOSS, isNativeApp, native, nativePlatform } from '../platform';
import { STORAGE_KEYS, storage } from '../storage';
import { finishPurchase, recoverUnfinishedPurchases } from '../../native';
import { attachIapReceipt, findIapTarget, forgetIapTarget, rememberIapTarget } from './iapTargets';
import { openPortOne, openToss } from './providers';

/** 예전 형식(스토어 상품 ID → 대상)의 복구 기록 — 같은 상품을 연달아 사면 덮어써져서 iapTargets 로 바꿨다. 남아 있으면 지운다 */
const LEGACY_IAP_PENDING_KEY = 'yd.iapPendingProfiles';

/**
 * 서버가 지급을 거절한 인앱결제의 스토어 거래 마무리 — 거절 응답의 details.finish 가 true 면 지급 없이 거래를 끝낸다
 * (iOS 는 끝내지 않은 소모성 거래가 저절로 환불되지 않고 앱을 열 때마다 다시 검증된다. Android 는 그대로 두면 3일 안에 자동 환불된다).
 * 이 거래의 대상 기록도 지운다. 거래를 끝냈으면 true
 */
async function closeRejectedPurchase(e: unknown, receipt: string): Promise<boolean> {
  if (!(e instanceof ApiError)) return false;
  const details = e.details as Partial<IapRejectDetails> | undefined;
  if (!details?.reason) return false;
  forgetIapTarget({ receipt });
  if (details.finish !== true) return false;
  await finishPurchase(receipt);
  return true;
}

/** 끊긴 인앱결제 복구 — 앱 시작·복귀 시(회원 로그인 상태) 호출. 검증 성공 건은 native 계층이 finish 까지 처리한다 */
export async function recoverInAppPurchases(): Promise<number> {
  if (IS_TOSS) return (await import('@/toss/purchases')).recoverTossPurchases();
  if (!isNativeApp()) return 0;
  storage.remove(LEGACY_IAP_PENDING_KEY);
  const used = new Set<string>();
  const { recovered } = await recoverUnfinishedPurchases(async (p) => {
    // 대상 기록을 잃었으면 대상 없이 보낸다 — 서버가 이미 처리한 거래는 그대로 마무리하고, 리포트 상품은 대표 프로필로 채운다
    const target = findIapTarget(p.productId, p.receipt, used);
    if (target) used.add(target.id);
    try {
      const result = await api.verifyIap({ platform: p.platform, productId: p.productId, receipt: p.receipt, profileId: target?.profileId, readingId: target?.readingId });
      forgetIapTarget({ id: target?.id, receipt: p.receipt });
      return result;
    } catch (e) {
      await closeRejectedPurchase(e, p.receipt);
      throw e;
    }
  });
  return recovered;
}

export interface PendingCheckout {
  orderId: string;
  productId: string;
  amount: number;
  provider: CheckoutDto['provider'];
  /** 결제 후 돌아갈 경로(읽던 위치 유지) */
  returnTo: string;
  profileName?: string;
  /** 같은 주문으로 결제창을 다시 열 때 서버에 보낼 대상(진행 중인 결제 이어서 하기) */
  resume?: { productId: string; profileId?: string; partnerProfileId?: string; readingId?: string };
}

/** 진행 중인 결제 화면 주소 — 서버가 같은 상품의 결제가 진행 중이라고 알려 준 경우 */
export const RESUME_CHECKOUT_PATH = '/payments/success?resume=1';

export async function startCheckout(input: { product: ProductDto; profileId?: string; partnerProfileId?: string; readingId?: string; returnTo: string; profileName?: string }): Promise<PaymentResultDto | 'redirected'> {
  // 토스 미니앱: 토스 인앱 결제만 쓴다(외부 결제창 이동 금지)
  if (IS_TOSS) return (await import('@/toss/purchases')).tossCheckout(input);
  // 앱: 스토어 인앱결제 (디지털 콘텐츠는 IAP 필수)
  if (isNativeApp() && native.purchase) {
    const platform = nativePlatform() === 'ios' ? 'ios' : 'android';
    const storeId = platform === 'ios' ? input.product.iosProductId : input.product.androidProductId;
    if (!storeId) throw new Error('이 상품은 앱에서 아직 구매할 수 없어요.');
    // 결제 전에 서버에 살 수 있는지 묻는다 — 스토어는 결제 뒤에야 검증하므로 판매 중지·한도 초과·이미 가진 콘텐츠를 여기서 막는다
    await api.checkIap({ platform, productId: storeId, profileId: input.profileId, readingId: input.readingId });
    // 앱이 검증 전에 종료돼도 복구할 수 있도록 이 결제의 대상을 기억해 둔다(결제마다 한 건)
    const targetId = rememberIapTarget(storeId, { profileId: input.profileId, readingId: input.readingId });
    const purchased = await native.purchase(storeId);
    if (!purchased) {
      forgetIapTarget({ id: targetId });
      throw new Error('결제를 취소했어요.');
    }
    attachIapReceipt(targetId, purchased.receipt);
    let result: PaymentResultDto;
    try {
      result = await api.verifyIap({ platform, productId: storeId, receipt: purchased.receipt, profileId: input.profileId, readingId: input.readingId });
    } catch (e) {
      await closeRejectedPurchase(e, purchased.receipt);
      throw e;
    }
    forgetIapTarget({ id: targetId });
    // 서버 검증 성공 후에만 거래 완료(iOS finish / Android consume) — 안 하면 Google Play 가 3일 후 자동 환불
    await finishPurchase(purchased.receipt);
    return result;
  }

  const resume = { productId: input.product.id, profileId: input.profileId, partnerProfileId: input.partnerProfileId, readingId: input.readingId };
  let checkout: CheckoutDto;
  try {
    checkout = await api.createOrder(resume);
  } catch (e) {
    // 같은 상품의 결제를 방금 시작했다(그로블은 같은 주문으로 두 번 결제하는 것을 막지 못한다) — 새로 결제하지 않고
    // 그 주문의 결제 확인 화면으로 보낸다. 결제하지 않았다면 그 화면에서 같은 주문으로 결제창을 다시 연다
    const d = e instanceof ApiError ? (e.details as { reason?: string; orderId?: string; amount?: number } | undefined) : undefined;
    if (e instanceof ApiError && e.status === 409 && d?.reason === 'PAYMENT_IN_PROGRESS' && d.orderId) {
      const pending: PendingCheckout = { orderId: d.orderId, productId: input.product.id, amount: d.amount ?? input.product.price, provider: 'groble', returnTo: input.returnTo, profileName: input.profileName, resume };
      storage.setJSON(STORAGE_KEYS.pendingCheckout, pending);
      window.location.assign(RESUME_CHECKOUT_PATH);
      return 'redirected';
    }
    throw e;
  }
  const pending: PendingCheckout = { orderId: checkout.order.id, productId: input.product.id, amount: checkout.order.amount, provider: checkout.provider, returnTo: input.returnTo, profileName: input.profileName, resume };
  storage.setJSON(STORAGE_KEYS.pendingCheckout, pending);

  const { checkout: c } = checkout;
  switch (checkout.provider) {
    case 'mock': {
      const url = new URL(c.successUrl, window.location.origin);
      url.searchParams.set('orderId', c.orderId);
      url.searchParams.set('amount', String(c.amount));
      url.searchParams.set('paymentKey', `mock_${c.orderId}`);
      url.searchParams.set('provider', 'mock');
      window.location.assign(`${url.pathname}${url.search}`);
      return 'redirected';
    }
    case 'toss':
      await openToss(c);
      return 'redirected';
    case 'portone':
      await openPortOne(c);
      return 'redirected';
    case 'groble':
      if (!c.redirectUrl) throw new Error('이 상품의 결제창이 아직 준비되지 않았어요.');
      // 같은 탭으로 이동 — 결제 후 그로블 결제창 설정의 '이동 페이지'(/payments/success?provider=groble)로 돌아온다
      window.location.assign(c.redirectUrl);
      return 'redirected';
    default:
      throw new Error('지원하지 않는 결제 수단이에요.');
  }
}

export function pendingCheckout(): PendingCheckout | null {
  return storage.getJSON<PendingCheckout>(STORAGE_KEYS.pendingCheckout);
}

export function clearPendingCheckout() {
  storage.remove(STORAGE_KEYS.pendingCheckout);
}
