/**
 * 신살(神煞) — 자주 쓰이는 길신·흉살 위주로 계산한다.
 * 기준(일간/년지/일지)은 한국 명리 실무에서 가장 보편적인 방식을 따른다.
 */
import { ganzhiIndex, mod } from './constants.js';
import type { PillarPosition, PositionedPillar } from './relations.js';
import { branchWonjin, threeCombineGroupOf } from './relations.js';

export type ShinsalName =
  | '천을귀인' | '문창귀인' | '천덕귀인' | '월덕귀인' | '학당귀인'
  | '도화살' | '역마살' | '화개살' | '홍염살'
  | '양인살' | '괴강살' | '백호살' | '귀문관살' | '원진살' | '현침살' | '공망';

export interface Shinsal {
  name: ShinsalName;
  positions: PillarPosition[];
  kind: 'good' | 'bad' | 'neutral';
  /** 기준이 된 글자 설명 */
  basis: string;
}

export const SHINSAL_KIND: Record<ShinsalName, Shinsal['kind']> = {
  천을귀인: 'good', 문창귀인: 'good', 천덕귀인: 'good', 월덕귀인: 'good', 학당귀인: 'good',
  도화살: 'neutral', 역마살: 'neutral', 화개살: 'neutral', 홍염살: 'neutral',
  양인살: 'bad', 괴강살: 'neutral', 백호살: 'bad', 귀문관살: 'bad', 원진살: 'bad', 현침살: 'neutral', 공망: 'bad',
};

/** 천을귀인 — 일간 기준 */
const CHEONEUL: number[][] = [[1, 7], [0, 8], [11, 9], [11, 9], [1, 7], [0, 8], [1, 7], [2, 6], [5, 3], [5, 3]];
/** 문창귀인 — 일간 기준 */
const MUNCHANG = [5, 6, 8, 9, 8, 9, 11, 0, 2, 3];
/** 학당귀인 — 일간의 장생지 */
const HAKDANG = [11, 6, 2, 9, 2, 9, 5, 0, 8, 3];
/** 양인 — 양간만 (甲卯 丙午 戊午 庚酉 壬子) */
const YANGIN: Record<number, number> = { 0: 3, 2: 6, 4: 6, 6: 9, 8: 0 };
/** 홍염 — 일간 기준 */
const HONGYEOM = [6, 6, 2, 7, 4, 4, 10, 9, 0, 8];
/** 천덕귀인 — 월지 기준 (천간 또는 지지). 값: ['s', stem] | ['b', branch] */
const CHEONDEOK: [('s' | 'b'), number][] = [
  ['b', 5], ['s', 6], ['s', 3], ['b', 8], ['s', 8], ['s', 7], ['b', 11], ['s', 0], ['s', 9], ['b', 2], ['s', 2], ['s', 1],
];
/** 월덕귀인 — 월지 삼합 기준 천간: 寅午戌→丙, 申子辰→壬, 亥卯未→甲, 巳酉丑→庚 */
function woldeokStem(monthBranch: number): number {
  const g = threeCombineGroupOf(monthBranch);
  return { 6: 2, 0: 8, 3: 0, 9: 6 }[g[1]]!;
}
const GOEGANG = new Set([ganzhiIndex(6, 4), ganzhiIndex(6, 10), ganzhiIndex(8, 4), ganzhiIndex(8, 10), ganzhiIndex(4, 10)]);
const BAEKHO = new Set([
  ganzhiIndex(0, 4), ganzhiIndex(1, 7), ganzhiIndex(2, 10), ganzhiIndex(3, 1), ganzhiIndex(4, 4), ganzhiIndex(8, 10), ganzhiIndex(9, 1),
]);
const GWIMUN = new Set(['0-9', '1-6', '2-7', '3-8', '4-11', '5-10']);
/** 현침 글자: 甲 辛 卯 午 申 */
const HYEONCHIM_STEMS = new Set([0, 7]);
const HYEONCHIM_BRANCHES = new Set([3, 6, 8]);

const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** 일주 기준 공망 지지 2개 */
export function gongmangOf(dayStem: number, dayBranch: number): [number, number] {
  const idx = ganzhiIndex(dayStem, dayBranch);
  const xunStartBranch = mod(idx - (idx % 10), 12);
  return [mod(xunStartBranch + 10, 12), mod(xunStartBranch + 11, 12)];
}

export function findShinsal(pillars: PositionedPillar[]): Shinsal[] {
  const day = pillars.find((p) => p.position === 'day');
  const year = pillars.find((p) => p.position === 'year');
  const month = pillars.find((p) => p.position === 'month');
  if (!day || !year || !month) return [];
  const ds = mod(day.stem, 10);
  const result = new Map<string, Shinsal>();
  const add = (name: ShinsalName, position: PillarPosition, basis: string) => {
    const k = `${name}|${basis}`;
    const ex = result.get(k);
    if (ex) {
      if (!ex.positions.includes(position)) ex.positions.push(position);
    } else {
      result.set(k, { name, positions: [position], kind: SHINSAL_KIND[name], basis });
    }
  };

  for (const p of pillars) {
    const b = mod(p.branch, 12);
    if (CHEONEUL[ds]!.includes(b)) add('천을귀인', p.position, '일간');
    if (MUNCHANG[ds] === b) add('문창귀인', p.position, '일간');
    if (HAKDANG[ds] === b) add('학당귀인', p.position, '일간');
    if (YANGIN[ds] === b) add('양인살', p.position, '일간');
    if (HONGYEOM[ds] === b) add('홍염살', p.position, '일간');

    // 도화·역마·화개 — 년지/일지 삼합 기준
    for (const [basisLabel, base] of [['년지', year.branch], ['일지', day.branch]] as const) {
      if (p.position === (basisLabel === '년지' ? 'year' : 'day')) continue;
      const g = threeCombineGroupOf(base);
      const wang = g[1];
      const dohwa = mod(wang + 9, 12); // 子→酉, 午→卯, 卯→子, 酉→午
      const yeokma = mod(g[0] + 6, 12); // 申→寅, 寅→申, 亥→巳, 巳→亥
      const hwagae = g[2]; // 辰, 戌, 未, 丑
      if (b === dohwa) add('도화살', p.position, basisLabel);
      if (b === yeokma) add('역마살', p.position, basisLabel);
      if (b === hwagae) add('화개살', p.position, basisLabel);
    }

    // 천덕·월덕 — 월지 기준
    const cd = CHEONDEOK[mod(month.branch, 12)]!;
    if ((cd[0] === 's' && mod(p.stem, 10) === cd[1]) || (cd[0] === 'b' && b === cd[1])) add('천덕귀인', p.position, '월지');
    if (mod(p.stem, 10) === woldeokStem(month.branch)) add('월덕귀인', p.position, '월지');

    // 백호 — 기둥 단위
    if (BAEKHO.has(ganzhiIndex(p.stem, p.branch))) add('백호살', p.position, '기둥');
    // 현침
    if (HYEONCHIM_STEMS.has(mod(p.stem, 10)) || HYEONCHIM_BRANCHES.has(b)) add('현침살', p.position, '글자');
  }

  if (GOEGANG.has(ganzhiIndex(day.stem, day.branch))) add('괴강살', 'day', '일주');

  // 공망 — 일주 기준
  const [g1, g2] = gongmangOf(day.stem, day.branch);
  for (const p of pillars) {
    if (p.position === 'day') continue;
    const b = mod(p.branch, 12);
    if (b === g1 || b === g2) add('공망', p.position, '일주');
  }

  // 원진·귀문 — 일지와 다른 지지
  for (const p of pillars) {
    if (p.position === 'day') continue;
    if (branchWonjin(day.branch, p.branch)) add('원진살', p.position, '일지');
    if (GWIMUN.has(pairKey(mod(day.branch, 12), mod(p.branch, 12)))) add('귀문관살', p.position, '일지');
  }

  return [...result.values()];
}
