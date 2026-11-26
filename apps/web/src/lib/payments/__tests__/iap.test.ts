/**
 * 앱 인앱결제 — 결제 전 확인(checkIap), 결제마다 남기는 복구 대상 기록, 서버 거절 시 거래 마무리(details.finish).
 * 네이티브 계층과 API 는 vi.mock 으로 바꾼다.
 */
import type { PaymentResultDto, ProductDto } from '@saju/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api';
import { storage } from '../../storage';
import { recoverInAppPurchases, startCheckout } from '..';
import { IAP_TARGETS_KEY, attachIapReceipt, findIapTarget, rememberIapTarget } from '../iapTargets';

const m = vi.hoisted(() => ({
  checkIap: vi.fn(),
  verifyIap: vi.fn(),
  purchase: vi.fn(),
  finishPurchase: vi.fn(async (_receipt: string) => true),
  pending: [] as { platform: 'ios' | 'android'; productId: string; receipt: string }[],
  platform: 'ios' as 'ios' | 'android',
}));
vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>();
  return { ...actual, api: { ...actual.api, checkIap: m.checkIap, verifyIap: m.verifyIap } };
});
vi.mock('../../platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../platform')>();
  return { ...actual, IS_TOSS: false, isNativeApp: () => true, nativePlatform: () => m.platform, native: { ...actual.native, purchase: m.purchase } };
});
vi.mock('../../../native', () => ({
  finishPurchase: m.finishPurchase,
  // native/purchases.ts 의 복구 루프와 같은 모양: 검증 성공이면 finish, 실패면 실패로 센다
  recoverUnfinishedPurchases: async (verify: (p: (typeof m.pending)[number]) => Promise<unknown>) => {
    let recovered = 0;
    let failed = 0;
    for (const p of m.pending) {
      try {
        await verify(p);
        await m.finishPurchase(p.receipt);
        recovered++;
      } catch {
        failed++;
      }
    }
    return { recovered, failed };
  },
}));

const product = { id: 'report_saju_lifetime', name: '평생 사주분석서', price: 9900, iosProductId: 'com.daldalsaju.report.lifetime', androidProductId: 'report_saju_lifetime' } as ProductDto;
const result = { order: { id: 'o1', status: 'paid' }, granted: { credits: 3, entitlements: [], premiumUntil: null }, creditsBalance: 3 } as unknown as PaymentResultDto;
const reject = (reason: string, finish: boolean) => new ApiError(409, 'CONFLICT', '이미 구매한 콘텐츠예요.', { reason, finish });

beforeEach(() => {
  m.platform = 'ios';
  m.pending = [];
  m.checkIap.mockReset().mockResolvedValue({ ok: true });
  m.verifyIap.mockReset().mockResolvedValue(result);
  m.purchase.mockReset();
  m.finishPurchase.mockClear();
  storage.remove(IAP_TARGETS_KEY);
});
afterEach(() => storage.remove(IAP_TARGETS_KEY));

describe('startCheckout — 앱 인앱결제', () => {
  it('결제창을 띄우기 전에 서버에 확인하고, 거절되면 스토어 결제를 시작하지 않는다', async () => {
    m.checkIap.mockRejectedValue(reject('ALREADY_OWNED', true));
    await expect(startCheckout({ product, profileId: 'p1', returnTo: '/my' })).rejects.toThrow('이미 구매한 콘텐츠예요');
    expect(m.purchase).not.toHaveBeenCalled();
    expect(storage.getJSON(IAP_TARGETS_KEY)).toBeNull();
  });

  it('검증에 성공하면 거래를 끝내고 복구 기록을 지운다', async () => {
    m.purchase.mockResolvedValue({ receipt: 'tx-1' });
    await expect(startCheckout({ product, profileId: 'p1', returnTo: '/my' })).resolves.toBe(result);
    expect(m.checkIap).toHaveBeenCalledWith({ platform: 'ios', productId: product.iosProductId, profileId: 'p1', readingId: undefined });
    expect(m.finishPurchase).toHaveBeenCalledWith('tx-1');
    expect(storage.getJSON(IAP_TARGETS_KEY)).toBeNull();
  });

  it('서버가 지급을 거절하며 finish=true 면(iOS) 지급 없이 거래를 끝낸다', async () => {
    m.purchase.mockResolvedValue({ receipt: 'tx-2' });
    m.verifyIap.mockRejectedValue(reject('PER_USER_LIMIT', true));
    await expect(startCheckout({ product, profileId: 'p1', returnTo: '/my' })).rejects.toBeInstanceOf(ApiError);
    expect(m.finishPurchase).toHaveBeenCalledWith('tx-2');
    expect(storage.getJSON(IAP_TARGETS_KEY)).toBeNull();
  });

  it('finish=false 면(Android) 거래를 그대로 둔다 — Google 이 3일 안에 자동 환불한다', async () => {
    m.platform = 'android';
    m.purchase.mockResolvedValue({ receipt: 'tok-3' });
    m.verifyIap.mockRejectedValue(reject('ALREADY_OWNED', false));
    await expect(startCheckout({ product, profileId: 'p1', returnTo: '/my' })).rejects.toBeInstanceOf(ApiError);
    expect(m.finishPurchase).not.toHaveBeenCalled();
  });

  it('네트워크 오류처럼 거절이 아닌 실패는 거래와 복구 기록을 남긴다(다음 실행 때 복구)', async () => {
    m.purchase.mockResolvedValue({ receipt: 'tx-4' });
    m.verifyIap.mockRejectedValue(new Error('네트워크 오류'));
    await expect(startCheckout({ product, profileId: 'p1', returnTo: '/my' })).rejects.toThrow('네트워크 오류');
    expect(m.finishPurchase).not.toHaveBeenCalled();
    expect(findIapTarget(product.iosProductId!, 'tx-4')).toMatchObject({ profileId: 'p1', receipt: 'tx-4' });
  });
});

describe('끊긴 결제 복구 대상', () => {
  it('같은 상품을 다른 프로필로 연달아 사다 끊겨도 거래마다 자기 대상으로 복구한다', async () => {
    const storeId = product.iosProductId!;
    attachIapReceipt(rememberIapTarget(storeId, { profileId: 'p-a' }), 'tx-a');
    attachIapReceipt(rememberIapTarget(storeId, { profileId: 'p-b' }), 'tx-b');
    m.pending = [
      { platform: 'ios', productId: storeId, receipt: 'tx-a' },
      { platform: 'ios', productId: storeId, receipt: 'tx-b' },
    ];
    expect(await recoverInAppPurchases()).toBe(2);
    expect(m.verifyIap.mock.calls.map(([b]) => [b.receipt, b.profileId])).toEqual([
      ['tx-a', 'p-a'],
      ['tx-b', 'p-b'],
    ]);
    expect(storage.getJSON(IAP_TARGETS_KEY)).toBeNull();
  });

  it('영수증을 받기 전에 꺼졌으면 같은 상품의 가장 최근 기록을 쓰고, 기록이 없으면 대상 없이 보낸다', async () => {
    const storeId = product.iosProductId!;
    rememberIapTarget(storeId, { profileId: 'p-old' });
    await new Promise((r) => setTimeout(r, 2));
    rememberIapTarget(storeId, { profileId: 'p-new' });
    m.pending = [
      { platform: 'ios', productId: storeId, receipt: 'tx-x' },
      { platform: 'ios', productId: 'com.daldalsaju.chat.10', receipt: 'tx-chat' },
    ];
    await recoverInAppPurchases();
    expect(m.verifyIap.mock.calls[0]![0]).toMatchObject({ receipt: 'tx-x', profileId: 'p-new' });
    expect(m.verifyIap.mock.calls[1]![0]).toMatchObject({ receipt: 'tx-chat', profileId: undefined });
  });

  it('복구 중 서버가 finish=true 로 거절한 거래는 끝내고 다시 시도하지 않게 한다', async () => {
    m.pending = [{ platform: 'ios', productId: product.iosProductId!, receipt: 'tx-r' }];
    m.verifyIap.mockRejectedValue(reject('ALREADY_OWNED', true));
    expect(await recoverInAppPurchases()).toBe(0);
    expect(m.finishPurchase).toHaveBeenCalledWith('tx-r');
  });
});
