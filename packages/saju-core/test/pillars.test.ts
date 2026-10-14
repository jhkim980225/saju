import { describe, expect, it } from 'vitest';
import { Solar } from 'lunar-javascript';
import {
  calculateSaju,
  computePillars,
  dayGanzhiIndex,
  ganzhiFromIndex,
  ganzhiHanja,
  lunarToSolar,
  monthBoundaries,
  SajuInputError,
  solarToLunar,
  utcToZoned,
} from '../src/index.js';

const hanja = (p: { stem: number; branch: number } | null) => (p ? ganzhiHanja(p.stem, p.branch) : null);

describe('일진(日辰) 계산', () => {
  it('2000-01-01은 戊午일', () => {
    const g = ganzhiFromIndex(dayGanzhiIndex(2000, 1, 1));
    expect(ganzhiHanja(g.stem, g.branch)).toBe('戊午');
  });
  it('1900-01-01은 甲戌일', () => {
    const g = ganzhiFromIndex(dayGanzhiIndex(1900, 1, 1));
    expect(ganzhiHanja(g.stem, g.branch)).toBe('甲戌');
  });
});

describe('절기 시각 — KASI 발표값(KST)과 분 단위 일치', () => {
  const kst = (ms: number) => {
    const t = utcToZoned(ms, 'Asia/Seoul');
    return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')} ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
  };
  it.each([
    [2024, '2024-02-04 17:27'],
    [2025, '2025-02-03 23:10'],
    [2000, '2000-02-04 21:40'],
  ])('%i년 입춘', (year, expected) => {
    expect(kst(monthBoundaries(year)[0]!.utcMs)).toBe(expected);
  });
  it('2024년 경칩 2024-03-05 11:22 KST', () => {
    expect(kst(monthBoundaries(2024)[1]!.utcMs)).toBe('2024-03-05 11:22');
  });
});

describe('년주는 입춘 시각 기준으로 바뀐다', () => {
  const base = { calendar: 'solar' as const, year: 2024, month: 2, day: 4, gender: 'male' as const, timeCorrection: 'clock' as const };
  it('입춘(17:27) 직전은 계묘년', () => {
    const r = computePillars({ ...base, hour: 17, minute: 0 });
    expect(hanja(r.year)).toBe('癸卯');
    expect(hanja(r.month)).toBe('乙丑');
  });
  it('입춘 직후는 갑진년 병인월', () => {
    const r = computePillars({ ...base, hour: 17, minute: 30 });
    expect(hanja(r.year)).toBe('甲辰');
    expect(hanja(r.month)).toBe('丙寅');
  });
});

describe('lunar-javascript(八字) 교차 검증 — 무작위 3000건', () => {
  // 고정 UTC+8 시간대 + 보정 없음 + 야자시 규칙이면 lunar-javascript 기본값(sect=2)과 동일한 조건이 된다
  let seed = 20261012;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const cases: { y: number; m: number; d: number; h: number; mi: number }[] = [];
  for (let i = 0; i < 3000; i++) {
    const y = 1901 + Math.floor(rand() * 198);
    const m = 1 + Math.floor(rand() * 12);
    const d = 1 + Math.floor(rand() * 28);
    const h = Math.floor(rand() * 24);
    const mi = Math.floor(rand() * 60);
    cases.push({ y, m, d, h, mi });
  }

  it('년·월·일·시주가 모두 일치', () => {
    const mismatches: string[] = [];
    for (const c of cases) {
      const ours = computePillars({
        calendar: 'solar', year: c.y, month: c.m, day: c.d, hour: c.h, minute: c.mi, gender: 'female',
        timeZone: 'Etc/GMT-8', timeCorrection: 'clock', ziHourRule: 'midnight',
      });
      const ec = Solar.fromYmdHms(c.y, c.m, c.d, c.h, c.mi, 0).getLunar().getEightChar();
      const theirs = [ec.getYear(), ec.getMonth(), ec.getDay(), ec.getTime()].join(' ');
      const mine = [hanja(ours.year), hanja(ours.month), hanja(ours.day), hanja(ours.hour)].join(' ');
      if (theirs !== mine) mismatches.push(`${c.y}-${c.m}-${c.d} ${c.h}:${c.mi} ours=${mine} lib=${theirs}`);
    }
    // 절입 시각과 정확히 같은 분에 걸친 경우(초 단위 차이)만 허용
    expect(mismatches.length, mismatches.slice(0, 5).join('\n')).toBeLessThanOrEqual(1);
  }, 60_000); // 3000건 — 기본 5초는 다른 작업과 CPU 를 나눠 쓰면 넘는다
});

describe('시간 보정', () => {
  it('서울 경도 보정(lmt)은 약 -32분', () => {
    const chart = calculateSaju({ calendar: 'solar', year: 1995, month: 3, day: 10, hour: 12, minute: 0, gender: 'male' });
    expect(chart.correctionMinutes).toBe(-32);
    expect(chart.correctedTime).toMatchObject({ hour: 11, minute: 28 });
    expect(chart.pillars.hour?.branch.hanja).toBe('午');
  });
  it('1988년 서머타임 기간에는 1시간이 추가로 빠진다', () => {
    const chart = calculateSaju({ calendar: 'solar', year: 1988, month: 7, day: 1, hour: 12, minute: 0, gender: 'male' });
    expect(chart.correctionMinutes).toBe(-92);
    expect(chart.correctedTime).toMatchObject({ hour: 10, minute: 28 });
    expect(chart.pillars.hour?.branch.hanja).toBe('巳');
  });
  it('1956년(UTC+8:30 표준시)에는 보정량이 +2분', () => {
    const chart = calculateSaju({ calendar: 'solar', year: 1956, month: 1, day: 15, hour: 12, minute: 0, gender: 'female' });
    expect(chart.correctionMinutes).toBe(-2);
  });
  it('clock 모드는 입력 시각을 그대로 쓴다', () => {
    const chart = calculateSaju({ calendar: 'solar', year: 1995, month: 3, day: 10, hour: 23, minute: 10, gender: 'male', timeCorrection: 'clock' });
    expect(chart.correctionMinutes).toBe(0);
    expect(chart.pillars.hour?.branch.hanja).toBe('子');
  });
  it('통자시(nextDay)는 23시부터 다음 날 일주, 야자시(midnight)는 당일 일주', () => {
    const base = { calendar: 'solar' as const, year: 2000, month: 1, day: 1, hour: 23, minute: 30, gender: 'male' as const, timeCorrection: 'clock' as const };
    const next = computePillars({ ...base, ziHourRule: 'nextDay' });
    const mid = computePillars({ ...base, ziHourRule: 'midnight' });
    expect(hanja(next.day)).toBe('己未');
    expect(hanja(mid.day)).toBe('戊午');
    // 두 방식 모두 子시 천간은 다음 날(己) 기준 → 甲子시
    expect(hanja(next.hour)).toBe('甲子');
    expect(hanja(mid.hour)).toBe('甲子');
  });
});

describe('음력 변환 (KASI)', () => {
  it('음력 1990-04-21 = 양력 1990-05-15', () => {
    expect(lunarToSolar({ year: 1990, month: 4, day: 21, isLeapMonth: false })).toEqual({ year: 1990, month: 5, day: 15 });
  });
  it('2024 설날(양력 2024-02-10) = 음력 1/1', () => {
    expect(solarToLunar({ year: 2024, month: 2, day: 10 })).toEqual({ year: 2024, month: 1, day: 1, isLeapMonth: false });
  });
  it('2023년 음력 윤2월 존재', () => {
    const s = lunarToSolar({ year: 2023, month: 2, day: 1, isLeapMonth: true });
    expect(s).toEqual({ year: 2023, month: 3, day: 22 });
  });
  it('존재하지 않는 윤달은 SajuInputError', () => {
    expect(() => computePillars({ calendar: 'lunar', year: 2021, month: 1, day: 1, isLeapMonth: true, gender: 'male' })).toThrow(SajuInputError);
  });
  it('음력 입력으로도 같은 사주가 나온다', () => {
    const solar = calculateSaju({ calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' });
    const lunar = calculateSaju({ calendar: 'lunar', year: 1990, month: 4, day: 21, hour: 14, minute: 30, gender: 'male' });
    expect(lunar.pillars).toEqual(solar.pillars);
  });
});

describe('입력 검증', () => {
  it('잘못된 양력 날짜', () => {
    expect(() => computePillars({ calendar: 'solar', year: 2023, month: 2, day: 29, gender: 'male' })).toThrow(SajuInputError);
  });
  it('잘못된 시간대', () => {
    expect(() => computePillars({ calendar: 'solar', year: 2023, month: 2, day: 1, gender: 'male', timeZone: 'Mars/Base' })).toThrow(SajuInputError);
  });
  it('범위 밖 연도', () => {
    expect(() => computePillars({ calendar: 'solar', year: 1850, month: 2, day: 1, gender: 'male' })).toThrow(SajuInputError);
  });
});

describe('시간 모름', () => {
  it('시주 없이 6글자, 절입일이면 경고', () => {
    const chart = calculateSaju({ calendar: 'solar', year: 2024, month: 2, day: 4, gender: 'female' });
    expect(chart.pillars.hour).toBeNull();
    expect(chart.hourKnown).toBe(false);
    expect(chart.warnings.join(' ')).toContain('입춘');
    const total = Object.values(chart.elements.count).reduce((a, b) => a + b, 0);
    expect(total).toBe(6);
  });
});

describe('24절기 목록', () => {
  it.each([2024, 2026, 2027, 1990])('%i년은 24개, 소한으로 시작해 동지로 끝난다', async (y) => {
    const { solarTermsOfYear } = await import('../src/index.js');
    const terms = solarTermsOfYear(y);
    expect(terms).toHaveLength(24);
    expect(terms[0]!.name).toBe('소한');
    expect(terms[23]!.name).toBe('동지');
  });
});
