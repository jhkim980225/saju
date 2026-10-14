/**
 * 토정비결(土亭秘訣) 작괘(作卦) — 상괘 8 × 중괘 6 × 하괘 3 = 144괘.
 *
 * 전통 작괘법(한국민족문화대백과사전 「토정비결」, 만복가 「토정비결 작괘법」(김중순 정리 인용) — docs/SAJU_ENGINE.md「토정비결 작괘」):
 *  - 상괘 = (그해 세는나이 + 그해 태세수) ÷ 8 의 나머지 (0 → 8)
 *  - 중괘 = (그해 음력 생월의 날수(큰달 30·작은달 29) + 그해 생월의 월건수) ÷ 6 의 나머지 (0 → 6)
 *  - 하괘 = (음력 생일 + 그해 음력 생일의 일진수) ÷ 3 의 나머지 (0 → 3)
 *  태세수·월건수·일진수는 간지의 천간수 + 지지수. 천간수는 선천수(甲己9 乙庚8 丙辛7 丁壬6 戊癸5)로 셋이 같고,
 *  지지수는 태세·월건·일진마다 표가 다르다(아래 상수).
 *
 * 전통 책에 명시되지 않은 경우의 처리(이 엔진의 약속):
 *  - 윤달 출생: 같은 달 번호의 평달로 본다(윤달 생일을 평달에 쇠는 관습, 윤달에는 월건이 따로 없음).
 *  - 대상 연도에 생월의 윤달이 있어도 날수·월건·일진은 평달(앞의 달)로 계산한다.
 *  - 30일생인데 그해 생월이 작은달(29일)이면 생일수는 30 그대로, 일진은 그달 그믐(29일)의 일진을 쓴다.
 *  - 세는나이 = 대상 연도 − 음력 출생 연도 + 1 (나이는 설날에 한 살 먹는다).
 *  - 월건은 절기가 아니라 음력 달 번호로 정한다(정월 = 寅월, 천간은 년상기월법).
 */
import { CalendarRangeError, addDays, dayGanzhiIndex, lunarToSolar, solarToLunar, type LunarDate } from './calendar.js';
import { ganzhiFromIndex, ganzhiHangul, ganzhiHanja, mod } from './constants.js';
import { SajuInputError, monthStemOf, type CalendarType } from './chart.js';
import { yearPillarOf } from './luck.js';

/** 천간수(선천수) — 태세·월건·일진 공통. 인덱스 0=甲 … 9=癸 */
export const TOJEONG_STEM_NUMBERS: readonly number[] = [9, 8, 7, 6, 5, 9, 8, 7, 6, 5];
/** 태세수의 지지수. 인덱스 0=子 … 11=亥 */
export const TOJEONG_YEAR_BRANCH_NUMBERS: readonly number[] = [11, 13, 10, 10, 13, 9, 9, 13, 12, 12, 13, 11];
/** 월건수의 지지수(지지 선천수) */
export const TOJEONG_MONTH_BRANCH_NUMBERS: readonly number[] = [9, 8, 7, 6, 5, 4, 9, 8, 7, 6, 5, 4];
/** 일진수의 지지수 */
export const TOJEONG_DAY_BRANCH_NUMBERS: readonly number[] = [9, 11, 8, 8, 11, 7, 7, 11, 10, 10, 11, 9];

/** 대상 연도 범위 — 음력 데이터(1000~2050) 안에서 12월 끝(다음 해 정월 전날)까지 계산할 수 있는 해 */
export const TOJEONG_MIN_YEAR = 1900;
export const TOJEONG_MAX_YEAR = 2049;

export interface TojeongGanzhi {
  stem: number;
  branch: number;
  hanja: string;
  hangul: string;
}

type Ymd = { year: number; month: number; day: number };

export interface TojeongMonthRange {
  /** 음력 달 1~12 */
  month: number;
  /** 그달의 양력 시작일·끝날 (윤달이 뒤따르면 윤달 끝까지 포함) */
  start: Ymd;
  end: Ymd;
  includesLeapMonth: boolean;
}

export interface TojeongResult {
  /** 괘 번호 111 ~ 863 */
  code: number;
  upper: number;
  middle: number;
  lower: number;
  targetYear: number;
  lunarBirth: LunarDate;
  /** 그해 세는나이 */
  age: number;
  taese: { ganzhi: TojeongGanzhi; stemNumber: number; branchNumber: number; value: number; sum: number };
  wolgeon: { month: number; ganzhi: TojeongGanzhi; stemNumber: number; branchNumber: number; value: number; monthDays: 29 | 30; sum: number };
  iljin: {
    /** 하괘에 더하는 생일수(음력 생일 그대로) */
    birthDay: number;
    /** 일진을 본 그해 음력 날짜(그믐 보정 시 29) */
    lunarDay: number;
    solarDate: Ymd;
    ganzhi: TojeongGanzhi;
    stemNumber: number;
    branchNumber: number;
    value: number;
    sum: number;
  };
  /** 전통 규칙 밖의 보정을 적용했으면 그 설명 */
  notes: string[];
  /** 대상 연도 음력 1~12월의 양력 기간 (월별 운세 표시용) */
  months: TojeongMonthRange[];
}

const ganzhiOf = (stem: number, branch: number): TojeongGanzhi => ({ stem: mod(stem, 10), branch: mod(branch, 12), hanja: ganzhiHanja(stem, branch), hangul: ganzhiHangul(stem, branch) });

/** 나머지가 0이면 나누는 수로 본다 */
const remainder = (n: number, divisor: number) => mod(n, divisor) || divisor;

function tryLunarToSolar(lunar: LunarDate): Ymd | null {
  try {
    return lunarToSolar(lunar);
  } catch (e) {
    if (e instanceof CalendarRangeError) return null;
    throw e;
  }
}

const monthDaysCache = new Map<number, 29 | 30>();

/** 음력 평달의 날수(큰달 30, 작은달 29) */
export function lunarMonthDays(year: number, month: number): 29 | 30 {
  const key = year * 100 + month;
  const cached = monthDaysCache.get(key);
  if (cached) return cached;
  if (!tryLunarToSolar({ year, month, day: 1, isLeapMonth: false })) throw new SajuInputError(`${year}년 음력 ${month}월 정보를 찾을 수 없어요.`);
  const days = tryLunarToSolar({ year, month, day: 30, isLeapMonth: false }) ? 30 : 29;
  monthDaysCache.set(key, days);
  return days;
}

/** 음력 달의 월건(정월 = 寅월, 천간은 년상기월법 — 甲己년 丙寅으로 시작) */
export function lunarMonthGanzhi(year: number, month: number): TojeongGanzhi {
  const yp = yearPillarOf(year);
  return ganzhiOf(monthStemOf(yp.stem, month - 1), month + 1);
}

/** 출생 정보 → 음력 생년월일. 양력은 그날의 음력으로 바꾸고, 음력은 실제로 있는 날짜인지 확인한다 */
export function lunarBirthOf(birth: { calendar: CalendarType; year: number; month: number; day: number; isLeapMonth?: boolean }): LunarDate {
  if (birth.calendar === 'lunar') {
    const lunar = { year: birth.year, month: birth.month, day: birth.day, isLeapMonth: Boolean(birth.isLeapMonth) };
    try {
      lunarToSolar(lunar);
    } catch (e) {
      if (e instanceof CalendarRangeError) throw new SajuInputError(e.message);
      throw e;
    }
    return lunar;
  }
  const lunar = solarToLunar(birth);
  if (!lunar) throw new SajuInputError('음력으로 바꿀 수 없는 날짜예요. 생년월일을 확인해 주세요.');
  return lunar;
}

const rangeCache = new Map<number, TojeongMonthRange[]>();

/** 대상 연도 음력 1~12월의 양력 기간 (연도별 캐시) */
export function tojeongMonthRanges(year: number): TojeongMonthRange[] {
  const cached = rangeCache.get(year);
  if (cached) return cached;
  const ranges = buildMonthRanges(year);
  rangeCache.set(year, ranges);
  return ranges;
}

function buildMonthRanges(year: number): TojeongMonthRange[] {
  const startOf = (y: number, m: number, leap = false) => tryLunarToSolar({ year: y, month: m, day: 1, isLeapMonth: leap });
  const dayBefore = (d: Ymd): Ymd => {
    const t = new Date(Date.UTC(d.year, d.month - 1, d.day) - 86_400_000);
    return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
  };
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const start = startOf(year, month);
    const next = month === 12 ? startOf(year + 1, 1) : startOf(year, month + 1);
    if (!start || !next) throw new SajuInputError(`${year}년 음력 ${month}월 기간을 계산할 수 없어요.`);
    return { month, start, end: dayBefore(next), includesLeapMonth: Boolean(startOf(year, month, true)) };
  });
}

/**
 * 토정비결 괘 계산.
 * @param birth 출생 정보(양력·음력). 시각·성별은 쓰지 않는다.
 * @param targetYear 신수를 보는 해(음력 연도)
 */
export function computeTojeong(birth: { calendar: CalendarType; year: number; month: number; day: number; isLeapMonth?: boolean }, targetYear: number): TojeongResult {
  if (!Number.isInteger(targetYear) || targetYear < TOJEONG_MIN_YEAR || targetYear > TOJEONG_MAX_YEAR) {
    throw new SajuInputError(`토정비결은 ${TOJEONG_MIN_YEAR}~${TOJEONG_MAX_YEAR}년만 볼 수 있어요.`);
  }
  const lunarBirth = lunarBirthOf(birth);
  const age = targetYear - lunarBirth.year + 1;
  if (age < 1) throw new SajuInputError('태어난 해보다 앞선 해의 토정비결은 볼 수 없어요.');
  const notes: string[] = [];
  if (lunarBirth.isLeapMonth) notes.push(`윤${lunarBirth.month}월 출생이라 평달 ${lunarBirth.month}월로 계산했어요.`);

  // 상괘 — 세는나이 + 태세수
  const yp = yearPillarOf(targetYear);
  const taeseStem = TOJEONG_STEM_NUMBERS[yp.stem]!;
  const taeseBranch = TOJEONG_YEAR_BRANCH_NUMBERS[yp.branch]!;
  const taeseValue = taeseStem + taeseBranch;
  const upperSum = age + taeseValue;
  const upper = remainder(upperSum, 8);

  // 중괘 — 그해 생월 날수 + 월건수
  const month = lunarBirth.month;
  const months = tojeongMonthRanges(targetYear);
  const range = months[month - 1]!;
  const monthDays = lunarMonthDays(targetYear, month);
  const mg = lunarMonthGanzhi(targetYear, month);
  const wolStem = TOJEONG_STEM_NUMBERS[mg.stem]!;
  const wolBranch = TOJEONG_MONTH_BRANCH_NUMBERS[mg.branch]!;
  const wolValue = wolStem + wolBranch;
  const middleSum = monthDays + wolValue;
  const middle = remainder(middleSum, 6);
  if (range.includesLeapMonth) {
    notes.push(`${targetYear}년에는 윤${month}월이 있지만 날수·월건·일진은 평달 ${month}월로 계산했어요.`);
  }

  // 하괘 — 생일수 + 그해 음력 생일의 일진수 (평달 초하루에서 날수를 더해 양력 날짜를 얻는다)
  const lunarDay = Math.min(lunarBirth.day, monthDays);
  if (lunarDay !== lunarBirth.day) notes.push(`${targetYear}년 음력 ${month}월은 작은달이라 그믐(29일)의 일진으로 계산했어요.`);
  const solarDate = addDays(range.start, lunarDay - 1);
  const dg = ganzhiFromIndex(dayGanzhiIndex(solarDate.year, solarDate.month, solarDate.day));
  const iljinStem = TOJEONG_STEM_NUMBERS[dg.stem]!;
  const iljinBranch = TOJEONG_DAY_BRANCH_NUMBERS[dg.branch]!;
  const iljinValue = iljinStem + iljinBranch;
  const lowerSum = lunarBirth.day + iljinValue;
  const lower = remainder(lowerSum, 3);

  return {
    code: upper * 100 + middle * 10 + lower,
    upper,
    middle,
    lower,
    targetYear,
    lunarBirth,
    age,
    taese: { ganzhi: ganzhiOf(yp.stem, yp.branch), stemNumber: taeseStem, branchNumber: taeseBranch, value: taeseValue, sum: upperSum },
    wolgeon: { month, ganzhi: mg, stemNumber: wolStem, branchNumber: wolBranch, value: wolValue, monthDays, sum: middleSum },
    iljin: { birthDay: lunarBirth.day, lunarDay, solarDate, ganzhi: ganzhiOf(dg.stem, dg.branch), stemNumber: iljinStem, branchNumber: iljinBranch, value: iljinValue, sum: lowerSum },
    notes,
    months,
  };
}

/** 144괘 번호 전체(111, 112, 113, 121 … 863) — 콘텐츠 검증용 */
export const TOJEONG_CODES: readonly number[] = Array.from({ length: 144 }, (_, i) => {
  const upper = Math.floor(i / 18) + 1;
  const middle = Math.floor((i % 18) / 3) + 1;
  const lower = (i % 3) + 1;
  return upper * 100 + middle * 10 + lower;
});
