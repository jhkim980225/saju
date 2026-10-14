/**
 * 합충형파해(合沖刑破害)·원진 — 천간/지지 상호작용 탐지.
 */
import type { Element } from './constants.js';
import { mod } from './constants.js';

export type PillarPosition = 'year' | 'month' | 'day' | 'hour';
export const POSITION_LABEL: Record<PillarPosition, string> = { year: '년', month: '월', day: '일', hour: '시' };

export type RelationType =
  | '천간합' | '천간충'
  | '육합' | '삼합' | '반합' | '방합'
  | '충' | '형' | '자형' | '파' | '해' | '원진';

export interface Relation {
  type: RelationType;
  /** 천간 관계인지 지지 관계인지 */
  target: 'stem' | 'branch';
  positions: PillarPosition[];
  chars: number[];
  /** 합으로 화(化)하는 오행 */
  element?: Element;
  /** 길(+)/흉(-) 성향 — 해석 가중치용 */
  tone: 'positive' | 'negative' | 'mixed';
  label: string;
}

const STEM_COMBINE: Record<string, Element> = { '0-5': 'earth', '1-6': 'metal', '2-7': 'water', '3-8': 'wood', '4-9': 'fire' };
const SIX_COMBINE: Record<string, Element> = { '0-1': 'earth', '2-11': 'wood', '3-10': 'fire', '4-9': 'metal', '5-8': 'water', '6-7': 'fire' };
const THREE_COMBINE: { branches: [number, number, number]; element: Element }[] = [
  { branches: [8, 0, 4], element: 'water' }, // 申子辰
  { branches: [2, 6, 10], element: 'fire' }, // 寅午戌
  { branches: [5, 9, 1], element: 'metal' }, // 巳酉丑
  { branches: [11, 3, 7], element: 'wood' }, // 亥卯未
];
const DIRECTION_COMBINE: { branches: [number, number, number]; element: Element }[] = [
  { branches: [2, 3, 4], element: 'wood' },
  { branches: [5, 6, 7], element: 'fire' },
  { branches: [8, 9, 10], element: 'metal' },
  { branches: [11, 0, 1], element: 'water' },
];
const PUNISH_GROUPS: [number, number, number][] = [
  [2, 5, 8], // 寅巳申 무은지형
  [1, 10, 7], // 丑戌未 지세지형
];
const SELF_PUNISH = new Set([4, 6, 9, 11]); // 辰午酉亥
const BREAK_PAIRS = new Set(['0-9', '1-4', '2-11', '3-6', '5-8', '7-10']);
const HARM_PAIRS = new Set(['0-7', '1-6', '2-5', '3-4', '8-11', '9-10']);
const WONJIN_PAIRS = new Set(['0-7', '1-6', '2-9', '3-8', '4-11', '5-10']);

const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export function stemCombine(a: number, b: number): Element | null {
  return STEM_COMBINE[key(mod(a, 10), mod(b, 10))] ?? null;
}
export function stemClash(a: number, b: number): boolean {
  const x = mod(a, 10);
  const y = mod(b, 10);
  return Math.abs(x - y) === 6 && Math.min(x, y) <= 3;
}
export function sixCombine(a: number, b: number): Element | null {
  return SIX_COMBINE[key(mod(a, 12), mod(b, 12))] ?? null;
}
export function branchClash(a: number, b: number): boolean {
  return mod(a - b, 12) === 6;
}
export function branchBreak(a: number, b: number): boolean {
  return BREAK_PAIRS.has(key(mod(a, 12), mod(b, 12)));
}
export function branchHarm(a: number, b: number): boolean {
  return HARM_PAIRS.has(key(mod(a, 12), mod(b, 12)));
}
export function branchWonjin(a: number, b: number): boolean {
  return WONJIN_PAIRS.has(key(mod(a, 12), mod(b, 12)));
}
export function branchPunish(a: number, b: number): boolean {
  const x = mod(a, 12);
  const y = mod(b, 12);
  if (x === y) return SELF_PUNISH.has(x);
  if (key(x, y) === '0-3') return true; // 子卯 무례지형
  return PUNISH_GROUPS.some((g) => g.includes(x) && g.includes(y));
}
/** 두 지지가 같은 삼합 국에 속하면 그 오행 */
export function halfCombine(a: number, b: number): Element | null {
  const x = mod(a, 12);
  const y = mod(b, 12);
  if (x === y) return null;
  const g = THREE_COMBINE.find((t) => t.branches.includes(x) && t.branches.includes(y));
  // 반합은 왕지(子午卯酉, 가운데 글자)를 포함해야 성립
  if (!g || !(x === g.branches[1] || y === g.branches[1])) return null;
  return g.element;
}

const EL_KO: Record<Element, string> = { wood: '목', fire: '화', earth: '토', metal: '금', water: '수' };

export interface PositionedPillar {
  position: PillarPosition;
  stem: number;
  branch: number;
}

/** 원국(또는 원국 + 운) 기둥 사이의 모든 관계 탐지 */
export function findRelations(pillars: PositionedPillar[]): Relation[] {
  const out: Relation[] = [];
  for (let i = 0; i < pillars.length; i++) {
    for (let j = i + 1; j < pillars.length; j++) {
      const a = pillars[i]!;
      const b = pillars[j]!;
      const pos: PillarPosition[] = [a.position, b.position];
      const where = `${POSITION_LABEL[a.position]}·${POSITION_LABEL[b.position]}`;

      const sc = stemCombine(a.stem, b.stem);
      if (sc) out.push({ type: '천간합', target: 'stem', positions: pos, chars: [a.stem, b.stem], element: sc, tone: 'positive', label: `${where} 천간합(${EL_KO[sc]})` });
      if (stemClash(a.stem, b.stem)) out.push({ type: '천간충', target: 'stem', positions: pos, chars: [a.stem, b.stem], tone: 'negative', label: `${where} 천간충` });

      const x = a.branch;
      const y = b.branch;
      const six = sixCombine(x, y);
      if (six) out.push({ type: '육합', target: 'branch', positions: pos, chars: [x, y], element: six, tone: 'positive', label: `${where} 육합(${EL_KO[six]})` });
      const half = halfCombine(x, y);
      if (half) out.push({ type: '반합', target: 'branch', positions: pos, chars: [x, y], element: half, tone: 'positive', label: `${where} 반합(${EL_KO[half]})` });
      if (branchClash(x, y)) out.push({ type: '충', target: 'branch', positions: pos, chars: [x, y], tone: 'negative', label: `${where} 충` });
      if (branchPunish(x, y)) {
        const self = mod(x, 12) === mod(y, 12);
        out.push({ type: self ? '자형' : '형', target: 'branch', positions: pos, chars: [x, y], tone: 'negative', label: `${where} ${self ? '자형' : '형'}` });
      }
      if (branchBreak(x, y)) out.push({ type: '파', target: 'branch', positions: pos, chars: [x, y], tone: 'negative', label: `${where} 파` });
      if (branchHarm(x, y)) out.push({ type: '해', target: 'branch', positions: pos, chars: [x, y], tone: 'negative', label: `${where} 해` });
      if (branchWonjin(x, y)) out.push({ type: '원진', target: 'branch', positions: pos, chars: [x, y], tone: 'negative', label: `${where} 원진` });
    }
  }

  // 삼합·방합(세 글자 완성)
  const branchSet = pillars.map((p) => mod(p.branch, 12));
  for (const g of THREE_COMBINE) {
    if (g.branches.every((b) => branchSet.includes(b))) {
      const ps = pillars.filter((p) => g.branches.includes(mod(p.branch, 12)));
      out.push({ type: '삼합', target: 'branch', positions: ps.map((p) => p.position), chars: [...g.branches], element: g.element, tone: 'positive', label: `삼합 ${EL_KO[g.element]}국` });
    }
  }
  for (const g of DIRECTION_COMBINE) {
    if (g.branches.every((b) => branchSet.includes(b))) {
      const ps = pillars.filter((p) => g.branches.includes(mod(p.branch, 12)));
      out.push({ type: '방합', target: 'branch', positions: ps.map((p) => p.position), chars: [...g.branches], element: g.element, tone: 'positive', label: `방합 ${EL_KO[g.element]}국` });
    }
  }
  return out;
}

/** 삼합 그룹의 대표(왕지) — 신살 계산용 */
export function threeCombineGroupOf(branch: number): [number, number, number] {
  const b = mod(branch, 12);
  return THREE_COMBINE.find((g) => g.branches.includes(b))!.branches;
}
