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
import type { CheckoutDto, PaymentResultDto, ProductDto } from '@saju/shared';
import { api } from '../api';
import { isNativeApp, native, nativePlatform } from '../platform';
import { STORAGE_KEYS, storage } from '../storage';
import { finishPurchase, recoverUnfinishedPurchases } from '../../native';
import { openPortOne, openToss } from './providers';

const IAP_PENDING_KEY = 'yd.iapPendingProfiles';
/** 끊긴 결제 복구용 대상 — 프로필 ID 또는 'reading:<타로 리딩 ID>' */
const pendingTarget = (v: string | undefined): { profileId?: string; readingId?: string } =>
  !v ? {} : v.startsWith('reading:') ? { readingId: v.slice('reading:'.length) } : { profileId: v };

/** 끊긴 인앱결제 복구 — 앱 시작·복귀 시(회원 로그인 상태) 호출. 검증 성공 건은 native 계층이 finish 까지 처리한다 */
export async function recoverInAppPurchases(): Promise<number> {
  if (!isNativeApp()) return 0;
  const pending = storage.getJSON<Record<string, string>>(IAP_PENDING_KEY) ?? {};
  const { recovered } = await recoverUnfinishedPurchases((p) =>
    api.verifyIap({ platform: p.platform, productId: p.productId, receipt: p.receipt, ...pendingTarget(pending[p.productId]) }),
  );
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
}

export async function startCheckout(input: { product: ProductDto; profileId?: string; partnerProfileId?: string; readingId?: string; returnTo: string; profileName?: string }): Promise<PaymentResultDto | 'redirected'> {
  // 앱: 스토어 인앱결제 (디지털 콘텐츠는 IAP 필수)
  if (isNativeApp() && native.purchase) {
    const platform = nativePlatform() === 'ios' ? 'ios' : 'android';
    const storeId = platform === 'ios' ? input.product.iosProductId : input.product.androidProductId;
    if (!storeId) throw new Error('이 상품은 앱에서 아직 구매할 수 없어요.');
    // 앱이 검증 전에 종료돼도 복구할 수 있도록 대상 프로필을 기억해 둔다
    const target = input.readingId ? `reading:${input.readingId}` : (input.profileId ?? '');
    storage.setJSON(IAP_PENDING_KEY, { ...(storage.getJSON<Record<string, string>>(IAP_PENDING_KEY) ?? {}), [storeId]: target });
    const purchased = await native.purchase(storeId);
    if (!purchased) throw new Error('결제를 취소했어요.');
    const result = await api.verifyIap({ platform, productId: storeId, receipt: purchased.receipt, profileId: input.profileId, readingId: input.readingId });
    // 서버 검증 성공 후에만 거래 완료(iOS finish / Android consume) — 안 하면 Google Play 가 3일 후 자동 환불
    await finishPurchase(purchased.receipt);
    return result;
  }

  const checkout: CheckoutDto = await api.createOrder({ productId: input.product.id, profileId: input.profileId, partnerProfileId: input.partnerProfileId, readingId: input.readingId });
  const pending: PendingCheckout = { orderId: checkout.order.id, productId: input.product.id, amount: checkout.order.amount, provider: checkout.provider, returnTo: input.returnTo, profileName: input.profileName };
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
