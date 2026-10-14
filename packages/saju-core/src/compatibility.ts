/**
 * 궁합(宮合) — 두 사람의 원국을 비교해 점수와 근거(factor)를 산출한다.
 * 일간 관계 · 일지(배우자궁) 관계 · 띠 관계 · 오행 보완 · 용신 보완 · 배우자성.
 */
import type { Element } from './constants.js';
import { ELEMENTS, mod } from './constants.js';
import { tenGodOf } from './basics.js';
import type { SajuChart } from './chart.js';
import { branchBreak, branchClash, branchHarm, branchPunish, branchWonjin, halfCombine, sixCombine, stemClash, stemCombine } from './relations.js';

export type CompatibilityCategory = 'personality' | 'romance' | 'stability' | 'complement';

export interface CompatibilityFactor {
  key: string;
  category: CompatibilityCategory;
  tone: 'positive' | 'negative' | 'neutral';
  weight: number;
  label: string;
}

export interface CompatibilityResult {
  score: number;
  grade: 'excellent' | 'good' | 'normal' | 'effort';
  categories: Record<CompatibilityCategory, number>;
  factors: CompatibilityFactor[];
}

const EL_KO: Record<Element, string> = { wood: '목', fire: '화', earth: '토', metal: '금', water: '수' };

export function calculateCompatibility(a: SajuChart, b: SajuChart): CompatibilityResult {
  const factors: CompatibilityFactor[] = [];
  const add = (f: CompatibilityFactor) => factors.push(f);

  // 1) 일간 관계
  const as = a.dayMaster.index;
  const bs = b.dayMaster.index;
  const ae = a.dayMaster.element;
  const be = b.dayMaster.element;
  const rel = mod(ELEMENTS.indexOf(be) - ELEMENTS.indexOf(ae), 5);
  const combine = stemCombine(as, bs);
  if (combine) add({ key: 'stem_combine', category: 'personality', tone: 'positive', weight: 15, label: `두 사람의 일간이 합(${EL_KO[combine]})을 이뤄 자연스럽게 끌리는 관계예요.` });
  else if (stemClash(as, bs)) add({ key: 'stem_clash', category: 'personality', tone: 'negative', weight: -10, label: '일간이 서로 부딪히는 충 관계라 의견 차이가 생기기 쉬워요.' });
  if (rel === 0) add({ key: 'stem_same', category: 'personality', tone: 'neutral', weight: 3, label: '같은 오행의 일간이라 가치관이 비슷하지만 고집이 맞설 수 있어요.' });
  else if (rel === 1 || rel === 4) add({ key: 'stem_generate', category: 'personality', tone: 'positive', weight: 8, label: rel === 1 ? '내가 상대를 북돋아 주는 상생 관계예요.' : '상대가 나를 북돋아 주는 상생 관계예요.' });
  else if (!combine) add({ key: 'stem_control', category: 'personality', tone: 'negative', weight: -5, label: rel === 2 ? '내가 상대를 이끌려는 상극 관계라 배려가 필요해요.' : '상대가 나를 이끌려는 상극 관계라 배려가 필요해요.' });

  // 2) 일지(배우자궁) 관계
  const ab = a.pillars.day.branch.index;
  const bb = b.pillars.day.branch.index;
  if (sixCombine(ab, bb)) add({ key: 'day_branch_combine', category: 'stability', tone: 'positive', weight: 12, label: '배우자 자리(일지)가 육합으로 묶여 함께할수록 편안해지는 인연이에요.' });
  else if (halfCombine(ab, bb)) add({ key: 'day_branch_half', category: 'stability', tone: 'positive', weight: 8, label: '배우자 자리(일지)가 삼합 기운으로 이어져 협력이 잘 돼요.' });
  if (branchClash(ab, bb)) add({ key: 'day_branch_clash', category: 'stability', tone: 'negative', weight: -12, label: '배우자 자리(일지)가 충돌해 생활 방식 차이를 조율해야 해요.' });
  if (branchPunish(ab, bb)) add({ key: 'day_branch_punish', category: 'stability', tone: 'negative', weight: -6, label: '일지가 형(刑) 관계라 사소한 말다툼에 주의가 필요해요.' });
  if (branchHarm(ab, bb) || branchBreak(ab, bb)) add({ key: 'day_branch_harm', category: 'stability', tone: 'negative', weight: -4, label: '일지에 해·파 기운이 있어 서운함이 쌓이지 않게 대화가 필요해요.' });
  if (branchWonjin(ab, bb)) add({ key: 'day_branch_wonjin', category: 'romance', tone: 'negative', weight: -8, label: '일지가 원진 관계라 끌리면서도 미묘하게 서운한 감정이 생길 수 있어요.' });

  // 3) 띠(년지) 관계
  const ay = a.pillars.year.branch.index;
  const by = b.pillars.year.branch.index;
  if (sixCombine(ay, by)) add({ key: 'zodiac_combine', category: 'romance', tone: 'positive', weight: 6, label: `${a.zodiac.animal}띠와 ${b.zodiac.animal}띠는 육합으로 잘 어울리는 띠 궁합이에요.` });
  else if (halfCombine(ay, by) || (ay !== by && sameTrine(ay, by))) add({ key: 'zodiac_trine', category: 'romance', tone: 'positive', weight: 5, label: `${a.zodiac.animal}띠와 ${b.zodiac.animal}띠는 삼합으로 손발이 잘 맞는 띠 궁합이에요.` });
  if (branchClash(ay, by)) add({ key: 'zodiac_clash', category: 'romance', tone: 'negative', weight: -6, label: `${a.zodiac.animal}띠와 ${b.zodiac.animal}띠는 충 관계라 서로의 속도를 맞춰가야 해요.` });
  if (branchWonjin(ay, by)) add({ key: 'zodiac_wonjin', category: 'romance', tone: 'negative', weight: -5, label: `${a.zodiac.animal}띠와 ${b.zodiac.animal}띠는 원진 관계라 오해를 줄이는 표현이 중요해요.` });

  // 4) 오행 보완
  let complement = 0;
  for (const e of a.elements.lacking) if (b.elements.count[e] >= 2 && complement < 12) {
    complement += 4;
    add({ key: `complement_a_${e}`, category: 'complement', tone: 'positive', weight: 4, label: `내게 없는 ${EL_KO[e]} 기운을 상대가 채워줘요.` });
  }
  let complementB = 0;
  for (const e of b.elements.lacking) if (a.elements.count[e] >= 2 && complementB < 12) {
    complementB += 4;
    add({ key: `complement_b_${e}`, category: 'complement', tone: 'positive', weight: 4, label: `상대에게 없는 ${EL_KO[e]} 기운을 내가 채워줘요.` });
  }

  // 5) 용신 보완
  if (b.elements.dominant === a.yongsin.yongsin) add({ key: 'yongsin_a', category: 'complement', tone: 'positive', weight: 8, label: `상대의 강한 ${EL_KO[b.elements.dominant]} 기운이 내게 꼭 필요한 기운(용신)이에요.` });
  else if (b.elements.dominant === a.yongsin.gisin) add({ key: 'gisin_a', category: 'complement', tone: 'negative', weight: -4, label: `상대의 강한 ${EL_KO[b.elements.dominant]} 기운이 나에게는 부담이 될 수 있어요.` });
  if (a.elements.dominant === b.yongsin.yongsin) add({ key: 'yongsin_b', category: 'complement', tone: 'positive', weight: 8, label: `나의 강한 ${EL_KO[a.elements.dominant]} 기운이 상대에게 꼭 필요한 기운(용신)이에요.` });
  else if (a.elements.dominant === b.yongsin.gisin) add({ key: 'gisin_b', category: 'complement', tone: 'negative', weight: -4, label: `나의 강한 ${EL_KO[a.elements.dominant]} 기운이 상대에게는 부담이 될 수 있어요.` });

  // 6) 배우자성 — 남성은 재성, 여성은 관성이 배우자
  const spouse = (self: SajuChart, other: SajuChart, who: string) => {
    const tg = tenGodOf(self.dayMaster.index, other.dayMaster.index);
    const ideal = self.input.gender === 'male' ? ['정재', '편재'] : ['정관', '편관'];
    if (tg === ideal[0]) add({ key: `spouse_star_${who}`, category: 'romance', tone: 'positive', weight: 6, label: `${who === 'a' ? '나' : '상대'}의 사주에서 ${who === 'a' ? '상대' : '나'}는 이상적인 배우자 기운(${tg})에 해당해요.` });
    else if (tg === ideal[1]) add({ key: `spouse_star_${who}`, category: 'romance', tone: 'positive', weight: 4, label: `${who === 'a' ? '나' : '상대'}의 사주에서 ${who === 'a' ? '상대' : '나'}는 강렬한 끌림의 기운(${tg})이에요.` });
  };
  spouse(a, b, 'a');
  spouse(b, a, 'b');

  const sum = (cat?: CompatibilityCategory) => factors.filter((f) => !cat || f.category === cat).reduce((s, f) => s + f.weight, 0);
  const score = Math.max(20, Math.min(99, Math.round(62 + sum())));
  const cat = (c: CompatibilityCategory) => Math.max(15, Math.min(99, Math.round(62 + sum(c) * 2)));
  return {
    score,
    grade: score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 55 ? 'normal' : 'effort',
    categories: { personality: cat('personality'), romance: cat('romance'), stability: cat('stability'), complement: cat('complement') },
    factors,
  };
}

function sameTrine(x: number, y: number): boolean {
  return mod(x - y, 4) === 0;
}

