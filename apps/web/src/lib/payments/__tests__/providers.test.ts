/**
 * PG 결제창 연동 테스트 — SDK 스크립트는 실제로 받지 않고(jsdom 은 외부 리소스를 로드하지 않음)
 * load/error 이벤트를 직접 발생시키며, window.TossPayments / window.PortOne 은 가짜 객체를 주입한다.
 */
import type { CheckoutDto } from '@saju/shared';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

type Providers = typeof import('../providers');
type Checkout = CheckoutDto['checkout'];

const TOSS_SDK = 'https://js.tosspayments.com/v2/standard';
const PORTONE_SDK = 'https://cdn.portone.io/v2/browser-sdk.js';
const ORIGIN = 'http://localhost:5173';

const checkout = (over: Partial<Checkout> = {}): Checkout => ({
  clientKey: 'test_ck_abc',
  customerKey: '6f1c2d3e-0000-4000-8000-000000000001',
  orderId: 'ORD-20261012-ABCDEF123456',
  orderName: '평생 사주분석서',
  amount: 9900,
  successUrl: `${ORIGIN}/payments/success`,
  failUrl: `${ORIGIN}/payments/fail`,
  customerEmail: 'user@example.com',
  customerName: '홍길동',
  storeId: 'store-x',
  channelKey: 'channel-key-x',
  ...over,
});

const w = window as unknown as { TossPayments?: unknown; PortOne?: unknown };
const scripts = (src: string) => Array.from(document.head.querySelectorAll<HTMLScriptElement>(`script[src="${src}"]`));
/** 스크립트 로드 완료를 흉내: 전역을 주입한 뒤 load 이벤트 */
const finishLoad = (src: string, inject: () => void) => {
  inject();
  scripts(src).forEach((s) => s.dispatchEvent(new Event('load')));
};
/** 다음 매크로태스크까지 대기 (loadScript 가 <script> 를 붙일 시간) */
const tick = () => new Promise((r) => setTimeout(r, 0));

let mod: Providers;
let assign: Mock;

beforeEach(async () => {
  vi.resetModules(); // 모듈 내부 스크립트 로드 캐시 초기화
  mod = await import('../providers');
  document.head.querySelectorAll('script').forEach((s) => s.remove());
  delete w.TossPayments;
  delete w.PortOne;
  assign = vi.fn();
  vi.stubGlobal('location', { origin: ORIGIN, href: `${ORIGIN}/products`, assign });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  delete w.TossPayments;
  delete w.PortOne;
});

// ── 토스페이먼츠 ─────────────────────────────────────────────

describe('openToss', () => {
  const fakeToss = () => {
    const requestPayment = vi.fn(() => new Promise<void>(() => {})); // 리다이렉트 방식: 페이지가 이동하므로 resolve 되지 않음
    const payment = vi.fn(() => ({ requestPayment }));
    const TossPayments = vi.fn(() => ({ payment }));
    return { TossPayments, payment, requestPayment };
  };

  it('SDK 스크립트를 1회만 로드하고, 결제창 파라미터를 매핑한다', async () => {
    const fake = fakeToss();
    void mod.openToss(checkout());
    void mod.openToss(checkout()); // 동시 호출도 스크립트는 하나
    await tick();
    expect(scripts(TOSS_SDK)).toHaveLength(1);

    finishLoad(TOSS_SDK, () => (w.TossPayments = fake.TossPayments));
    await tick();
    expect(fake.TossPayments).toHaveBeenCalledWith('test_ck_abc');
    expect(fake.payment).toHaveBeenCalledWith({ customerKey: '6f1c2d3e-0000-4000-8000-000000000001' });
    expect(fake.requestPayment).toHaveBeenCalledTimes(2);
    expect(fake.requestPayment).toHaveBeenCalledWith({
      method: 'CARD',
      amount: { currency: 'KRW', value: 9900 },
      orderId: 'ORD-20261012-ABCDEF123456',
      orderName: '평생 사주분석서',
      successUrl: `${ORIGIN}/payments/success`,
      failUrl: `${ORIGIN}/payments/fail`,
      customerEmail: 'user@example.com',
      customerName: '홍길동',
      card: { flowMode: 'DEFAULT', useEscrow: false, useCardPoint: false, useAppCardOnly: false },
    });

    // 로드 후 재호출은 스크립트를 다시 붙이지 않는다
    void mod.openToss(checkout());
    await tick();
    expect(scripts(TOSS_SDK)).toHaveLength(1);
    expect(fake.requestPayment).toHaveBeenCalledTimes(3);
  });

  it('고객 정보가 없으면 해당 필드를 보내지 않는다', async () => {
    const fake = fakeToss();
    w.TossPayments = fake.TossPayments; // 이미 로드된 상태
    void mod.openToss(checkout({ customerEmail: undefined, customerName: undefined }));
    await tick();
    expect(scripts(TOSS_SDK)).toHaveLength(0);
    const req = (fake.requestPayment.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(req).not.toHaveProperty('customerEmail');
    expect(req).not.toHaveProperty('customerName');
  });

  it('clientKey 가 없으면 VITE_TOSS_CLIENT_KEY 를 쓰고, 둘 다 없으면 한국어 오류', async () => {
    vi.stubEnv('VITE_TOSS_CLIENT_KEY', 'test_ck_from_env');
    const fake = fakeToss();
    w.TossPayments = fake.TossPayments;
    void mod.openToss(checkout({ clientKey: undefined }));
    await tick();
    expect(fake.TossPayments).toHaveBeenCalledWith('test_ck_from_env');

    vi.stubEnv('VITE_TOSS_CLIENT_KEY', '');
    await expect(mod.openToss(checkout({ clientKey: undefined }))).rejects.toThrow('토스페이먼츠 클라이언트 키(VITE_TOSS_CLIENT_KEY)가 설정되지 않았어요.');
  });

  it('스크립트 로드 실패는 한국어 오류이고, 다음 호출에서 다시 로드를 시도한다', async () => {
    const p = mod.openToss(checkout());
    await tick();
    scripts(TOSS_SDK)[0]!.dispatchEvent(new Event('error'));
    await expect(p).rejects.toThrow('결제 모듈을 불러오지 못했어요');
    expect(scripts(TOSS_SDK)).toHaveLength(0);

    void mod.openToss(checkout());
    await tick();
    expect(scripts(TOSS_SDK)).toHaveLength(1);
  });

  it('로드는 됐는데 전역이 없거나 응답이 없으면(타임아웃) 오류', async () => {
    const p1 = mod.openToss(checkout());
    await tick();
    scripts(TOSS_SDK)[0]!.dispatchEvent(new Event('load')); // TossPayments 미등록
    await expect(p1).rejects.toThrow('결제 모듈을 불러오지 못했어요');

    vi.useFakeTimers();
    const p2 = mod.openToss(checkout());
    const assertion = expect(p2).rejects.toThrow('결제 모듈을 불러오지 못했어요');
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it('SDK 오류 — 사용자 취소는 "결제를 취소했어요", 그 외는 SDK 메시지', async () => {
    const fake = fakeToss();
    w.TossPayments = fake.TossPayments;
    fake.requestPayment.mockRejectedValueOnce({ code: 'USER_CANCEL', message: '사용자가 결제를 취소하였습니다' });
    await expect(mod.openToss(checkout())).rejects.toThrow('결제를 취소했어요.');
    fake.requestPayment.mockRejectedValueOnce({ code: 'INVALID_ORDER_ID', message: '주문번호 형식이 올바르지 않습니다.' });
    await expect(mod.openToss(checkout())).rejects.toThrow('주문번호 형식이 올바르지 않습니다.');
  });
});

// ── 포트원 V2 ────────────────────────────────────────────────

describe('openPortOne', () => {
  const fakePortOne = (result: unknown) => ({ requestPayment: vi.fn(async () => result) });

  it('storeId/channelKey 가 없으면 한국어 오류', async () => {
    await expect(mod.openPortOne(checkout({ storeId: undefined }))).rejects.toThrow('포트원 storeId/channelKey 가 설정되지 않았어요.');
    expect(scripts(PORTONE_SDK)).toHaveLength(0);
  });

  it('SDK 를 1회 로드하고 paymentId === orderId 로 결제 요청', async () => {
    const fake = fakePortOne({ transactionType: 'PAYMENT', txId: 'tx-1', paymentId: 'ORD-20261012-ABCDEF123456' });
    const p1 = mod.openPortOne(checkout());
    const p2 = mod.openPortOne(checkout());
    await tick();
    expect(scripts(PORTONE_SDK)).toHaveLength(1);
    finishLoad(PORTONE_SDK, () => (w.PortOne = fake));
    await Promise.all([p1, p2]);

    expect(fake.requestPayment).toHaveBeenCalledWith({
      storeId: 'store-x',
      channelKey: 'channel-key-x',
      paymentId: 'ORD-20261012-ABCDEF123456',
      orderName: '평생 사주분석서',
      totalAmount: 9900,
      currency: 'CURRENCY_KRW',
      payMethod: 'CARD',
      redirectUrl: `${ORIGIN}/payments/success`,
      customer: { email: 'user@example.com', fullName: '홍길동' },
    });
    const req = (fake.requestPayment.mock.calls[0] as unknown[])[0] as { paymentId: string };
    expect(req.paymentId).toBe(checkout().orderId);
  });

  it('PC 결과에 code 가 없으면 successUrl?paymentId=&orderId= 로 이동', async () => {
    w.PortOne = fakePortOne({ transactionType: 'PAYMENT', txId: 'tx-1', paymentId: 'ORD-20261012-ABCDEF123456' });
    await mod.openPortOne(checkout());
    expect(assign).toHaveBeenCalledTimes(1);
    const url = new URL(assign.mock.calls[0]![0] as string, ORIGIN);
    expect(url.pathname).toBe('/payments/success');
    expect(Object.fromEntries(url.searchParams)).toEqual({ paymentId: 'ORD-20261012-ABCDEF123456', orderId: 'ORD-20261012-ABCDEF123456', amount: '9900', provider: 'portone' });
  });

  it('PC 결과에 code 가 있으면 failUrl?orderId=&code=&message= 로 이동', async () => {
    w.PortOne = fakePortOne({ transactionType: 'PAYMENT', paymentId: 'ORD-20261012-ABCDEF123456', code: 'FAILURE_TYPE_PG', message: '사용자가 결제를 취소했습니다. & 다시 시도' });
    await mod.openPortOne(checkout());
    const url = new URL(assign.mock.calls[0]![0] as string, ORIGIN);
    expect(url.pathname).toBe('/payments/fail');
    expect(Object.fromEntries(url.searchParams)).toEqual({ orderId: 'ORD-20261012-ABCDEF123456', code: 'FAILURE_TYPE_PG', message: '사용자가 결제를 취소했습니다. & 다시 시도' });
  });

  it('결과가 없으면(모바일 리다이렉트 중) 이동하지 않는다', async () => {
    w.PortOne = fakePortOne(undefined);
    await mod.openPortOne(checkout());
    expect(assign).not.toHaveBeenCalled();
  });

  it('SDK 예외는 한국어 오류로 변환', async () => {
    w.PortOne = { requestPayment: vi.fn(async () => Promise.reject(new Error(''))) };
    await expect(mod.openPortOne(checkout())).rejects.toThrow('포트원 결제창을 열지 못했어요');
    expect(assign).not.toHaveBeenCalled();
  });
});
