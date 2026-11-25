import type { PaymentResultDto, ProductDto } from '@saju/shared';
import type { RouteObject } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { storage } from '@/lib/storage';

vi.mock('../api', () => ({
  tossApi: {
    iapProducts: vi.fn(),
    iapIntent: vi.fn(),
    iapVerify: vi.fn(),
    rewardStart: vi.fn(),
    rewardClaim: vi.fn(),
  },
}));

import { tossApi } from '../api';
import type { IapLike } from '../iap';
import { recoverTossPurchases, resetTossRecoverForTest, tossCheckout, TOSS_ACCOUNT_REQUIRED } from '../purchases';
import { TOSS_EXCLUDED_PATHS, tossRoutes } from '../routes';
import { ensureTossSession, requireTossAccount, resetTossAuthForTest, signInWithToss } from '../session';

const api = vi.mocked(tossApi);
const tokens = (provider: string) => ({ accessToken: `${provider}-access`, refreshToken: `${provider}-refresh`, expiresIn: 3600, user: { id: `${provider}-1`, provider, nickname: '달이' } });
const okResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const product = { id: 'report_saju_lifetime', requiresProfile: true } as ProductDto;
const result = { order: { id: 'o1' }, granted: { credits: 0, entitlements: ['report:lifetime'], premiumUntil: null }, creditsBalance: 0 } as unknown as PaymentResultDto;

beforeEach(() => {
  vi.clearAllMocks();
  storage.remove('yd.tossPendingIntents');
  useSession.getState().clear();
  resetTossAuthForTest();
  resetTossRecoverForTest();
});

describe('토스 세션', () => {
  it('인증 코드를 서버에 보내 토스 계정으로 들어온다', async () => {
    const fetchMock = vi.fn(async () => okResponse(tokens('toss')));
    const ok = await signInWithToss({ authCode: async () => ({ code: 'c1' }), fetch: fetchMock as unknown as typeof fetch });
    expect(ok).toBe(true);
    expect(useSession.getState().user?.provider).toBe('toss');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/auth\/toss$/);
    expect(JSON.parse(init.body as string)).toEqual({ code: 'c1' });
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('게스트 토큰이 있으면 함께 보내서 게스트 계정을 토스 계정으로 바꾼다', async () => {
    useSession.getState().setTokens(tokens('guest') as never);
    const fetchMock = vi.fn(async () => okResponse(tokens('toss')));
    await signInWithToss({ authCode: async () => ({ code: 'c1' }), fetch: fetchMock as unknown as typeof fetch });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer guest-access');
    expect(useSession.getState().user?.provider).toBe('toss');
  });

  it('지원하지 않는 토스앱이면 게스트 세션을 만들고, 화면마다 다시 시도하지 않는다', async () => {
    const authCode = vi.fn(async () => {
      throw new Error('unsupported');
    });
    const startGuest = vi.fn(async () => useSession.getState().setTokens(tokens('guest') as never));
    const deps = { authCode, fetch: vi.fn() as unknown as typeof fetch };
    await ensureTossSession(startGuest, deps);
    expect(startGuest).toHaveBeenCalledTimes(1);
    expect(useSession.getState().user?.provider).toBe('guest');
    await ensureTossSession(startGuest, deps);
    expect(authCode).toHaveBeenCalledTimes(1);
    expect(startGuest).toHaveBeenCalledTimes(1);
  });

  it('서버에 토스 연동이 없으면(501) 게스트로 무료 기능만 연다', async () => {
    const startGuest = vi.fn(async () => useSession.getState().setTokens(tokens('guest') as never));
    const fetchMock = vi.fn(async () => new Response('{"error":{"code":"NOT_CONFIGURED"}}', { status: 501 }));
    await ensureTossSession(startGuest, { authCode: async () => ({ code: 'c1' }), fetch: fetchMock as unknown as typeof fetch });
    expect(useSession.getState().user?.provider).toBe('guest');
  });

  it('이미 토스 계정이면 아무것도 부르지 않는다', async () => {
    useSession.getState().setTokens(tokens('toss') as never);
    const authCode = vi.fn();
    await ensureTossSession(vi.fn(), { authCode, fetch: vi.fn() as unknown as typeof fetch });
    expect(authCode).not.toHaveBeenCalled();
  });

  it('결제할 때는 앞서 실패했어도 한 번 더 시도한다', async () => {
    const failing = { authCode: vi.fn(async () => undefined), fetch: vi.fn() as unknown as typeof fetch };
    await ensureTossSession(async () => useSession.getState().setTokens(tokens('guest') as never), failing);
    const ok = await requireTossAccount({ authCode: async () => ({ code: 'c2' }), fetch: (async () => okResponse(tokens('toss'))) as unknown as typeof fetch });
    expect(ok).toBe(true);
  });
});

/** 가짜 인앱 결제 — createOneTimePurchaseOrder 가 불리면 주어진 시나리오대로 콜백을 부른다 */
function fakeIap(scenario: (p: Parameters<IapLike['createOneTimePurchaseOrder']>[0]) => Promise<void> | void, pending: { orderId: string; sku: string }[] = []) {
  const completeProductGrant = vi.fn(async () => true);
  const iap: IapLike = {
    getProductItemList: async () => ({ products: [] }) as never,
    createOneTimePurchaseOrder: (p) => {
      void scenario(p);
      return () => undefined;
    },
    getPendingOrders: async () => ({ orders: pending }) as never,
    completeProductGrant,
  };
  return { iap, completeProductGrant };
}
const deps = (iap: IapLike | null, account = true) => ({ iap, requireAccount: async () => account });

describe('토스 인앱 결제', () => {
  beforeEach(() => {
    api.iapIntent.mockResolvedValue({ intentId: 'i1', productId: product.id, sku: 'sku1', amount: 9900 });
  });

  it('주문 의도 등록 → 결제 → 서버 검증이 끝나야 성공으로 본다', async () => {
    api.iapVerify.mockResolvedValue(result);
    const { iap } = fakeIap(async (p) => {
      const granted = await p.options.processProductGrant({ orderId: 'toss-order-1' } as never);
      expect(granted).toBe(true);
      p.onEvent({ type: 'success', data: {} } as never);
    });
    await expect(tossCheckout({ product, profileId: 'p1' }, deps(iap))).resolves.toBe(result);
    expect(api.iapIntent).toHaveBeenCalledWith({ productId: product.id, profileId: 'p1', partnerProfileId: undefined, readingId: undefined });
    expect(api.iapVerify).toHaveBeenCalledWith({ platform: 'toss', orderId: 'toss-order-1', intentId: 'i1' });
    expect(storage.getJSON('yd.tossPendingIntents')).toEqual({});
  });

  it('서버 검증에 실패하면 지급하지 않았다고 알리고(false), 대상 정보를 복구용으로 남긴다', async () => {
    api.iapVerify.mockRejectedValue(new ApiError(0, 'NETWORK', '인터넷 연결이 불안정해요'));
    let grantReturn: boolean | undefined;
    const { iap } = fakeIap(async (p) => {
      grantReturn = await p.options.processProductGrant({ orderId: 'toss-order-2' } as never);
      p.onError({ code: 'PRODUCT_NOT_GRANTED_BY_PARTNER' });
    });
    await expect(tossCheckout({ product, profileId: 'p1' }, deps(iap))).rejects.toThrow(/앱을 다시 열/);
    expect(grantReturn).toBe(false);
    expect(storage.getJSON('yd.tossPendingIntents')).toEqual({ sku1: 'i1' });
  });

  it('사용자가 취소하면 취소했다고 알린다', async () => {
    const { iap } = fakeIap((p) => p.onError({ code: 'USER_CANCELED' }));
    await expect(tossCheckout({ product, profileId: 'p1' }, deps(iap))).rejects.toThrow('결제를 취소했어요.');
    expect(api.iapVerify).not.toHaveBeenCalled();
  });

  it('계정당 1회 상품을 이미 샀으면 결제창을 띄우지 않는다', async () => {
    api.iapIntent.mockRejectedValue(new ApiError(409, 'CONFLICT', '이미 구매했어요'));
    const create = vi.fn();
    const { iap } = fakeIap(create);
    await expect(tossCheckout({ product, profileId: 'p1' }, deps(iap))).rejects.toThrow('이미 구매한 상품이에요.');
    expect(create).not.toHaveBeenCalled();
  });

  it('인앱 결제를 쓸 수 없거나 토스 계정이 없으면 결제하지 않는다', async () => {
    await expect(tossCheckout({ product }, deps(null))).rejects.toThrow(TOSS_ACCOUNT_REQUIRED);
    const { iap } = fakeIap(vi.fn());
    await expect(tossCheckout({ product }, deps(iap, false))).rejects.toThrow(TOSS_ACCOUNT_REQUIRED);
    expect(api.iapIntent).not.toHaveBeenCalled();
  });

  it('미지급 주문을 다시 검증하고, 성공한 주문만 완료 처리한다', async () => {
    storage.setJSON('yd.tossPendingIntents', { sku1: 'i1' });
    api.iapVerify.mockImplementation(async (body) => {
      if (body.orderId === 'bad') throw new ApiError(402, 'PAYMENT_FAILED', '진행 중', { code: 'IN_PROGRESS' });
      return result;
    });
    const { iap, completeProductGrant } = fakeIap(vi.fn(), [
      { orderId: 'good', sku: 'sku1' },
      { orderId: 'bad', sku: 'sku2' },
    ]);
    await expect(recoverTossPurchases(iap, 1_000_000)).resolves.toBe(1);
    expect(api.iapVerify).toHaveBeenCalledWith({ platform: 'toss', orderId: 'good', intentId: 'i1' });
    expect(completeProductGrant).toHaveBeenCalledTimes(1);
    expect(completeProductGrant).toHaveBeenCalledWith({ params: { orderId: 'good' } });
    // 30초 안에 다시 부르면 건너뛴다
    await expect(recoverTossPurchases(iap, 1_010_000)).resolves.toBe(0);
  });
});

describe('토스 라우트', () => {
  const page = (path: string): RouteObject => ({ path, element: null });
  const table: RouteObject[] = [
    {
      element: null,
      children: [
        page('/'),
        page('/input'),
        page('/login'),
        page('/signup'),
        page('/payments/success'),
        page('/tarot/draw'),
        page('/dream'),
        page('/dream/ask'),
        page('/dream/:slug'),
        page('/reports/:id'),
        { element: null, children: [page('/today'), page('/saju'), page('/ask'), page('/tarot'), page('/my')] },
        page('*'),
      ],
    },
  ];
  const paths = (routes: RouteObject[]): string[] => routes.flatMap((r) => [...(r.path ? [r.path] : []), ...(r.children ? paths(r.children) : [])]);

  it('제외한 화면의 경로가 남지 않는다', () => {
    const out = paths(tossRoutes(table));
    for (const p of out) expect(TOSS_EXCLUDED_PATHS.has(p), p).toBe(false);
    expect(out).toEqual(['/', '/input', '/dream', '/dream/:slug', '/reports/:id', '/today', '/saju', '/my', '*']);
  });

  it('원본 라우트 표는 바꾸지 않는다', () => {
    tossRoutes(table);
    expect(paths(table)).toContain('/login');
  });
});
