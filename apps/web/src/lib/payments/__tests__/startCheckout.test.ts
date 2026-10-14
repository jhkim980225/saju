/**
 * startCheckout — 그로블은 서버가 내려준 결제 링크(?ref=주문 ID)로 같은 탭에서 이동하고,
 * 돌아온 결과 화면이 기다릴 주문을 저장해 둔다.
 */
import type { CheckoutDto, ProductDto } from '@saju/shared';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { STORAGE_KEYS, storage } from '../../storage';
import { startCheckout } from '..';

const m = vi.hoisted(() => ({ createOrder: vi.fn<(dto: unknown) => Promise<CheckoutDto>>() }));
vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>();
  return { ...actual, api: { ...actual.api, createOrder: m.createOrder } };
});

const product = { id: 'chat_pack_10', name: 'AI 상담 질문권 10회', price: 3900 } as ProductDto;
const checkout = (redirectUrl?: string): CheckoutDto => ({
  order: { id: 'ORD-20261015-GROBLE0002', productId: product.id, orderName: product.name, amount: 3900, status: 'pending', provider: 'groble', createdAt: '2026-10-15T00:00:00.000Z', paidAt: null },
  provider: 'groble',
  checkout: {
    customerKey: 'u1',
    orderId: 'ORD-20261015-GROBLE0002',
    orderName: product.name,
    amount: 3900,
    successUrl: 'http://localhost:5173/payments/success',
    failUrl: 'http://localhost:5173/payments/fail',
    redirectUrl,
  },
});

let assign: Mock;
beforeEach(() => {
  assign = vi.fn();
  vi.stubGlobal('location', { origin: 'http://localhost:5173', href: 'http://localhost:5173/store', assign });
  m.createOrder.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  storage.remove(STORAGE_KEYS.pendingCheckout);
});

describe('startCheckout — 그로블', () => {
  it('결제 링크로 이동하고, 돌아와 기다릴 주문을 저장한다', async () => {
    const url = 'https://groble.im/payment/chat10?ref=ORD-20261015-GROBLE0002';
    m.createOrder.mockResolvedValue(checkout(url));
    await expect(startCheckout({ product, returnTo: '/ask' })).resolves.toBe('redirected');
    expect(assign).toHaveBeenCalledWith(url);
    expect(storage.getJSON(STORAGE_KEYS.pendingCheckout)).toMatchObject({ orderId: 'ORD-20261015-GROBLE0002', provider: 'groble', returnTo: '/ask' });
  });

  it('서버가 결제 링크를 주지 않으면 이동하지 않고 알린다', async () => {
    m.createOrder.mockResolvedValue(checkout(undefined));
    await expect(startCheckout({ product, returnTo: '/ask' })).rejects.toThrow('결제창이 아직 준비되지 않았어요');
    expect(assign).not.toHaveBeenCalled();
  });
});
