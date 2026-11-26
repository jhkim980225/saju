/**
 * 토스 인앱 결제 — lib/payments 의 startCheckout / recoverInAppPurchases 가 토스 빌드에서 부른다.
 *
 * 흐름(docs/API.md 토스 미니앱 절의 주문 의도·검증):
 *  1) 결제 전 주문 의도 등록(POST /payments/iap/toss/orders) — 살 수 없는 경우(계정당 1회, 대상 프로필 누락)를 결제 전에 막는다.
 *  2) IAP.createOneTimePurchaseOrder — processProductGrant 안에서 서버 검증(POST /payments/iap/verify)을 부르고,
 *     서버가 200 을 줄 때만 true 를 돌려준다(30초 제한). true 가 아니면 토스가 주문을 '미지급'으로 남긴다.
 *  3) 미지급 주문은 앱 시작·복귀 때 getPendingOrders 로 찾아 다시 검증하고 completeProductGrant 로 끝낸다.
 */
import type { PaymentResultDto, ProductDto } from '@saju/shared';
import { ApiError } from '@/lib/api';
import { storage } from '@/lib/storage';
import { tossApi } from './api';
import { createSdkIap, type IapLike } from './iap';
import { requireTossAccount } from './session';

const PENDING_INTENTS_KEY = 'yd.tossPendingIntents';
type PendingIntents = Record<string, string>; // SKU → 우리 주문 ID(intentId)

const readIntents = (): PendingIntents => storage.getJSON<PendingIntents>(PENDING_INTENTS_KEY) ?? {};
const rememberIntent = (sku: string, intentId: string) => storage.setJSON(PENDING_INTENTS_KEY, { ...readIntents(), [sku]: intentId });
const forgetIntent = (sku: string) => {
  const { [sku]: _done, ...rest } = readIntents();
  storage.setJSON(PENDING_INTENTS_KEY, rest);
};

export const TOSS_ACCOUNT_REQUIRED = '토스 앱 최신 버전에서 구매할 수 있어요.';
export const TOSS_IAP_UNAVAILABLE = '지금은 이 상품을 살 수 없어요. 잠시 뒤 다시 시도해 주세요.';

function errorCode(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; errorCode?: unknown; message?: unknown };
    if (typeof e.code === 'string') return e.code;
    if (typeof e.errorCode === 'string') return e.errorCode;
    if (typeof e.message === 'string') return e.message;
  }
  return 'UNKNOWN';
}

/** 결제 오류 코드 → 사용자 안내 */
export function purchaseErrorMessage(code: string): string {
  switch (code) {
    case 'USER_CANCELED':
      return '결제를 취소했어요.';
    case 'PAYMENT_PENDING':
      return '결제 승인을 기다리고 있어요. 승인되면 앱을 다시 열 때 리포트가 열려요.';
    case 'NETWORK_ERROR':
      return '인터넷 연결을 확인하고 다시 시도해 주세요.';
    case 'KOREAN_ACCOUNT_ONLY':
      return '한국 앱마켓 계정에서만 살 수 있어요.';
    case 'PRODUCT_NOT_GRANTED_BY_PARTNER':
      return '결제는 됐는데 리포트를 아직 열지 못했어요. 앱을 다시 열면 자동으로 열려요.';
    case 'TOSS_SERVER_VERIFICATION_FAILED':
      return '결제 정보를 확인하고 있어요. 잠시 뒤 앱을 다시 열면 리포트가 열려요.';
    case 'APP_MARKET_VERIFICATION_FAILED':
      return '앱마켓에서 결제를 확인하지 못했어요. 결제됐다면 앱마켓에 환불을 요청해 주세요.';
    case 'INVALID_PRODUCT_ID':
      return TOSS_IAP_UNAVAILABLE;
    case 'INVALID_USER_ENVIRONMENT':
    case 'UNSUPPORTED_APP_VERSION':
    case 'UNSUPPORTED_OS_VERSION':
      return TOSS_ACCOUNT_REQUIRED;
    default:
      return '결제를 마치지 못했어요. 결제됐다면 앱을 다시 열 때 리포트가 열려요.';
  }
}

/** 서버 검증 실패 → 사용자 안내 */
function verifyErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const reason = (e.details as { reason?: string; code?: string } | undefined)?.reason;
    if (e.status === 409 && reason === 'OTHER_ACCOUNT') return '다른 계정에서 이미 쓴 결제예요.';
    if (e.status === 409 && reason === 'PER_USER_LIMIT') return '이미 구매한 상품이에요.';
    if (e.status === 0) return '인터넷 연결을 확인해 주세요. 결제됐다면 앱을 다시 열 때 리포트가 열려요.';
  }
  return '결제는 됐는데 리포트를 아직 열지 못했어요. 앱을 다시 열면 자동으로 열려요.';
}

export interface TossCheckoutInput {
  product: ProductDto;
  profileId?: string;
  partnerProfileId?: string;
  readingId?: string;
}

export type TossPurchaseDeps = { iap: IapLike | null; requireAccount: () => Promise<boolean> };
const defaultDeps = (): TossPurchaseDeps => ({ iap: createSdkIap(), requireAccount: () => requireTossAccount() });

/** 결제하고 서버가 지급을 확인한 결과를 돌려준다. 실패하면 사용자에게 보여 줄 문구로 Error 를 던진다 */
export async function tossCheckout(input: TossCheckoutInput, deps: TossPurchaseDeps = defaultDeps()): Promise<PaymentResultDto> {
  const { iap } = deps;
  if (!iap) throw new Error(TOSS_ACCOUNT_REQUIRED);
  if (!(await deps.requireAccount())) throw new Error(TOSS_ACCOUNT_REQUIRED);

  let intent;
  try {
    intent = await tossApi.iapIntent({ productId: input.product.id, profileId: input.profileId, partnerProfileId: input.partnerProfileId, readingId: input.readingId });
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) throw new Error('이미 구매한 상품이에요.');
    if (e instanceof ApiError && e.status === 501) throw new Error(TOSS_IAP_UNAVAILABLE);
    throw e;
  }
  rememberIntent(intent.sku, intent.intentId);

  return new Promise<PaymentResultDto>((resolve, reject) => {
    let granted: PaymentResultDto | null = null;
    let verifyError: unknown = null;
    let settled = false;
    let cleanup: (() => void) | undefined;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      try {
        cleanup?.();
      } catch {
        /* noop */
      }
      fn();
    };
    try {
      cleanup = iap.createOneTimePurchaseOrder({
        options: {
          sku: intent.sku,
          processProductGrant: async ({ orderId }) => {
            try {
              granted = await tossApi.iapVerify({ platform: 'toss', orderId, intentId: intent.intentId });
              forgetIntent(intent.sku);
              return true;
            } catch (e) {
              verifyError = e;
              return false; // 미지급으로 남는다 — 다음 복구 때 다시 검증한다
            }
          },
        },
        onEvent: (event) => {
          if (event.type !== 'success') return;
          settle(() => (granted ? resolve(granted) : reject(new Error(verifyErrorMessage(verifyError)))));
        },
        onError: (err) => {
          settle(() => reject(new Error(verifyError ? verifyErrorMessage(verifyError) : purchaseErrorMessage(errorCode(err)))));
        },
      });
    } catch (err) {
      settle(() => reject(new Error(purchaseErrorMessage(errorCode(err)))));
    }
  });
}

let lastRecoverAt = -Infinity;

/**
 * 결제는 됐지만 지급이 끝나지 않은 주문을 다시 검증해 지급하고 완료 처리한다. 앱 시작·복귀 때 부른다.
 * 반환: 이번에 지급을 확인한 주문 수. 30초 안에 다시 부르면 건너뛴다.
 */
export async function recoverTossPurchases(iap: IapLike | null = createSdkIap(), now = Date.now()): Promise<number> {
  if (!iap?.getPendingOrders) return 0;
  if (now - lastRecoverAt < 30_000) return 0;
  lastRecoverAt = now;
  let orders: { orderId: string; sku: string }[] = [];
  try {
    orders = ((await iap.getPendingOrders())?.orders ?? []) as { orderId: string; sku: string }[];
  } catch {
    return 0;
  }
  let recovered = 0;
  for (const o of orders) {
    if (!o?.orderId) continue;
    try {
      await tossApi.iapVerify({ platform: 'toss', orderId: o.orderId, intentId: readIntents()[o.sku] });
    } catch {
      continue; // 진행 중·대상 없음·다른 계정 등 — 완료 처리하지 않고 남겨 둔다
    }
    recovered++;
    forgetIntent(o.sku);
    try {
      await iap.completeProductGrant?.({ params: { orderId: o.orderId } });
    } catch {
      /* 완료 처리에 실패해도 서버 지급은 멱등이라 다음 복구 때 다시 끝낸다 */
    }
  }
  return recovered;
}

/** 테스트용 */
export function resetTossRecoverForTest() {
  lastRecoverAt = -Infinity;
}
