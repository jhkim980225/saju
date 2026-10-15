/**
 * 주제별 리포트(연애·결혼운 · 재물·직업운) 문장 도우미.
 * 쉬운 말 기준(docs/PLAIN_KOREAN.md): 본문에는 용어·한자를 쓰지 않고, 근거(basis)에만 둔다.
 * 다른 리포트 모듈(report.ts)의 도우미에 기대지 않도록 여기서 따로 둔다.
 */
import type { Element, SajuChart, TenGod, TenGodGroup } from '@saju/core';
import { TEN_GOD_GROUP } from '@saju/core';

export const GROUPS: TenGodGroup[] = ['비겁', '식상', '재성', '관성', '인성'];

/** 마지막 한글 글자의 받침 유무 — 따옴표·괄호는 건너뛴다 */
function batchimOf(word: string): number | null {
  for (let i = word.length - 1; i >= 0; i--) {
    const c = word.charCodeAt(i);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28;
    if (!/['"’”)\]\s]/.test(word[i]!)) return null;
  }
  return null;
}

/** 조사만 — 받침이 있으면 a, 없으면 b */
export const prt = (word: string, a: string, b: string) => {
  const t = batchimOf(word);
  return t === null || t > 0 ? a : b;
};
/** 낱말 + 조사 */
export const pp = (word: string, a: string, b: string) => word + prt(word, a, b);
/** '(으)로' — 받침이 없거나 ㄹ 받침이면 '로' */
export const ro = (word: string) => {
  const t = batchimOf(word);
  return word + (t === null || t === 0 || t === 8 ? '로' : '으로');
};
/** 목록 + 마지막 낱말에 맞춘 조사 */
export const listPp = (items: string[], a: string, b: string, sep = ', ') => pp(items.join(sep), a, b);
/** 연도 목록 '2027년, 2029년' */
export const yearsText = (ys: number[]) => ys.map((y) => `${y}년`).join(', ');

/** 쉬운 오행 이름 */
export const EL_WORD: Record<Element, string> = { wood: '나무', fire: '불', earth: '흙', metal: '쇠', water: '물' };
/** 근거(basis)용 오행 이름 */
export const EL_TERM: Record<Element, string> = { wood: '목(木)', fire: '화(火)', earth: '토(土)', metal: '금(金)', water: '수(水)' };
const EL_HANJA: Record<Element, string> = { wood: '木', fire: '火', earth: '土', metal: '金', water: '水' };
const EL_HANGUL: Record<Element, string> = { wood: '목', fire: '화', earth: '토', metal: '금', water: '수' };

/** 근거용 일간 이름 — '경금(庚金)' */
export const stemTerm = (chart: SajuChart) => {
  const d = chart.dayMaster;
  return `${d.hangul}${EL_HANGUL[d.element]}(${d.hanja}${EL_HANJA[d.element]})`;
};

/** 십성 무리별 글자 수 */
export function groupCount(chart: SajuChart): Record<TenGodGroup, number> {
  const r: Record<TenGodGroup, number> = { 비겁: 0, 식상: 0, 재성: 0, 관성: 0, 인성: 0 };
  for (const [tg, n] of Object.entries(chart.tenGodCount) as [TenGod, number][]) r[TEN_GOD_GROUP[tg]] += n;
  return r;
}

/** 점수대 — gradeWord 와 같은 기준이라 목록 줄의 등급과 풀이 문장이 어긋나지 않는다 */
export const scoreBand = (n: number): 'high' | 'mid' | 'low' => (n >= 65 ? 'high' : n >= 50 ? 'mid' : 'low');
/** 점수(0~100) → 생활어 등급. low 는 주제마다 다르게(연애: 잔잔함, 재물: 낮음) */
export const gradeWord = (score: number, low: string) => (score >= 80 ? '아주 좋음' : score >= 65 ? '좋음' : score >= 50 ? '보통' : low);

/** 양력 달 → 계절 */
const SEASON: Record<number, string> = { 1: '겨울', 2: '늦겨울', 3: '봄', 4: '봄', 5: '늦봄', 6: '여름', 7: '여름', 8: '늦여름', 9: '가을', 10: '가을', 11: '늦가을', 12: '겨울' };
export const seasonOf = (month: number) => SEASON[month]!;

/** 좋은 달 목록 — 같은 해면 '3월', 다음 해 1월이면 '2029년 1월' */
export const monthsText = (year: number, ms: { year: number; month: number }[]) => ms.map((m) => (m.year === year ? `${m.month}월` : `${m.year}년 ${m.month}월`)).join('과 ');
