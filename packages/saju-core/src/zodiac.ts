/**
 * 띠별 운세용 관계 계산 — 띠(태어난 해의 지지)와 운(일진·월건·세운)의 지지 관계, 태어난 해 천간과 운 천간의 관계.
 *
 * 개인 사주(원국 8글자) 없이 "띠 하나"만으로 보는 운세이므로, 원국 대신 년지(띠) 한 글자를 기준으로
 * 합충형파해·원진(relations.ts)을 그대로 적용한다. 같은 입력은 항상 같은 결과를 낸다.
 */
import type { Element } from './constants.js';
import { BRANCHES, STEMS, controls, ganzhiFromIndex, generates, mod } from './constants.js';
import type { TenGod } from './basics.js';
import { tenGodOf } from './basics.js';
import { addDays, dayGanzhiIndex, monthBoundaries, sajuYearOf, zonedToUtc } from './calendar.js';
import { monthStemOf } from './chart.js';
import { branchBreak, branchClash, branchHarm, branchPunish, branchWonjin, sixCombine, stemClash, stemCombine, threeCombineGroupOf } from './relations.js';

/** 띠 지지와 운 지지의 관계. 삼합은 같은 삼합국(申子辰·寅午戌·巳酉丑·亥卯未)에 속한 두 글자 */
export type BranchBond = '육합' | '삼합' | '동일' | '충' | '형' | '자형' | '파' | '해' | '원진';

export interface BranchBondInfo {
  kind: BranchBond;
  /** 합이 만드는 오행(육합·삼합) */
  element?: Element;
}

/** 관계별 가중치 — 띠 운세의 흐름(tone) 판정용. 사주 운 평가(fortune.ts)의 비중과 같은 방향으로 맞췄다 */
export const BOND_WEIGHT: Record<BranchBond, number> = { 육합: 3, 삼합: 2, 동일: 1, 충: -3, 형: -2, 자형: -1, 원진: -2, 해: -1, 파: -1 };

/** 대표 관계를 고르는 우선순위 (앞이 더 강하게 드러나는 관계) */
export const BOND_PRIORITY: readonly BranchBond[] = ['충', '육합', '삼합', '형', '원진', '동일', '해', '파', '자형'];

export function branchBonds(base: number, other: number): BranchBondInfo[] {
  const a = mod(base, 12);
  const b = mod(other, 12);
  const out: BranchBondInfo[] = [];
  if (a === b) {
    out.push({ kind: '동일', element: BRANCHES[a]!.element });
    if (branchPunish(a, b)) out.push({ kind: '자형' });
    return out;
  }
  const six = sixCombine(a, b);
  if (six) out.push({ kind: '육합', element: six });
  const group = threeCombineGroupOf(a);
  if (group.includes(b)) out.push({ kind: '삼합', element: ({ 0: 'water', 6: 'fire', 9: 'metal', 3: 'wood' } as Record<number, Element>)[group[1]] });
  if (branchClash(a, b)) out.push({ kind: '충' });
  if (branchPunish(a, b)) out.push({ kind: '형' });
  if (branchBreak(a, b)) out.push({ kind: '파' });
  if (branchHarm(a, b)) out.push({ kind: '해' });
  if (branchWonjin(a, b)) out.push({ kind: '원진' });
  return out;
}

/**
 * 운 천간의 오행이 띠 지지 오행에 주는 작용.
 * same: 같은 기운 / support: 띠를 생해 줌 / drain: 띠가 생해 줌(기운을 씀) / gain: 띠가 극함(다스려 얻음) / pressure: 띠를 극함
 */
export type ElementFlow = 'same' | 'support' | 'drain' | 'gain' | 'pressure';

export function elementFlow(animalBranch: number, periodStem: number): ElementFlow {
  const mine = BRANCHES[mod(animalBranch, 12)]!.element;
  const theirs = STEMS[mod(periodStem, 10)]!.element;
  if (mine === theirs) return 'same';
  if (generates(theirs) === mine) return 'support';
  if (generates(mine) === theirs) return 'drain';
  if (controls(mine) === theirs) return 'gain';
  return 'pressure';
}

export const FLOW_WEIGHT: Record<ElementFlow, number> = { same: 0, support: 1, drain: 0, gain: 0, pressure: -1 };

export type ZodiacTone = 'good' | 'calm' | 'mixed' | 'caution';

export interface ZodiacEvaluation {
  bonds: BranchBondInfo[];
  /** 대표 관계 (없으면 null = 특별한 관계 없음) */
  primary: BranchBond | null;
  flow: ElementFlow;
  score: number;
  tone: ZodiacTone;
}

/** 띠 하나와 운 기둥 하나의 관계 평가 */
export function evaluateZodiac(animalBranch: number, pillar: { stem: number; branch: number }): ZodiacEvaluation {
  const bonds = branchBonds(animalBranch, pillar.branch);
  const flow = elementFlow(animalBranch, pillar.stem);
  const kinds = bonds.map((b) => b.kind);
  const primary = BOND_PRIORITY.find((k) => kinds.includes(k)) ?? null;
  const score = bonds.reduce((s, b) => s + BOND_WEIGHT[b.kind], 0) + FLOW_WEIGHT[flow];
  return { bonds, primary, flow, score, tone: zodiacToneOf(bonds, score) };
}

export function zodiacToneOf(bonds: BranchBondInfo[], score: number): ZodiacTone {
  const pos = bonds.some((b) => BOND_WEIGHT[b.kind] > 0 && b.kind !== '동일');
  const neg = bonds.some((b) => BOND_WEIGHT[b.kind] < 0);
  if (pos && neg) return 'mixed';
  if (score >= 2) return 'good';
  if (score <= -2) return 'caution';
  return 'calm';
}

export interface StemBond {
  /** 천간합이 만드는 오행 */
  combine: Element | null;
  clash: boolean;
  /** 태어난 해 천간을 나로 볼 때 운 천간의 십신 */
  tenGod: TenGod;
}

/** 태어난 해 천간(base)과 운 천간(other)의 관계 */
export function stemBond(base: number, other: number): StemBond {
  return { combine: stemCombine(base, other), clash: stemClash(base, other), tenGod: tenGodOf(base, other) };
}

// ---------------------------------------------------------------------------
// 기간별 운 기둥
// ---------------------------------------------------------------------------

export interface PeriodPillar {
  stem: number;
  branch: number;
  /** 구간 시작·끝(UTC ms, 끝은 다음 구간 시작) */
  startUtc: number;
  endUtc: number;
}

type Ymd = { year: number; month: number; day: number };

/** 한국 날짜의 정오(KST) — 월건·세운 판정 시각. 사주 엔진의 "시간 모름 = 정오" 규칙과 같다 */
export function kstNoonUtc(date: Ymd): number {
  return zonedToUtc({ ...date, hour: 12, minute: 0 }, 'Asia/Seoul');
}

export function dayPillarAt(date: Ymd): PeriodPillar {
  const g = ganzhiFromIndex(dayGanzhiIndex(date.year, date.month, date.day));
  const start = zonedToUtc({ ...date, hour: 0, minute: 0 }, 'Asia/Seoul');
  const next = addDays(date, 1);
  return { ...g, startUtc: start, endUtc: zonedToUtc({ ...next, hour: 0, minute: 0 }, 'Asia/Seoul') };
}

/** 월건 — 그 날 정오가 속한 절기 달(입춘·경칩 … 소한 기준) */
export function monthPillarAt(date: Ymd): PeriodPillar & { termName: string; nextTermName: string } {
  const t = kstNoonUtc(date);
  const sajuYear = sajuYearOf(t);
  const b = monthBoundaries(sajuYear);
  let i = 0;
  while (i < 11 && t >= b[i + 1]!.utcMs) i++;
  return {
    stem: monthStemOf(mod(sajuYear - 4, 10), i),
    branch: mod(i + 2, 12),
    startUtc: b[i]!.utcMs,
    endUtc: b[i + 1]!.utcMs,
    termName: b[i]!.name,
    nextTermName: b[i + 1]!.name,
  };
}

/** 세운 — 그 날 정오가 속한 사주 연도(입춘 ~ 다음 입춘) */
export function yearPillarAt(date: Ymd): PeriodPillar & { sajuYear: number } {
  const sajuYear = sajuYearOf(kstNoonUtc(date));
  const b = monthBoundaries(sajuYear);
  return { stem: mod(sajuYear - 4, 10), branch: mod(sajuYear - 4, 12), startUtc: b[0]!.utcMs, endUtc: b[12]!.utcMs, sajuYear };
}

/** 그 날이 속한 주(월요일 ~ 일요일)의 7일 */
export function weekDatesOf(date: Ymd): Ymd[] {
  const dow = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay(); // 0 = 일
  const monday = addDays(date, -((dow + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** 띠(지지)에 해당하는 양력 출생 연도 목록 — 입춘 이후 출생 기준 */
export function birthYearsOfAnimal(branch: number, fromYear: number, toYear: number): number[] {
  const out: number[] = [];
  for (let y = fromYear; y <= toYear; y++) if (mod(y - 4, 12) === mod(branch, 12)) out.push(y);
  return out;
}
