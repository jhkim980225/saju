/**
 * 바텀시트와 뒤로가기(토스 빌드) — 시트가 열린 상태에서 뒤로가기를 누르면 화면은 그대로 두고 시트만 닫혀야 한다.
 * 첫 화면에서는 히스토리가 늘지 않아야 한다(시트를 닫은 뒤 뒤로가기 → 미니앱 종료).
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BottomSheet } from '@/components/BottomSheet';
import { registerSheetHistory } from '@/lib/tossBridge';
import { installSheetHistory, resetSheetHistoryForTest, useSheetHistory } from '../sheetHistory';

/** jsdom 의 history.back() 은 다음 틱에 popstate 를 낸다 */
const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 80)));
const marker = () => (window.history.state as { ydSheet?: string } | null)?.ydSheet;

function Host({ onPopSeen }: { onPopSeen?: () => void }) {
  const [open, setOpen] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        열기
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="구매 창">
        <button type="button" onClick={() => setInner(true)}>
          안쪽 열기
        </button>
        <button type="button" onClick={() => window.history.pushState({ idx: 9 }, '', '/other')}>
          다른 화면으로
        </button>
      </BottomSheet>
      <BottomSheet open={inner} onClose={() => setInner(false)} title="안쪽 창">
        <p>안쪽 내용</p>
      </BottomSheet>
      <span data-testid="pop" onClick={onPopSeen} />
    </>
  );
}

describe('바텀시트와 뒤로가기 (토스)', () => {
  /** 라우터 대신 — 우리 리스너가 숨기지 않은 popstate 만 센다 */
  const routerPop = vi.fn();

  beforeEach(() => {
    window.history.replaceState({ idx: 0, key: 'first' }, '', '/today');
    installSheetHistory();
    registerSheetHistory(useSheetHistory);
    window.addEventListener('popstate', routerPop);
    routerPop.mockClear();
  });
  afterEach(async () => {
    cleanup();
    await settle();
    window.removeEventListener('popstate', routerPop);
    resetSheetHistoryForTest();
    registerSheetHistory(() => undefined);
  });

  it('시트를 열면 히스토리가 한 칸 쌓이고, 주소는 그대로다', async () => {
    const before = window.history.length;
    render(<Host />);
    await userEvent.click(screen.getByText('열기'));
    await settle();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(window.history.length).toBe(before + 1);
    expect(window.location.pathname).toBe('/today');
    expect(marker()).toBeTruthy();
    // 라우터가 쓰는 state(idx, key)는 그대로 복사해 둔다
    expect(window.history.state).toMatchObject({ idx: 0, key: 'first' });
  });

  it('뒤로가기를 누르면 시트만 닫히고 화면은 그대로다(라우터에는 알리지 않는다)', async () => {
    render(<Host />);
    await userEvent.click(screen.getByText('열기'));
    await settle();
    window.history.back();
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/today');
    expect(marker()).toBeUndefined();
    expect(routerPop).not.toHaveBeenCalled();
  });

  it('닫기 버튼으로 닫으면 쌓아 둔 칸을 되돌린다 — 다음 뒤로가기는 화면 밖으로 나간다', async () => {
    render(<Host />);
    await userEvent.click(screen.getByText('열기'));
    await settle();
    await userEvent.click(screen.getAllByLabelText('시트 닫기')[0]!);
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(marker()).toBeUndefined();
    expect(window.history.state).toMatchObject({ idx: 0, key: 'first' });
    expect(routerPop).not.toHaveBeenCalled();
  });

  it('겹친 시트는 뒤로가기 한 번에 위에서부터 하나씩 닫힌다', async () => {
    render(<Host />);
    await userEvent.click(screen.getByText('열기'));
    await settle();
    await userEvent.click(screen.getByText('안쪽 열기'));
    await settle();
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    window.history.back();
    await settle();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByText('구매 창')).toBeInTheDocument();
    window.history.back();
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(marker()).toBeUndefined();
    expect(routerPop).not.toHaveBeenCalled();
  });

  it('시트 안에서 다른 화면으로 이동해 남은 시트 항목은, 돌아올 때 건너뛴다', async () => {
    const view = render(<Host />);
    await userEvent.click(screen.getByText('열기'));
    await settle();
    await userEvent.click(screen.getByText('다른 화면으로'));
    view.unmount(); // 화면이 바뀌어 시트가 사라진다
    await settle();
    expect(window.location.pathname).toBe('/other');
    window.history.back(); // 다른 화면 → (주인 없는 시트 항목) → 처음 화면
    await settle();
    await settle();
    expect(window.location.pathname).toBe('/today');
    expect(marker()).toBeUndefined();
    // 처음 화면에 닿은 pop 한 번만 라우터에 전달된다
    expect(routerPop).toHaveBeenCalledTimes(1);
  });

  it('개발 모드(StrictMode)의 이펙트 두 번 실행에도 한 칸만 쌓인다', async () => {
    render(
      <StrictMode>
        <Host />
      </StrictMode>,
    );
    await userEvent.click(screen.getByText('열기'));
    await settle();
    expect(marker()).toBeTruthy();
    // 한 칸만 쌓였다면 뒤로가기 한 번에 표식 없는 처음 항목으로 돌아온다
    window.history.back();
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(marker()).toBeUndefined();
    expect(window.history.state).toMatchObject({ idx: 0, key: 'first' });
  });

  it('라우터와 함께: 시트를 뒤로가기로 닫아도 화면(경로)은 바뀌지 않는다', async () => {
    const router = createMemoryRouter([{ path: '/today', element: <Host /> }], { initialEntries: ['/today'] });
    render(<RouterProvider router={router} />);
    await userEvent.click(screen.getByText('열기'));
    await settle();
    window.history.back();
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/today');
    expect(screen.getByText('열기')).toBeInTheDocument();
  });
});

describe('바텀시트 (웹·앱 빌드)', () => {
  it('등록하지 않으면 히스토리를 건드리지 않는다', async () => {
    window.history.replaceState({ idx: 0 }, '', '/today');
    const before = window.history.length;
    render(<Host />);
    await userEvent.click(screen.getByText('열기'));
    await settle();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(window.history.length).toBe(before);
    expect(marker()).toBeUndefined();
    cleanup();
  });
});
