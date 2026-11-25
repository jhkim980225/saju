/**
 * 여러 화면·보고서가 함께 쓰는 판정 — 한 곳에서 계산해 같은 사람에게 같은 결론을 보여 준다.
 * - 가장 큰 십성 무리: 사주분석서·재물·직업운·연애·결혼운·궁합 리포트가 같은 기준(자리별 가중 세력)을 쓴다.
 * - 대운 평가: 기본 풀이·사주분석서·신년운세·주제 리포트가 같은 점수와 등급을 쓴다.
 * - 그해 한 줄 제목: 내 사주·신년운세·사주분석서가 같은 시드로 고른다.
 * - 십성의 쉬운 이름: 화면 표(packages/shared TEN_GOD_PLAIN_LABEL)와 같은 라벨을 쓴다.
 * - 가장 많은 십성(글자 수): 같은 수면 모두 — 내 사주 화면과 사주분석서가 같은 목록을 쓴다.
 * - 원국의 신살 목록: 이름으로 한 번씩, 정한 순서대로 — 무료 풀이·사주분석서·주제 리포트가 같은 목록을 쓴다.
 * - 재물·직업운의 한 해 판정(넓히기·보통·다지기): 10년 목록과 가까운 3년 풀이가 같은 판정을 쓴다.
 */
import { TEN_GOD_GROUP, evaluateFortune, yearPillarOf, type DaeunPeriod, type ShinsalName, type FortuneEvaluation, type FortuneGrade, type SajuChart, type TenGod, type TenGodGroup } from '@saju/core';
import { GRADE_PLAIN_LABEL, TEN_GOD_PLAIN_LABEL } from '@saju/shared';
import { SHINSAL_ORDER } from './content/plain.js';
import { TEN_GOD_PLAIN } from './content/tenGods.js';
import { prt, ro } from './topicReportKit.js';

const ORDER: TenGodGroup[] = ['비겁', '식상', '재성', '관성', '인성'];

/** 십성 무리별 글자 수(일간 제외, 지지는 본기 기준) */
export function tenGodGroupCount(chart: SajuChart): Record<TenGodGroup, number> {
  const r: Record<TenGodGroup, number> = { 비겁: 0, 식상: 0, 재성: 0, 관성: 0, 인성: 0 };
  for (const [tg, n] of Object.entries(chart.tenGodCount) as [TenGod, number][]) r[TEN_GOD_GROUP[tg]] += n;
  return r;
}

/**
 * 십성 무리의 순위 — 자리별 가중 세력(strength.groupScore, 달달사주 기준: 월지·일지에 무게를 더 둔다) 순.
 * 세력이 같으면 글자 수, 그다음 비겁·식상·재성·관성·인성 순서. 모든 보고서가 '가장 큰 무리'를 이 함수로 정한다.
 */
export function rankTenGodGroups(chart: SajuChart): TenGodGroup[] {
  const gs = chart.strength.groupScore;
  const n = tenGodGroupCount(chart);
  return [...ORDER].sort((a, b) => gs[b] - gs[a] || n[b] - n[a] || ORDER.indexOf(a) - ORDER.indexOf(b));
}
/** 가장 큰 십성 무리 */
export const dominantGroup = (chart: SajuChart): TenGodGroup => rankTenGodGroups(chart)[0]!;
/** 무리별 세력 비율(%) — 근거 표기용 */
export function groupShare(chart: SajuChart): Record<TenGodGroup, number> {
  const gs = chart.strength.groupScore;
  const total = ORDER.reduce((s, k) => s + gs[k], 0) || 1;
  return Object.fromEntries(ORDER.map((k) => [k, Math.round((gs[k] / total) * 100)])) as Record<TenGodGroup, number>;
}

/** 십성 + 화면 라벨 — '편인(탐구·직관)' */
export const tgLabel = (tg: TenGod) => `${tg}(${TEN_GOD_PLAIN_LABEL[tg]})`;

/** 대운 평가 — 모든 화면이 같은 값을 쓰도록 시드 없이 한 가지로 계산한다 */
export const daeunEval = (chart: SajuChart, p: DaeunPeriod): FortuneEvaluation => evaluateFortune(chart, p);
/** 등급이 '조심'·'쉬어 갈 때'인가 — 본문을 주의 쪽 문구로 고르는 기준 */
export const isLowGrade = (g: FortuneGrade) => g === 'caution' || g === 'bad';
const RANK: Record<FortuneGrade, number> = { bad: 0, caution: 1, normal: 2, good: 3, great: 4 };

/** 등급 이름 + '(으)로' — "'보통'으로", "'쉬어 갈 때'로" */
const gradeRo = (g: FortuneGrade) => `'${GRADE_PLAIN_LABEL[g]}'${ro(GRADE_PLAIN_LABEL[g]).slice(GRADE_PLAIN_LABEL[g].length)}`;

/** 대운 한 줄 판정 — 등급(달달사주 기준)에 맞춘 말 */
const VERDICT_TAIL: Record<'up' | 'even' | 'low', [string, string, string]> = {
  up: ['준비한 일을 넓혀 가기 좋은 시기예요', '계획한 일을 펼치기 좋은 시기예요', '앞 시기의 노력이 성과로 이어지기 좋은 시기예요'],
  even: ['큰 기복 없이 흐름이 이어지는 시기예요', '흐름이 크게 오르내리지 않는 시기예요', '평소의 계획을 그대로 이어 가기 좋은 시기예요'],
  low: ['넓히기보다 다지는 데 무게를 둘 시기예요', '속도를 늦추고 기반을 지키는 데 힘을 쓸 시기예요', '무리한 확장은 미루고 생활의 기본을 지킬 시기예요'],
};
/** 대운 한 줄 판정 — 등급(달달사주 기준)에 맞춘 말. n 은 한 장에서 몇 번째 판정인지(같은 문장이 되풀이되지 않게) */
export function daeunVerdict(ev: FortuneEvaluation, n = 0): string {
  const g = ev.grade;
  const kind = g === 'great' || g === 'good' ? 'up' : g === 'normal' ? 'even' : 'low';
  return `달달사주 기준 등급은 ${gradeRo(g)}, ${VERDICT_TAIL[kind][n % 3]}.`;
}

/**
 * 앞 대운과 천간의 십성 무리가 같을 때 — 성격은 이어지지만 등급이 달라질 수 있음을 함께 말한다.
 * n 은 한 장에서 몇 번째 문장인지(같은 꼬리 문장이 되풀이되지 않게 번갈아 쓴다)
 */
export function daeunContinues(prev: DaeunPeriod, prevEv: FortuneEvaluation, cur: DaeunPeriod, curEv: FortuneEvaluation, n = 1): string {
  const group = TEN_GOD_GROUP[cur.stemTenGod];
  const head = `대운의 천간이 ${tgLabel(cur.stemTenGod)}${ro(cur.stemTenGod).slice(cur.stemTenGod.length)}, 앞 대운의 ${prev.stemTenGod}${prt(prev.stemTenGod, '과', '와')} 같은 ${group} 무리라 비슷한 성격의 흐름이 이어져요.`;
  const d = RANK[curEv.grade] - RANK[prevEv.grade];
  const g = curEv.grade;
  const kind = g === 'great' || g === 'good' ? 'up' : g === 'normal' ? 'even' : 'low';
  if (d < 0) return `${head} 다만 달달사주 기준 등급은 ${gradeRo(g)} 낮아져, ${VERDICT_TAIL[kind][n % 3]}.`;
  if (d > 0) return `${head} 달달사주 기준 등급은 ${gradeRo(g)} 올라, ${VERDICT_TAIL[kind][n % 3]}.`;
  return `${head} 달달사주 기준 등급도 ${gradeRo(g)} 같아, ${VERDICT_TAIL[kind][n % 3]}.`;
}

/**
 * 그해 한 줄 제목 — 내 사주·신년운세·신년운세 리포트·사주분석서가 같은 제목을 쓴다.
 * 그해 천간의 십성과 등급(좋음 이상 / 보통 / 조심 이하)으로 정해, 본문(십성 풀이)과 같은 주제가 되게 한다.
 */
export function yearHeadline(chart: SajuChart, year: number, grade: FortuneGrade): string {
  const tg = evaluateFortune(chart, yearPillarOf(year), `year-${year}`).pillar.stemTenGod;
  const t = TEN_GOD_PLAIN[tg].yearTitle;
  return grade === 'great' || grade === 'good' ? t.up : isLowGrade(grade) ? t.low : t.flat;
}

/** 가장 많은 십성(글자 수) — 같은 수면 모두. 하나도 없으면 빈 목록 */
export function topTenGods(chart: SajuChart): TenGod[] {
  const present = (Object.entries(chart.tenGodCount) as [TenGod, number][]).filter(([, n]) => n > 0);
  const max = Math.max(0, ...present.map(([, n]) => n));
  return present.filter(([, n]) => n === max).map(([tg]) => tg);
}

/** 원국의 신살 — 이름으로 한 번씩, SHINSAL_ORDER 순서. 모든 화면이 이 목록에서 고른다 */
export function natalShinsal(chart: SajuChart): ShinsalName[] {
  const names = [...new Set(chart.shinsal.map((s) => s.name))];
  return names.sort((a, b) => SHINSAL_ORDER.indexOf(a) - SHINSAL_ORDER.indexOf(b));
}

/** 재물·직업운의 한 해 판정 — 넓히기(둘 중 하나가 '좋음' 이상, 다른 하나가 '낮음' 아님) · 다지기(둘 다 '낮음') · 그 밖은 보통 */
export type CareerYearMode = 'expand' | 'steady' | 'consolidate';
export function careerYearMode(wealth: number, career: number): CareerYearMode {
  if ((wealth >= 65 || career >= 65) && wealth >= 50 && career >= 50) return 'expand';
  if (wealth < 50 && career < 50) return 'consolidate';
  return 'steady';
}

/**
 * 희신이 이미 사주에서 가장 강한 오행일 때의 단서 — 희신을 더 보태라고 권하지 않게 한 문장을 붙인다.
 */
export function heesinCaveat(chart: SajuChart): string | null {
  const y = chart.yongsin;
  if (y.heesin !== chart.elements.dominant) return null;
  const name = { wood: '목', fire: '화', earth: '토', metal: '금', water: '수' }[y.heesin];
  return `다만 ${name}${prt(name, '은', '는')} 이미 사주에서 가장 강한 오행이라, 희신이라도 일부러 더 보탤 필요는 크지 않아요.`;
}

/** 원국에 삼합·방합이 있을 때 — 강약 점수에 합의 작용을 어떻게 반영했는지 밝힌다 (saju-core analyzeStrength 의 COMBINE_PULL) */
export function strengthCaveat(chart: SajuChart): string | null {
  const r = chart.relations.find((x) => x.type === '삼합' || x.type === '방합');
  if (!r) return null;
  const name = r.element ? { wood: '목', fire: '화', earth: '토', metal: '금', water: '수' }[r.element] : null;
  return `원국에 ${r.type}${name ? `(${name} 기운)` : ''}이 있어요. 달달사주의 강약 점수는 합으로 묶인 지지의 기운이 ${name ? `${name} 기운` : '그 오행'} 쪽으로 기우는 작용을 반영해 계산했어요(묶인 지지의 본래 기운과 합의 기운을 반씩 셈).`;
}
