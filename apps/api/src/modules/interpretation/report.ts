/**
 * 유료 보고서 생성기 — 사주분석서(평생) · 신년운세 · 궁합 리포트.
 *
 * 쉬운 말 기준(docs/PLAIN_KOREAN.md): 사주를 한 번도 본 적 없는 사람이 위에서부터 읽어도 막히지 않게 쓴다.
 * - 맨 앞 섹션에 '한눈에 보기'(points)를 두고, 각 장은 결론부터 쉬운 말로. 간지·십성·12운성·합충 같은 용어는 basis("사주로 보면")에만.
 * - 이름으로 부르고("서윤님은"), 이름이 없으면 주어를 뺀다. "당신"은 쓰지 않는다.
 * - 한 권 안에서 같은 문장을 되풀이하지 않는다(reportOnce).
 * 규칙 기반 초안이 사실(간지·십성·점수·기간)을 모두 담고, AI 는 이 초안을 근거로 문장만 다듬는다(ai/service.ts).
 * 분량 목표(공백 제외): 사주분석서 약 1만 7천 자 · 신년운세 약 7천 자 · 궁합 약 5천 자.
 */
import {
  ELEMENT_INFO,
  GRADE_LABEL,
  TEN_GOD_GROUP,
  evaluateFortune,
  hashSeed,
  wolun,
  yearPillarOf,
  type CompatibilityFactor,
  type CompatibilityResult,
  type DaeunPeriod,
  type Element,
  type ElementFit,
  type FortuneHighlight,
  type SajuChart,
  type TenGod,
  type TenGodGroup,
} from '@saju/core';
import { GRADE_PLAIN_LABEL, TEN_GOD_PLAIN_LABEL, type ReadingSection } from '@saju/shared';
import {
  ELEMENT_CONTENT,
  FORTUNE_TEMPLATES,
  SHINSAL_CONTENT,
  STRENGTH_CONTENT,
  TEN_GOD_CONTENT,
  TWELVE_STAGE_CONTENT,
  YONGSIN_CONTENT,
  type CompatFactorKey,
  type ElementLevel,
} from './content/index.js';
import { LUCK_CONTENT } from './content/luck.js';
import { ELEMENT_PLAIN, SHINSAL_ORDER, SHINSAL_PLAIN, STEM_PLAIN, STRENGTH_PLAIN, displayName, nameSubject, personalize } from './content/plain.js';
import { CHILD_HINT, DAEUN_TIP, GROUP_PLAIN, POSITION_PLAIN, RELATION_KIND_MEANING, RELATION_PLAIN, ROMANCE_KEEP, MONTH_SUMMARY, STABILITY_KEEP, STAGE_SHORT, TEN_GOD_PLAIN, YEAR_AREA_SUMMARY } from './content/reportPlain.js';
import { REPORT_MISC } from './content/reportMisc.js';
import {
  COMPAT_GRADE_LABEL,
  EL_NAME,
  band,
  buildBasicReading,
  dayMasterContent,
  dayPillarContent,
  dominantTenGod,
  groupCount,
  josa,
  luckLead,
  pick,
  plainHighlights,
  targetFortuneYear,
  yearBriefSection,
} from './reading.js';

export const ELEMENTS: Element[] = ['wood', 'fire', 'earth', 'metal', 'water'];
export const GROUPS: TenGodGroup[] = ['비겁', '식상', '재성', '관성', '인성'];
const POSITIONS = ['year', 'month', 'day', 'hour'] as const;

// 문장 조립 도우미 — 주제별 리포트(loveReport.ts · careerWealthReport.ts)도 함께 쓴다
/** 조사만 — '정관' → '과', '편재' → '와' */
export const particle = (word: string, withBatchim: string, without: string) => josa(word, withBatchim, without).slice(word.length);
/** 오행 이름('목(木)')은 앞 글자로 조사를 고른다 */
export const elp = (el: Element, withBatchim: string, without: string) => particle(EL_NAME[el].slice(0, 1), withBatchim, without);
export const ieyo = (word: string) => particle(word, '이에요', '예요');
/** 목록 + 마지막 낱말에 맞춘 조사 */
export const list = (items: string[], withBatchim: string, without: string) => items.join(', ') + particle(items[items.length - 1] ?? '', withBatchim, without);
export const kstYear = (now: Date) => new Date(now.getTime() + 9 * 3_600_000).getUTCFullYear();
export const pct = (n: number) => Math.round(n);

/** 쉬운 오행 이름 — '나무' */
const el = (e: Element) => ELEMENT_PLAIN[e].name;
/** '나무 기운' */
const elWord = (e: Element) => `${el(e)} 기운`;
/** 따옴표로 감싼 말 + 조사 — "'배우는 힘'이" */
const q = (word: string, withBatchim: string, without: string) => `'${word}'${particle(word, withBatchim, without)}`;

/**
 * 다섯 기운의 상태 — 글자 개수 기준. 웹 ElementBars 의 elementStatus 와 같은 기준이라 글과 도넛의 숫자가 같다.
 * (percent 는 예전 호출과의 호환용으로만 받는다)
 */
export function elementLevel(count: number, _percent?: number): ElementLevel {
  if (count === 0) return 'none';
  if (count >= 4) return 'excess';
  if (count === 3) return 'developed';
  if (count === 2) return 'balanced';
  return 'weak';
}

/** 운의 오행이 나에게 어떤 기운인지 — 키워드 칩용 쉬운 말 */
const FIT_TAG = { yongsin: '필요한 기운이 드는 때', heesin: '돕는 기운이 드는 때', gisin: '버거운 기운이 드는 때', neutral: '' } as const;
const FIT_TERM = { yongsin: '용신', heesin: '희신', gisin: '기신', neutral: '한신' } as const;
/**
 * 보고서 한 권 안에서 같은 안내 문장(필요한 기운·버거운 기운 안내, 신살·합충 하이라이트, 10년 흐름 풀이)을 되풀이하지 않도록,
 * 처음 한 번만 문장으로 쓰고 이후에는 키워드 꼬리표로만 남긴다.
 */
export function reportOnce() {
  const seen = new Set<string>();
  const first = (k: string) => (seen.has(k) ? false : (seen.add(k), true));
  return {
    fit(fit: ElementFit, part: 'stem' | 'branch'): { text: string | null; tag: string | null } {
      if (first(`fit:${part}:${fit}`)) return { text: LUCK_CONTENT.fit[fit][part], tag: null };
      return { text: null, tag: part === 'stem' && fit !== 'neutral' ? FIT_TAG[fit] : null };
    },
    highlights(hs: FortuneHighlight[], n: number): { text: string[]; terms: string[] } {
      return plainHighlights(hs, n, { first });
    },
    first,
  };
}
type Once = ReturnType<typeof reportOnce>;

/** 이름이 있으면 "서윤님", 없으면 "나" — 궁합처럼 두 사람을 함께 부를 때 */
const personLabel = (n: string | null | undefined) => (displayName(n) ? `${displayName(n)}님` : '나');
/** 사람 + 조사. spec 은 '은/는'·'이/가'·'의'·'도'처럼. '나'는 '내가'로 */
function who(label: string, spec?: string): string {
  if (!spec) return label;
  if (label === '나' && spec === '이/가') return '내가';
  const [a, b] = spec.includes('/') ? spec.split('/') : [spec, spec];
  return josa(label, a!, b!);
}
/** 궁합 문구의 {A:은/는} 같은 자리표시를 두 사람 이름으로 */
export const fillNames = (text: string, A: string, B: string) => text.replace(/\{(A|B)(?::([^}]+))?\}/g, (_, x: string, spec?: string) => who(x === 'A' ? A : B, spec));

/** 'YYYY-MM-DD…' → '2월 4일' (KST) */
const monthDay = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
};

/** 여덟(여섯) 글자 개수 — '나무 3개, 불 0개, …' */
const countList = (chart: SajuChart) => ELEMENTS.map((e) => `${el(e)} ${chart.elements.count[e]}개`).join(', ');
const letterCount = (chart: SajuChart) => (chart.pillars.hour ? '여덟' : '여섯');

// ---------------------------------------------------------------------------
// 사주분석서 — 타고난 모습
// ---------------------------------------------------------------------------

function chartSection(chart: SajuChart, name: string | null): ReadingSection {
  const dm = dayMasterContent(chart);
  const rows = POSITIONS.map((pos) => chart.pillars[pos]).filter((p): p is NonNullable<typeof p> => p !== null);
  const me = name ? `${name}님을` : '나를';
  const paragraphs = [
    `사주는 태어난 해·달·날·시를 각각 두 글자씩, 모두 여덟 글자로 바꾼 거예요. 글자마다 나무·불·흙·쇠·물 가운데 하나의 성질이 있어요. 그중 태어난 날의 위 글자가 '나'를 뜻하고, 나머지 글자는 나에게 어떤 힘이 되는지로 읽어요.`,
    `${me} 뜻하는 글자는 태어난 날의 위 글자예요. ${elWord(chart.dayMaster.element)}이고, 그림으로 그리면 ${q(dm.title, '이', '가')} 떠오르는 모습이에요.`,
    ...rows.map((p) => {
      const pos = POSITION_PLAIN[p.position];
      const lead = p.stem.element === p.branch.element ? `${pos.name}의 두 글자는 모두 ${elWord(p.stem.element)}이에요.` : `${pos.name}의 두 글자는 ${elWord(p.stem.element)}과 ${elWord(p.branch.element)}이에요.`;
      if (p.position === 'day') return `${lead} 위 글자는 나 자신이고, 아래 글자에는 ${q(TEN_GOD_PLAIN[p.branch.tenGod as TenGod].phrase, '이', '가')} 놓여 있어요. 그래서 가장 가까운 사람과 지낼 때 이 힘이 잘 드러나요.`;
      const a = TEN_GOD_PLAIN[p.stem.tenGod as TenGod].phrase;
      const b = TEN_GOD_PLAIN[p.branch.tenGod as TenGod].phrase;
      const both = a === b ? `${q(a, '이', '가')} 위아래로 함께 놓여 있어요.` : `${q(a, '과', '와')} ${q(b, '이', '가')} 놓여 있어요.`;
      return `${lead} ${pos.area}${particle(pos.area, '을', '를')} 보여 주는 자리인데, 여기에 ${both}`;
    }),
  ];
  if (!chart.pillars.hour) paragraphs.push('태어난 시간을 몰라 마지막 두 글자는 비워 두고 여섯 글자로 풀었어요. 시간을 알게 되면 나이 들어서의 모습과 다섯 가지 기운의 개수가 더 정확해져요.');
  return {
    key: 'chart',
    title: `타고난 ${letterCount(chart)} 글자`,
    summary: `${me} 뜻하는 글자는 ${elWord(chart.dayMaster.element)}이에요`,
    keywords: [`${chart.zodiac.animal}띠`, `나를 뜻하는 글자 · ${el(chart.dayMaster.element)}`],
    paragraphs,
    basis: rows.map((p) => `${{ year: '년주', month: '월주', day: '일주', hour: '시주' }[p.position]} ${p.ganzhi.hangul}(${p.ganzhi.hanja}) ${p.stem.tenGod}·${p.branch.tenGod}`).join(' · ') + ` · 일간 ${dm.name}`,
  };
}

/** 일주 문단 첫머리의 비유('~ 큰 나무처럼,')를 뺀다 — 바로 앞 일간 문단의 비유와 겹치지 않게(비유는 문단마다 하나) */
export function dropSimile(text: string): string {
  const m = text.match(/^([^.!?]{4,60}?(?:처럼|듯)),?\s+([^.!?]*[.!?])\s*/);
  if (!m) return text;
  const rest = text.slice(m[0].length);
  // 비유를 빼고 남은 말이 너무 짧으면('맑아요.') 첫 문장을 통째로 뺀다
  return m[2]!.length >= 12 ? `${m[2]} ${rest}`.trim() : rest || text;
}

function personalitySection(base: ReadingSection, chart: SajuChart): ReadingSection {
  // 일간 성격 뒤, '신경 쓸 점' 앞에 일주(태어난 날 두 글자)의 결을 더한다
  const dp = dayPillarContent(chart);
  const body = base.paragraphs.slice(0, -1);
  return { ...base, paragraphs: [...body, dropSimile(dp.personality), base.paragraphs.at(-1)!] };
}

function elementRatioSection(chart: SajuChart): ReadingSection {
  const e = chart.elements;
  const none = ELEMENTS.filter((x) => e.count[x] === 0);
  const many = ELEMENTS.filter((x) => e.count[x] >= 3);
  const paragraphs = [
    `${letterCount(chart)} 글자를 나무·불·흙·쇠·물로 나눠 세어 보면 ${countList(chart)}예요. 위의 도넛 그래프와 같은 숫자예요.`,
    ...ELEMENTS.map((x) => `${el(x)} ${e.count[x]}개 — ${REPORT_MISC.elementLevel[x][elementLevel(e.count[x])]}`),
    `글자 속에 숨은 기운과 태어난 계절의 힘까지 더해 비율로 따지면 ${ELEMENTS.map((x) => `${el(x)} ${pct(e.percent[x])}%`).join(' · ')}예요. 글자 수와 조금 다를 수 있는데, 비율이 높은 기운일수록 실제로 더 크게 느껴져요.`,
    `비율로는 ${elWord(e.dominant)}이 가장 강해요. ${ELEMENT_CONTENT[e.dominant].nature}`,
  ];
  const y = chart.yongsin;
  // 채우면 좋은 빈 기운 = 가장 필요한 기운이거나 그 기운을 돕는 기운일 때만. 아니면 '빈 기운 = 꼭 채울 기운'이 아니라고 짚어 준다
  const fill = none.filter((x) => x === y.yongsin || x === y.heesin);
  const tips = fill.flatMap((x) => ELEMENT_CONTENT[x].balanceTips.slice(0, fill.length > 1 ? 3 : 5));
  if (none.length && !fill.length) paragraphs.push(`비어 있는 ${none.map(el).join('·')} 기운을 꼭 채워야 하는 건 아니에요. 가장 필요한 기운은 전체 균형으로 정하는데, 그건 ${elWord(y.yongsin)}이에요. 다음 장에서 자세히 볼게요.`);
  if (fill.length) paragraphs.push(`비어 있는 ${fill.map(el).join('·')} 기운은 생활 속에서 이렇게 채울 수 있어요.`);
  return {
    key: 'elements',
    title: '다섯 가지 기운의 비율',
    summary: fill.length ? `${fill.map(el).join('·')} 기운을 채워 주면 균형이 잡혀요` : many.length ? `${many.map(el).join('·')} 기운이 중심을 잡고 있어요` : none.length ? `${none.map(el).join('·')} 기운이 비어 있어요` : '다섯 기운이 고르게 섞여 있어요',
    keywords: ELEMENTS.map((x) => `${el(x)} ${e.count[x]}개 · ${pct(e.percent[x])}%`),
    paragraphs,
    ...(tips.length ? { tips } : {}),
    basis: `오행 개수 ${ELEMENTS.map((x) => `${EL_NAME[x].slice(0, 1)}${e.count[x]}`).join(' ')} · 지장간·월령까지 셈한 비율 ${ELEMENTS.map((x) => `${EL_NAME[x].slice(0, 1)}${pct(e.percent[x])}%`).join(' ')} · 가장 강한 오행 ${EL_NAME[e.dominant]}`,
  };
}

function strengthSection(chart: SajuChart): ReadingSection {
  const s = chart.strength;
  const st = STRENGTH_CONTENT[s.level];
  const helps = [s.deukryeong && '태어난 계절', s.deukji && '내가 앉은 자리(태어난 날의 아래 글자)', s.deukse && '주변 글자들'].filter(Boolean) as string[];
  return {
    key: 'strength',
    title: '타고난 힘의 세기',
    summary: st.title,
    keywords: [STRENGTH_PLAIN[s.level].chip, `나를 돕는 기운 ${pct(s.score)}%`],
    paragraphs: [
      '타고난 힘의 세기는 여덟 글자 가운데 나를 돕는 글자가 얼마나 되는지로 가늠해요. 태어난 계절이 나를 돕는지, 내가 앉은 자리가 나를 돕는지, 주변 글자 중 나를 돕는 쪽이 많은지를 봐요. 세다고 좋고 약하다고 나쁜 게 아니라, 어떤 방식으로 살 때 편안한지 알려 주는 기준이에요.',
      `나를 돕는 기운은 전체의 약 ${pct(s.score)}%예요. ${helps.length ? `${list(helps, '에서', '에서')} 힘을 얻고 있어요.` : '태어난 계절이나 주변 글자에서 직접 받는 도움은 적은 편이라, 그때그때 들어오는 운의 영향을 크게 받아요.'}`,
      st.description,
      st.advice,
    ],
    basis: `일간의 힘 ${s.level} · 득령 ${s.deukryeong ? 'O' : 'X'} · 득지 ${s.deukji ? 'O' : 'X'} · 득세 ${s.deukse ? 'O' : 'X'} · 비겁·인성 비중 ${pct(s.score)}%`,
  };
}

function yongsinDetailSection(base: ReadingSection, chart: SajuChart): ReadingSection {
  const y = chart.yongsin;
  // '일상에서는 이런 것부터 해 보세요.'(목록 머리말)는 맨 뒤에 둔다
  const body = base.paragraphs.slice(0, -1);
  return {
    ...base,
    paragraphs: [
      ...body,
      `${elWord(y.yongsin)}을 곁에서 돕는 건 ${elWord(y.heesin)}이에요. 둘을 함께 챙기면 효과가 커지고, 이 기운이 들어오는 해나 달에는 일이 한결 순하게 풀려요.`,
      `반대로 ${elWord(y.gisin)}은 지나치면 피곤해지는 기운이에요. 나쁜 기운이라기보다 '많으면 버거운 기운'이라, 이 기운이 세게 들어오는 때에는 속도를 조금 늦춰 주세요.`,
      base.paragraphs.at(-1)!,
    ],
  };
}

function tenGodDetailSection(chart: SajuChart): ReadingSection {
  const g = groupCount(chart);
  const top = dominantTenGod(chart);
  const present = (Object.entries(chart.tenGodCount) as [TenGod, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const topGroup = GROUPS.reduce((best, k) => (g[k] > g[best] ? k : best), GROUPS[0]!);
  const paragraphs = [
    `나를 뺀 글자들은 나에게 어떤 힘이 되는지에 따라 다섯 가지로 나눠 볼 수 있어요. 나를 지키는 힘, 표현하는 힘, 재물을 다루는 힘, 책임지는 힘, 배우는 힘이에요.`,
    `세어 보면 ${GROUPS.map((k) => `${GROUP_PLAIN[k].name} ${g[k]}개`).join(', ')}예요. ${topGroup === TEN_GOD_GROUP[top] ? `그중 '${GROUP_PLAIN[topGroup].name}' 가운데 ${q(TEN_GOD_PLAIN[top].phrase, '이', '가')} 가장 두드러져요.` : `묶음으로는 ${q(GROUP_PLAIN[topGroup].name, '이', '가')} 가장 많고, 하나씩 보면 ${q(TEN_GOD_PLAIN[top].phrase, '이', '가')} 가장 두드러져요.`}`,
    `${q(TEN_GOD_PLAIN[top].phrase, '은', '는')} '${GROUP_PLAIN[TEN_GOD_GROUP[top]].name}'에 속해요. ${TEN_GOD_PLAIN[top].meaning} ${TEN_GOD_PLAIN[top].strong}`,
    ...present
      .filter(([tg]) => tg !== top)
      .slice(0, 3)
      .map(([tg, n]) => `${q(GROUP_PLAIN[TEN_GOD_GROUP[tg]].name, '에', '에')} 속하는 ${q(TEN_GOD_PLAIN[tg].phrase, '도', '도')} ${n}개 있어요. ${TEN_GOD_PLAIN[tg].meaning}`),
  ];
  for (const group of GROUPS.filter((k) => g[k] >= 3)) paragraphs.push(`${q(GROUP_PLAIN[group].name, '이', '가')} 많은 편이에요. ${GROUP_PLAIN[group].many}`);
  for (const group of GROUPS.filter((k) => g[k] === 0)) paragraphs.push(`${q(GROUP_PLAIN[group].name, '은', '는')} 비어 있어요. ${GROUP_PLAIN[group].absent}`);
  return {
    key: 'tenGods',
    title: '나를 움직이는 다섯 가지 힘',
    summary: `${q(TEN_GOD_PLAIN[top].phrase, '이', '가')} 삶의 중심이에요`,
    paragraphs,
    basis: `십성 ${present.map(([tg, n]) => `${tg} ${n}`).join(' · ')} · ${GROUPS.map((k) => `${k} ${g[k]}`).join(' · ')}`,
  };
}

/** 무료 섹션(3개까지) 뒤에, 나머지 특별한 기운을 조금 더 자세히 */
function shinsalDetailSection(base: ReadingSection, chart: SajuChart): ReadingSection {
  const all = chart.shinsal.filter((s, i, arr) => arr.findIndex((x) => x.name === s.name) === i);
  const shownNames = new Set(base.paragraphs.map((p) => p.match(/\(([가-힣]+)\)$/)?.[1]).filter(Boolean));
  const rest = [...all].filter((s) => !shownNames.has(s.name)).sort((a, b) => SHINSAL_ORDER.indexOf(a.name) - SHINSAL_ORDER.indexOf(b.name)).slice(0, 4);
  if (!rest.length) return base;
  return {
    ...base,
    paragraphs: [...base.paragraphs, '이 밖에도 이런 기운이 있어요.', ...rest.map((s) => `${SHINSAL_CONTENT[s.name].detail} (${s.name})`)],
  };
}

function relationsSection(chart: SajuChart): ReadingSection {
  const rels = chart.relations;
  if (!rels.length) {
    return {
      key: 'relations',
      title: '글자끼리 끌리고 부딪히는 곳',
      summary: '글자끼리 크게 부딪히는 곳 없이 안정적이에요',
      paragraphs: ['여덟 글자 사이에 두드러지게 끌어당기거나 부딪히는 짝이 없어요. 그래서 기질이 한결같고 예측하기 쉬운 편이에요. 큰 변화는 주로 10년마다, 해마다 바뀌는 흐름에서 들어오니 뒤의 장을 함께 보면 좋아요.'],
      basis: '원국 합충 없음',
    };
  }
  const told = new Set<string>();
  /** '해와 달', '해·달·시' */
  const SHORT = { year: '해', month: '달', day: '날', hour: '시' } as const;
  const pairName = (ps: readonly (keyof typeof SHORT)[]) => (ps.length === 2 ? `${SHORT[ps[0]!]}${particle(SHORT[ps[0]!], '과', '와')} ${SHORT[ps[1]!]}` : ps.map((p) => SHORT[p]).join('·'));
  // 같은 자리 짝끼리 묶어서 한 문단으로
  const groups = new Map<string, typeof rels>();
  for (const r of rels) {
    const k = r.positions.join('-');
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const paragraphs = ['여덟 글자 중에는 서로 끌어당기는 짝도 있고, 부딪히는 짝도 있어요. 좋고 나쁨보다는 삶의 어느 영역에 힘이 몰리는지 알려 주는 단서예요.'];
  for (const [, rs] of groups) {
    const ps = rs[0]!.positions;
    const lines = rs.map((r) =>
      ps.length > 2
        ? `태어난 ${pairName(ps)}의 아래 글자 셋은 ${RELATION_PLAIN[r.type].verb}.`
        : `태어난 ${pairName(ps)}의 ${r.target === 'stem' ? '위' : '아래'} 글자끼리는 ${RELATION_PLAIN[r.type].verb}.`,
    );
    const areas = ps.map((p) => POSITION_PLAIN[p].short);
    const areaText = areas.length === 2 ? `${areas[0]}${particle(areas[0]!, '과', '와')} ${areas[1]}` : areas.join(', ');
    const meaning = [...new Set(rs.map((r) => RELATION_PLAIN[r.type].kind))].filter((k) => !told.has(k) && (told.add(k), true)).map((k) => RELATION_KIND_MEANING[k]);
    paragraphs.push([...new Set(lines)].join(' ') + ` ${areaText}에 관한 이야기예요.` + (meaning.length ? ` ${meaning.join(' ')}` : ''));
  }
  const pull = rels.filter((r) => RELATION_PLAIN[r.type].kind === 'pull').length;
  const push = rels.length - pull;
  return {
    key: 'relations',
    title: '글자끼리 끌리고 부딪히는 곳',
    summary: push === 0 ? `서로 끌어당기는 짝이 ${pull}곳 있어요` : pull === 0 ? `서로 긴장하는 짝이 ${push}곳 있어요` : `끌어당기는 짝 ${pull}곳, 긴장하는 짝 ${push}곳이에요`,
    paragraphs,
    basis: rels.map((r) => r.label).join(', '),
  };
}

function stagesSection(chart: SajuChart): ReadingSection {
  const rows = POSITIONS.map((pos) => chart.pillars[pos]).filter((p): p is NonNullable<typeof p> => p !== null);
  const seen = new Set<string>();
  const paragraphs = [
    '네 자리마다 기운의 세기가 달라요. 사람의 한평생에 빗대어, 막 태어난 때부터 한창 왕성한 때, 쉬어 가는 때까지 열두 단계로 나눠 봐요.',
    ...rows.map((p) => {
      const pos = POSITION_PLAIN[p.position];
      const s = TWELVE_STAGE_CONTENT[p.branch.twelveStage];
      const lead = `${pos.name}의 자리(${pos.area})는 '${s.keyword}'의 단계예요.`;
      if (seen.has(s.name)) return `${lead} 앞에서 본 것과 같은 단계라, ${pos.short}에서도 같은 힘이 드러나요.`;
      seen.add(s.name);
      return `${lead} ${s.meaning}`;
    }),
  ];
  const day = TWELVE_STAGE_CONTENT[chart.pillars.day.branch.twelveStage];
  return {
    key: 'stages',
    title: '자리별 기운의 세기',
    summary: `나 자신의 자리는 '${day.keyword}'의 단계예요`,
    paragraphs,
    basis: `12운성 ${rows.map((p) => `${{ year: '년', month: '월', day: '일', hour: '시' }[p.position]} ${p.branch.twelveStage}`).join(' · ')}`,
  };
}

// ---------------------------------------------------------------------------
// 10년마다 바뀌는 흐름(대운) 8개
// ---------------------------------------------------------------------------

const range = (p: DaeunPeriod) => `${p.startAge}~${p.endAge}세`;

function daeunSections(chart: SajuChart, now: Date, once: Once, name: string | null): ReadingSection[] {
  const year = kstYear(now);
  const periods = chart.daeun.periods.slice(0, 8);
  const current = periods.find((p) => year >= p.startYear && year <= p.endYear);
  const evs = periods.map((p) => evaluateFortune(chart, p));
  const intro: ReadingSection = {
    key: 'daeun',
    title: '10년마다 바뀌는 큰 흐름',
    summary: current ? `지금은 ${range(current)}의 10년을 지나고 있어요` : `만 ${chart.daeun.startAge}세에 첫 10년이 시작돼요`,
    keywords: [`${chart.daeun.startAge}세부터 10년마다`, ...(current ? [`지금 '${TEN_GOD_PLAIN_LABEL[current.stemTenGod]}'의 10년`] : [])],
    paragraphs: [
      `운은 10년마다 계절처럼 바뀌어요. 같은 사람이라도 어떤 계절을 지나느냐에 따라 힘을 쓰기 좋은 때와 쉬어 갈 때가 달라져요. ${nameSubject(name, '의')}첫 10년은 만 ${chart.daeun.startAge}세에 시작${year - chart.solarDate.year >= chart.daeun.startAge ? '됐어요' : '돼요'}.`,
      '아래는 10년마다의 분위기를 한 단어로 적고, 흐름이 얼마나 순한지를 점수로 나타낸 거예요. 점수가 낮은 때는 나쁜 때라기보다 속도를 늦추고 다지는 때예요.',
      ...periods.map((p, i) => `${p === current ? '▶ ' : ''}${range(p)} (${p.startYear}~${p.endYear}년) · '${TEN_GOD_PLAIN_LABEL[p.stemTenGod]}' · ${GRADE_PLAIN_LABEL[evs[i]!.grade]} ${evs[i]!.scores.total}점`),
    ],
    basis: `대운수 ${chart.daeun.startAge}(정밀 ${chart.daeun.startExact.years}년 ${chart.daeun.startExact.months}개월) · ${chart.daeun.direction === 'forward' ? '순행' : '역행'} · ${periods.map((p, i) => `${p.ganzhi.hangul}(${p.ganzhi.hanja}) ${p.stemTenGod}·${p.branchTenGod} ${GRADE_LABEL[evs[i]!.grade]}`).join(', ')}`,
  };
  const each = periods.map((p, i): ReadingSection => {
    const ev = evs[i]!;
    const fs = once.fit(ev.fit.stem, 'stem');
    const fb = once.fit(ev.fit.branch, 'branch');
    const c = LUCK_CONTENT.daeun[p.stemTenGod];
    const sp = TEN_GOD_PLAIN[p.stemTenGod].phrase;
    const bp = TEN_GOD_PLAIN[p.branchTenGod].phrase;
    const paragraphs: string[] = [];
    const past = p.endYear < year;
    const child = p.endAge < 20;
    // 첫 문단: 이 10년에 겉으로 드러나는 힘 + 그 힘의 10년 풀이(한 권에 한 번)
    paragraphs.push(`${past ? `${p.startYear}~${p.endYear}년은 이미 지나온 시기라, 돌아보며 읽으면 지금의 나를 이해하는 데 도움이 돼요. ` : ''}${range(p)}에는 ${q(sp, '이', '가')} 겉으로 드러나요.${!child && once.first(`daeun:${p.stemTenGod}`) ? ` ${c.general}` : ''}`);
    // 생활 바탕(지지)에 깔린 힘 — 같은 문장이 두 번 나오지 않게
    if (!child && p.branchTenGod !== p.stemTenGod && once.first(`daeun-branch:${p.branchTenGod}`)) {
      paragraphs.push(`생활 바탕에는 ${q(bp, '이', '가')} 함께 깔려요.${once.first(`daeun:${p.branchTenGod}`) ? ` ${LUCK_CONTENT.daeun[p.branchTenGod].general}` : ''}`);
    }
    const fit = [fs.text, fb.text].filter(Boolean).join(' ');
    if (fit) paragraphs.push(fit);
    // 어린 시절의 10년은 돈·연애·직장 이야기 대신 공부·친구·집안 분위기로
    if (child) paragraphs.push(`어린 시절에는 이 힘이 공부하는 방식과 친구 관계, 집안 분위기로 드러나기 쉬워요. ${CHILD_HINT[p.stemTenGod]}`);
    else paragraphs.push(`재물 — ${c.wealth}`, `애정·관계 — ${c.love}`, `일·커리어 — ${c.career}`, `건강 — ${c.health}`);
    if (once.first(`stage:${p.twelveStage}`)) paragraphs.push(`기운의 세기로 보면 ${STAGE_SHORT[p.twelveStage]}예요.`);
    if (!child && !past) paragraphs.push(DAEUN_TIP[p.stemTenGod]);
    const hl = once.highlights(ev.highlights, 2);
    paragraphs.push(...hl.text);
    return {
      key: `daeun-${i + 1}`,
      title: `${range(p)} · '${TEN_GOD_PLAIN_LABEL[p.stemTenGod]}'의 10년`,
      summary: `${p.startYear}~${p.endYear}년 · ${GRADE_PLAIN_LABEL[ev.grade]}${p === current ? ' · 지금 지나는 10년' : ''}`,
      score: ev.scores.total,
      keywords: [TEN_GOD_PLAIN_LABEL[p.stemTenGod]!, ...(p.branchTenGod !== p.stemTenGod ? [TEN_GOD_PLAIN_LABEL[p.branchTenGod]!] : []), ...(fs.tag ? [fs.tag] : [])],
      paragraphs,
      basis: `${p.ganzhi.hangul}(${p.ganzhi.hanja}) 대운 · 천간 ${p.stemTenGod} · 지지 ${p.branchTenGod} · 12운성 ${p.twelveStage} · 천간 ${FIT_TERM[ev.fit.stem]} · 지지 ${FIT_TERM[ev.fit.branch]}${hl.terms.length ? ` · ${hl.terms.join(' · ')}` : ''}`,
    };
  });
  return [intro, ...each];
}

// ---------------------------------------------------------------------------
// 열두 달 — 사주분석서와 신년운세가 함께 쓴다
// ---------------------------------------------------------------------------

export function monthSections(chart: SajuChart, year: number, once: Once = reportOnce()): ReadingSection[] {
  const seed = `${year}-${chart.birthUtc}`;
  const seen = new Map<TenGod, number>();
  const months = wolun(chart.dayMaster.index, year);
  const evals = months.map((m) => evaluateFortune(chart, m, `${seed}-m${m.order}`));
  // 寅월 ≈ 양력 2월 … 丑월 = 다음 해 1월
  const label = (i: number) => (i === 11 ? `${year + 1}년 1월` : `${i + 2}월`);
  const ranked = evals.map((ev, i) => ({ i, s: ev.scores.total })).sort((a, b) => b.s - a.s);
  const best = ranked.slice(0, 3).map((r) => r.i).sort((a, b) => a - b);
  const careful = ranked.slice(-2).map((r) => r.i).sort((a, b) => a - b);
  const intro: ReadingSection = {
    key: 'months',
    title: `${year}년 열두 달의 흐름`,
    summary: `힘을 내기 좋은 달은 ${best.map(label).join('·')}이에요`,
    keywords: [...best.map((i) => `${label(i)} ${evals[i]!.scores.total}점`)],
    paragraphs: [
      `달마다 바뀌는 기운은 달력의 1일이 아니라 계절이 바뀌는 날을 기준으로 나눠요. 그래서 2월은 ${monthDay(months[0]!.startsAt)} 무렵부터, 3월은 ${monthDay(months[1]!.startsAt)} 무렵부터 시작해요. 점수는 그달의 기운이 내 사주와 얼마나 잘 맞는지를 100점 만점으로 나타낸 거예요.`,
      months.map((_, i) => `${label(i)} ${evals[i]!.scores.total}점`).join(' · '),
      `새로운 일을 시작하거나 중요한 약속을 잡기 좋은 달은 ${best.map(label).join(', ')}이고, ${careful.map(label).join(', ')}에는 속도를 늦추고 컨디션과 일정에 여유를 두면 좋아요.`,
    ],
    basis: `월운(절기 기준) ${months.map((m, i) => `${label(i)} ${m.ganzhi.hangul}(${m.ganzhi.hanja})`).join(' · ')}`,
  };
  // 달 요약은 같은 등급 안에서 겹치지 않게 차례로(시작 위치만 사주마다 다르게)
  const used = new Map<string, number>();
  const monthSummary = (i: number) => {
    const g = evals[i]!.grade;
    const bank = MONTH_SUMMARY[g];
    const n = used.get(g) ?? 0;
    used.set(g, n + 1);
    return n < bank.length ? bank[(hashSeed(seed) + n) % bank.length]! : `${label(i)}은 ${GRADE_PLAIN_LABEL[g]}의 흐름이에요`;
  };
  const each = months.map((m, i): ReadingSection => {
    const ev = evals[i]!;
    const v = (seen.get(m.stemTenGod) ?? 0) % 2;
    seen.set(m.stemTenGod, v + 1);
    const c = LUCK_CONTENT.month[m.stemTenGod];
    const fs = once.fit(ev.fit.stem, 'stem');
    const hl = once.highlights(ev.highlights, 1);
    const ph = TEN_GOD_PLAIN[m.stemTenGod].phrase;
    return {
      key: `month-${m.order}`,
      title: `${label(i)} · ${GRADE_PLAIN_LABEL[ev.grade]}`,
      summary: monthSummary(i),
      score: ev.scores.total,
      keywords: [`${monthDay(m.startsAt)}부터`, TEN_GOD_PLAIN_LABEL[m.stemTenGod]!, ...(fs.tag ? [fs.tag] : [])],
      paragraphs: [
        `${label(i)}에는 ${q(ph, '이', '가')} 들어와요. ${c.general[v]}`,
        ...(fs.text ? [fs.text] : []),
        `재물 — ${c.wealth[v]}`,
        `애정·관계 — ${c.love[v]}`,
        `일·커리어 — ${c.career[v]}`,
        `건강 — ${c.health[v]}`,
        ...hl.text,
        `이달의 실천 — ${c.advice[v]}`,
      ],
      basis: `${m.ganzhi.hangul}(${m.ganzhi.hanja})월 · ${m.termName}(${monthDay(m.startsAt)})부터 · 천간 ${m.stemTenGod} · 지지 ${m.branchTenGod} · ${GRADE_LABEL[ev.grade]}${hl.terms.length ? ` · ${hl.terms.join(' · ')}` : ''}`,
    };
  });
  return [intro, ...each];
}

// ---------------------------------------------------------------------------
// 사주분석서 (평생)
// ---------------------------------------------------------------------------

export function buildSajuAnalysis(chart: SajuChart, now = new Date(), profileName: string | null = null): ReadingSection[] {
  const name = displayName(profileName);
  const reading = buildBasicReading(chart, { access: 'full', now, name });
  const basic = new Map(reading.sections.map((s) => [s.key, s]));
  const get = (key: string) => basic.get(key)!;
  const thisYear = kstYear(now);
  const target = targetFortuneYear(now);
  const dm = dayMasterContent(chart);
  const y = chart.yongsin;
  const info = ELEMENT_INFO[y.yongsin];
  const once = reportOnce();
  const current = chart.daeun.periods.find((p) => thisYear >= p.startYear && thisYear <= p.endYear);
  const targetEv = evaluateFortune(chart, yearPillarOf(target), `year-${target}`);

  const overview: ReadingSection = {
    key: 'overview',
    title: name ? `한눈에 보는 ${name}님` : '한눈에 보기',
    summary: STEM_PLAIN[chart.dayMaster.index]!.headline,
    keywords: get('overview').keywords,
    points: [
      ...(reading.keyPoints ?? []).filter((k) => k.label !== '행운 포인트'),
      ...(current ? [{ label: '지금 시기', text: `${range(current)}, '${TEN_GOD_PLAIN_LABEL[current.stemTenGod]}'의 10년을 지나는 중이에요` }] : []),
      { label: `${target}년`, text: `${GRADE_PLAIN_LABEL[targetEv.grade]} — ${pick(FORTUNE_TEMPLATES.yearlyHeadline[targetEv.grade], `${target}-${chart.pillars.day.ganzhi.index}`)}` },
      ...(reading.keyPoints ?? []).filter((k) => k.label === '행운 포인트'),
    ],
    paragraphs: [
      `이 분석서는 태어난 연·월·일·시로 본 ${name ? `${name}님의` : '나의'} 타고난 모습과, 10년·1년·한 달 단위로 바뀌는 흐름을 차례로 담았어요.`,
      "어려운 사주 용어는 장마다 맨 아래 '사주로 보면'에 접어 두었어요. 본문만 읽어도 충분하고, 궁금할 때만 펼쳐 보면 돼요.",
    ],
    basis: get('overview').basis,
  };
  const closing: ReadingSection = {
    key: 'closing',
    title: '나답게 사는 법',
    summary: '나답게 살 때 운도 함께 따라와요',
    keywords: [`행운의 색 ${info.color}`, `행운의 방향 ${info.direction}`, `행운의 숫자 ${info.numbers.join('·')}`],
    paragraphs: [
      `${nameSubject(name, '은')}${REPORT_MISC.closingByStrength[chart.strength.level]}`,
      `마지막으로 건네고 싶은 한마디예요. ${dm.advice}`,
      `기억해 두면 좋은 것도 정리해 둘게요. 힘이 되는 건 ${elWord(y.yongsin)}이고, 행운의 색은 ${info.color}, 방향은 ${info.direction}, 숫자는 ${info.numbers.join('·')}이에요. 생활 속에서는 ${YONGSIN_CONTENT[y.yongsin].tips.slice(4, 6).join(', ')} 같은 것도 해 보세요.`,
      '사주는 정해진 운명표가 아니라 나를 이해하는 지도예요. 이 분석서가 내 강점을 믿고, 쉬어 갈 때를 알아차리는 데 작은 도움이 되면 좋겠어요.',
    ],
    basis: `일간 ${dm.name} · 일간의 힘 ${chart.strength.level} · 용신 ${EL_NAME[y.yongsin]}`,
  };

  return [
    overview,
    personalitySection(get('personality'), chart),
    chartSection(chart, name),
    elementRatioSection(chart),
    strengthSection(chart),
    yongsinDetailSection(get('yongsin'), chart),
    tenGodDetailSection(chart),
    shinsalDetailSection(get('shinsal'), chart),
    relationsSection(chart),
    stagesSection(chart),
    get('wealth'),
    get('love'),
    get('career'),
    get('health'),
    ...daeunSections(chart, now, once, name),
    yearBriefSection(chart, thisYear, name, once),
    yearBriefSection(chart, thisYear + 1, name, once),
    ...monthSections(chart, target, once),
    closing,
  ];
}

// ---------------------------------------------------------------------------
// 신년운세 리포트
// ---------------------------------------------------------------------------

export function buildYearlyReport(chart: SajuChart, year: number, profileName: string | null = null): ReadingSection[] {
  const name = displayName(profileName);
  const yp = yearPillarOf(year);
  const ev = evaluateFortune(chart, yp, `year-${year}`);
  const stg = ev.pillar.stemTenGod;
  const btg = ev.pillar.branchTenGod;
  const tg = TEN_GOD_CONTENT[stg];
  const bt = TEN_GOD_CONTENT[btg];
  const seed = `${year}-${chart.birthUtc}`;
  const daeun = chart.daeun.periods.find((p) => year >= p.startYear && year <= p.endYear);
  const stage = TWELVE_STAGE_CONTENT[ev.pillar.twelveStage];
  const once = reportOnce();
  const totalFit = [once.fit(ev.fit.stem, 'stem').text, once.fit(ev.fit.branch, 'branch').text].filter(Boolean).join(' ');
  const months = wolun(chart.dayMaster.index, year);
  const mev = months.map((m) => evaluateFortune(chart, m, `${seed}-m${m.order}`));
  const mLabel = (i: number) => (i === 11 ? `${year + 1}년 1월` : `${i + 2}월`);
  const rankBy = (k: 'total' | 'wealth' | 'love' | 'career' | 'health') => mev.map((e, i) => ({ i, s: e.scores[k] })).sort((a, b) => b.s - a.s);
  const best = rankBy('total').slice(0, 3).map((r) => r.i).sort((a, b) => a - b);
  const low = rankBy('total').slice(-2).map((r) => r.i).sort((a, b) => a - b);
  const info = ELEMENT_INFO[chart.yongsin.yongsin];
  const sp = TEN_GOD_PLAIN[stg].phrase;
  const bp = TEN_GOD_PLAIN[btg].phrase;
  const hl = once.highlights(ev.highlights, 3);
  const AREA_NAME = { wealth: '재물', love: '애정', career: '일', health: '건강' } as const;

  const area = (key: 'wealth' | 'love' | 'career' | 'health', title: string): ReadingSection => {
    const r = rankBy(key);
    return {
      key,
      title,
      score: ev.scores[key],
      summary: YEAR_AREA_SUMMARY[key][band(ev.scores[key])],
      paragraphs: [
        `한 해 전체로 보면 — ${tg.inLuck[key]}`,
        btg !== stg ? `생활 바탕에서는 — ${bt.inLuck[key]}` : '',
        daeun ? `올해가 속한 10년으로 보면 — ${LUCK_CONTENT.daeun[daeun.stemTenGod][key]}` : '',
        `${AREA_NAME[key]} 흐름이 가장 좋은 달은 ${mLabel(r[0]!.i)}이고, ${mLabel(r[r.length - 1]!.i)}에는 한 박자 쉬어 가면 좋아요.`,
      ].filter(Boolean),
      basis: `천간 ${stg} · 지지 ${btg}${daeun ? ` · ${daeun.ganzhi.hangul} 대운 ${daeun.stemTenGod}` : ''} · ${AREA_NAME[key]} 점수 ${ev.scores[key]}`,
    };
  };

  return [
    {
      key: 'total',
      title: `${year}년 한눈에 보기`,
      score: ev.scores.total,
      summary: pick(FORTUNE_TEMPLATES.yearlyHeadline[ev.grade], seed),
      keywords: [TEN_GOD_PLAIN_LABEL[stg]!, GRADE_PLAIN_LABEL[ev.grade], `${ev.scores.total}점`],
      points: [
        { label: '올해의 흐름', text: `${GRADE_PLAIN_LABEL[ev.grade]} (${ev.scores.total}점)` },
        { label: '힘내기 좋은 달', text: best.map(mLabel).join(', ') },
        { label: '쉬어 갈 달', text: low.map(mLabel).join(', ') },
        { label: '나에게 필요한 것', text: ELEMENT_PLAIN[chart.yongsin.yongsin].need },
        { label: '행운 포인트', text: `색 ${info.color} · 방향 ${info.direction} · 숫자 ${info.numbers.join('·')}` },
      ],
      paragraphs: [
        `${year}년은 ${nameSubject(name, '에게')}${btg !== stg ? `${q(sp, '이', '가')} 겉으로 드러나고, ${q(bp, '이', '가')} 생활 바탕에 깔리는 해예요.` : `${q(sp, '이', '가')} 안팎으로 함께 흐르는 해예요.`}`,
        luckLead(tg.inLuck.general, '겉으로는 '),
        btg !== stg ? luckLead(bt.inLuck.general, '바탕에 깔린 기운으로는 ') : LUCK_CONTENT.daeun[stg].general,
        totalFit,
        `기운의 세기로 보면 올해는 '${stage.keyword}'의 단계예요. ${stage.meaning}`,
        ...hl.text,
      ].filter(Boolean),
      basis: `${ev.pillar.ganzhi.hangul}(${ev.pillar.ganzhi.hanja})년 · 천간 ${stg} · 지지 ${btg} · 12운성 ${ev.pillar.twelveStage} · ${GRADE_LABEL[ev.grade]} · 천간 ${FIT_TERM[ev.fit.stem]} · 지지 ${FIT_TERM[ev.fit.branch]}${hl.terms.length ? ` · ${hl.terms.join(' · ')}` : ''}`,
    },
    {
      key: 'daeunContext',
      title: '올해가 속한 10년의 흐름',
      summary: daeun ? `${range(daeun)}, '${TEN_GOD_PLAIN_LABEL[daeun.stemTenGod]}'의 10년 안의 한 해예요` : '첫 10년이 시작되기 전의 한 해예요',
      paragraphs: daeun
        ? [
            `${year}년은 ${range(daeun)}(${daeun.startYear}~${daeun.endYear}년)의 10년 안에 있어요. 한 해의 운은 이 10년이라는 큰 계절 위에서 움직여요.`,
            `이 10년에는 ${q(TEN_GOD_PLAIN[daeun.stemTenGod].phrase, '이', '가')} 겉으로 드러나요.${btg === stg && daeun.stemTenGod === stg ? '' : ` ${LUCK_CONTENT.daeun[daeun.stemTenGod].general}`}`,
          ]
        : ['10년마다 바뀌는 흐름이 시작되기 전에는 타고난 기질과 한 해의 운이 그대로 드러나요. 올해의 흐름을 더 직접적으로 느낄 수 있어요.'],
      basis: daeun ? `${daeun.ganzhi.hangul}(${daeun.ganzhi.hanja}) 대운 ${daeun.startYear}~${daeun.endYear} · 천간 ${daeun.stemTenGod} · 지지 ${daeun.branchTenGod}` : `대운수 ${chart.daeun.startAge}`,
    },
    area('wealth', '재물운'),
    area('love', '애정운'),
    area('career', '일·사업운'),
    area('health', '건강운'),
    ...monthSections(chart, year, once),
  ];
}

// ---------------------------------------------------------------------------
// 궁합 리포트
// ---------------------------------------------------------------------------

/** 엔진 factor.key → 콘텐츠 키 (complement_a_wood → complement, spouse_star_b → spouse_star, yongsin_a → yongsin) */
function factorKey(key: string): CompatFactorKey {
  if (key.startsWith('complement_')) return 'complement';
  if (key.startsWith('spouse_star')) return 'spouse_star';
  if (key.startsWith('yongsin_')) return 'yongsin';
  if (key.startsWith('gisin_')) return 'gisin';
  return key as CompatFactorKey;
}

const CATEGORY_LABEL = { personality: '성격 궁합', romance: '연애·끌림', stability: '생활·안정', complement: '서로 채워 주는 정도' } as const;

export function buildCompatibilityReport(a: SajuChart, b: SajuChart, r: CompatibilityResult, names: { a: string; b: string }, now = new Date()): ReadingSection[] {
  const A = personLabel(names.a);
  const B0 = personLabel(names.b);
  // 둘 다 이름이 없으면 뒤 사람을 '상대'로
  const B = B0 === A ? '상대' : B0;
  const fill = (t: string) => fillNames(t, A, B);
  const dmA = dayMasterContent(a);
  const dmB = dayMasterContent(b);
  const dpA = dayPillarContent(a);
  const dpB = dayPillarContent(b);
  const sameStem = a.dayMaster.index === b.dayMaster.index;
  const samePillar = a.pillars.day.ganzhi.index === b.pillars.day.ganzhi.index;
  const pos = r.factors.filter((f) => f.tone === 'positive');
  const neg = r.factors.filter((f) => f.tone === 'negative');
  const neutral = r.factors.filter((f) => f.tone === 'neutral');
  const rel = (ELEMENTS.indexOf(b.dayMaster.element) - ELEMENTS.indexOf(a.dayMaster.element) + 5) % 5;
  const relKey = (['same', 'iGenerate', 'iControl', 'theyControl', 'theyGenerate'] as const)[rel]!;
  const thisYear = kstYear(now);
  const yearsOf = (c: SajuChart) => [thisYear, thisYear + 1].map((yr) => ({ yr, ev: evaluateFortune(c, yearPillarOf(yr), `year-${yr}`) }));
  const ya = yearsOf(a);
  const yb = yearsOf(b);
  const stemFactors = r.factors.filter((f) => f.key.startsWith('stem_'));
  const balanceFactors = r.factors.filter((f) => f.category === 'complement');
  /** 앞 장(성질·다섯 기운)에서 이미 풀이한 요인은 끌림·조율 장에서 다시 쓰지 않는다 */
  const shown = (f: CompatibilityFactor) => f.key.startsWith('stem_') || f.category === 'complement';
  const posRest = pos.filter((f) => !shown(f));
  const negRest = [...neg, ...neutral].filter((f) => !shown(f));
  const topGroup = (c: SajuChart) => {
    const g = groupCount(c);
    return GROUPS.reduce((best, k) => (g[k] > g[best] ? k : best), GROUPS[0]!);
  };
  const ga = topGroup(a);
  const gb = topGroup(b);
  const daeunNow = (c: SajuChart) => c.daeun.periods.find((p) => thisYear >= p.startYear && thisYear <= p.endYear);
  const da = daeunNow(a);
  const db = daeunNow(b);
  const once = new Set<CompatFactorKey>();
  // 다가오는 해(10월부터는 내년)의 달마다 두 사람 점수 — 각자의 신년운세와 같은 계산
  const target = targetFortuneYear(now);
  const monthScores = (c: SajuChart) => {
    const seed = `${target}-${c.birthUtc}`;
    return wolun(c.dayMaster.index, target).map((m, i) => ({ label: i === 11 ? `${target + 1}년 1월` : `${i + 2}월`, score: evaluateFortune(c, m, `${seed}-m${m.order}`).scores.total }));
  };
  const monthsA = monthScores(a);
  const monthsB = monthScores(b);
  const together = monthsA.map((m, i) => ({ i, low: Math.min(m.score, monthsB[i]!.score) }));
  const goodTogether = [...together].sort((x, y) => y.low - x.low).slice(0, 2).map((x) => x.i).sort((x, y) => x - y);
  const lowTogether = [...together].sort((x, y) => x.low - y.low)[0]!.i;

  /** 궁합 요인 하나 — 두 사람 이름으로 쓴 첫 문장 + (그 종류를 처음 볼 때만) 이유와 해 볼 일 */
  const factorLead = (f: CompatibilityFactor): string => {
    const k = f.key;
    const za = a.zodiac.animal;
    const zb = b.zodiac.animal;
    const elOf = (key: string) => el(key.slice(key.lastIndexOf('_') + 1) as Element);
    if (k === 'stem_combine') return fill('{A:과/와} {B:은/는} 타고난 성질끼리 서로 끌어당기는 짝이에요.');
    if (k === 'stem_clash') return fill('{A:과/와} {B:은/는} 타고난 성질이 서로 정면으로 마주 보는 짝이에요.');
    if (k === 'stem_same') return fill('{A:과/와} {B:은/는} 타고난 성질이 같은 쪽이에요.');
    if (k === 'stem_generate') return rel === 1 ? fill('{A:이/가} {B:을/를} 북돋아 주는 흐름이에요.') : fill('{B:이/가} {A:을/를} 북돋아 주는 흐름이에요.');
    if (k === 'stem_control') return rel === 2 ? fill('{A:이/가} 이끌고 {B:이/가} 맞추는 흐름이 생기기 쉬워요.') : fill('{B:이/가} 이끌고 {A:이/가} 맞추는 흐름이 생기기 쉬워요.');
    if (k === 'day_branch_combine') return '함께 사는 생활에서 손발이 잘 맞는 짝이에요.';
    if (k === 'day_branch_half') return '생활 속에서 같은 방향을 보며 손을 잡는 짝이에요.';
    if (k === 'day_branch_clash') return '함께 사는 생활에서는 서로 정반대 쪽을 보는 짝이에요.';
    if (k === 'day_branch_punish') return '생활 속에서 서로를 다듬으려는 긴장이 있는 짝이에요.';
    if (k === 'day_branch_harm') return '함께 사는 생활에서는 결이 조금 다른 짝이에요.';
    if (k === 'day_branch_wonjin') return '생활 속에서 끌리면서도 미묘하게 서운해지기 쉬운 짝이에요.';
    if (k === 'zodiac_combine') return `${za}띠와 ${zb}띠는 서로 잘 어울리는 띠예요.`;
    if (k === 'zodiac_trine') return `${za}띠와 ${zb}띠는 같은 무리에 속해 손발이 잘 맞는 띠예요.`;
    if (k === 'zodiac_clash') return `${za}띠와 ${zb}띠는 서로 마주 보는 띠예요.`;
    if (k === 'zodiac_wonjin') return `${za}띠와 ${zb}띠는 묘하게 엇갈리기 쉬운 띠예요.`;
    if (k.startsWith('complement_a_')) return `${who(A, '에게')} 없는 ${elOf(k)} 기운을 ${who(B, '이/가')} 채워 줘요.`;
    if (k.startsWith('complement_b_')) return `${who(B, '에게')} 없는 ${elOf(k)} 기운을 ${who(A, '이/가')} 채워 줘요.`;
    if (k === 'yongsin_a') return `${who(B, '의')} 강한 ${elWord(b.elements.dominant)}이 ${who(A, '에게')} 꼭 필요한 기운이에요.`;
    if (k === 'yongsin_b') return `${who(A, '의')} 강한 ${elWord(a.elements.dominant)}이 ${who(B, '에게')} 꼭 필요한 기운이에요.`;
    if (k === 'gisin_a') return `${who(B, '의')} 강한 ${elWord(b.elements.dominant)}이 ${who(A, '에게')}는 조금 버거울 수 있어요.`;
    if (k === 'gisin_b') return `${who(A, '의')} 강한 ${elWord(a.elements.dominant)}이 ${who(B, '에게')}는 조금 버거울 수 있어요.`;
    if (k === 'spouse_star_a') return `${who(A, '의')} 사주에서 ${who(B, '은/는')} '인생의 짝'을 뜻하는 기운에 해당해요.`;
    if (k === 'spouse_star_b') return `${who(B, '의')} 사주에서 ${who(A, '은/는')} '인생의 짝'을 뜻하는 기운에 해당해요.`;
    return f.label;
  };
  /** '한눈에 보기'·요약용 짧은 말 — 본문 첫 문장과 겹치지 않게 */
  const factorShort = (f: CompatibilityFactor): string => {
    const SHORT: Partial<Record<CompatFactorKey, string>> = {
      stem_combine: '타고난 성질끼리 자연스럽게 끌려요',
      stem_clash: '같은 일도 정반대로 반응할 때가 많아요',
      stem_same: '세상을 보는 눈이 닮았어요',
      stem_generate: '한쪽이 다른 쪽을 북돋아 줘요',
      stem_control: '한쪽이 이끌고 한쪽이 맞추기 쉬워요',
      day_branch_combine: '함께 지낼수록 편안해져요',
      day_branch_half: '같은 목표 앞에서 손발이 잘 맞아요',
      day_branch_clash: '생활 방식이 달라 맞춰 갈 게 있어요',
      day_branch_punish: '사소한 지적이 다툼이 되기 쉬워요',
      day_branch_harm: '말하지 않은 서운함이 쌓이기 쉬워요',
      day_branch_wonjin: '가까울수록 미묘하게 서운해지기 쉬워요',
      zodiac_combine: '띠끼리 잘 어울려요',
      zodiac_trine: '띠끼리 호흡이 잘 맞아요',
      zodiac_clash: '일하는 속도가 서로 달라요',
      zodiac_wonjin: '같은 말도 다르게 받아들이기 쉬워요',
      complement: '서로에게 없는 기운을 채워 줘요',
      yongsin: '곁에 있으면 서로 힘이 나요',
      gisin: '함께 있으면 가끔 마음이 무거워져요',
      spouse_star: '서로를 인생의 짝으로 느끼기 쉬워요',
    };
    return SHORT[factorKey(f.key)] ?? f.label.replace(/\.$/, '');
  };
  /** basis 용 사주 용어 */
  const factorTerm = (f: CompatibilityFactor): string => {
    const k = f.key;
    const T: Record<string, string> = {
      stem_combine: '일간 천간합', stem_clash: '일간 천간충', stem_same: '일간 같은 오행', stem_generate: '일간 상생', stem_control: '일간 상극',
      day_branch_combine: '일지 육합', day_branch_half: '일지 반합', day_branch_clash: '일지 충', day_branch_punish: '일지 형', day_branch_harm: '일지 해·파', day_branch_wonjin: '일지 원진',
      zodiac_combine: '띠 육합', zodiac_trine: '띠 삼합', zodiac_clash: '띠 충', zodiac_wonjin: '띠 원진',
    };
    if (T[k]) return T[k]!;
    if (k.startsWith('complement_')) return `오행 보완(${EL_NAME[k.slice(k.lastIndexOf('_') + 1) as Element].slice(0, 1)})`;
    if (k.startsWith('yongsin_')) return '용신 보완';
    if (k.startsWith('gisin_')) return '기신 부담';
    if (k.startsWith('spouse_star')) return `배우자성(${f.label.match(/\(([가-힣]+)\)/)?.[1] ?? '십성'})`;
    return k;
  };
  const factorText = (f: CompatibilityFactor) => {
    const k = factorKey(f.key);
    const c = REPORT_MISC.compatFactor[k];
    const lead = factorLead(f);
    if (!c || once.has(k)) return lead;
    once.add(k);
    return `${lead} ${c.detail} ${c.tip}`;
  };
  const strengthsOf = (dm: typeof dmA) => dm.strengths.slice(0, 2);
  /** 연애 문단 — '갑목은'이 이름으로 바뀌면 그대로, 아니면 '서윤님의 연애 — ' 머리말을 붙인다 */
  const loveOf = (dm: typeof dmA, raw: string, label: string) => {
    const n = displayName(raw);
    const named = personalize(dm.love, dm.name.slice(0, 2), n);
    if (n && named.includes(`${n}님`)) return named;
    return `${who(label, '의')} 연애 — ${personalize(dm.love, dm.name.slice(0, 2), null).replace(/^연애에서(도)? /, '')}`;
  };
  const weakOf = (dm: typeof dmA) => dm.weaknesses[0]!.split(' — ')[0]!.trim().replace(/[.]$/, '');
  const yongA = a.yongsin.yongsin;
  const yongB = b.yongsin.yongsin;
  const lowCat = (Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).reduce((m, k) => (r.categories[k] < r.categories[m] ? k : m), 'personality' as keyof typeof CATEGORY_LABEL);
  const basisFactors = r.factors.map(factorTerm).join(' · ');

  return [
    {
      key: 'summary',
      title: '한눈에 보는 궁합',
      summary: pick(FORTUNE_TEMPLATES.compatibilityHeadline[r.grade], `${a.birthUtc}|${b.birthUtc}`),
      score: r.score,
      keywords: [COMPAT_GRADE_LABEL[r.grade], `${r.score}점`],
      points: [
        { label: '궁합 점수', text: `${r.score}점 · ${COMPAT_GRADE_LABEL[r.grade]}` },
        { label: '잘 맞는 점', text: pos[0] ? factorShort(pos[0]) : '시간이 지날수록 깊어지는 사이예요' },
        { label: '맞춰 갈 점', text: neg[0] ? factorShort(neg[0]) : '두드러지게 부딪히는 곳이 없어요' },
        { label: '함께하면 좋은 것', text: yongA === yongB ? ELEMENT_PLAIN[yongA].need : `${ELEMENT_PLAIN[yongA].need}, ${ELEMENT_PLAIN[yongB].need}` },
      ],
      paragraphs: [
        `${who(A, '과/와')} ${who(B, '의')} 궁합은 100점 만점에 ${r.score}점, ${q(COMPAT_GRADE_LABEL[r.grade], '이에요', '예요')}. 타고난 성질, 함께 사는 생활, 띠, 다섯 가지 기운이 서로를 채우는지까지 함께 따져 본 점수예요.`,
        `잘 맞는 점 ${pos.length}가지, 맞춰 갈 점 ${neg.length}가지가 보여요. 점수는 출발점일 뿐, 서로를 이해하는 만큼 관계는 달라져요.`,
      ],
      basis: `${A} 일간 ${dmA.name}·일지 ${a.pillars.day.branch.hanja} · ${B} 일간 ${dmB.name}·일지 ${b.pillars.day.branch.hanja} · 영역 점수 ${(Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).map((k) => `${CATEGORY_LABEL[k]} ${r.categories[k]}`).join(' · ')}`,
    },
    {
      key: 'persons',
      title: '두 사람의 타고난 기질',
      summary: sameStem ? `두 사람 모두 '${dmA.title}' 같은 사람이에요` : `'${dmA.title}'${particle(dmA.title, '과', '와')} '${dmB.title}'의 만남`,
      paragraphs: [
        `${who(A, '은/는')} '${dmA.title}'에 빗댈 수 있어요. ${STEM_PLAIN[a.dayMaster.index]!.line}`,
        dropSimile(dpA.personality),
        sameStem ? `${who(B, '도')} 같은 '${dmB.title}'의 기질을 타고났어요. 그래서 서로를 설명 없이도 잘 알아봐요.` : `${who(B, '은/는')} '${dmB.title}'에 빗댈 수 있어요. ${STEM_PLAIN[b.dayMaster.index]!.line}`,
        ...(samePillar ? [] : [dropSimile(dpB.personality)]),
        sameStem
          ? `두 사람 모두 강점은 ${strengthsOf(dmA).join(', ')}${ieyo(strengthsOf(dmA).at(-1)!)}. 같은 강점을 가진 만큼, 일을 나눌 때는 한 사람이 앞에서 끌고 한 사람이 뒤를 챙기는 식으로 자리를 바꿔 가며 맡아 보세요.`
          : `${who(A, '의')} 강점은 ${strengthsOf(dmA).join(', ')}이고, ${who(B, '의')} 강점은 ${strengthsOf(dmB).join(', ')}${ieyo(strengthsOf(dmB).at(-1)!)}. 강점이 다를수록 역할을 나누기 쉬워요.`,
      ],
      basis: `${A} ${a.pillars.day.ganzhi.hangul}(${a.pillars.day.ganzhi.hanja})일주 · ${B} ${b.pillars.day.ganzhi.hangul}(${b.pillars.day.ganzhi.hanja})일주`,
    },
    {
      key: 'stemRelation',
      title: '타고난 성질의 관계',
      summary: stemFactors.some((f) => f.key === 'stem_combine')
        ? '타고난 성질끼리 손을 잡는 사이예요'
        : stemFactors.some((f) => f.key === 'stem_clash')
          ? '타고난 성질이 서로 마주 보는 사이예요'
          : (['닮은 성질끼리 만난 사이예요', '한 사람이 다른 사람의 힘이 되어 주는 사이예요', '이끄는 쪽과 맞추는 쪽이 생기기 쉬운 사이예요', '이끄는 쪽과 맞추는 쪽이 생기기 쉬운 사이예요', '한 사람이 다른 사람의 힘이 되어 주는 사이예요'] as const)[rel]!,
      paragraphs: [
        `${who(A, '은/는')} ${elWord(a.dayMaster.element)}, ${who(B, '은/는')} ${elWord(b.dayMaster.element)}을 타고났어요.${stemFactors.some((f) => f.key === 'stem_combine') ? '' : ` ${fill(REPORT_MISC.compatStemRelation[relKey])}`}`,
        ...stemFactors.map(factorText),
      ],
      basis: `일간 ${dmA.name} · ${dmB.name} (${['비화', '상생', '상극', '상극', '상생'][rel]})${stemFactors.length ? ` · ${stemFactors.map(factorTerm).join(' · ')}` : ''}`,
    },
    {
      key: 'balance',
      title: '다섯 가지 기운으로 본 균형',
      summary: balanceFactors.some((f) => f.tone === 'positive') ? '서로에게 필요한 기운을 채워 주는 사이예요' : '각자의 기운을 존중하며 맞춰 가는 사이예요',
      paragraphs: [
        `글자 수로 세어 보면 ${who(A, '은/는')} ${countList(a)}이고, ${who(B, '은/는')} ${countList(b)}예요.`,
        yongA === yongB
          ? `두 사람 모두 가장 필요한 건 '${ELEMENT_PLAIN[yongA].need}'(${elWord(yongA)})이에요.`
          : `${who(A, '에게')} 가장 필요한 건 '${ELEMENT_PLAIN[yongA].need}'(${elWord(yongA)})이고, ${who(B, '에게')} 가장 필요한 건 '${ELEMENT_PLAIN[yongB].need}'(${elWord(yongB)})이에요.`,
        ...(balanceFactors.length ? balanceFactors.map(factorText) : ['두 사람의 기운이 서로를 크게 채우거나 누르지 않아, 각자의 색을 지키며 함께하기 좋아요.']),
      ],
      basis: `오행 개수 ${A} ${ELEMENTS.map((x) => `${EL_NAME[x].slice(0, 1)}${a.elements.count[x]}`).join(' ')} · ${B} ${ELEMENTS.map((x) => `${EL_NAME[x].slice(0, 1)}${b.elements.count[x]}`).join(' ')} · 용신 ${EL_NAME[yongA]} · ${EL_NAME[yongB]}`,
    },
    {
      key: 'strengths',
      title: '서로 끌리는 이유',
      summary: pos.length ? `잘 맞는 점이 ${pos.length}가지 있어요` : '천천히 쌓아 가는 인연이에요',
      score: r.categories.romance,
      paragraphs: [
        ...(posRest.length ? posRest.map(factorText) : pos.length ? ['앞에서 본 타고난 성질과 다섯 기운의 어울림이 두 사람을 이어 주는 가장 큰 끌림이에요.'] : ['눈에 띄는 끌림보다 시간이 지날수록 깊어지는 관계예요. 함께 보낸 시간이 믿음으로 쌓이는 사이예요.']),
        ROMANCE_KEEP[band(r.categories.romance)],
      ],
      basis: pos.map(factorTerm).join(' · ') || '긍정 요인 없음',
    },
    {
      key: 'cautions',
      title: '함께 맞춰 갈 점',
      summary: neg.length ? `맞춰 갈 점이 ${neg.length}가지 있어요` : '크게 부딪히는 기운이 적어요',
      score: r.categories.stability,
      paragraphs: [
        ...(negRest.length ? negRest.map(factorText) : neg.length ? ['앞에서 본 성질과 기운의 차이 말고는 크게 부딪히는 곳이 적어요. 앞의 조언만 기억해 두면 충분해요.'] : ['서로 부딪히는 기운이 적어 편안한 관계를 만들기 좋아요. 다만 편안함이 무관심이 되지 않도록 표현은 아끼지 마세요.']),
        STABILITY_KEEP[band(r.categories.stability)],
      ],
      basis: [...neg, ...neutral].map(factorTerm).join(' · ') || '부정 요인 없음',
    },
    {
      key: 'categories',
      title: '영역별 궁합',
      summary: (Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).map((k) => `${CATEGORY_LABEL[k]} ${r.categories[k]}`).join(' · '),
      paragraphs: (Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).map((k) => `${CATEGORY_LABEL[k]} ${r.categories[k]}점 — ${REPORT_MISC.compatCategory[k][band(r.categories[k])]}`),
      basis: basisFactors,
    },
    {
      key: 'communication',
      title: '대화와 표현 방식',
      summary: ga === gb ? `두 사람 모두 '${GROUP_PLAIN[ga].name}'${particle(GROUP_PLAIN[ga].name, '이', '가')} 강해 말이 잘 통해요` : '서로 다른 방식으로 마음을 전해요',
      paragraphs: [
        `${who(A, '은/는')} ${q(GROUP_PLAIN[ga].name, '이', '가')} 가장 강해요. ${REPORT_MISC.compatCommunication[ga]}`,
        ga === gb ? `${who(B, '도')} 같은 힘이 가장 강해서, 마음을 전하는 방식이 닮았어요.` : `${who(B, '은/는')} ${q(GROUP_PLAIN[gb].name, '이', '가')} 가장 강해요. ${REPORT_MISC.compatCommunication[gb]}`,
        ga === gb
          ? '같은 방식으로 마음을 표현하니 오해는 적지만, 둘 다 같은 곳에서 지칠 수 있어요. 가끔은 상대가 잘 하지 않는 방식으로 먼저 다가가 보세요.'
          : '표현 방식이 다르다는 건 서로에게 없는 말투를 가르쳐 줄 수 있다는 뜻이에요. 상대의 방식을 "틀렸다"가 아니라 "다르다"로 읽어 주세요.',
      ],
      basis: `가장 강한 십성 묶음 ${A} ${ga} · ${B} ${gb}`,
    },
    {
      key: 'conflict',
      title: '다툼이 생길 때',
      summary: a.strength.level === b.strength.level ? `두 사람 모두 ${STRENGTH_PLAIN[a.strength.level].chip}예요` : `${STRENGTH_PLAIN[a.strength.level].chip}${particle(STRENGTH_PLAIN[a.strength.level].chip, '과', '와')} ${STRENGTH_PLAIN[b.strength.level].chip}의 만남`,
      paragraphs: [
        `${who(A, '은/는')} ${STRENGTH_PLAIN[a.strength.level].chip}${ieyo(STRENGTH_PLAIN[a.strength.level].chip)}. ${REPORT_MISC.compatConflict[a.strength.level]}`,
        a.strength.level === b.strength.level ? `${who(B, '도')} 같은 쪽이라, 다툴 때 비슷한 방식으로 반응하기 쉬워요.` : `${who(B, '은/는')} ${STRENGTH_PLAIN[b.strength.level].chip}${ieyo(STRENGTH_PLAIN[b.strength.level].chip)}. ${REPORT_MISC.compatConflict[b.strength.level]}`,
        '다툼이 길어질 때는 "누가 맞나"보다 "우리가 원하는 건 뭘까"로 질문을 바꿔 보세요. 감정이 가라앉을 시간을 정해 두고 다시 이야기하는 것도 좋은 방법이에요.',
      ],
      basis: `일간의 힘 ${A} ${a.strength.level} · ${B} ${b.strength.level}`,
    },
    {
      key: 'loveStyle',
      title: '두 사람의 연애 스타일',
      summary: '서로의 사랑법을 알면 오해가 줄어요',
      paragraphs: [
        loveOf(dmA, names.a, A),
        dpA.love,
        ...(sameStem ? [] : [loveOf(dmB, names.b, B)]),
        ...(samePillar ? [] : [dpB.love]),
        ...(sameStem ? [`${who(B, '도')} 같은 결의 사랑을 해요. 그래서 서로의 서운함이 어디서 오는지 금방 알아챌 수 있어요.`] : []),
      ],
      basis: `${A} ${dmA.name} · ${B} ${dmB.name}`,
    },
    {
      key: 'manual',
      title: '서로를 위한 사용설명서',
      summary: '상대가 힘을 얻는 순간과 조심할 지점',
      paragraphs: [
        `${who(A, '은/는')} ${list(dmA.strengths.slice(2, 4), '을', '를')} 알아봐 줄 때 힘을 얻어요. 가끔은 이런 모습도 보여요. ${weakOf(dmA)}. 그럴 땐 너그럽게 봐 주면 좋아요.`,
        `${who(A, '에게')} 건네면 좋은 말 — ${dmA.advice}`,
        sameStem
          ? `${who(B, '도')} 같은 강점에서 힘을 얻으니, 서로의 노력을 먼저 알아봐 주세요.`
          : `${who(B, '은/는')} ${list(dmB.strengths.slice(2, 4), '을', '를')} 알아봐 줄 때 힘을 얻어요. 이런 모습이 보일 때도 있어요. ${weakOf(dmB)}. 그럴 땐 한 번 더 기다려 주면 좋아요.`,
        ...(sameStem ? [] : [`${who(B, '에게')} 건네면 좋은 말 — ${dmB.advice}`]),
      ],
      basis: `${A} ${dmA.name} · ${B} ${dmB.name}`,
    },
    {
      key: 'together',
      title: '함께하면 좋은 것',
      summary: yongA === yongB ? `두 사람 모두 ${elWord(yongA)}에서 힘을 얻어요` : `${el(yongA)}${particle(el(yongA), '과', '와')} ${el(yongB)} 기운을 함께 채워요`,
      paragraphs: [
        yongA === yongB
          ? `두 사람 모두에게 힘이 되는 건 '${ELEMENT_PLAIN[yongA].need}'이에요. 필요한 기운이 같아서, 아래 활동을 함께하면 둘 다 충전돼요. 정기적인 데이트 습관으로 만들어 보세요.`
          : `${who(A, '에게')} 힘이 되는 건 '${ELEMENT_PLAIN[yongA].need}'이고, ${who(B, '에게')} 힘이 되는 건 '${ELEMENT_PLAIN[yongB].need}'이에요. 아래 활동 가운데 번갈아 상대에게 필요한 것을 골라 함께하면 서로를 채워 주는 시간이 돼요.`,
        `함께 쓰면 좋은 색은 ${[...new Set([ELEMENT_INFO[yongA].color, ELEMENT_INFO[yongB].color])].join(', ')}이고, 함께 가면 좋은 방향은 ${[...new Set([ELEMENT_INFO[yongA].direction, ELEMENT_INFO[yongB].direction])].join(', ')}이에요.`,
      ],
      tips: [...new Set([...ELEMENT_CONTENT[yongA].balanceTips.slice(0, 3), ...ELEMENT_CONTENT[yongB].balanceTips.slice(0, 3)])],
      basis: `용신 ${A} ${EL_NAME[yongA]} · ${B} ${EL_NAME[yongB]}`,
    },
    {
      key: 'timing',
      title: '함께 보는 올해와 내년',
      summary: `${thisYear}년 ${A} ${GRADE_PLAIN_LABEL[ya[0]!.ev.grade]} · ${B} ${GRADE_PLAIN_LABEL[yb[0]!.ev.grade]}`,
      paragraphs: [
        ...[
          da && `${who(A, '은/는')} 지금 ${range(da)}(${da.startYear}~${da.endYear}년), '${TEN_GOD_PLAIN_LABEL[da.stemTenGod]}'의 10년을 지나고 있어요. ${LUCK_CONTENT.daeun[da.stemTenGod].love}`,
          db &&
            (da && da.stemTenGod === db.stemTenGod
              ? `${who(B, '도')} 지금 ${range(db)}(${db.startYear}~${db.endYear}년), 같은 '${TEN_GOD_PLAIN_LABEL[db.stemTenGod]}'의 10년을 지나고 있어요. 두 사람이 비슷한 계절을 함께 걷는 셈이에요.`
              : `${who(B, '은/는')} 지금 ${range(db)}(${db.startYear}~${db.endYear}년), '${TEN_GOD_PLAIN_LABEL[db.stemTenGod]}'의 10년을 지나고 있어요. ${LUCK_CONTENT.daeun[db.stemTenGod].love}`),
        ].filter((x): x is string => Boolean(x)),
        ...[0, 1].map((i) => {
          const ea = ya[i]!.ev;
          const eb = yb[i]!.ev;
          const both = ea.scores.total >= 65 && eb.scores.total >= 65;
          const gap = Math.abs(ea.scores.total - eb.scores.total) >= 15;
          const tail = both
            ? ['두 사람 모두 기운이 오르는 해라 함께 계획한 일을 시작하기 좋아요.', '둘 다 기운이 좋은 해라 미뤄 둔 큰 계획을 함께 꺼내 보기 좋아요.'][i]
            : gap
              ? ['한 사람의 기운이 더 높은 해라, 여유가 있는 쪽이 상대의 속도를 기다려 주면 관계가 단단해져요.', '기운의 높낮이가 엇갈리는 해라, 힘이 남는 쪽이 먼저 손을 내밀면 좋아요.'][i]
              : ['두 사람 모두 차분히 다지는 해라, 큰 결정보다 일상의 리듬을 맞추는 데 힘을 쓰면 좋아요.', '둘 다 무난하게 흘러가는 해라, 함께하는 작은 습관을 하나 만들기 좋아요.'][i];
          return `${ya[i]!.yr}년 — ${who(A, '은/는')} '${TEN_GOD_PLAIN_LABEL[ea.pillar.stemTenGod]}'의 해로 ${ea.scores.total}점, ${who(B, '은/는')} '${TEN_GOD_PLAIN_LABEL[eb.pillar.stemTenGod]}'의 해로 ${eb.scores.total}점이에요. ${tail}`;
        }),
        `${target}년에 두 사람 모두 기운이 좋은 달은 ${goodTogether.map((i) => monthsA[i]!.label).join('·')}이에요. 여행이나 중요한 약속은 이때 잡아 보세요. ${monthsA[lowTogether]!.label}에는 둘 다 지치기 쉬우니 일정을 넉넉하게 잡아 주세요.`,
      ],
      basis: `월운 점수(${target}년) ${A} ${monthsA.map((m) => m.score).join('·')} / ${B} ${monthsB.map((m) => m.score).join('·')} · ${A} ${da ? `${da.ganzhi.hangul} 대운 ${da.stemTenGod}` : '대운 전'} · ${B} ${db ? `${db.ganzhi.hangul} 대운 ${db.stemTenGod}` : '대운 전'} · ${thisYear}년 ${ya[0]!.ev.pillar.ganzhi.hangul} · ${thisYear + 1}년 ${ya[1]!.ev.pillar.ganzhi.hangul}`,
    },
    {
      key: 'advice',
      title: '더 좋은 관계를 위한 조언',
      summary: COMPAT_GRADE_LABEL[r.grade],
      paragraphs: [
        FORTUNE_TEMPLATES.compatibilityAdvice[r.grade],
        `두 사람이 가장 신경 쓰면 좋은 영역은 '${CATEGORY_LABEL[lowCat]}'이에요. 이 부분은 한 달에 한 번쯤 서로의 생각을 물어보는 시간을 정해 두면 좋아요.`,
        '궁합은 두 사람의 기운이 만나는 방식을 보는 참고 자료예요. 관계의 답은 결국 서로를 대하는 매일의 태도에 있어요.',
      ],
      basis: `궁합 등급 ${r.grade} · 가장 낮은 영역 ${CATEGORY_LABEL[lowCat]} ${r.categories[lowCat]}`,
    },
  ];
}
