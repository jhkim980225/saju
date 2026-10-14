/**
 * 택일 문장 — 엔진(@saju/core taekil)의 요인 코드를 읽는 문장으로 바꾼다(규칙 기반).
 * 보이스: 해요체, 단정하지 않고 경향으로, 근거를 보여 주고, 행동 제안으로 맺는다(04-copywriting-guide).
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

export const TAEKIL_DISCLAIMER = '택일은 전통 역법(통서)과 사주 계산을 바탕으로 한 참고 정보예요. 날짜는 실제 일정과 사정을 함께 살펴 편하게 정해 주세요.';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export const weekdayKo = (weekday: number) => WEEK[weekday]!;
/** '2026-11-14' + 6 → '11월 14일(토)' */
export const dateLabel = (date: string, weekday: number) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일(${WEEK[weekday]})`;
const shortDate = (date: string) => `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}`;
const dayLabel = (d: TaekilDay) => dateLabel(d.almanac.date, d.almanac.weekday);
const hz = (b: number) => BRANCHES[mod(b, 12)]!.hanja;

const EL_KO = { wood: '목', fire: '화', earth: '토', metal: '금', water: '수' } as const;

/** 마지막 한글 글자에 받침이 있는가 (괄호 속은 건너뛴다) */
function hasBatchim(word: string): boolean {
  const ch = [...word.replace(/\([^)]*\)\s*$/, '')].reverse().find((c) => /[가-힣]/.test(c));
  return ch ? (ch.charCodeAt(0) - 0xac00) % 28 !== 0 : false;
}
/** 조사 붙이기 — josa('청룡', '이', '가') → '청룡이' */
export const josa = (word: string, withBatchim: string, without: string) => word + (hasBatchim(word) ? withBatchim : without);
/** 조사만 — 한자 뒤에 한글 읽기로 조사를 고를 때 */
const particle = (reading: string, withBatchim: string, without: string) => (hasBatchim(reading) ? withBatchim : without);
/** 라벨 '황도일(청룡)' → '청룡' */
const inParen = (label: string) => /\(([^)]+)\)/.exec(label)?.[1] ?? label;

/** 목적을 문장 안에서 부르는 말 */
const PURPOSE_NOUN: Record<TaekilPurpose, string> = { move: '이사', contract: '계약', exam: '면접·시험', wedding: '혼례', opening: '개업', travel: '길 떠나는 일' };

const OFFICER_TEXT: Record<DayOfficer, string> = {
  건: '세우고 시작하는 날이에요.',
  제: '묵은 것을 덜어 내는 날이에요.',
  만: '가득 차는 날이에요.',
  평: '고르고 평평한 날이에요.',
  정: '자리를 정하는 날이에요.',
  집: '붙잡아 지키는 날이에요.',
  파: '월건과 정면으로 부딪히는 월파(月破)일이라, 통서에서 큰일은 하지 않는 날로 봐요.',
  위: '높고 아슬한 날이에요.',
  성: '일이 이루어지는 날이에요.',
  수: '거두어들이는 날이에요.',
  개: '막힌 것이 열리는 날이에요.',
  폐: '닫히고 막히는 날이라 새로 벌이는 일과는 잘 맞지 않아요.',
};

function officerText(f: TaekilFactor, purpose: TaekilPurpose): string {
  const name = f.label.slice(0, 1) as DayOfficer;
  const base = OFFICER_TEXT[name] ?? '';
  if (name === '파') return base;
  const w = OFFICER_WEIGHT[purpose][name];
  const almanac = TAEKIL_PURPOSES[purpose].almanac;
  if (w >= 3) return `${base} 통서(協紀辨方書)의 택일 체계에서 ${PURPOSE_NOUN[purpose]}(${almanac})에 좋게 보는 직(直)이에요.`;
  if (w <= -3) return `${base} 통서(協紀辨方書)의 택일 체계에서 ${PURPOSE_NOUN[purpose]}(${almanac})에는 꺼리는 직(直)이에요.`;
  return `${base} ${PURPOSE_NOUN[purpose]}에는 크게 좋지도 나쁘지도 않은 직(直)이에요.`;
}

/** 요인 하나 → 풀어 쓴 문장 */
export function reasonText(f: TaekilFactor, purpose: TaekilPurpose, ctx: { partnerName?: string | null } = {}): string {
  const partner = ctx.partnerName ? `${ctx.partnerName}님` : '상대';
  const texts: Partial<Record<TaekilFactorCode, string>> = {
    yellow_road: `하늘의 길한 신 ${josa(`${inParen(f.label)}(${f.detail})`, '이', '가')} 지키는 황도일이에요. 일을 시작하기에 든든한 날로 봐요.`,
    black_road: `길한 신이 쉬고 ${josa(`${inParen(f.label)}(${f.detail})`, '이', '가')} 드는 흑도일이에요. 큰일이라면 이날의 황도시에 맞춰 시작해 보세요.`,
    cheonsa: '하늘이 허물을 덮어 준다는 천사일이에요. 한 해에 몇 번 없는 날이라 무엇을 시작해도 좋게 봐요.',
    cheondeok: `천덕(${f.detail})이 드는 날이에요. 막힌 일이 풀리고 도움이 따른다고 봐요.`,
    woldeok: `월덕(${f.detail})이 드는 날이에요. 다툼이 줄고 일이 순하게 흐른다고 봐요.`,
    sari: `${f.detail}이라 계절의 기운이 끊기는 사리일(四離日)이에요. 통서에서 큰일은 피하는 날로 봐요.`,
    sajeol: `${f.detail}이라 계절의 기운이 끊기는 사절일(四絶日)이에요. 통서에서 큰일은 피하는 날로 봐요.`,
    month_start: `${f.label}이에요. ${f.detail ?? ''}로 바뀌어 건제12신이 전날과 같은 직으로 한 번 겹쳐요.`,
    wolgi: `${f.detail}, 월기일이에요. 통서에서 큰일에는 쓰지 않는 날로 봐요(俗忌初五十四二十三).`,
    son_free: `${f.detail}, 손 없는 날이에요. 이삿날로 가장 많이 고르는 날이에요.`,
    son_direction: `${f.detail}이라 손이 ${f.label.replace('손 ', '')}에 머무는 날이에요. ${purpose === 'travel' ? '그쪽으로 길을 떠난다면' : '지금 집에서 그쪽으로 옮기는 이사라면'} 꺼리는 풍습이 있어요.`,
    gwigi: '귀기일(歸忌日)이에요. 집을 옮기거나 먼 길에서 돌아오는 일(般移遠迴)을 꺼리는 날로 봐요.',
    leap_month: purpose === 'wedding' ? '윤달이에요. 요즘은 윤달 혼례를 꺼리는 편이라 점수를 조금 낮췄어요(『동국세시기』에는 오히려 혼인하기 좋은 달로 적혀 있어요).' : '윤달이에요. 모든 일을 꺼리지 않는 달이라 해서 이사·집수리·이장을 이때 하기도 해요.',
    pengzu: purpose === 'wedding' ? '해일(亥日)이에요. 팽조백기에 "해일에는 혼례를 올리지 않는다(亥不嫁娶)"는 금기가 있어요.' : '사일(巳日)이에요. 팽조백기에 "사일에는 먼 길을 떠나지 않는다(巳不遠行)"는 금기가 있어요.',
    day_clash: `이날의 지지가 내 일지와 정면으로 부딪혀요(${f.detail}). 나 자신과 가까운 관계가 흔들리기 쉬워, 택일에서 가장 먼저 빼는 날이에요.`,
    day_punish: `이날의 지지가 내 일지를 조여요(${f.detail}). 마찰과 번거로운 일이 생기기 쉬워요.`,
    day_wonjin: `이날의 지지가 내 일지와 원진이에요(${f.detail}). 괜히 서운하고 어긋나기 쉬운 결이에요.`,
    day_break: `이날의 지지가 내 일지를 깨뜨리는 관계예요(${f.detail}). 약속이 틀어지지 않게 한 번 더 확인해 주세요.`,
    day_harm: `이날의 지지가 내 일지를 해치는 관계예요(${f.detail}). 사소한 오해를 조심하면 돼요.`,
    day_six: `이날의 지지가 내 일지와 짝을 이뤄요(${f.detail}). 사람과 일이 순하게 붙는 날이에요.`,
    day_half: `이날의 지지가 내 일지와 같은 기운으로 묶여요(${f.detail}). 힘을 보태 주는 날이에요.`,
    year_clash: `이날의 지지가 내 띠와 부딪혀요(${f.detail}). 본명(本命)을 건드리는 날이라 큰일에는 덜 쓰는 편이에요.`,
    year_punish: `이날의 지지가 내 띠를 조여요(${f.detail}). 일정이 번거로워지기 쉬워요.`,
    year_wonjin: `이날의 지지가 내 띠와 원진이에요(${f.detail}). 마음이 어긋나기 쉬운 결이에요.`,
    year_break: `이날의 지지가 내 띠를 깨뜨리는 관계예요(${f.detail}).`,
    year_harm: `이날의 지지가 내 띠를 해치는 관계예요(${f.detail}).`,
    year_six: `이날의 지지가 내 띠와 짝을 이뤄요(${f.detail}). 주변의 도움을 받기 쉬운 날이에요.`,
    year_half: `이날의 지지가 내 띠와 같은 기운으로 묶여요(${f.detail}).`,
    stem_combine: `이날의 천간이 내 일간과 합을 이뤄요(${f.detail}). 사람과 일이 잘 맞물리는 날이에요.`,
    stem_clash: `이날의 천간이 내 일간과 부딪혀요(${f.detail}). 마음이 급해지기 쉬우니 결정은 한 박자 늦춰 보세요.`,
    full_clash: `천간과 지지가 모두 내 일주와 부딪히는 날이에요(${f.detail}). 큰일은 피하는 게 좋아요.`,
    cheoneul: `천을귀인이 드는 날이에요(${f.detail}). 도와주는 사람을 만나기 쉬운 날로 봐요.`,
    gongmang: `공망이 드는 날이에요(${f.detail}). 애쓴 만큼 결과가 남지 않기 쉬우니 중요한 마무리는 다른 날로 미뤄 보세요.`,
    yongsin: `내 사주에 필요한 기운이 들어오는 날이에요(${f.detail}). 힘을 덜 들이고도 흐름을 타기 쉬워요.`,
    gisin: `내 사주에 이미 넘치는 기운이 더해지는 날이에요(${f.detail}). 무리하지 않게 일정을 넉넉히 잡아 주세요.`,
    ten_god: `이날 천간은 내 일간에게 ${josa(f.label.replace(/일$/, ''), '이에요', '예요')}. ${f.detail ?? ''}이라 ${PURPOSE_NOUN[purpose]}${f.weight > 0 ? '에 힘이 돼요.' : '에는 한 번 더 살펴요.'}`,
    munchang: `문창귀인이 드는 날이에요(${f.detail}). 글과 말이 잘 풀리는 날로 봐요.`,
    yeokma: `역마가 드는 날이에요(${f.detail}). 움직이고 옮기는 일에 힘이 실려요.`,
    partner_clash: `이날의 지지가 ${partner}의 일지와 부딪혀요(${f.detail}). 두 사람이 함께하는 날로는 피하는 게 좋아요.`,
    partner_punish: `이날의 지지가 ${partner}의 일지를 조여요(${f.detail}).`,
    partner_wonjin: `이날의 지지가 ${partner}의 일지와 원진이에요(${f.detail}).`,
    partner_six: `이날의 지지가 ${partner}의 일지와 짝을 이뤄요(${f.detail}). 두 사람 모두에게 순한 날이에요.`,
    partner_year_clash: `이날의 지지가 ${partner}의 띠와 부딪혀요(${f.detail}).`,
    partner_year_six: `이날의 지지가 ${partner}의 띠와 짝을 이뤄요(${f.detail}).`,
    partner_cheoneul: `${partner}에게 천을귀인이 드는 날이에요(${f.detail}).`,
  };
  if (f.code === 'officer') return officerText(f, purpose);
  return texts[f.code] ?? f.label;
}

export function reasonsOf(d: TaekilDay, purpose: TaekilPurpose, partnerName?: string | null): TaekilReasonDto[] {
  return d.factors.map((f) => ({ tone: f.tone, label: f.label, text: reasonText(f, purpose, { partnerName }), weight: f.weight, excludes: Boolean(f.excludes) }));
}

const goods = (d: TaekilDay) => d.factors.filter((f) => f.weight > 0).sort((a, b) => b.weight - a.weight);
const bads = (d: TaekilDay) => d.factors.filter((f) => f.weight < 0).sort((a, b) => a.weight - b.weight);
const excluder = (d: TaekilDay) => d.factors.find((f) => f.excludes) ?? null;

const EXCLUDE_WHY: Partial<Record<TaekilFactorCode, string>> = {
  officer: '월파라 큰일은 하지 않는 날이에요.',
  sari: '계절의 기운이 끊기는 날이라 큰일은 피해요.',
  sajeol: '계절의 기운이 끊기는 날이라 큰일은 피해요.',
  day_clash: '내 일지와 부딪히는 날이라 피해요.',
};

/** 하루를 한 줄로 */
export function daySummary(d: TaekilDay): string {
  const ex = excluder(d);
  if (ex) return `${ex.label} — ${EXCLUDE_WHY[ex.code] ?? '피하는 날이에요.'}`;
  const g = goods(d).slice(0, 3).map((f) => f.label);
  const b = bads(d).slice(0, 2).map((f) => f.label);
  switch (d.grade) {
    case 'best':
      return `${g.join(' · ')} — 길한 요소가 겹친 날이에요.`;
    case 'good':
      return `${g.slice(0, 2).join(' · ')} — 무난하게 쓰기 좋은 날이에요.${b[0] ? ` 살필 점은 ${b[0]}.` : ''}`;
    case 'normal':
      return g[0] && b[0] ? `좋고 아쉬운 점이 섞인 날이에요. 좋은 점은 ${g[0]}, 살필 점은 ${b[0]}.` : g[0] ? `큰 흠 없이 무난한 날이에요. 좋은 점은 ${g[0]}.` : `큰 길신도 흉신도 없는 평범한 날이에요.`;
    case 'caution':
      return `${b.join(' · ') || '아쉬운 요인'} — 조심스러운 날이에요.`;
    default:
      return `${b.join(' · ') || '흉한 요인'} — 흉한 기운이 겹쳐 피하는 게 좋아요.`;
  }
}

/** Top 3 에 들지 못한 까닭 */
export function dropReasonOf(d: TaekilDay, cutoff: TaekilDay | null): string {
  const ex = excluder(d);
  if (ex) return `${ex.label} — 이런 날은 처음부터 후보에서 빼요. ${EXCLUDE_WHY[ex.code] ?? ''}`.trim();
  const worst = bads(d)[0];
  if (d.grade === 'avoid') return `흉한 요인(${bads(d).slice(0, 3).map((f) => f.label).join(', ')})이 겹쳐 ${d.score}점에 그쳤어요.`;
  if (!cutoff) return worst ? `가장 아쉬운 점은 ${worst.label}이에요.` : '큰 흠은 없는 날이에요.';
  const diff = cutoff.score - d.score;
  if (diff <= 0) return `3위와 점수(${d.score}점)는 같지만, 흉한 요인이 조금 더 있거나 날짜가 늦어 순위에서 밀렸어요.`;
  return worst ? `3위보다 ${diff}점 낮아요. 가장 아쉬운 점은 ${worst.label}이에요.` : `흠은 없지만 3위보다 ${diff}점 낮아요. 더 좋은 기운이 겹친 날이 있었어요.`;
}

/** 황도시 중 낮 시간(辰~酉) — '辰시(7~9시)' */
export function goodHoursOf(d: TaekilDay): string[] {
  return yellowHoursOf(d.almanac.ganzhi.branch)
    .filter((h) => h >= 4 && h <= 9)
    .map((h) => `${hz(h)}시(${BRANCHES[h]!.hourStart}~${BRANCHES[h]!.hourStart + 2}시)`);
}

/** 계산 기준 한 줄 */
export function basisOf(chart: SajuChart, partnerName: string | null): string {
  const y = chart.pillars.year.branch;
  const base = `일주 ${chart.pillars.day.ganzhi.hanja} · 띠 ${y.animal}(${y.hanja}) · 용신 ${EL_KO[chart.yongsin.yongsin]}(${ELEMENT_INFO[chart.yongsin.yongsin].hanja})`;
  return partnerName ? `${base} · 상대 ${partnerName}` : base;
}

export function headlineOf(sel: TaekilSelection, purpose: TaekilPurpose): string {
  const top = sel.top[0] ? sel.days.find((d) => d.almanac.date === sel.top[0]) : undefined;
  if (!top) return `이 날짜들에는 ${TAEKIL_PURPOSES[purpose].label}에 권할 만한 날이 없어요. 기간을 넓혀 다시 살펴보세요.`;
  return `가장 좋은 날은 ${dayLabel(top)}, ${TAEKIL_GRADE_LABEL[top.grade]}이에요.`;
}

export interface TaekilTextContext {
  purpose: TaekilPurpose;
  mode: 'range' | 'dates';
  profileName: string;
  partnerName: string | null;
  chart: SajuChart;
  sel: TaekilSelection;
}

/** 날짜별 DTO — locked 면 등급·순위만 */
export function dayDtos(ctx: TaekilTextContext, locked: boolean): TaekilDayDto[] {
  const { sel, purpose } = ctx;
  const byDate = new Map(sel.days.map((d) => [d.almanac.date, d]));
  const cutoff = sel.top.length ? byDate.get(sel.top[sel.top.length - 1]!)! : null;
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
      summary: locked ? null : daySummary(d),
      reasons: locked ? null : reasonsOf(d, purpose, ctx.partnerName),
      dropReason: locked || rank !== null ? null : dropReasonOf(d, cutoff),
      goodHours: locked || rank === null ? null : goodHoursOf(d),
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
  const scope = ctx.mode === 'range' ? `${shortDate(first)}부터 ${shortDate(last)}까지 ${n}일` : `고른 후보 ${n}일`;
  const p1 = `${scope}을 ${TAEKIL_PURPOSES[purpose].label} 기준으로 살펴봤어요. 대길 ${c.best}일 · 길 ${c.good}일 · 보통 ${c.normal}일 · 주의 ${c.caution}일 · 피함 ${c.avoid}일이에요.`;
  const paragraphs = [p1];
  const tops = sel.top.map((date) => sel.days.find((d) => d.almanac.date === date)!);
  if (tops[0]) {
    const rest = tops.slice(1).map(dayLabel);
    paragraphs.push(`가장 좋은 날은 ${tops[0].almanac.ganzhi.hanja}일인 ${dayLabel(tops[0])}이에요. ${daySummary(tops[0])}${rest.length ? ` 그다음은 ${rest.join(', ')} 순이에요.` : ''}`);
  } else {
    paragraphs.push(`이번에 고른 날짜에는 ${TAEKIL_PURPOSES[purpose].label}에 권할 만한 날이 없어요. 아래 '빠진 날짜와 이유'를 보고 기간을 넓히거나 다른 후보를 넣어 보세요.`);
  }
  const pat = personalPattern(chart);
  paragraphs.push(
    `${profileName}님의 일주는 ${chart.pillars.day.ganzhi.hanja}(${chart.pillars.day.ganzhi.hangul})${particle(chart.pillars.day.ganzhi.hangul, '이라서', '라서')} 지지가 ${pat.friends.map(hz).join('·')}인 날과 잘 어울리고 ${hz(pat.dayClash)}일은 일지와 부딪혀 피하는 게 좋아요. ` +
      `띠(${chart.pillars.year.branch.animal})와 부딪히는 ${hz(pat.yearClash)}일도 큰일에는 덜 쓰는 편이에요.`,
  );
  const cause = (code: TaekilFactorCode) => sel.days.filter((d) => d.excluded && d.factors.some((f) => f.excludes && f.code === code)).length;
  const pa = cause('officer');
  const dc = cause('day_clash');
  const ss = cause('sari') + cause('sajeol');
  if (pa + dc + ss > 0) {
    const parts = [pa && `월파(破)일 ${pa}일`, dc && `일지 충 ${dc}일`, ss && `사리·사절일 ${ss}일`].filter(Boolean);
    paragraphs.push(`처음부터 후보에서 뺀 날은 ${parts.join(', ')}이에요. 통서와 명리에서 큰일을 하지 않는 날로 보는 날들이에요.`);
  }
  if (purpose === 'move') {
    const free = sel.days.filter((d) => d.almanac.sonFree);
    paragraphs.push(free.length ? `이 기간의 손 없는 날은 ${free.length}일이에요: ${join(free.map(dayLabel))}.` : '이 기간에는 손 없는 날(음력 9·10·19·20·29·30일)이 없어요.');
  }
  const best = tops[0];
  return {
    key: SECTION_KEYS.overview,
    title: '종합 분석',
    summary: best ? `가장 좋은 날 ${dayLabel(best)} · 좋은 날 ${c.best + c.good}일 · 피할 날 ${c.avoid}일` : '권할 만한 날을 찾지 못했어요.',
    paragraphs,
  };
}

const PURPOSE_ADVICE: Record<TaekilPurpose, { basis: string; closing: string }> = {
  move: { basis: '이사는 보통 짐을 새 집에 들이는 날을 이삿날로 봐요. 잔금·전입신고 날짜가 달라도 짐 들이는 날을 좋은 날에 맞추면 돼요.', closing: '새 집에 들어가면 창을 열어 환기하고 불을 밝혀 두는 것처럼, 시작을 정돈하는 작은 습관이 마음을 편하게 해 줘요.' },
  contract: { basis: '계약은 서명하고 도장을 찍는 날을 기준으로 봐요.', closing: '날짜와 상관없이 계약서 조항은 꼼꼼히 확인해 주세요. 큰 금액이 오가는 계약이라면 전문가 검토를 함께 받는 게 안전해요.' },
  exam: { basis: '면접·시험은 날짜를 고를 수 없는 경우가 많아요. 정해진 날이라면 그날의 등급을 참고해 준비의 강도를 조절해 보세요.', closing: '시험 전날은 무리한 공부보다 충분한 잠이 어떤 길일보다 확실한 준비예요.' },
  wedding: { basis: '혼례 날은 두 사람의 사주를 함께 봐요.', closing: '식장 예약과 가족·하객의 사정도 중요한 기준이에요. Top 3 가운데 현실 일정이 맞는 날을 고르면 충분해요.' },
  opening: { basis: '개업은 처음 문을 열고 손님을 맞는 날을 기준으로 봐요. 사업자 등록·임대차 계약 날짜는 계약 택일로 따로 살펴볼 수 있어요.', closing: '개업 날의 기운만큼 첫 한 달의 꾸준함이 중요해요. 손님 맞을 준비를 넉넉히 해 두세요.' },
  travel: { basis: '여행·출발은 집을 나서는 날을 기준으로 봐요.', closing: '날씨와 교통 상황이 길일보다 먼저예요. 안전하게 다녀오세요.' },
};

function adviceSection(ctx: TaekilTextContext): ReadingSection {
  const { sel, purpose } = ctx;
  const tops = sel.top.map((date) => sel.days.find((d) => d.almanac.date === date)!);
  const best = tops[0];
  const pa = PURPOSE_ADVICE[purpose];
  const paragraphs: string[] = [];
  if (purpose === 'wedding') {
    paragraphs.push(ctx.partnerName ? `${pa.basis} ${ctx.partnerName}님의 일지·띠와 부딪히는 날도 함께 걸렀어요.` : `${pa.basis} 상대의 사주를 함께 넣으면 두 사람 모두에게 맞는 날을 더 정확히 고를 수 있어요.`);
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
      paragraphs.push(`${dayLabel(best)}의 황도시(길한 시간)는 ${join(hours)}예요. ${how}`);
    }
  }
  const has = (d: TaekilDay, code: TaekilFactorCode) => d.factors.some((f) => f.code === code);
  switch (purpose) {
    case 'move': {
      if (best) {
        if (best.almanac.sonFree) paragraphs.push(`${dayLabel(best)}은 손 없는 날이라 방향 걱정 없이 옮겨도 돼요.`);
        else if (best.almanac.sonDirection) {
          const alt = sel.ranking.map((date) => sel.days.find((d) => d.almanac.date === date)!).find((d) => d.almanac.sonFree && !d.excluded);
          paragraphs.push(`${dayLabel(best)}은 손이 ${best.almanac.sonDirection}쪽에 머무는 날이에요. 지금 집에서 ${best.almanac.sonDirection}쪽으로 옮기는 이사라면${alt ? ` 손 없는 날인 ${dayLabel(alt)}도 함께 견줘 보세요.` : ' 시작 시간을 황도시에 맞춰 보세요.'}`);
        }
      }
      if (sel.days.some((d) => has(d, 'gwigi'))) paragraphs.push('귀기일은 집을 옮기는 일을 꺼리는 날이라 점수를 낮춰 두었어요.');
      break;
    }
    case 'contract': {
      const pens = tops.filter((d) => d.factors.some((f) => f.code === 'ten_god' && f.weight > 0));
      if (pens.length) paragraphs.push(`${join(pens.map(dayLabel))}은 정재·정인처럼 거래와 문서의 기운이 드는 날이라 계약과 잘 맞아요.`);
      const officers = tops.filter((d) => ['정', '성'].includes(d.almanac.officer.name));
      if (officers.length) paragraphs.push(`${join(officers.map((d) => `${dayLabel(d)} ${d.almanac.officer.name}(${d.almanac.officer.hanja})일`))} — 정(定)·성(成)일은 통서에서 거래와 문서(立券·交易)에 좋다고 보는 직이에요.`);
      break;
    }
    case 'exam': {
      const mc = sel.days.filter((d) => has(d, 'munchang') && !d.excluded);
      if (mc.length) paragraphs.push(`문창귀인이 드는 ${join(mc.slice(0, 4).map(dayLabel))}은 글과 말이 잘 풀리는 날이에요. 원서 접수나 자기소개서 제출처럼 직접 고를 수 있는 일에 써 보세요.`);
      break;
    }
    case 'wedding': {
      if (sel.days.some((d) => d.almanac.leapMonth)) paragraphs.push('기간 안에 윤달이 있어요. 요즘은 윤달 혼례를 꺼리는 편이라 그 날들은 점수를 조금 낮췄어요. 가족과 상의해 정하면 돼요.');
      if (sel.days.some((d) => has(d, 'pengzu'))) paragraphs.push('해일(亥日)은 팽조백기의 "亥不嫁娶" 금기에 따라 점수를 낮췄어요.');
      break;
    }
    case 'opening': {
      const good = tops.filter((d) => ['개', '성', '만'].includes(d.almanac.officer.name));
      if (good.length) paragraphs.push(`${join(good.map((d) => `${dayLabel(d)} ${d.almanac.officer.name}(${d.almanac.officer.hanja})일`))} — 개(開)·성(成)·만(滿)일은 통서에서 개업(開市)에 좋게 보는 직이에요.`);
      break;
    }
    case 'travel': {
      const ym = sel.days.filter((d) => has(d, 'yeokma') && !d.excluded);
      if (ym.length) paragraphs.push(`역마가 드는 ${join(ym.slice(0, 4).map(dayLabel))}은 움직임에 힘이 실리는 날이에요.`);
      if (sel.days.some((d) => has(d, 'pengzu'))) paragraphs.push('사일(巳日)은 팽조백기의 "巳不遠行" 금기에 따라 점수를 낮췄어요.');
      break;
    }
  }
  paragraphs.push(pa.closing);
  return { key: SECTION_KEYS.advice, title: `${TAEKIL_PURPOSES[purpose].label} 맞춤 조언`, summary: `${TAEKIL_PURPOSES[purpose].label} 날을 고를 때 기준과 시간·준비`, paragraphs };
}

function turnSection(ctx: TaekilTextContext): ReadingSection {
  const { sel, purpose } = ctx;
  const count = (pred: (d: TaekilDay) => boolean) => sel.days.filter(pred).length;
  const has = (code: TaekilFactorCode) => (d: TaekilDay) => d.factors.some((f) => f.code === code);
  const paragraphs = ['정해진 일정이 하필 피할 날이라면 날짜를 억지로 바꾸기보다, 그날의 약한 고리를 알고 대비하는 쪽이 현실적이에요.'];
  if (count(has('day_clash'))) paragraphs.push('일지 충이 드는 날은 나와 가까운 사람과 부딪히기 쉬워요. 그날은 결정을 서두르지 말고, 예민한 대화는 하루 이틀 앞뒤로 옮겨 보세요.');
  if (count((d) => d.almanac.officer.name === '파')) {
    const how = purpose === 'move' ? '이사라면 짐 정리와 청소를 이날 하고, 입주는 다른 날로 나누는 방법도 있어요.' : '새로 벌이는 일 대신 준비와 정리를 이날 하고, 시작은 다음 좋은 날로 넘겨 보세요.';
    paragraphs.push(`월파(破)일엔 새로 시작하기보다 정리·마무리에 힘을 쓰는 게 좋아요. ${how}`);
  }
  if (count((d) => Boolean(d.almanac.sari || d.almanac.sajeol))) paragraphs.push('사리·사절일은 계절이 바뀌기 바로 전날이에요. 하루만 미뤄도 새 절기가 시작돼요.');
  if (count((d) => !d.almanac.tianShen.yellow)) paragraphs.push('흑도일이라도 그날의 황도시에 맞춰 시작하면 좋다는 게 통서의 쓰임이에요. 결과 화면의 날짜를 눌러 시간을 확인해 보세요.');
  paragraphs.push('택일은 더 좋은 날을 고르는 참고예요. 어떤 날이든 준비를 꼼꼼히 하고 마음을 편히 먹는 것이 가장 큰 힘이 돼요.');
  return { key: SECTION_KEYS.turn, title: '위기를 기회로', summary: '피할 날을 써야 할 때의 대처법', paragraphs };
}

function droppedSection(ctx: TaekilTextContext): ReadingSection {
  const { sel } = ctx;
  const notTop = sel.days.filter((d) => !sel.top.includes(d.almanac.date));
  const groups = new Map<string, TaekilDay[]>();
  for (const d of notTop) {
    const ex = excluder(d);
    const key = ex ? (ex.code === 'officer' ? '월파(破)일' : ex.code === 'day_clash' ? '일지 충(沖)' : '사리·사절일') : d.grade === 'avoid' ? '흉한 요인이 겹친 날' : '점수가 Top 3보다 낮은 날';
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const order = ['월파(破)일', '일지 충(沖)', '사리·사절일', '흉한 요인이 겹친 날', '점수가 Top 3보다 낮은 날'];
  // 날짜가 많은 묶음(점수가 낮은 날)은 개수만 — 날짜별 이유는 목록에서 본다
  const paragraphs = order.filter((k) => groups.has(k)).map((k) => {
    const ds = groups.get(k)!;
    return ds.length > 8 ? `${k} — ${ds.length}일` : `${k} — ${join(ds.map(dayLabel))}`;
  });
  if (!paragraphs.length) paragraphs.push('고른 날짜가 모두 Top 3에 들었어요.');
  else paragraphs.push('날짜마다 자세한 이유는 위 목록에서 날짜를 눌러 확인할 수 있어요.');
  return { key: SECTION_KEYS.dropped, title: '빠진 날짜와 이유', summary: `Top 3 밖의 ${notTop.length}일`, paragraphs };
}

/** 전체 섹션(결제 후) */
export function buildSections(ctx: TaekilTextContext): ReadingSection[] {
  return [overviewSection(ctx), adviceSection(ctx), turnSection(ctx), droppedSection(ctx)];
}

/** 잠금 상태 섹션 — 제목·짧은 소개만(종합 분석은 첫 문단 미리보기) */
export function lockedSections(ctx: TaekilTextContext, productId: string): ReadingSection[] {
  const full = buildSections(ctx);
  const teaser: Record<string, string> = {
    [SECTION_KEYS.overview]: '좋은 날이 모인 때와, 내 사주와 맞는 날·부딪히는 날의 결',
    [SECTION_KEYS.advice]: `${TAEKIL_PURPOSES[ctx.purpose].label}에 맞춘 시간·방향·준비`,
    [SECTION_KEYS.turn]: '피할 날을 써야 할 때의 대처법',
    [SECTION_KEYS.dropped]: `Top 3 밖의 ${ctx.sel.days.length - ctx.sel.top.length}일, 날짜마다 빠진 이유`,
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

