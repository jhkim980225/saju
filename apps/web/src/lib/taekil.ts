/**
 * 택일 화면 도우미 — 날짜 계산(KST 'YYYY-MM-DD' 문자열), 달력 칸, 입력 검증, 등급 표시.
 * 서버(@saju/shared TAEKIL_LIMITS)와 같은 한도를 쓴다.
 */
import { TAEKIL_GRADE_NAME, TAEKIL_LIMITS, type TaekilGradeId } from '@saju/shared';

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const toUtc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const fromUtc = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

export const addDaysIso = (iso: string, n: number) => fromUtc(toUtc(iso) + n * DAY);
/** b − a (일) */
export const diffDays = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / DAY);
export const weekdayIndex = (iso: string) => new Date(toUtc(iso)).getUTCDay();
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export const weekdayKo = (iso: string) => WEEK[weekdayIndex(iso)]!;
/** '2026-11-14' → '11월 14일(토)' */
export const dateKo = (iso: string) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일(${weekdayKo(iso)})`;
/** '2026-11-14' → '11.14' */
export const dateShort = (iso: string) => `${Number(iso.slice(5, 7))}.${Number(iso.slice(8, 10))}`;
/** 스크린리더용 — '2026년 11월 14일 토요일' */
export const dateA11y = (iso: string) => `${Number(iso.slice(0, 4))}년 ${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일 ${weekdayKo(iso)}요일`;

/** 'n개월 뒤 같은 날 − 1일' (말일 보정) — 빠른 선택 칩용, 최대 92일로 자른다 */
export function monthsLater(fromIso: string, months: number): string {
  const y = Number(fromIso.slice(0, 4));
  const m = Number(fromIso.slice(5, 7)) - 1 + months;
  const d = Number(fromIso.slice(8, 10));
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const end = addDaysIso(fromUtc(Date.UTC(y, m, Math.min(d, last))), -1);
  return diffDays(fromIso, end) + 1 > TAEKIL_LIMITS.maxRangeDays ? addDaysIso(fromIso, TAEKIL_LIMITS.maxRangeDays - 1) : end;
}

export interface MonthRef {
  year: number;
  month: number;
}
export const monthOf = (iso: string): MonthRef => ({ year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) });
export const shiftMonth = (m: MonthRef, n: number): MonthRef => {
  const i = m.year * 12 + (m.month - 1) + n;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
};
export const monthKey = (m: MonthRef) => `${m.year}-${pad(m.month)}`;

/** 일요일부터 시작하는 달력 칸 — 주(7칸) 배열, 빈 칸은 null */
export function monthGrid(m: MonthRef): (string | null)[][] {
  const first = `${m.year}-${pad(m.month)}-01`;
  const days = new Date(Date.UTC(m.year, m.month, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: weekdayIndex(first) }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${m.year}-${pad(m.month)}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

/** from~to 가 걸친 달 목록 */
export function monthsBetween(from: string, to: string): MonthRef[] {
  const out: MonthRef[] = [];
  for (let m = monthOf(from); monthKey(m) <= monthKey(monthOf(to)); m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/** 고를 수 있는 날짜 범위 — 오늘 ~ 오늘+730일 */
export const selectableRange = (today: string) => ({ min: today, max: addDaysIso(today, TAEKIL_LIMITS.maxDaysAhead) });

export type TaekilSelection = { mode: 'range'; from: string | null; to: string | null } | { mode: 'dates'; dates: string[] };

/** 입력 검증 — 통과면 null, 아니면 사용자에게 보여 줄 문장 */
export function selectionError(sel: TaekilSelection, today: string): string | null {
  const { min, max } = selectableRange(today);
  if (sel.mode === 'range') {
    if (!sel.from || !sel.to) return '시작일과 끝일을 골라 주세요.';
    if (sel.from < min) return '지난 날짜는 고를 수 없어요.';
    if (sel.to > max) return '앞으로 2년 안의 날짜만 볼 수 있어요.';
    if (sel.to < sel.from) return '끝일이 시작일보다 빨라요.';
    if (diffDays(sel.from, sel.to) + 1 > TAEKIL_LIMITS.maxRangeDays) return `기간은 최대 ${TAEKIL_LIMITS.maxRangeDays}일까지 볼 수 있어요.`;
    return null;
  }
  const n = new Set(sel.dates).size;
  if (n < TAEKIL_LIMITS.minCandidates) return `후보 날짜를 ${TAEKIL_LIMITS.minCandidates}개 이상 골라 주세요.`;
  if (n > TAEKIL_LIMITS.maxCandidates) return `후보 날짜는 ${TAEKIL_LIMITS.maxCandidates}개까지 고를 수 있어요.`;
  if (sel.dates.some((d) => d < min || d > max)) return '오늘부터 2년 안의 날짜만 고를 수 있어요.';
  return null;
}

/**
 * 기간 선택 — 달력에서 날짜를 누를 때의 다음 상태.
 * 시작만 있으면 끝으로(앞날을 누르면 시작을 바꿈), 둘 다 있으면 새로 시작. 92일을 넘으면 시작부터 다시.
 */
export function nextRange(cur: { from: string | null; to: string | null }, tapped: string): { from: string | null; to: string | null } {
  if (!cur.from || cur.to) return { from: tapped, to: null };
  if (tapped < cur.from) return { from: tapped, to: null };
  if (diffDays(cur.from, tapped) + 1 > TAEKIL_LIMITS.maxRangeDays) return { from: tapped, to: null };
  return { from: cur.from, to: tapped };
}

/** 후보 날짜 토글 — 이미 있으면 빼고, 10개가 차 있으면 그대로 */
export function toggleDate(dates: string[], tapped: string): string[] {
  if (dates.includes(tapped)) return dates.filter((d) => d !== tapped);
  if (dates.length >= TAEKIL_LIMITS.maxCandidates) return dates;
  return [...dates, tapped].sort();
}

/** 등급 표시 — 색만으로 구분하지 않도록 기호를 함께 쓴다(남색 바탕 + 금빛 포인트) */
export const GRADE_STYLE: Record<TaekilGradeId, { mark: string; label: string; cell: string; badge: string }> = {
  best: { mark: '◎', label: TAEKIL_GRADE_NAME.best, cell: 'bg-action text-on-action', badge: 'bg-action text-on-action' },
  good: { mark: '○', label: TAEKIL_GRADE_NAME.good, cell: 'bg-subtle text-ink ring-1 ring-inset ring-ink/60', badge: 'border border-ink/60 text-ink' },
  normal: { mark: '·', label: TAEKIL_GRADE_NAME.normal, cell: 'bg-surface text-ink-2 ring-1 ring-inset ring-line', badge: 'bg-subtle text-ink-2' },
  caution: { mark: '△', label: TAEKIL_GRADE_NAME.caution, cell: 'bg-surface text-ink-3 ring-1 ring-inset ring-line', badge: 'bg-subtle text-ink-3' },
  avoid: { mark: '×', label: TAEKIL_GRADE_NAME.avoid, cell: 'bg-surface text-danger/80 ring-1 ring-inset ring-danger/30', badge: 'border border-danger/40 text-danger' },
};
export const GRADE_ORDER: TaekilGradeId[] = ['best', 'good', 'normal', 'caution', 'avoid'];
