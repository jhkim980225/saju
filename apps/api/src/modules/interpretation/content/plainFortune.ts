/**
 * 오늘의 운세 · 신년운세 · 궁합 — 사주를 처음 접하는 성인이 읽는 글(docs/PLAIN_KOREAN.md).
 * - 등급 이름('좋은 날', '조심할 해')은 달빛사주 점수를 나눈 서비스 자체 구간이다. 대길·길·평 같은 옛 등급명은 근거(basis)에만.
 * - 궁합 근거는 명리학 용어(일간·일지·합·충·용신…)를 쓰되, 두 사람 이름으로 생활 장면까지 이어 쓴다.
 *   처음 나온 용어의 뜻은 화면 단위로 reading.ts 의 defineTerms 가 붙인다. term 은 '사주로 보면'에 모으는 짧은 이름이다.
 * - 조심할 이야기는 "이렇게 하면 괜찮다"까지 한 문단에. 충·원진을 이별·사고로 단정하지 않는다.
 */
import { BRANCHES, ELEMENTS, STEMS, mod, type CompatibilityFactor, type Element, type FortuneGrade, type SajuChart } from '@saju/core';
import type { DailyCategory, ScoreBand } from './types.js';

export const DAY_GRADE_PLAIN: Record<FortuneGrade, string> = { great: '아주 좋은 날', good: '좋은 날', normal: '무난한 날', caution: '조심할 날', bad: '쉬어 가는 날' };
export const YEAR_GRADE_PLAIN: Record<FortuneGrade, string> = { great: '아주 좋은 해', good: '좋은 해', normal: '무난한 해', caution: '조심할 해', bad: '쉬어 가는 해' };

/** 분야 — 화면 막대 옆 이름(label)과 '한눈에 보는 오늘'의 한 줄 */
export const CATEGORY_PLAIN: Record<DailyCategory, { label: string; good: string; watch: string }> = {
  wealth: { label: '돈', good: '돈 관리나 거래가 순조롭기 쉬워요', watch: '지출은 한 번 더 생각하고 정하세요' },
  love: { label: '연애', good: '연애나 대인 관계가 순조롭기 쉬워요', watch: '가까운 사이일수록 말을 부드럽게 해 주세요' },
  career: { label: '일', good: '업무에 힘이 실리기 쉬워요', watch: '일에서 실수가 없는지 한 번 더 살펴 주세요' },
  health: { label: '건강', good: '몸이 가볍고 컨디션이 좋은 편이에요', watch: '쉽게 지칠 수 있으니 무리하지 마세요' },
  study: { label: '공부', good: '공부와 배움에 집중하기 좋아요', watch: '집중이 흩어지기 쉬우니 짧게 끊어서 해 보세요' },
};

/** 신년운세 '한눈에 보는 ○○년' — 가장 좋은 분야·조심할 분야 */
export const YEAR_CATEGORY_PLAIN: Record<'wealth' | 'love' | 'career' | 'health', { label: string; good: string; watch: string }> = {
  wealth: { label: '돈', good: '돈 모으기와 거래', watch: '큰 지출과 돈거래' },
  love: { label: '연애', good: '연애와 대인 관계', watch: '가까운 사이의 말다툼' },
  career: { label: '일', good: '일과 직장', watch: '무리한 일 욕심' },
  health: { label: '건강', good: '몸 컨디션', watch: '쌓이는 피로' },
};

/** 행운의 색 — 청색·적색 같은 한자말 대신 */
export const LUCKY_COLOR_PLAIN: Record<Element, string> = { wood: '초록·파랑', fire: '빨강·분홍', earth: '노랑·베이지', metal: '흰색·은색', water: '검정·남색' };

/** 오행을 사람의 성향으로 — 궁합 문장에 쓴다 */
export const ELEMENT_TRAIT: Record<Element, string> = {
  wood: '새로 시작하는 힘',
  fire: '마음을 밖으로 표현하는 힘',
  earth: '중심을 잡아 주는 안정감',
  metal: '맺고 끊는 결단력',
  water: '차분히 생각을 정리하는 힘',
};
/** 그 기운이 지나칠 때 상대가 느끼는 모습 */
const ELEMENT_EXCESS: Record<Element, string> = {
  wood: '이것저것 벌이는 성향',
  fire: '감정을 크고 빠르게 드러내는 성향',
  earth: '쉽게 움직이지 않는 성향',
  metal: '딱 잘라 말하는 성향',
  water: '생각이 많은 성향',
};
const EL_TERM: Record<Element, string> = { wood: '목(木)', fire: '화(火)', earth: '토(土)', metal: '금(金)', water: '수(水)' };
/** 본문용 오행 이름 — 정식 이름(한자 없이) */
const EL_KO: Record<Element, string> = { wood: '목', fire: '화', earth: '토', metal: '금', water: '수' };

/** 그해 이름 — 丁未 → '붉은 양의 해' (천간 색 + 띠 동물) */
const STEM_COLOR: Record<Element, string> = { wood: '푸른', fire: '붉은', earth: '누런', metal: '흰', water: '검은' };
export function yearNickname(stem: number, branch: number): string {
  return `${STEM_COLOR[STEMS[mod(stem, 10)]!.element]} ${BRANCHES[mod(branch, 12)]!.animal}의 해`;
}

/** 일간 10종의 연애 방식 — 인덱스 0~9 = 甲~癸. 주어 없이 시작한다. 이름이 없으면 앞에 '상대는'이 붙으므로 연애 상대는 '연인'으로 쓴다 */
export const LOVE_STYLE: string[] = [
  '좋아하는 사람이 생기면 돌려 말하지 않고 진심을 보여 주는 편이에요. 다만 표현이 투박할 수 있으니, 고마운 마음은 말로 자주 전하는 것이 좋아요.',
  '연인에게 부드럽게 맞춰 주며 관계를 이어 가는 편이에요. 다만 서운한 것을 참고 넘기기 쉬우니, 원하는 것을 솔직하게 말할 필요가 있어요.',
  '연애에서도 계산하지 않고 마음을 바로 표현하는 편이에요. 다만 관심이 빨리 생긴 만큼 빨리 식을 수 있으니, 꾸준한 연락과 관심이 관계를 지켜 줍니다.',
  '연애할 때는 연인의 컨디션과 기분을 먼저 알아채고 조용히 챙기는 편이에요. 다만 서운함을 속으로 삭이다 지치기 쉬우니, 힘들 때는 연인에게 기대도 괜찮아요.',
  '화려하지 않아도 한결같은 사랑을 주는 편이에요. 다만 표현이 적어 연인이 불안해할 수 있으니, "고마워", "좋아해" 같은 말을 자주 건네 주세요.',
  '연인을 살뜰히 챙기고 생활을 함께 꾸려 가는 데 강한 편이에요. 다만 걱정이 잔소리처럼 들릴 수 있으니, 응원하는 말을 먼저 건네 보세요.',
  '마음이 정해지면 의리 있게 곁을 지키는 편이에요. 다만 말이 직설적으로 들릴 수 있으니, 한 번 부드럽게 다듬어 말하는 것이 좋아요.',
  '작은 것까지 신경 쓰는 섬세한 연애를 하는 편이에요. 다만 기대가 높아 혼자 실망하기 쉬우니, 바라는 것을 미리 말해 두세요.',
  '함께 새로운 경험을 하는 것을 좋아하는 자유로운 연애를 하는 편이에요. 다만 혼자만의 시간도 필요하니, 그 마음을 미리 알려 두면 오해가 줄어요.',
  '말하지 않아도 연인의 마음을 잘 알아채는 편이에요. 다만 걱정을 혼자 키우기 쉬우니, 궁금한 것은 바로 물어보는 것이 좋아요.',
];

/** 궁합 영역 점수대별 한 문장 — 유료 섹션의 첫 문단(잠금 미리보기)으로도 쓴다 */
export const COMPAT_CATEGORY_PLAIN: Record<'romance' | 'stability' | 'complement', Record<ScoreBand, string>> = {
  romance: {
    high: '함께 있으면 대화가 자연스럽고, 마음이 빠르게 가까워지기 쉬운 사이로 봐요.',
    mid: '끌림은 잔잔한 편이지만, 시간이 지날수록 정이 깊어지기 쉬운 사이예요.',
    low: '첫눈에 끌리기보다 함께 보낸 시간이 쌓여야 가까워지는 사이로 봐요.',
  },
  stability: {
    high: '함께 지내는 생활이 편안하게 맞는 편이에요.',
    mid: '함께 지내는 데 조금씩 맞춰 가면 되는 정도예요.',
    low: '함께 지내는 데 맞춰 갈 부분이 꽤 있어요. 미리 알고 있으면 부딪힘을 훨씬 줄일 수 있습니다.',
  },
  complement: {
    high: '서로에게 없는 부분을 잘 채워 주는 사이라, 함께 있을 때 서로 의지가 되기 쉬워요.',
    mid: '서로 채워 주는 부분과 각자 챙겨야 할 부분이 고르게 섞여 있어요.',
    low: '두 사람 모두 비슷한 부분이 부족한 편이라, 부족한 점은 함께 채워 가는 것이 좋아요.',
  },
};

/** 궁합 조언 섹션의 요약 — 화면 위 등급 이름('잘 맞는 사이')과 겹치지 않게 */
export const COMPAT_ADVICE_SUMMARY: Record<'excellent' | 'good' | 'normal' | 'effort', string> = {
  excellent: '표현을 아끼지 않을수록 관계가 오래가요',
  good: '함께하는 목표 하나가 관계를 더 깊게 해요',
  normal: '서로의 방식을 이해할수록 편해져요',
  effort: '감정이 가라앉은 뒤에 대화하면 좋아요',
};

/** 조사 — 받침 유무로. '나'+이/가 는 '내가' */
export function particle(word: string, withBatchim: string, without: string): string {
  if (word === '나' && withBatchim === '이') return '내가';
  const ch = word.charCodeAt(word.length - 1);
  if (ch < 0xac00 || ch > 0xd7a3) return word + withBatchim;
  return word + ((ch - 0xac00) % 28 > 0 ? withBatchim : without);
}
const 은 = (w: string) => particle(w, '은', '는');
const 이 = (w: string) => particle(w, '이', '가');
const 을 = (w: string) => particle(w, '을', '를');
const 과 = (w: string) => particle(w, '과', '와');
/** '목이에요' / '화예요' — 조사만 */
const ieyo = (w: string) => particle(w, '이에요', '예요').slice(w.length);

/** 궁합 문장 속 두 사람 — a/b: 부르는 말('서윤님' 또는 '나'·'상대') */
export interface CompatPeople {
  a: string;
  b: string;
  ca: SajuChart;
  cb: SajuChart;
}

/** 엔진의 궁합 요인 하나를 문장 + 용어(근거용)로. 오행 보완(complement_*)은 따로 묶어 쓴다 */
export function compatFactorPlain(f: CompatibilityFactor, p: CompatPeople): { text: string; term: string } | null {
  const { a, b, ca, cb } = p;
  const rel = mod(ELEMENTS.indexOf(cb.dayMaster.element) - ELEMENTS.indexOf(ca.dayMaster.element), 5);
  const animalA = ca.zodiac.animal;
  const animalB = cb.zodiac.animal;
  const key = f.key;
  if (key === 'stem_combine') return { text: `${과(a)} ${은(b)} 일간이 서로 합을 이루는 사이예요. 처음 만나도 낯설지 않고, 자연스럽게 끌리기 쉽다고 봐요.`, term: '일간 합' };
  if (key === 'stem_clash') return { text: '두 사람은 일간이 서로 충을 이루는 사이예요. 생각하는 방식이 정반대인 경우가 많아, 의견이 갈리면 누가 옳은지 따지기보다 다른 관점으로 받아들이는 편이 좋아요.', term: '일간 충' };
  if (key === 'stem_same') return { text: '두 사람은 일간의 오행이 같아 가치관이 잘 통하는 편이에요. 다만 둘 다 고집을 부리면 쉽게 물러서지 않으니, 번갈아 양보하는 것이 좋아요.', term: '같은 오행의 일간' };
  if (key === 'stem_generate') {
    const [from, to] = rel === 1 ? [a, b] : [b, a];
    return { text: `일간의 오행으로 보면 ${이(from)} ${을(to)} 생하는(도와주는) 관계예요. 함께 있으면 ${이(to)} 힘을 얻기 쉽다고 봐요.`, term: '일간 상생' };
  }
  if (key === 'stem_control') {
    const [from, to] = rel === 2 ? [a, b] : [b, a];
    return { text: `일간의 오행으로 보면 ${이(from)} ${을(to)} 극하는(제어하는) 관계예요. ${이(from)} 이끄는 쪽이 되기 쉬워, 좋은 뜻이어도 ${은(to)} 간섭으로 느낄 수 있어요. 중요한 일은 함께 정하는 것이 좋습니다.`, term: '일간 상극' };
  }
  if (key === 'day_branch_combine') return { text: '두 사람의 일지가 서로 합을 이뤄, 함께 지낼수록 편안해지기 쉬운 사이예요. 생활 리듬과 습관도 잘 맞는 편입니다.', term: '일지 육합' };
  if (key === 'day_branch_half') return { text: '두 사람의 일지가 반합(삼합을 이루는 세 지지 가운데 두 글자의 만남)을 이뤄, 함께 무언가를 할 때 역할을 잘 나눠 맡는 편이에요. 같이 정한 계획을 끝까지 해내기 쉬워요.', term: '일지 반합' };
  if (key === 'day_branch_clash') return { text: '두 사람의 일지가 서로 충을 이뤄, 생활 방식의 차이를 느끼기 쉬운 사이예요. 각자의 공간과 시간을 정해 두면 훨씬 편해집니다.', term: '일지 충' };
  if (key === 'day_branch_punish') return { text: '두 사람의 일지가 형을 이뤄, 사소한 일로 말다툼이 생기기 쉬워요. 서운한 점은 그때그때 가볍게 말하면 크게 번지지 않아요.', term: '일지 형' };
  if (key === 'day_branch_harm') return { text: '두 사람의 일지가 해·파(서로 방해하거나 어긋나는 관계)를 이뤄, 말하지 않은 서운함이 조금씩 쌓이기 쉬워요. 일주일에 한 번쯤 서로의 마음을 묻는 시간을 가져 보세요.', term: '일지 해·파' };
  if (key === 'day_branch_wonjin') return { text: '두 사람의 일지가 원진을 이뤄, 끌리면서도 묘하게 서운한 마음이 생길 수 있어요. 바라는 것을 말로 분명히 해 두면 오해가 줄어요.', term: '일지 원진' };
  if (key === 'zodiac_combine') return { text: `${animalA}띠와 ${animalB}띠는 육합(두 지지가 짝을 이뤄 결합하는 관계)을 이루는 띠예요. 함께 있으면 분위기가 쉽게 편안해지는 편이에요.`, term: '띠 육합' };
  if (key === 'zodiac_trine') return { text: `${animalA}띠와 ${animalB}띠는 삼합(세 지지가 모여 한 오행을 이루는 관계)으로 묶이는 띠예요. 함께 일할 때 손발이 잘 맞는 편입니다.`, term: '띠 삼합' };
  if (key === 'zodiac_clash') return { text: `${animalA}띠와 ${animalB}띠는 충을 이루는 띠예요. 생활의 속도가 서로 다른 편이니, 서두르지 말고 서로의 속도를 맞춰 가는 것이 좋아요.`, term: '띠 충' };
  if (key === 'zodiac_wonjin') return { text: `${animalA}띠와 ${animalB}띠는 원진을 이루는 띠예요. 작은 말에도 오해가 생기기 쉬우니, 짐작하기보다 직접 확인하는 습관이 도움이 돼요.`, term: '띠 원진' };
  if (key === 'yongsin_a' || key === 'yongsin_b') {
    const [needer, giver, giverChart] = key === 'yongsin_a' ? [a, b, cb] : [b, a, ca];
    const el = giverChart.elements.dominant;
    const k = EL_KO[el];
    return { text: `${needer}의 용신은 ${k} 기운이고, ${giver}의 사주에서 가장 강한 오행도 ${k}${ieyo(k)}. 함께 있으면 ${needer}에게 필요한 ${을(ELEMENT_TRAIT[el])} 채우기 쉽다고 봐요.`, term: `용신 보완 ${EL_TERM[el]}` };
  }
  if (key === 'gisin_a' || key === 'gisin_b') {
    const [feeler, other, otherChart] = key === 'gisin_a' ? [a, b, cb] : [b, a, ca];
    const el = otherChart.elements.dominant;
    const k = EL_KO[el];
    return { text: `${other}의 사주에서 가장 강한 오행인 ${이(k)} ${feeler}에게는 기신에 해당해요. ${other}의 ${이(ELEMENT_EXCESS[el])} 가끔 부담으로 느껴질 수 있지만, 서로 다른 점으로 받아들이면 충분히 조율할 수 있어요.`, term: `기신 ${EL_TERM[el]}` };
  }
  if (key === 'spouse_star_both') {
    return f.weight >= 6
      ? { text: '두 사람은 서로의 사주에서 상대의 일간이 배우자성에 해당하는 사이예요. 함께할수록 신뢰가 쌓이기 쉽다고 봐요.', term: '서로 배우자성' }
      : { text: '두 사람은 서로의 사주에서 상대의 일간이 배우자성에 해당해, 서로 강하게 끌리기 쉬운 사이예요. 설렘이 오래가도록 표현을 아끼지 마세요.', term: '서로 배우자성' };
  }
  if (key === 'spouse_star_a' || key === 'spouse_star_b') {
    const [self, other] = key === 'spouse_star_a' ? [a, b] : [b, a];
    return f.weight >= 6
      ? { text: `${self}의 사주로 보면 ${other}의 일간이 배우자성에 해당해, ${은(other)} ${self}에게 오래 곁에 두고 싶은 사람이 되기 쉬워요.`, term: '배우자성' }
      : { text: `${self}의 사주로 보면 ${other}의 일간이 배우자성에 해당해, ${은(self)} ${other}에게 강하게 끌리기 쉬워요. 설렘이 오래가도록 서로 표현을 아끼지 마세요.`, term: '배우자성' };
  }
  return null;
}

/** 오행 보완 요인들을 한 사람 기준으로 한 문장에 — "서윤님의 사주에 없는 화를 지훈님이 넉넉히 가지고 있어…" */
export function complementPlain(lacking: Element[], lacker: string, giver: string): { text: string; term: string } {
  const els = lacking.map((e) => EL_KO[e]).join('·');
  const traits = lacking.map((e) => ELEMENT_TRAIT[e]);
  const joined = traits.length > 1 ? `${traits.slice(0, -1).map(과).join(' ')} ${traits[traits.length - 1]}` : traits[0]!;
  return {
    text: `${lacker}의 사주에 없는 ${els} 기운을 ${이(giver)} 넉넉히 가지고 있어, ${을(joined)} 보완해 주기 쉬워요.`,
    term: `오행 보완 ${lacking.map((e) => EL_TERM[e]).join('·')}`,
  };
}
