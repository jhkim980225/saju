import { cleanup, render, screen } from '@testing-library/react';
import type { TojeongDto } from '@saju/shared';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { TojeongResult } from '@/pages/TojeongPage';
import { EMPTY_TOJEONG_FORM, formFromBirth, pickTojeongBirth, validateTojeongForm } from '../tojeong';

afterEach(cleanup);

describe('토정비결 입력 폼', () => {
  const now = new Date('2026-10-15T00:00:00Z');

  it('양력 8자리 → 생년월일만 담은 요청', () => {
    expect(validateTojeongForm({ ...EMPTY_TOJEONG_FORM, date: '19900515' }, now)).toEqual({ dto: { calendar: 'solar', year: 1990, month: 5, day: 15, isLeapMonth: false } });
  });

  it('음력은 30일까지, 윤달 표시를 넘긴다 (양력에서는 윤달을 끈다)', () => {
    expect(validateTojeongForm({ calendar: 'lunar', isLeapMonth: true, date: '19870630' }, now).dto).toEqual({ calendar: 'lunar', year: 1987, month: 6, day: 30, isLeapMonth: true });
    expect(validateTojeongForm({ calendar: 'solar', isLeapMonth: true, date: '19870630' }, now).dto?.isLeapMonth).toBe(false);
    expect(validateTojeongForm({ calendar: 'lunar', isLeapMonth: false, date: '19870631' }, now).error).toBeTruthy();
  });

  it('빈 값·형식·없는 날짜·미래 날짜는 오류', () => {
    expect(validateTojeongForm(EMPTY_TOJEONG_FORM, now).error).toBeTruthy();
    expect(validateTojeongForm({ ...EMPTY_TOJEONG_FORM, date: '199005' }, now).error).toBeTruthy();
    expect(validateTojeongForm({ ...EMPTY_TOJEONG_FORM, date: '20230229' }, now).error).toBeTruthy();
    expect(validateTojeongForm({ ...EMPTY_TOJEONG_FORM, date: '20301231' }, now).error).toContain('미래');
  });

  it('저장된 출생 정보에서 필요한 부분만 꺼내고 폼으로 되돌린다', () => {
    const birth = { calendar: 'solar' as const, year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' as const, isLeapMonth: false };
    expect(pickTojeongBirth(birth)).toEqual({ calendar: 'solar', year: 1990, month: 5, day: 15, isLeapMonth: false });
    expect(formFromBirth(pickTojeongBirth(birth))).toEqual({ calendar: 'solar', isLeapMonth: false, date: '19900515' });
  });
});

const SAMPLE: TojeongDto = {
  year: 2027,
  yearPillar: { hanja: '丁未', hangul: '정미' },
  profileId: 'p1',
  gwae: { code: 163, upper: 1, middle: 6, lower: 3, verse: '東風解凍 枯木逢春', reading: '동풍해동 고목봉춘', title: '얼음 풀린 가지에 봄이 와요', summary: '막혔던 일이 풀리는 해예요', keywords: ['해빙', '회복', '귀인'] },
  overview: ['첫 문단이에요.', '둘째 문단이에요.'],
  months: Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    label: `음력 ${i + 1}월`,
    period: '2.7 ~ 3.7',
    flow: (['rise', 'even', 'care'] as const)[i % 3]!,
    flowLabel: ['힘이 붙는 달', '고른 달', '살피는 달'][i % 3]!,
    text: `${i + 1}월의 흐름을 적은 문장이에요.`,
  })),
  basis: {
    lunarBirth: { year: 1990, month: 4, day: 21, isLeapMonth: false },
    age: 38,
    upper: { ganzhi: '丁未', value: 19, sum: 57 },
    middle: { ganzhi: '乙巳', value: 12, monthDays: 30, sum: 42 },
    lower: { ganzhi: '乙巳', value: 15, birthDay: 21, solarDate: '2027-05-26', sum: 36 },
    notes: [],
  },
  shareText: '2027 토정비결 163괘',
  disclaimer: '참고용 콘텐츠예요.',
};

const renderResult = (data: TojeongDto) => render(createElement(MemoryRouter, null, createElement(TojeongResult, { data, name: '민수' })));

describe('토정비결 결과 화면', () => {
  it('괘사·제목·총평·열두 달·작괘 근거를 보여 준다', () => {
    const { container } = renderResult(SAMPLE);
    expect(screen.getByText('東風解凍 枯木逢春')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '얼음 풀린 가지에 봄이 와요' })).toBeInTheDocument();
    expect(screen.getByText('민수님의 2027 정미(丁未)년 토정비결')).toBeInTheDocument();
    expect(screen.getByText('둘째 문단이에요.')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-flow]')).toHaveLength(12);
    expect(container.querySelectorAll('[data-flow="care"]')).toHaveLength(4);
    expect(screen.getByText('38 + 19(丁未) = 57 → 8로 나눈 나머지 1')).toBeInTheDocument();
    expect(screen.getByText('21 + 15(乙巳일) = 36 → 3으로 나눈 나머지 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '공유' })).toBeInTheDocument();
  });

  it('신년운세 추천 — 저장한 사주가 있으면 그 신년운세로, 없으면 사주 입력으로', () => {
    renderResult(SAMPLE);
    expect(screen.getByRole('link', { name: '신년운세 보기' })).toHaveAttribute('href', '/yearly/p1?year=2027');
    cleanup();
    renderResult({ ...SAMPLE, profileId: null });
    expect(screen.getByRole('link', { name: '내 사주로 신년운세 보기' })).toHaveAttribute('href', '/input');
  });
});
