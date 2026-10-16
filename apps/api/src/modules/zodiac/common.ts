/**
 * 띠별·별자리 운세 공용 — 한국 날짜 계산, 범위 표시, 결정적 문구 선택.
 */
import { addDays, hashSeed, kstNoonUtc, utcToZoned } from '@saju/core';

export type Ymd = { year: number; month: number; day: number };

const pad = (n: number) => String(n).padStart(2, '0');
export const isoOf = (d: Ymd) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;

export function kstDateOf(utcMs: number): Ymd {
  const t = utcToZoned(utcMs, 'Asia/Seoul');
  return { year: t.year, month: t.month, day: t.day };
}

/** 그 시각 이후 정오(KST)가 처음 오는 날 — 절입이 오후에 있으면 다음 날부터 그 달로 본다(정오 기준 판정과 맞춤) */
export function firstNoonDateOnOrAfter(utcMs: number): Ymd {
  const d = kstDateOf(utcMs);
  return kstNoonUtc(d) >= utcMs ? d : addDays(d, 1);
}

export const WEEKDAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'] as const;
export const weekdayOf = (d: Ymd) => WEEKDAYS[new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()]!;

export const monthDay = (d: Ymd) => `${d.month}월 ${d.day}일`;

/** 범위 표시 — 같은 날이면 '10월 15일 목요일', 해가 다르면 연도까지 */
export function rangeLabel(start: Ymd, end: Ymd, opts: { withYear?: boolean; withWeekday?: boolean } = {}): string {
  const one = (d: Ymd) => `${opts.withYear ? `${d.year}년 ` : ''}${monthDay(d)}${opts.withWeekday ? `(${weekdayOf(d).slice(0, 1)})` : ''}`;
  if (isoOf(start) === isoOf(end)) return `${monthDay(start)} ${weekdayOf(start)}`;
  return `${one(start)} ~ ${one(end)}`;
}

export function range(start: Ymd, end: Ymd, label: string) {
  return { start: isoOf(start), end: isoOf(end), label };
}

/** 같은 입력이면 항상 같은 항목 — 풀 안의 변형 선택용 */
export function pick<T>(list: readonly T[], seed: string): T {
  return list[hashSeed(seed) % list.length]!;
}

/** 한국 시각 '오후 9시' (정시로 반올림) — 달의 별자리 이동처럼 근사 시각 표시용 */
export function kstHourLabel(utcMs: number): string {
  const t = utcToZoned(utcMs + 30 * 60_000, 'Asia/Seoul');
  const h = t.hour;
  if (h === 0) return '자정';
  if (h === 12) return '정오';
  return h < 12 ? `오전 ${h}시` : `오후 ${h - 12}시`;
}

const ORDINAL = ['첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열', '열한', '열두'];
/** 1 → '첫 번째 자리', 12 → '열두 번째 자리' */
export const houseLabel = (n: number) => `${ORDINAL[n - 1] ?? n} 번째 자리`;

/** 이번 주 요약 — '좋은 날 목·금 · 살필 날 화' */
export function keyDaySummary(keyDays: { weekday: string; kind: 'good' | 'caution' }[]): string {
  const of = (kind: 'good' | 'caution') => keyDays.filter((k) => k.kind === kind).map((k) => k.weekday.slice(0, 1)).join('·');
  const parts = [of('good') && `좋은 날 ${of('good')}`, of('caution') && `살필 날 ${of('caution')}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : '크게 엇갈리는 날 없이 무난해요';
}
