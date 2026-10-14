import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { DreamEntryPage, DreamHomePage } from '../DreamPages';

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/dream', element: createElement(DreamHomePage) },
      { path: '/dream/:slug', element: createElement(DreamEntryPage) },
    ],
    { initialEntries: [path] },
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(createElement(QueryClientProvider, { client: qc }, createElement(RouterProvider, { router })));
  return { router, ...view };
}

afterEach(() => cleanup());

describe('꿈해몽 사전 화면', () => {
  it("검색 — '뱀꿈'을 치면 뱀 꿈이 맨 위에 나오고 키워드 페이지로 이어진다", async () => {
    const user = userEvent.setup();
    const { router } = renderAt('/dream');
    expect(document.title).toContain('꿈해몽 사전');
    await user.type(screen.getByRole('searchbox', { name: '꿈 키워드 검색' }), '뱀꿈');
    const results = await screen.findByRole('list', { name: '검색 결과' });
    const top = within(results).getAllByRole('link')[0]!;
    expect(top).toHaveTextContent('뱀 꿈');
    expect(decodeURI(top.getAttribute('href')!)).toBe('/dream/뱀');
    await user.click(top);
    expect(decodeURI(router.state.location.pathname)).toBe('/dream/뱀');
    expect(await screen.findByRole('heading', { level: 1, name: '뱀 꿈 해몽' })).toBeInTheDocument();
  });

  it('찾는 꿈이 없으면 AI 꿈풀이로 안내한다', async () => {
    const user = userEvent.setup();
    renderAt('/dream');
    await user.type(screen.getByRole('searchbox', { name: '꿈 키워드 검색' }), 'qqqzzz');
    expect(await screen.findByRole('link', { name: 'AI 꿈풀이' })).toHaveAttribute('href', '/dream/ask?text=qqqzzz');
  });

  it('분류를 바꾸면 그 분류의 꿈 목록이 나온다', async () => {
    const user = userEvent.setup();
    const { router } = renderAt('/dream');
    await user.click(within(screen.getByRole('navigation', { name: '꿈 분류' })).getByRole('link', { name: '사람' }));
    expect(router.state.location.search).toBe('?c=person');
    expect(await screen.findByRole('link', { name: /엄마 꿈/ })).toBeInTheDocument();
    expect(document.title).toContain('사람 꿈해몽');
  });

  it('키워드 페이지 — 제목·설명·대표 주소를 화면별로 바꾸고, 떠나면 되돌린다', () => {
    document.title = '기본 제목';
    const { unmount } = renderAt('/dream/뱀');
    expect(screen.getByRole('heading', { level: 1, name: '뱀 꿈 해몽' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '상황별 풀이' })).toBeInTheDocument();
    expect(document.title).toBe('뱀 꿈 해몽 — 뜻과 상황별 풀이 | 달빛사주');
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toMatch(/길몽이에요\. .*상황별 풀이를 정리했어요\.$/);
    expect(decodeURI(document.head.querySelector('link[rel="canonical"]')!.getAttribute('href')!)).toMatch(/\/dream\/뱀$/);
    unmount();
    expect(document.title).toBe('기본 제목');
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it('별칭 주소는 대표 키워드 페이지로 옮긴다', async () => {
    const { router } = renderAt(`/dream/${encodeURIComponent('구렁이')}`);
    expect(await screen.findByRole('heading', { level: 1, name: '뱀 꿈 해몽' })).toBeInTheDocument();
    expect(decodeURI(router.state.location.pathname)).toBe('/dream/뱀');
  });

  it('사전에 없는 주소는 안내와 검색창을 보여 준다', () => {
    renderAt('/dream/qqqzzz');
    expect(screen.getByText('사전에 없는 꿈이에요')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '꿈 키워드 검색' })).toBeInTheDocument();
  });
});
