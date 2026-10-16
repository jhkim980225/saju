/**
 * 택일 문장 — 엔진(@saju/core taekil)의 요인 코드를 읽는 문장으로 바꾼다(규칙 기반).
 * 문체: docs/PLAIN_KOREAN.md — 택일을 처음 접하는 성인도 이해할 수 있는 차분한 설명체.
 * - 짧은 이름(label)은 쉬운 말로, 문장(text)에는 건제12신·12천신·일진·일지·충 같은 정식 용어를 쓰되
 *   날짜 하나(화면 하나)에서 처음 나올 때만 뜻을 붙인다. 한자는 정의 자리의 괄호에만.
 * - 글자별 근거(일진 庚辰 · 건제12신 파(破) …)는 이유마다 term, 날짜마다 basis 에 둔다('택일·사주 용어로 보면'에 접힘).
 * - 등급·점수는 전통 요소를 더해 매긴 달빛사주 기준임을 안내문에서 밝힌다.
 * - 날짜의 성격은 그날의 띠 동물(쥐날·말날)처럼 바로 떠오르는 말로도 함께 설명한다.
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

export const TAEKIL_DISCLAIMER =
  '택일은 옛 달력(통서)과 사주를 바탕으로 날짜를 견주어 보는 참고 정보입니다. 날짜별 등급과 점수는 전통 택일 요소를 더해 매긴 달빛사주 기준이에요. 실제 일정과 사정을 함께 살펴 정해 주세요.';

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
  평: '무난하고 고른 날',
  정: '자리를 정하는 날',
  집: '지키고 유지하는 날',
  파: '그달의 기운과 부딪히는 날',
  위: '조심해서 움직여야 하는 날',
  성: '일이 이루어지는 날',
  수: '거두어들이는 날',
  개: '막힌 일이 풀리는 날',
  폐: '닫히고 막히는 날',
};

/** 용어의 짧은 뜻 — 날짜 하나(또는 섹션 하나)에서 처음 나올 때만 괄호로 붙인다 */
const GLOSS = {
  건제12신: '옛 달력이 날마다 붙이는 열두 가지 성격',
  '12천신': '날마다 차례로 드는 열두 신',
  일진: '그날의 간지',
  일지: '태어난 날의 지지',
  일간: '태어난 날의 천간',
  일주: '태어난 날의 간지',
  충: '정면으로 대립하는 관계',
  형: '서로 마찰을 일으키는 관계',
  자형: '같은 지지가 겹쳐 생기는 형',
  원진: '서로 꺼리는 관계',
  파: '결합을 깨뜨리는 관계',
  해: '서로 방해하는 관계',
  육합: '두 지지가 짝을 이뤄 결합하는 관계',
  삼합: '세 지지가 모여 한 오행을 이루는 관계',
  천간합: '두 천간이 결합하는 관계',
  천간충: '두 천간이 대립하는 관계',
  천극지충: '천간은 극하고 지지는 충하는 관계',
  천을귀인: '귀인의 도움을 뜻하는 대표적인 길신',
  공망: '기운이 온전히 작용하지 않는다고 보는 지지',
  용신: '사주의 균형을 맞추는 데 가장 필요하다고 보는 오행',
  기신: '용신을 극하는 오행',
  문창귀인: '학문과 문장에 관련된 길신',
  역마: '이동과 변화를 뜻하는 신살',
} as const;
type GlossTerm = keyof typeof GLOSS;

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
  /** 이미 뜻을 붙인 용어 — 같은 날짜 안에서 두 번째부터는 용어만 쓴다 */
  explained?: Set<string>;
}

/** 용어 — 처음이면 '충(정면으로 대립하는 관계)', 이미 설명했으면 '충' */
function term(ctx: ReasonContext, name: GlossTerm): string {
  if (ctx.explained?.has(name)) return name;
  ctx.explained?.add(name);
  return `${name}(${GLOSS[name]})`;
}

function officerPlain(f: TaekilFactor, purpose: TaekilPurpose, ctx: ReasonContext): Plain {
  const name = f.label.slice(0, 1) as DayOfficer;
  const kind = OFFICER_PLAIN[name] ?? f.label;
  const label = f.label.replace(/일$/, ''); // '정(定)'
  const head = `${term(ctx, '건제12신')}으로는`;
  if (name === '파')
    return { short: kind, text: `${head} 파(破)일이에요. 그날의 지지가 그달의 지지와 정면으로 대립하는 월파일이라, 옛 달력에서 큰일을 하지 않는 날로 봐요.` };
  const noun = PURPOSE_NOUN[purpose];
  const w = OFFICER_WEIGHT[purpose][name];
  const lead = `${head} '${kind}'인 ${label}일이에요.`;
  // 이름이 좋게 들리는데 목적에는 꺼리거나, 조심스럽게 들리는데 목적에는 좋은 날 — '다만/그래도'로 이어 읽히게
  const sounds = ['건', '제', '만', '정', '성', '개'].includes(name) ? 'good' : ['위', '폐'].includes(name) ? 'bad' : 'plain';
  if (w >= 3) return { short: `${noun}에 좋은 날`, text: `${lead} ${sounds === 'bad' ? `그래도 ${noun}에는 좋다고 꼽아요.` : `${noun}에 좋다고 꼽는 날입니다.`}` };
  if (w > 0) return { short: `${noun}에 무난한 날`, text: `${lead} ${sounds === 'bad' ? `그래도 ${noun}에는 무난한 편이에요.` : `${noun}에도 무난한 편이에요.`}` };
  if (w <= -3) return { short: `${noun}에는 꺼리는 날`, text: `${lead} ${sounds === 'good' ? `다만 ${noun}에는 꺼리는 날로 봐요.` : `${noun}에는 꺼리는 날로 봐요.`}` };
  if (w < 0) return { short: `${josa(noun, '과', '와')} 잘 안 맞는 날`, text: `${lead} ${sounds === 'good' ? `다만 ${noun}에는 썩 잘 맞지 않아요.` : `${noun}에는 썩 잘 맞지 않는 편이에요.`}` };
  return { short: kind, text: `${lead} ${noun}에는 좋지도 나쁘지도 않은 날이에요.` };
}

/** 목적별 사주 요인(십성) — 엔진의 detail 문구로 갈래를 나눠, 그날 천간의 십성과 그 뜻을 함께 말한다 */
function tenGodPlain(f: TaekilFactor, purpose: TaekilPurpose, ctx: ReasonContext): Plain {
  const d = f.detail ?? '';
  const noun = PURPOSE_NOUN[purpose];
  const tg = f.label.replace(/일$/, ''); // '정재'
  const is = (gloss: string) => `이날의 천간은 내 ${term(ctx, '일간')} 기준으로 ${tg}(${gloss})에 해당해요.`;
  if (d.includes('평가·조직')) return { short: '평가받는 일에 힘이 실리는 날', text: `${is('직장과 평가를 뜻하는 관성')} 면접·시험처럼 평가받는 일에 힘이 실린다고 봐요.` };
  if (d.includes('공부·문서')) return { short: '공부와 서류에 힘이 실리는 날', text: `${is('학업과 문서를 뜻하는 인성')} 배운 것을 잘 꺼내 쓰고 서류 일을 처리하기 좋다고 봐요.` };
  if (d.includes('말이 앞서')) return { short: '말이 앞서기 쉬운 날', text: `${is('표현과 언변을 뜻하는 십성')} 말이 생각보다 앞서기 쉬우니, 면접이라면 한 번 더 생각하고 답하는 편이 좋아요.` };
  if (d.includes('정당한 거래')) return { short: '정직한 거래에 좋은 날', text: `${is('정당한 거래와 고정 수입을 뜻하는 십성')} 계약과 잘 맞는다고 봐요.` };
  if (d.includes('문서·도장')) return { short: '서류와 도장에 좋은 날', text: `${is('문서와 도장을 뜻하는 십성')} 서류를 쓰고 도장을 찍는 일에 힘이 실린다고 봐요.` };
  if (d.includes('재물이 나뉘거나')) return { short: '돈 문제로 다투기 쉬운 날', text: `${is('재물을 나누거나 다투는 일과 연결되는 십성')} 금액과 조건을 한 번 더 확인해 두세요.` };
  if (d.includes('손님과 일거리')) return { short: '손님과 일거리가 생기는 날', text: `${is('일거리와 의식주의 여유를 뜻하는 십성')} 손님과 일거리가 생기기 쉬워 가게 문을 열기에 좋다고 봐요.` };
  if (d.includes('돈이 들어오는')) return { short: '돈이 들어오는 날', text: `${is('재물을 뜻하는 재성')} 돈이 들어오는 흐름으로 보아 개업에 힘이 돼요.` };
  if (d.includes('배우자 자리')) {
    const spouse = tg === '겁재' ? '배우자를 뜻하는 재성을 극하는 십성' : '배우자를 뜻하는 관성을 극하는 십성';
    return { short: '결혼식에는 덜 맞는 날', text: `${is(spouse)} 결혼식 날로는 한 번 더 살펴보는 편이 좋다고 봐요.` };
  }
  if (d.includes('배우자를 뜻하는')) return { short: '배우자 인연이 닿는 날', text: `${is(d.startsWith('남성') ? '남성에게 배우자를 뜻하는 십성' : '여성에게 배우자를 뜻하는 십성')} 결혼식에 힘이 된다고 봐요.` };
  if (d.includes('인연을 뜻하는')) return { short: '인연의 기운이 드는 날', text: `${is(d.startsWith('남성') ? '남성에게 이성 인연을 뜻하는 십성' : '여성에게 이성 인연을 뜻하는 십성')} 좋은 인연의 기운이 드는 날로 봐요.` };
  if (d.includes('집과 문서')) return { short: '집과 서류 일에 좋은 날', text: `${is('집과 문서를 뜻하는 십성')} 이사에 도움이 된다고 봐요.` };
  return f.weight > 0
    ? { short: `${noun}에 힘이 되는 날`, text: `이날의 천간이 내 사주에서 ${noun}에 힘이 되는 십성에 해당해요.` }
    : { short: `${noun}에 아쉬운 날`, text: `이날의 천간이 내 사주에서 ${noun}에는 조금 아쉬운 십성에 해당해요.` };
}

/** 요인 하나 → 화면에 보이는 짧은 이름과 문장. 용어는 처음 나올 때 뜻을 붙이고, 한자는 정의 자리의 괄호에만 */
export function plainReason(f: TaekilFactor, purpose: TaekilPurpose, ctx: ReasonContext = {}): Plain {
  const partner = ctx.partnerName ? `${ctx.partnerName}님` : '상대';
  const dA = ctx.dayBranch !== undefined ? animalDay(ctx.dayBranch) : '이날';
  const myA = ctx.chart ? `${animal(ctx.chart.pillars.year.branch.index)}띠` : '내 띠';
  /** 상대 띠 — detail '일진 午 ↔ 상대 년지 子' 의 마지막 한자 */
  const pB = BRANCHES.find((b) => b.hanja === (f.detail ?? '').trim().slice(-1));
  const pA = pB ? `${pB.animal}띠인 ${partner}` : `${partner}의 띠`;
  const dayAnimalLead = ctx.dayBranch !== undefined ? `${dA}이라` : '이날은';
  /** 12천신 이름 — label '황도일(청룡)' */
  const god = /\((.+)\)/.exec(f.label)?.[1] ?? '';
  // 용어는 문장을 만들 때 처음 쓰는 순서대로 뜻을 붙이므로, 요인마다 필요할 때만 만든다
  const make: Partial<Record<TaekilFactorCode, () => Plain>> = {
    yellow_road: () => ({ short: '옛 달력의 길한 날', text: `${term(ctx, '12천신')} 가운데 길한 황도에 해당하는 ${josa(god, '이', '가')} 드는 날이에요. 일을 시작하기에 무난하다고 봐요.` }),
    black_road: () => ({ short: '옛 달력의 덜 좋은 날', text: `${term(ctx, '12천신')} 가운데 흑도에 해당하는 ${josa(god, '이', '가')} 드는 날이에요. 큰일이라면 이날 가운데 길한 시간(황도시)에 맞춰 시작하는 방법이 있어요.` }),
    cheonsa: () => ({ short: '한 해에 몇 번 없는 길일', text: '하늘이 허물을 용서한다는 천사일(天赦日)이에요. 계절마다 정해진 간지의 날에만 들어, 새로 시작하는 일에 두루 좋은 길일로 꼽아요.' }),
    cheondeok: () => ({ short: '하늘의 덕이 드는 날', text: '그달에 하늘의 덕이 드는 천덕일이에요. 흉한 기운을 덜어 주어 여러 일에 두루 길하다고 봐요.' }),
    woldeok: () => ({ short: '달의 덕이 드는 날', text: '그달의 덕이 드는 월덕일이에요. 다툼이 줄고 일이 원만하게 진행된다고 봐요.' }),
    sari: () => ({ short: `${f.detail ?? '춘분·하지·추분·동지 전날'}(사리일)`, text: `${ieyo(f.detail ?? '절기 전날')} 춘분·하지·추분·동지의 전날을 사리일(四離日)이라 해서, 옛 달력에서 큰일을 피해요. 하루만 미뤄도 이 조건에서 벗어나요.` }),
    sajeol: () => ({ short: `${f.detail ?? '입춘·입하·입추·입동 전날'}(사절일)`, text: `${ieyo(f.detail ?? '절기 전날')} 계절이 바뀌는 입춘·입하·입추·입동의 전날을 사절일(四絶日)이라 해서, 옛 달력에서 큰일을 피해요. 하루만 미뤄도 이 조건에서 벗어나요.` }),
    month_start: () => {
      const t = f.label.replace(/\s*절입일$/, '');
      return { short: `${josa(t, '이', '가')} 드는 날`, text: `절기 ${josa(t, '이', '가')} 드는 날이에요. 명리학과 옛 달력에서는 이날부터 새 달로 봐요.` };
    },
    wolgi: () => ({ short: '예부터 큰일을 피한 날', text: `${ieyo(f.detail ?? '음력 5·14·23일')} 음력 5일·14일·23일은 월기일(月忌日)로, 예부터 큰일을 피해 왔어요.` }),
    son_free: () => ({ short: '손 없는 날', text: `${f.detail ? `${f.detail}이라, ` : ''}이사를 방해한다는 귀신(손)이 어느 방향에도 없는 날이에요. 이삿날로 가장 많이 선택해요.` }),
    son_direction: () => {
      const dir = f.label.replace(/^손\s*/, '');
      return {
        short: `손이 ${dir}에 있는 날`,
        text: `이사를 방해한다는 귀신(손)이 ${dir}에 있는 날이에요. ${purpose === 'travel' ? '그쪽으로 길을 떠난다면' : '지금 집에서 그쪽으로 옮긴다면'} 꺼리는 풍습이 있어요.`,
      };
    },
    gwigi: () => ({ short: '이사를 꺼려 온 날', text: '예부터 이사하거나 먼 길에서 돌아오는 일을 꺼려 온 귀기일(歸忌日)이에요.' }),
    leap_month: () =>
      purpose === 'wedding'
        ? { short: '윤달', text: '요즘 풍습에서는 윤달 결혼을 꺼리는 편이라 달빛사주 기준으로 점수를 조금 낮췄어요. 다만 옛 세시 기록(동국세시기)에는 윤달을 혼인하기 좋은 달로 적고 있어요.' }
        : { short: '윤달', text: '윤달은 탈이 없는 달이라 해서, 예부터 이사나 집수리를 이때 하기도 했어요.' },
    pengzu: () =>
      purpose === 'wedding'
        ? { short: '예부터 결혼을 피한 날', text: "날마다 피할 일을 적은 옛 금기 목록인 팽조백기에 '돼지날(해일)에는 혼례를 하지 않는다'는 항목이 있어요." }
        : { short: '예부터 먼 길을 피한 날', text: "날마다 피할 일을 적은 옛 금기 목록인 팽조백기에 '뱀날(사일)에는 먼 길을 떠나지 않는다'는 항목이 있어요." },
    day_clash: () => ({ short: '나와 정면으로 부딪히는 날', text: `이날의 ${term(ctx, '일진')}이 내 ${term(ctx, '일지')}와 ${term(ctx, '충')}을 이뤄요. 일지는 나 자신과 배우자의 자리로 보기 때문에, 좋은 날을 고를 때 가장 먼저 빼는 날이에요.` }),
    day_punish: () => ({ short: '마찰이 생기기 쉬운 날', text: `이날의 ${term(ctx, '일진')}이 내 ${term(ctx, '일지')}와 ${term(ctx, f.label.includes('자형') ? '자형' : '형')}을 이뤄요. 마찰이나 번거로운 일이 생기기 쉽다고 봐요.` }),
    day_wonjin: () => ({ short: '괜히 서운해지기 쉬운 날', text: `이날의 ${term(ctx, '일진')}이 내 ${term(ctx, '일지')}와 ${term(ctx, '원진')}이에요. 괜히 서운하고 마음이 어긋나기 쉽다고 봐요.` }),
    day_break: () => ({ short: '약속이 틀어지기 쉬운 날', text: `이날의 ${term(ctx, '일진')}이 내 ${term(ctx, '일지')}와 ${term(ctx, '파')}예요. 약속이 틀어지지 않게 한 번 더 확인해 두세요.` }),
    day_harm: () => ({ short: '작은 오해가 생기기 쉬운 날', text: `이날의 ${term(ctx, '일진')}이 내 ${term(ctx, '일지')}와 ${term(ctx, '해')}예요. 사소한 오해에만 주의하면 돼요.` }),
    day_six: () => ({ short: '나와 잘 맞는 날', text: `이날의 ${term(ctx, '일진')}이 내 ${term(ctx, '일지')}와 ${term(ctx, '육합')}을 이뤄요. 사람 사이도 일도 무난하게 진행되기 쉬워요.` }),
    day_half: () => ({ short: '나에게 힘을 보태는 날', text: `이날의 ${term(ctx, '일진')}이 내 ${term(ctx, '일지')}와 ${term(ctx, '삼합')}의 짝을 이뤄요. 같은 방향으로 힘이 모인다고 봐요.` }),
    year_clash: () => ({ short: '내 띠와 부딪히는 날', text: `${dayAnimalLead} ${josa(myA, '과', '와')} ${term(ctx, '충')}을 이뤄요. 큰일에는 덜 쓰는 편이에요.` }),
    year_punish: () => ({ short: '내 띠와 껄끄러운 날', text: `${dayAnimalLead} ${josa(myA, '과', '와')} ${term(ctx, f.label.includes('자형') ? '자형' : '형')}을 이뤄요. 일정이 번거로워지기 쉬워요.` }),
    year_wonjin: () => ({ short: '내 띠와 잘 안 맞는 날', text: `${dayAnimalLead} ${josa(myA, '과', '와')} ${term(ctx, '원진')}이에요. 마음이 어긋나기 쉬워요.` }),
    year_break: () => ({ short: '내 띠와 살짝 어긋나는 날', text: `${dayAnimalLead} ${josa(myA, '과', '와')} ${term(ctx, '파')}예요. 서두르지 않으면 큰 문제는 없어요.` }),
    year_harm: () => ({ short: '내 띠와 조금 엇갈리는 날', text: `${dayAnimalLead} ${josa(myA, '과', '와')} ${term(ctx, '해')}예요. 작은 일은 한 번 더 확인해 두세요.` }),
    year_six: () => ({ short: '내 띠와 잘 맞는 날', text: `${dayAnimalLead} ${josa(myA, '과', '와')} ${term(ctx, '육합')}을 이뤄요. 주변의 도움을 받기 쉬워요.` }),
    year_half: () => ({ short: '내 띠와 한편이 되는 날', text: `${dayAnimalLead} ${josa(myA, '과', '와')} ${term(ctx, '삼합')}의 짝을 이뤄요. 힘을 보태 주는 날로 봐요.` }),
    stem_combine: () => ({ short: '나와 잘 어울리는 날', text: `이날의 천간이 내 ${term(ctx, '일간')}과 ${term(ctx, '천간합')}을 이뤄요. 사람을 만나거나 일을 맞춰 가기 편하다고 봐요.` }),
    stem_clash: () => ({ short: '마음이 급해지기 쉬운 날', text: `이날의 천간이 내 ${term(ctx, '일간')}과 ${term(ctx, '천간충')}을 이뤄요. 마음이 급해지기 쉬우니 결정은 조금 늦추는 편이 좋아요.` }),
    full_clash: () => ({ short: '나와 크게 부딪히는 날', text: `이날의 ${term(ctx, '일진')}이 내 ${term(ctx, '일주')}와 천간·지지 모두 부딪히는 ${term(ctx, '천극지충')}이에요. 큰일은 피하는 편이 좋아요.` }),
    cheoneul: () => ({ short: '도와주는 사람이 나타나는 날', text: `이날의 지지가 내 ${term(ctx, '일간')}의 ${term(ctx, '천을귀인')}에 해당해요. 힘들 때 도와주는 사람을 만나기 쉽다고 봐요.` }),
    gongmang: () => ({ short: '애쓴 만큼 남지 않기 쉬운 날', text: `이날의 지지가 내 ${term(ctx, '일주')}의 ${term(ctx, '공망')}에 해당해요. 힘을 쏟아도 결과가 덜 남기 쉬워, 중요한 마무리는 다른 날로 미루는 편이 좋아요.` }),
    yongsin: () => ({ short: '나에게 필요한 기운이 드는 날', text: `이날의 ${term(ctx, '일진')}에 내 ${term(ctx, '용신')}이나 용신을 돕는 오행의 기운이 들어 있어요. 평소보다 일을 수월하게 진행하기 쉽다고 봐요.` }),
    gisin: () => ({ short: '나와 덜 맞는 기운이 드는 날', text: `이날의 ${term(ctx, '일진')}에 내 ${term(ctx, '기신')}의 기운이 들어 있어요. 나쁜 날이라는 뜻은 아니지만 일이 더디게 느껴질 수 있으니, 일정을 넉넉히 잡아 두세요.` }),
    munchang: () => ({ short: '글과 말이 잘 풀리는 날', text: `이날의 지지가 내 ${term(ctx, '일간')}의 ${term(ctx, '문창귀인')}에 해당해요. 공부와 시험, 글쓰기에 힘이 실린다고 봐요.` }),
    yeokma: () => ({ short: '움직임에 힘이 실리는 날', text: `${term(ctx, '역마')}가 드는 날이에요. 움직이고 옮기는 일에 힘이 실린다고 봐요.` }),
    partner_clash: () => ({ short: `${josa(partner, '과', '와')} 부딪히는 날`, text: `이날의 ${term(ctx, '일진')}이 ${partner}의 ${term(ctx, '일지')}와 ${term(ctx, '충')}을 이뤄요. 두 사람이 함께하는 날로는 피하는 편이 좋아요.` }),
    partner_punish: () => ({ short: `${partner}에게 마찰이 생기기 쉬운 날`, text: `이날의 ${term(ctx, '일진')}이 ${partner}의 ${term(ctx, '일지')}와 ${term(ctx, '형')}을 이뤄요. 작은 마찰에만 주의하면 돼요.` }),
    partner_wonjin: () => ({ short: `${josa(partner, '이', '가')} 서운해지기 쉬운 날`, text: `이날의 ${term(ctx, '일진')}이 ${partner}의 ${term(ctx, '일지')}와 ${term(ctx, '원진')}이에요. 서로 서운한 일이 없게 마음을 한 번 더 살펴 주세요.` }),
    partner_six: () => ({ short: `${josa(partner, '과', '와')}도 잘 맞는 날`, text: `이날의 ${term(ctx, '일진')}이 ${partner}의 ${term(ctx, '일지')}와도 ${term(ctx, '육합')}을 이뤄요. 두 사람 모두에게 무난한 날이에요.` }),
    partner_year_clash: () => ({ short: `${partner}의 띠와 부딪히는 날`, text: `${dayAnimalLead} ${josa(pA, '과', '와')} ${term(ctx, '충')}을 이뤄요. 두 사람이 함께하는 큰일에는 덜 쓰는 편이에요.` }),
    partner_year_six: () => ({ short: `${partner}의 띠와 잘 맞는 날`, text: `${dayAnimalLead} ${josa(pA, '과', '와')} ${term(ctx, '육합')}을 이뤄요. 두 사람에게 무난한 날이에요.` }),
    partner_cheoneul: () => ({ short: `${josa(partner, '을', '를')} 돕는 사람이 나타나는 날`, text: `이날의 지지가 ${partner}의 ${term(ctx, '일간')}에 대한 ${term(ctx, '천을귀인')}에 해당해요. ${partner}에게 힘이 되어 주는 사람이 나타나기 쉽다고 봐요.` }),
  };
  if (f.code === 'officer') return officerPlain(f, purpose, ctx);
  if (f.code === 'ten_god') return tenGodPlain(f, purpose, ctx);
  // 짝이 맞는 관계(육합·삼합)와 어긋나는 관계가 한날에 겹치면, 어긋나는 쪽을 '짝을 이루는 날이지만'으로 이어 앞뒤가 맞게
  const m = /^(day|year|partner)_(punish|wonjin|break|harm)$/.exec(f.code);
  if (m && ctx.siblings?.some((c) => c === `${m[1]}_six` || c === `${m[1]}_half`)) {
    const base = m[1] as 'day' | 'year' | 'partner';
    const kind = m[2] as 'punish' | 'wonjin' | 'break' | 'harm';
    const who = base === 'day' ? '내 일지와' : base === 'year' ? josa(myA, '과', '와') : `${partner}의 일지와`;
    // 관계 용어의 뜻을 먼저 붙인 뒤 짧은 이름만 가져온다(make 의 본문은 쓰지 않는다)
    const rel = term(ctx, ({ punish: f.label.includes('자형') ? '자형' : '형', wonjin: '원진', break: '파', harm: '해' } as const)[kind]);
    const plain = make[f.code]!();
    const but = { punish: '조금 껄끄러운 면도 있어요', wonjin: '괜히 서운해지는 면도 있어요', break: '작은 약속은 엇갈리기 쉬워요', harm: '사소한 오해가 생길 수 있어요' }[kind];
    const tip = { day: '중요한 일은 한 번 더 확인해 두세요.', year: '일정을 넉넉히 잡아 두면 괜찮아요.', partner: '두 사람의 일정만 한 번 더 맞춰 보세요.' }[base];
    // 같은 상대와 어긋나는 요인이 둘(巳申: 형·파)이면 당부는 처음 한 번만
    const firstBad = ctx.siblings.find((c) => new RegExp(`^${base}_(punish|wonjin|break|harm)$`).test(c));
    const text = `${who} 짝을 이루는 날이지만 ${rel}도 함께 있어, ${but}.`;
    return { short: plain.short, text: f.code === firstBad ? `${text} ${tip}` : text };
  }
  return make[f.code]?.() ?? { short: f.label, text: f.label };
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

/** 날짜 하나의 이유 목록 — 화면은 좋은 점 → 조심할 점 → 참고 순으로 묶어 보이므로, 그 순서로 용어의 뜻을 처음 한 번만 붙인다 */
export function reasonsOf(d: TaekilDay, purpose: TaekilPurpose, ctx: Omit<ReasonContext, 'dayBranch'> = {}): TaekilReasonDto[] {
  const rc: ReasonContext = { ...ctx, dayBranch: d.almanac.ganzhi.branch, siblings: d.factors.map((f) => f.code), explained: new Set() };
  const TONE_ORDER = { good: 0, bad: 1, info: 2 } as const;
  const shown = [...d.factors].sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
  const plain = new Map(shown.map((f) => [f, plainReason(f, purpose, rc)] as const));
  return d.factors.map((f) => {
    const p = plain.get(f)!;
    return { tone: f.tone, label: p.short, text: p.text, term: termOf(f), weight: f.weight, excludes: Boolean(f.excludes) };
  });
}

const goods = (d: TaekilDay) => d.factors.filter((f) => f.weight > 0).sort((a, b) => b.weight - a.weight);
const bads = (d: TaekilDay) => d.factors.filter((f) => f.weight < 0).sort((a, b) => a.weight - b.weight);
const excluder = (d: TaekilDay) => d.factors.find((f) => f.excludes) ?? null;

/** 처음부터 후보에서 빼는 까닭 — 쉬운 말에 용어를 괄호로 */
const EXCLUDE_WHY: Partial<Record<TaekilFactorCode, string>> = {
  officer: '그달의 기운과 정면으로 부딪히는 날(월파일)이라 큰일은 하지 않는 날로 봐요.',
  sari: '춘분·하지·추분·동지의 전날(사리일)이라 큰일은 피하는 날로 봐요.',
  sajeol: '계절이 바뀌는 입춘·입하·입추·입동의 전날(사절일)이라 큰일은 피하는 날로 봐요.',
  day_clash: '타고난 나와 정면으로 부딪히는 날(일지 충)이라 피하는 날로 봐요.',
};

/** 짧은 이름 둘을 잇기 — '손 없는 날이면서 옛 달력의 길한 날' */
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
      return b[0] ? `조심할 점이 겹쳐 피하는 편이 좋아요. ${ieyo(both(b[0], b[1], 'and'))}` : '조심할 점이 겹쳐 피하는 편이 좋아요.';
  }
}

/** Top 3 에 들지 못한 까닭 (쉬운 말) */
export function dropReasonOf(d: TaekilDay, cutoff: TaekilDay | null, purpose: TaekilPurpose = 'move', ctx: Omit<ReasonContext, 'dayBranch'> = {}): string {
  const ex = excluder(d);
  if (ex) return `${EXCLUDE_WHY[ex.code] ?? '피하는 날이에요.'} 이런 날은 점수와 관계없이 처음부터 후보에서 빼요.`;
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
// 섹션 — 종합 분석 / 목적 맞춤 조언 / 날짜를 바꿀 수 없을 때 / 빠진 날짜
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
      ? ` ${josa(clashDay, '은', '는')} ${who}의 띠인 ${myAnimal}띠와도 충을 이뤄요.`
      : pat.friends.includes(pat.yearClash)
        ? ` 다만 ${josa(yearClashDay, '은', '는')} ${who}의 띠인 ${myAnimal}띠와 충을 이뤄 큰일에는 덜 써요.`
        : ` ${who}의 띠인 ${myAnimal}띠와 충을 이루는 ${yearClashDay}도 큰일에는 덜 써요.`;
  paragraphs.push(
    `날마다 바뀌는 일진(그날의 간지)의 지지는 열두 띠와 같은 글자라, 날마다 띠 동물이 하나씩 차례로 돌아와요. ${who}에게는 일지(태어난 날의 지지)와 짝을 이루는(육합·삼합) ${josa(friendDays, '이', '가')} 잘 맞고, 일지와 충(정면으로 대립하는 관계)을 이루는 ${josa(clashDay, '은', '는')} 피하는 편이 좋아요.${yearLine}`,
  );
  const cause = (code: TaekilFactorCode) => sel.days.filter((d) => d.excluded && d.factors.some((f) => f.excludes && f.code === code)).length;
  const pa = cause('officer');
  const dc = cause('day_clash');
  const ss = cause('sari') + cause('sajeol');
  if (pa + dc + ss > 0) {
    const parts = [pa && `월파일(그달의 기운과 정면으로 부딪히는 날) ${pa}일`, dc && `${who}의 일지와 충을 이루는 날 ${dc}일`, ss && `사리·사절일(춘분·하지·추분·동지와 입춘·입하·입추·입동의 전날) ${ss}일`].filter(Boolean);
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
  move: { basis: '이사는 보통 짐을 새 집에 들이는 날을 이삿날로 봐요. 잔금·전입신고 날짜가 달라도 짐 들이는 날을 좋은 날에 맞추면 돼요.', closing: '새 집에 들어가면 창을 열어 환기하고, 어떤 짐부터 풀지 순서를 미리 정해 두면 첫 며칠을 덜 피곤하게 보낼 수 있어요.' },
  contract: { basis: '계약은 서명하고 도장을 찍는 날을 기준으로 봐요.', closing: '날짜와 상관없이 계약서 조항은 꼼꼼히 확인해 주세요. 큰 금액이 오가는 계약이라면 전문가 검토를 함께 받는 게 안전해요.' },
  exam: { basis: '면접·시험은 날짜를 고를 수 없는 경우가 많아요. 정해진 날이라면 그날의 등급을 참고해 준비의 강도를 조절해 보세요.', closing: '시험 전날에는 무리하게 공부하기보다 충분히 자는 편이 실제 시험에 더 도움이 돼요.' },
  wedding: { basis: '결혼식 날은 두 사람의 사주를 함께 봐요.', closing: '식장 예약과 가족·하객의 사정도 중요한 기준이에요. 추천한 세 날 가운데 실제 일정이 맞는 날을 고르면 충분해요.' },
  opening: { basis: '개업은 처음 문을 열고 손님을 맞는 날을 기준으로 봐요. 사업자 등록·임대차 계약 날짜는 계약 택일로 따로 살펴볼 수 있어요.', closing: '개업 날짜만큼 첫 한 달 동안 가게를 꾸준히 운영하는 게 중요해요. 손님 맞을 준비를 넉넉히 해 두세요.' },
  travel: { basis: '여행·출발은 집을 나서는 날을 기준으로 봐요.', closing: '날짜보다 날씨와 교통 상황을 먼저 확인해 주세요. 안전하게 다녀오세요.' },
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
      paragraphs.push(`${dayLabel(best)}에 시작하기 좋은 시간은 ${ieyo(join(hours))} 그날 길한 신이 드는 시간(황도시) 중에서 낮 시간을 골랐어요. ${how}`);
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
        paragraphs.push('예부터 이사를 꺼려 온 귀기일은 점수를 낮춰 두었어요.');
        basis.push('귀기일(歸忌日) 감점');
      }
      break;
    }
    case 'contract': {
      const pens = tops.filter((d) => d.factors.some((f) => f.code === 'ten_god' && f.weight > 0));
      if (pens.length) {
        paragraphs.push(`${josa(join(pens.map(dayLabel)), '은', '는')} 그날의 천간이 정재(정당한 거래)나 정인(문서와 도장)에 해당해 계약과 잘 맞는다고 봐요.`);
        basis.push(`${join(pens.map((d) => `${dayLabel(d)} ${d.tenGod}`))} — 정재·정인일`);
      }
      const officers = officerDays(['정', '성']);
      if (officers.length) {
        paragraphs.push(`${josa(join(officers.map(dayLabel)), '은', '는')} 건제12신(옛 달력이 날마다 붙이는 열두 가지 성격)으로 ${officerKinds(officers)}에 해당해, 계약서를 쓰기 좋은 날로 꼽아요.`);
        basis.push(`${join(officers.map((d) => `${dayLabel(d)} ${d.almanac.officer.name}(${d.almanac.officer.hanja})일`))} — 통서 立券·交易에 길`);
      }
      break;
    }
    case 'exam': {
      const mc = sel.days.filter((d) => has(d, 'munchang') && !d.excluded);
      if (mc.length) {
        paragraphs.push(`${josa(join(mc.slice(0, 4).map(dayLabel)), '은', '는')} 문창귀인(학문과 문장에 관련된 길신)이 드는 날이에요. 원서 접수나 자기소개서 제출처럼 날짜를 직접 고를 수 있는 일에 활용해 보세요.`);
        basis.push('문창귀인일');
      }
      break;
    }
    case 'wedding': {
      if (sel.days.some((d) => d.almanac.leapMonth)) paragraphs.push('기간 안에 윤달이 있어요. 요즘 풍습에서는 윤달 결혼을 꺼리는 편이라 그 날들의 점수를 조금 낮췄지만, 옛 기록에는 혼인하기 좋은 달로 적힌 경우도 있으니 가족과 상의해 정하면 돼요.');
      if (sel.days.some((d) => has(d, 'pengzu'))) {
        paragraphs.push('옛 금기 목록인 팽조백기에 돼지날(해일)에는 혼례를 하지 않는다는 항목이 있어, 그 날들의 점수를 낮췄어요.');
        basis.push('팽조백기 亥不嫁娶 — 해일(亥日) 감점');
      }
      break;
    }
    case 'opening': {
      const good = officerDays(['개', '성', '만']);
      if (good.length) {
        paragraphs.push(`${josa(join(good.map(dayLabel)), '은', '는')} 건제12신(옛 달력이 날마다 붙이는 열두 가지 성격)으로 ${officerKinds(good)}에 해당해, 가게 문을 열기 좋은 날로 꼽아요.`);
        basis.push(`${join(good.map((d) => `${dayLabel(d)} ${d.almanac.officer.name}(${d.almanac.officer.hanja})일`))} — 통서 開市에 길`);
      }
      break;
    }
    case 'travel': {
      const ym = sel.days.filter((d) => has(d, 'yeokma') && !d.excluded);
      if (ym.length) {
        paragraphs.push(`${josa(join(ym.slice(0, 4).map(dayLabel)), '은', '는')} 역마(이동과 변화를 뜻하는 신살)가 드는 날이라 움직임에 힘이 실린다고 봐요.`);
        basis.push('역마일');
      }
      if (sel.days.some((d) => has(d, 'pengzu'))) {
        paragraphs.push('옛 금기 목록인 팽조백기에 뱀날(사일)에는 먼 길을 떠나지 않는다는 항목이 있어, 그 날들의 점수를 낮췄어요.');
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
  const paragraphs = ['정해진 일정이 피할 날에 해당한다면, 날짜를 무리하게 바꾸기보다 그날 주의할 점을 알고 대비하는 편이 현실적입니다.'];
  const basis: string[] = [];
  if (count(has('day_clash'))) {
    paragraphs.push('그날의 지지가 내 일지(태어난 날의 지지)와 충(정면으로 대립하는 관계)을 이루는 날에는 가까운 사람과도 부딪히기 쉽다고 봐요. 그날은 결정을 서두르지 말고, 예민한 대화는 하루 이틀 앞뒤로 옮겨 보세요.');
    basis.push('일지 충');
  }
  if (count((d) => d.almanac.officer.name === '파')) {
    const how = purpose === 'move' ? '이사라면 짐 정리와 청소를 이날 하고, 입주는 다른 날로 나누는 방법도 있어요.' : '새로 벌이는 일 대신 준비와 정리를 이날 하고, 시작은 다음 좋은 날로 넘겨 보세요.';
    paragraphs.push(`월파일(그달의 기운과 정면으로 부딪히는 날)에는 새로 시작하기보다 정리와 마무리에 힘을 쓰는 편이 좋아요. ${how}`);
    basis.push('월파(月破)일');
  }
  if (count((d) => Boolean(d.almanac.sari || d.almanac.sajeol))) {
    paragraphs.push('사리·사절일(춘분·하지·추분·동지와 입춘·입하·입추·입동의 전날)이라면 하루만 미뤄 보세요. 다음 날이면 이 조건에서 벗어나요.');
    basis.push('사리·사절일');
  }
  if (count((d) => !d.almanac.tianShen.yellow)) {
    paragraphs.push('12천신 가운데 흉한 신이 드는 흑도일이라도, 그날 가운데 길한 시간(황도시)에 맞춰 시작하면 괜찮다고 봐요.');
    basis.push('흑도일은 황도시에 시작');
  }
  paragraphs.push('택일은 더 나은 날을 고르기 위한 참고입니다. 어떤 날이든 준비를 꼼꼼히 해 두는 것이 결과에 가장 크게 작용해요.');
  return { key: SECTION_KEYS.turn, title: '날짜를 바꿀 수 없을 때', summary: '좋지 않은 날에 해야 할 때 대비하는 방법', paragraphs, ...(basis.length ? { basis: basis.join(' · ') } : {}) };
}

function droppedSection(ctx: TaekilTextContext): ReadingSection {
  const { sel } = ctx;
  const notTop = sel.days.filter((d) => !sel.top.includes(d.almanac.date));
  const groups = new Map<string, TaekilDay[]>();
  const K = { pa: '그달의 기운과 정면으로 부딪히는 날(월파일)', clash: '타고난 나와 정면으로 부딪히는 날(일지 충)', season: '절기가 바뀌기 바로 전날(사리·사절일)', bad: '조심할 점이 겹친 날', low: '점수가 추천 세 날보다 낮은 날' };
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
    [SECTION_KEYS.turn]: '좋지 않은 날에 해야 할 때 대비하는 방법',
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
