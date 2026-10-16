/**
 * 결제 결과 화면 — 그로블(웹훅으로만 확정)은 승인 API 를 부르지 않고, 떠나기 전에 저장한 주문의 상태를 조회하며 기다린다.
 * API 는 vi.mock 으로 바꾼다.
 */
import type { OrderDto } from '@saju/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement as h } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS, storage } from '../../lib/storage';
import { PaymentSuccessPage, WEBHOOK_POLL_MS } from '../PaymentResultPages';

const m = vi.hoisted(() => ({
  order: vi.fn<(id: string) => Promise<OrderDto>>(),
  confirmPayment: vi.fn(),
}));
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, api: { ...actual.api, order: m.order, confirmPayment: m.confirmPayment } };
});

const ORDER_ID = 'ORD-20261015-GROBLE0001';
const order = (status: OrderDto['status']): OrderDto => ({
  id: ORDER_ID,
  productId: 'chat_pack_10',
  orderName: 'AI 상담 질문권 10회',
  amount: 3900,
  status,
  provider: 'groble',
  createdAt: '2026-10-15T00:00:00.000Z',
  paidAt: status === 'paid' ? '2026-10-15T00:00:05.000Z' : null,
});

function renderPage(url = '/payments/success?provider=groble') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(
      QueryClientProvider,
      { client: qc },
      h(
        MemoryRouter,
        { initialEntries: [url] },
        h(Routes, null, h(Route, { path: '/payments/success', element: h(PaymentSuccessPage) }), h(Route, { path: '/today', element: h('p', null, '오늘 화면') })),
      ),
    ),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  m.order.mockReset();
  m.confirmPayment.mockReset();
  storage.setJSON(STORAGE_KEYS.pendingCheckout, { orderId: ORDER_ID, productId: 'chat_pack_10', amount: 3900, provider: 'groble', returnTo: '/today' });
});
afterEach(() => {
  cleanup();
  storage.remove(STORAGE_KEYS.pendingCheckout);
  vi.useRealTimers();
});

describe('그로블 결제 결과 — 웹훅 확정 대기', () => {
  it('주문이 paid 가 될 때까지 조회하고, 승인 API 는 부르지 않는다', async () => {
    m.order.mockResolvedValueOnce(order('pending')).mockResolvedValueOnce(order('pending')).mockResolvedValue(order('paid'));
    renderPage();
    expect(await screen.findByText('결제 완료 여부를 확인하고 있어요. 보통 몇 초 안에 끝납니다.')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(WEBHOOK_POLL_MS * 2);
    expect(await screen.findByRole('heading', { name: '결제가 완료됐어요' })).toBeInTheDocument();
    expect(m.order).toHaveBeenCalledWith(ORDER_ID);
    expect(m.confirmPayment).not.toHaveBeenCalled();
    expect(storage.getJSON(STORAGE_KEYS.pendingCheckout)).toBeNull();
  });

  it('웹훅이 금액·상품 불일치로 실패 처리한 주문은 고객센터 안내', async () => {
    m.order.mockResolvedValue(order('failed'));
    renderPage();
    expect(await screen.findByText(/주문 정보와 일치하지 않아 자동으로 열지 못했습니다/)).toBeInTheDocument();
  });

  it('시간 안에 확정되지 않으면 다시 확인할 수 있고, 그 사이 확정되면 완료로 바뀐다', async () => {
    m.order.mockResolvedValue(order('pending'));
    renderPage();
    await screen.findByText('결제 완료 여부를 확인하고 있어요. 보통 몇 초 안에 끝납니다.');
    await vi.advanceTimersByTimeAsync(WEBHOOK_POLL_MS * 46);
    expect(await screen.findByRole('heading', { name: '결제 확인이 늦어지고 있어요' })).toBeInTheDocument();
    m.order.mockResolvedValue(order('paid'));
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: '다시 확인하기' }));
    expect(await screen.findByRole('heading', { name: '결제가 완료됐어요' })).toBeInTheDocument();
  });

  it('결제하지 않고 돌아온 경우(진입 페이지) 기다리지 않고 원래 화면으로 갈 수 있다', async () => {
    m.order.mockResolvedValue(order('pending'));
    renderPage();
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(await screen.findByRole('button', { name: '결제하지 않고 돌아가기' }));
    expect(await screen.findByText('오늘 화면')).toBeInTheDocument();
  });

  it('저장한 주문이 없으면(다른 브라우저에서 돌아옴) 결제 내역으로 안내', async () => {
    storage.remove(STORAGE_KEYS.pendingCheckout);
    renderPage();
    expect(await screen.findByText(/결제했다면 마이 > 결제 내역에서 확인해 주세요/)).toBeInTheDocument();
    expect(m.order).not.toHaveBeenCalled();
  });
});
