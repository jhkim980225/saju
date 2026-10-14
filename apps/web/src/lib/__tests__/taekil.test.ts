import { TAEKIL_PURPOSE_IDS, type TaekilDayDto } from '@saju/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatePickerCalendar, GradeCalendar } from '../../components/TaekilCalendar';
import { t } from '../copy';
import { addDaysIso, dateKo, diffDays, monthGrid, monthsBetween, monthsLater, nextRange, selectionError, toggleDate } from '../taekil';

afterEach(cleanup);

describe('택일 날짜 도우미', () => {
  it('날짜 더하기·차이·표기', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(diffDays('2026-11-01', '2027-01-31')).toBe(91);
    expect(dateKo('2026-11-14')).toBe('11월 14일(토)');
  });

  it('빠른 선택: n개월 뒤 같은 날 하루 전, 최대 92일', () => {
    expect(monthsLater('2026-10-16', 1)).toBe('2026-11-15');
    expect(monthsLater('2026-11-01', 3)).toBe('2027-01-31');
    expect(diffDays('2026-11-01', monthsLater('2026-11-01', 3)) + 1).toBe(92);
    expect(monthsLater('2026-01-31', 1)).toBe('2026-02-27'); // 2월 말일 보정
    expect(diffDays('2026-05-31', monthsLater('2026-05-31', 3)) + 1).toBeLessThanOrEqual(92);
  });

  it('달력 칸 — 일요일 시작, 빈 칸은 null', () => {
    const g = monthGrid({ year: 2026, month: 11 }); // 2026-11-01 은 일요일
    expect(g[0]![0]).toBe('2026-11-01');
    expect(g.flat().filter(Boolean)).toHaveLength(30);
    const feb = monthGrid({ year: 2027, month: 2 }); // 2027-02-01 은 월요일
    expect(feb[0]![0]).toBeNull();
    expect(feb[0]![1]).toBe('2027-02-01');
    expect(monthsBetween('2026-11-20', '2027-01-05').map((m) => `${m.year}-${m.month}`)).toEqual(['2026-11', '2026-12', '2027-1']);
  });

  it('입력 검증 — 서버와 같은 한도', () => {
    const today = '2026-10-15';
    expect(selectionError({ mode: 'range', from: '2026-10-16', to: '2027-01-15' }, today)).toBeNull();
    expect(selectionError({ mode: 'range', from: '2026-10-16', to: '2027-01-16' }, today)).toMatch(/92일/);
    expect(selectionError({ mode: 'range', from: '2026-10-14', to: '2026-10-20' }, today)).toMatch(/지난 날짜/);
    expect(selectionError({ mode: 'range', from: '2026-10-16', to: null }, today)).not.toBeNull();
    expect(selectionError({ mode: 'dates', dates: ['2026-10-20'] }, today)).toMatch(/2개 이상/);
    expect(selectionError({ mode: 'dates', dates: ['2026-10-20', '2026-10-21'] }, today)).toBeNull();
  });

  it('기간 고르기 — 시작 → 끝, 앞날을 누르면 시작을 바꾸고, 다 고른 뒤엔 새로 시작', () => {
    let r = nextRange({ from: null, to: null }, '2026-11-10');
    expect(r).toEqual({ from: '2026-11-10', to: null });
    r = nextRange(r, '2026-11-05');
    expect(r).toEqual({ from: '2026-11-05', to: null });
    r = nextRange(r, '2026-11-30');
    expect(r).toEqual({ from: '2026-11-05', to: '2026-11-30' });
    expect(nextRange(r, '2026-12-01')).toEqual({ from: '2026-12-01', to: null });
    expect(nextRange({ from: '2026-11-01', to: null }, '2027-02-15')).toEqual({ from: '2027-02-15', to: null }); // 92일 초과
  });

  it('후보 날짜 — 토글, 10개까지', () => {
    let ds: string[] = [];
    for (let i = 0; i < 12; i++) ds = toggleDate(ds, addDaysIso('2026-11-01', i));
    expect(ds).toHaveLength(10);
    expect(toggleDate(ds, '2026-11-01')).toHaveLength(9);
  });

  it('문구 — 목적·등급 라벨이 모두 있다', () => {
    for (const p of TAEKIL_PURPOSE_IDS) expect(t(`taekil.purposes.${p}.label`)).not.toBe(`taekil.purposes.${p}.label`);
    expect(t('taekil.paywall.cta', { price: '990원' })).toBe('상세 풀이 열기 · 990원');
  });
});

const day = (date: string, grade: TaekilDayDto['grade'], rank: number | null = null): TaekilDayDto => ({
  date,
  weekday: '토',
  ganzhi: { hanja: '甲子', hangul: '갑자' },
  lunar: { month: 10, day: 1, isLeapMonth: false },
  grade,
  gradeLabel: { best: '대길', good: '길', normal: '보통', caution: '주의', avoid: '피함' }[grade],
  rank,
  score: null,
  officer: null,
  tianShen: null,
  summary: null,
  reasons: null,
  dropReason: null,
  goodHours: null,
});

describe('택일 달력', () => {
  it('결과 달력 — 후보 날짜만 버튼, 등급·순위를 읽어 주고 누르면 그 날짜를 연다', () => {
    const onSelect = vi.fn();
    render(createElement(GradeCalendar, { days: [day('2026-11-14', 'best', 1), day('2026-11-15', 'avoid'), day('2026-12-02', 'good', 2)], onSelect }));
    expect(screen.getByRole('heading', { name: '2026년 11월' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '2026년 12월' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '2026년 11월 14일 토요일 대길 추천 1위' }));
    expect(onSelect).toHaveBeenCalledWith('2026-11-14');
    expect(screen.getByRole('button', { name: '2026년 11월 15일 일요일 피함' })).toBeInTheDocument();
  });

  it('날짜 고르기 달력 — 범위 밖 날짜는 누를 수 없고, 고른 날은 pressed', () => {
    const onTap = vi.fn();
    render(
      createElement(DatePickerCalendar, {
        month: { year: 2026, month: 10 },
        onMonthChange: () => undefined,
        min: '2026-10-15',
        max: '2028-10-14',
        today: '2026-10-15',
        isSelected: (iso: string) => iso === '2026-10-20',
        onTap,
      }),
    );
    expect(screen.getAllByRole('button', { name: /2026년 10월 14일/ })[0]).toBeDisabled();
    expect(screen.getAllByRole('button', { name: /2026년 10월 20일/ })[0]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getAllByRole('button', { name: /2026년 10월 21일/ })[0]!);
    expect(onTap).toHaveBeenCalledWith('2026-10-21');
    expect(screen.getByRole('button', { name: '이전 달' })).toBeDisabled();
  });
});
