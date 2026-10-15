/**
 * 주제별 리포트 카드(연애·결혼운 · 재물·직업운) — 산 프로필이면 '보고서 열기', 아니면 가격·결제 시트.
 * API·결제 흐름(usePurchase)은 vi.mock 으로 바꾼다.
 */
import type { ProductDto, ReportDto, WalletDto } from '@saju/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement as h } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../../lib/session';
import { TopicReportCards } from '../TopicReportCards';

const m = vi.hoisted(() => ({
  products: vi.fn<() => Promise<ProductDto[]>>(),
  wallet: vi.fn<() => Promise<WalletDto>>(),
  createReport: vi.fn<(dto: { type: string; profileId: string }) => Promise<ReportDto>>(),
  purchase: vi.fn<(input: { product: ProductDto; profileId?: string; returnTo: string }) => Promise<void>>(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, api: { ...actual.api, products: m.products, wallet: m.wallet, createReport: m.createReport } };
});
vi.mock('../../hooks/usePurchase', () => ({ usePurchase: () => m.purchase }));

const product = (id: string, name: string, over: Partial<ProductDto> = {}): ProductDto => ({
  id,
  name,
  description: `${name} 설명`,
  type: 'one_time',
  price: 4900,
  listPrice: null,
  credits: 0,
  grants: [`report:${id === 'report_love' ? 'love' : 'career_wealth'}`],
  requiresProfile: true,
  requiresPartner: false,
  requiresReading: false,
  periodDays: null,
  perUserLimit: null,
  purchasable: true,
  saleEndsAt: null,
  badge: null,
  comingSoon: false,
  iosProductId: null,
  androidProductId: null,
  ...over,
});
const PRODUCTS = [product('report_love', '연애·결혼운 리포트'), product('report_career_wealth', '재물·직업운 리포트')];
const wallet = (keys: string[]): WalletDto => ({ credits: 0, paidCredits: 0, freeCredits: 0, ledger: [], entitlements: keys.map((key) => ({ key, expiresAt: null, createdAt: '2026-10-15T00:00:00.000Z' })) });

function Where() {
  const loc = useLocation();
  return h('p', null, `리포트 화면 ${loc.pathname}`);
}

function renderCards(props: Partial<Parameters<typeof TopicReportCards>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(
      QueryClientProvider,
      { client: qc },
      h(
        MemoryRouter,
        { initialEntries: ['/saju/p1'] },
        h(
          Routes,
          null,
          h(Route, { path: '/saju/:id', element: h(TopicReportCards, { profileId: 'p1', name: '민수', returnTo: '/saju/p1', ...props }) }),
          h(Route, { path: '/reports/:id', element: h(Where) }),
        ),
      ),
    ),
  );
}
const card = (title: string) => screen.getByRole('article', { name: title });

beforeEach(() => {
  m.products.mockReset().mockResolvedValue(PRODUCTS);
  m.wallet.mockReset().mockResolvedValue(wallet([]));
  m.createReport.mockReset();
  m.purchase.mockReset().mockResolvedValue(undefined);
  useSession.setState({ accessToken: 'token', refreshToken: 'refresh', user: null });
});
afterEach(() => {
  cleanup();
  useSession.setState({ accessToken: null, refreshToken: null, user: null });
});

describe('주제별 리포트 카드', () => {
  it('사지 않았으면 두 리포트를 4,900원으로 보여 주고, 결제 시트에서 이 프로필로 결제한다', async () => {
    renderCards();
    await screen.findByRole('article', { name: '연애·결혼운 리포트' });
    for (const title of ['연애·결혼운 리포트', '재물·직업운 리포트']) {
      expect(within(card(title)).getByText('4,900원')).toBeInTheDocument();
      expect(within(card(title)).queryByRole('button', { name: '보고서 열기' })).not.toBeInTheDocument();
    }
    const user = userEvent.setup();
    await user.click(within(card('연애·결혼운 리포트')).getByRole('button', { name: '구매하기' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('민수님의 연애·결혼운 리포트')).toBeInTheDocument();
    expect(within(sheet).getByText('성별이 아닌 기질과 오행으로 본 잘 맞는 사람')).toBeInTheDocument();
    // 결제 시트에는 이 상품 하나만
    expect(within(sheet).getAllByRole('radio')).toHaveLength(1);
    await user.click(within(sheet).getByRole('button', { name: '4,900원 결제하기' }));
    expect(m.purchase).toHaveBeenCalledWith({ product: PRODUCTS[0], profileId: 'p1', returnTo: '/saju/p1#topic-reports' });
  });

  it('산 리포트는 "보고서 열기" — 누르면 저장본을 받아 보고서 화면으로 간다', async () => {
    m.wallet.mockResolvedValue(wallet(['report:love:p1', 'report:career_wealth:other']));
    m.createReport.mockResolvedValue({ id: 'r9' } as ReportDto);
    renderCards();
    const open = await within(await screen.findByRole('article', { name: '연애·결혼운 리포트' })).findByRole('button', { name: '보고서 열기' });
    // 다른 프로필의 권한으로는 열리지 않는다
    expect(within(card('재물·직업운 리포트')).getByRole('button', { name: '구매하기' })).toBeInTheDocument();
    await userEvent.setup().click(open);
    expect(m.createReport).toHaveBeenCalledWith({ type: 'love', profileId: 'p1' });
    expect(await screen.findByText('리포트 화면 /reports/r9')).toBeInTheDocument();
  });

  it('비회원 결과(프로필 없음)는 먼저 저장하고, 저장된 프로필 화면으로 돌아오게 결제한다', async () => {
    const ensureProfile = vi.fn().mockResolvedValue('new-p');
    renderCards({ profileId: undefined, ensureProfile, returnTo: '/result' });
    const user = userEvent.setup();
    await user.click(within(await screen.findByRole('article', { name: '재물·직업운 리포트' })).getByRole('button', { name: '구매하기' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '4,900원 결제하기' }));
    expect(ensureProfile).toHaveBeenCalledTimes(1);
    expect(m.purchase).toHaveBeenCalledWith({ product: PRODUCTS[1], profileId: 'new-p', returnTo: '/saju/new-p#topic-reports' });
  });

  it('출시 예정 상품이거나 카탈로그에 없으면 카드를 그리지 않는다', async () => {
    m.products.mockResolvedValue([product('report_love', '연애·결혼운 리포트', { comingSoon: true })]);
    const { container } = renderCards();
    await vi.waitFor(() => expect(m.products).toHaveBeenCalled());
    expect(container.querySelector('article')).toBeNull();
  });
});
