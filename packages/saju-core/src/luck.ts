/**
 * 운(運) — 대운(大運), 세운(歲運), 월운(月運), 일진(日辰).
 */
import { BRANCHES, STEMS, ganzhiFromIndex, ganzhiIndex, mod } from './constants.js';
import type { TenGod, TwelveStage } from './basics.js';
import { tenGodOf, tenGodOfBranch, twelveStageOf } from './basics.js';
import { dayGanzhiIndex, monthBoundaries } from './calendar.js';
import type { Gender } from './chart.js';

const DAY_MS = 86_400_000;

export interface LuckPillar {
  ganzhi: { index: number; hanja: string; hangul: string };
  stem: number;
  branch: number;
  stemTenGod: TenGod;
  branchTenGod: TenGod;
  /** 일간이 운 지지에서 맞는 12운성 */
  twelveStage: TwelveStage;
}

export interface DaeunPeriod extends LuckPillar {
  /** 시작 나이(만 나이 기준) */
  startAge: number;
  endAge: number;
  startYear: number;
  endYear: number;
}

export interface DaeunInfo {
  direction: 'forward' | 'backward';
  /** 대운수 — 첫 대운이 시작되는 나이 */
  startAge: number;
  /** 정밀 대운 시작(년·개월) */
  startExact: { years: number; months: number };
  periods: DaeunPeriod[];
}

export function luckPillar(stem: number, branch: number, dayStem: number): LuckPillar {
  const idx = ganzhiIndex(stem, branch);
  return {
    ganzhi: { index: idx, hanja: STEMS[mod(stem, 10)]!.hanja + BRANCHES[mod(branch, 12)]!.hanja, hangul: STEMS[mod(stem, 10)]!.hangul + BRANCHES[mod(branch, 12)]!.hangul },
    stem: mod(stem, 10),
    branch: mod(branch, 12),
    stemTenGod: tenGodOf(dayStem, stem),
    branchTenGod: tenGodOfBranch(dayStem, branch),
    twelveStage: twelveStageOf(dayStem, branch),
  };
}

/**
 * 대운 — 양남음녀(陽男陰女) 순행, 음남양녀(陰男陽女) 역행.
 * 출생~다음(이전) 절입까지 일수 ÷ 3 = 대운수 (3일 = 1년, 1일 = 4개월).
 */
export function calculateDaeun(args: {
  gender: Gender;
  yearStem: number;
  month: { stem: number; branch: number };
  dayStem: number;
  birthUtcMs: number;
  birthYear: number;
  prevJieUtcMs: number;
  nextJieUtcMs: number;
  count?: number;
}): DaeunInfo {
  const yang = STEMS[mod(args.yearStem, 10)]!.yinYang === 'yang';
  const forward = (yang && args.gender === 'male') || (!yang && args.gender === 'female');
  const diffMs = forward ? args.nextJieUtcMs - args.birthUtcMs : args.birthUtcMs - args.prevJieUtcMs;
  const days = Math.max(0, diffMs / DAY_MS);
  const totalMonths = Math.round(days * 4);
  const startAge = Math.min(10, Math.max(1, Math.round(days / 3)));
  const monthIdx = ganzhiIndex(args.month.stem, args.month.branch);
  const periods: DaeunPeriod[] = [];
  const count = args.count ?? 10;
  for (let i = 1; i <= count; i++) {
    const g = ganzhiFromIndex(monthIdx + (forward ? i : -i));
    const age = startAge + (i - 1) * 10;
    periods.push({
      ...luckPillar(g.stem, g.branch, args.dayStem),
      startAge: age,
      endAge: age + 9,
      startYear: args.birthYear + age,
      endYear: args.birthYear + age + 9,
    });
  }
  return {
    direction: forward ? 'forward' : 'backward',
    startAge,
    startExact: { years: Math.floor(totalMonths / 12), months: totalMonths % 12 },
    periods,
  };
}

/** 특정 나이가 속한 대운 */
export function currentDaeun(info: DaeunInfo, birthYear: number, year: number): DaeunPeriod | null {
  const age = year - birthYear;
  return info.periods.find((p) => age >= p.startAge && age <= p.endAge) ?? null;
}

/** 세운 — 해당 연도(입춘 기준)의 간지 */
export function yearPillarOf(year: number): { stem: number; branch: number } {
  return { stem: mod(year - 4, 10), branch: mod(year - 4, 12) };
}

export interface YearLuck extends LuckPillar {
  year: number;
}

export function seun(dayStem: number, fromYear: number, toYear: number): YearLuck[] {
  const out: YearLuck[] = [];
  for (let y = fromYear; y <= toYear; y++) {
    const p = yearPillarOf(y);
    out.push({ year: y, ...luckPillar(p.stem, p.branch, dayStem) });
  }
  return out;
}

export interface MonthLuck extends LuckPillar {
  /** 寅월=1 … 丑월=12 (사주 월 순서) */
  order: number;
  termName: string;
  startsAt: string;
  endsAt: string;
}

/** 월운 — 사주 연도 Y(입춘~다음 입춘)의 12개월 */
export function wolun(dayStem: number, sajuYear: number): MonthLuck[] {
  const b = monthBoundaries(sajuYear);
  const yearStem = mod(sajuYear - 4, 10);
  const out: MonthLuck[] = [];
  for (let i = 0; i < 12; i++) {
    const stem = mod(mod(yearStem, 5) * 2 + 2 + i, 10);
    const branch = mod(i + 2, 12);
    out.push({
      order: i + 1,
      termName: b[i]!.name,
      startsAt: new Date(b[i]!.utcMs).toISOString(),
      endsAt: new Date(b[i + 1]!.utcMs).toISOString(),
      ...luckPillar(stem, branch, dayStem),
    });
  }
  return out;
}

/** 일진 — 특정 양력 날짜의 간지 */
export function dayPillarOf(date: { year: number; month: number; day: number }): { stem: number; branch: number } {
  return ganzhiFromIndex(dayGanzhiIndex(date.year, date.month, date.day));
}
