/**
 * 택일 문장 — 엔진(@saju/core taekil)의 요인 코드를 읽는 문장으로 바꾼다(규칙 기반).
 * 보이스: docs/PLAIN_KOREAN.md — 사주·옛 달력을 모르는 사람도 읽히게.
 * - 화면에 보이는 이름(label)과 문장(text)은 쉬운 말로만 쓴다. 건제12신·황도·천을귀인·일지 충 같은 용어와 한자는
 *   이유마다 term, 날짜마다 basis 에만 둔다(화면에서는 '옛 달력·사주 용어로 보면'으로 접어 둔다).
 * - 날짜의 성격은 그날의 띠 동물(쥐날·말날)처럼 바로 떠오르는 말로 설명한다.
 */
import {
  BRANCHES,
  ELEMENT_INFO,
  OFFICER_WEIGHT,
  TAEKIL_GRADE_LABEL,
  TAEKIL_PURPOSES,
  branchClash,
  halfCombine,
  mod,
  sixCombine,
  yellowHoursOf,
  type DayOfficer,
  type SajuChart,
  type TaekilDay,
  type TaekilFactor,
  type TaekilFactorCode,
  type TaekilPurpose,
  type TaekilSelection,
} from '@saju/core';
import type { ReadingSection, TaekilDayDto, TaekilReasonDto } from '@saju/shared';

export const TAEKIL_DISCLAIMER = '택일은 옛 달력과 사주 계산을 바탕으로 한 참고 정보예요. 날짜는 실제 일정과 사정을 함께 살펴 편하게 정해 주세요.';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export const weekdayKo = (weekday: number) => WEEK[weekday]!;
/** '2026-11-14' + 6 → '11월 14일(토)' */
export const dateLabel = (date: string, weekday: number) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일(${WEEK[weekday]})`;
/** '2026-11-14' → '11월 14일' */
const monthDay = (date: string) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
const dayLabel = (d: TaekilDay) => dateLabel(d.almanac.date, d.almanac.weekday);
const hz = (b: number) => BRANCHES[mod(b, 12)]!.hanja;
/** 지지 → 띠 동물 '쥐' */
const animal = (b: number) => BRANCHES[mod(b, 12)]!.animal;
/** 지지 → 그날의 이름 '쥐날' ('양날'은 다른 말로 읽혀 '양의 날') */
const animalDay = (b: number) => (animal(b) === '양' ? '양의 날' : `${animal(b)}날`);

const EL_KO = { wood: '목', fire: '화', earth: '토', metal: '금', water: '수' } as const;

/** 마지막 한글 글자에 받침이 있는가 (괄호·따옴표 속은 건너뛴다) */
function hasBatchim(word: string): boolean {
  const ch = [...word.replace(/\([^)]*\)\s*$/, '')].reverse().find((c) => /[가-힣]/.test(c));
  return ch ? (ch.charCodeAt(0) - 0xac00) % 28 !== 0 : false;
}
/** 조사 붙이기 — josa('청룡', '이', '가') → '청룡이' */
export const josa = (word: string, withBatchim: string, without: string) => word + (hasBatchim(word) ? withBatchim : without);
/** '…날' → '…날이에요.' / '…예요.' (문장 끝) */
const ieyo = (word: string) => `${josa(word, '이에요', '예요')}.`;

/** 목적을 문장 안에서 부르는 말 */
const PURPOSE_NOUN: Record<TaekilPurpose, string> = { move: '이사', contract: '계약', exam: '면접·시험', wedding: '결혼식', opening: '개업', travel: '길 떠나는 일' };

/** 건제12신 — 옛 달력이 날마다 붙이는 열두 가지 성격 */
const OFFICER_PLAIN: Record<DayOfficer, string> = {
  건: '새로 세우고 시작하는 날',
  제: '묵은 것을 덜어 내는 날',
  만: '가득 차는 날',
  평: '고르고 평평한 날',
  정: '자리를 정하는 날',
  집: '붙잡아 지키는 날',
  파: '그달의 기운과 부딪히는 날',
  위: '높은 곳에 선 듯 조심하는 날',
  성: '일이 이루어지는 날',
  수: '거두어들이는 날',
  개: '막힌 것이 열리는 날',
  폐: '닫히고 막히는 날',
};

/** 화면에 보이는 이유 한 줄 — short: 목록·요약에 쓰는 짧은 이름, text: 풀어 쓴 문장 */
interface Plain {
  short: string;
  text: string;
}

export interface ReasonContext {
  /** 그날의 지지(띠 동물) */
  dayBranch?: number;
  /** 같은 날의 다른 요인 — 짝이 맞으면서 어긋나기도 하는 날(寅亥·巳申)을 '다만'으로 잇는다 */
  siblings?: TaekilFactorCode[];
  /** 내 사주 — 내 띠를 부를 때 */
  chart?: SajuChart | null;
  partnerName?: string | null;
}

function officerPlain(f: TaekilFactor, purpose: TaekilPurpose): Plain {
  const name = f.label.slice(0, 1) as DayOfficer;
  const kind = OFFICER_PLAIN[name] ?? f.label;
  if (name === '파') return { short: kind, text: "옛 달력에서 '그달의 기운과 정면으로 부딪히는 날'로 봐서, 큰일은 하지 않는 날이에요." };
  const noun = PURPOSE_NOUN[purpose];
  const w = OFFICER_WEIGHT[purpose][name];
  const lead = `옛 달력에서는 '${kind}'로 봐요.`;
  // 이름이 좋게 들리는데 목적에는 꺼리거나, 조심스럽게 들리는데 목적에는 좋은 날 — '다만/그래도'로 이어 읽히게
  const sounds = ['건', '제', '만', '정', '성', '개'].includes(name) ? 'good' : ['위', '폐'].includes(name) ? 'bad' : 'plain';
  if (w >= 3) return { short: `${noun}에 좋은 날`, text: `${lead} ${sounds === 'bad' ? `그래도 ${noun}에는 좋다고 꼽아요.` : `${noun}에 좋다고 꼽는 날이에요.`}` };
  if (w > 0) return { short: `${noun}에 무난한 날`, text: `${lead} ${sounds === 'bad' ? `그래도 ${noun}에는 무난한 편이에요.` : `${noun}에도 무난한 편이에요.`}` };
  if (w <= -3) return { short: `${noun}에는 꺼리는 날`, text: `${lead} ${sounds === 'good' ? `다만 ${noun}에는 꺼려요.` : `${noun}에는 꺼리는 날이에요.`}` };
  if (w < 0) return { short: `${josa(noun, '과', '와')} 잘 안 맞는 날`, text: `${lead} ${sounds === 'good' ? `다만 ${noun}에는 썩 잘 맞지 않아요.` : `${noun}에는 썩 잘 맞지 않는 편이에요.`}` };
  return { short: kind, text: `${lead} ${noun}에는 좋지도 나쁘지도 않아요.` };
}

/** 목적별 사주 요인(십신) — 엔진의 detail 문구로 갈래를 나눠 쉬운 말로 */
function tenGodPlain(f: TaekilFactor, purpose: TaekilPurpose): Plain {
  const d = f.detail ?? '';
  const noun = PURPOSE_NOUN[purpose];
  if (d.includes('평가·조직')) return { short: '평가받는 일에 힘이 실리는 날', text: '사람들 앞에서 평가받는 일에 힘이 실리는 날이라 면접·시험에 도움이 돼요.' };
  if (d.includes('공부·문서')) return { short: '공부와 서류에 힘이 실리는 날', text: '배운 것을 잘 꺼내 쓰고 서류 일이 순조로운 날이에요.' };
  if (d.includes('말이 앞서')) return { short: '말이 앞서기 쉬운 날', text: '말이 생각보다 앞서기 쉬운 날이에요. 면접이라면 한 번 더 생각하고 답해 보세요.' };
  if (d.includes('정당한 거래')) return { short: '정직한 거래에 좋은 날', text: '정당하게 주고받는 거래에 힘이 실리는 날이라 계약과 잘 맞아요.' };
  if (d.includes('문서·도장')) return { short: '서류와 도장에 좋은 날', text: '서류를 쓰고 도장을 찍는 일에 힘이 실리는 날이에요.' };
  if (d.includes('재물이 나뉘거나')) return { short: '돈 문제로 다투기 쉬운 날', text: '돈이 나뉘거나 다툼이 생기기 쉬운 날이에요. 금액과 조건을 한 번 더 확인해 주세요.' };
  if (d.includes('손님과 일거리')) return { short: '손님과 일거리가 생기는 날', text: '손님과 일거리가 생기기 쉬운 날이라 가게 문을 열기에 좋아요.' };
  if (d.includes('돈이 들어오는')) return { short: '돈이 들어오는 날', text: '돈이 들어오는 흐름이 있는 날이라 개업에 힘이 돼요.' };
  if (d.includes('배우자 자리')) return { short: '배우자 인연이 약해지는 날', text: '사주로 보면 배우자 인연을 누르는 기운이 드는 날이라, 결혼식 날로는 한 번 더 살펴요.' };
  if (d.includes('배우자를 뜻하는')) return { short: '배우자 인연이 닿는 날', text: '사주로 보면 배우자 인연을 뜻하는 기운이 드는 날이라 결혼식에 힘이 돼요.' };
  if (d.includes('인연을 뜻하는')) return { short: '인연의 기운이 드는 날', text: '사주로 보면 좋은 인연을 뜻하는 기운이 드는 날이에요.' };
  if (d.includes('집과 문서')) return { short: '집과 서류 일에 좋은 날', text: '집과 서류에 힘이 실리는 날이라 이사에 도움이 돼요.' };
  return f.weight > 0 ? { short: `${noun}에 힘이 되는 날`, text: `사주로 보면 ${noun}에 힘이 되는 기운이 드는 날이에요.` } : { short: `${noun}에 아쉬운 날`, text: `사주로 보면 ${noun}에는 조금 아쉬운 기운이 드는 날이에요.` };
}

/** 요인 하나 → 화면에 보이는 짧은 이름과 문장 (용어·한자 없이) */
export function plainReason(f: TaekilFactor, purpose: TaekilPurpose, ctx: ReasonContext = {}): Plain {
  const partner = ctx.partnerName ? `${ctx.partnerName}님` : '상대';
  const dA = ctx.dayBranch !== undefined ? animalDay(ctx.dayBranch) : '이날';
  const myA = ctx.chart ? `${animal(ctx.chart.pillars.year.branch.index)}띠` : '내 띠';
  /** 상대 띠 — detail '일진 午 ↔ 상대 년지 子' 의 마지막 한자 */
  const pB = BRANCHES.find((b) => b.hanja === (f.detail ?? '').trim().slice(-1));
  const pA = pB ? `${pB.animal}띠인 ${partner}` : `${partner}의 띠`;
  const dayAnimalLead = ctx.dayBranch !== undefined ? `${dA}이라` : '이날은';
  const map: Partial<Record<TaekilFactorCode, Plain>> = {
    yellow_road: { short: '하늘이 돕는 날', text: '옛 달력에서 하늘의 좋은 기운이 지켜 준다고 보는 날이에요. 일을 시작하기에 든든해요.' },
    black_road: { short: '하늘의 도움이 쉬는 날', text: '옛 달력에서 하늘의 좋은 기운이 쉬어 간다고 보는 날이에요. 큰일이라면 이날 가운데 좋은 시간에 맞춰 시작해 보세요.' },
    cheonsa: { short: '한 해에 몇 번 없는 좋은 날', text: '하늘이 허물을 덮어 준다고 보는 날이에요. 무엇을 시작해도 좋다고 봐요.' },
    cheondeok: { short: '도움이 따르는 날', text: '막힌 일이 풀리고 도와주는 손길이 따른다고 보는 날이에요.' },
    woldeok: { short: '일이 순하게 흐르는 날', text: '다툼이 줄고 일이 순하게 흘러간다고 보는 날이에요.' },
    sari: { short: '계절이 바뀌기 바로 전날', text: `${ieyo(f.detail ?? '계절이 바뀌기 전날')} 계절이 바뀌는 길목이라 옛 달력에서 큰일은 피해요. 하루만 미뤄도 괜찮아져요.` },
    sajeol: { short: '계절이 바뀌기 바로 전날', text: `${ieyo(f.detail ?? '계절이 바뀌기 전날')} 계절이 바뀌는 길목이라 옛 달력에서 큰일은 피해요. 하루만 미뤄도 괜찮아져요.` },
    month_start: (() => {
      const term = f.label.replace(/\s*절입일$/, '');
      return { short: `${josa(term, '이', '가')} 시작되는 날`, text: `절기 ${josa(term, '이', '가')} 시작되는 날이에요. 옛 달력은 이날부터 새 달로 쳐요.` };
    })(),
    wolgi: { short: '예부터 큰일을 피한 날', text: `${ieyo(f.detail ?? '음력 5·14·23일')} 음력 5일·14일·23일은 예부터 큰일을 피해 온 날이에요.` },
    son_free: { short: '손 없는 날', text: `${f.detail ? `${f.detail}이라, ` : ''}이사를 방해한다는 귀신(손)이 어디에도 없는 날이에요. 이삿날로 가장 많이 골라요.` },
    son_direction: (() => {
      const dir = f.label.replace(/^손\s*/, '');
      return {
        short: `손이 ${dir}에 있는 날`,
        text: `이사를 방해한다는 귀신(손)이 ${dir}에 있는 날이에요. ${purpose === 'travel' ? '그쪽으로 길을 떠난다면' : '지금 집에서 그쪽으로 옮긴다면'} 꺼리는 풍습이 있어요.`,
      };
    })(),
    gwigi: { short: '이사를 꺼려 온 날', text: '집을 옮기거나 먼 길에서 돌아오는 일을 예부터 꺼려 온 날이에요.' },
    leap_month:
      purpose === 'wedding'
        ? { short: '윤달', text: '요즘은 윤달 결혼을 꺼리는 편이라 점수를 조금 낮췄어요. 옛 책에는 오히려 결혼하기 좋은 달로 적혀 있기도 해요.' }
        : { short: '윤달', text: '윤달은 탈이 없는 달이라 해서, 예부터 이사나 집수리를 이때 하기도 했어요.' },
    pengzu:
      purpose === 'wedding'
        ? { short: '예부터 결혼을 피한 날', text: '돼지날에는 결혼식을 올리지 않는다는 오래된 금기가 있어요.' }
        : { short: '예부터 먼 길을 피한 날', text: '뱀날에는 먼 길을 떠나지 않는다는 오래된 금기가 있어요.' },
    day_clash: { short: '나와 정면으로 부딪히는 날', text: '이날의 기운이 타고난 나와 정면으로 부딪혀요. 나 자신이나 가까운 사람과의 일이 흔들리기 쉬워서, 좋은 날을 고를 때 가장 먼저 빼요.' },
    day_punish: { short: '마찰이 생기기 쉬운 날', text: '이날의 기운이 나와 조금 껄끄러워요. 마찰이나 번거로운 일이 생기기 쉬워요.' },
    day_wonjin: { short: '괜히 서운해지기 쉬운 날', text: '이날의 기운이 나와 잘 맞지 않아요. 괜히 서운하고 마음이 어긋나기 쉬워요.' },
    day_break: { short: '약속이 틀어지기 쉬운 날', text: '이날의 기운이 나와 살짝 어긋나요. 약속이 틀어지지 않게 한 번 더 확인해 주세요.' },
    day_harm: { short: '작은 오해가 생기기 쉬운 날', text: '이날의 기운이 나와 조금 엇갈려요. 사소한 오해만 조심하면 돼요.' },
    day_six: { short: '나와 잘 맞는 날', text: '이날의 기운이 나와 짝을 이뤄요. 사람도 일도 순하게 풀려요.' },
    day_half: { short: '나에게 힘을 보태는 날', text: '이날의 기운이 나와 같은 편으로 묶여 힘을 보태 줘요.' },
    year_clash: { short: '내 띠와 부딪히는 날', text: `${dayAnimalLead} ${josa(myA, '과', '와')} 부딪혀요. 큰일에는 덜 쓰는 편이에요.` },
    year_punish: { short: '내 띠와 껄끄러운 날', text: `${dayAnimalLead} ${josa(myA, '과', '와')} 조금 껄끄러워요. 일정이 번거로워지기 쉬워요.` },
    year_wonjin: { short: '내 띠와 잘 안 맞는 날', text: `${dayAnimalLead} ${josa(myA, '과', '와')} 잘 맞지 않아요. 마음이 어긋나기 쉬워요.` },
    year_break: { short: '내 띠와 살짝 어긋나는 날', text: `${dayAnimalLead} ${josa(myA, '과', '와')} 살짝 어긋나요. 서두르지 않으면 괜찮아요.` },
    year_harm: { short: '내 띠와 조금 엇갈리는 날', text: `${dayAnimalLead} ${josa(myA, '과', '와')} 조금 엇갈려요. 작은 일은 한 번 더 확인해 주세요.` },
    year_six: { short: '내 띠와 잘 맞는 날', text: `${dayAnimalLead} ${josa(myA, '과', '와')} 짝이 잘 맞아요. 주변의 도움을 받기 쉬워요.` },
    year_half: { short: '내 띠와 손이 맞는 날', text: `${dayAnimalLead} ${josa(myA, '과', '와')} 같은 편이에요. 힘을 보태 줘요.` },
    stem_combine: { short: '나와 손발이 맞는 날', text: '이날의 기운이 타고난 나와 잘 어울려요. 사람과 일이 잘 맞물려요.' },
    stem_clash: { short: '마음이 급해지기 쉬운 날', text: '이날의 기운이 타고난 나와 부딪혀요. 마음이 급해지기 쉬우니 결정은 한 박자 늦춰 보세요.' },
    full_clash: { short: '나와 크게 부딪히는 날', text: '이날의 기운이 위아래로 모두 나와 부딪혀요. 큰일은 피하는 게 좋아요.' },
    cheoneul: { short: '도와주는 사람이 나타나는 날', text: '힘들 때 손을 내밀어 주는 사람을 만나기 쉬운 날이에요.' },
    gongmang: { short: '애쓴 만큼 남지 않기 쉬운 날', text: '힘을 쏟아도 결과가 덜 남기 쉬운 날이에요. 중요한 마무리는 다른 날로 미뤄 보세요.' },
    yongsin: { short: '나에게 필요한 기운이 드는 날', text: '내 사주에 모자란 기운이 채워지는 날이에요. 힘을 덜 들이고도 흐름을 타기 쉬워요.' },
    gisin: { short: '이미 넘치는 기운이 더해지는 날', text: '내 사주에 이미 많은 기운이 더해지는 날이에요. 무리하지 않게 일정을 넉넉히 잡아 주세요.' },
    munchang: { short: '글과 말이 잘 풀리는 날', text: '공부와 시험, 글쓰기에 힘이 실린다고 보는 날이에요.' },
    yeokma: { short: '움직임에 힘이 실리는 날', text: '움직이고 옮기는 일에 힘이 실리는 날이에요.' },
    partner_clash: { short: `${josa(partner, '과', '와')} 부딪히는 날`, text: `이날의 기운이 ${josa(partner, '과', '와')} 정면으로 부딪혀요. 두 사람이 함께하는 날로는 피하는 게 좋아요.` },
    partner_punish: { short: `${partner}에게 마찰이 생기기 쉬운 날`, text: `이날의 기운이 ${josa(partner, '과', '와')} 조금 껄끄러워요. 작은 마찰만 조심하면 돼요.` },
    partner_wonjin: { short: `${josa(partner, '이', '가')} 서운해지기 쉬운 날`, text: `이날의 기운이 ${josa(partner, '과', '와')} 잘 맞지 않아요. 서로 서운한 일이 없게 마음을 한 번 더 살펴 주세요.` },
    partner_six: { short: `${josa(partner, '과', '와')}도 잘 맞는 날`, text: `이날의 기운이 ${josa(partner, '과', '와')}도 짝을 이뤄요. 두 사람 모두에게 순한 날이에요.` },
    partner_year_clash: { short: `${partner}의 띠와 부딪히는 날`, text: `${dayAnimalLead} ${josa(pA, '과', '와')} 부딪혀요. 큰일에는 덜 쓰는 편이에요.` },
    partner_year_six: { short: `${partner}의 띠와 잘 맞는 날`, text: `${dayAnimalLead} ${josa(pA, '과', '와')} 잘 맞아요. 두 사람에게 순한 날이에요.` },
    partner_cheoneul: { short: `${josa(partner, '을', '를')} 돕는 사람이 나타나는 날`, text: `${partner}에게 힘이 되어 주는 사람이 나타나기 쉬운 날이에요.` },
  };
  if (f.code === 'officer') return officerPlain(f, purpose);
  if (f.code === 'ten_god') return tenGodPlain(f, purpose);
  const plain = map[f.code] ?? { short: f.label, text: f.label };
  // 짝이 맞는 관계(육합·삼합)와 어긋나는 관계가 한날에 겹치면, 어긋나는 쪽을 '다만'으로 이어 앞뒤가 맞게
  const m = /^(day|year|partner)_(punish|wonjin|break|harm)$/.exec(f.code);
  if (m && ctx.siblings?.some((c) => c === `${m[1]}_six` || c === `${m[1]}_half`)) {
    const base = m[1] as 'day' | 'year' | 'partner';
    const who = base === 'day' ? '나와' : base === 'year' ? josa(myA, '과', '와') : josa(partner, '과', '와');
    const but = { punish: '조금 껄끄러운 면도 있어요', wonjin: '괜히 서운해지는 면도 있어요', break: '작은 약속은 살짝 엇갈리기 쉬워요', harm: '사소한 오해가 생길 수 있어요' }[m[2] as 'punish' | 'wonjin' | 'break' | 'harm'];
    const tip = { day: '중요한 일은 한 번 더 확인해 주세요.', year: '일정을 넉넉히 잡아 두면 괜찮아요.', partner: '두 사람의 일정만 한 번 더 맞춰 보세요.' }[base];
    // 같은 상대와 어긋나는 요인이 둘(巳申: 형·파)이면 당부는 처음 한 번만
    const firstBad = ctx.siblings.find((c) => new RegExp(`^${base}_(punish|wonjin|break|harm)$`).test(c));
    return { short: plain.short, text: f.code === firstBad ? `${who} 짝이 맞는 날이지만, ${but}. ${tip}` : `${who} 짝이 맞는 날이지만, ${but}.` };
  }
  return plain;
}

/** 요인의 전통 용어 — '사주로 보면'·'옛 달력 용어로 보면'에만 */
export function termOf(f: TaekilFactor): string {
  const label = f.code === 'officer' ? `건제12신 ${f.label}` : f.label;
  return f.detail ? `${label} · ${f.detail}` : label;
}

/** (호환) 요인 하나 → 풀어 쓴 문장 */
export function reasonText(f: TaekilFactor, purpose: TaekilPurpose, ctx: ReasonContext = {}): string {
  return plainReason(f, purpose, ctx).text;
}

export function reasonsOf(d: TaekilDay, purpose: TaekilPurpose, ctx: Omit<ReasonContext, 'dayBranch'> = {}): TaekilReasonDto[] {
  const rc: ReasonContext = { ...ctx, dayBranch: d.almanac.ganzhi.branch, siblings: d.factors.map((f) => f.code) };
  return d.factors.map((f) => {
    const p = plainReason(f, purpose, rc);
    return { tone: f.tone, label: p.short, text: p.text, term: termOf(f), weight: f.weight, excludes: Boolean(f.excludes) };
  });
}

const goods = (d: TaekilDay) => d.factors.filter((f) => f.weight > 0).sort((a, b) => b.weight - a.weight);
const bads = (d: TaekilDay) => d.factors.filter((f) => f.weight < 0).sort((a, b) => a.weight - b.weight);
const excluder = (d: TaekilDay) => d.factors.find((f) => f.excludes) ?? null;

/** 처음부터 후보에서 빼는 까닭 — 쉬운 말 */
const EXCLUDE_WHY: Partial<Record<TaekilFactorCode, string>> = {
  officer: '그달의 기운과 정면으로 부딪히는 날이라 큰일은 하지 않아요.',
  sari: '계절이 바뀌기 바로 전날이라 큰일은 피해요.',
  sajeol: '계절이 바뀌기 바로 전날이라 큰일은 피해요.',
  day_clash: '타고난 나와 정면으로 부딪히는 날이라 피해요.',
};

/** 짧은 이름 둘을 잇기 — '손 없는 날이면서 하늘이 돕는 날' */
const both = (a: string, b?: string, link: 'and' | 'with' = 'with') => (b ? `${josa(a, link === 'with' ? '이면서' : '이고,', link === 'with' ? '면서' : '고,')} ${b}` : a);

/** 하루를 한 줄로 (쉬운 말) */
export function daySummary(d: TaekilDay, purpose: TaekilPurpose = 'move', ctx: Omit<ReasonContext, 'dayBranch'> = {}): string {
  const ex = excluder(d);
  if (ex) return EXCLUDE_WHY[ex.code] ?? '피하는 날이에요.';
  const rc: ReasonContext = { ...ctx, dayBranch: d.almanac.ganzhi.branch };
  const g = goods(d).map((f) => plainReason(f, purpose, rc).short);
  const b = bads(d).map((f) => plainReason(f, purpose, rc).short);
  switch (d.grade) {
    case 'best':
      return g[0] ? `${ieyo(both(g[0], g[1]))} 좋은 점이 여럿 겹쳤어요.` : '좋은 점이 여럿 겹친 날이에요.';
    case 'good':
      return g[0] ? `${josa(both(g[0], g[1]), '이라', '라')} 무난하게 쓰기 좋아요.${b[0] ? ` 다만 ${josa(b[0], '이기도', '기도')} 해요.` : ''}` : '무난하게 쓰기 좋은 날이에요.';
    case 'normal':
      return g[0] && b[0] ? `좋은 점과 아쉬운 점이 섞였어요. ${josa(g[0], '이지만', '지만')} ${josa(b[0], '이기도', '기도')} 해요.` : g[0] ? `큰 흠 없이 무난해요. ${ieyo(g[0])}` : '특별히 좋거나 나쁜 점이 없는 평범한 날이에요.';
    case 'caution':
      return b[0] ? `조심할 점이 있어요. ${ieyo(both(b[0], b[1], 'and'))}` : '조심할 점이 있는 날이에요.';
    default:
      return b[0] ? `조심할 점이 겹쳐 피하는 게 좋아요. ${ieyo(both(b[0], b[1], 'and'))}` : '조심할 점이 겹쳐 피하는 게 좋아요.';
  }
}

/** Top 3 에 들지 못한 까닭 (쉬운 말) */
export function dropReasonOf(d: TaekilDay, cutoff: TaekilDay | null, purpose: TaekilPurpose = 'move', ctx: Omit<ReasonContext, 'dayBranch'> = {}): string {
  const ex = excluder(d);
  if (ex) return `${EXCLUDE_WHY[ex.code] ?? '피하는 날이에요.'} 이런 날은 처음부터 후보에서 빼요.`;
  const rc: ReasonContext = { ...ctx, dayBranch: d.almanac.ganzhi.branch };
  const short = (f: TaekilFactor) => plainReason(f, purpose, rc).short;
  const worst = bads(d)[0];
  if (d.grade === 'avoid') return `조심할 점(${bads(d).slice(0, 3).map(short).join(', ')})이 겹쳐 ${d.score}점에 그쳤어요.`;
  if (!cutoff) return worst ? `가장 아쉬운 점은 '${short(worst)}'이에요.` : '큰 흠은 없는 날이에요.';
  const diff = cutoff.score - d.score;
  if (diff <= 0) return `3위와 점수(${d.score}점)는 같지만, 아쉬운 점이 조금 더 있거나 날짜가 늦어 순위에서 밀렸어요.`;
  return worst ? `3위보다 ${diff}점 낮아요. 가장 아쉬운 점은 '${short(worst)}'이에요.` : `흠은 없지만 3위보다 ${diff}점 낮아요. 좋은 점이 더 많이 겹친 날이 있었어요.`;
}

/** 시각 → '오전 9시' / '오후 1시' */
const clock = (h: number) => (h < 12 ? `오전 ${h}시` : h === 12 ? '낮 12시' : `오후 ${h - 12}시`);
/** 두 시간 칸 → '오전 9~11시' / '오전 11시~오후 1시' */
function hourRange(start: number): string {
  const end = start + 2;
  if (start < 12 && end < 12) return `오전 ${start}~${end}시`;
  if (start > 12 && end > 12) return `오후 ${start - 12}~${end - 12}시`;
  return `${clock(start)}~${clock(end)}`;
}

/** 황도시(옛 달력의 좋은 시간) 중 낮 시간(辰~酉) */
const goodHourBranches = (d: TaekilDay) => yellowHoursOf(d.almanac.ganzhi.branch).filter((h) => h >= 4 && h <= 9);

/** 시작하기 좋은 시간 — '오전 9~11시' */
export function goodHoursOf(d: TaekilDay): string[] {
  return goodHourBranches(d).map((h) => hourRange(BRANCHES[h]!.hourStart));
}

/** 날짜 하나의 옛 달력·사주 용어 한 줄 — 화면에서는 접어 둔다 */
export function dayBasisOf(d: TaekilDay, withHours: boolean): string {
  const a = d.almanac;
  const parts = [`일진 ${a.ganzhi.hanja}(${a.ganzhi.hangul})`, `건제12신 ${a.officer.name}(${a.officer.hanja})`, `${a.tianShen.yellow ? '황도' : '흑도'} ${a.tianShen.name}(${a.tianShen.hanja})`];
  if (withHours) {
    const hours = goodHourBranches(d).map(hz);
    if (hours.length) parts.push(`황도시 ${hours.join('·')}시`);
  }
  return parts.join(' · ');
}

/** 계산 기준 한 줄(용어) — 화면에서는 접어 둔다 */
export function basisOf(chart: SajuChart, partnerName: string | null): string {
  const y = chart.pillars.year.branch;
  const base = `일주 ${chart.pillars.day.ganzhi.hanja} · 띠 ${y.animal}(${y.hanja}) · 용신 ${EL_KO[chart.yongsin.yongsin]}(${ELEMENT_INFO[chart.yongsin.yongsin].hanja})`;
  return partnerName ? `${base} · 상대 ${partnerName}` : base;
}

export function headlineOf(sel: TaekilSelection, purpose: TaekilPurpose): string {
  const top = sel.top[0] ? sel.days.find((d) => d.almanac.date === sel.top[0]) : undefined;
  if (!top) return `이 날짜들에는 ${TAEKIL_PURPOSES[purpose].label}에 권할 만한 날이 없어요. 기간을 넓혀 다시 살펴보세요.`;
  const head = `가장 좋은 날은 ${ieyo(dayLabel(top))}`;
  return top.grade === 'best' || top.grade === 'good' ? head : `${head} 아주 좋은 날은 없어서, 무난한 날 가운데 골랐어요.`;
}

export interface TaekilTextContext {
  purpose: TaekilPurpose;
  mode: 'range' | 'dates';
  profileName: string;
  partnerName: string | null;
  chart: SajuChart;
  sel: TaekilSelection;
}

const reasonCtx = (ctx: TaekilTextContext) => ({ chart: ctx.chart, partnerName: ctx.partnerName });

/** 날짜별 DTO — locked 면 등급·순위만 */
export function dayDtos(ctx: TaekilTextContext, locked: boolean): TaekilDayDto[] {
  const { sel, purpose } = ctx;
  const byDate = new Map(sel.days.map((d) => [d.almanac.date, d]));
  const cutoff = sel.top.length ? byDate.get(sel.top[sel.top.length - 1]!)! : null;
  const rc = reasonCtx(ctx);
  return sel.days.map((d) => {
    const a = d.almanac;
    const rankIdx = sel.top.indexOf(a.date);
    const rank = rankIdx >= 0 ? rankIdx + 1 : null;
    return {
      date: a.date,
      weekday: weekdayKo(a.weekday),
      ganzhi: { hanja: a.ganzhi.hanja, hangul: a.ganzhi.hangul },
      lunar: a.lunar ? { month: a.lunar.month, day: a.lunar.day, isLeapMonth: a.lunar.isLeapMonth } : null,
      grade: d.grade,
      gradeLabel: TAEKIL_GRADE_LABEL[d.grade],
      rank,
      score: locked ? null : d.score,
      officer: locked ? null : { name: a.officer.name, hanja: a.officer.hanja },
      tianShen: locked ? null : { name: a.tianShen.name, hanja: a.tianShen.hanja, yellow: a.tianShen.yellow },
      summary: locked ? null : daySummary(d, purpose, rc),
      reasons: locked ? null : reasonsOf(d, purpose, rc),
      dropReason: locked || rank !== null ? null : dropReasonOf(d, cutoff, purpose, rc),
      goodHours: locked || rank === null ? null : goodHoursOf(d),
      basis: locked ? null : dayBasisOf(d, rank !== null),
    };
  });
}

// ---------------------------------------------------------------------------
// 섹션 — 종합 분석 / 목적 맞춤 조언 / 위기를 기회로 / 빠진 날짜
// ---------------------------------------------------------------------------

export const SECTION_KEYS = { overview: 'taekil_overview', advice: 'taekil_advice', turn: 'taekil_turn', dropped: 'taekil_dropped' } as const;
/** AI 로 문장을 다듬는 섹션 (목록형인 '빠진 날짜'는 규칙 기반 그대로) */
export const AI_SECTION_KEYS: readonly string[] = [SECTION_KEYS.overview, SECTION_KEYS.advice, SECTION_KEYS.turn];

const join = (xs: string[]) => xs.join(', ');

/** 내 일지·띠와 잘 맞는/부딪히는 지지 */
function personalPattern(chart: SajuChart): { friends: number[]; dayClash: number; yearClash: number } {
  const db = chart.pillars.day.branch.index;
  const friends = Array.from({ length: 12 }, (_, b) => b).filter((b) => b !== db && (sixCombine(b, db) || halfCombine(b, db)));
  const dayClash = Array.from({ length: 12 }, (_, b) => b).find((b) => branchClash(b, db))!;
  const yearClash = Array.from({ length: 12 }, (_, b) => b).find((b) => branchClash(b, chart.pillars.year.branch.index))!;
  return { friends, dayClash, yearClash };
}

function overviewSection(ctx: TaekilTextContext): ReadingSection {
  const { sel, purpose, chart, profileName } = ctx;
  const n = sel.days.length;
  const c = sel.counts;
  const first = sel.days[0]!.almanac.date;
  const last = sel.days[n - 1]!.almanac.date;
  const scope = ctx.mode === 'range' ? `${monthDay(first)}부터 ${monthDay(last)}까지 ${n}일` : `고른 후보 ${n}일`;
  const noun = PURPOSE_NOUN[purpose];
  const p1 = `${josa(scope, '을', '를')} ${noun} 기준으로 살펴봤어요. 아주 좋은 날 ${c.best}일, 좋은 날 ${c.good}일, 평범한 날 ${c.normal}일, 조심할 날 ${c.caution}일, 피할 날 ${c.avoid}일이에요.`;
  const paragraphs = [p1];
  const tops = sel.top.map((date) => sel.days.find((d) => d.almanac.date === date)!);
  const rc = reasonCtx(ctx);
  if (tops[0]) {
    const rest = tops.slice(1).map(dayLabel);
    paragraphs.push(`가장 좋은 날은 ${ieyo(dayLabel(tops[0]))} ${daySummary(tops[0], purpose, rc)}${rest.length ? ` 그다음은 ${rest.join(', ')} 순이에요.` : ''}`);
  } else {
    paragraphs.push(`이번에 고른 날짜에는 ${TAEKIL_PURPOSES[purpose].label}에 권할 만한 날이 없어요. 아래 '빠진 날짜와 이유'를 보고 기간을 넓히거나 다른 후보를 넣어 보세요.`);
  }
  const pat = personalPattern(chart);
  const who = `${profileName}님`;
  const myAnimal = chart.pillars.year.branch.animal;
  const friendDays = pat.friends.map(animalDay).join('·');
  const clashDay = animalDay(pat.dayClash);
  const yearClashDay = animalDay(pat.yearClash);
  const yearLine =
    pat.yearClash === pat.dayClash
      ? ` ${josa(clashDay, '은', '는')} ${who}의 띠인 ${myAnimal}띠와도 부딪혀요.`
      : pat.friends.includes(pat.yearClash)
        ? ` 다만 ${josa(yearClashDay, '은', '는')} ${who}의 띠인 ${myAnimal}띠와 부딪혀서 큰일에는 덜 써요.`
        : ` ${who}의 띠인 ${myAnimal}띠와 부딪히는 ${yearClashDay}도 큰일에는 덜 써요.`;
  paragraphs.push(`옛 달력에서는 날마다 열두 띠 동물이 하나씩 돌아가며 붙어요. ${who}에게는 ${josa(friendDays, '이', '가')} 잘 맞고, ${josa(clashDay, '은', '는')} ${josa(who, '과', '와')} 정면으로 부딪혀서 피하는 게 좋아요.${yearLine}`);
  const cause = (code: TaekilFactorCode) => sel.days.filter((d) => d.excluded && d.factors.some((f) => f.excludes && f.code === code)).length;
  const pa = cause('officer');
  const dc = cause('day_clash');
  const ss = cause('sari') + cause('sajeol');
  if (pa + dc + ss > 0) {
    const parts = [pa && `그달의 기운과 부딪히는 날 ${pa}일`, dc && `${who}과 정면으로 부딪히는 날 ${dc}일`, ss && `계절이 바뀌기 바로 전날 ${ss}일`].filter(Boolean);
    paragraphs.push(`처음부터 후보에서 뺀 날도 있어요. ${parts.join(', ')}이에요. 옛 달력과 사주에서 큰일을 하지 않는 날로 보는 날들이에요.`);
  }
  if (purpose === 'move') {
    const free = sel.days.filter((d) => d.almanac.sonFree);
    paragraphs.push(
      free.length > 1
        ? `이 기간에 손 없는 날은 ${join(free.map(dayLabel))}, 모두 ${free.length}일이에요.`
        : free.length === 1
          ? `이 기간에 손 없는 날은 ${dayLabel(free[0]!)} 하루예요.`
          : '이 기간에는 손 없는 날(음력 9·10·19·20·29·30일)이 없어요.',
    );
  }
  const best = tops[0];
  const db = chart.pillars.day.branch.index;
  return {
    key: SECTION_KEYS.overview,
    title: '종합 분석',
    summary: best ? `가장 좋은 날 ${dayLabel(best)} · 좋은 날 ${c.best + c.good}일 · 피할 날 ${c.avoid}일` : '권할 만한 날을 찾지 못했어요.',
    paragraphs,
    basis: `일주 ${chart.pillars.day.ganzhi.hanja} · 일지 ${hz(db)}와 육합·삼합 ${pat.friends.map(hz).join('·')} · 일지 충 ${hz(pat.dayClash)} · 년지(${myAnimal}띠) 충 ${hz(pat.yearClash)}${pa + dc + ss > 0 ? ` · 제외: 월파 ${pa}일, 일지 충 ${dc}일, 사리·사절 ${ss}일` : ''}`,
  };
}

const PURPOSE_ADVICE: Record<TaekilPurpose, { basis: string; closing: string }> = {
  move: { basis: '이사는 보통 짐을 새 집에 들이는 날을 이삿날로 봐요. 잔금·전입신고 날짜가 달라도 짐 들이는 날을 좋은 날에 맞추면 돼요.', closing: '새 집에 들어가면 창을 열어 환기하고 불을 밝혀 두는 것처럼, 시작을 정돈하는 작은 습관이 마음을 편하게 해 줘요.' },
  contract: { basis: '계약은 서명하고 도장을 찍는 날을 기준으로 봐요.', closing: '날짜와 상관없이 계약서 조항은 꼼꼼히 확인해 주세요. 큰 금액이 오가는 계약이라면 전문가 검토를 함께 받는 게 안전해요.' },
  exam: { basis: '면접·시험은 날짜를 고를 수 없는 경우가 많아요. 정해진 날이라면 그날의 등급을 참고해 준비의 강도를 조절해 보세요.', closing: '시험 전날은 무리한 공부보다 충분한 잠이 어떤 좋은 날보다 확실한 준비예요.' },
  wedding: { basis: '결혼식 날은 두 사람의 사주를 함께 봐요.', closing: '식장 예약과 가족·하객의 사정도 중요한 기준이에요. 추천한 세 날 가운데 실제 일정이 맞는 날을 고르면 충분해요.' },
  opening: { basis: '개업은 처음 문을 열고 손님을 맞는 날을 기준으로 봐요. 사업자 등록·임대차 계약 날짜는 계약 택일로 따로 살펴볼 수 있어요.', closing: '개업 날의 기운만큼 첫 한 달의 꾸준함이 중요해요. 손님 맞을 준비를 넉넉히 해 두세요.' },
  travel: { basis: '여행·출발은 집을 나서는 날을 기준으로 봐요.', closing: '날씨와 교통 상황이 좋은 날보다 먼저예요. 안전하게 다녀오세요.' },
};

function adviceSection(ctx: TaekilTextContext): ReadingSection {
  const { sel, purpose } = ctx;
  const tops = sel.top.map((date) => sel.days.find((d) => d.almanac.date === date)!);
  const best = tops[0];
  const pa = PURPOSE_ADVICE[purpose];
  const paragraphs: string[] = [];
  const basis: string[] = [];
  if (purpose === 'wedding') {
    paragraphs.push(ctx.partnerName ? `${pa.basis} ${ctx.partnerName}님과 부딪히는 날도 함께 걸렀어요.` : `${pa.basis} 상대의 사주를 함께 넣으면 두 사람 모두에게 맞는 날을 더 정확히 고를 수 있어요.`);
  } else paragraphs.push(pa.basis);

  if (best) {
    const hours = goodHoursOf(best);
    if (hours.length) {
      const how = {
        move: '짐을 들이기 시작하는 시간을 이 안에 잡아 보세요.',
        contract: '서명하는 시간을 이 안에 잡아 보세요.',
        exam: '면접 시간을 고를 수 있다면 이 안으로 잡아 보세요.',
        wedding: '예식 시간을 이 안에 잡아 보세요.',
        opening: '첫 손님을 맞는 시간을 이 안에 잡아 보세요.',
        travel: '집을 나서는 시간을 이 안에 잡아 보세요.',
      }[purpose];
      paragraphs.push(`${dayLabel(best)}에 시작하기 좋은 시간은 ${ieyo(join(hours))} ${how}`);
      basis.push(`${dayLabel(best)} 황도시 ${goodHourBranches(best).map(hz).join('·')}시`);
    }
  }
  const has = (d: TaekilDay, code: TaekilFactorCode) => d.factors.some((f) => f.code === code);
  const officerDays = (names: DayOfficer[]) => tops.filter((d) => names.includes(d.almanac.officer.name));
  const officerKinds = (days: TaekilDay[]) => [...new Set(days.map((d) => `'${OFFICER_PLAIN[d.almanac.officer.name]}'`))].join('·');
  switch (purpose) {
    case 'move': {
      if (best) {
        if (best.almanac.sonFree) paragraphs.push(`${josa(dayLabel(best), '은', '는')} 손 없는 날이라 방향 걱정 없이 옮겨도 돼요.`);
        else if (best.almanac.sonDirection) {
          const alt = sel.ranking.map((date) => sel.days.find((d) => d.almanac.date === date)!).find((d) => d.almanac.sonFree && !d.excluded);
          paragraphs.push(
            `${josa(dayLabel(best), '은', '는')} 이사를 방해한다는 귀신(손)이 ${best.almanac.sonDirection}쪽에 있는 날이에요. 지금 집에서 ${best.almanac.sonDirection}쪽으로 옮기는 이사라면${alt ? ` 손 없는 날인 ${dayLabel(alt)}도 함께 견줘 보세요.` : ' 시작 시간을 위의 좋은 시간에 맞춰 보세요.'}`,
          );
        }
      }
      if (sel.days.some((d) => has(d, 'gwigi'))) {
        paragraphs.push('예부터 이사를 꺼려 온 날은 점수를 낮춰 두었어요.');
        basis.push('귀기일(歸忌日) 감점');
      }
      break;
    }
    case 'contract': {
      const pens = tops.filter((d) => d.factors.some((f) => f.code === 'ten_god' && f.weight > 0));
      if (pens.length) {
        paragraphs.push(`${josa(join(pens.map(dayLabel)), '은', '는')} 정당한 거래와 서류에 힘이 실리는 날이라 계약과 잘 맞아요.`);
        basis.push(`${join(pens.map((d) => `${dayLabel(d)} ${d.tenGod}`))} — 정재·정인일`);
      }
      const officers = officerDays(['정', '성']);
      if (officers.length) {
        paragraphs.push(`${josa(join(officers.map(dayLabel)), '은', '는')} 옛 달력에서 ${officerKinds(officers)}로 봐서, 계약서를 쓰기 좋다고 꼽아요.`);
        basis.push(`${join(officers.map((d) => `${dayLabel(d)} ${d.almanac.officer.name}(${d.almanac.officer.hanja})일`))} — 통서 立券·交易에 길`);
      }
      break;
    }
    case 'exam': {
      const mc = sel.days.filter((d) => has(d, 'munchang') && !d.excluded);
      if (mc.length) {
        paragraphs.push(`${josa(join(mc.slice(0, 4).map(dayLabel)), '은', '는')} 글과 말이 잘 풀리는 날이에요. 원서 접수나 자기소개서 제출처럼 직접 고를 수 있는 일에 써 보세요.`);
        basis.push('문창귀인일');
      }
      break;
    }
    case 'wedding': {
      if (sel.days.some((d) => d.almanac.leapMonth)) paragraphs.push('기간 안에 윤달이 있어요. 요즘은 윤달 결혼을 꺼리는 편이라 그 날들은 점수를 조금 낮췄어요. 가족과 상의해 정하면 돼요.');
      if (sel.days.some((d) => has(d, 'pengzu'))) {
        paragraphs.push('돼지날은 결혼식을 올리지 않는다는 오래된 금기가 있어 점수를 낮췄어요.');
        basis.push('팽조백기 亥不嫁娶 — 해일(亥日) 감점');
      }
      break;
    }
    case 'opening': {
      const good = officerDays(['개', '성', '만']);
      if (good.length) {
        paragraphs.push(`${josa(join(good.map(dayLabel)), '은', '는')} 옛 달력에서 ${officerKinds(good)}로 봐서, 가게 문을 열기 좋다고 꼽아요.`);
        basis.push(`${join(good.map((d) => `${dayLabel(d)} ${d.almanac.officer.name}(${d.almanac.officer.hanja})일`))} — 통서 開市에 길`);
      }
      break;
    }
    case 'travel': {
      const ym = sel.days.filter((d) => has(d, 'yeokma') && !d.excluded);
      if (ym.length) {
        paragraphs.push(`${josa(join(ym.slice(0, 4).map(dayLabel)), '은', '는')} 움직임에 힘이 실리는 날이에요.`);
        basis.push('역마일');
      }
      if (sel.days.some((d) => has(d, 'pengzu'))) {
        paragraphs.push('뱀날은 먼 길을 떠나지 않는다는 오래된 금기가 있어 점수를 낮췄어요.');
        basis.push('팽조백기 巳不遠行 — 사일(巳日) 감점');
      }
      break;
    }
  }
  paragraphs.push(pa.closing);
  return {
    key: SECTION_KEYS.advice,
    title: `${TAEKIL_PURPOSES[purpose].label} 맞춤 조언`,
    summary: `${TAEKIL_PURPOSES[purpose].label} 날을 고를 때 기준과 시간·준비`,
    paragraphs,
    ...(basis.length ? { basis: basis.join(' · ') } : {}),
  };
}

function turnSection(ctx: TaekilTextContext): ReadingSection {
  const { sel, purpose } = ctx;
  const count = (pred: (d: TaekilDay) => boolean) => sel.days.filter(pred).length;
  const has = (code: TaekilFactorCode) => (d: TaekilDay) => d.factors.some((f) => f.code === code);
  const paragraphs = ['정해진 일정이 하필 피할 날이라면 날짜를 억지로 바꾸기보다, 그날의 약한 고리를 알고 대비하는 쪽이 현실적이에요.'];
  const basis: string[] = [];
  if (count(has('day_clash'))) {
    paragraphs.push('나와 정면으로 부딪히는 날에는 가까운 사람과도 부딪히기 쉬워요. 그날은 결정을 서두르지 말고, 예민한 대화는 하루 이틀 앞뒤로 옮겨 보세요.');
    basis.push('일지 충');
  }
  if (count((d) => d.almanac.officer.name === '파')) {
    const how = purpose === 'move' ? '이사라면 짐 정리와 청소를 이날 하고, 입주는 다른 날로 나누는 방법도 있어요.' : '새로 벌이는 일 대신 준비와 정리를 이날 하고, 시작은 다음 좋은 날로 넘겨 보세요.';
    paragraphs.push(`그달의 기운과 부딪히는 날에는 새로 시작하기보다 정리와 마무리에 힘을 쓰는 게 좋아요. ${how}`);
    basis.push('월파(月破)일');
  }
  if (count((d) => Boolean(d.almanac.sari || d.almanac.sajeol))) {
    paragraphs.push('계절이 바뀌기 바로 전날이라면 하루만 미뤄 보세요. 다음 날부터는 새 계절이 시작돼요.');
    basis.push('사리·사절일');
  }
  if (count((d) => !d.almanac.tianShen.yellow)) {
    paragraphs.push('하늘의 도움이 쉬는 날이라도, 그날 가운데 좋은 시간에 맞춰 시작하면 괜찮다고 봐요.');
    basis.push('흑도일은 황도시에 시작');
  }
  paragraphs.push('택일은 더 좋은 날을 고르는 참고예요. 어떤 날이든 준비를 꼼꼼히 하고 마음을 편히 먹는 것이 가장 큰 힘이 돼요.');
  return { key: SECTION_KEYS.turn, title: '위기를 기회로', summary: '피할 날을 써야 할 때의 대처법', paragraphs, ...(basis.length ? { basis: basis.join(' · ') } : {}) };
}

function droppedSection(ctx: TaekilTextContext): ReadingSection {
  const { sel } = ctx;
  const notTop = sel.days.filter((d) => !sel.top.includes(d.almanac.date));
  const groups = new Map<string, TaekilDay[]>();
  const K = { pa: '그달의 기운과 부딪히는 날', clash: '나와 정면으로 부딪히는 날', season: '계절이 바뀌기 바로 전날', bad: '조심할 점이 겹친 날', low: '점수가 추천 세 날보다 낮은 날' };
  for (const d of notTop) {
    const ex = excluder(d);
    const key = ex ? (ex.code === 'officer' ? K.pa : ex.code === 'day_clash' ? K.clash : K.season) : d.grade === 'avoid' ? K.bad : K.low;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const order = [K.pa, K.clash, K.season, K.bad, K.low];
  // 날짜가 많은 묶음(점수가 낮은 날)은 개수만 — 날짜별 이유는 목록에서 본다
  const paragraphs = order.filter((k) => groups.has(k)).map((k) => {
    const ds = groups.get(k)!;
    return ds.length > 8 ? `${k} — ${ds.length}일` : `${k} — ${join(ds.map(dayLabel))}`;
  });
  if (!paragraphs.length) paragraphs.push('고른 날짜가 모두 추천 날짜에 들었어요.');
  else paragraphs.push('날짜마다 자세한 이유는 위 목록에서 날짜를 눌러 확인할 수 있어요.');
  return { key: SECTION_KEYS.dropped, title: '빠진 날짜와 이유', summary: `추천 세 날 밖의 ${notTop.length}일`, paragraphs, basis: '월파일 · 일지 충 · 사리·사절일은 점수와 상관없이 처음부터 뺐어요' };
}

/** 전체 섹션(결제 후) */
export function buildSections(ctx: TaekilTextContext): ReadingSection[] {
  return [overviewSection(ctx), adviceSection(ctx), turnSection(ctx), droppedSection(ctx)];
}

/** 잠금 상태 섹션 — 제목·짧은 소개만(종합 분석은 첫 문단 미리보기) */
export function lockedSections(ctx: TaekilTextContext, productId: string): ReadingSection[] {
  const full = buildSections(ctx);
  const teaser: Record<string, string> = {
    [SECTION_KEYS.overview]: '좋은 날이 모인 때, 나와 잘 맞는 날과 부딪히는 날',
    [SECTION_KEYS.advice]: `${TAEKIL_PURPOSES[ctx.purpose].label}에 맞춘 시간·방향·준비`,
    [SECTION_KEYS.turn]: '피할 날을 써야 할 때의 대처법',
    [SECTION_KEYS.dropped]: `추천 세 날 밖의 ${ctx.sel.days.length - ctx.sel.top.length}일, 날짜마다 빠진 이유`,
  };
  return full.map((s) => ({
    key: s.key,
    title: s.title,
    summary: teaser[s.key] ?? s.summary,
    paragraphs: s.key === SECTION_KEYS.overview ? s.paragraphs.slice(0, 1) : [],
    locked: true,
    unlockProductId: productId,
  }));
}
