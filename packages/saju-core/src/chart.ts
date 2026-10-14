/**
 * 사주 원국(原局) 계산 — 입력(양력/음력 생년월일시) → 사주팔자 + 분석 결과.
 */
import type { Element, YinYang } from './constants.js';
import { BRANCHES, HIDDEN_STEMS, MONTH_JIE, NAPEUM, STEMS, ganzhiFromIndex, ganzhiIndex, mod } from './constants.js';
import type { LocalDateTime, LunarDate, SolarTermInstant, TimeCorrection } from './calendar.js';
import {
  CalendarRangeError,
  DEFAULT_LONGITUDE,
  DEFAULT_TIME_ZONE,
  addDays,
  dayGanzhiIndex,
  isValidSolarDate,
  isValidTimeZone,
  lunarToSolar,
  monthBoundaries,
  sajuYearOf,
  solarLocalTime,
  solarToLunar,
  timeZoneOffsetMinutes,
  utcToZoned,
  zonedToUtc,
} from './calendar.js';
import type { TenGod, TwelveStage } from './basics.js';
import { tenGodOf, tenGodOfBranch, twelveStageOf } from './basics.js';
import type { PillarPosition, PositionedPillar, Relation } from './relations.js';
import { findRelations } from './relations.js';
import type { Shinsal } from './shinsal.js';
import { findShinsal, gongmangOf } from './shinsal.js';
import type { ElementAnalysis, StrengthAnalysis, YongsinAnalysis } from './elements.js';
import { analyzeElements, analyzeStrength, determineYongsin } from './elements.js';
import type { DaeunInfo } from './luck.js';
import { calculateDaeun } from './luck.js';

export type Gender = 'male' | 'female';
export type CalendarType = 'solar' | 'lunar';
/** 자시(23~01시) 처리: nextDay = 23시부터 다음 날 일주(통자시), midnight = 0시 기준 날짜 변경(야자시) */
export type ZiHourRule = 'nextDay' | 'midnight';

export interface BirthInput {
  calendar: CalendarType;
  year: number;
  month: number;
  day: number;
  /** 음력 윤달 여부 */
  isLeapMonth?: boolean;
  /** 0~23, null/undefined = 태어난 시간 모름 */
  hour?: number | null;
  minute?: number | null;
  gender: Gender;
  /** IANA 시간대 (기본 Asia/Seoul) */
  timeZone?: string;
  /** 출생지 경도 (기본 서울 126.978) */
  longitude?: number;
  /** 시간 보정 방식 (기본 lmt: 경도 보정) */
  timeCorrection?: TimeCorrection;
  ziHourRule?: ZiHourRule;
}

export interface NormalizedBirthInput extends Required<Omit<BirthInput, 'hour' | 'minute' | 'isLeapMonth'>> {
  isLeapMonth: boolean;
  hour: number | null;
  minute: number | null;
}

export interface StemDetail {
  index: number;
  hanja: string;
  hangul: string;
  element: Element;
  yinYang: YinYang;
  /** 일간 기준 십신 (일간 자신은 '일간') */
  tenGod: TenGod | '일간';
}

export interface BranchDetail {
  index: number;
  hanja: string;
  hangul: string;
  element: Element;
  yinYang: YinYang;
  animal: string;
  tenGod: TenGod;
  hiddenStems: { index: number; hanja: string; hangul: string; element: Element; tenGod: TenGod; days: number }[];
  /** 일간이 이 지지에서 맞는 12운성(봉법) */
  twelveStage: TwelveStage;
}

export interface PillarDetail {
  position: PillarPosition;
  ganzhi: { index: number; hanja: string; hangul: string };
  stem: StemDetail;
  branch: BranchDetail;
  napeum: { name: string; hanja: string; element: Element };
  /** 기둥 천간이 자기 지지에서 맞는 12운성(좌법) */
  selfStage: TwelveStage;
}

export interface SajuChart {
  input: NormalizedBirthInput;
  solarDate: { year: number; month: number; day: number };
  lunarDate: LunarDate | null;
  /** 출생 시각(UTC ISO). 시간 모름이면 정오 기준 */
  birthUtc: string;
  /** 사주 계산에 사용된 보정 시각(시간 모름이면 null) */
  correctedTime: LocalDateTime | null;
  /** 표준시 대비 보정량(분) */
  correctionMinutes: number;
  hourKnown: boolean;
  pillars: { year: PillarDetail; month: PillarDetail; day: PillarDetail; hour: PillarDetail | null };
  dayMaster: StemDetail;
  zodiac: { animal: string; branch: string };
  solarTerm: { previous: { name: string; at: string }; next: { name: string; at: string } };
  elements: ElementAnalysis;
  strength: StrengthAnalysis;
  yongsin: YongsinAnalysis;
  tenGodCount: Record<TenGod, number>;
  relations: Relation[];
  shinsal: Shinsal[];
  gongmang: [string, string];
  daeun: DaeunInfo;
  warnings: string[];
}

export class SajuInputError extends Error {}

/** 시간대의 표준시(서머타임 제외) 오프셋으로 대표 경도를 추정 */
export function estimateLongitude(timeZone: string, year: number): number {
  const jan = timeZoneOffsetMinutes(Date.UTC(year, 0, 15), timeZone);
  const jul = timeZoneOffsetMinutes(Date.UTC(year, 6, 15), timeZone);
  return Math.min(jan, jul) / 4;
}

export function normalizeInput(input: BirthInput): NormalizedBirthInput {
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  if (!isValidTimeZone(timeZone)) throw new SajuInputError(`알 수 없는 시간대입니다: ${timeZone}`);
  // 경도를 모르면: 서울 시간대는 서울 경도, 그 외는 그 해 표준시 오프셋(분)÷4 로 추정(예: UTC-5 → -75°)
  const longitude = input.longitude ?? (timeZone === DEFAULT_TIME_ZONE ? DEFAULT_LONGITUDE : estimateLongitude(timeZone, input.year));
  if (!(longitude >= -180 && longitude <= 180)) throw new SajuInputError('경도는 -180~180 사이여야 합니다.');
  const hour = input.hour ?? null;
  const minute = hour === null ? null : (input.minute ?? 0);
  if (hour !== null && !(Number.isInteger(hour) && hour >= 0 && hour <= 23)) throw new SajuInputError('시(hour)는 0~23 사이 정수여야 합니다.');
  if (minute !== null && !(Number.isInteger(minute) && minute >= 0 && minute <= 59)) throw new SajuInputError('분(minute)은 0~59 사이 정수여야 합니다.');
  if (input.gender !== 'male' && input.gender !== 'female') throw new SajuInputError('성별(gender)은 male 또는 female 이어야 합니다.');
  return {
    calendar: input.calendar,
    year: input.year,
    month: input.month,
    day: input.day,
    isLeapMonth: input.calendar === 'lunar' ? Boolean(input.isLeapMonth) : false,
    hour,
    minute,
    gender: input.gender,
    timeZone,
    longitude,
    timeCorrection: input.timeCorrection ?? 'lmt',
    ziHourRule: input.ziHourRule ?? 'nextDay',
  };
}

function stemDetail(stem: number, dayStem: number, isDayMaster = false): StemDetail {
  const s = STEMS[mod(stem, 10)]!;
  return { index: s.index, hanja: s.hanja, hangul: s.hangul, element: s.element, yinYang: s.yinYang, tenGod: isDayMaster ? '일간' : tenGodOf(dayStem, stem) };
}

function branchDetail(branch: number, dayStem: number): BranchDetail {
  const b = BRANCHES[mod(branch, 12)]!;
  return {
    index: b.index,
    hanja: b.hanja,
    hangul: b.hangul,
    element: b.element,
    yinYang: b.yinYang,
    animal: b.animal,
    tenGod: tenGodOfBranch(dayStem, branch),
    hiddenStems: HIDDEN_STEMS[b.index]!.map((h) => {
      const s = STEMS[h.stem]!;
      return { index: s.index, hanja: s.hanja, hangul: s.hangul, element: s.element, tenGod: tenGodOf(dayStem, h.stem), days: h.days };
    }),
    twelveStage: twelveStageOf(dayStem, branch),
  };
}

export function pillarDetail(position: PillarPosition, stem: number, branch: number, dayStem: number): PillarDetail {
  const idx = ganzhiIndex(stem, branch);
  return {
    position,
    ganzhi: { index: idx, hanja: STEMS[mod(stem, 10)]!.hanja + BRANCHES[mod(branch, 12)]!.hanja, hangul: STEMS[mod(stem, 10)]!.hangul + BRANCHES[mod(branch, 12)]!.hangul },
    stem: stemDetail(stem, dayStem, position === 'day'),
    branch: branchDetail(branch, dayStem),
    napeum: NAPEUM[Math.floor(idx / 2)]!,
    selfStage: twelveStageOf(stem, branch),
  };
}

/** 월주 천간 — 오호둔(五虎遁): 년간에 따라 寅월 천간이 정해진다 */
export function monthStemOf(yearStem: number, monthIndexFromYin: number): number {
  return mod((mod(yearStem, 5) * 2 + 2) + monthIndexFromYin, 10);
}

/** 시주 천간 — 오서둔(五鼠遁): 일간에 따라 子시 천간이 정해진다 */
export function hourStemOf(dayStem: number, hourBranch: number): number {
  return mod(mod(dayStem, 5) * 2 + hourBranch, 10);
}

/** 시각(시·분) → 시지 */
export function hourBranchOf(hour: number, minute: number): number {
  return Math.floor(mod(hour * 60 + minute + 60, 1440) / 120);
}

const iso = (ms: number) => new Date(ms).toISOString();

interface RawPillars {
  normalized: NormalizedBirthInput;
  solarDate: { year: number; month: number; day: number };
  birthUtcMs: number;
  correctedTime: LocalDateTime | null;
  correctionMinutes: number;
  sajuYear: number;
  monthIndex: number;
  boundaries: SolarTermInstant[];
  year: { stem: number; branch: number };
  month: { stem: number; branch: number };
  day: { stem: number; branch: number };
  hour: { stem: number; branch: number } | null;
  warnings: string[];
}

/** 사주 네 기둥만 계산 (분석 없이) */
export function computePillars(input: BirthInput): RawPillars {
  const n = normalizeInput(input);
  const warnings: string[] = [];

  let solarDate: { year: number; month: number; day: number };
  if (n.calendar === 'lunar') {
    try {
      solarDate = lunarToSolar({ year: n.year, month: n.month, day: n.day, isLeapMonth: n.isLeapMonth });
    } catch (e) {
      if (e instanceof CalendarRangeError) throw new SajuInputError(e.message);
      throw e;
    }
  } else {
    if (!isValidSolarDate(n.year, n.month, n.day)) throw new SajuInputError(`${n.year}-${n.month}-${n.day}은 올바른 양력 날짜가 아닙니다.`);
    solarDate = { year: n.year, month: n.month, day: n.day };
  }
  if (solarDate.year < 1900 || solarDate.year > 2100) throw new SajuInputError('1900~2100년 사이의 생년월일만 지원합니다.');

  const hourKnown = n.hour !== null;
  const wall: LocalDateTime = { ...solarDate, hour: n.hour ?? 12, minute: n.minute ?? 0 };
  const birthUtcMs = zonedToUtc(wall, n.timeZone);

  // 년주·월주 — 절기(입춘/절입) 시각 기준
  const sajuYear = sajuYearOf(birthUtcMs);
  const boundaries = monthBoundaries(sajuYear);
  let monthIndex = 0;
  for (let i = 0; i < 12; i++) if (boundaries[i]!.utcMs <= birthUtcMs) monthIndex = i;
  const year = { stem: mod(sajuYear - 4, 10), branch: mod(sajuYear - 4, 12) };
  const month = { stem: monthStemOf(year.stem, monthIndex), branch: MONTH_JIE[monthIndex]!.branch };

  // 일주·시주 — 보정된 태양시 기준
  let dayDate = solarDate;
  let hour: RawPillars['hour'] = null;
  let correctedTime: LocalDateTime | null = null;
  let correctionMinutes = 0;
  if (hourKnown) {
    const st = solarLocalTime(birthUtcMs, { mode: n.timeCorrection, longitude: n.longitude, timeZone: n.timeZone });
    correctedTime = st.local;
    correctionMinutes = st.correctionMinutes;
    const hb = hourBranchOf(st.local.hour, st.local.minute);
    const localDate = { year: st.local.year, month: st.local.month, day: st.local.day };
    let hourStemBase = localDate;
    dayDate = localDate;
    if (st.local.hour >= 23) {
      const next = addDays(localDate, 1);
      if (n.ziHourRule === 'nextDay') dayDate = next;
      hourStemBase = next;
    }
    const baseDayStem = ganzhiFromIndex(dayGanzhiIndex(hourStemBase.year, hourStemBase.month, hourStemBase.day)).stem;
    hour = { stem: hourStemOf(baseDayStem, hb), branch: hb };
  }
  const day = ganzhiFromIndex(dayGanzhiIndex(dayDate.year, dayDate.month, dayDate.day));

  // 경계 경고
  if (!hourKnown) {
    const dayStartUtc = zonedToUtc({ ...solarDate, hour: 0, minute: 0 }, n.timeZone);
    const dayEndUtc = dayStartUtc + 86_400_000;
    const jieToday = boundaries.find((b) => b.utcMs >= dayStartUtc && b.utcMs < dayEndUtc);
    if (jieToday) warnings.push(`생일에 절기(${jieToday.name})가 바뀌어, 태어난 시간에 따라 월주${jieToday.key === '立春' ? '·년주' : ''}가 달라질 수 있습니다.`);
  } else {
    const near = boundaries.find((b) => Math.abs(b.utcMs - birthUtcMs) < 3_600_000);
    if (near) warnings.push(`절입 시각(${near.name}) 전후 1시간 이내 출생으로, 월주 판단에 주의가 필요합니다.`);
    if (correctedTime && correctedTime.hour === 23 && n.ziHourRule === 'midnight') warnings.push('야자시(밤 11시~자정) 출생으로, 일주를 당일 기준으로 계산했습니다.');
  }

  return { normalized: n, solarDate, birthUtcMs, correctedTime, correctionMinutes, sajuYear, monthIndex, boundaries, year, month, day, hour, warnings };
}

/** 사주 원국 전체 계산 + 분석 */
export function calculateSaju(input: BirthInput): SajuChart {
  const raw = computePillars(input);
  const ds = raw.day.stem;
  const positioned: PositionedPillar[] = [
    { position: 'year', ...raw.year },
    { position: 'month', ...raw.month },
    { position: 'day', ...raw.day },
    ...(raw.hour ? [{ position: 'hour' as const, ...raw.hour }] : []),
  ];

  const pillars = {
    year: pillarDetail('year', raw.year.stem, raw.year.branch, ds),
    month: pillarDetail('month', raw.month.stem, raw.month.branch, ds),
    day: pillarDetail('day', raw.day.stem, raw.day.branch, ds),
    hour: raw.hour ? pillarDetail('hour', raw.hour.stem, raw.hour.branch, ds) : null,
  };

  const tenGodCount = { 비견: 0, 겁재: 0, 식신: 0, 상관: 0, 편재: 0, 정재: 0, 편관: 0, 정관: 0, 편인: 0, 정인: 0 } as Record<TenGod, number>;
  for (const p of [pillars.year, pillars.month, pillars.day, pillars.hour]) {
    if (!p) continue;
    if (p.stem.tenGod !== '일간') tenGodCount[p.stem.tenGod] += 1;
    tenGodCount[p.branch.tenGod] += 1;
  }

  const elements = analyzeElements(positioned);
  const strength = analyzeStrength(positioned);
  const yongsin = determineYongsin(ds, strength, elements);
  const gm = gongmangOf(raw.day.stem, raw.day.branch);
  const prev = raw.boundaries[raw.monthIndex]!;
  const next = raw.boundaries[raw.monthIndex + 1]!;
  const lunarDate = solarToLunar(raw.solarDate);

  return {
    input: raw.normalized,
    solarDate: raw.solarDate,
    lunarDate,
    birthUtc: iso(raw.birthUtcMs),
    correctedTime: raw.correctedTime,
    correctionMinutes: raw.correctionMinutes,
    hourKnown: raw.hour !== null,
    pillars,
    dayMaster: pillars.day.stem,
    zodiac: { animal: BRANCHES[raw.year.branch]!.animal, branch: BRANCHES[raw.year.branch]!.hanja },
    solarTerm: {
      previous: { name: prev.name, at: iso(prev.utcMs) },
      next: { name: next.name, at: iso(next.utcMs) },
    },
    elements,
    strength,
    yongsin,
    tenGodCount,
    relations: findRelations(positioned),
    shinsal: findShinsal(positioned),
    gongmang: [BRANCHES[gm[0]]!.hanja, BRANCHES[gm[1]]!.hanja],
    daeun: calculateDaeun({
      gender: raw.normalized.gender,
      yearStem: raw.year.stem,
      month: raw.month,
      dayStem: ds,
      birthUtcMs: raw.birthUtcMs,
      birthYear: raw.solarDate.year,
      prevJieUtcMs: prev.utcMs,
      nextJieUtcMs: next.utcMs,
    }),
    warnings: raw.warnings,
  };
}

/** 표시용: 현지 시각 문자열 */
export function formatLocal(utcIso: string, timeZone = DEFAULT_TIME_ZONE): string {
  const t = utcToZoned(Date.parse(utcIso), timeZone);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${t.year}-${p(t.month)}-${p(t.day)} ${p(t.hour)}:${p(t.minute)}`;
}

