/**
 * 규칙 기반 해석 생성기 — 계산 엔진 결과 + 콘텐츠 문구를 조합해 사람이 읽을 풀이를 만든다.
 * AI(Claude)가 설정되면 ai.ts 가 이 결과를 초안으로 삼아 문장을 다듬는다.
 */
import type { FortuneHighlight } from '@saju/core';
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
  ELEMENT_INFO,
  GRADE_LABEL,
  TEN_GOD_GROUP,
  dayPillarOf,
  evaluateFortune,
  hashSeed,
  luckPillar,
  seun,
  wolun,
  yearPillarOf,
  type CompatibilityResult,
  type Element,
  type FortuneEvaluation,
  type FortuneGrade,
  type SajuChart,
  type TenGod,
  type TenGodGroup,
} from '@saju/core';
import { FORTUNE_CATEGORY_LABEL, type DailyFortuneDto, type ReadingDto, type ReadingSection, type YearlyFortuneDto } from '@saju/shared';
import {
  DAY_MASTERS,
  DAY_PILLARS,
  ELEMENT_CONTENT,
  FORTUNE_TEMPLATES,
  SHINSAL_CONTENT,
  STRENGTH_CONTENT,
  TEN_GOD_CONTENT,
  TWELVE_STAGE_CONTENT,
  YONGSIN_CONTENT,
  type DailyCategory,
  type ScoreBand,
} from './content/index.js';
import { ELEMENT_PLAIN, SHINSAL_ORDER, SHINSAL_PLAIN, STEM_PLAIN, STRENGTH_PLAIN, displayName, nameSubject, personalize } from './content/plain.js';

/** 신년운세·"올해 운세" 대상 연도 — KST 기준 10월부터는 다음 해 (웹 lib/format.ts 와 같은 규칙) */
export function targetFortuneYear(now = new Date()): number {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  return kst.getUTCFullYear() + (kst.getUTCMonth() >= 9 ? 1 : 0);
}

export const DISCLAIMER =
  '이 풀이는 명리학 이론을 바탕으로 한 참고용 콘텐츠예요. 삶의 방향은 언제나 스스로의 선택으로 만들어 가는 것이니, 중요한 결정은 충분히 고민한 뒤 내려 주세요.';

export const EL_NAME: Record<Element, string> = { wood: '목(木)', fire: '화(火)', earth: '토(土)', metal: '금(金)', water: '수(水)' };
export const EL_SHORT: Record<Element, string> = { wood: '나무', fire: '불', earth: '흙', metal: '쇠', water: '물' };

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
const plainNames = (els: Element[]) => els.map((e) => ELEMENT_PLAIN[e].name).join('·');

function overviewSection(chart: SajuChart, name: string | null): ReadingSection {
  const dm = dayMasterContent(chart);
  const yong = chart.yongsin.yongsin;
  const need = ELEMENT_PLAIN[yong];
  // 뜻을 먼저, 용어는 뒤에 — '불 기운'이 뭔지 모르는 사람도 읽히게
  const why = `${nameSubject(name, '에게')}가장 필요한 건 '${need.need}'${josa(need.need, '이에요', '예요').slice(need.need.length)}. 사주에서는 이걸 '${need.name} 기운'이라고 해요.`;
  return {
    key: 'overview',
    title: '총평',
    summary: '',
    keywords: [...dm.keywords.slice(0, 3), STRENGTH_PLAIN[chart.strength.level].chip],
    paragraphs: [
      `${nameSubject(name, '은')}${STEM_PLAIN[chart.dayMaster.index]!.line}`,
      `${why} 아래 '나에게 필요한 기운'에서 일상에서 쉽게 채우는 방법을 알려 드릴게요.`,
    ],
    basis: `${chart.pillars.day.ganzhi.hangul}(${chart.pillars.day.ganzhi.hanja})일주 · 일간 ${dm.name} · 가장 강한 기운 ${EL_NAME[chart.elements.dominant]} · 용신 ${EL_NAME[chart.yongsin.yongsin]}`,
  };
}

function personalitySection(chart: SajuChart, name: string | null): ReadingSection {
  const dm = dayMasterContent(chart);
  const stage = TWELVE_STAGE_CONTENT[chart.pillars.day.branch.twelveStage];
  const body = dm.personality.map((p) => dmText(chart, p, name));
  // 성격 문단에서 이미 한 이야기(예: 자존심)는 '신경 쓸 점'에서 다시 꺼내지 않는다
  const told = body.join(' ');
  const fresh = dm.weaknesses.filter((w) => !told.includes(w.split(' ')[0]!.replace(/(이|가|은|는|을|를|에|의|도)$/, '')));
  const cautions = (fresh.length >= 2 ? fresh : dm.weaknesses).slice(0, 2).map((w) => w.split(' — ').map(sentence).join(' '));
  return {
    key: 'personality',
    title: '타고난 성격',
    summary: `${josa(dm.strengths[0]!, '이', '가')} 가장 큰 장점이에요`,
    keywords: dm.keywords,
    paragraphs: [...body, `다만 이런 점은 조금 신경 써 보세요. ${cautions.join(' ')}`],
    basis: `일간 ${dm.name} · ${chart.pillars.day.ganzhi.hangul}(${chart.pillars.day.ganzhi.hanja})일주 · 일지 12운성 ${stage.name}(${stage.keyword})`,
  };
}

function elementsSection(chart: SajuChart): ReadingSection {
  const e = chart.elements;
  const many = manyElements(chart);
  const none = noneElements(chart);
  const dist = ELEMENT_KEYS.map((k) => `${ELEMENT_PLAIN[k].name} ${e.count[k]}개`).join(', ');
  // 개념부터 한 줄로, 그다음 많고 없는 것만 한 줄씩 — 비유를 겹겹이 쌓지 않는다
  const paragraphs = [
    '사주 여덟 글자는 나무·불·흙·쇠·물, 다섯 가지 성질로 나눌 수 있어요. 많은 기운은 성격으로 드러나고, 없는 기운은 채워 주면 좋은 부분이에요.',
    `세어 보면 ${dist}예요.`,
  ];
  for (const el of many) paragraphs.push(`${ELEMENT_PLAIN[el].name} 기운이 많아요. ${ELEMENT_PLAIN[el].many}`);
  for (const el of none) paragraphs.push(`${ELEMENT_PLAIN[el].name} 기운은 하나도 없어요. ${ELEMENT_PLAIN[el].none}`);
  if (many.length === 0 && none.length === 0) paragraphs.push('다섯 기운이 고르게 섞여 있어서, 상황에 맞춰 유연하게 움직이는 힘이 있어요.');
  return {
    key: 'elements',
    title: '다섯 가지 기운',
    summary: none.length ? `${plainNames(none)} 기운을 채워 주면 좋아요` : many.length ? `${plainNames(many)} 기운이 강한 사주예요` : '다섯 기운이 고르게 섞여 있어요',
    paragraphs,
    basis: `오행 개수(천간·지지 글자 기준) ${ELEMENT_KEYS.map((k) => `${EL_NAME[k].slice(0, 1)}${e.count[k]}`).join(' ')} · 지장간까지 셈한 비중은 사주분석서에서 다뤄요`,
  };
}

function yongsinSection(chart: SajuChart, name: string | null): ReadingSection {
  const y = chart.yongsin;
  const c = YONGSIN_CONTENT[y.yongsin];
  const info = ELEMENT_INFO[y.yongsin];
  const el = ELEMENT_PLAIN[y.yongsin];
  return {
    key: 'yongsin',
    title: '나에게 필요한 기운',
    summary: `${el.need}${josa(el.need, '이', '가').slice(el.need.length)} 가장 필요해요`,
    keywords: [`행운의 색 ${info.color}`, `행운의 방향 ${info.direction}`, `행운의 숫자 ${info.numbers.join('·')}`],
    paragraphs: [
      // 뜻을 먼저, '불 기운' 같은 말은 뒤에
      `${el.needMore} 사주에서는 이걸 '${el.name} 기운'이라고 해요.`,
      chart.elements.count[y.yongsin] === 0
        ? `${nameSubject(name, '의')}사주에는 이 ${el.name} 기운이 하나도 없어요. 그래서 일상에서 조금씩 채워 줄수록 일이 잘 풀려요.`
        : `${nameSubject(name, '은')}${STRENGTH_PLAIN[chart.strength.level].reason}`,
      '일상에서는 이런 것부터 해 보세요.',
    ],
    tips: c.tips.slice(0, 4),
    basis: `용신 ${EL_NAME[y.yongsin]} · 희신 ${EL_NAME[y.heesin]} · 일간의 힘 ${chart.strength.level}`,
  };
}

function tenGodSection(chart: SajuChart, name: string | null): ReadingSection {
  const g = groupCount(chart);
  const top = dominantTenGod(chart);
  const tg = TEN_GOD_CONTENT[top];
  const absentGroups = (Object.keys(g) as TenGodGroup[]).filter((k) => g[k] === 0);
  const paragraphs = [
    `${nameSubject(name, '은')}무엇보다 '${tg.keyword}'${josa(tg.keyword, '이', '가').slice(tg.keyword.length)} 강한 사람이에요. 나를 움직이는 힘이 어디서 나오는지 알면, 그 힘을 훨씬 잘 쓸 수 있어요.`,
    `${top}(${tg.keyword}) — ${tg.meaning}`,
    tg.strong,
  ];
  for (const group of absentGroups) {
    const rep = (Object.keys(TEN_GOD_CONTENT) as TenGod[]).find((t) => TEN_GOD_GROUP[t] === group)!;
    paragraphs.push(`${group}이(가) 없는 사주예요. ${TEN_GOD_CONTENT[rep].absent}`);
  }
  return { key: 'tenGods', title: '나를 움직이는 힘', summary: `'${tg.keyword}'${josa(tg.keyword, '이', '가').slice(tg.keyword.length)} 나를 움직이는 힘이에요`, keywords: [tg.keyword], paragraphs, basis: `가장 두드러진 십신 ${top}` };
}

function shinsalSection(chart: SajuChart): ReadingSection {
  // 같은 신살이 기준(년지·일지)별로 두 번 잡힐 수 있어 이름으로 한 번만
  const all = chart.shinsal.filter((s, i, arr) => s.name !== '현침살' && arr.findIndex((x) => x.name === s.name) === i);
  if (all.length === 0) {
    return { key: 'shinsal', title: '타고난 특별한 기운', summary: '크게 치우친 기운 없이 담백한 사주예요', paragraphs: ['특별히 튀는 기운이 없다는 건, 큰 기복 없이 내 노력만큼 길이 열린다는 뜻이기도 해요.'] };
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
      `${SHINSAL_PLAIN[first!.name].body} (${first!.name})`,
      ...rest.map((s) => `${SHINSAL_PLAIN[s.name].lead} ${SHINSAL_PLAIN[s.name].body} (${s.name})`),
    ],
    basis: `사주에 있는 신살 ${all.map((s) => s.name).join(', ')}`,
  };
}

function wealthSection(chart: SajuChart, name: string | null): ReadingSection {
  const dm = dayMasterContent(chart);
  const g = groupCount(chart);
  const p = [dmText(chart, dm.wealth, name)];
  if (g.재성 >= 3) p.push('사주에 재성이 많아 돈의 흐름을 잘 읽고 기회를 포착하는 감각이 있어요. 다만 일간의 힘이 받쳐줘야 재물을 지킬 수 있으니, 체력과 집중력 관리가 곧 재테크예요.');
  else if (g.재성 === 0) p.push('재성이 드러나지 않은 사주는 돈 자체보다 실력·명예·관계를 쌓을 때 재물이 따라오는 구조예요. 전문성을 키우는 것이 가장 확실한 재테크가 돼요.');
  else p.push('재성이 적당히 자리해 있어 꾸준히 벌고 모으는 힘이 있어요. 수입원을 하나 더 만드는 작은 실험이 좋은 결과로 이어질 수 있어요.');
  if (g.식상 >= 2) p.push('식상이 발달해 재능과 아이디어를 수익으로 연결하는 힘이 있어요. 콘텐츠·기술·서비스처럼 "내가 만든 것"으로 버는 방식이 잘 맞아요.');
  if (g.비겁 >= 3) p.push('비겁이 강해 동업이나 돈거래에서 내 몫을 지키는 습관이 중요해요. 계약서와 기록을 꼼꼼히 남겨 두세요.');
  const score = Math.min(95, 55 + g.재성 * 6 + g.식상 * 4 - Math.max(0, g.비겁 - 2) * 4);
  return { key: 'wealth', title: '재물운', summary: g.재성 ? '흐름을 읽으면 재물이 쌓이는 사주' : '실력이 곧 재물이 되는 사주', paragraphs: p, score };
}

function loveSection(chart: SajuChart, name: string | null): ReadingSection {
  const dm = dayMasterContent(chart);
  const dp = dayPillarContent(chart);
  const g = groupCount(chart);
  const male = chart.input.gender === 'male';
  const spouseGroup: TenGodGroup = male ? '재성' : '관성';
  const love = dmText(chart, dm.love, name);
  const p = [love, dp.love];
  if (g[spouseGroup] === 0) p.push(`배우자를 뜻하는 ${spouseGroup}이(가) 사주에 드러나 있지 않아, 인연이 운에서 들어오는 시기를 잘 잡는 것이 중요해요. 대운·세운에서 ${spouseGroup} 기운이 올 때 좋은 만남이 이어지기 쉬워요.`);
  else if (g[spouseGroup] >= 3) p.push(`${spouseGroup}이(가) 많아 이성의 관심을 받기 쉬운 편이에요. 여러 인연 중 나를 편안하게 해주는 사람을 알아보는 안목이 행복의 열쇠예요.`);
  if (hasShinsal(chart, '도화살')) p.push(`${SHINSAL_CONTENT['도화살'].summary} 매력이 빛나는 만큼 표현은 진솔하게 해 주세요.`);
  if (hasShinsal(chart, '홍염살')) p.push(SHINSAL_CONTENT['홍염살'].summary);
  const dayRel = chart.relations.filter((r) => r.positions.includes('day') && r.target === 'branch');
  if (dayRel.some((r) => r.type === '충')) p.push('배우자 자리(일지)에 충이 있어 관계에 변화가 생기기 쉬워요. 서로의 공간과 속도를 존중할수록 오래 가는 인연이 돼요.');
  const score = Math.min(95, 58 + g[spouseGroup] * 6 + (hasShinsal(chart, '도화살') ? 6 : 0) - (dayRel.some((r) => r.type === '충') ? 8 : 0));
  // 요약은 본문 첫 문장과 겹치지 않게 — 인연의 별 개수로 짧게
  const loveSummary = g[spouseGroup] === 0 ? '좋은 인연이 들어오는 때를 잘 잡으면 되는 사주' : g[spouseGroup] >= 3 ? '사람을 끄는 힘이 있는 사주' : '진심으로 오래 가는 사랑을 하는 사주';
  return { key: 'love', title: '연애·결혼운', summary: loveSummary, paragraphs: p, score };
}

function careerSection(chart: SajuChart, name: string | null): ReadingSection {
  const dm = dayMasterContent(chart);
  const dp = dayPillarContent(chart);
  const g = groupCount(chart);
  const p = [dmText(chart, dm.career, name), dp.career, `잘 어울리는 분야: ${dm.jobs.join(', ')}`];
  if (g.관성 >= 2) p.push('관성이 발달해 조직·제도 안에서 인정받는 힘이 있어요. 공공기관, 대기업, 전문 자격이 필요한 분야에서 안정적으로 성장하기 좋아요.');
  if (g.식상 >= 2) p.push('식상이 강해 자기표현과 창의력이 무기예요. 기획·크리에이티브·교육·프리랜서처럼 자율성이 보장되는 일이 잘 맞아요.');
  if (g.인성 >= 2) p.push('인성이 강해 배우고 가르치는 힘이 있어요. 연구·교육·상담·자격증 기반 직무에서 깊이를 쌓으면 대체 불가능한 사람이 돼요.');
  if (hasShinsal(chart, '역마살')) p.push(`${SHINSAL_CONTENT['역마살'].summary} 이동·출장·해외와 관련된 일에서 기회가 많아요.`);
  if (hasShinsal(chart, '문창귀인')) p.push(SHINSAL_CONTENT['문창귀인'].summary);
  const score = Math.min(95, 58 + g.관성 * 5 + g.인성 * 3 + g.식상 * 3);
  return { key: 'career', title: '직업·적성', summary: `${dm.jobs.slice(0, 3).join(', ')} 분야와 잘 맞아요`, keywords: dm.jobs.slice(0, 5), paragraphs: p, score };
}

function healthSection(chart: SajuChart, name: string | null): ReadingSection {
  const dm = dayMasterContent(chart);
  const e = chart.elements;
  const p = [dmText(chart, dm.health, name)];
  for (const el of e.excess) p.push(`${EL_NAME[el]} 기운이 강한 편이라 무리하지 않도록 관리해 주세요. ${ELEMENT_CONTENT[el].organs}`);
  for (const el of e.lacking) p.push(`${EL_NAME[el]} 기운이 부족한 편이라 관련 컨디션을 꾸준히 살펴 주세요. ${ELEMENT_CONTENT[el].organs} 생활 속에서는 ${ELEMENT_CONTENT[el].balanceTips.slice(0, 2).join(', ')} 같은 습관이 도움이 돼요.`);
  p.push('사주의 건강 풀이는 생활 습관을 돌아보는 참고 자료예요. 불편한 증상이 있다면 꼭 전문의와 상담해 주세요.');
  return { key: 'health', title: '건강운', summary: noneElements(chart).length ? `${plainNames(noneElements(chart))} 기운을 채우는 생활 습관이 좋아요` : '규칙적인 생활 리듬이 건강의 열쇠예요', paragraphs: p };
}

function daeunSection(chart: SajuChart, now = new Date(), name: string | null = null): ReadingSection {
  const year = now.getFullYear();
  const birthYear = chart.solarDate.year;
  const started = year - birthYear >= chart.daeun.startAge;
  const paragraphs: string[] = [
    `사람의 운은 10년마다 계절처럼 바뀌어요. ${nameSubject(name, '의')}첫 번째 10년은 만 ${chart.daeun.startAge}세에 ${started ? '시작됐어요' : '시작돼요'}.`,
  ];
  let current = '';
  let currentRange = '';
  for (const p of chart.daeun.periods.slice(0, 8)) {
    const ev = evaluateFortune(chart, p);
    const group = TEN_GOD_GROUP[p.stemTenGod];
    const isNow = year >= p.startYear && year <= p.endYear;
    if (isNow) {
      current = `${p.ganzhi.hangul}(${p.ganzhi.hanja}) 대운`;
      currentRange = `${p.startYear}~${p.endYear}년`;
    }
    paragraphs.push(`${isNow ? '▶ ' : ''}${p.startAge}~${p.endAge}세 (${p.startYear}~${p.endYear}) ${p.ganzhi.hangul}(${p.ganzhi.hanja}) 대운 · ${GRADE_LABEL[ev.grade]} — ${p.stemTenGod}·${p.branchTenGod}의 시기. ${FORTUNE_TEMPLATES.daeunTheme[group]}`);
  }
  return {
    key: 'daeun',
    title: '대운의 흐름',
    summary: currentRange ? `지금은 ${currentRange}의 10년을 지나고 있어요` : `만 ${chart.daeun.startAge}세에 첫 번째 10년이 시작돼요`,
    paragraphs,
    keywords: [`현재 만 ${Math.max(0, year - birthYear)}세`],
    basis: `대운수 ${chart.daeun.startAge} · ${chart.daeun.direction === 'forward' ? '순행' : '역행'}${current ? ` · 지금 ${current}` : ''}`,
  };
}

export function yearBriefSection(chart: SajuChart, year: number, name: string | null = null): ReadingSection {
  const yp = yearPillarOf(year);
  const ev = evaluateFortune(chart, yp, `year-${year}`);
  const tg = TEN_GOD_CONTENT[ev.pillar.stemTenGod];
  return {
    key: `year${year}`,
    title: `${year}년 운세`,
    summary: pick(FORTUNE_TEMPLATES.yearlyHeadline[ev.grade], `${year}-${chart.pillars.day.ganzhi.index}`),
    score: ev.scores.total,
    keywords: [tg.keyword, GRADE_LABEL[ev.grade]],
    basis: `${ev.pillar.ganzhi.hangul}(${ev.pillar.ganzhi.hanja})년 · ${ev.pillar.stemTenGod}운`,
    paragraphs: [
      `${year}년은 ${nameSubject(name, '에게')}'${tg.keyword}'의 기운이 들어오는 해예요. ${tg.inLuck.general.replace(/^\S+운에는 /, '이런 해에는 ')}`,
      `재물: ${tg.inLuck.wealth}`,
      `애정: ${tg.inLuck.love}`,
      `일·커리어: ${tg.inLuck.career}`,
      ...ev.highlights.slice(0, 3).map((h) => FORTUNE_TEMPLATES.highlights[h]),
    ],
  };
}

export type ReadingAccess = 'none' | 'mini' | 'full';

/**
 * 기본 풀이. access 에 따라 유료 섹션을 잠근다.
 * - none: 무료 섹션만 공개
 * - mini: 첫 사주 미니 리포트(990원) — 재물·연애·직업 공개
 * - full: 평생 사주분석서 — 전체 공개
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
  return {
    chart,
    headline: sp.headline,
    dayPillarTitle: dp.title,
    keyPoints: [
      { label: '성격', text: sp.trait },
      { label: '잘하는 것', text: sp.strength },
      { label: '조심할 것', text: sp.caution },
      { label: '필요한 것', text: ELEMENT_PLAIN[chart.yongsin.yongsin].need },
      { label: '행운 포인트', text: `색 ${lucky.color} · 방향 ${lucky.direction} · 숫자 ${lucky.numbers.join('·')}` },
    ],
    sections: [
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
    ],
    generator: 'rule',
    disclaimer: DISCLAIMER,
  };
}

// ---------------------------------------------------------------------------
// 오늘의 운세 · 신년운세 · 궁합 — 쉬운 말 (docs/PLAIN_KOREAN.md)
// 본문에는 용어·한자를 쓰지 않는다. 일진·세운·십신·신살 같은 근거는 basis('사주로 보면')에만 둔다.
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

/** '사주로 보면' 한 줄 — 오늘·올해 공통 */
function luckBasis(label: string, ev: FortuneEvaluation): string {
  const p = ev.pillar;
  return [`${label} ${p.ganzhi.hangul}(${p.ganzhi.hanja})`, `천간 ${p.stemTenGod} · 지지 ${p.branchTenGod}`, `12운성 ${p.twelveStage}`, ...ev.highlights.map((h) => HIGHLIGHT_TERM[h])].join(' · ');
}

/**
 * 운의 첫 문단 — "오늘은 서윤님에게 '배움과 도움'의 기운이 들어오는 날이에요. …"
 * 천간이 나에게 꼭 필요한/잘 맞지 않는 기운이면 그 말을 같은 문단에 녹이고, 그 하이라이트는 따로 쓰지 않는다.
 */
function luckLead(ev: FortuneEvaluation, when: string, unit: '날' | '해', general: string, name: string | null): { text: string; folded: FortuneHighlight[] } {
  const theme = TEN_GOD_PLAIN[ev.pillar.stemTenGod].theme;
  const isDay = unit === '날' ? '날이에요' : '해예요';
  if (ev.fit.stem === 'yongsin') {
    return { text: `${when} ${nameSubject(name, '에게')}꼭 필요한 '${theme}'의 기운이 들어오는 ${isDay}. ${general}`, folded: ['yongsin_stem'] };
  }
  if (ev.fit.stem === 'gisin') {
    const withWho = name ? `${name}님과는` : '나와는';
    return { text: `${when} '${theme}'의 기운이 들어오는 ${isDay}. ${general} 이 기운이 ${withWho} 잘 맞지 않는 편이라, 큰일은 한 번 더 살피고 정하는 게 좋아요.`, folded: ['gisin_stem'] };
  }
  return { text: `${when} ${nameSubject(name, '에게')}'${theme}'의 기운이 들어오는 ${isDay}. ${general}`, folded: [] };
}

/** 이미 앞 문단(그 기운의 설명)에서 한 말과 겹치는 하이라이트 — 예: '배움과 도움' 뒤의 '도와주는 사람이 나타나요' */
const HIGHLIGHT_SAID_BY: Partial<Record<FortuneHighlight, TenGod[]>> = { cheoneul: ['정인'], munchang: ['정인', '편인'], hwagae: ['편인'], yangin: ['겁재'] };

/** 첫 문단에 녹인 것을 뺀 하이라이트 — 나와 맞는지(용신·기신)를 먼저. 이름이 있으면 '나와/나에게'를 이름으로 */
function restHighlights(ev: FortuneEvaluation, folded: FortuneHighlight[], max: number, name: string | null, told: TenGod[] = [ev.pillar.stemTenGod]): string[] {
  const alreadySaid = (h: FortuneHighlight) =>
    folded.includes(h) ||
    (HIGHLIGHT_SAID_BY[h] ?? []).some((t) => told.includes(t)) ||
    // 일지와 충이 있으면 월지와 충(같은 '변화' 이야기)은 한 번만
    (h === 'branch_clash_month' && ev.highlights.includes('branch_clash_day'));
  const rest = ev.highlights.filter((h) => !alreadySaid(h));
  const fitFirst = [...rest.filter((h) => /^(yongsin|gisin)/.test(h)), ...rest.filter((h) => !/^(yongsin|gisin)/.test(h))];
  return fitFirst.slice(0, max).map((h) => (name ? FORTUNE_TEMPLATES.highlights[h].replace(/^나와 /, `${name}님과 `).replace(/^나에게 /, `${name}님에게 `) : FORTUNE_TEMPLATES.highlights[h]));
}

/** 행운 아이템 — 숫자는 따로 보여 주므로 빼고, 괄호 속 한자는 지운다('풍경(風磬)'은 한자를 빼면 경치로 읽혀 풀어 쓴다) */
const luckyItem = (el: Element, seed: string) =>
  pick(ELEMENT_CONTENT[el].luckyItems.filter((x) => !x.startsWith('숫자')), seed)
    .replace(/종소리 나는 풍경\(風磬\)/, '바람에 울리는 작은 종')
    .replace(/\([一-鿿]+\)/g, '');

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
  const lead = luckLead(ev, '오늘은', '날', ev.grade === 'caution' || ev.grade === 'bad' ? tgPlain.lineLow : tgPlain.line, name);
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
      { label: '잘 풀리는 일', text: top.score >= 50 ? CATEGORY_PLAIN[top.key].good : `${josa(top.label, '은', '는')} 그나마 괜찮아요` },
      { label: '조심할 일', text: low.score >= 70 ? '크게 조심할 일은 없어요' : CATEGORY_PLAIN[low.key].watch },
      { label: '오늘 해 볼 일', text: advice.replace(/^오늘(은)? /, '') },
    ],
    why: [lead.text, ...restHighlights(ev, lead.folded, 2, name)],
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
  love: ['올해 연애와 사람 사이의 흐름', '관계에서 챙길 점', '열두 달 흐름'],
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
  const lead = luckLead(ev, `${year}년은`, '해', ev.grade === 'caution' || ev.grade === 'bad' ? plain.lineLow : tg.inLuck.general, name);
  const total: ReadingSection = {
    key: 'total',
    title: `${year}년 총운`,
    summary: '',
    paragraphs: [
      lead.text,
      // 같은 십신이면 같은 말이 되므로 한 번만
      ...(btg !== stg ? [`그 밑바탕에는 '${TEN_GOD_PLAIN[btg].theme}'의 기운도 함께 흘러요. ${bt.inLuck.general}`] : []),
      ...restHighlights(ev, lead.folded, 2, name, btg !== stg ? [stg, btg] : [stg]),
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
        text: ev.scores[best] >= 50 ? `${josa(YEAR_CATEGORY_PLAIN[best].good, '이', '가')} 가장 잘 풀려요` : `${josa(YEAR_CATEGORY_PLAIN[best].label, '은', '는')} 그나마 괜찮아요`,
      },
      { label: '조심할 것', text: ev.scores[worst] >= 70 ? '크게 조심할 일은 없어요' : `${josa(YEAR_CATEGORY_PLAIN[worst].watch, '은', '는')} 조심하면 좋아요` },
      { label: '해 볼 일', text: plain.yearTip },
    ],
    sections: [total, ...YEAR_CATEGORIES.map(category)],
    // 잠긴 달은 점수·요약을 비운다 — 화면은 자물쇠만 보이고, 안내는 목록 아래 한 줄로
    months: months.map((m) => (m.locked ? { ...m, summary: '', score: 0 } : m)),
    locked: !unlocked,
  };
}

// ---------------------------------------------------------------------------
// 궁합
// ---------------------------------------------------------------------------

export const COMPAT_GRADE_LABEL = { excellent: '천생연분', good: '좋은 인연', normal: '노력하면 좋은 인연', effort: '서로 배워가는 인연' } as const;

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

  // 엔진 요인 → 쉬운 문장. 같은 말이 두 번 나오지 않게 묶는다
  // - 오행 보완은 사람별로 한 문장에, 꼭 필요한 기운(용신)과 같은 오행이면 보완 문장은 뺀다
  // - 서로가 서로의 배우자 기운이면 한 문장으로
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
      paragraphs: [whoLine, ...(freePos.length ? freePos.map((l) => l.text) : ['눈에 띄는 끌림보다 시간이 지날수록 깊어지는 사이예요.'])],
      basis: [`${names.a} 일간 ${dmA.name}`, `${names.b} 일간 ${dmB.name}`, ...new Set(freePos.map((l) => l.term))].join(' · '),
    },
    lock(
      {
        key: 'strengths',
        title: '서로 끌리는 이유',
        summary: pos.length >= 3 ? '잘 맞는 점이 많은 사이예요' : pos.length ? '잘 맞는 점이 분명한 사이예요' : '천천히 쌓아 가는 인연이에요',
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
          ...(neg.length ? neg.map((l) => l.text) : ['서로 부딪히는 일이 적어 편안한 관계를 만들기 좋아요. 지금처럼 서로를 배려하면 충분해요.']),
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
  return { sections: dedupeSentences(sections), gradeLabel: COMPAT_GRADE_LABEL[r.grade], headline: pick(FORTUNE_TEMPLATES.compatibilityHeadline[r.grade], `${a.birthUtc}|${b.birthUtc}`) };
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
