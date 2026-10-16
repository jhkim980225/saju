/**
 * 규칙 기반 해석 생성기 — 계산 엔진 결과 + 콘텐츠 문구를 조합해 사람이 읽을 풀이를 만든다.
 * AI(Claude)가 설정되면 ai.ts 가 이 결과를 초안으로 삼아 문장을 다듬는다.
 * 문체(docs/PLAIN_KOREAN.md): 정식 명리학 용어를 쓰고, 한 화면에서 처음 나올 때 뜻을 붙인다(defineTerms).
 * 점수·등급·오행 개수·신강·신약 점수·용신 계산·대운 시작 나이처럼 달빛사주가 정한 기준은 화면에서 한 번 '달빛사주 기준'이라고 밝힌다.
 */
import { YEARLY_CATEGORY } from './content/fortuneTemplates.js';
import { TEN_GOD_PLAIN } from './content/tenGods.js';
import {
  CATEGORY_PLAIN,
  COMPAT_ADVICE_SUMMARY,
  COMPAT_CATEGORY_PLAIN,
  DAY_GRADE_PLAIN,
  LOVE_STYLE,
  LUCKY_COLOR_PLAIN,
  YEAR_CATEGORY_PLAIN,
  YEAR_GRADE_PLAIN,
  compatFactorPlain,
  complementPlain,
  yearNickname,
} from './content/plainFortune.js';
import {
  ELEMENTS,
  ELEMENT_INFO,
  GRADE_LABEL,
  TEN_GOD_GROUP,
  dayPillarOf,
  evaluateFortune,
  hashSeed,
  luckPillar,
  mod,
  seun,
  wolun,
  yearPillarOf,
  type CompatibilityResult,
  type Element,
  type FortuneEvaluation,
  type FortuneGrade,
  type FortuneHighlight,
  type SajuChart,
  type StrengthLevel,
  type TenGod,
  type TenGodGroup,
} from '@saju/core';
import { GRADE_PLAIN_LABEL, TEN_GOD_PLAIN_LABEL, type DailyFortuneDto, type ReadingDto, type ReadingSection, type YearlyFortuneDto } from '@saju/shared';
import {
  DAY_MASTERS,
  DAY_PILLARS,
  ELEMENT_CONTENT,
  FORTUNE_TEMPLATES,
  TEN_GOD_CONTENT,
  TWELVE_STAGE_CONTENT,
  YONGSIN_CONTENT,
  type DailyCategory,
  type ScoreBand,
} from './content/index.js';
import { ELEMENT_PLAIN, SHINSAL_ORDER, SHINSAL_PLAIN, STEM_PLAIN, STRENGTH_PLAIN, displayName, nameSubject, personalize } from './content/plain.js';
import { CHILD_HINT, GROUP_PLAIN, HIGHLIGHT_PLAIN, HIGHLIGHT_TERM as HIGHLIGHT_TERM_REPORT, TEN_GOD_PLAIN as TEN_GOD_REPORT } from './content/reportPlain.js';

/** 신년운세·"올해 운세" 대상 연도 — KST 기준 10월부터는 다음 해 (웹 lib/format.ts 와 같은 규칙) */
export function targetFortuneYear(now = new Date()): number {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  return kst.getUTCFullYear() + (kst.getUTCMonth() >= 9 ? 1 : 0);
}

export const DISCLAIMER =
  '이 풀이는 명리학 이론을 바탕으로 한 참고용 해석입니다. 점수와 등급 같은 지표는 달빛사주 기준으로 계산한 것이며, 중요한 결정은 풀이에만 의존하지 말고 충분히 검토한 뒤 내려 주세요.';

export const EL_NAME: Record<Element, string> = { wood: '목(木)', fire: '화(火)', earth: '토(土)', metal: '금(金)', water: '수(水)' };
export const EL_SHORT: Record<Element, string> = { wood: '나무', fire: '불', earth: '흙', metal: '쇠', water: '물' };
/** 본문용 오행 이름 — 정식 이름(한자 없이) */
const EL_KO: Record<Element, string> = { wood: '목', fire: '화', earth: '토', metal: '금', water: '수' };

/** 시드 기반 결정적 선택 */
export function pick<T>(arr: readonly T[], seed: string): T {
  if (arr.length === 0) throw new Error('빈 후보 목록');
  return arr[hashSeed(seed) % arr.length]!;
}

export const band = (score: number): ScoreBand => (score >= 70 ? 'high' : score >= 50 ? 'mid' : 'low');
export const josa = (word: string, withBatchim: string, without: string) => {
  const ch = word.charCodeAt(word.length - 1);
  if (ch < 0xac00 || ch > 0xd7a3) return word + withBatchim;
  return word + ((ch - 0xac00) % 28 > 0 ? withBatchim : without);
};

export function dayMasterContent(chart: SajuChart) {
  return DAY_MASTERS[chart.dayMaster.index]!;
}
export function dayPillarContent(chart: SajuChart) {
  return DAY_PILLARS[chart.pillars.day.ganzhi.index]!;
}

export function groupCount(chart: SajuChart): Record<TenGodGroup, number> {
  const r: Record<TenGodGroup, number> = { 비겁: 0, 식상: 0, 재성: 0, 관성: 0, 인성: 0 };
  for (const [tg, n] of Object.entries(chart.tenGodCount) as [TenGod, number][]) r[TEN_GOD_GROUP[tg]] += n;
  return r;
}

export function dominantTenGod(chart: SajuChart): TenGod {
  return (Object.entries(chart.tenGodCount) as [TenGod, number][]).sort((a, b) => b[1] - a[1])[0]![0];
}

function hasShinsal(chart: SajuChart, name: string) {
  return chart.shinsal.some((s) => s.name === name);
}

/** 잠금 섹션: 첫 문단만 남기고 locked 표시 */
export function lock(section: ReadingSection, locked: boolean, productId: string): ReadingSection {
  if (!locked) return section;
  return { ...section, paragraphs: section.paragraphs.slice(0, 1).map((p) => (p.length > 80 ? `${p.slice(0, 80)}…` : p)), locked: true, unlockProductId: productId };
}

// ---------------------------------------------------------------------------
// 용어 풀이 — 한 화면에서 처음 나오는 명리학 용어에 짧은 뜻을 붙인다(docs/PLAIN_KOREAN.md '사주 용어' 2번)
// ---------------------------------------------------------------------------

interface TermDef {
  term: string;
  def: string;
  re: RegExp;
}
/** 용어 바로 뒤 — 조사·문장부호·괄호만(‘일간지’·‘식상하다’·‘재성장’ 같은 다른 낱말은 빼고) */
const AFTER = '(?=[(은는이가을를의에과와도로으만처보까]|[^가-힣]|$)';
const term = (word: string, def: string, guard = ''): TermDef => ({ term: word, def, re: new RegExp(`(^|[^가-힣])(${word})${guard}${AFTER}`, 'g') });
/** 한 글자 관계 용어(합·충·형) — '…과 합을 이뤄'처럼 띄어 쓴 자리에서만 */
const relTerm = (word: string, def: string): TermDef => ({ term: word, def, re: new RegExp(`(^|[\\s(])(${word})(?=을 |이 |\\()`, 'g') });

export const TERM_DEFS: TermDef[] = [
  term('일진', '그날의 간지'),
  term('일간', '태어난 날의 천간으로, 나 자신을 나타내는 글자'),
  term('일지', '태어난 날의 지지로, 배우자 자리로도 보는 글자'),
  term('일주', '태어난 날의 기둥', '(?!일)'),
  term('월지', '태어난 달의 지지'),
  term('천간', '간지의 앞 글자'),
  term('지지', '간지의 뒤 글자', '(?! 않)(?!를 받)'),
  term('지장간', '지지 안에 담긴 천간'),
  term('오행', '목·화·토·금·수의 다섯 가지 기운'),
  term('십성', '일간을 기준으로 다른 글자와의 관계를 열 가지로 나눈 것'),
  term('용신', '사주의 균형에 가장 도움이 되는 오행'),
  term('희신', '용신을 생하는 오행'),
  term('기신', '사주의 균형에 가장 도움이 되는 오행을 극하는 오행'),
  term('대운', '10년 단위로 바뀌는 운의 큰 흐름'),
  term('신살', '특정 글자의 조합에 붙이는 보조적인 해석 요소'),
  term('배우자성', '배우자를 뜻하는 십성으로, 전통적으로 남성은 재성·여성은 관성'),
  term('비겁', '일간과 같은 오행으로, 동료·자립을 상징'),
  term('식상', '일간이 생하는 오행으로, 재능·표현을 상징'),
  term('재성', '일간이 극하는 오행으로, 재물·관리 능력을 상징'),
  term('관성', '일간을 극하는 오행으로, 규범·책임·직장을 상징'),
  term('인성', '일간을 생하는 오행으로, 학문·지원을 상징'),
  term('원진', '서로 꺼리는 관계'),
  relTerm('합', '서로 끌어당겨 결합하는 관계'),
  relTerm('충', '서로 맞서는 관계'),
  relTerm('형', '서로 마찰을 일으키는 관계'),
];

/**
 * 문단들을 화면 순서대로 읽으며, 용어가 처음 나온 자리에 '(뜻)'을 붙인다. 두 번째부터는 용어만 둔다.
 * - 이미 바로 뒤에 괄호가 있으면(직접 뜻을 적어 둔 자리) 그대로 두고 '설명함'으로 친다.
 * - 괄호 안에 든 용어는 세지 않는다(뜻풀이 속 낱말).
 */
export function defineTerms(paragraphs: string[], defined: Set<string> = new Set()): string[] {
  return paragraphs.map((text) => {
    const depth: number[] = [];
    let d = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '(') d += 1;
      depth.push(d);
      if (text[i] === ')') d = Math.max(0, d - 1);
    }
    const hits: { at: number; def: TermDef; has: boolean }[] = [];
    for (const def of TERM_DEFS) {
      for (const m of text.matchAll(def.re)) {
        const at = m.index! + m[1]!.length;
        if (depth[at] === 0) hits.push({ at, def, has: text[at + def.term.length] === '(' });
      }
    }
    hits.sort((a, b) => a.at - b.at);
    const inserts: { at: number; s: string }[] = [];
    for (const h of hits) {
      if (defined.has(h.def.term)) continue;
      defined.add(h.def.term);
      if (!h.has) inserts.push({ at: h.at + h.def.term.length, s: `(${h.def.def})` });
    }
    let out = text;
    for (const ins of inserts.sort((a, b) => b.at - a.at)) out = out.slice(0, ins.at) + ins.s + out.slice(ins.at);
    return out;
  });
}

/** 섹션 목록 전체를 한 화면으로 보고 용어 뜻을 붙인다(본문 문단만) */
function defineSections(sections: ReadingSection[], defined: Set<string> = new Set()): ReadingSection[] {
  return sections.map((s) => ({ ...s, paragraphs: defineTerms(s.paragraphs, defined) }));
}

// ---------------------------------------------------------------------------
// 원국 풀이 섹션
// ---------------------------------------------------------------------------

/** 일간 문구 속 '갑목은' 같은 주어를 이름(없으면 생략)으로 */
const dmText = (chart: SajuChart, text: string, name: string | null) => personalize(text, dayMasterContent(chart).name.slice(0, 2), name);
/** 문장이 마침표로 끝나게 */
const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const ELEMENT_KEYS: Element[] = ['wood', 'fire', 'earth', 'metal', 'water'];
/** 여덟(또는 여섯) 글자 개수 기준 — 화면의 오행 도넛과 같은 기준 */
const manyElements = (chart: SajuChart) => ELEMENT_KEYS.filter((e) => chart.elements.count[e] >= 3).sort((a, b) => chart.elements.count[b] - chart.elements.count[a]);
const noneElements = (chart: SajuChart) => ELEMENT_KEYS.filter((e) => chart.elements.count[e] === 0);
const koNames = (els: Element[]) => els.map((e) => EL_KO[e]).join('·');
/** 글자 수 — 시간을 모르면 여섯 */
const charCount = (chart: SajuChart) => (chart.hourKnown ? '여덟' : '여섯');

/** 일간의 강약 단계 — 본문용 이름과 뜻 */
const STRENGTH_PHRASE: Record<StrengthLevel, string> = {
  극신강: '일간의 힘이 매우 강한 상태인 극신강',
  신강: '일간의 힘이 강한 상태인 신강',
  중화: '강약이 균형에 가까운 중화',
  신약: '일간의 힘이 약한 상태인 신약',
  극신약: '일간의 힘이 매우 약한 상태인 극신약',
};
/** 억부 용신이 일간에게 하는 역할 — 용신이 일간과 어떤 관계의 오행인지에 따라 */
const YONGSIN_ROLE: Record<TenGodGroup, string> = {
  비겁: '일간과 같은 오행으로 힘을 보태는',
  식상: '일간이 생하는 오행으로 넘치는 힘을 밖으로 풀어 주는',
  재성: '일간이 극하는 오행으로 강한 힘을 쓰게 하는',
  관성: '일간을 극하는 오행으로 강한 힘을 제어하는',
  인성: '일간을 생하는 오행으로 힘을 보태는',
};
const GROUP_BY_REL: TenGodGroup[] = ['비겁', '식상', '재성', '관성', '인성'];
const groupOfElement = (chart: SajuChart, el: Element) => GROUP_BY_REL[mod(ELEMENTS.indexOf(el) - ELEMENTS.indexOf(chart.dayMaster.element), 5)]!;

function overviewSection(chart: SajuChart, name: string | null): ReadingSection {
  const dm = dayMasterContent(chart);
  const yong = chart.yongsin.yongsin;
  const need = ELEMENT_PLAIN[yong];
  return {
    key: 'overview',
    title: '총평',
    summary: '',
    keywords: [...dm.keywords.slice(0, 3), STRENGTH_PLAIN[chart.strength.level].chip],
    paragraphs: [
      `${nameSubject(name, '은')}${STEM_PLAIN[chart.dayMaster.index]!.line}`,
      `사주의 균형에 가장 도움이 되는 기운은 ${EL_KO[yong]}(${ELEMENT_PLAIN[yong].name}) 기운으로 보며, 생활 습관으로 옮기면 '${need.need}'에 가깝습니다. 아래 '나에게 필요한 기운'에서 구체적인 방법을 안내합니다.`,
    ],
    basis: `${chart.pillars.day.ganzhi.hangul}(${chart.pillars.day.ganzhi.hanja})일주 · 일간 ${dm.name} · 가장 강한 기운 ${EL_NAME[chart.elements.dominant]} · 용신 ${EL_NAME[chart.yongsin.yongsin]}`,
  };
}

function personalitySection(chart: SajuChart, name: string | null): ReadingSection {
  const dm = dayMasterContent(chart);
  const stage = TWELVE_STAGE_CONTENT[chart.pillars.day.branch.twelveStage];
  const body = dm.personality.map((p) => dmText(chart, p, name));
  // 성격 문단에서 이미 한 이야기(예: 자존심)는 '보완할 점'에서 다시 꺼내지 않는다
  const told = body.join(' ');
  const fresh = dm.weaknesses.filter((w) => !told.includes(w.split(' ')[0]!.replace(/(이|가|은|는|을|를|에|의|도)$/, '')));
  const cautions = (fresh.length >= 2 ? fresh : dm.weaknesses).slice(0, 2).map((w) => w.split(' — ').map(sentence).join(' '));
  return {
    key: 'personality',
    title: '타고난 성격',
    summary: `${josa(dm.strengths[0]!, '이', '가')} 가장 큰 강점이에요`,
    keywords: dm.keywords,
    paragraphs: [...body, `보완하면 좋은 점도 있어요. ${cautions.join(' ')}`],
    basis: `일간 ${dm.name} · ${chart.pillars.day.ganzhi.hangul}(${chart.pillars.day.ganzhi.hanja})일주 · 일지 12운성 ${stage.name}(${stage.keyword})`,
  };
}

function elementsSection(chart: SajuChart): ReadingSection {
  const e = chart.elements;
  const many = manyElements(chart);
  const none = noneElements(chart);
  const n = charCount(chart);
  const dist = ELEMENT_KEYS.map((k) => `${EL_KO[k]} ${e.count[k]}개`).join(', ');
  // 개념 → 개수 → 많은 것·없는 것 → 집계 기준. 없는 오행을 '채워야 할 기운'으로 단정하지 않는다(용신은 강약으로 정한다)
  const paragraphs = [
    `사주의 각 글자는 오행(五行), 곧 목(나무)·화(불)·토(흙)·금(쇠)·수(물)의 다섯 가지 기운 가운데 하나에 속합니다. ${n} 글자를 오행별로 세면 ${dist}입니다.`,
  ];
  for (const el of many) paragraphs.push(`${EL_KO[el]} 기운이 ${e.count[el]}개로 많은 편이에요. ${ELEMENT_PLAIN[el].many}`);
  for (const el of none) paragraphs.push(`${EL_KO[el]} 기운은 하나도 없어요. ${ELEMENT_PLAIN[el].none}`);
  if (many.length === 0 && none.length === 0) paragraphs.push('다섯 오행이 고르게 분포해 있어, 상황에 따라 유연하게 대응하기 쉬운 구조로 봐요.');
  paragraphs.push(
    `이 개수는 ${n} 글자를 단순히 센 달빛사주 기준 집계로, 지장간과 태어난 계절의 영향은 반영하지 않았어요.${
      none.length ? ' 또한 없는 오행이 곧 채워야 할 기운을 뜻하지는 않습니다. 사주에 필요한 기운은 일간의 강약을 함께 따져 정하며, 바로 아래에서 설명합니다.' : ''
    }`,
  );
  const summary =
    many.length && none.length
      ? `${koNames(many)} 기운이 많고 ${koNames(none)} 기운이 없는 사주예요`
      : none.length
        ? `${koNames(none)} 기운이 없는 사주예요`
        : many.length
          ? `${koNames(many)} 기운이 많은 사주예요`
          : '다섯 오행이 고르게 분포한 사주예요';
  return {
    key: 'elements',
    title: '다섯 가지 기운',
    summary,
    paragraphs,
    basis: `오행 개수(천간·지지 ${n} 글자 기준, 달빛사주 집계) ${ELEMENT_KEYS.map((k) => `${EL_NAME[k].slice(0, 1)}${e.count[k]}`).join(' ')} · 지장간·월령을 반영한 비중은 사주분석서에서 다뤄요`,
  };
}

function yongsinSection(chart: SajuChart, name: string | null): ReadingSection {
  const y = chart.yongsin;
  const s = chart.strength;
  const c = YONGSIN_CONTENT[y.yongsin];
  const info = ELEMENT_INFO[y.yongsin];
  const el = ELEMENT_PLAIN[y.yongsin];
  const k = EL_KO[y.yongsin];
  const n = charCount(chart);
  // 용신을 고른 까닭 — 달빛사주의 억부 중심 간이 계산(엔진 determineYongsin 과 같은 규칙)
  const reason =
    y.method === '중화'
      ? `${STRENGTH_PHRASE[s.level]}(달빛사주 기준 100점 만점에 ${s.score}점)에 해당해, 지장간과 계절까지 반영한 비중이 가장 약한 ${k} 기운을 보완하는 방식으로 정했어요.`
      : `${STRENGTH_PHRASE[s.level]}(달빛사주 기준 100점 만점에 ${s.score}점)에 해당해, ${YONGSIN_ROLE[groupOfElement(chart, y.yongsin)]} ${k} 기운이 균형에 도움이 된다고 봅니다.`;
  return {
    key: 'yongsin',
    title: '나에게 필요한 기운',
    summary: `${el.need}${josa(el.need, '이', '가').slice(el.need.length)} 가장 도움이 돼요`,
    keywords: [`행운의 색 ${LUCKY_COLOR_PLAIN[y.yongsin]}`, `행운의 방향 ${info.direction}`, `행운의 숫자 ${info.numbers.join('·')}`],
    paragraphs: [
      `용신(用神)은 사주의 균형과 흐름에 가장 도움이 되는 오행을 말합니다. ${nameSubject(name, '의')}용신은 ${k}(${el.name}) 기운으로 봐요.`,
      `${reason} 신강·신약 점수는 일간을 돕는 기운의 비중을 0~100점으로 환산한 서비스 자체 지표예요.`,
      `생활 습관으로 옮기면 '${el.need}'에 가깝습니다. ${el.needMore}${chart.elements.count[y.yongsin] === 0 ? ` 사주의 ${n} 글자 가운데 ${k} 기운은 하나도 없어, 운에서 이 기운이 들어오는 시기를 더 의미 있게 봅니다.` : ''}`,
      '용신을 정하는 방법은 일간의 강약을 조절하는 억부, 계절의 차고 더움을 조절하는 조후, 사주의 구조를 보는 격국 등 여러 가지이며 학파에 따라 결과가 다를 수 있습니다. 달빛사주는 억부를 중심으로 계산하고 조후와 격국은 반영하지 않은 참고용 판단이에요.',
      '일상에서는 이런 것부터 해 보세요.',
    ],
    tips: c.tips.slice(0, 4),
    basis: `용신 ${EL_NAME[y.yongsin]} · 희신 ${EL_NAME[y.heesin].slice(0, -1)}, 용신을 생하는 오행) · 기신 ${EL_NAME[y.gisin].slice(0, -1)}, 용신을 극하는 오행) · 일간의 강약 ${s.level} ${s.score}점(달빛사주 지표) · ${y.method === '중화' ? '강약이 균형에 가까워 비중이 가장 약한 오행' : '억부법(간이)'}`,
  };
}

/** 조사만 — '배움' → '이', '여유' → '가' */
const pt = (word: string, withBatchim: string, without: string) => josa(word, withBatchim, without).slice(word.length);
const GROUP_ORDER: TenGodGroup[] = ['비겁', '식상', '재성', '관성', '인성'];

function tenGodSection(chart: SajuChart, name: string | null): ReadingSection {
  const g = groupCount(chart);
  const top = dominantTenGod(chart);
  const tp = TEN_GOD_REPORT[top];
  const absentGroups = GROUP_ORDER.filter((k) => g[k] === 0);
  const paragraphs = [
    `${nameSubject(name, '은')}십성 가운데 ${josa(top, '이', '가')} 가장 많아, '${tp.phrase}'${pt(tp.phrase, '이', '가')} 두드러지는 편이에요. ${josa(top, '은', '는')} ${TEN_GOD_PLAIN[top].relation} 것을 말해요.`,
    tp.meaning,
    tp.strong,
  ];
  for (const group of absentGroups) paragraphs.push(`${josa(group, '에', '에')} 해당하는 글자는 없어요. ${GROUP_PLAIN[group].absent}`);
  return {
    key: 'tenGods',
    title: '나를 움직이는 힘',
    summary: `'${tp.phrase}'${pt(tp.phrase, '이', '가')} 가장 두드러져요`,
    keywords: [TEN_GOD_PLAIN_LABEL[top]!],
    paragraphs,
    basis: `가장 많은 십성 ${top} · ${GROUP_ORDER.map((k) => `${k} ${g[k]}`).join(' · ')} (일간을 뺀 천간과 지지의 십성 개수, 지지는 지장간 본기 기준)`,
  };
}

function shinsalSection(chart: SajuChart): ReadingSection {
  // 같은 신살이 기준(년지·일지)별로 두 번 잡힐 수 있어 이름으로 한 번만
  const all = chart.shinsal.filter((s, i, arr) => s.name !== '현침살' && arr.findIndex((x) => x.name === s.name) === i);
  if (all.length === 0) {
    return {
      key: 'shinsal',
      title: '타고난 특별한 기운',
      summary: '두드러진 신살이 없는 사주예요',
      paragraphs: ['신살(神殺)은 특정 글자의 조합에 붙이는 이름으로, 성향을 해석할 때 참고하는 보조 요소입니다. 달빛사주가 살펴보는 신살 가운데 해당하는 것이 없으며, 신살이 없다고 해서 좋거나 나쁜 것은 아니에요.'],
    };
  }
  // 도움이 되는 기운을 먼저, 조심할 기운은 하나만 — 첫 화면에서 겁주지 않게
  const ordered = [...all].sort((a, b) => SHINSAL_ORDER.indexOf(a.name) - SHINSAL_ORDER.indexOf(b.name));
  const byKind = (k: 'good' | 'neutral' | 'bad') => ordered.filter((s) => s.kind === k);
  const shown = [...byKind('good'), ...byKind('neutral'), ...byKind('bad').slice(0, 1)].slice(0, 3);
  const [first, ...rest] = shown;
  return {
    key: 'shinsal',
    title: '타고난 특별한 기운',
    summary: SHINSAL_PLAIN[first!.name].lead.replace(/\.$/, ''),
    paragraphs: [
      '신살(神殺)은 특정 글자의 조합에 붙이는 이름으로, 성향이나 두드러지는 부분을 해석할 때 참고하는 보조 요소입니다. 신살 하나만으로 좋고 나쁨을 판단하지는 않아요.',
      `${SHINSAL_PLAIN[first!.name].body} (${first!.name})`,
      ...rest.map((s) => `${SHINSAL_PLAIN[s.name].lead} ${SHINSAL_PLAIN[s.name].body} (${s.name})`),
    ],
    basis: `사주에 있는 신살 ${all.map((s) => s.name).join(', ')}`,
  };
}

// --- 유료 섹션(미니 리포트·사주분석서로 열림) — 무료 섹션과 같은 문체. 용어는 처음 나올 때 뜻을 붙인다 ---

function wealthSection(chart: SajuChart, name: string | null): ReadingSection {
  const dm = dayMasterContent(chart);
  const g = groupCount(chart);
  const p = [dmText(chart, dm.wealth, name)];
  if (g.재성 >= 3) p.push(`재성이 ${g.재성}개로 많은 편이라, 재물에 관심이 크고 기회를 포착하는 감각이 있다고 봐요. 다만 일이 몰려 지치면 판단이 흐려지기 쉬우니, 컨디션 관리도 재정 관리만큼 챙겨 주세요.`);
  else if (g.재성 === 0) p.push('사주의 글자 가운데 재성에 해당하는 것이 없어요. 재물을 직접 좇기보다 맡은 일에서 실력과 평판을 쌓을 때 수입이 따라오는 편으로 해석합니다. 수입을 늘리고 싶다면 자격이나 경력처럼 실력을 증명할 수 있는 것부터 갖춰 보세요.');
  else p.push('재성이 알맞게 있어 꾸준히 벌고 모으는 힘이 있다고 봐요. 수입원을 하나 더 만드는 작은 시도가 좋은 결과로 이어질 수 있어요.');
  if (g.식상 >= 2) p.push('식상도 두드러져, 재능과 아이디어를 수입으로 바꾸는 힘이 있다고 봅니다. 콘텐츠·기술·서비스처럼 직접 만든 결과물로 버는 방식이 잘 맞는 편이에요.');
  if (g.비겁 >= 3) p.push('비겁이 많아 친구나 동료와 돈이 얽힐 일이 생기기 쉬우니, 자신의 몫을 지키는 습관이 중요해요. 동업이나 돈거래에서는 계약서와 기록을 꼼꼼히 남겨 두세요.');
  const score = Math.min(95, 55 + g.재성 * 6 + g.식상 * 4 - Math.max(0, g.비겁 - 2) * 4);
  return {
    key: 'wealth',
    title: '재물운',
    summary: g.재성 ? '돈이 들고 나는 흐름을 잘 읽는 편이에요' : '실력을 쌓을수록 수입이 늘어나기 쉬운 사주예요',
    paragraphs: p,
    score,
    basis: `재성 ${g.재성} · 식상 ${g.식상} · 비겁 ${g.비겁} (일간을 뺀 천간·지지의 십성 개수, 지지는 지장간 본기 기준) · 분야별 점수는 이 개수로 환산한 달빛사주 지표`,
  };
}

function loveSection(chart: SajuChart, name: string | null): ReadingSection {
  const dm = dayMasterContent(chart);
  const dp = dayPillarContent(chart);
  const g = groupCount(chart);
  const male = chart.input.gender === 'male';
  const spouseGroup: TenGodGroup = male ? '재성' : '관성';
  const p = [dmText(chart, dm.love, name), dp.love];
  if (g[spouseGroup] === 0) p.push('배우자성이 사주의 글자 가운데 드러나 있지 않아요. 그래서 해마다 바뀌는 운에서 이 기운이 들어오는 시기에 인연이 닿기 쉽다고 봅니다.');
  else if (g[spouseGroup] >= 3) p.push('배우자성이 많은 편이라 이성의 관심을 받기 쉽다고 봐요. 여러 인연 가운데 자신을 편안하게 해 주는 사람을 고르는 것이 중요해요.');
  // 무료 '특별한 기운' 섹션과 같은 문장을 되풀이하지 않게 연애에 맞춘 말로
  if (hasShinsal(chart, '도화살')) p.push('매력과 인기를 뜻하는 도화가 있어, 연애에서도 첫 만남부터 호감을 얻기 쉬운 편이에요. 관심을 많이 받는 만큼, 마음은 한 사람에게 진솔하게 표현해 주세요.');
  if (hasShinsal(chart, '홍염살')) p.push('감수성과 매력을 뜻하는 홍염이 있어, 가까워질수록 매력이 더 잘 드러나는 편이에요. 서두르지 않고 천천히 마음을 열어도 충분해요.');
  const dayRel = chart.relations.filter((r) => r.positions.includes('day') && r.target === 'branch');
  const dayClash = dayRel.some((r) => r.type === '충');
  if (dayClash) p.push('일지가 사주 안의 다른 지지와 충을 이뤄, 가까운 관계에 변화가 생기기 쉽다고 봐요. 이별을 뜻하는 것은 아니며, 서로의 공간과 속도를 존중하면 관계를 오래 이어 가기 쉬워요.');
  const score = Math.min(95, 58 + g[spouseGroup] * 6 + (hasShinsal(chart, '도화살') ? 6 : 0) - (dayClash ? 8 : 0));
  // 요약은 본문 첫 문장과 겹치지 않게 — 배우자성 개수로 짧게
  const loveSummary = g[spouseGroup] === 0 ? '인연이 들어오는 시기를 잘 살피면 좋은 사주예요' : g[spouseGroup] >= 3 ? '사람을 끄는 힘이 있는 사주예요' : '진심으로 오래 가는 사랑을 하는 편이에요';
  const tags = [hasShinsal(chart, '도화살') && '도화살', hasShinsal(chart, '홍염살') && '홍염살', dayClash && '일지 충'].filter(Boolean);
  return {
    key: 'love',
    title: '연애·결혼운',
    summary: loveSummary,
    paragraphs: p,
    score,
    basis: `배우자성(${spouseGroup}) ${g[spouseGroup]}개 · 일지 ${chart.pillars.day.branch.hangul}(${chart.pillars.day.branch.hanja}) ${chart.pillars.day.branch.tenGod}${tags.length ? ` · ${tags.join(' · ')}` : ''}`,
  };
}

function careerSection(chart: SajuChart, name: string | null): ReadingSection {
  const dm = dayMasterContent(chart);
  const dp = dayPillarContent(chart);
  const g = groupCount(chart);
  const p = [dmText(chart, dm.career, name), dp.career, `잘 맞는 분야로는 ${dm.jobs.join(', ')} 등을 꼽을 수 있어요.`];
  if (g.관성 >= 2) p.push('관성이 두드러져 책임감이 강하고, 조직과 제도 안에서 인정받기 쉽다고 봐요. 공공기관, 규모 있는 회사, 전문 자격이 필요한 분야에서 안정적으로 경력을 쌓기 좋아요.');
  if (g.식상 >= 2) p.push('일에서도 식상의 표현력과 창의력이 강점으로 꼽혀요. 기획·창작·교육·프리랜서처럼 자신의 방식으로 일할 수 있는 자리가 잘 맞는 편입니다.');
  if (g.인성 >= 2) p.push('인성이 두드러져 깊이 공부하고 가르치는 일과 잘 맞는다고 봐요. 연구·교육·상담처럼 자격이 필요한 일에서 전문성을 쌓으면 대체하기 어려운 인재가 되기 쉬워요.');
  if (hasShinsal(chart, '역마살')) p.push('이동과 변화를 뜻하는 역마가 있어, 일에서도 자리를 옮기거나 외부 활동이 많은 업무가 잘 맞는 편이에요. 출장이 잦거나 해외와 연결된 일을 눈여겨보세요.');
  if (hasShinsal(chart, '문창귀인')) p.push('학문과 문장을 뜻하는 문창귀인이 있어, 글과 말로 생각을 정리하는 능력이 일에서도 강점이 돼요. 기획서·보고서·강의처럼 사고력이 필요한 일에서 돋보이기 쉬워요.');
  const score = Math.min(95, 58 + g.관성 * 5 + g.인성 * 3 + g.식상 * 3);
  return {
    key: 'career',
    title: '일과 적성',
    summary: `${dm.jobs.slice(0, 3).join(', ')} 분야와 잘 맞아요`,
    keywords: dm.jobs.slice(0, 5),
    paragraphs: p,
    score,
    basis: `관성 ${g.관성} · 식상 ${g.식상} · 인성 ${g.인성}${hasShinsal(chart, '역마살') ? ' · 역마살' : ''}${hasShinsal(chart, '문창귀인') ? ' · 문창귀인' : ''}`,
  };
}

/** 오행 이론에서 각 기운과 연결해 보는 몸의 부위와 생활 관리 — 진단이 아니다 */
const ORGAN_NOTE: Record<Element, { organs: string; tip: string }> = {
  wood: { organs: '간·담(쓸개), 눈, 근육', tip: '눈의 피로와 몸의 뻣뻣함을 살피고 스트레칭을 챙겨 보세요.' },
  fire: { organs: '심장·소장과 혈액순환', tip: '수면 리듬과 마음의 긴장을 함께 살펴 주세요.' },
  earth: { organs: '비장·위장과 소화', tip: '식사 시간과 식습관부터 점검해 보는 것이 좋아요.' },
  metal: { organs: '폐·대장, 코, 피부', tip: '호흡기와 피부 보습을 챙겨 주세요.' },
  water: { organs: '신장(콩팥)·방광, 귀, 뼈', tip: '몸을 따뜻하게 하고 충분히 자는 것이 좋아요.' },
};

function healthSection(chart: SajuChart, name: string | null): ReadingSection {
  const dm = dayMasterContent(chart);
  const many = manyElements(chart);
  const none = noneElements(chart);
  // 글자 개수 기준(화면 도넛과 같은 숫자). 병원 안내는 섹션 끝에 한 번만
  const p = [dmText(chart, dm.health, name)];
  for (const el of many) {
    // 나를 뜻하는 기운은 바로 앞 문단(일간 건강)이 이미 말했다
    p.push(el === chart.dayMaster.element ? `${EL_KO[el]} 기운이 많은 편이라, 위에서 말한 부분을 특히 잘 살펴 주세요.` : `${EL_KO[el]} 기운이 많은 편이라, 이 기운과 연결해 보는 ${ORGAN_NOTE[el].organs} 쪽에 무리가 가지 않게 살펴 주세요. ${ORGAN_NOTE[el].tip}`);
  }
  for (const el of none) p.push(`${EL_KO[el]} 기운은 하나도 없어, 이 기운과 연결해 보는 ${ORGAN_NOTE[el].organs} 쪽 컨디션을 꾸준히 살피는 것이 좋다고 봐요. ${ORGAN_NOTE[el].tip}`);
  p.push('사주로 보는 건강 풀이는 생활 습관을 돌아보는 참고 자료이며 진단이 아닙니다. 불편한 증상이 이어지면 꼭 병원에서 확인해 주세요.');
  return {
    key: 'health',
    title: '건강',
    summary: none.length ? `${koNames(none)} 기운과 연결된 부분의 컨디션을 챙기면 좋아요` : '규칙적인 생활 리듬이 가장 중요해요',
    paragraphs: p,
    basis: `오행 개수 ${ELEMENT_KEYS.map((k) => `${EL_NAME[k].slice(0, 1)}${chart.elements.count[k]}`).join(' ')}${many.length ? ` · 많은 오행 ${many.map((e) => EL_NAME[e]).join('·')}` : ''}${none.length ? ` · 없는 오행 ${none.map((e) => EL_NAME[e]).join('·')}` : ''}`,
  };
}

function daeunSection(chart: SajuChart, now = new Date(), name: string | null = null): ReadingSection {
  const year = now.getFullYear();
  const birthYear = chart.solarDate.year;
  const started = year - birthYear >= chart.daeun.startAge;
  const periods = chart.daeun.periods.slice(0, 8);
  const current = periods.find((p) => year >= p.startYear && year <= p.endYear);
  const paragraphs: string[] = [
    `대운(大運)은 태어난 달의 기둥에서 출발해 10년마다 바뀌는 운의 큰 흐름입니다. ${nameSubject(name, '의')}첫 대운은 만 ${chart.daeun.startAge}세에 ${started ? '시작됐어요' : '시작돼요'}. 시작 나이는 성별과 태어난 해의 음양, 출생일과 절기 사이의 날수에 따라 사람마다 다릅니다. 달빛사주는 출생일과 절입일(절기가 바뀌는 날) 사이의 날수를 3으로 나누어 계산하고, 대운의 진행 방향에 따라 다음 또는 지난 절입일을 기준으로 삼아요. 시기별 등급은 그 시기의 간지와 사주의 관계를 점수로 환산한 달빛사주 기준이에요.`,
  ];
  // 같은 묶음의 10년이 다시 나오면 긴 풀이는 처음 한 번만
  const told = new Set<TenGodGroup>();
  for (const p of periods) {
    const ev = evaluateFortune(chart, p);
    const group = TEN_GOD_GROUP[p.stemTenGod];
    const head = `${p === current ? '▶ ' : ''}${p.startAge}~${p.endAge}세 (${p.startYear}~${p.endYear}년) · ${GRADE_PLAIN_LABEL[ev.grade]} — '${TEN_GOD_PLAIN_LABEL[p.stemTenGod]}'의 10년.`;
    // 이미 지나온 어린 시절의 10년은 직장·돈 이야기 대신 그때의 모습으로
    if (p.endAge < 20 && p.endYear < year) {
      paragraphs.push(`${head} ${CHILD_HINT[p.stemTenGod]}`);
      continue;
    }
    if (told.has(group)) paragraphs.push(`${head} 앞에서 본 '${GROUP_PLAIN[group].name}'의 흐름이 다시 이어지는 시기예요.`);
    else paragraphs.push(`${head} ${FORTUNE_TEMPLATES.daeunTheme[group]}`);
    told.add(group);
  }
  return {
    key: 'daeun',
    title: '10년마다 바뀌는 큰 흐름',
    summary: current ? `지금은 ${current.startYear}~${current.endYear}년의 10년을 지나고 있어요` : `만 ${chart.daeun.startAge}세에 첫 번째 10년이 시작돼요`,
    paragraphs,
    keywords: [`현재 만 ${Math.max(0, year - birthYear)}세`],
    basis: `대운수 ${chart.daeun.startAge}(출생일과 절입일 사이 날수 ÷ 3, 달빛사주 계산) · ${chart.daeun.direction === 'forward' ? '순행' : '역행'}${current ? ` · 지금 ${current.ganzhi.hangul}(${current.ganzhi.hanja}) 대운` : ''} · ${periods.map((p) => `${p.ganzhi.hangul} ${p.stemTenGod}`).join(', ')}`,
  };
}

/** 십성 운 문구 첫머리의 '비견운에는' 같은 말을 다른 머리말로 */
export const luckOpening = (text: string, lead: string) => text.replace(/^\S+운에는 /, lead);

/** 같은 리포트 안에서 같은 하이라이트 문장을 되풀이하지 않게(report.ts reportOnce 와 같은 모양) */
interface Seen {
  first: (key: string) => boolean;
}
/** 운의 하이라이트(신살·합충) → 리포트용 문장. 용신·기신 안내는 fit 문장이 맡으므로 뺀다 */
export function plainHighlights(hs: FortuneHighlight[], n: number, seen?: Seen): { text: string[]; terms: string[] } {
  const picked = hs.filter((h) => !h.startsWith('yongsin') && !h.startsWith('gisin')).filter((h) => !seen || seen.first(`hl:${h}`)).slice(0, n);
  return { text: picked.map((h) => HIGHLIGHT_PLAIN[h]), terms: picked.map((h) => HIGHLIGHT_TERM_REPORT[h]) };
}

export function yearBriefSection(chart: SajuChart, year: number, name: string | null = null, seen?: Seen): ReadingSection {
  const yp = yearPillarOf(year);
  const ev = evaluateFortune(chart, yp, `year-${year}`);
  const stg = ev.pillar.stemTenGod;
  const tg = TEN_GOD_CONTENT[stg];
  const tp = TEN_GOD_REPORT[stg];
  const hl = plainHighlights(ev.highlights, 3, seen);
  return {
    key: `year${year}`,
    title: `${year}년 운세`,
    summary: pick(FORTUNE_TEMPLATES.yearlyHeadline[ev.grade], `${year}-${chart.pillars.day.ganzhi.index}`),
    score: ev.scores.total,
    keywords: [TEN_GOD_PLAIN_LABEL[stg]!, GRADE_PLAIN_LABEL[ev.grade]],
    basis: `${ev.pillar.ganzhi.hangul}(${ev.pillar.ganzhi.hanja})년 · 천간 ${stg} · 지지 ${ev.pillar.branchTenGod} · ${GRADE_LABEL[ev.grade]}${hl.terms.length ? ` · ${hl.terms.join(' · ')}` : ''}`,
    paragraphs: [
      `${year}년은 ${nameSubject(name, '에게')}'${tp.phrase}'${pt(tp.phrase, '이', '가')} 들어오는 해로 봐요. ${luckOpening(tg.inLuck.general, '이런 해에는 ')}`,
      `재물: ${tg.inLuck.wealth}`,
      `애정: ${tg.inLuck.love}`,
      `일·커리어: ${tg.inLuck.career}`,
      `건강: ${tg.inLuck.health}`,
      ...hl.text,
    ],
  };
}

export type ReadingAccess = 'none' | 'mini' | 'full';

/**
 * 기본 풀이. access 에 따라 유료 섹션을 잠근다.
 * - none: 무료 섹션만 공개
 * - mini: 첫 사주 미니 리포트(990원) — 재물·연애·직업 공개
 * - full: 평생 사주분석서 — 전체 공개
 * 용어 뜻은 화면 순서(총평은 '한눈에 보는 나' 카드가 대신하므로 빼고)대로 처음 나온 자리에 붙인다.
 */
export function buildBasicReading(chart: SajuChart, opts: { access: ReadingAccess; now?: Date; name?: string | null }): ReadingDto {
  const now = opts.now ?? new Date();
  const dp = dayPillarContent(chart);
  const name = displayName(opts.name);
  const full = opts.access === 'full';
  const mini = full || opts.access === 'mini';
  const PRODUCT = 'report_saju_lifetime';
  const MINI = 'report_saju_mini';
  const sp = STEM_PLAIN[chart.dayMaster.index]!;
  const lucky = ELEMENT_INFO[chart.yongsin.yongsin];
  const [overview, ...shown] = [
    overviewSection(chart, name),
    personalitySection(chart, name),
    elementsSection(chart),
    yongsinSection(chart, name),
    shinsalSection(chart),
    lock(wealthSection(chart, name), !mini, MINI),
    lock(loveSection(chart, name), !mini, MINI),
    lock(careerSection(chart, name), !mini, MINI),
    lock(healthSection(chart, name), !full, PRODUCT),
    lock(tenGodSection(chart, name), !full, PRODUCT),
    lock(daeunSection(chart, now, name), !full, PRODUCT),
    lock(yearBriefSection(chart, targetFortuneYear(now), name), !full, PRODUCT),
  ];
  return {
    chart,
    headline: sp.headline,
    dayPillarTitle: dp.title,
    keyPoints: [
      { label: '성격', text: sp.trait },
      { label: '잘하는 것', text: sp.strength },
      { label: '조심할 것', text: sp.caution },
      { label: '필요한 것', text: ELEMENT_PLAIN[chart.yongsin.yongsin].need },
      { label: '행운 포인트', text: `색 ${LUCKY_COLOR_PLAIN[chart.yongsin.yongsin]} · 방향 ${lucky.direction} · 숫자 ${lucky.numbers.join('·')}` },
    ],
    sections: [overview!, ...defineSections(shown)],
    generator: 'rule',
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// 오늘의 운세 · 신년운세 · 궁합
// 본문은 생활의 말로 쓰고, 이유를 설명하는 자리(오늘이 이런 이유·총운)에서 일진·세운의 십성을 뜻과 함께 밝힌다.
// 간지·12운성·신살 목록 같은 근거는 basis('사주로 보면')에 모은다.
// ---------------------------------------------------------------------------

const LUCKY_TIME: Record<Element, string> = { wood: '오전 5~7시', fire: '오전 11시~오후 1시', earth: '오후 1~3시', metal: '오후 5~7시', water: '밤 9~11시' };

/** 운에서 들어온 기운의 용어 — 근거 줄에만 쓴다 */
const HIGHLIGHT_TERM: Record<FortuneHighlight, string> = {
  yongsin_stem: '천간이 용신',
  yongsin_branch: '지지가 용신',
  gisin_stem: '천간이 기신',
  gisin_branch: '지지가 기신',
  stem_combine_day: '일간과 천간합',
  stem_clash_day: '일간과 천간충',
  branch_combine_day: '일지와 합',
  branch_clash_day: '일지와 충',
  branch_punish_day: '일지와 형',
  branch_wonjin_day: '일지와 원진',
  branch_clash_month: '월지와 충',
  dohwa: '도화',
  yeokma: '역마',
  hwagae: '화개',
  cheoneul: '천을귀인',
  munchang: '문창귀인',
  yangin: '양인',
  gongmang: '공망',
};

/** '사주로 보면' 한 줄 — 오늘·올해 공통. 끝에 점수·등급이 달빛사주 기준임을 밝힌다 */
function luckBasis(label: string, ev: FortuneEvaluation): string {
  const p = ev.pillar;
  return [
    `${label} ${p.ganzhi.hangul}(${p.ganzhi.hanja})`,
    `천간 ${p.stemTenGod} · 지지 ${p.branchTenGod}(지장간 본기 기준)`,
    `12운성 ${p.twelveStage}`,
    ...ev.highlights.map((h) => HIGHLIGHT_TERM[h]),
    '총운·분야별 점수와 등급은 이 관계들을 점수로 환산한 달빛사주 기준이에요',
  ].join(' · ');
}

/**
 * 운의 첫 문단 — "오늘은 서윤님에게 '배움과 도움'의 기운이 들어오는 날입니다. 오늘 일진의 천간이 정인에 해당하기 때문이에요. …"
 * 무엇이 들어오는지 → 왜 그런지(간지의 천간이 어떤 십성인지, 그 십성의 뜻) → 어떤 경향인지 순서로.
 * 천간이 용신·기신이면 그 말을 같은 문단에 녹이고, 그 하이라이트는 따로 쓰지 않는다.
 */
function luckLead(ev: FortuneEvaluation, opts: { when: string; unit: '날' | '해'; source: string; general: string; name: string | null }): { text: string; folded: FortuneHighlight[] } {
  const tg = ev.pillar.stemTenGod;
  const p = TEN_GOD_PLAIN[tg];
  const who = opts.name ? `${opts.name}님에게 ` : '';
  const parts = [
    `${opts.when} ${who}'${p.theme}'의 기운이 들어오는 ${opts.unit === '날' ? '날입니다' : '해입니다'}.`,
    `${opts.source}의 천간이 ${josa(tg, '에', '에')} 해당하기 때문이에요.`,
    `${josa(tg, '은', '는')} ${p.relation} 것을 말해요.`,
    `${opts.unit === '날' ? '이런 날은' : '이런 해에는'} ${opts.general}`,
  ];
  if (ev.fit.stem === 'yongsin') {
    parts.push('이 기운은 용신에 해당해, 계획해 둔 일을 실행에 옮기기 좋은 때로 봐요.');
    return { text: parts.join(' '), folded: ['yongsin_stem'] };
  }
  if (ev.fit.stem === 'gisin') {
    parts.push('이 기운은 기신에 해당해, 큰일은 한 번 더 살피고 정하는 것이 좋아요.');
    return { text: parts.join(' '), folded: ['gisin_stem'] };
  }
  return { text: parts.join(' '), folded: [] };
}

/** 이미 앞 문단(그 기운의 설명)에서 한 말과 겹치는 하이라이트 — 예: '배움과 도움' 뒤의 '돕는 사람' */
const HIGHLIGHT_SAID_BY: Partial<Record<FortuneHighlight, TenGod[]>> = { cheoneul: ['정인'], munchang: ['정인', '편인'], hwagae: ['편인'], yangin: ['겁재'] };

/** 첫 문단에 녹인 것을 뺀 하이라이트 — 사주와 맞는지(용신·기신)를 먼저 */
function restHighlights(ev: FortuneEvaluation, folded: FortuneHighlight[], max: number, told: TenGod[] = [ev.pillar.stemTenGod]): string[] {
  const alreadySaid = (h: FortuneHighlight) =>
    folded.includes(h) ||
    (HIGHLIGHT_SAID_BY[h] ?? []).some((t) => told.includes(t)) ||
    // 일지와 충이 있으면 월지와 충(같은 '변화' 이야기)은 한 번만
    (h === 'branch_clash_month' && ev.highlights.includes('branch_clash_day'));
  const rest = ev.highlights.filter((h) => !alreadySaid(h));
  const fitFirst = [...rest.filter((h) => /^(yongsin|gisin)/.test(h)), ...rest.filter((h) => !/^(yongsin|gisin)/.test(h))];
  return fitFirst.slice(0, max).map((h) => FORTUNE_TEMPLATES.highlights[h]);
}

/** 행운 아이템 — 숫자는 따로 보여 주므로 빼고, 괄호 속 한자는 지운다 */
const luckyItem = (el: Element, seed: string) =>
  pick(ELEMENT_CONTENT[el].luckyItems.filter((x) => !x.startsWith('숫자')), seed).replace(/\([一-鿿]+\)/g, '');

/** 오늘의 운세. rawName 은 프로필(또는 비회원 입력) 이름 — 있으면 "서윤님," 하고 부른다 */
export function buildDailyFortune(chart: SajuChart, date: { year: number; month: number; day: number }, profileId: string | null, rawName: string | null = null): DailyFortuneDto {
  const name = displayName(rawName);
  const dp = dayPillarOf(date);
  const dateStr = `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
  const seed = `${dateStr}|${chart.birthUtc}`;
  const ev = evaluateFortune(chart, dp, seed);
  const tg = TEN_GOD_CONTENT[ev.pillar.stemTenGod];
  const cats: DailyCategory[] = ['wealth', 'love', 'career', 'health', 'study'];
  const categories = cats.map((k) => ({
    key: k,
    label: CATEGORY_PLAIN[k].label,
    score: ev.scores[k],
    message: pick(FORTUNE_TEMPLATES.dailyCategory[k][band(ev.scores[k])], `${seed}|${k}`),
  }));
  const ranked = [...categories].sort((x, y) => y.score - x.score);
  const top = ranked[0]!;
  const low = ranked[ranked.length - 1]!;
  const advice = pick(tg.dailyAdvice, `${seed}|advice`);
  // 운이 낮은 날에는 그 기운의 조심할 모습을 말한다('기회가 많아져요'라고 해 놓고 '조심할 날'이 되지 않게)
  const tgPlain = TEN_GOD_PLAIN[ev.pillar.stemTenGod];
  const lead = luckLead(ev, { when: '오늘은', unit: '날', source: '오늘 일진', general: ev.grade === 'caution' || ev.grade === 'bad' ? tgPlain.lineLow : tgPlain.line, name });
  const el = ev.lucky.element;
  return {
    date: dateStr,
    profileId,
    dayPillar: { hanja: ev.pillar.ganzhi.hanja, hangul: ev.pillar.ganzhi.hangul },
    evaluation: ev,
    gradeLabel: DAY_GRADE_PLAIN[ev.grade],
    headline: pick(FORTUNE_TEMPLATES.dailyHeadline[ev.grade], `${seed}|head`),
    message: `${name ? `${name}님, ` : ''}${pick(FORTUNE_TEMPLATES.dailyMessage[ev.grade], `${seed}|msg`)}`,
    categories,
    advice,
    // 사주를 몰라도 10초 안에 — 무엇이 잘 풀리고 무엇을 조심할지
    keyPoints: [
      { label: '잘 풀리는 일', text: top.score >= 50 ? CATEGORY_PLAIN[top.key].good : `${josa(top.label, '이', '가')} 상대적으로 무난한 편이에요` },
      { label: '조심할 일', text: low.score >= 70 ? '크게 조심할 일은 없어요' : CATEGORY_PLAIN[low.key].watch },
      { label: '오늘 해 볼 일', text: advice.replace(/^오늘(은)? /, '') },
    ],
    why: defineTerms([lead.text, ...restHighlights(ev, lead.folded, 2)]),
    basis: luckBasis('오늘 일진', ev),
    lucky: {
      color: LUCKY_COLOR_PLAIN[el],
      number: ev.lucky.number,
      direction: ev.lucky.direction,
      item: luckyItem(el, `${seed}|item`),
      time: LUCKY_TIME[el],
    },
    shareText: pick(FORTUNE_TEMPLATES.shareQuotes, `${seed}|share`),
  };
}

// ---------------------------------------------------------------------------
// 신년(세운) 운세
// ---------------------------------------------------------------------------

type YearCategory = 'wealth' | 'love' | 'career' | 'health';
const YEAR_CATEGORIES: YearCategory[] = ['wealth', 'love', 'career', 'health'];
const YEAR_SECTION_TITLE: Record<YearCategory, string> = { wealth: '재물운', love: '애정운', career: '직장·사업운', health: '건강운' };
const YEAR_TOC: Record<YearCategory, string[]> = {
  wealth: ['올해 돈이 들어오고 나가는 흐름', '돈 관리에서 챙길 점', '열두 달 흐름'],
  love: ['올해 연애와 대인 관계의 흐름', '관계에서 챙길 점', '열두 달 흐름'],
  career: ['올해 일과 직장의 흐름', '일에서 챙길 점', '열두 달 흐름'],
  health: ['올해 몸 컨디션의 흐름', '건강을 위해 챙길 습관', '열두 달 흐름'],
};

/** 열두 달 요약 — 같은 문장이 두 번 나오지 않게 고른다(같은 등급 문구가 모자라면 그달 기운의 문장으로) */
function monthSummaries(chart: SajuChart, year: number, seed: string) {
  const used = new Set<string>();
  return wolun(chart.dayMaster.index, year).map((m, i) => {
    const mev = evaluateFortune(chart, m, `${seed}-m${m.order}`);
    const pool = FORTUNE_TEMPLATES.monthlySummary[mev.grade];
    const start = hashSeed(`${seed}-ms${m.order}`) % pool.length;
    const rotated = [...pool.slice(start), ...pool.slice(0, start)];
    const fallback = TEN_GOD_PLAIN[m.stemTenGod].month;
    const summary = rotated.find((s) => !used.has(s)) ?? (used.has(fallback) ? rotated[0]! : fallback);
    used.add(summary);
    // 달마다 이름표가 붙어 있으니 '이번 달은'은 뺀다(열두 줄이 같은 말로 시작하지 않게)
    const calMonth = ((i + 1) % 12) + 1; // 寅월 ≈ 양력 2월
    return { order: m.order, label: `${calMonth}월`, ganzhi: m.ganzhi.hanja, score: mev.scores.total, summary: summary.replace(/^이번 달은 /, '') };
  });
}

/** 신년운세. rawName 은 프로필 이름 */
export function buildYearlyFortune(chart: SajuChart, year: number, unlocked: boolean, rawName: string | null = null): YearlyFortuneDto {
  const name = displayName(rawName);
  const yp = yearPillarOf(year);
  const ev: FortuneEvaluation = evaluateFortune(chart, yp, `year-${year}`);
  const stg = ev.pillar.stemTenGod;
  const btg = ev.pillar.branchTenGod;
  const tg = TEN_GOD_CONTENT[stg];
  const bt = TEN_GOD_CONTENT[btg];
  const plain = TEN_GOD_PLAIN[stg];
  const PRODUCT = `report_newyear_${year}`;
  const seed = `${year}-${chart.birthUtc}`;
  // 운이 낮은 해에는 그 기운의 조심할 모습을 말한다(좋은 말 뒤에 '잘 맞지 않는다'가 붙어 앞뒤가 엇갈리지 않게)
  const lead = luckLead(ev, { when: `${year}년은`, unit: '해', source: `${year}년 ${ev.pillar.ganzhi.hangul}년`, general: ev.grade === 'caution' || ev.grade === 'bad' ? plain.lineLow : tg.inLuck.general, name });
  const total: ReadingSection = {
    key: 'total',
    title: `${year}년 총운`,
    summary: '',
    paragraphs: [
      lead.text,
      // 같은 십성이면 같은 말이 되므로 한 번만. 지지의 십성은 지장간 본기 기준이다
      ...(btg !== stg ? [`한편 지지는 ${TEN_GOD_PLAIN[btg].relation} ${josa(btg, '에', '에')} 해당해, '${TEN_GOD_PLAIN[btg].theme}'의 기운도 함께 작용합니다. ${bt.inLuck.general}`] : []),
      ...restHighlights(ev, lead.folded, 2, btg !== stg ? [stg, btg] : [stg]),
    ],
    basis: luckBasis(`${year}년`, ev),
  };
  const category = (key: YearCategory): ReadingSection =>
    lock(
      {
        key,
        title: YEAR_SECTION_TITLE[key],
        score: ev.scores[key],
        summary: pick(YEARLY_CATEGORY[key][band(ev.scores[key])], `${seed}${key[0]}`),
        paragraphs: [tg.inLuck[key], ...(btg !== stg ? [`한편 ${bt.inLuck[key]}`] : [])],
        toc: YEAR_TOC[key],
      },
      !unlocked,
      PRODUCT,
    );
  const ranked = [...YEAR_CATEGORIES].sort((x, y) => ev.scores[y] - ev.scores[x]);
  const best = ranked[0]!;
  const worst = ranked[ranked.length - 1]!;
  const months = monthSummaries(chart, year, seed).map((m, i) => ({ ...m, locked: !unlocked && i >= 2 }));
  return {
    year,
    yearPillar: { hanja: ev.pillar.ganzhi.hanja, hangul: ev.pillar.ganzhi.hangul },
    evaluation: ev,
    headline: pick(FORTUNE_TEMPLATES.yearlyHeadline[ev.grade], seed),
    yearName: yearNickname(yp.stem, yp.branch),
    gradeLabel: YEAR_GRADE_PLAIN[ev.grade],
    keyPoints: [
      { label: '올해의 기운', text: `'${plain.theme}'의 해예요` },
      {
        label: '잘 풀리는 일',
        text: ev.scores[best] >= 50 ? `${josa(YEAR_CATEGORY_PLAIN[best].good, '이', '가')} 가장 순조롭기 쉬워요` : `${josa(YEAR_CATEGORY_PLAIN[best].label, '이', '가')} 상대적으로 무난한 편이에요`,
      },
      { label: '조심할 것', text: ev.scores[worst] >= 70 ? '크게 조심할 일은 없어요' : `${josa(YEAR_CATEGORY_PLAIN[worst].watch, '은', '는')} 조심하는 것이 좋아요` },
      { label: '해 볼 일', text: plain.yearTip },
    ],
    sections: defineSections([total, ...YEAR_CATEGORIES.map(category)]),
    // 잠긴 달은 점수·요약을 비운다 — 화면은 자물쇠만 보이고, 안내는 목록 아래 한 줄로
    months: months.map((m) => (m.locked ? { ...m, summary: '', score: 0 } : m)),
    locked: !unlocked,
  };
}

// ---------------------------------------------------------------------------
// 궁합
// ---------------------------------------------------------------------------

export const COMPAT_GRADE_LABEL = { excellent: '아주 잘 맞는 사이', good: '잘 맞는 사이', normal: '맞춰 가면 좋은 사이', effort: '노력이 필요한 사이' } as const;

/**
 * 궁합 섹션 — 무료: 두 사람이 어떤 사람인지 + 잘 맞는 점 두 가지까지 / 유료: 끌림·조심할 점·조언.
 * names 는 프로필 이름(비회원은 입력 이름, 없으면 '나'·'상대'). 이름이 없으면 '나'와 '상대'로 부른다.
 */
export function buildCompatibilitySections(a: SajuChart, b: SajuChart, r: CompatibilityResult, names: { a: string; b: string }, unlocked: boolean) {
  const PRODUCT = 'report_compat';
  const na = displayName(names.a);
  const nb = displayName(names.b);
  const A = na ? `${na}님` : '나';
  const B = nb && nb !== '상대' ? `${nb}님` : '상대';
  const people = { a: A, b: B, ca: a, cb: b };
  const dmA = dayMasterContent(a);
  const dmB = dayMasterContent(b);

  // 엔진 요인 → 문장. 같은 말이 두 번 나오지 않게 묶는다
  // - 오행 보완은 사람별로 한 문장에, 용신과 같은 오행이면 보완 문장은 뺀다
  // - 서로가 서로의 배우자성이면 한 문장으로
  type Line = { text: string; term: string; tone: 'positive' | 'negative' | 'neutral' };
  const lines: Line[] = [];
  const has = (key: string) => r.factors.some((f) => f.key === key);
  const lacking = (side: 'a' | 'b') => {
    const giverDominant = (side === 'a' ? b : a).elements.dominant;
    const covered = has(side === 'a' ? 'yongsin_a' : 'yongsin_b');
    return r.factors
      .filter((f) => f.key.startsWith(`complement_${side}_`))
      .map((f) => f.key.slice(13) as Element)
      .filter((e) => !(covered && e === giverDominant));
  };
  const spouse = r.factors.filter((f) => f.key.startsWith('spouse_star_'));
  const spouseBoth = spouse.length === 2 && spouse[0]!.weight === spouse[1]!.weight;
  let complementDone = false;
  let spouseDone = false;
  for (const f of r.factors) {
    if (f.key.startsWith('complement_')) {
      if (complementDone) continue;
      complementDone = true;
      if (lacking('a').length) lines.push({ ...complementPlain(lacking('a'), A, B), tone: 'positive' });
      if (lacking('b').length) lines.push({ ...complementPlain(lacking('b'), B, A), tone: 'positive' });
      continue;
    }
    if (spouseBoth && f.key.startsWith('spouse_star_')) {
      if (spouseDone) continue;
      spouseDone = true;
      const p = compatFactorPlain({ ...f, key: 'spouse_star_both' }, people);
      if (p) lines.push({ ...p, tone: f.tone });
      continue;
    }
    const p = compatFactorPlain(f, people);
    if (p) lines.push({ ...p, tone: f.tone });
  }
  const pos = lines.filter((l) => l.tone === 'positive');
  const neg = lines.filter((l) => l.tone === 'negative');
  const freePos = pos.slice(0, 2);
  const restPos = pos.slice(2);
  const terms = (ls: Line[]) => [...new Set(ls.map((l) => l.term))].join(' · ');

  const spA = STEM_PLAIN[a.dayMaster.index]!;
  const spB = STEM_PLAIN[b.dayMaster.index]!;
  const sameStem = a.dayMaster.index === b.dayMaster.index;
  const whoLine = sameStem ? `두 사람 모두 ${spA.headline}이에요.` : `${josa(A, '은', '는')} ${spA.headline}이고, ${josa(B, '은', '는')} ${spB.headline}이에요.`;
  const loveLines = sameStem
    ? [`두 사람 모두 ${LOVE_STYLE[a.dayMaster.index]}`]
    : [`${josa(A, '은', '는')} ${LOVE_STYLE[a.dayMaster.index]}`, `${josa(B, '은', '는')} ${LOVE_STYLE[b.dayMaster.index]}`];

  const sections: ReadingSection[] = [
    {
      key: 'summary',
      title: '한눈에 보는 궁합',
      // 점수·등급·한 줄 평은 화면 위 점수 카드에 있으므로 요약은 비워 둔다(같은 말 두 번 금지)
      summary: '',
      paragraphs: [whoLine, ...(freePos.length ? freePos.map((l) => l.text) : ['두드러진 끌림보다는 시간이 지날수록 관계가 깊어지는 사이로 봐요.'])],
      basis: [
        `${names.a} 일간 ${dmA.name}`,
        `${names.b} 일간 ${dmB.name}`,
        ...new Set(freePos.map((l) => l.term)),
        '궁합 점수와 등급은 일간·일지·띠·오행·용신·배우자성의 관계를 합산한 달빛사주 기준이에요',
      ].join(' · '),
    },
    lock(
      {
        key: 'strengths',
        title: '서로 끌리는 이유',
        summary: pos.length >= 3 ? '잘 맞는 점이 여러 가지 있어요' : pos.length ? '잘 맞는 점이 분명히 있어요' : '시간을 두고 가까워지는 사이예요',
        paragraphs: [COMPAT_CATEGORY_PLAIN.romance[band(r.categories.romance)], ...restPos.map((l) => l.text), COMPAT_CATEGORY_PLAIN.complement[band(r.categories.complement)]],
        ...(restPos.length ? { basis: terms(restPos) } : {}),
        toc: ['두 사람이 서로 끌리는 이유', '함께 있으면 좋은 점'],
      },
      !unlocked,
      PRODUCT,
    ),
    lock(
      {
        key: 'cautions',
        title: '함께 조심할 점',
        summary: neg.length >= 3 ? '맞춰 갈 부분이 몇 가지 있어요' : neg.length ? '맞춰 갈 부분이 조금 있어요' : '크게 부딪히는 부분이 적어요',
        paragraphs: [
          COMPAT_CATEGORY_PLAIN.stability[band(r.categories.stability)],
          ...(neg.length ? neg.map((l) => l.text) : ['두 사람의 사주에서 크게 부딪히는 관계는 두드러지지 않아요. 지금처럼 서로를 배려하면 편안한 관계를 이어 가기 쉽습니다.']),
        ],
        ...(neg.length ? { basis: terms(neg) } : {}),
        toc: ['자주 부딪히는 지점', '부딪힐 때 푸는 방법'],
      },
      !unlocked,
      PRODUCT,
    ),
    lock(
      {
        key: 'advice',
        title: '더 좋은 관계를 위한 조언',
        summary: COMPAT_ADVICE_SUMMARY[r.grade],
        paragraphs: [FORTUNE_TEMPLATES.compatibilityAdvice[r.grade], ...loveLines],
        toc: ['두 사람에게 맞는 관계 조언', '서로의 연애 방식'],
      },
      !unlocked,
      PRODUCT,
    ),
  ];
  return { sections: defineSections(dedupeSentences(sections)), gradeLabel: COMPAT_GRADE_LABEL[r.grade], headline: pick(FORTUNE_TEMPLATES.compatibilityHeadline[r.grade], `${a.birthUtc}|${b.birthUtc}`) };
}

/** 여러 섹션에 걸쳐 같은 문장이 또 나오면 뒤의 것을 지운다(문단이 통째로 비면 문단도 뺀다) */
function dedupeSentences(sections: ReadingSection[]): ReadingSection[] {
  const seen = new Set<string>();
  return sections.map((sec) => ({
    ...sec,
    paragraphs: sec.paragraphs
      .map((p) =>
        p
          .split(/(?<=[.!?])\s+/)
          .filter((sentence) => {
            const key = sentence.trim();
            if (key.length <= 12) return true;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .join(' '),
      )
      .filter(Boolean),
  }));
}

/** '병오' 처럼 그해 간지의 한글 */
export const yearPillarHangul = (year: number) => {
  const { stem, branch } = yearPillarOf(year);
  return luckPillar(stem, branch, 0).ganzhi.hangul;
};

export function gradeLabel(g: FortuneGrade) {
  return GRADE_LABEL[g];
}

/** 세운 목록(대운 화면 보조) — 쉬운 이름(yearName·theme·gradeLabel)을 함께 준다. tenGod·grade 는 전문가 보기용 */
export function yearList(chart: SajuChart, from: number, to: number) {
  return seun(chart.dayMaster.index, from, to).map((y) => {
    const ev = evaluateFortune(chart, y, `year-${y.year}`);
    return {
      year: y.year,
      ganzhi: y.ganzhi.hanja,
      hangul: y.ganzhi.hangul,
      tenGod: y.stemTenGod,
      score: ev.scores.total,
      grade: ev.grade,
      gradeLabel: YEAR_GRADE_PLAIN[ev.grade],
      yearName: yearNickname(y.stem, y.branch),
      theme: TEN_GOD_PLAIN[y.stemTenGod].theme,
    };
  });
}
