/**
 * 보고서 화면 — 규칙 기반 본문을 먼저 보여 주고 AI 다듬기 진행을 폴링하다 최종본으로 바꾸기, PDF 저장(웹 인쇄 / 앱 시스템 인쇄 화면).
 * API 는 vi.mock 으로 바꾸고, 앱 인쇄 플러그인(@capgo/capacitor-printer)도 가짜로 끼운다.
 */
import type { ReportDto, ReportProgressDto } from '@saju/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement as h } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastHost } from '../../components/Toast';
import { ReportViewPage } from '../ReportsPage';

const m = vi.hoisted(() => ({
  report: vi.fn<(id: string) => Promise<ReportDto>>(),
  reportProgress: vi.fn<(id: string) => Promise<ReportProgressDto>>(),
  printWebView: vi.fn<(o: { name: string }) => Promise<void>>(),
}));

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>();
  return { ...actual, api: { ...actual.api, report: m.report, reportProgress: m.reportProgress } };
});
vi.mock('@capgo/capacitor-printer', () => ({ Printer: { printWebView: m.printWebView } }));

const section = (key: string, text: string) => ({ key, title: `${key} 제목`, summary: `${key} 요약`, paragraphs: [text] });
const base: ReportDto = {
  id: 'r1',
  type: 'yearly',
  title: '민수님의 2027 정미년 신년운세',
  profileId: 'p1',
  partnerProfileId: null,
  year: 2027,
  sections: [section('total', '규칙 기반 총운 문단이에요.'), section('wealth', '규칙 기반 재물 문단이에요.')],
  generator: 'rule',
  status: 'ready',
  progress: null,
  createdAt: '2026-10-15T00:00:00.000Z',
};
const polishing: ReportDto = { ...base, status: 'polishing', progress: { done: 0, total: 3 } };
const polished: ReportDto = { ...base, generator: 'ai', sections: [section('total', 'AI가 다듬은 총운 문단이에요.'), section('wealth', 'AI가 다듬은 재물 문단이에요.')] };

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  return render(
    h(
      QueryClientProvider,
      { client: qc },
      h(MemoryRouter, { initialEntries: ['/reports/r1'] }, h(Routes, null, h(Route, { path: '/reports/:id', element: h(ReportViewPage) })), h(ToastHost)),
    ),
  );
}

function setScrollY(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  m.report.mockReset();
  m.reportProgress.mockReset();
  m.printWebView.mockReset().mockResolvedValue(undefined);
  window.scrollBy = vi.fn() as typeof window.scrollBy;
  setScrollY(0);
  delete document.documentElement.dataset.theme;
});
afterEach(() => {
  cleanup();
  delete window.Capacitor;
  vi.useRealTimers();
});

describe('AI 다듬기 — 규칙 기반 본문을 먼저 보여 준다', () => {
  it('진행률을 폴링하다가, 아직 읽기 전이면 최종본으로 바로 바꾼다', async () => {
    m.report.mockResolvedValueOnce(polishing).mockResolvedValueOnce(polished);
    m.reportProgress.mockResolvedValueOnce({ status: 'polishing', progress: { done: 2, total: 3 } }).mockResolvedValue({ status: 'ready', progress: null });
    renderPage();

    expect(await screen.findByText('규칙 기반 총운 문단이에요.')).toBeInTheDocument();
    expect(screen.getByText('AI가 문장을 다듬고 있어요')).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByRole('progressbar', { name: 'AI 문장 다듬기 진행' })).toHaveAttribute('aria-valuenow', '2'));
    expect(screen.getByText('2/3')).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(await screen.findByText('AI가 다듬은 총운 문단이에요.')).toBeInTheDocument();
    expect(screen.queryByText('규칙 기반 총운 문단이에요.')).not.toBeInTheDocument();
    expect(screen.queryByText('AI가 문장을 다듬고 있어요')).not.toBeInTheDocument();
    expect(screen.getByText('AI가 쓴 풀이')).toBeInTheDocument();
    expect(screen.getByText('AI가 다듬은 문장으로 바꿨어요')).toBeInTheDocument();
    // 다 끝나면 더 폴링하지 않는다
    const calls = m.reportProgress.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(m.reportProgress).toHaveBeenCalledTimes(calls);
  });

  it('읽는 중이면 글을 갑자기 바꾸지 않고 "바꿔 보기"를 띄운다 — 누르면 읽던 섹션 자리를 지킨다', async () => {
    m.report.mockResolvedValueOnce(polishing).mockResolvedValueOnce(polished);
    m.reportProgress.mockResolvedValue({ status: 'ready', progress: null });
    renderPage();
    await screen.findByText('규칙 기반 총운 문단이에요.');
    setScrollY(800);

    const swap = await screen.findByRole('button', { name: '바꿔 보기' });
    expect(screen.getByText('규칙 기반 재물 문단이에요.')).toBeInTheDocument();
    expect(screen.getByText('AI가 다듬은 문장이 준비됐어요')).toBeInTheDocument();

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(swap);
    expect(screen.getByText('AI가 다듬은 재물 문단이에요.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '바꿔 보기' })).not.toBeInTheDocument();
    expect(window.scrollBy).toHaveBeenCalled();
  });

  it('이미 최종본이면 진행을 폴링하지 않는다 (AI 키가 없을 때 포함)', async () => {
    m.report.mockResolvedValue(base);
    renderPage();
    await screen.findByText('규칙 기반 총운 문단이에요.');
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(m.reportProgress).not.toHaveBeenCalled();
    expect(screen.queryByText('AI가 문장을 다듬고 있어요')).not.toBeInTheDocument();
  });
});

describe('PDF로 저장', () => {
  it('웹은 브라우저 인쇄 — 밝은 테마로 찍고 인쇄가 끝나면 되돌린다', async () => {
    m.report.mockResolvedValue(base);
    document.documentElement.dataset.theme = 'dark';
    const print = vi.fn(() => expect(document.documentElement.dataset.theme).toBe('light'));
    window.print = print;
    renderPage();
    await screen.findByText('규칙 기반 총운 문단이에요.');

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getAllByRole('button', { name: 'PDF로 저장' })[1]!);
    expect(print).toHaveBeenCalledTimes(1);
    expect(m.printWebView).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('afterprint'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.queryByText(/PDF로 저장'으로 고르면/)).not.toBeInTheDocument();
  });

  it('앱은 시스템 인쇄 화면(Android PDF로 저장) — 화면이 닫힐 때까지 밝은 테마를 유지한다', async () => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    m.report.mockResolvedValue(base);
    document.documentElement.dataset.theme = 'dark';
    let close!: () => void;
    m.printWebView.mockImplementation(() => new Promise<void>((resolve) => (close = resolve)));
    window.print = vi.fn();
    renderPage();
    await screen.findByText('규칙 기반 총운 문단이에요.');
    expect(screen.getByText("인쇄 화면에서 프린터를 'PDF로 저장'으로 고르면 파일로 남아요.")).toBeInTheDocument();

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const [headerButton, bodyButton] = screen.getAllByRole('button', { name: 'PDF로 저장' });
    await user.click(bodyButton!);
    await vi.waitFor(() => expect(m.printWebView).toHaveBeenCalledWith({ name: base.title }));
    expect(document.documentElement.dataset.theme).toBe('light');
    // 인쇄 화면이 떠 있는 동안 또 눌러도 다시 열지 않는다
    await user.click(headerButton!);
    expect(m.printWebView).toHaveBeenCalledTimes(1);

    await act(async () => close());
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.print).not.toHaveBeenCalled();
  });

  it('앱에서 인쇄 화면을 열지 못하면 알려 주고 테마를 되돌린다', async () => {
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    m.report.mockResolvedValue(base);
    m.printWebView.mockRejectedValue(new Error('presentationFailed'));
    renderPage();
    await screen.findByText('규칙 기반 총운 문단이에요.');
    expect(screen.getByText("인쇄 화면 위쪽 공유 버튼에서 '파일에 저장'을 고르면 PDF로 남아요.")).toBeInTheDocument();

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getAllByRole('button', { name: 'PDF로 저장' })[1]!);
    expect(await screen.findByText('PDF 저장 화면을 열지 못했어요. 잠시 후 다시 시도해 주세요.')).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
