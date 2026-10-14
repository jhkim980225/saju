/**
 * 오행 분포, 신강·신약(일간 강약), 간이 용신(억부법).
 */
import type { Element } from './constants.js';
import { BRANCHES, ELEMENTS, HIDDEN_STEMS, STEMS, controlledBy, generatedBy, mod } from './constants.js';
import type { TenGodGroup } from './basics.js';
import { TEN_GOD_GROUPS, elementOfGroup } from './basics.js';
import type { PillarPosition, PositionedPillar } from './relations.js';

export type ElementRecord = Record<Element, number>;
const zero = (): ElementRecord => ({ wood: 0, fire: 0, earth: 0, metal: 0, water: 0 });

export interface ElementAnalysis {
  /** 글자 수 기준(천간 4 + 지지 4, 시주 모르면 6글자) */
  count: ElementRecord;
  /** 지장간·월령 가중 점수 */
  score: ElementRecord;
  /** score 기반 백분율(합 100) */
  percent: ElementRecord;
  /** 과다(30% 이상) */
  excess: Element[];
  /** 부족(글자 0개) */
  lacking: Element[];
  dominant: Element;
  weakest: Element;
}

/** 지지 1글자의 오행 비중(지장간 일수 비율) */
function branchElementShare(branch: number): ElementRecord {
  const rec = zero();
  for (const h of HIDDEN_STEMS[mod(branch, 12)]!) rec[STEMS[h.stem]!.element] += h.days / 30;
  return rec;
}

export function analyzeElements(pillars: PositionedPillar[]): ElementAnalysis {
  const count = zero();
  const score = zero();
  for (const p of pillars) {
    count[STEMS[mod(p.stem, 10)]!.element] += 1;
    count[BRANCHES[mod(p.branch, 12)]!.element] += 1;
    score[STEMS[mod(p.stem, 10)]!.element] += 1;
    // 지지는 지장간 비율로 분배, 월지는 계절(월령) 영향이 커서 1.5배
    const w = p.position === 'month' ? 1.5 : 1;
    const share = branchElementShare(p.branch);
    for (const e of ELEMENTS) score[e] += share[e] * w;
  }
  const total = ELEMENTS.reduce((s, e) => s + score[e], 0);
  const percent = zero();
  let acc = 0;
  ELEMENTS.forEach((e, i) => {
    if (i === ELEMENTS.length - 1) {
      percent[e] = Math.max(0, 100 - acc);
    } else {
      percent[e] = Math.round((score[e] / total) * 100);
      acc += percent[e];
    }
  });
  for (const e of ELEMENTS) score[e] = Math.round(score[e] * 100) / 100;
  const sorted = [...ELEMENTS].sort((a, b) => score[b] - score[a]);
  return {
    count,
    score,
    percent,
    excess: ELEMENTS.filter((e) => percent[e] >= 30),
    lacking: ELEMENTS.filter((e) => count[e] === 0),
    dominant: sorted[0]!,
    weakest: sorted[sorted.length - 1]!,
  };
}

export type StrengthLevel = '극신약' | '신약' | '중화' | '신강' | '극신강';

export interface StrengthAnalysis {
  /** 일간을 돕는 기운의 비율(0~100) */
  score: number;
  level: StrengthLevel;
  /** 월지가 일간을 돕는가(득령) */
  deukryeong: boolean;
  /** 일지가 일간을 돕는가(득지) */
  deukji: boolean;
  /** 천간·기타 지지에서 돕는 세력이 과반인가(득세) */
  deukse: boolean;
  /** 십신 그룹별 세력(가중치 합) */
  groupScore: Record<TenGodGroup, number>;
}

const POSITION_WEIGHT: Record<PillarPosition, { stem: number; branch: number }> = {
  year: { stem: 10, branch: 10 },
  month: { stem: 10, branch: 30 },
  day: { stem: 0, branch: 15 },
  hour: { stem: 10, branch: 15 },
};

function groupOfElement(dayElement: Element, e: Element): TenGodGroup {
  const rel = mod(ELEMENTS.indexOf(e) - ELEMENTS.indexOf(dayElement), 5);
  return TEN_GOD_GROUPS[rel]!;
}

export function analyzeStrength(pillars: PositionedPillar[]): StrengthAnalysis {
  const day = pillars.find((p) => p.position === 'day')!;
  const dayEl = STEMS[mod(day.stem, 10)]!.element;
  const groupScore: Record<TenGodGroup, number> = { 비겁: 0, 식상: 0, 재성: 0, 관성: 0, 인성: 0 };
  let total = 0;
  let support = 0;
  let deukryeong = false;
  let deukji = false;
  let otherSupport = 0;
  let otherTotal = 0;

  for (const p of pillars) {
    const w = POSITION_WEIGHT[p.position];
    if (w.stem > 0) {
      const g = groupOfElement(dayEl, STEMS[mod(p.stem, 10)]!.element);
      groupScore[g] += w.stem;
      total += w.stem;
      const sup = g === '비겁' || g === '인성' ? w.stem : 0;
      support += sup;
      otherSupport += sup;
      otherTotal += w.stem;
    }
    const share = branchElementShare(p.branch);
    let branchSupport = 0;
    for (const e of ELEMENTS) {
      const g = groupOfElement(dayEl, e);
      groupScore[g] += share[e] * w.branch;
      if (g === '비겁' || g === '인성') branchSupport += share[e];
    }
    total += w.branch;
    support += branchSupport * w.branch;
    if (p.position === 'month') deukryeong = branchSupport >= 0.5;
    else if (p.position === 'day') deukji = branchSupport >= 0.5;
    else {
      otherSupport += branchSupport * w.branch;
      otherTotal += w.branch;
    }
  }

  const score = Math.round((support / total) * 100);
  const level: StrengthLevel = score < 25 ? '극신약' : score < 42 ? '신약' : score <= 58 ? '중화' : score <= 75 ? '신강' : '극신강';
  for (const g of TEN_GOD_GROUPS) groupScore[g] = Math.round(groupScore[g] * 10) / 10;
  return { score, level, deukryeong, deukji, deukse: otherTotal > 0 && otherSupport / otherTotal >= 0.5, groupScore };
}

export interface YongsinAnalysis {
  /** 용신 — 사주 균형에 가장 필요한 오행 */
  yongsin: Element;
  /** 희신 — 용신을 돕는 오행 */
  heesin: Element;
  /** 기신 — 용신을 해치는 오행 */
  gisin: Element;
  method: '억부' | '중화';
  reason: string;
}

const EL_KO: Record<Element, string> = { wood: '목(木)', fire: '화(火)', earth: '토(土)', metal: '금(金)', water: '수(水)' };

/**
 * 간이 억부용신. 조후·통관·병약 등은 고려하지 않는 참고용 판단이다.
 */
export function determineYongsin(dayStem: number, strength: StrengthAnalysis, elements: ElementAnalysis): YongsinAnalysis {
  const g = strength.groupScore;
  const el = (group: TenGodGroup) => elementOfGroup(dayStem, group);
  let yongsin: Element;
  let method: YongsinAnalysis['method'] = '억부';
  let reason: string;

  if (strength.score > 58) {
    if (g.인성 > g.비겁) {
      yongsin = el('재성');
      reason = `일간이 강하고 인성(${EL_KO[el('인성')]})이 많아, 인성을 제어하는 재성 ${EL_KO[yongsin]}이 균형을 잡아줍니다.`;
    } else if (g.관성 >= g.식상 * 0.6) {
      yongsin = el('관성');
      reason = `일간이 강하고 비겁이 많아, 비겁을 다스리는 관성 ${EL_KO[yongsin]}이 균형을 잡아줍니다.`;
    } else {
      yongsin = el('식상');
      reason = `일간이 강해 넘치는 기운을 밖으로 풀어주는 식상 ${EL_KO[yongsin]}이 필요합니다.`;
    }
  } else if (strength.score < 42) {
    if (g.재성 > g.관성 && g.재성 > g.식상) {
      yongsin = el('비겁');
      reason = `일간이 약하고 재성이 많아, 일간과 같은 기운인 비겁 ${EL_KO[yongsin]}이 힘이 되어줍니다.`;
    } else {
      yongsin = el('인성');
      reason = `일간이 약해, 일간을 생해주는 인성 ${EL_KO[yongsin]}이 가장 큰 힘이 되어줍니다.`;
    }
  } else {
    method = '중화';
    yongsin = elements.weakest;
    reason = `일간의 강약이 고른 편이라, 상대적으로 가장 약한 ${EL_KO[yongsin]} 기운을 보충하면 좋습니다.`;
  }
  return { yongsin, heesin: generatedBy(yongsin), gisin: controlledBy(yongsin), method, reason };
}
