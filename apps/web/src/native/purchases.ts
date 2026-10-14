/**
 * 인앱결제(IAP) — @capgo/native-purchases (StoreKit 2 / Google Play Billing 7+).
 *
 * 흐름 (모든 상품은 소모성 consumable — docs/research/03 §5.2 "앱 IAP 유형 매핑"):
 *   1) purchaseConsumable(storeProductId) → 스토어 결제창 → receipt 반환 (아직 finish/consume 하지 않음)
 *        iOS     receipt = StoreKit 2 transactionId (서버가 App Store Server API 로 조회)
 *        Android receipt = purchaseToken           (서버가 Play Developer API 로 조회)
 *   2) lib/payments 가 api.verifyIap(...) 로 서버 검증·지급
 *   3) 검증 성공 후 finishPurchase(receipt) — iOS finishTransaction / Android consumePurchase(확인+소모)
 *      ⚠ Android 는 3일 안에 확인(acknowledge)하지 않으면 자동 환불된다.
 *      ⚠ 서버 검증 전에 소모하면, 검증 실패(네트워크 등) 시 복구할 거래가 사라진다 → 반드시 검증 후 호출.
 *   4) 앱 재시작·복귀 시 recoverUnfinishedPurchases(verify) 로 2)~3) 이 끊긴 거래를 복구.
 *
 * 서버 /payments/iap/verify 는 거래 ID 로 멱등이므로 같은 receipt 를 다시 보내도 중복 지급되지 않는다.
 */
import { NativePurchases, PURCHASE_TYPE, type Transaction } from '@capgo/native-purchases';
import { nativePlatform } from '../lib/platform';
import { useSession } from '../lib/session';

export interface StorePurchase {
  platform: 'ios' | 'android';
  /** 스토어 상품 ID (catalog.ts iosProductId / androidProductId) */
  productId: string;
  /** 서버 검증용 영수증 (iOS transactionId / Android purchaseToken) */
  receipt: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 결제 직후 검증 중인 영수증 — 복구 루틴이 같은 거래를 동시에 검증하지 않도록 잠시 건너뛴다 */
const IN_FLIGHT_MS = 5 * 60_000;
const inFlight = new Map<string, number>();

const storePlatform = (): 'ios' | 'android' => (nativePlatform() === 'ios' ? 'ios' : 'android');

function receiptOf(tx: Transaction, platform: 'ios' | 'android'): string | null {
  return (platform === 'ios' ? tx.transactionId : tx.purchaseToken) || null;
}

function errorInfo(e: unknown): { code: string; message: string } {
  const err = (e ?? {}) as { code?: unknown; message?: unknown; errorMessage?: unknown };
  return { code: typeof err.code === 'string' ? err.code : '', message: String(err.message ?? err.errorMessage ?? e ?? '') };
}

/** autoFinishTransactions=false — StoreKit 업데이트 스트림이 서버 검증 전에 거래를 끝내지 않게 한다 (capacitor.config 에도 설정) */
export async function configurePurchases(): Promise<void> {
  await NativePurchases.configure({ autoFinishTransactions: false }).catch((e: unknown) => console.warn('[native] IAP 설정 실패', e));
}

async function findUnfinished(productId: string): Promise<string | null> {
  const platform = storePlatform();
  const { transactions } = await NativePurchases.getUnfinishedTransactions();
  const tx = transactions.find((t) => t.productIdentifier === productId);
  return tx ? receiptOf(tx, platform) : null;
}

/** NativeBridge.purchase — 성공 시 { receipt }, 사용자가 취소하면 null, 그 밖의 실패는 throw */
export async function purchaseConsumable(storeProductId: string): Promise<{ receipt: string } | null> {
  const platform = storePlatform();
  const userId = useSession.getState().user?.id;
  try {
    const tx = await NativePurchases.purchaseProduct({
      productIdentifier: storeProductId,
      productType: PURCHASE_TYPE.INAPP,
      quantity: 1,
      // 서버 검증 전에는 확인·소모하지 않는다 → finishPurchase 에서 처리
      isConsumable: false,
      autoAcknowledgePurchases: false,
      // 스토어 측 사기 탐지·거래-계정 연결용 (iOS 는 UUID 형식만 허용, 서버 사용자 ID 는 UUID)
      ...(userId && UUID_RE.test(userId) ? { appAccountToken: userId } : {}),
    });
    if (platform === 'android' && tx.purchaseState && tx.purchaseState !== '1') {
      throw new Error('결제 승인을 기다리고 있어요. 결제가 완료되면 자동으로 반영돼요.');
    }
    const receipt = receiptOf(tx, platform);
    if (!receipt) throw new Error('스토어 영수증을 받지 못했어요. 잠시 후 다시 시도해 주세요.');
    inFlight.set(receipt, Date.now());
    return { receipt };
  } catch (e) {
    const { code, message } = errorInfo(e);
    if (code === 'USER_CANCELED' || /cancel/i.test(message)) return null;
    if (code === 'ITEM_ALREADY_OWNED') {
      // 이전 결제가 소모되지 않고 남아 있음(검증 도중 앱 종료 등) → 그 영수증으로 검증을 이어 간다
      const receipt = await findUnfinished(storeProductId).catch(() => null);
      if (receipt) {
        inFlight.set(receipt, Date.now());
        return { receipt };
      }
    }
    if (/pending/i.test(message)) throw new Error('결제 승인을 기다리고 있어요. 승인되면 앱을 다시 열어 주세요.');
    if (e instanceof Error && /[가-힣]/.test(e.message)) throw e;
    throw new Error('결제를 진행하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
}

/**
 * 서버 검증(api.verifyIap) 성공 후 호출 — iOS finishTransaction, Android consumePurchase.
 * 실패해도 throw 하지 않는다(지급은 이미 끝났고, 다음 복구 때 다시 시도된다). 성공 여부를 반환.
 */
export async function finishPurchase(receipt: string): Promise<boolean> {
  try {
    if (storePlatform() === 'ios') await NativePurchases.finishTransaction({ transactionId: receipt });
    else await NativePurchases.consumePurchase({ purchaseToken: receipt });
    inFlight.delete(receipt);
    return true;
  } catch (e) {
    console.warn('[native] 거래 마무리(finish/consume) 실패', e);
    return false;
  }
}

/** 끝나지 않은 스토어 거래 (iOS: 미완료 transaction, Android: 미확인 purchase) */
export async function pendingStorePurchases(): Promise<StorePurchase[]> {
  const platform = storePlatform();
  const { transactions } = await NativePurchases.getUnfinishedTransactions();
  const now = Date.now();
  const out: StorePurchase[] = [];
  for (const tx of transactions) {
    const receipt = receiptOf(tx, platform);
    if (!receipt) continue;
    const started = inFlight.get(receipt);
    if (started && now - started < IN_FLIGHT_MS) continue;
    out.push({ platform, productId: tx.productIdentifier, receipt });
  }
  return out;
}

let recovering: Promise<{ recovered: number; failed: number }> | null = null;

/**
 * 끊긴 결제 복구. verify 는 서버 검증 함수(예: p => api.verifyIap({ ...p, profileId })) — 성공 시 resolve, 실패 시 throw.
 * 리포트 상품은 서버가 profileId 를 요구하므로 호출 측에서 활성 프로필 등을 채워 넣는다.
 */
export function recoverUnfinishedPurchases(verify: (p: StorePurchase) => Promise<unknown>): Promise<{ recovered: number; failed: number }> {
  recovering ??= (async () => {
    let recovered = 0;
    let failed = 0;
    for (const p of await pendingStorePurchases()) {
      try {
        await verify(p);
        if (await finishPurchase(p.receipt)) recovered++;
        else failed++;
      } catch (e) {
        failed++;
        console.warn('[native] 미완료 결제 복구 실패', p.productId, e);
      }
    }
    return { recovered, failed };
  })().finally(() => (recovering = null));
  return recovering;
}
