/**
 * 띠별·별자리 운세 — URL·띠 찾기 도우미, 내 띠 자동 선택, 상세 화면 렌더링(기간 탭·근거·년생별·제목)
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import type { ProfileDto, ZodiacFortuneDto } from '@saju/shared';
import { createElement } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ profiles: [] as unknown[], zodiac: vi.fn() }));
vi.mock('@/hooks/queries', () => ({
  useProfiles: () => ({ data: mocks.profiles, isLoading: false, isFetched: true }),
  useConfig: () => ({ data: undefined }),
}));
vi.mock('@/lib/api', () => ({ api: { zodiac: mocks.zodiac, chart: vi.fn() } }));

import { ZODIAC_ANIMALS } from '@saju/shared';
import { animalOfYear, birthYearsOf, horoscopePath, parsePeriod, signOfSolarBirth, zodiacPath } from '../freeFortune';

afterEach(() => {
  cleanup();
  mocks.profiles = [];
  mocks.zodiac.mockReset();
});

describe('도우미', () => {
  it('URL·기간', () => {
    expect(zodiacPath('tiger')).toBe('/zodiac/tiger/today');
    expect(horoscopePath('leo', 'week')).toBe('/horoscope/leo/week');
    expect(parsePeriod('month')).toBe('month');
    expect(parsePeriod('decade')).toBeNull();
    expect(parsePeriod(undefined)).toBeNull();
  });
  it('태어난 해 → 띠 (입춘 이후 출생 기준)', () => {
    expect(animalOfYear(1990).name).toBe('말');
    expect(animalOfYear(1986).name).toBe('호랑이');
    expect(animalOfYear(2026).name).toBe('말');
    expect(animalOfYear(1900).name).toBe('쥐');
    expect(birthYearsOf(ZODIAC_ANIMALS[2], 2026)).toEqual([1938, 1950, 1962, 1974, 1986, 1998, 2010]);
  });
  it('양력 생일만 바로 별자리로, 음력은 변환이 필요', () => {
    expect(signOfSolarBirth({ calendar: 'solar', month: 3, day: 14 })?.slug).toBe('pisces');
    expect(signOfSolarBirth({ calendar: 'solar', month: 8, day: 20 })?.slug).toBe('leo');
    expect(signOfSolarBirth({ calendar: 'lunar', month: 3, day: 14 })).toBeNull();
  });
});

const FIXTURE: ZodiacFortuneDto = {
  animal: { slug: 'tiger', name: '호랑이', hanja: '寅', branch: 2 },
  period: 'week',
  periodLabel: '이번 주',
  date: '2026-10-15',
  range: { start: '2026-10-12', end: '2026-10-18', label: '10월 12일(월) ~ 10월 18일(일)' },
  pillar: null,
  tone: 'mixed',
  toneLabel: '좋고 궂음이 섞여요',
  trait: '호랑이띠는 이른 봄 나무(木)의 기운이에요.',
  headline: '사람 사이의 온도 차가 큰 한 주예요',
  paragraphs: ['반가운 만남과 엇갈림이 번갈아 오기 쉬운 흐름이에요.', '한 주의 바탕인 이번 달 월건 戊戌의 기운은 호랑이띠와 힘을 모으는 흐름이에요.'],
  tip: '중요한 대화는 좋은 날에 꺼내 보세요.',
  reasons: [{ title: '이번 달 월건 戊戌 · 寅戌 삼합(불의 무리)', body: '같은 무리(삼합)에 속한 글자끼리 만나 힘을 모으는 관계예요.' }],
  keyDays: [
    { date: '2026-10-13', weekday: '화요일', marker: '庚申', kind: 'caution', reason: '寅申 충 — 정면으로 부딪치는 날이라 일정 변경과 말다툼을 조심해요.' },
    { date: '2026-10-16', weekday: '금요일', marker: '癸亥', kind: 'good', reason: '寅亥 육합(나무) — 서로 끌어당기는 날이라 약속과 협력에 좋아요.' },
  ],
  lucky: { color: '적색·분홍', direction: '남쪽', number: 2, basis: '삼합으로 생기는 불(火)의 기운' },
  years: [{ year: 1986, ganzhi: '丙寅', text: '이번 주에는 수요일(辛酉일)이 가장 잘 맞아요.', reason: '태어난 해 천간 丙 · 수요일 천간 辛 → 丙辛합(물의 기운으로 묶임)' }],
  basisNote: '띠는 사주 계산과 같이 입춘(양력 2월 4일 무렵)을 해의 경계로 봐요.',
  disclaimer: '띠별 운세는 같은 띠라면 모두에게 같은 풀이예요.',
};

async function renderAt(path: string) {
  const { ZodiacDetailPage } = await import('@/pages/ZodiacPage');
  const router = createMemoryRouter([{ path: '/zodiac/:animal/:period?', element: createElement(ZodiacDetailPage) }], { initialEntries: [path] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client: qc }, createElement(RouterProvider, { router })));
}

describe('띠 상세 화면', () => {
  it('제목·기간 탭·눈여겨볼 날·근거·년생별, 문서 제목과 설명', async () => {
    mocks.zodiac.mockResolvedValue(FIXTURE);
    await renderAt('/zodiac/tiger/week');
    expect(screen.getByRole('heading', { level: 1, name: '호랑이띠 이번 주 운세' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '사람 사이의 온도 차가 큰 한 주예요' })).toBeInTheDocument();
    expect(mocks.zodiac).toHaveBeenCalledWith('tiger', 'week', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));

    const tabs = screen.getByRole('navigation', { name: '기간' });
    expect(tabs.querySelector('[aria-current="page"]')?.textContent).toBe('이번 주');
    expect(tabs.querySelector('a[href="/zodiac/tiger/month"]')?.textContent).toBe('이번 달');

    expect(screen.getByText('이번 주 눈여겨볼 날')).toBeInTheDocument();
    expect(screen.getByText(/寅申 충 — 정면으로 부딪치는 날/)).toBeInTheDocument();
    expect(screen.getByText('이번 달 월건 戊戌 · 寅戌 삼합(불의 무리)')).toBeInTheDocument();
    expect(screen.getByText('1986년생')).toBeInTheDocument();
    expect(screen.getByText(/태어난 해의 천간과 이번 주 7일의 천간/)).toBeInTheDocument();

    expect(document.title).toBe('호랑이띠 이번 주 운세 — 띠별 운세 | 달빛사주');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toContain('1986');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toMatch(/\/zodiac\/tiger\/week$/);
    // 무료 개인 운세로 이어지는 안내
    expect(screen.getByRole('link', { name: '내 사주 입력하기' })).toHaveAttribute('href', '/input');
  });

  it('저장한 사주가 있으면 내 띠를 표시하고 오늘의 운세로 잇는다', async () => {
    mocks.zodiac.mockResolvedValue(FIXTURE);
    const me: Partial<ProfileDto> = { id: 'p1', name: '서윤', isPrimary: true, zodiac: '호랑이', birth: { calendar: 'solar', year: 1986, month: 8, day: 20 } as ProfileDto['birth'] };
    mocks.profiles = [me];
    await renderAt('/zodiac/rat/week');
    await screen.findByRole('heading', { name: '사람 사이의 온도 차가 큰 한 주예요' });
    const picker = screen.getByRole('navigation', { name: '띠 고르기' });
    const tiger = picker.querySelector('a[href="/zodiac/tiger/week"]');
    expect(tiger?.textContent).toContain('내 띠');
    expect(screen.getByRole('link', { name: '오늘의 운세 보기' })).toHaveAttribute('href', '/today');
  });

  it('없는 띠·기간은 찾을 수 없는 페이지', async () => {
    await renderAt('/zodiac/cat/today');
    expect(mocks.zodiac).not.toHaveBeenCalled();
    expect(screen.queryByRole('navigation', { name: '기간' })).toBeNull();
  });
});
