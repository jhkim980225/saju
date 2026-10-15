/**
 * 규칙 기반 해석 생성기 — 계산 엔진 결과 + 콘텐츠 문구를 조합해 사람이 읽을 풀이를 만든다.
 * AI(Claude)가 설정되면 ai.ts 가 이 결과를 초안으로 삼아 문장을 다듬는다.
 */
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
  type FortuneHighlight,
  type SajuChart,
  type TenGod,
  type TenGodGroup,
} from '@saju/core';
import { FORTUNE_CATEGORY_LABEL, GRADE_PLAIN_LABEL, TEN_GOD_PLAIN_LABEL, type DailyFortuneDto, type ReadingDto, type ReadingSection, type YearlyFortuneDto } from '@saju/shared';
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
import { CHILD_HINT, GROUP_PLAIN, HIGHLIGHT_PLAIN, HIGHLIGHT_TERM, TEN_GOD_PLAIN } from './content/reportPlain.js';

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

/** 조사만 — '배움' → '이', '여유' → '가' */
const pt = (word: string, withBatchim: string, without: string) => josa(word, withBatchim, without).slice(word.length);
const GROUP_ORDER: TenGodGroup[] = ['비겁', '식상', '재성', '관성', '인성'];

function tenGodSection(chart: SajuChart, name: string | null): ReadingSection {
  const g = groupCount(chart);
  const top = dominantTenGod(chart);
  const tp = TEN_GOD_PLAIN[top];
  const absentGroups = GROUP_ORDER.filter((k) => g[k] === 0);
  // 용어(비견·식상…) 대신 쉬운 이름으로 — 이름은 basis 에만
  const paragraphs = [
    `${nameSubject(name, '은')}무엇보다 '${tp.phrase}'${pt(tp.phrase, '이', '가')} 강한 사람이에요. 나를 움직이는 힘이 어디서 나오는지 알면, 그 힘을 훨씬 잘 쓸 수 있어요.`,
    tp.meaning,
    tp.strong,
  ];
  for (const group of absentGroups) paragraphs.push(`'${GROUP_PLAIN[group].name}'${pt(GROUP_PLAIN[group].name, '은', '는')} 비어 있는 편이에요. ${GROUP_PLAIN[group].absent}`);
  return {
    key: 'tenGods',
    title: '나를 움직이는 힘',
    summary: `'${tp.phrase}'${pt(tp.phrase, '이', '가')} 나를 움직여요`,
    keywords: [TEN_GOD_PLAIN_LABEL[top]!],
    paragraphs,
    basis: `가장 두드러진 십성 ${top} · ${GROUP_ORDER.map((k) => `${k} ${g[k]}`).join(' · ')}`,
  };
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

// --- 유료 섹션(미니 리포트·사주분석서로 열림) — 무료 섹션과 같은 쉬운 말 기준. 용어는 basis 에만 ---

/** 다섯 묶음 개수 — basis 용 '비겁 2 · 식상 0 …' */
const groupBasis = (g: Record<TenGodGroup, number>) => GROUP_ORDER.map((k) => `${k} ${g[k]}`).join(' · ');

function wealthSection(chart: SajuChart, name: string | null): ReadingSection {
  const dm = dayMasterContent(chart);
  const g = groupCount(chart);
  const p = [dmText(chart, dm.wealth, name)];
  if (g.재성 >= 3) p.push('사주에 돈을 다루는 기운이 많아서, 돈이 어디로 흐르는지 읽고 기회를 알아채는 감각이 있어요. 다만 몸과 마음이 지치면 번 것도 새기 쉬우니, 컨디션 관리가 곧 재테크예요.');
  else if (g.재성 === 0) p.push('사주에 돈을 다루는 기운이 겉으로 드러나지 않아요. 이런 사람은 돈을 좇을 때보다 실력과 이름을 쌓을 때 재물이 뒤따라와요. 한 분야의 전문가가 되는 것이 가장 확실한 길이에요.');
  else p.push('사주에 돈을 다루는 기운이 알맞게 있어서 꾸준히 벌고 모으는 힘이 있어요. 수입원을 하나 더 만드는 작은 실험이 좋은 결과로 이어질 수 있어요.');
  if (g.식상 >= 2) p.push('재능과 아이디어를 수입으로 바꾸는 힘도 있어요. 콘텐츠·기술·서비스처럼 "내가 만든 것"으로 버는 방식이 잘 맞아요.');
  if (g.비겁 >= 3) p.push('친구나 동료와 돈이 얽힐 일이 많은 편이라, 내 몫을 지키는 습관이 특히 중요해요. 동업이나 돈거래에서는 계약서와 기록을 꼼꼼히 남겨 두세요.');
  const score = Math.min(95, 55 + g.재성 * 6 + g.식상 * 4 - Math.max(0, g.비겁 - 2) * 4);
  return {
    key: 'wealth',
    title: '재물운',
    summary: g.재성 ? '흐름을 읽으면 재물이 쌓이는 사주예요' : '실력이 곧 재물이 되는 사주예요',
    paragraphs: p,
    score,
    basis: `재성 ${g.재성} · 식상 ${g.식상} · 비겁 ${g.비겁} (여덟 글자 속 십성 개수)`,
  };
}

function loveSection(chart: SajuChart, name: string | null): ReadingSection {
  const dm = dayMasterContent(chart);
  const dp = dayPillarContent(chart);
  const g = groupCount(chart);
  const male = chart.input.gender === 'male';
  const spouseGroup: TenGodGroup = male ? '재성' : '관성';
  const p = [dmText(chart, dm.love, name), dp.love];
  if (g[spouseGroup] === 0) p.push('사주에 짝을 뜻하는 기운이 드러나 있지 않아요. 그래서 인연은 흐름이 들어오는 때를 잘 잡는 게 중요해요. 해마다 바뀌는 흐름에서 이 기운이 들어오는 해에 좋은 만남이 이어지기 쉬워요.');
  else if (g[spouseGroup] >= 3) p.push('사주에 짝을 뜻하는 기운이 넉넉해서 관심을 받기 쉬운 편이에요. 여러 인연 가운데 나를 편안하게 해 주는 사람을 알아보는 눈이 행복의 열쇠예요.');
  // 무료 '특별한 기운' 섹션과 같은 문장을 되풀이하지 않게 연애에 맞춘 말로
  if (hasShinsal(chart, '도화살')) p.push('연애에서는 사람을 끄는 매력이 첫 만남부터 빛을 발해요. 관심을 많이 받는 만큼, 마음은 한 사람에게 진솔하게 표현해 주세요.');
  if (hasShinsal(chart, '홍염살')) p.push('가까워질수록 은근한 매력이 더 깊게 느껴지는 사람이에요. 서두르지 않고 천천히 마음을 열어도 충분해요.');
  const dayRel = chart.relations.filter((r) => r.positions.includes('day') && r.target === 'branch');
  const dayClash = dayRel.some((r) => r.type === '충');
  if (dayClash) p.push('가장 가까운 사람의 자리에 부딪히는 기운이 있어서, 관계에 변화가 생기기 쉬워요. 서로의 공간과 속도를 존중할수록 오래 가는 인연이 돼요.');
  const score = Math.min(95, 58 + g[spouseGroup] * 6 + (hasShinsal(chart, '도화살') ? 6 : 0) - (dayClash ? 8 : 0));
  // 요약은 본문 첫 문장과 겹치지 않게 — 인연의 기운 개수로 짧게
  const loveSummary = g[spouseGroup] === 0 ? '좋은 인연이 들어오는 때를 잘 잡으면 되는 사주예요' : g[spouseGroup] >= 3 ? '사람을 끄는 힘이 있는 사주예요' : '진심으로 오래 가는 사랑을 하는 사주예요';
  const tags = [hasShinsal(chart, '도화살') && '도화살', hasShinsal(chart, '홍염살') && '홍염살', dayClash && '일지 충'].filter(Boolean);
  return {
    key: 'love',
    title: '연애·결혼운',
    summary: loveSummary,
    paragraphs: p,
    score,
    basis: `배우자 기운(${spouseGroup}) ${g[spouseGroup]}개 · 일지 ${chart.pillars.day.branch.hangul}(${chart.pillars.day.branch.hanja}) ${chart.pillars.day.branch.tenGod}${tags.length ? ` · ${tags.join(' · ')}` : ''}`,
  };
}

function careerSection(chart: SajuChart, name: string | null): ReadingSection {
  const dm = dayMasterContent(chart);
  const dp = dayPillarContent(chart);
  const g = groupCount(chart);
  const p = [dmText(chart, dm.career, name), dp.career, `잘 어울리는 분야는 ${dm.jobs.join(', ')} 같은 쪽이에요.`];
  if (g.관성 >= 2) p.push('책임지는 힘이 커서 조직과 제도 안에서 인정받기 좋아요. 공공기관, 큰 회사, 전문 자격이 필요한 분야에서 안정적으로 자라요.');
  if (g.식상 >= 2) p.push('표현하는 힘이 강해서 자기표현과 창의력이 무기예요. 기획·창작·교육·프리랜서처럼 내 방식대로 일할 수 있는 자리가 잘 맞아요.');
  if (g.인성 >= 2) p.push('배우는 힘이 강해서 깊이 공부하고 가르치는 일과 잘 맞아요. 연구·교육·상담처럼 자격이 필요한 일에서 깊이를 쌓으면 대신하기 어려운 사람이 돼요.');
  if (hasShinsal(chart, '역마살')) p.push('일에서도 자리를 옮기거나 밖으로 다니는 업무가 잘 맞아요. 출장이 잦거나 해외와 닿는 일을 눈여겨보세요.');
  if (hasShinsal(chart, '문창귀인')) p.push('글과 말로 생각을 정리하는 재주가 일에서도 큰 무기예요. 기획서·보고서·강의처럼 머리를 쓰는 일에서 돋보여요.');
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

function healthSection(chart: SajuChart, name: string | null): ReadingSection {
  const dm = dayMasterContent(chart);
  const many = manyElements(chart);
  const none = noneElements(chart);
  // 글자 개수 기준(화면 도넛과 같은 숫자). 병원 안내는 섹션 끝에 한 번만 — 기운별 문구의 안내 문장은 뺀다
  const organs = (el: Element) => ELEMENT_CONTENT[el].organs.split(/(?<=[.!?])\s+/).filter((x) => !/병원|의료진|전문의|진료/.test(x)).join(' ');
  const p = [dmText(chart, dm.health, name)];
  for (const el of many) {
    // 나를 뜻하는 기운은 바로 앞 문단(일간 건강)이 이미 말했다
    p.push(el === chart.dayMaster.element ? `${ELEMENT_PLAIN[el].name} 기운이 많은 편이라, 위에서 말한 몸의 신호를 특히 잘 살펴 주세요.` : `${ELEMENT_PLAIN[el].name} 기운이 많은 편이라 그쪽으로 무리하지 않게 살펴 주세요. ${organs(el)}`);
  }
  for (const el of none) p.push(`${ELEMENT_PLAIN[el].name} 기운이 하나도 없어서 그쪽 컨디션을 꾸준히 살펴 주세요. ${organs(el)}`);
  p.push('사주로 보는 건강 풀이는 생활 습관을 돌아보는 참고 자료예요. 불편한 증상이 이어지면 꼭 병원에서 확인해 주세요.');
  return {
    key: 'health',
    title: '건강',
    summary: none.length ? `${plainNames(none)} 기운 쪽 컨디션을 챙겨 주면 좋아요` : '규칙적인 생활 리듬이 건강의 열쇠예요',
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
    `사람의 운은 10년마다 계절처럼 바뀌어요. ${nameSubject(name, '의')}첫 번째 10년은 만 ${chart.daeun.startAge}세에 ${started ? '시작됐어요' : '시작돼요'}.`,
  ];
  // 같은 묶음의 10년이 두 번 이어지면(예: 나무 → 나무) 긴 풀이는 처음 한 번만
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
    if (told.has(group)) paragraphs.push(`${head} 앞의 10년에 이어 '${GROUP_PLAIN[group].name}'의 흐름이 한 번 더 이어져요.`);
    else paragraphs.push(`${head} ${FORTUNE_TEMPLATES.daeunTheme[group]}`);
    told.add(group);
  }
  return {
    key: 'daeun',
    title: '10년마다 바뀌는 큰 흐름',
    summary: current ? `지금은 ${current.startYear}~${current.endYear}년의 10년을 지나고 있어요` : `만 ${chart.daeun.startAge}세에 첫 번째 10년이 시작돼요`,
    paragraphs,
    keywords: [`현재 만 ${Math.max(0, year - birthYear)}세`],
    basis: `대운수 ${chart.daeun.startAge} · ${chart.daeun.direction === 'forward' ? '순행' : '역행'}${current ? ` · 지금 ${current.ganzhi.hangul}(${current.ganzhi.hanja}) 대운` : ''} · ${periods.map((p) => `${p.ganzhi.hangul} ${p.stemTenGod}`).join(', ')}`,
  };
}

/** 십성 운 문구 첫머리의 '비견운에는' 같은 용어를 쉬운 말로 */
export const luckLead = (text: string, lead: string) => text.replace(/^\S+운에는 /, lead);

/** 같은 리포트 안에서 같은 하이라이트 문장을 되풀이하지 않게(report.ts reportOnce 와 같은 모양) */
interface Seen {
  first: (key: string) => boolean;
}
/** 운의 하이라이트(신살·합충) → 쉬운 말. 용신·기신 안내는 fit 문장이 맡으므로 뺀다 */
export function plainHighlights(hs: FortuneHighlight[], n: number, seen?: Seen): { text: string[]; terms: string[] } {
  const picked = hs.filter((h) => !h.startsWith('yongsin') && !h.startsWith('gisin')).filter((h) => !seen || seen.first(`hl:${h}`)).slice(0, n);
  return { text: picked.map((h) => HIGHLIGHT_PLAIN[h]), terms: picked.map((h) => HIGHLIGHT_TERM[h]) };
}

export function yearBriefSection(chart: SajuChart, year: number, name: string | null = null, seen?: Seen): ReadingSection {
  const yp = yearPillarOf(year);
  const ev = evaluateFortune(chart, yp, `year-${year}`);
  const stg = ev.pillar.stemTenGod;
  const tg = TEN_GOD_CONTENT[stg];
  const tp = TEN_GOD_PLAIN[stg];
  const hl = plainHighlights(ev.highlights, 3, seen);
  return {
    key: `year${year}`,
    title: `${year}년 운세`,
    summary: pick(FORTUNE_TEMPLATES.yearlyHeadline[ev.grade], `${year}-${chart.pillars.day.ganzhi.index}`),
    score: ev.scores.total,
    keywords: [TEN_GOD_PLAIN_LABEL[stg]!, GRADE_PLAIN_LABEL[ev.grade]],
    basis: `${ev.pillar.ganzhi.hangul}(${ev.pillar.ganzhi.hanja})년 · 천간 ${stg} · 지지 ${ev.pillar.branchTenGod} · ${GRADE_LABEL[ev.grade]}${hl.terms.length ? ` · ${hl.terms.join(' · ')}` : ''}`,
    paragraphs: [
      `${year}년은 ${nameSubject(name, '에게')}'${tp.phrase}'${pt(tp.phrase, '이', '가')} 들어오는 해예요. ${luckLead(tg.inLuck.general, '이런 해에는 ')}`,
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
// 오늘의 운세
// ---------------------------------------------------------------------------

const LUCKY_TIME: Record<Element, string> = { wood: '오전 5~7시', fire: '오전 11시~오후 1시', earth: '오후 1~3시', metal: '오후 5~7시', water: '밤 9~11시' };

export function buildDailyFortune(chart: SajuChart, date: { year: number; month: number; day: number }, profileId: string | null): DailyFortuneDto {
  const dp = dayPillarOf(date);
  const dateStr = `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
  const seed = `${dateStr}|${chart.birthUtc}`;
  const ev = evaluateFortune(chart, dp, seed);
  const tg = TEN_GOD_CONTENT[ev.pillar.stemTenGod];
  const cats: DailyCategory[] = ['wealth', 'love', 'career', 'health', 'study'];
  const categories = cats.map((k) => ({
    key: k,
    label: FORTUNE_CATEGORY_LABEL[k],
    score: ev.scores[k],
    message: pick(FORTUNE_TEMPLATES.dailyCategory[k][band(ev.scores[k])], `${seed}|${k}`),
  }));
  const highlightText = ev.highlights.filter((h) => !h.startsWith('yongsin') && !h.startsWith('gisin')).slice(0, 2).map((h) => FORTUNE_TEMPLATES.highlights[h]);
  const message = [pick(FORTUNE_TEMPLATES.dailyMessage[ev.grade], `${seed}|msg`), ...highlightText].join(' ');
  const el = ev.lucky.element;
  return {
    date: dateStr,
    profileId,
    dayPillar: { hanja: ev.pillar.ganzhi.hanja, hangul: ev.pillar.ganzhi.hangul },
    evaluation: ev,
    gradeLabel: GRADE_LABEL[ev.grade],
    headline: pick(FORTUNE_TEMPLATES.dailyHeadline[ev.grade], `${seed}|head`),
    message,
    categories,
    advice: pick(tg.dailyAdvice, `${seed}|advice`),
    lucky: {
      color: ev.lucky.color,
      number: ev.lucky.number,
      direction: ev.lucky.direction,
      item: pick(ELEMENT_CONTENT[el].luckyItems, `${seed}|item`),
      time: LUCKY_TIME[el],
    },
    shareText: pick(FORTUNE_TEMPLATES.shareQuotes, `${seed}|share`),
  };
}

// ---------------------------------------------------------------------------
// 신년(세운) 운세
// ---------------------------------------------------------------------------

export function buildYearlyFortune(chart: SajuChart, year: number, unlocked: boolean): YearlyFortuneDto {
  const yp = yearPillarOf(year);
  const ev: FortuneEvaluation = evaluateFortune(chart, yp, `year-${year}`);
  const tg = TEN_GOD_CONTENT[ev.pillar.stemTenGod];
  const btg = TEN_GOD_CONTENT[ev.pillar.branchTenGod];
  const PRODUCT = `report_newyear_${year}`;
  const seed = `${year}-${chart.birthUtc}`;
  const sec = (key: string, title: string, score: number, paragraphs: string[], summary: string): ReadingSection => ({ key, title, score, paragraphs, summary });
  const sections: ReadingSection[] = [
    sec('total', `${year}년 총운`, ev.scores.total, [
      `${year}년 ${ev.pillar.ganzhi.hangul}(${ev.pillar.ganzhi.hanja})년은 천간으로 ${ev.pillar.stemTenGod}, 지지로 ${ev.pillar.branchTenGod}의 기운이 들어와요. ${tg.inLuck.general}`,
      btg.inLuck.general,
      ...ev.highlights.slice(0, 3).map((h) => FORTUNE_TEMPLATES.highlights[h]),
    ], pick(FORTUNE_TEMPLATES.yearlyHeadline[ev.grade], seed)),
    lock(sec('wealth', '재물운', ev.scores.wealth, [tg.inLuck.wealth, btg.inLuck.wealth], pick(FORTUNE_TEMPLATES.dailyCategory.wealth[band(ev.scores.wealth)], `${seed}w`)), !unlocked, PRODUCT),
    lock(sec('love', '애정운', ev.scores.love, [tg.inLuck.love, btg.inLuck.love], pick(FORTUNE_TEMPLATES.dailyCategory.love[band(ev.scores.love)], `${seed}l`)), !unlocked, PRODUCT),
    lock(sec('career', '직장·사업운', ev.scores.career, [tg.inLuck.career, btg.inLuck.career], pick(FORTUNE_TEMPLATES.dailyCategory.career[band(ev.scores.career)], `${seed}c`)), !unlocked, PRODUCT),
    lock(sec('health', '건강운', ev.scores.health, [tg.inLuck.health, btg.inLuck.health], pick(FORTUNE_TEMPLATES.dailyCategory.health[band(ev.scores.health)], `${seed}h`)), !unlocked, PRODUCT),
  ];
  const months = wolun(chart.dayMaster.index, year).map((m, i) => {
    const mev = evaluateFortune(chart, m, `${seed}-m${m.order}`);
    const calMonth = ((i + 1) % 12) + 1; // 寅월 ≈ 양력 2월
    return {
      order: m.order,
      label: `${calMonth}월 (${m.termName}~)`,
      ganzhi: m.ganzhi.hanja,
      score: mev.scores.total,
      summary: pick(FORTUNE_TEMPLATES.monthlySummary[mev.grade], `${seed}-ms${m.order}`),
      locked: !unlocked && i >= 2,
    };
  });
  return {
    year,
    yearPillar: { hanja: ev.pillar.ganzhi.hanja, hangul: ev.pillar.ganzhi.hangul },
    evaluation: ev,
    headline: pick(FORTUNE_TEMPLATES.yearlyHeadline[ev.grade], seed),
    sections,
    months: months.map((m) => (m.locked ? { ...m, summary: '프리미엄에서 확인할 수 있어요.', score: 0 } : m)),
    locked: !unlocked,
  };
}

// ---------------------------------------------------------------------------
// 궁합
// ---------------------------------------------------------------------------

export const COMPAT_GRADE_LABEL = { excellent: '천생연분', good: '좋은 인연', normal: '노력하면 좋은 인연', effort: '서로 배워가는 인연' } as const;

export function buildCompatibilitySections(a: SajuChart, b: SajuChart, r: CompatibilityResult, names: { a: string; b: string }, unlocked: boolean) {
  const PRODUCT = 'report_compat';
  const dmA = dayMasterContent(a);
  const dmB = dayMasterContent(b);
  const pos = r.factors.filter((f) => f.tone === 'positive');
  const neg = r.factors.filter((f) => f.tone === 'negative');
  const sections: ReadingSection[] = [
    {
      key: 'summary',
      title: '한눈에 보는 궁합',
      summary: pick(FORTUNE_TEMPLATES.compatibilityHeadline[r.grade], `${a.birthUtc}|${b.birthUtc}`),
      score: r.score,
      paragraphs: [
        `${names.a}님은 ${dmA.title}(${dmA.name}), ${names.b}님은 ${dmB.title}(${dmB.name})의 기운을 지녔어요.`,
        ...pos.slice(0, 2).map((f) => f.label),
      ],
    },
    lock({ key: 'strengths', title: '서로 끌리는 이유', summary: pos.length ? `${pos.length}가지 좋은 인연 포인트` : '천천히 쌓아가는 인연', score: r.categories.romance, paragraphs: pos.length ? pos.map((f) => f.label) : ['눈에 띄는 끌림보다 시간이 지날수록 깊어지는 관계예요.'] }, !unlocked, PRODUCT),
    lock({ key: 'cautions', title: '함께 조심할 점', summary: neg.length ? `${neg.length}가지 조율 포인트` : '큰 갈등 요소가 적어요', score: r.categories.stability, paragraphs: neg.length ? neg.map((f) => f.label) : ['서로 부딪히는 기운이 적어 편안한 관계를 만들기 좋아요.'] }, !unlocked, PRODUCT),
    lock({ key: 'advice', title: '더 좋은 관계를 위한 조언', summary: COMPAT_GRADE_LABEL[r.grade], paragraphs: [FORTUNE_TEMPLATES.compatibilityAdvice[r.grade], `${names.a}님의 연애 스타일: ${dmA.love}`, `${names.b}님의 연애 스타일: ${dmB.love}`] }, !unlocked, PRODUCT),
  ];
  return { sections, gradeLabel: COMPAT_GRADE_LABEL[r.grade], headline: sections[0]!.summary };
}

/** '병오' 처럼 그해 간지의 한글 */
export const yearPillarHangul = (year: number) => {
  const { stem, branch } = yearPillarOf(year);
  return luckPillar(stem, branch, 0).ganzhi.hangul;
};

export function gradeLabel(g: FortuneGrade) {
  return GRADE_LABEL[g];
}

/** 세운 목록(대운 화면 보조) */
export function yearList(chart: SajuChart, from: number, to: number) {
  return seun(chart.dayMaster.index, from, to).map((y) => {
    const ev = evaluateFortune(chart, y, `year-${y.year}`);
    return { year: y.year, ganzhi: y.ganzhi.hanja, hangul: y.ganzhi.hangul, tenGod: y.stemTenGod, score: ev.scores.total, grade: ev.grade };
  });
}
