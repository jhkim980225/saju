/**
 * 서비스 공지 — GET /config 의 notices 를 화면 위쪽에 띄우고, 닫으면 그 기기에서 다시 띄우지 않는다(약관 변경 공지 통로).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStorageAdapter } from '@/lib/storage';

const cfg = vi.hoisted(() => ({ notices: [] as { id: string; title: string; body: string }[] }));
vi.mock('@/hooks/queries', () => ({ useConfig: () => ({ data: { notices: cfg.notices } }) }));

const mem = new Map<string, string>();
beforeEach(() => {
  mem.clear();
  setStorageAdapter({ get: (k) => mem.get(k) ?? null, set: (k, v) => void mem.set(k, v), remove: (k) => void mem.delete(k) });
  cfg.notices = [];
});
afterEach(cleanup);

describe('NoticeBar', () => {
  it('공지가 없으면 그리지 않는다', async () => {
    const { NoticeBar } = await import('../NoticeBar');
    const { container } = render(<NoticeBar />);
    expect(container.textContent).toBe('');
  });

  it('공지를 하나씩 보여 주고, 닫으면 다음 공지로 넘어가며 다시 열어도 닫은 공지는 보이지 않는다', async () => {
    cfg.notices = [
      { id: 'terms-2027-01', title: '이용약관이 바뀌어요', body: '2027년 1월 8일부터 적용돼요.' },
      { id: 'privacy-2027-01', title: '개인정보 처리방침이 바뀌어요', body: '' },
    ];
    const { NoticeBar } = await import('../NoticeBar');
    const first = render(<NoticeBar />);
    expect(screen.getByText('이용약관이 바뀌어요')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('공지 닫기'));
    expect(screen.getByText('개인정보 처리방침이 바뀌어요')).toBeTruthy();
    first.unmount();

    render(<NoticeBar />);
    expect(screen.queryByText('이용약관이 바뀌어요')).toBeNull();
    expect(screen.getByText('개인정보 처리방침이 바뀌어요')).toBeTruthy();
  });
});
