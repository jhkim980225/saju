/**
 * 운세 평가 — 원국 대비 특정 운(일진/월운/세운/대운)의 길흉 점수와 키워드를 계산한다.
 * 결과는 숫자·키워드만 제공하며, 문장 해석은 API 의 콘텐츠 계층이 담당한다.
 */
import type { Element } from './constants.js';
import { BRANCHES, ELEMENT_INFO, STEMS, mainHiddenStem, mod } from './constants.js';
import type { TenGod } from './basics.js';
import { STAGE_ENERGY, TEN_GOD_GROUP } from './basics.js';
import type { SajuChart } from './chart.js';
import type { LuckPillar } from './luck.js';
import { luckPillar } from './luck.js';
import type { PillarPosition, RelationType } from './relations.js';
import { branchBreak, branchClash, branchHarm, branchPunish, branchWonjin, halfCombine, sixCombine, stemClash, stemCombine, threeCombineGroupOf } from './relations.js';
import { gongmangOf } from './shinsal.js';

export type FortuneCategory = 'total' | 'wealth' | 'love' | 'career' | 'health' | 'study';
export type FortuneScores = Record<FortuneCategory, number>;
export type FortuneGrade = 'great' | 'good' | 'normal' | 'caution' | 'bad';

export const GRADE_LABEL: Record<FortuneGrade, string> = { great: '대길', good: '길', normal: '평', caution: '주의', bad: '흉' };

export interface LuckInteraction {
  with: PillarPosition;
  type: RelationType;
  target: 'stem' | 'branch';
  tone: 'positive' | 'negative';
}

export type FortuneHighlight =
  | 'yongsin_stem' | 'yongsin_branch' | 'gisin_stem' | 'gisin_branch'
  | 'stem_combine_day' | 'stem_clash_day' | 'branch_combine_day' | 'branch_clash_day' | 'branch_punish_day' | 'branch_wonjin_day'
  | 'branch_clash_month' | 'dohwa' | 'yeokma' | 'hwagae' | 'cheoneul' | 'munchang' | 'yangin' | 'gongmang';

export interface FortuneEvaluation {
  pillar: LuckPillar;
  scores: FortuneScores;
  grade: FortuneGrade;
  fit: { stem: ElementFit; branch: ElementFit };
  interactions: LuckInteraction[];
  highlights: FortuneHighlight[];
  /** 대표 십신(천간 기준) */
  mainTenGod: TenGod;
  lucky: { element: Element; color: string; number: number; direction: string };
}

export type ElementFit = 'yongsin' | 'heesin' | 'gisin' | 'neutral';

const CHEONEUL: number[][] = [[1, 7], [0, 8], [11, 9], [11, 9], [1, 7], [0, 8], [1, 7], [2, 6], [5, 3], [5, 3]];
const MUNCHANG = [5, 6, 8, 9, 8, 9, 11, 0, 2, 3];
const YANGIN: Record<number, number> = { 0: 3, 2: 6, 4: 6, 6: 9, 8: 0 };

/** 문자열 → 32bit 해시 (결정적 변동치) */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const clamp = (n: number, lo = 10, hi = 98) => Math.max(lo, Math.min(hi, Math.round(n)));

function fitOf(chart: SajuChart, el: Element): ElementFit {
  if (el === chart.yongsin.yongsin) return 'yongsin';
  if (el === chart.yongsin.heesin) return 'heesin';
  if (el === chart.yongsin.gisin) return 'gisin';
  return 'neutral';
}
const FIT_SCORE: Record<ElementFit, number> = { yongsin: 1, heesin: 0.5, gisin: -1, neutral: 0 };

export function gradeOf(score: number): FortuneGrade {
  return score >= 85 ? 'great' : score >= 70 ? 'good' : score >= 50 ? 'normal' : score >= 35 ? 'caution' : 'bad';
}

/**
 * @param seed 동일 운이라도 사용자/날짜별로 미세한 변동을 주기 위한 값(결정적)
 */
export function evaluateFortune(chart: SajuChart, target: { stem: number; branch: number }, seed = ''): FortuneEvaluation {
  const ds = chart.dayMaster.index;
  const pillar = luckPillar(target.stem, target.branch, ds);
  const stemEl = STEMS[pillar.stem]!.element;
  const branchEl = STEMS[mainHiddenStem(pillar.branch)]!.element;
  const fit = { stem: fitOf(chart, stemEl), branch: fitOf(chart, branchEl) };

  const natal: { position: PillarPosition; stem: number; branch: number }[] = [];
  for (const p of [chart.pillars.year, chart.pillars.month, chart.pillars.day, chart.pillars.hour]) {
    if (p) natal.push({ position: p.position, stem: p.stem.index, branch: p.branch.index });
  }

  const interactions: LuckInteraction[] = [];
  for (const n of natal) {
    if (stemCombine(pillar.stem, n.stem)) interactions.push({ with: n.position, type: '천간합', target: 'stem', tone: 'positive' });
    if (stemClash(pillar.stem, n.stem)) interactions.push({ with: n.position, type: '천간충', target: 'stem', tone: 'negative' });
    if (sixCombine(pillar.branch, n.branch)) interactions.push({ with: n.position, type: '육합', target: 'branch', tone: 'positive' });
    if (halfCombine(pillar.branch, n.branch)) interactions.push({ with: n.position, type: '반합', target: 'branch', tone: 'positive' });
    if (branchClash(pillar.branch, n.branch)) interactions.push({ with: n.position, type: '충', target: 'branch', tone: 'negative' });
    if (branchPunish(pillar.branch, n.branch)) interactions.push({ with: n.position, type: pillar.branch === n.branch ? '자형' : '형', target: 'branch', tone: 'negative' });
    if (branchBreak(pillar.branch, n.branch)) interactions.push({ with: n.position, type: '파', target: 'branch', tone: 'negative' });
    if (branchHarm(pillar.branch, n.branch)) interactions.push({ with: n.position, type: '해', target: 'branch', tone: 'negative' });
    if (branchWonjin(pillar.branch, n.branch)) interactions.push({ with: n.position, type: '원진', target: 'branch', tone: 'negative' });
  }

  const REL_WEIGHT: Partial<Record<RelationType, number>> = { 천간합: 5, 천간충: -6, 육합: 6, 반합: 4, 충: -10, 형: -6, 자형: -4, 파: -3, 해: -3, 원진: -5 };
  let base = 55 + FIT_SCORE[fit.stem] * 12 + FIT_SCORE[fit.branch] * 10 + (STAGE_ENERGY[pillar.twelveStage] - 6) * 1.5;
  for (const it of interactions) {
    const w = REL_WEIGHT[it.type] ?? 0;
    base += it.with === 'day' ? w : w / 2;
  }

  // 신살 하이라이트
  const highlights: FortuneHighlight[] = [];
  if (fit.stem === 'yongsin') highlights.push('yongsin_stem');
  if (fit.branch === 'yongsin') highlights.push('yongsin_branch');
  if (fit.stem === 'gisin') highlights.push('gisin_stem');
  if (fit.branch === 'gisin') highlights.push('gisin_branch');
  const dayRel = (t: RelationType) => interactions.some((i) => i.with === 'day' && i.type === t);
  if (dayRel('천간합')) highlights.push('stem_combine_day');
  if (dayRel('천간충')) highlights.push('stem_clash_day');
  if (dayRel('육합') || dayRel('반합')) highlights.push('branch_combine_day');
  if (dayRel('충')) highlights.push('branch_clash_day');
  if (dayRel('형') || dayRel('자형')) highlights.push('branch_punish_day');
  if (dayRel('원진')) highlights.push('branch_wonjin_day');
  if (interactions.some((i) => i.with === 'month' && i.type === '충')) highlights.push('branch_clash_month');

  const yb = chart.pillars.year.branch.index;
  const db = chart.pillars.day.branch.index;
  const special = (fn: (g: [number, number, number]) => number) => [yb, db].some((b) => fn(threeCombineGroupOf(b)) === pillar.branch);
  const isDohwa = special((g) => mod(g[1] + 9, 12));
  const isYeokma = special((g) => mod(g[0] + 6, 12));
  const isHwagae = special((g) => g[2]);
  if (isDohwa) highlights.push('dohwa');
  if (isYeokma) highlights.push('yeokma');
  if (isHwagae) highlights.push('hwagae');
  if (CHEONEUL[ds]!.includes(pillar.branch)) {
    highlights.push('cheoneul');
    base += 6;
  }
  const isMunchang = MUNCHANG[ds] === pillar.branch;
  if (isMunchang) highlights.push('munchang');
  if (YANGIN[ds] === pillar.branch) highlights.push('yangin');
  const gm = gongmangOf(ds, db);
  if (gm.includes(pillar.branch)) {
    highlights.push('gongmang');
    base -= 4;
  }

  // 카테고리별 보정
  const tg = [pillar.stemTenGod, pillar.branchTenGod];
  const groups = tg.map((t) => TEN_GOD_GROUP[t]);
  const count = (g: string) => groups.filter((x) => x === g).length;
  const has = (t: TenGod) => tg.includes(t);
  const male = chart.input.gender === 'male';
  const weak = chart.strength.score < 42;
  const natalHasJeonggwan = chart.tenGodCount.정관 > 0;
  const negDay = interactions.filter((i) => i.with === 'day' && i.tone === 'negative').length;
  const negMonth = interactions.filter((i) => i.with === 'month' && i.tone === 'negative').length;

  const wealth = base + count('재성') * (weak ? 5 : 10) + count('식상') * 5 - count('비겁') * 6 - (has('겁재') ? 3 : 0) - count('인성') * 2;
  let love = base + (male ? count('재성') * 10 + (has('정재') ? 2 : 0) - count('비겁') * 4 : count('관성') * 10 + (has('정관') ? 2 : 0) - (has('상관') ? 4 : 0));
  if (isDohwa) love += 8;
  if (dayRel('육합') || dayRel('반합')) love += 6;
  if (dayRel('충')) love -= 8;
  const career = base + count('관성') * 9 + (has('정관') ? 3 : 0) + count('인성') * 6 + (has('식신') ? 4 : 0) - (has('상관') && natalHasJeonggwan ? 6 : 0) + (isYeokma ? 3 : 0);
  const health = 55 + (STAGE_ENERGY[pillar.twelveStage] - 6) * 3 - negDay * 6 - negMonth * 4 - (fit.stem === 'gisin' ? 4 : 0) - (fit.branch === 'gisin' ? 4 : 0) + (fit.stem === 'yongsin' ? 4 : 0);
  const study = base + count('인성') * 10 + (has('식신') ? 6 : 0) + (has('상관') ? 3 : 0) + (isMunchang ? 8 : 0) - count('재성') * 4;

  const h = hashSeed(`${seed}|${pillar.ganzhi.index}|${ds}`);
  const jitter = (k: number) => (((h >>> (k * 3)) & 7) - 3); // -3 ~ +4
  const scores: FortuneScores = {
    total: clamp(base + jitter(0)),
    wealth: clamp(wealth + jitter(1)),
    love: clamp(love + jitter(2)),
    career: clamp(career + jitter(3)),
    health: clamp(health + jitter(4)),
    study: clamp(study + jitter(5)),
  };

  const el = chart.yongsin.yongsin;
  const info = ELEMENT_INFO[el];
  return {
    pillar,
    scores,
    grade: gradeOf(scores.total),
    fit,
    interactions,
    highlights,
    mainTenGod: pillar.stemTenGod,
    lucky: { element: el, color: info.color, number: info.numbers[h % 2]!, direction: info.direction },
  };
}

export function branchAnimal(branch: number): string {
  return BRANCHES[mod(branch, 12)]!.animal;
}
