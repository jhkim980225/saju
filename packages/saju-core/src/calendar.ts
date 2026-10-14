/**
 * 달력 계층 — 시간대 변환, 태양시 보정, 절기(節氣) 시각, 양력↔음력 변환.
 *
 * - 절기 시각: lunar-javascript(寿星天文历 알고리즘, 북경시 UTC+8 기준)를 UTC 로 환산해 사용.
 *   KASI(한국천문연구원) 발표 시각과 분 단위로 일치함을 테스트로 검증한다.
 * - 음력: korean-lunar-calendar(KASI 데이터 기반, 1000~2050년). 한국 음력은 중국 음력과
 *   일부 해에 차이가 있으므로 한국 데이터를 우선 사용한다.
 * - 시간대: Intl(IANA tz DB)로 처리 → 한국의 1954~1961 UTC+8:30, 서머타임(1948~51, 1955~60,
 *   1987~88), 해외 출생 모두 자동 반영.
 */
import KoreanLunarCalendar from 'korean-lunar-calendar';
import { Solar } from 'lunar-javascript';
import { MONTH_JIE, SOLAR_TERM_KO } from './constants.js';

export const DEFAULT_TIME_ZONE = 'Asia/Seoul';
/** 서울(종로) 경도 */
export const DEFAULT_LONGITUDE = 126.978;

export interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** 특정 UTC 시각에서 해당 시간대의 UTC 오프셋(분) — 서머타임 포함 */
export function timeZoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const parts = formatter(timeZone).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / MINUTE);
}

/** 시간대의 벽시계 시각 → UTC epoch ms */
export function zonedToUtc(dt: LocalDateTime, timeZone: string): number {
  const naive = Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute);
  let utc = naive - timeZoneOffsetMinutes(naive, timeZone) * MINUTE;
  // 오프셋이 바뀌는 경계(서머타임 시작/종료) 보정을 위해 한 번 더 반복
  utc = naive - timeZoneOffsetMinutes(utc, timeZone) * MINUTE;
  return utc;
}

/** UTC epoch ms → 해당 시간대 벽시계 시각 */
export function utcToZoned(utcMs: number, timeZone: string): LocalDateTime {
  const shifted = new Date(utcMs + timeZoneOffsetMinutes(utcMs, timeZone) * MINUTE);
  return fromShiftedDate(shifted);
}

function fromShiftedDate(d: Date): LocalDateTime {
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/** 균시차(Equation of Time, 분) — 진태양시 보정용 근사식(오차 ~1분) */
export function equationOfTimeMinutes(utcMs: number): number {
  const start = Date.UTC(new Date(utcMs).getUTCFullYear(), 0, 0);
  const n = Math.floor((utcMs - start) / DAY);
  const b = (2 * Math.PI * (n - 81)) / 364;
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

export type TimeCorrection = 'lmt' | 'trueSolar' | 'clock';

/**
 * 사주 시주·일주 판정에 쓰는 "태양시" 계산.
 * - lmt: 지방평균태양시(경도 보정). 서울 기준 표준시 대비 약 -32분.
 * - trueSolar: 진태양시(경도 + 균시차).
 * - clock: 보정 없이 입력 시각 그대로.
 */
export function solarLocalTime(
  utcMs: number,
  opts: { mode: TimeCorrection; longitude: number; timeZone: string },
): { local: LocalDateTime; correctionMinutes: number } {
  const clockOffset = timeZoneOffsetMinutes(utcMs, opts.timeZone);
  let offset: number;
  if (opts.mode === 'clock') {
    offset = clockOffset;
  } else {
    offset = opts.longitude * 4; // 경도 1° = 4분
    if (opts.mode === 'trueSolar') offset += equationOfTimeMinutes(utcMs);
  }
  const rounded = Math.round(offset); // 분 단위로 반올림
  const shifted = new Date(utcMs + rounded * MINUTE);
  return { local: fromShiftedDate(shifted), correctionMinutes: rounded - clockOffset };
}

// ---------------------------------------------------------------------------
// 절기
// ---------------------------------------------------------------------------

export interface SolarTermInstant {
  key: string;
  name: string;
  utcMs: number;
}

interface SolarLike {
  getYear(): number;
  getMonth(): number;
  getDay(): number;
  getHour(): number;
  getMinute(): number;
  getSecond(): number;
}

const BEIJING_OFFSET_MS = 8 * 3_600_000;
function solarToUtc(s: SolarLike): number {
  return Date.UTC(s.getYear(), s.getMonth() - 1, s.getDay(), s.getHour(), s.getMinute(), s.getSecond()) - BEIJING_OFFSET_MS;
}

const jieCache = new Map<number, SolarTermInstant[]>();

/**
 * 사주 연도 Y(입춘 Y ~ 입춘 Y+1)의 월주 경계 13개:
 * 입춘(Y), 경칩, …, 대설(Y), 소한(Y+1), 입춘(Y+1)
 */
export function monthBoundaries(sajuYear: number): SolarTermInstant[] {
  const cached = jieCache.get(sajuYear);
  if (cached) return cached;
  const table = Solar.fromYmd(sajuYear, 6, 1).getLunar().getJieQiTable() as Record<string, SolarLike>;
  const list: SolarTermInstant[] = [];
  for (const jie of MONTH_JIE) {
    const key = jie.key === '小寒' ? 'XIAO_HAN' : jie.key;
    const s = table[key];
    if (!s) throw new Error(`절기 데이터 없음: ${sajuYear} ${jie.key}`);
    list.push({ key: jie.key, name: jie.hangul, utcMs: solarToUtc(s) });
  }
  const next = table['LI_CHUN'];
  if (!next) throw new Error(`절기 데이터 없음: ${sajuYear + 1} 立春`);
  list.push({ key: '立春', name: '입춘', utcMs: solarToUtc(next) });
  jieCache.set(sajuYear, list);
  return list;
}

/** lunar-javascript 의 인접 연도 절기 키(대문자) → 한자 절기명 */
const ADJACENT_TERM_KEYS: Record<string, string> = {
  DA_XUE: '大雪', DONG_ZHI: '冬至', XIAO_HAN: '小寒', DA_HAN: '大寒', LI_CHUN: '立春', YU_SHUI: '雨水', JING_ZHE: '惊蛰',
};

/** 해당 양력 연도(KST 기준)의 24절기 전체 — 만세력 화면용 */
export function solarTermsOfYear(year: number): SolarTermInstant[] {
  const out: SolarTermInstant[] = [];
  for (const y of [year - 1, year, year + 1]) {
    const table = Solar.fromYmd(y, 6, 1).getLunar().getJieQiTable() as Record<string, SolarLike>;
    for (const [rawKey, s] of Object.entries(table)) {
      const key = ADJACENT_TERM_KEYS[rawKey] ?? rawKey;
      const name = SOLAR_TERM_KO[key];
      if (!name) continue;
      const utcMs = solarToUtc(s);
      if (new Date(utcMs + 9 * 3_600_000).getUTCFullYear() !== year) continue;
      if (out.some((t) => Math.abs(t.utcMs - utcMs) < DAY)) continue;
      out.push({ key, name, utcMs });
    }
  }
  return out.sort((a, b) => a.utcMs - b.utcMs);
}

/** 출생 시각이 속한 사주 연도(입춘 기준) */
export function sajuYearOf(utcMs: number): number {
  const y = new Date(utcMs + 9 * 3_600_000).getUTCFullYear();
  const lichun = monthBoundaries(y)[0]!.utcMs;
  return utcMs < lichun ? y - 1 : y;
}

// ---------------------------------------------------------------------------
// 음력
// ---------------------------------------------------------------------------

export interface LunarDate {
  year: number;
  month: number;
  day: number;
  isLeapMonth: boolean;
}

export const LUNAR_MIN_YEAR = 1000;
export const LUNAR_MAX_YEAR = 2050;

export class CalendarRangeError extends Error {}

/** 음력 → 양력 (한국천문연구원 기준). 존재하지 않는 날짜/윤달이면 CalendarRangeError */
export function lunarToSolar(lunar: LunarDate): { year: number; month: number; day: number } {
  if (lunar.year < LUNAR_MIN_YEAR || lunar.year > LUNAR_MAX_YEAR) {
    throw new CalendarRangeError(`음력 변환은 ${LUNAR_MIN_YEAR}~${LUNAR_MAX_YEAR}년만 지원합니다.`);
  }
  const cal = new KoreanLunarCalendar();
  const ok = cal.setLunarDate(lunar.year, lunar.month, lunar.day, lunar.isLeapMonth);
  if (!ok) {
    throw new CalendarRangeError(
      lunar.isLeapMonth
        ? `${lunar.year}년 음력 윤${lunar.month}월 ${lunar.day}일은 존재하지 않는 날짜입니다.`
        : `${lunar.year}년 음력 ${lunar.month}월 ${lunar.day}일은 존재하지 않는 날짜입니다.`,
    );
  }
  const s = cal.getSolarCalendar();
  return { year: s.year, month: s.month, day: s.day };
}

/** 양력 → 음력. 지원 범위 밖이면 null */
export function solarToLunar(date: { year: number; month: number; day: number }): LunarDate | null {
  if (date.year < LUNAR_MIN_YEAR || date.year > LUNAR_MAX_YEAR) return null;
  const cal = new KoreanLunarCalendar();
  if (!cal.setSolarDate(date.year, date.month, date.day)) return null;
  const l = cal.getLunarCalendar();
  return { year: l.year, month: l.month, day: l.day, isLeapMonth: Boolean(l.intercalation) };
}

export function isValidSolarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** 율리우스 적일(JDN) 기반 일진 60갑자 인덱스 — 2000-01-01 = 戊午(54) */
export function dayGanzhiIndex(year: number, month: number, day: number): number {
  const days = Math.floor(Date.UTC(year, month - 1, day) / DAY);
  const jdn = days + 2_440_588;
  return (((jdn + 49) % 60) + 60) % 60;
}

export function addDays(date: { year: number; month: number; day: number }, n: number) {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day) + n * DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
