/**
 * 유료 보고서 생성기 — 사주분석서(평생) · 신년운세 · 궁합 리포트.
 *
 * 문체 기준(docs/PLAIN_KOREAN.md): 사주를 처음 접하는 성인도 쉽게 이해하는 전문 서비스.
 * - 맨 앞 섹션에 '한눈에 보기'(points)를 두고, 각 장은 결론부터.
 * - 정식 명리학 용어(천간·지지·일간·십성·오행·용신·대운·세운·신강·신약·12운성·합·충 …)를 쓰고, 한 권에서 처음 나올 때 뜻을 붙인다(reportOnce.term).
 *   근거 글자와 관계는 basis('사주로 보면')에 모아 둔다.
 * - 해석은 확정이 아니라 명리학적 해석으로('~기 쉽습니다', '~로 봐요').
 * - 점수·등급·신강·신약 점수·오행 비율·용신 계산·대운 시작 나이처럼 달빛사주가 계산한 것은 '달빛사주 기준'이라고 밝힌다.
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
import { ELEMENT_PLAIN, SHINSAL_ORDER, STEM_PLAIN, displayName, nameSubject, personalize } from './content/plain.js';
import {
  CHILD_HINT,
  DAEUN_TIP,
  GROUP_PLAIN,
  POSITION_PLAIN,
  RELATION_KIND_MEANING,
  RELATION_PLAIN,
  ROMANCE_KEEP,
  MONTH_SUMMARY,
  STABILITY_KEEP,
  STAGE_SHORT,
  TEN_GOD_PLAIN,
  YEAR_AREA_SUMMARY,
} from './content/reportPlain.js';
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
  luckOpening,
  pick,
  plainHighlights,
  targetFortuneYear,
  yearBriefSection,
} from './reading.js';
import { LUCKY_COLOR_PLAIN } from './content/plainFortune.js';

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

/** 오행의 정식 이름 — '목' */
const EL_HANGUL: Record<Element, string> = { wood: '목', fire: '화', earth: '토', metal: '금', water: '수' };
const el = (e: Element) => EL_HANGUL[e];
/** '목 기운' */
const elWord = (e: Element) => `${el(e)} 기운`;
/** 따옴표로 감싼 말 + 조사 — "'배우는 힘'이" */
const q = (word: string, withBatchim: string, without: string) => `'${word}'${particle(word, withBatchim, without)}`;
/** '득지·득세' + 조사 */
const dots = (items: string[], withBatchim: string, without: string) => items.join('·') + particle(items[items.length - 1] ?? '', withBatchim, without);
/** 십성 + '(으)로' — '편관으로', '정재로' */
const ro = (word: string) => particle(word, '으로', '로');

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

/** 운의 오행이 용신·희신·기신 가운데 무엇인지 — 키워드 칩 */
const FIT_TAG = { yongsin: '용신이 드는 시기', heesin: '희신이 드는 시기', gisin: '기신이 드는 시기', neutral: '' } as const;
const FIT_TERM = { yongsin: '용신', heesin: '희신', gisin: '기신', neutral: '한신' } as const;
/** 용어의 짧은 정의 — 한 권에서 처음 쓸 때만 괄호로 붙인다 */
const DEF = {
  용신: '사주의 균형과 흐름에 가장 도움이 된다고 보는 오행',
  희신: '용신을 생하여 돕는 오행',
  기신: '용신을 극하는 오행',
  대운: '10년 단위로 바뀌는 운의 큰 흐름',
  세운: '해마다 들어오는 운',
  월운: '달마다 들어오는 운',
  '12운성': '일간의 기운이 각 지지에서 어떤 상태인지를 열두 단계로 나타낸 것',
} as const;
/**
 * 보고서 한 권 안에서 같은 안내 문장(용신·기신 안내, 신살·합충 하이라이트, 대운 풀이)을 되풀이하지 않도록,
 * 처음 한 번만 문장으로 쓰고 이후에는 키워드 꼬리표로만 남긴다. 용어의 뜻(term)과 십성의 짧은 뜻(tg)도 처음 한 번만 붙인다.
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
    /** 용어 — 처음이면 '용신(사주의 균형에 …)', 아니면 '용신' */
    term(word: keyof typeof DEF): string {
      return first(`term:${word}`) ? `${word}(${DEF[word]})` : word;
    },
    /** 십성 — 처음이면 '편재(유동적인 재물과 활동성)', 아니면 '편재' */
    tg(tg: TenGod): string {
      return first(`tg:${tg}`) ? `${tg}(${TEN_GOD_PLAIN[tg].gloss})` : tg;
    },
    first,
  };
}
type Once = ReturnType<typeof reportOnce>;
/** 십성(처음이면 뜻까지) + 조사 — 조사는 십성 이름에 맞춘다 */
const tgp = (once: Once, tg: TenGod, withBatchim: string, without: string) => `${once.tg(tg)}${particle(tg, withBatchim, without)}`;

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

/** 여덟(여섯) 글자 개수 — '목 3개, 화 0개, …' */
const countList = (chart: SajuChart) => ELEMENTS.map((e) => `${el(e)} ${chart.elements.count[e]}개`).join(', ');
const letterCount = (chart: SajuChart) => (chart.pillars.hour ? '여덟' : '여섯');
/** 일간 이름 — '갑목' */
const stemName = (chart: SajuChart) => `${chart.dayMaster.hangul}${el(chart.dayMaster.element)}`;
/** 용신이 일간에게 어떤 무리(십성)인지 */
const groupOf = (chart: SajuChart, e: Element) => GROUPS[(ELEMENTS.indexOf(e) - ELEMENTS.indexOf(chart.dayMaster.element) + 5) % 5]!;

// ---------------------------------------------------------------------------
// 사주분석서 — 타고난 모습
// ---------------------------------------------------------------------------

function chartSection(chart: SajuChart, name: string | null, once: Once): ReadingSection {
  const dm = dayMasterContent(chart);
  const rows = POSITIONS.map((pos) => chart.pillars[pos]).filter((p): p is NonNullable<typeof p> => p !== null);
  const me = name ? `${name}님을` : '나를';
  const yy = chart.dayMaster.yinYang === 'yang' ? '양(+)' : '음(−)';
  const paragraphs = [
    `사주는 태어난 연·월·일·시를 각각 천간과 지지 두 글자로 나타낸 네 기둥, 모두 여덟 글자입니다. 각 기둥의 위 글자인 천간은 하늘의 기운을, 아래 글자인 지지는 땅의 기운을 상징해요. 이 가운데 태어난 날의 천간인 일간이 나 자신을 나타내고, 나머지 글자는 일간과 어떤 관계에 있는지에 따라 십성(일간을 기준으로 본 열 가지 관계)으로 나눠 해석합니다.`,
    `${name ? `${name}님의 ` : ''}일간은 ${stemName(chart)}, 곧 ${yy}의 ${elWord(chart.dayMaster.element)}이에요. 앞 장의 성격 풀이는 이 일간과 일주(태어난 날의 두 글자)를 바탕으로 했습니다. 기둥마다 상징하는 영역과 놓인 십성은 다음과 같아요.`,
    ...rows.map((p) => {
      const pos = POSITION_PLAIN[p.position];
      const head = `${pos.pillar} ${p.ganzhi.hangul} — ${pos.area}${particle(pos.area, '을', '를')} 나타내는 자리예요.`;
      const stem = `${p.stem.hangul}(${el(p.stem.element)})`;
      const branch = `${p.branch.hangul}(${el(p.branch.element)})`;
      const st = p.stem.tenGod as TenGod;
      const bt = p.branch.tenGod;
      if (p.position === 'day') return `${head} 천간 ${stem}${particle(p.stem.hangul, '이', '가')} 일간이고, 지지 ${branch}${particle(p.branch.hangul, '은', '는')} ${tgp(once, bt, '에', '에')} 해당해요. 일지는 배우자 자리로도 보아, 가까운 관계에서 이 성향이 드러나기 쉽다고 해석합니다.`;
      if (st === bt) return `${head} 천간 ${stem}${particle(p.stem.hangul, '과', '와')} 지지 ${branch}${particle(p.branch.hangul, '이', '가')} 모두 ${tgp(once, st, '에', '에')} 해당합니다.`;
      return `${head} 천간 ${stem}${particle(p.stem.hangul, '은', '는')} ${once.tg(st)}, 지지 ${branch}${particle(p.branch.hangul, '은', '는')} ${tgp(once, bt, '에', '에')} 해당합니다.`;
    }),
    '지지의 십성은 지지 안에 담긴 천간(지장간) 가운데 비중이 가장 큰 본기를 기준으로 봤어요.',
  ];
  if (!chart.pillars.hour) paragraphs.push('태어난 시간을 몰라 시주를 뺀 여섯 글자로 풀었어요. 시간을 알면 시주가 나타내는 자녀·말년에 관한 해석과 오행 개수가 보완됩니다.');
  return {
    key: 'chart',
    title: `타고난 ${letterCount(chart)} 글자`,
    summary: `${me} 나타내는 일간은 ${stemName(chart)}${ieyo(stemName(chart))}`,
    keywords: [`${chart.zodiac.animal}띠`, `일간 · ${stemName(chart)}`],
    paragraphs,
    basis: rows.map((p) => `${{ year: '년주', month: '월주', day: '일주', hour: '시주' }[p.position]} ${p.ganzhi.hangul}(${p.ganzhi.hanja}) ${p.stem.tenGod}·${p.branch.tenGod}`).join(' · ') + ` · 일간 ${dm.name}`,
  };
}

function personalitySection(base: ReadingSection, chart: SajuChart): ReadingSection {
  // 일간 성격 뒤, '신경 쓸 점' 앞에 일주(태어난 날 두 글자)로 본 성향을 더한다 — 일주 문단은 일지의 십성부터 말한다(dayPillars.ts)
  const dp = dayPillarContent(chart);
  const body = base.paragraphs.slice(0, -1);
  return { ...base, paragraphs: [...body, dp.personality, base.paragraphs.at(-1)!] };
}

function elementRatioSection(chart: SajuChart, name: string | null, once: Once): ReadingSection {
  const e = chart.elements;
  const y = chart.yongsin;
  const none = ELEMENTS.filter((x) => e.count[x] === 0);
  const many = ELEMENTS.filter((x) => e.count[x] >= 3);
  const paragraphs = [
    `사주의 모든 글자는 목(나무)·화(불)·토(흙)·금(쇠)·수(물)의 다섯 가지 기운, 곧 오행 가운데 하나에 속합니다. ${letterCount(chart)} 글자의 오행을 개수로 세면 ${countList(chart)}이며, 위의 오행 그래프와 같은 값이에요.`,
    ...ELEMENTS.map((x) => `${el(x)} ${e.count[x]}개 — ${REPORT_MISC.elementLevel[x][elementLevel(e.count[x])]}`),
    `개수는 글자를 단순히 센 값이라 지지 안에 담긴 천간(지장간)과 태어난 계절의 영향은 반영하지 않습니다. 달빛사주는 지장간의 비중과 태어난 달의 계절 기운(월령)에 가중치를 둔 비율도 따로 계산하는데(서비스 자체 기준), 이 기준으로는 ${ELEMENTS.map((x) => `${el(x)} ${pct(e.percent[x])}%`).join(' · ')}입니다.`,
    `가중 비율로는 ${elWord(e.dominant)}이 가장 강해요. ${ELEMENT_CONTENT[e.dominant].nature}`,
  ];
  // 글자로는 없지만 지장간에 담긴 오행 — 개수 0 이 곧 '전혀 없음'은 아니다
  const hidden = none.filter((x) => pct(e.percent[x]) > 0);
  if (hidden.length) paragraphs.push(`${hidden.map(el).join('·')} 기운은 글자로는 드러나지 않지만 지장간에 담겨 있어, 가중 비율로는 ${hidden.map((x) => `${el(x)} ${pct(e.percent[x])}%`).join(', ')}입니다. 원국에 드러나지 않았다고 해서 그 기운이 전혀 없다는 뜻은 아니에요.`);
  // 채우면 좋은 빈 기운 = 용신이거나 희신일 때만. 아니면 '빈 오행 = 꼭 채울 오행'이 아니라고 짚어 준다
  const fill = none.filter((x) => x === y.yongsin || x === y.heesin);
  const tips = fill.flatMap((x) => ELEMENT_CONTENT[x].balanceTips.slice(0, fill.length > 1 ? 3 : 5));
  if (none.length && !fill.length) {
    paragraphs.push(`원국에 없는 오행을 반드시 채워야 하는 것은 아닙니다. 보완할 오행은 일간의 강약과 사주 전체의 균형으로 정하며, 달빛사주 기준으로 ${nameSubject(name, '의')}${once.term('용신')}은 ${elWord(y.yongsin)}이에요. 뒤에서 자세히 다룹니다.`);
  }
  if (fill.length) {
    const role = fill.map((x) => (x === y.yongsin ? once.term('용신') : once.term('희신')));
    paragraphs.push(`원국에 없는 ${fill.map(el).join('·')} 기운은 ${fill.length > 1 ? `각각 ${role.join('과 ')}` : role[0]}에 해당해, 생활 속에서 보완하면 도움이 된다고 봐요. 흔히 권하는 방법은 다음과 같습니다.`);
  }
  return {
    key: 'elements',
    title: '오행의 분포',
    summary: fill.length
      ? `원국에 없는 ${fill.map(el).join('·')} 기운을 보완하면 균형에 도움이 된다고 봐요`
      : many.length
        ? `${many.map(el).join('·')} 기운이 많은 편이에요`
        : none.length
          ? `${none.map(el).join('·')} 기운이 원국에 드러나 있지 않아요`
          : '다섯 오행이 고르게 분포해 있어요',
    keywords: ELEMENTS.map((x) => `${el(x)} ${e.count[x]}개 · 가중 ${pct(e.percent[x])}%`),
    paragraphs,
    ...(tips.length ? { tips } : {}),
    basis: `오행 개수 ${ELEMENTS.map((x) => `${EL_NAME[x].slice(0, 1)}${e.count[x]}`).join(' ')} · 달빛사주 가중 비율(지장간·월령 ×1.5) ${ELEMENTS.map((x) => `${EL_NAME[x].slice(0, 1)}${pct(e.percent[x])}%`).join(' ')} · 가장 강한 오행 ${EL_NAME[e.dominant]}`,
  };
}

function strengthSection(chart: SajuChart, name: string | null): ReadingSection {
  const s = chart.strength;
  const st = STRENGTH_CONTENT[s.level];
  const all = [
    [s.deukryeong, '득령'],
    [s.deukji, '득지'],
    [s.deukse, '득세'],
  ] as const;
  const have = all.filter(([ok]) => ok).map(([, n]) => n);
  const lack = all.filter(([ok]) => !ok).map(([, n]) => n);
  const subject = name ? `${name}님의 사주는 ` : '';
  const status =
    have.length === 3
      ? `${subject}득령·득지·득세를 모두 갖춰, 일간을 받쳐 주는 힘이 강한 구조예요.`
      : have.length === 0
        ? `${subject}득령·득지·득세 가운데 해당하는 것이 없어, 일간을 직접 받쳐 주는 힘이 적은 편이에요. 이런 경우 운에서 들어오는 기운의 영향을 상대적으로 크게 받는다고 봅니다.`
        : `${subject}${dots(have, '을', '를')} 갖췄고, ${dots(lack, '은', '는')} 갖추지 못했어요.`;
  return {
    key: 'strength',
    title: '신강·신약 — 일간의 강약',
    summary: st.title,
    keywords: [s.level, `달빛사주 강약 점수 ${pct(s.score)}점`],
    paragraphs: [
      '신강·신약은 일간의 기운이 사주 전체에서 강한 편인지 약한 편인지를 뜻합니다. 일간과 같은 오행(비겁)과 일간을 생하는 오행(인성)이 많고 힘이 있으면 신강, 그렇지 않으면 신약으로 봐요. 판단할 때는 태어난 달의 지지가 일간을 돕는지(득령), 일지가 돕는지(득지), 나머지 글자 가운데 돕는 글자가 많은지(득세)를 살피며, 계절을 나타내는 월지의 비중이 가장 큽니다. 강약 자체에 좋고 나쁨은 없고, 강약에 따라 사주의 균형을 맞추는 방법이 달라져요.',
      status,
      `강약은 정도의 문제라 보편적인 점수 기준은 없습니다. 달빛사주는 일간을 돕는 기운의 비중을 0~100점으로 환산해 단계를 나누는데(서비스 자체 지표), 이 기준으로 ${pct(s.score)}점이라 '${s.level}'에 해당해요. 50점 부근이 균형(중화)에 가까운 상태입니다.`,
      st.description,
      st.advice,
    ],
    basis: `일간의 힘 ${s.level} · 득령 ${s.deukryeong ? 'O' : 'X'} · 득지 ${s.deukji ? 'O' : 'X'} · 득세 ${s.deukse ? 'O' : 'X'} · 비겁·인성 가중 비중 ${pct(s.score)}점(극신약 25 미만 · 신약 42 미만 · 중화 58 이하 · 신강 75 이하 · 극신강 그 이상)`,
  };
}

/** 달빛사주가 용신을 정한 이유 — 엔진(determineYongsin)의 분기와 같다 */
function yongsinReason(chart: SajuChart, name: string | null): string {
  const y = chart.yongsin;
  const subj = nameSubject(name, '은');
  if (y.method === '중화') return `${subj}일간의 강약이 균형에 가까워, 달빛사주 기준에 따라 비율이 가장 낮은 ${elWord(y.yongsin)}을 용신으로 정했어요.`;
  const g = groupOf(chart, y.yongsin);
  const WHY: Partial<Record<TenGodGroup, string>> =
    chart.strength.score > 58
      ? { 재성: '일간이 강하고 인성이 많아, 인성을 제어하는 재성', 관성: '일간이 강하고 비겁이 많아, 비겁을 다스리는 관성', 식상: '일간이 강해, 넘치는 기운을 밖으로 풀어 주는 식상' }
      : { 비겁: '일간이 약하고 재성이 많아, 일간과 같은 기운인 비겁', 인성: '일간이 약해, 일간을 생해 주는 인성' };
  return `${subj}${WHY[g] ?? g}의 ${elWord(y.yongsin)}을 용신으로 정했어요.`;
}

/**
 * 용신 — 본문은 분석서가 직접 쓴다. 용신을 '부족한 오행'이나 생활 습관의 이름처럼 소개하지 않고,
 * 정의 → 정하는 방법(여러 학파) → 달빛사주 계산 방식과 이 사주에서 그렇게 정한 이유 → 생활에서의 뜻 → 희신·기신 순서로.
 * 제목·요약·칩·목록(tips)·근거는 기본 풀이의 것을 그대로 쓴다.
 */
function yongsinDetailSection(base: ReadingSection, chart: SajuChart, name: string | null, once: Once): ReadingSection {
  const y = chart.yongsin;
  const need = ELEMENT_PLAIN[y.yongsin];
  once.first('term:희신');
  once.first('term:기신');
  return {
    ...base,
    paragraphs: [
      `${once.term('용신')}은 일간의 강약을 조절하는 억부, 계절의 춥고 더움을 조절하는 조후, 사주의 구조를 보는 격국 등 여러 방법으로 정하며, 학파와 해석자에 따라 결과가 달라질 수 있습니다. 달빛사주는 억부법을 중심으로 한 간이 계산으로 조후와 격국은 반영하지 않으며, 강약이 균형에 가까우면 가장 약한 오행을 용신으로 정해요. ${yongsinReason(chart, name)}`,
      `생활 속에서는 ${q(need.need, '이', '가')} 이 기운과 연결된다고 봐요. ${need.needMore}`,
      `${elWord(y.heesin)}은 용신을 생하여 돕는 희신, ${elWord(y.gisin)}은 용신을 극하는 기신에 해당합니다. 운에서 용신이나 희신이 들어오는 해와 달은 비교적 순조롭게 흐르기 쉽다고 봐요. 기신이 강하게 들어오는 시기라고 해서 반드시 나쁜 결과를 뜻하지는 않지만, 일정과 체력에 여유를 두는 것이 좋습니다.`,
      // '일상에서는 이런 것부터 해 보세요.'(목록 머리말)는 맨 뒤에 둔다
      base.paragraphs.at(-1)!,
    ],
  };
}

function tenGodDetailSection(chart: SajuChart): ReadingSection {
  const g = groupCount(chart);
  const present = (Object.entries(chart.tenGodCount) as [TenGod, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const top = present[0]?.[0] ?? dominantTenGod(chart);
  const max = present[0]?.[1] ?? 0;
  const tops = present.filter(([, n]) => n === max).map(([tg]) => tg);
  const maxG = Math.max(...GROUPS.map((k) => g[k]));
  const topGroups = GROUPS.filter((k) => g[k] === maxG);
  const others = chart.pillars.hour ? '일곱' : '다섯';
  const topLine =
    tops.length > 1
      ? `하나씩 보면 ${dots(tops, '이', '가')} 각각 ${max}개로 가장 많아요.`
      : topGroups.length === 1 && topGroups[0] === TEN_GOD_GROUP[top]
        ? `그중 ${TEN_GOD_GROUP[top]}에 속하는 ${top}${particle(top, '이', '가')} ${max}개로 가장 두드러져요.`
        : `무리로는 ${dots(topGroups, '이', '가')} 가장 많고, 하나씩 보면 ${top}${particle(top, '이', '가')} ${max}개로 가장 많아요.`;
  const tp = TEN_GOD_PLAIN[top];
  const paragraphs = [
    '십성은 일간을 기준으로 나머지 글자가 어떤 관계에 있는지를 열 가지로 나눈 것입니다. 오행의 생극에 따라 비겁(일간과 같은 오행)·식상(일간이 생하는 오행)·재성(일간이 극하는 오행)·관성(일간을 극하는 오행)·인성(일간을 생하는 오행)의 다섯 무리로 나뉘고, 각 무리는 일간과 음양이 같으면 비견·식신·편재·편관·편인, 다르면 겁재·상관·정재·정관·정인으로 다시 나뉘어요.',
    `일간을 뺀 ${others} 글자를 무리별로 세면 ${GROUPS.map((k) => `${k} ${g[k]}개`).join(', ')}예요. ${topLine}`,
    `${top}${particle(top, '은', '는')} ${tp.def}로, ${tp.meaning} ${tp.strong}`,
    ...present
      .filter(([tg]) => tg !== top)
      .slice(0, 3)
      .map(([tg, n]) => `${tg}(${TEN_GOD_GROUP[tg]}) ${n}개 — ${TEN_GOD_PLAIN[tg].def}로, ${TEN_GOD_PLAIN[tg].meaning}`),
  ];
  for (const group of GROUPS.filter((k) => g[k] >= 3)) paragraphs.push(`${group}${particle(group, '이', '가')} ${g[group]}개로 많아요. ${GROUP_PLAIN[group].many}`);
  for (const group of GROUPS.filter((k) => g[k] === 0)) paragraphs.push(`${group}${particle(group, '은', '는')} 원국에 없어요. ${GROUP_PLAIN[group].absent}`);
  return {
    key: 'tenGods',
    title: '십성으로 본 성향',
    summary: tops.length > 1 ? `${dots(tops, '이', '가')} 가장 많은 사주예요` : `${top}(${tp.gloss})${particle(top, '이', '가')} 가장 두드러져요`,
    paragraphs,
    basis: `십성(지지는 본기 기준) ${present.map(([tg, n]) => `${tg} ${n}`).join(' · ')} · ${GROUPS.map((k) => `${k} ${g[k]}`).join(' · ')}`,
  };
}

/** 무료 섹션(3개까지) 뒤에, 나머지 신살을 조금 더 자세히 */
function shinsalDetailSection(base: ReadingSection, chart: SajuChart): ReadingSection {
  const all = chart.shinsal.filter((s, i, arr) => arr.findIndex((x) => x.name === s.name) === i);
  const shownNames = new Set(base.paragraphs.map((p) => p.match(/\(([가-힣]+)\)$/)?.[1]).filter(Boolean));
  const rest = [...all].filter((s) => !shownNames.has(s.name)).sort((a, b) => SHINSAL_ORDER.indexOf(a.name) - SHINSAL_ORDER.indexOf(b.name)).slice(0, 4);
  if (!rest.length) return base;
  return {
    ...base,
    paragraphs: [...base.paragraphs, '이 밖에 원국에 있는 신살은 다음과 같아요. 신살은 보조적인 해석 요소이므로, 하나만으로 길흉을 판단하지는 않습니다.', ...rest.map((s) => `${SHINSAL_CONTENT[s.name].detail} (${s.name})`)],
  };
}

function relationsSection(chart: SajuChart, once: Once): ReadingSection {
  const rels = chart.relations;
  const title = '합·충 — 글자 사이의 관계';
  if (!rels.length) {
    return {
      key: 'relations',
      title,
      summary: '원국에 두드러진 합·충이 없어요',
      paragraphs: ['원국의 글자 사이에 두드러진 합(결합)이나 충(대립)이 없습니다. 글자끼리 크게 묶이거나 부딪히는 곳이 적어, 기질이 비교적 일관되게 드러나는 편으로 봐요. 변화의 계기는 주로 10년 단위의 대운과 해마다 바뀌는 세운에서 들어온다고 해석합니다.'],
      basis: '원국 합충 없음',
    };
  }
  const told = new Set<string>();
  const pillars = (ps: readonly (typeof POSITIONS)[number][]) => (ps.length === 2 ? `${POSITION_PLAIN[ps[0]!].pillar}와 ${POSITION_PLAIN[ps[1]!].pillar}` : ps.map((p) => POSITION_PLAIN[p].pillar).join('·'));
  /** 관계 이름 — 한 권에서 처음이면 정의를 붙인다 */
  const relName = (t: keyof typeof RELATION_PLAIN) => (once.first(`rel:${t}`) ? `${t}(${RELATION_PLAIN[t].def})` : t);
  // 같은 자리 짝끼리 묶어서 한 문단으로
  const groups = new Map<string, typeof rels>();
  for (const r of rels) {
    const k = r.positions.join('-');
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const paragraphs = [
    '글자끼리 결합하는 관계를 합, 대립하는 관계를 충이라고 하며, 이 밖에 형·파·해·원진처럼 긴장이 생기는 관계도 있어요. 어느 쪽이든 그 자체로 길흉이 정해지지는 않으며, 관계가 놓인 기둥을 보면 삶의 어느 영역에서 그 작용이 두드러지는지 알 수 있다고 봅니다.',
  ];
  for (const [, rs] of groups) {
    const ps = rs[0]!.positions;
    // 천간끼리·지지끼리 나눠, 같은 두 기둥의 관계는 기둥 이름을 한 번만 쓴다 — '연주와 일주의 지지가 육합을 이뤄 … 동시에 형과 파도 이뤄요.'
    const lines =
      ps.length > 2
        ? rs.map((r) => `${pillars(ps)}의 지지 셋이 ${relName(r.type)}${particle(r.type, '을', '를')} 이뤄${r.element ? ` ${elWord(r.element)}으로 모여요.` : '요.'}`)
        : (['stem', 'branch'] as const)
            .map((t) => rs.filter((r) => r.target === t))
            .filter((g) => g.length)
            .map(([r0, ...more], gi) => {
              const subject = gi === 0 ? `${pillars(ps)}의 ${r0!.target === 'stem' ? '천간이' : '지지가'}` : r0!.target === 'stem' ? '천간끼리는' : '지지끼리는';
              const pull = RELATION_PLAIN[r0!.type].kind === 'pull' && r0!.element && r0!.type !== '천간합';
              const first = `${subject} ${relName(r0!.type)}${particle(r0!.type, '을', '를')}`;
              if (!more.length) return `${first} 이뤄${pull ? ` ${elWord(r0!.element!)}으로 묶여요.` : '요.'}`;
              // 덧붙는 관계는 같은 문장 안에 — 기둥 이름이 든 문장이라 한 권에서 되풀이되지 않는다
              const names = more.map((r, k) => `${relName(r.type)}${k < more.length - 1 ? particle(r.type, '과', '와') : particle(r.type, '도', '도')}`);
              return `${first} ${pull ? `이뤄 ${elWord(r0!.element!)}으로 묶이는 한편,` : '이루는 동시에'} ${names.join(' ')} 이뤄요.`;
            });
    const areas = ps.map((p) => POSITION_PLAIN[p].short);
    const areaText = areas.length === 2 ? `${areas[0]}${particle(areas[0]!, '과', '와')} ${areas[1]}` : areas.join(', ');
    const meaning = [...new Set(rs.map((r) => RELATION_PLAIN[r.type].kind))].filter((k) => !told.has(k) && (told.add(k), true)).map((k) => RELATION_KIND_MEANING[k]);
    paragraphs.push([...new Set(lines)].join(' ') + ` ${areaText}에 관련된 자리예요.` + (meaning.length ? ` ${meaning.join(' ')}` : ''));
  }
  const pull = rels.filter((r) => RELATION_PLAIN[r.type].kind === 'pull').length;
  const push = rels.length - pull;
  return {
    key: 'relations',
    title,
    summary: push === 0 ? `결합하는 합이 ${pull}곳 있어요` : pull === 0 ? `긴장이 생기는 관계가 ${push}곳 있어요` : `합 ${pull}곳, 긴장 관계 ${push}곳이 있어요`,
    paragraphs,
    basis: rels.map((r) => r.label).join(', '),
  };
}

function stagesSection(chart: SajuChart, once: Once): ReadingSection {
  const rows = POSITIONS.map((pos) => chart.pillars[pos]).filter((p): p is NonNullable<typeof p> => p !== null);
  const seen = new Set<string>();
  once.first('term:12운성');
  const paragraphs = [
    '12운성은 일간의 기운이 각 지지에서 어떤 상태에 있는지를 열두 단계로 나타낸 것입니다. 기운이 생겨나 왕성해졌다가 쇠퇴하고 다시 시작되는 순환을 사람의 일생에 견주어 장생·목욕·관대·건록·제왕·쇠·병·사·묘·절·태·양이라고 불러요. 단계 이름 자체가 길흉을 뜻하지는 않으며, 보조적인 해석 지표로 봅니다.',
    ...rows.map((p) => {
      const pos = POSITION_PLAIN[p.position];
      const s = TWELVE_STAGE_CONTENT[p.branch.twelveStage];
      const where = `${pos.pillar}의 지지(${pos.short})`;
      if (seen.has(s.name)) return `${where}도 ${s.name} 단계로, 앞에서 본 성향이 이 영역에서도 나타난다고 봐요.`;
      seen.add(s.name);
      return `${where}는 ${s.name} 단계로, '${s.keyword}'${particle(s.keyword, '을', '를')} 뜻해요. ${s.meaning}`;
    }),
  ];
  const day = TWELVE_STAGE_CONTENT[chart.pillars.day.branch.twelveStage];
  return {
    key: 'stages',
    title: '12운성 — 자리별 일간의 상태',
    summary: `일지의 12운성은 ${day.name}('${day.keyword}')${particle(day.name, '이에요', '예요')}`,
    paragraphs,
    basis: `12운성(봉법, 일간 기준) ${rows.map((p) => `${{ year: '년', month: '월', day: '일', hour: '시' }[p.position]} ${p.branch.twelveStage}`).join(' · ')}`,
  };
}

// ---------------------------------------------------------------------------
// 대운 8개
// ---------------------------------------------------------------------------

const range = (p: DaeunPeriod) => `${p.startAge}~${p.endAge}세`;

function daeunSections(chart: SajuChart, now: Date, once: Once, name: string | null): ReadingSection[] {
  const year = kstYear(now);
  const periods = chart.daeun.periods.slice(0, 8);
  const current = periods.find((p) => year >= p.startYear && year <= p.endYear);
  const evs = periods.map((p) => evaluateFortune(chart, p));
  const forward = chart.daeun.direction === 'forward';
  const started = year - chart.solarDate.year >= chart.daeun.startAge;
  once.first('term:대운');
  const intro: ReadingSection = {
    key: 'daeun',
    title: '대운 — 10년 단위의 큰 흐름',
    summary: current ? `지금은 ${range(current)} ${current.ganzhi.hangul} 대운을 지나고 있어요` : `만 ${chart.daeun.startAge}세에 첫 대운이 시작돼요`,
    keywords: [`대운수 ${chart.daeun.startAge}`, forward ? '순행' : '역행', ...(current ? [`지금 ${current.stemTenGod} 대운`] : [])],
    paragraphs: [
      `대운은 10년 단위로 바뀌는 운의 큰 흐름입니다. 태어난 달의 기둥(월주)에서 출발해 육십갑자의 순서를 한 칸씩 앞으로(순행) 또는 뒤로(역행) 짚어 정하며, 방향은 성별과 태어난 해 천간의 음양에 따라 달라져요. ${nameSubject(name, '의')}대운은 ${forward ? '순행' : '역행'}합니다.`,
      `대운이 시작되는 나이(대운수)도 사람마다 다릅니다. 달빛사주는 ${forward ? '출생일부터 다음 절입일(절기가 바뀌는 날)까지' : '직전 절입일(절기가 바뀌는 날)부터 출생일까지'}의 날수를 3으로 나눠 계산하며, ${nameSubject(name, '의')}첫 대운은 만 ${chart.daeun.startAge}세에 시작${started ? '됐어요' : '돼요'}.`,
      '대운의 천간은 드러나는 사건과 기회, 지지는 생활 환경과 연결해 해석하는 경우가 많습니다. 아래 점수는 대운의 오행이 용신에 해당하는지, 원국과 합·충을 이루는지 등을 반영한 달빛사주 자체 지표예요. 점수가 낮은 시기라고 해서 반드시 나쁜 시기는 아니며, 속도를 조절하고 기반을 다지는 데 무게를 두면 좋은 시기로 봐요.',
      ...periods.map((p, i) => `${p === current ? '▶ ' : ''}${range(p)} (${p.startYear}~${p.endYear}년) · ${p.ganzhi.hangul} 대운 · ${p.stemTenGod}(${TEN_GOD_PLAIN_LABEL[p.stemTenGod]}) · ${GRADE_PLAIN_LABEL[evs[i]!.grade]} ${evs[i]!.scores.total}점`),
    ],
    basis: `대운수 ${chart.daeun.startAge}(정밀 ${chart.daeun.startExact.years}년 ${chart.daeun.startExact.months}개월) · ${forward ? '순행' : '역행'} · ${periods.map((p, i) => `${p.ganzhi.hangul}(${p.ganzhi.hanja}) ${p.stemTenGod}·${p.branchTenGod} ${GRADE_LABEL[evs[i]!.grade]}`).join(', ')}`,
  };
  const each = periods.map((p, i): ReadingSection => {
    const ev = evs[i]!;
    const fs = once.fit(ev.fit.stem, 'stem');
    const fb = once.fit(ev.fit.branch, 'branch');
    const c = LUCK_CONTENT.daeun[p.stemTenGod];
    const st = p.stemTenGod;
    const bt = p.branchTenGod;
    const paragraphs: string[] = [];
    const past = p.endYear < year;
    const child = p.endAge < 20;
    // 첫 문단: 대운의 천간·지지 십성 + 천간 십성의 대운 풀이(한 권에 한 번)
    const what = st === bt ? `천간과 지지에 모두 ${tgp(once, st, '이', '가')} 들어와요.` : `천간에 ${once.tg(st)}, 지지에 ${tgp(once, bt, '이', '가')} 들어와요.`;
    const general = !child && once.first(`daeun:${st}`) ? ` ${st}${ro(st)} 보면, ${c.general}` : '';
    paragraphs.push(`${past ? `${p.startYear}~${p.endYear}년은 이미 지나온 시기로, 돌아보며 읽으면 지금의 성향과 경험을 이해하는 데 참고가 돼요. ` : ''}${range(p)} 대운에는 ${what}${general}`);
    // 지지 십성의 대운 풀이 — 같은 문장이 두 번 나오지 않게
    if (!child && bt !== st && once.first(`daeun:${bt}`)) paragraphs.push(`지지의 ${bt}${ro(bt)} 보면, ${LUCK_CONTENT.daeun[bt].general}`);
    const fit = [fs.text, fb.text].filter(Boolean).join(' ');
    if (fit) paragraphs.push(fit);
    // 유년기의 대운은 돈·연애·직장 이야기 대신 학업·친구·집안 분위기로
    if (child) paragraphs.push(`유년기에는 대운의 기운이 학업 방식과 친구 관계, 집안 분위기로 나타나기 쉽다고 봐요. ${CHILD_HINT[st]}`);
    else paragraphs.push(`재물 — ${c.wealth}`, `애정·관계 — ${c.love}`, `일·커리어 — ${c.career}`, `건강 — ${c.health}`);
    if (once.first(`stage:${p.twelveStage}`)) paragraphs.push(`12운성으로 보면 ${p.twelveStage}, 곧 ${STAGE_SHORT[p.twelveStage]}에 해당해요.`);
    if (!child && !past) paragraphs.push(DAEUN_TIP[st]);
    const hl = once.highlights(ev.highlights, 2);
    paragraphs.push(...hl.text);
    return {
      key: `daeun-${i + 1}`,
      title: `${range(p)} · ${p.ganzhi.hangul} 대운`,
      summary: `${p.startYear}~${p.endYear}년 · ${st}(${TEN_GOD_PLAIN_LABEL[st]}) · ${GRADE_PLAIN_LABEL[ev.grade]}${p === current ? ' · 지금 지나는 대운' : ''}`,
      score: ev.scores.total,
      keywords: [...(st === bt ? [`천간·지지 ${st}`] : [`천간 ${st}`, `지지 ${bt}`]), ...(fs.tag ? [fs.tag] : [])],
      paragraphs,
      basis: `${p.ganzhi.hangul}(${p.ganzhi.hanja}) 대운 · 천간 ${st} · 지지 ${bt} · 12운성 ${p.twelveStage} · 천간 ${FIT_TERM[ev.fit.stem]} · 지지 ${FIT_TERM[ev.fit.branch]}${hl.terms.length ? ` · ${hl.terms.join(' · ')}` : ''}`,
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
    summary: `흐름이 좋은 달은 ${best.map(label).join('·')}이에요`,
    keywords: [...best.map((i) => `${label(i)} ${evals[i]!.scores.total}점`)],
    paragraphs: [
      `${once.term('월운')}은 달력의 1일이 아니라 절기가 바뀌는 절입일을 기준으로 나눕니다. 그래서 2월은 ${monthDay(months[0]!.startsAt)} 무렵(${months[0]!.termName}), 3월은 ${monthDay(months[1]!.startsAt)} 무렵(${months[1]!.termName})부터 시작해요. 점수는 그달의 간지가 사주와 맺는 관계(용신에 해당하는지, 원국과 합·충을 이루는지, 12운성 등)를 반영한 달빛사주 자체 지표로, 100점 만점입니다.`,
      months.map((_, i) => `${label(i)} ${evals[i]!.scores.total}점`).join(' · '),
      `새로운 일을 시작하거나 중요한 약속을 잡기에는 ${best.map(label).join(', ')}이 비교적 유리하고, ${careful.map(label).join(', ')}에는 일정과 컨디션에 여유를 두는 것이 좋다고 봐요.`,
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
    return {
      key: `month-${m.order}`,
      title: `${label(i)} · ${GRADE_PLAIN_LABEL[ev.grade]}`,
      summary: monthSummary(i),
      score: ev.scores.total,
      keywords: [`${monthDay(m.startsAt)}부터`, `${m.stemTenGod} · ${TEN_GOD_PLAIN_LABEL[m.stemTenGod]}`, ...(fs.tag ? [fs.tag] : [])],
      paragraphs: [
        `${label(i)}에는 천간에 ${tgp(once, m.stemTenGod, '이', '가')} 들어와요. ${c.general[v]}`,
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
      ...(current ? [{ label: '지금 시기', text: `${range(current)} 대운(10년 단위의 운) · ${current.stemTenGod}, ${TEN_GOD_PLAIN_LABEL[current.stemTenGod]}의 시기예요` }] : []),
      { label: `${target}년`, text: `${GRADE_PLAIN_LABEL[targetEv.grade]} — ${pick(FORTUNE_TEMPLATES.yearlyHeadline[targetEv.grade], `${target}-${chart.pillars.day.ganzhi.index}`)}` },
      ...(reading.keyPoints ?? []).filter((k) => k.label === '행운 포인트'),
    ],
    paragraphs: [
      `이 분석서는 ${name ? `${name}님의 ` : ''}사주(태어난 연·월·일·시를 여덟 글자로 나타낸 것)를 바탕으로, 타고난 성향과 10년·1년·한 달 단위로 바뀌는 운의 흐름을 차례로 정리했습니다.`,
      "명리학 용어는 처음 나올 때 뜻을 함께 적었어요. 각 장 끝의 '사주로 보면'을 펼치면 해석의 근거가 된 글자와 관계를 확인할 수 있습니다. 점수와 등급은 이해를 돕기 위한 달빛사주 자체 지표예요.",
    ],
    basis: get('overview').basis,
  };
  const closing: ReadingSection = {
    key: 'closing',
    title: '나에게 맞는 생활 방식',
    summary: '일간의 강약에 맞춘 생활 방법을 정리했어요',
    keywords: [`행운의 색 ${LUCKY_COLOR_PLAIN[y.yongsin]}`, `행운의 방향 ${info.direction}`, `행운의 숫자 ${info.numbers.join('·')}`],
    paragraphs: [
      `${nameSubject(name, '은')}${REPORT_MISC.closingByStrength[chart.strength.level]}`,
      `생활에서 기억해 두면 좋은 점이 있어요. ${dm.advice}`,
      `오행마다 대응하는 색·방향·숫자가 있어, 용신에 해당하는 것을 생활에 활용하기도 합니다. ${elWord(y.yongsin)}의 경우 색은 ${LUCKY_COLOR_PLAIN[y.yongsin]}, 방향은 ${info.direction}, 숫자는 ${info.numbers.join('·')}입니다. 생활 속에서는 ${YONGSIN_CONTENT[y.yongsin].tips.slice(4, 6).join(', ')} 같은 방법도 활용해 보세요.`,
      '사주는 앞날을 정해 두는 것이 아니라, 타고난 성향과 시기별 흐름을 살펴보는 참고 자료입니다. 강점을 살릴 시기와 속도를 조절할 시기를 판단할 때 이 분석서를 다시 참고해 보세요.',
    ],
    basis: `일간 ${dm.name} · 일간의 힘 ${chart.strength.level} · 용신 ${EL_NAME[y.yongsin]}`,
  };

  // 섹션을 화면 순서대로 만든다 — 용어의 뜻은 처음 나오는 곳에 붙는다(once)
  const personality = personalitySection(get('personality'), chart);
  const chartSec = chartSection(chart, name, once);
  const elements = elementRatioSection(chart, name, once);
  const strength = strengthSection(chart, name);
  const yongsin = yongsinDetailSection(get('yongsin'), chart, name, once);
  const tenGods = tenGodDetailSection(chart);
  const shinsal = shinsalDetailSection(get('shinsal'), chart);
  const relations = relationsSection(chart, once);
  const stages = stagesSection(chart, once);
  const daeun = daeunSections(chart, now, once, name);
  return [
    overview,
    personality,
    chartSec,
    elements,
    strength,
    yongsin,
    tenGods,
    shinsal,
    relations,
    stages,
    get('wealth'),
    get('love'),
    get('career'),
    get('health'),
    ...daeun,
    yearBriefSection(chart, thisYear, name, once),
    yearBriefSection(chart, thisYear + 1, name, once),
    ...monthSections(chart, target, once),
    closing,
  ];
}

// ---------------------------------------------------------------------------
// 신년운세 리포트
// ---------------------------------------------------------------------------

/** 영역별 '좋은 달·조심할 달' 한 줄 — 네 영역이 같은 문장 틀을 되풀이하지 않게 */
const AREA_MONTH_LINE: Record<'wealth' | 'love' | 'career' | 'health', (best: string, low: string) => string> = {
  wealth: (b, l) => `재물 점수가 가장 높은 달은 ${b}, 가장 낮은 달은 ${l}${ieyo(l)}. 큰 지출이나 투자 결정은 ${l}을 피해 잡는 것이 좋습니다.`,
  love: (b, l) => `관계의 흐름이 가장 좋은 달은 ${b}이고, ${l}에는 대화의 속도를 늦추는 것이 좋아요.`,
  career: (b, l) => `일의 성과가 드러나기 쉬운 달은 ${b}, 무리한 확장을 피할 달은 ${l}${ieyo(l)}.`,
  health: (b, l) => `컨디션이 가장 안정되기 쉬운 달은 ${b}이고, ${l}에는 휴식을 넉넉히 잡아 두세요.`,
};

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
  // 유년기(스무 살 전)의 대운은 재물·연애·직장 풀이 대신 학업·친구·집안 분위기로 읽는다
  const childDaeun = Boolean(daeun && daeun.endAge < 20);
  const once = reportOnce();
  const y = chart.yongsin;
  const months = wolun(chart.dayMaster.index, year);
  const mev = months.map((m) => evaluateFortune(chart, m, `${seed}-m${m.order}`));
  const mLabel = (i: number) => (i === 11 ? `${year + 1}년 1월` : `${i + 2}월`);
  const rankBy = (k: 'total' | 'wealth' | 'love' | 'career' | 'health') => mev.map((e, i) => ({ i, s: e.scores[k] })).sort((a, b) => b.s - a.s);
  const best = rankBy('total').slice(0, 3).map((r) => r.i).sort((a, b) => a - b);
  const low = rankBy('total').slice(-2).map((r) => r.i).sort((a, b) => a - b);
  const info = ELEMENT_INFO[y.yongsin];
  const AREA_NAME = { wealth: '재물', love: '애정', career: '일', health: '건강' } as const;

  // 총운 — 세운의 천간·지지 십성, 용신·희신·기신의 뜻(처음 한 번), 운의 오행이 무엇에 해당하는지
  // '천간 정은 상관(…)에, 지지 미는 정재(…)에 해당하는 해예요' — 세운의 글자가 일간에게 어떤 십성인지
  const gz = ev.pillar.ganzhi.hangul;
  const [gs, gb] = [gz.slice(0, 1), gz.slice(1, 2)];
  const opening =
    btg !== stg
      ? `${once.term('세운')}의 천간 ${gs}${particle(gs, '은', '는')} ${nameSubject(name, '의')}일간에게 ${tgp(once, stg, '에', '에')}, 지지 ${gb}${particle(gb, '은', '는')} ${tgp(once, btg, '에', '에')} 해당하는 해예요.`
      : `${once.term('세운')}의 천간 ${gs}${particle(gs, '과', '와')} 지지 ${gb}${particle(gb, '이', '가')} ${nameSubject(name, '의')}일간에게 모두 ${tgp(once, stg, '에', '에')} 해당하는 해예요.`;
  const defs = `달빛사주 기준으로 ${nameSubject(name, '의')}${once.term('용신')}은 ${elWord(y.yongsin)}, ${once.term('희신')}은 ${elWord(y.heesin)}, ${once.term('기신')}은 ${elWord(y.gisin)}이에요.`;
  const totalFit = [once.fit(ev.fit.stem, 'stem').text, once.fit(ev.fit.branch, 'branch').text].filter(Boolean).join(' ');
  const hl = once.highlights(ev.highlights, 3);

  const area = (key: 'wealth' | 'love' | 'career' | 'health', title: string): ReadingSection => {
    const r = rankBy(key);
    return {
      key,
      title,
      score: ev.scores[key],
      summary: YEAR_AREA_SUMMARY[key][band(ev.scores[key])],
      paragraphs: [
        `천간의 ${stg}${ro(stg)} 보면 — ${tg.inLuck[key]}`,
        btg !== stg ? `지지의 ${btg}${ro(btg)} 보면 — ${bt.inLuck[key]}` : '',
        daeun && !childDaeun ? `${daeun.ganzhi.hangul} 대운으로 보면 — ${LUCK_CONTENT.daeun[daeun.stemTenGod][key]}` : '',
        AREA_MONTH_LINE[key](mLabel(r[0]!.i), mLabel(r[r.length - 1]!.i)),
      ].filter(Boolean),
      basis: `천간 ${stg} · 지지 ${btg}${daeun ? ` · ${daeun.ganzhi.hangul} 대운 ${daeun.stemTenGod}` : ''} · ${AREA_NAME[key]} 점수 ${ev.scores[key]}(달빛사주 기준)`,
    };
  };

  return [
    {
      key: 'total',
      title: `${year}년 한눈에 보기`,
      score: ev.scores.total,
      summary: pick(FORTUNE_TEMPLATES.yearlyHeadline[ev.grade], seed),
      keywords: [`${stg} · ${TEN_GOD_PLAIN_LABEL[stg]}`, GRADE_PLAIN_LABEL[ev.grade], `${ev.scores.total}점`],
      points: [
        { label: '올해의 흐름', text: `${GRADE_PLAIN_LABEL[ev.grade]} (${ev.scores.total}점, 달빛사주 기준)` },
        { label: '흐름이 좋은 달', text: best.map(mLabel).join(', ') },
        { label: '속도를 조절할 달', text: low.map(mLabel).join(', ') },
        { label: '나에게 필요한 것', text: ELEMENT_PLAIN[y.yongsin].need },
        { label: '행운 포인트', text: `색 ${LUCKY_COLOR_PLAIN[y.yongsin]} · 방향 ${info.direction} · 숫자 ${info.numbers.join('·')}` },
      ],
      paragraphs: [
        `${year}년은 ${gz}년으로, ${opening}`,
        // 십성 운 문구 첫머리의 '상관운에는 '은 떼고, 천간·지지 어느 쪽 이야기인지 앞에 밝힌다
        `천간의 ${stg}${ro(stg)} 보면, ${luckOpening(tg.inLuck.general, '')}`,
        btg !== stg ? `지지의 ${btg}${ro(btg)} 보면, ${luckOpening(bt.inLuck.general, '')}` : '',
        `${defs} ${totalFit}`,
        `${once.term('12운성')}으로 보면 올해의 지지에서 일간은 ${stage.name} 단계로, '${stage.keyword}'${particle(stage.keyword, '을', '를')} 뜻해요. ${stage.meaning}`,
        ...hl.text,
      ].filter(Boolean),
      basis: `${ev.pillar.ganzhi.hangul}(${ev.pillar.ganzhi.hanja})년 · 천간 ${stg} · 지지 ${btg} · 12운성 ${ev.pillar.twelveStage} · ${GRADE_LABEL[ev.grade]} · 천간 ${FIT_TERM[ev.fit.stem]} · 지지 ${FIT_TERM[ev.fit.branch]}${hl.terms.length ? ` · ${hl.terms.join(' · ')}` : ''}`,
    },
    {
      key: 'daeunContext',
      title: '올해가 속한 대운',
      summary: daeun ? `${range(daeun)} ${daeun.ganzhi.hangul} 대운 안의 한 해예요` : '첫 대운이 시작되기 전의 한 해예요',
      paragraphs: daeun
        ? [
            `${year}년은 ${range(daeun)}(${daeun.startYear}~${daeun.endYear}년) ${daeun.ganzhi.hangul} ${once.term('대운')} 안에 있습니다. 한 해의 운은 대운의 흐름 위에서 함께 해석해요.`,
            childDaeun
              ? `이 대운의 천간은 ${once.tg(daeun.stemTenGod)}${ieyo(daeun.stemTenGod)}. 유년기의 대운은 학업 방식과 친구 관계, 집안 분위기로 나타나기 쉽다고 봐요.`
              : `이 대운의 천간은 ${once.tg(daeun.stemTenGod)}${ieyo(daeun.stemTenGod)}. ${daeun.stemTenGod}${ro(daeun.stemTenGod)} 보면, ${LUCK_CONTENT.daeun[daeun.stemTenGod].general}`,
          ]
        : [`아직 첫 ${once.term('대운')}이 시작되기 전이에요. 대운이 시작되기 전에는 타고난 원국과 그해의 세운을 중심으로 해석하며, 그만큼 한 해의 흐름이 비교적 직접 드러난다고 봐요.`],
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

const CATEGORY_LABEL = { personality: '성격 궁합', romance: '연애·끌림', stability: '생활·안정', complement: '오행 보완' } as const;

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
  /** 앞 장(일간·오행)에서 이미 풀이한 요인은 끌림·조율 장에서 다시 쓰지 않는다 */
  const shown = (f: CompatibilityFactor) => f.key.startsWith('stem_') || f.category === 'complement';
  const posRest = pos.filter((f) => !shown(f));
  const negRest = [...neg, ...neutral].filter((f) => !shown(f));
  /** 가장 많은 십성 무리 — 같은 수면 모두 */
  const topGroups = (c: SajuChart) => {
    const g = groupCount(c);
    const max = Math.max(...GROUPS.map((k) => g[k]));
    return GROUPS.filter((k) => g[k] === max);
  };
  const gas = topGroups(a);
  const gbs = topGroups(b);
  const ga = gas[0]!;
  const gb = gbs[0]!;
  const daeunNow = (c: SajuChart) => c.daeun.periods.find((p) => thisYear >= p.startYear && thisYear <= p.endYear);
  const da = daeunNow(a);
  const db = daeunNow(b);
  const once = new Set<CompatFactorKey>();
  const terms = reportOnce();
  // 다가오는 해(10월부터는 내년)의 달마다 두 사람 점수 — 각자의 신년운세와 같은 계산
  const target = targetFortuneYear(now);
  const monthScores = (c: SajuChart) => {
    const seed = `${target}-${c.birthUtc}`;
    return wolun(c.dayMaster.index, target).map((m, i) => ({ label: i === 11 ? `${target + 1}년 1월` : `${i + 2}월`, score: evaluateFortune(c, m, `${seed}-m${m.order}`).scores.total }));
  };
  const monthsA = monthScores(a);
  const monthsB = monthScores(b);
  // 두 사람 모두 좋은 달 = 둘 중 낮은 점수가 높은 달, 두 사람 모두 낮은 달 = 둘 중 높은 점수도 낮은 달
  const goodTogether = monthsA
    .map((m, i) => ({ i, v: Math.min(m.score, monthsB[i]!.score) }))
    .sort((x, y) => y.v - x.v)
    .slice(0, 2)
    .map((x) => x.i)
    .sort((x, y) => x - y);
  const lowTogether = monthsA.map((m, i) => ({ i, v: Math.max(m.score, monthsB[i]!.score) })).sort((x, y) => x.v - y.v)[0]!.i;
  /** 관계 이름 — 처음이면 정의를 붙인다 */
  const relName = (t: keyof typeof RELATION_PLAIN) => (terms.first(`rel:${t}`) ? `${t}(${RELATION_PLAIN[t].def})` : t);

  /** 궁합 요인 하나 — 두 사람 이름으로 쓴 첫 문장 + (그 종류를 처음 볼 때만) 해석과 해 볼 일 */
  const factorLead = (f: CompatibilityFactor): string => {
    const k = f.key;
    const za = a.zodiac.animal;
    const zb = b.zodiac.animal;
    const elOf = (key: string) => el(key.slice(key.lastIndexOf('_') + 1) as Element);
    if (k === 'stem_combine') return fill(`{A:과/와} {B:의} 일간은 ${relName('천간합')}을 이뤄요.`);
    if (k === 'stem_clash') return fill(`{A:과/와} {B:의} 일간은 ${relName('천간충')}을 이뤄요.`);
    if (k === 'stem_same') return fill('{A:과/와} {B:은/는} 일간의 오행이 같아요.');
    if (k === 'stem_generate') return rel === 1 ? fill('{A:의} 일간이 {B:의} 일간을 생하는 상생 관계예요.') : fill('{B:의} 일간이 {A:의} 일간을 생하는 상생 관계예요.');
    if (k === 'stem_control') return rel === 2 ? fill('{A:의} 일간이 {B:의} 일간을 극하는 상극 관계예요.') : fill('{B:의} 일간이 {A:의} 일간을 극하는 상극 관계예요.');
    if (k === 'day_branch_combine') return `두 사람의 일지가 ${relName('육합')}을 이뤄요.`;
    if (k === 'day_branch_half') return `두 사람의 일지가 ${relName('반합')}을 이뤄요.`;
    if (k === 'day_branch_clash') return `두 사람의 일지가 ${relName('충')}을 이뤄요.`;
    if (k === 'day_branch_punish') return `두 사람의 일지가 ${relName('형')}을 이뤄요.`;
    if (k === 'day_branch_harm') return `두 사람의 일지가 해(서로 방해하는 관계) 또는 파(결합을 깨뜨리는 관계)에 해당해요.`;
    if (k === 'day_branch_wonjin') return `두 사람의 일지가 ${relName('원진')}에 해당해요.`;
    if (k === 'zodiac_combine') return `${za}띠와 ${zb}띠는 ${relName('육합')} 관계예요.`;
    if (k === 'zodiac_trine') return `${za}띠와 ${zb}띠는 같은 삼합에 속해요.`;
    if (k === 'zodiac_clash') return `${za}띠와 ${zb}띠는 ${relName('충')} 관계예요.`;
    if (k === 'zodiac_wonjin') return `${za}띠와 ${zb}띠는 ${relName('원진')} 관계예요.`;
    if (k.startsWith('complement_a_')) return `${who(A, '의')} 원국에 없는 ${elOf(k)} 기운이 ${who(B, '의')} 사주에는 2개 이상 있어요.`;
    if (k.startsWith('complement_b_')) return `${who(B, '의')} 원국에 없는 ${elOf(k)} 기운이 ${who(A, '의')} 사주에는 2개 이상 있어요.`;
    if (k === 'yongsin_a') return `${who(B, '의')} 사주에서 가장 강한 ${elWord(b.elements.dominant)}이 ${who(A, '의')} 용신에 해당해요.`;
    if (k === 'yongsin_b') return `${who(A, '의')} 사주에서 가장 강한 ${elWord(a.elements.dominant)}이 ${who(B, '의')} 용신에 해당해요.`;
    if (k === 'gisin_a') return `${who(B, '의')} 사주에서 가장 강한 ${elWord(b.elements.dominant)}이 ${who(A, '에게는')} ${terms.term('기신')}에 해당해요.`;
    if (k === 'gisin_b') return `${who(A, '의')} 사주에서 가장 강한 ${elWord(a.elements.dominant)}이 ${who(B, '에게는')} ${terms.term('기신')}에 해당해요.`;
    const spouseTg = f.label.match(/\(([가-힣]+)\)/)?.[1] ?? '배우자성';
    if (k === 'spouse_star_a') return `${who(B, '의')} 일간은 ${who(A, '의')} 사주에서 배우자성에 해당하는 ${spouseTg}${ieyo(spouseTg)}.`;
    if (k === 'spouse_star_b') return `${who(A, '의')} 일간은 ${who(B, '의')} 사주에서 배우자성에 해당하는 ${spouseTg}${ieyo(spouseTg)}.`;
    return f.label;
  };
  /** '한눈에 보기'·요약용 짧은 말 — 본문 첫 문장과 겹치지 않게 */
  const factorShort = (f: CompatibilityFactor): string => {
    const SHORT: Partial<Record<CompatFactorKey, string>> = {
      stem_combine: '타고난 성향끼리 자연스럽게 끌려요',
      stem_clash: '같은 일도 정반대로 반응할 때가 많아요',
      stem_same: '가치관과 사고방식이 닮았어요',
      stem_generate: '한쪽이 다른 쪽에게 힘이 되어 줘요',
      stem_control: '한쪽이 이끌고 한쪽이 맞추기 쉬워요',
      day_branch_combine: '함께 지낼수록 편안해지기 쉬워요',
      day_branch_half: '같은 목표 앞에서 협력이 잘 돼요',
      day_branch_clash: '생활 방식이 달라 조율이 필요해요',
      day_branch_punish: '사소한 지적이 다툼이 되기 쉬워요',
      day_branch_harm: '말하지 않은 서운함이 쌓이기 쉬워요',
      day_branch_wonjin: '가까울수록 서운함을 느끼기 쉬워요',
      zodiac_combine: '띠끼리 잘 어울려요',
      zodiac_trine: '띠끼리 호흡이 잘 맞아요',
      zodiac_clash: '일하는 속도가 서로 다를 수 있어요',
      zodiac_wonjin: '같은 말도 다르게 받아들이기 쉬워요',
      complement: '서로에게 없는 오행을 보완해 줘요',
      yongsin: '상대의 기운이 사주의 균형을 보완해 줘요',
      gisin: '함께 있으면 부담을 느끼는 순간이 있어요',
      spouse_star: '서로를 오래 함께할 사람으로 느끼기 쉬워요',
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
  const stemA = stemName(a);
  const stemB = stemName(b);
  const groupLine = (gs: TenGodGroup[]) => `${gs.map((g) => `${g}(${GROUP_PLAIN[g].def})`).join('과 ')}${particle(gs[gs.length - 1]!, '이', '가')}`;
  /** 대운 한 줄 — 대운의 뜻은 처음 한 번만 */
  const daeunLine = (label: string, d: DaeunPeriod, same: boolean) =>
    same
      ? `${who(label, '도')} 지금 ${range(d)}(${d.startYear}~${d.endYear}년) ${d.ganzhi.hangul} ${terms.term('대운')}으로, 대운의 천간이 같은 ${d.stemTenGod}${ieyo(d.stemTenGod)}. 두 사람이 비슷한 성격의 시기를 함께 지나는 셈이에요.`
      : `${who(label, '은/는')} 지금 ${range(d)}(${d.startYear}~${d.endYear}년) ${d.ganzhi.hangul} ${terms.term('대운')}을 지나고 있으며, 대운의 천간은 ${terms.tg(d.stemTenGod)}${ieyo(d.stemTenGod)}. ${LUCK_CONTENT.daeun[d.stemTenGod].love}`;

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
        `${who(A, '과/와')} ${who(B, '의')} 궁합 점수는 100점 만점에 ${r.score}점, ${q(COMPAT_GRADE_LABEL[r.grade], '이에요', '예요')}. 일간(태어난 날의 천간)의 관계, 일지(태어난 날의 지지로, 배우자 자리)의 합·충, 띠, 오행의 보완 관계 등을 종합해 계산한 달빛사주 자체 지표입니다.`,
        `잘 맞는 요인 ${pos.length}가지, 조율이 필요한 요인 ${neg.length}가지가 보여요. 점수보다 각 요인의 내용을 함께 읽어 보는 것이 관계를 이해하는 데 더 도움이 됩니다.`,
      ],
      basis: `${A} 일간 ${dmA.name}·일지 ${a.pillars.day.branch.hanja} · ${B} 일간 ${dmB.name}·일지 ${b.pillars.day.branch.hanja} · 영역 점수 ${(Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).map((k) => `${CATEGORY_LABEL[k]} ${r.categories[k]}`).join(' · ')}`,
    },
    {
      key: 'persons',
      title: '두 사람의 타고난 기질',
      summary: sameStem ? '일간이 같아 서로를 쉽게 이해하는 사이예요' : '성향이 서로 달라 상대에게 없는 점을 보완해 주는 사이예요',
      paragraphs: [
        `먼저 ${A === '나' ? '내' : who(A, '의')} 타고난 성향이에요. ${STEM_PLAIN[a.dayMaster.index]!.line}`,
        dpA.personality,
        sameStem ? `${who(B, '도')} 같은 일간을 타고나, 서로를 설명 없이도 잘 이해하는 편이에요.` : `${who(B, '의')} 타고난 성향도 살펴볼게요. ${STEM_PLAIN[b.dayMaster.index]!.line}`,
        ...(samePillar ? [] : [dpB.personality]),
        sameStem
          ? `두 사람 모두 강점은 ${strengthsOf(dmA).join(', ')}${ieyo(strengthsOf(dmA).at(-1)!)}. 같은 강점을 가진 만큼, 일을 나눌 때는 앞에서 이끄는 역할과 뒤에서 챙기는 역할을 번갈아 맡아 보세요.`
          : `${who(A, '의')} 강점은 ${strengthsOf(dmA).join(', ')}이고, ${who(B, '의')} 강점은 ${strengthsOf(dmB).join(', ')}${ieyo(strengthsOf(dmB).at(-1)!)}. 강점이 다를수록 역할을 나누기 쉬워요.`,
      ],
      basis: `${A} ${a.pillars.day.ganzhi.hangul}(${a.pillars.day.ganzhi.hanja})일주 · ${B} ${b.pillars.day.ganzhi.hangul}(${b.pillars.day.ganzhi.hanja})일주`,
    },
    {
      key: 'stemRelation',
      title: '일간의 관계',
      summary: stemFactors.some((f) => f.key === 'stem_combine')
        ? '두 사람의 일간이 천간합을 이루는 사이예요'
        : stemFactors.some((f) => f.key === 'stem_clash')
          ? '두 사람의 일간이 천간충을 이루는 사이예요'
          : (['일간의 오행이 같은 사이예요', '일간끼리 상생하는 사이예요', '일간끼리 상극하는 사이예요', '일간끼리 상극하는 사이예요', '일간끼리 상생하는 사이예요'] as const)[rel]!,
      paragraphs: [
        `${who(A, '의')} 일간은 ${stemA}, ${who(B, '의')} 일간은 ${stemB}${ieyo(stemB)}.${stemFactors.some((f) => f.key === 'stem_combine') ? '' : ` ${fill(REPORT_MISC.compatStemRelation[relKey])}`}`,
        // 상생·상극·같은 오행은 바로 앞 문단(compatStemRelation)과 같은 이야기라 한 번만 쓴다
        ...stemFactors.filter((f) => !['stem_generate', 'stem_control', 'stem_same'].includes(f.key)).map(factorText),
      ],
      basis: `일간 ${dmA.name} · ${dmB.name} (${['비화', '상생', '상극', '상극', '상생'][rel]})${stemFactors.length ? ` · ${stemFactors.map(factorTerm).join(' · ')}` : ''}`,
    },
    {
      key: 'balance',
      title: '오행으로 본 균형',
      summary: balanceFactors.some((f) => f.tone === 'positive') ? '서로에게 필요한 오행을 보완해 주는 사이예요' : '각자의 기운을 존중하며 맞춰 가는 사이예요',
      paragraphs: [
        `오행 개수(글자를 단순히 센 값)로 보면 ${who(A, '은/는')} ${countList(a)}이고, ${who(B, '은/는')} ${countList(b)}예요.${balanceFactors.some((f) => /^(yongsin|gisin)_/.test(f.key)) ? ' 아래에서 말하는 각자의 가장 강한 기운은 지장간과 계절의 영향까지 반영한 달빛사주 가중 비율 기준이에요.' : ''}`,
        yongA === yongB
          ? `달빛사주 기준으로 두 사람 모두 ${terms.term('용신')}이 ${elWord(yongA)}이며, '${ELEMENT_PLAIN[yongA].need}'에 해당해요.`
          : `달빛사주 기준으로 ${who(A, '의')} ${terms.term('용신')}은 ${elWord(yongA)}('${ELEMENT_PLAIN[yongA].need}'), ${who(B, '의')} 용신은 ${elWord(yongB)}('${ELEMENT_PLAIN[yongB].need}')이에요.`,
        ...(balanceFactors.length
          ? balanceFactors.map(factorText)
          : ['두 사람의 오행이 서로를 크게 보완하거나 부담을 주지 않아, 각자의 방식을 지키며 함께하기 좋아요.']),
      ],
      basis: `오행 개수 ${A} ${ELEMENTS.map((x) => `${EL_NAME[x].slice(0, 1)}${a.elements.count[x]}`).join(' ')} · ${B} ${ELEMENTS.map((x) => `${EL_NAME[x].slice(0, 1)}${b.elements.count[x]}`).join(' ')} · 용신 ${EL_NAME[yongA]} · ${EL_NAME[yongB]}`,
    },
    {
      key: 'strengths',
      title: '서로 끌리는 이유',
      summary: pos.length ? `잘 맞는 요인이 ${pos.length}가지 있어요` : '시간이 지날수록 깊어지는 인연이에요',
      score: r.categories.romance,
      paragraphs: [
        ...(posRest.length
          ? posRest.map(factorText)
          : pos.length
            ? ['앞에서 본 일간의 관계와 오행의 보완이 두 사람을 이어 주는 가장 큰 요인이에요.']
            : ['눈에 띄는 끌림의 요인은 적지만, 시간이 지날수록 깊어지기 쉬운 관계로 봐요. 함께 보낸 시간이 신뢰로 쌓이는 사이예요.']),
        ROMANCE_KEEP[band(r.categories.romance)],
      ],
      basis: pos.map(factorTerm).join(' · ') || '긍정 요인 없음',
    },
    {
      key: 'cautions',
      title: '함께 맞춰 갈 점',
      summary: neg.length ? `조율이 필요한 요인이 ${neg.length}가지 있어요` : '크게 부딪히는 요인이 적어요',
      score: r.categories.stability,
      paragraphs: [
        ...(negRest.length
          ? negRest.map(factorText)
          : neg.length
            ? ['앞에서 본 일간과 오행의 차이 외에는 크게 부딪히는 요인이 적어요. 앞의 조언을 기억해 두면 충분합니다.']
            : ['부딪히는 요인이 적어 편안한 관계를 만들기 좋아요. 다만 편안함이 무관심으로 이어지지 않도록 표현은 아끼지 마세요.']),
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
      summary: ga === gb ? `두 사람 모두 ${ga}${particle(ga, '이', '가')} 많아 표현 방식이 닮았어요` : '서로 다른 방식으로 마음을 전해요',
      paragraphs: [
        `일간을 기준으로 다른 글자와의 관계를 나눈 십성으로 보면, ${who(A, '은/는')} ${groupLine(gas)} 가장 많아요. ${REPORT_MISC.compatCommunication[ga]}`,
        ga === gb
          ? `${who(B, '도')} ${ga}${particle(ga, '이', '가')} 가장 많아, 마음을 전하는 방식이 닮은 편이에요.`
          : `${who(B, '은/는')} ${groupLine(gbs)} 가장 많아요. ${REPORT_MISC.compatCommunication[gb]}`,
        ga === gb
          ? '같은 방식으로 마음을 표현하니 오해는 적지만, 두 사람이 같은 지점에서 지치기 쉬워요. 가끔은 상대가 잘 쓰지 않는 방식으로 먼저 다가가 보세요.'
          : '표현 방식이 다르면 서로에게 없는 표현을 배울 수 있어요. 상대의 방식이 마음에 들지 않을 때는 고치라고 하기보다 왜 그렇게 하는지 먼저 물어보세요.',
      ],
      basis: `가장 많은 십성 무리 ${A} ${gas.join('·')} · ${B} ${gbs.join('·')}`,
    },
    {
      key: 'conflict',
      title: '다툼이 생길 때',
      summary: a.strength.level === b.strength.level ? `두 사람 모두 ${a.strength.level}에 해당해요` : `${a.strength.level}${particle(a.strength.level, '과', '와')} ${b.strength.level}의 만남이에요`,
      paragraphs: [
        `달빛사주 기준으로 일간의 강약(신강·신약)을 보면 ${who(A, '은/는')} ${a.strength.level}에 해당해요. ${REPORT_MISC.compatConflict[a.strength.level]}`,
        a.strength.level === b.strength.level ? `${who(B, '도')} 같은 단계라, 다툴 때 비슷한 방식으로 반응하기 쉬워요.` : `${who(B, '은/는')} ${b.strength.level}에 해당해요. ${REPORT_MISC.compatConflict[b.strength.level]}`,
        '다툼이 길어질 때는 누가 옳은지보다 두 사람이 원하는 것이 무엇인지로 질문을 바꿔 보세요. 감정이 가라앉을 시간을 정해 두고 다시 이야기하는 것도 좋은 방법입니다.',
      ],
      basis: `일간의 힘 ${A} ${a.strength.level}(${pct(a.strength.score)}) · ${B} ${b.strength.level}(${pct(b.strength.score)})`,
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
        ...(sameStem ? [`${who(B, '도')} 연애하는 방식이 비슷한 편이에요. 그래서 서로의 서운함이 어디서 오는지 빨리 알아차릴 수 있어요.`] : []),
      ],
      basis: `${A} ${dmA.name} · ${B} ${dmB.name}`,
    },
    {
      key: 'manual',
      title: '서로를 대하는 방법',
      summary: '상대가 힘을 얻는 순간과 조심할 지점',
      paragraphs: [
        `${who(A, '은/는')} ${list(dmA.strengths.slice(2, 4), '을', '를')} 알아봐 줄 때 힘을 얻는 편이에요. 때로는 이런 모습이 보이기도 해요. ${weakOf(dmA)}. 그럴 때는 너그럽게 받아 주면 좋습니다.`,
        `${who(A, '에게')} 건네면 좋은 말 — ${dmA.advice}`,
        sameStem
          ? `${who(B, '도')} 같은 강점에서 힘을 얻으니, 서로의 노력을 먼저 알아봐 주세요.`
          : `${who(B, '은/는')} ${list(dmB.strengths.slice(2, 4), '을', '를')} 알아봐 줄 때 힘을 얻는 편이에요. 이런 모습이 보일 때도 있어요. ${weakOf(dmB)}. 그럴 때는 조금 더 기다려 주는 것이 좋습니다.`,
        ...(sameStem ? [] : [`${who(B, '에게')} 건네면 좋은 말 — ${dmB.advice}`]),
      ],
      basis: `${A} ${dmA.name} · ${B} ${dmB.name}`,
    },
    {
      key: 'together',
      title: '함께하면 좋은 것',
      summary: yongA === yongB ? `두 사람 모두 ${elWord(yongA)}을 보완하면 좋아요` : `${el(yongA)}${particle(el(yongA), '과', '와')} ${el(yongB)} 기운을 함께 보완해요`,
      paragraphs: [
        yongA === yongB
          ? `두 사람 모두 ${q(ELEMENT_PLAIN[yongA].need, '이', '가')} 도움이 된다고 봐요. 용신이 같아 아래 활동을 함께하면 두 사람 모두에게 도움이 됩니다. 한 달에 한두 번은 함께하는 습관으로 만들어 보세요.`
          : `${who(A, '에게는')} '${ELEMENT_PLAIN[yongA].need}', ${who(B, '에게는')} ${q(ELEMENT_PLAIN[yongB].need, '이', '가')} 도움이 된다고 봐요. 아래 활동 가운데 상대에게 필요한 것을 번갈아 골라 함께하면 서로를 보완하는 시간이 됩니다.`,
        `함께 활용하면 좋은 색은 ${[...new Set([LUCKY_COLOR_PLAIN[yongA], LUCKY_COLOR_PLAIN[yongB]])].join(', ')}, 방향은 ${[...new Set([ELEMENT_INFO[yongA].direction, ELEMENT_INFO[yongB].direction])].join(', ')}입니다.`,
      ],
      tips: [...new Set([...ELEMENT_CONTENT[yongA].balanceTips.slice(0, 3), ...ELEMENT_CONTENT[yongB].balanceTips.slice(0, 3)])],
      basis: `용신 ${A} ${EL_NAME[yongA]} · ${B} ${EL_NAME[yongB]}`,
    },
    {
      key: 'timing',
      title: '함께 보는 올해와 내년',
      summary: `${thisYear}년 ${A} ${GRADE_PLAIN_LABEL[ya[0]!.ev.grade]} · ${B} ${GRADE_PLAIN_LABEL[yb[0]!.ev.grade]}`,
      paragraphs: [
        ...[da && daeunLine(A, da, false), db && daeunLine(B, db, Boolean(da && da.stemTenGod === db.stemTenGod))].filter((x): x is string => Boolean(x)),
        ...[0, 1].map((i) => {
          const ea = ya[i]!.ev;
          const eb = yb[i]!.ev;
          const both = ea.scores.total >= 65 && eb.scores.total >= 65;
          const gap = Math.abs(ea.scores.total - eb.scores.total) >= 15;
          const tail = both
            ? ['두 사람 모두 점수가 높은 해라 함께 계획한 일을 시작하기에 좋다고 봐요.', '두 사람 모두 흐름이 좋은 해라 미뤄 둔 계획을 함께 추진해 보기 좋습니다.'][i]
            : gap
              ? ['두 사람의 점수 차이가 큰 해라, 여유가 있는 쪽이 상대의 속도를 기다려 주면 관계가 안정되기 쉬워요.', '두 사람의 흐름이 엇갈리는 해라, 흐름이 좋은 쪽이 상대의 일을 먼저 도와주면 좋습니다.'][i]
              : ['두 사람 모두 차분히 다지는 해라, 큰 결정보다 일상의 리듬을 맞추는 데 힘을 쓰는 것이 좋아요.', '두 사람 모두 무난하게 흐르는 해라, 함께하는 작은 습관을 하나 만들기 좋습니다.'][i];
          const sewoon = i === 0 ? terms.term('세운') : '세운';
          return `${ya[i]!.yr}년 — ${sewoon}의 천간이 ${who(A, '에게')} ${ea.pillar.stemTenGod}, ${who(B, '에게')} ${eb.pillar.stemTenGod}${particle(eb.pillar.stemTenGod, '으로', '로')} 들어오는 해예요. 달빛사주 점수는 ${who(A, '은/는')} ${ea.scores.total}점, ${who(B, '은/는')} ${eb.scores.total}점이에요. ${tail}`;
        }),
        `${target}년 ${terms.term('월운')}으로 보면 두 사람의 점수가 함께 높은 달은 ${goodTogether.map((i) => monthsA[i]!.label).join('·')}이에요. 여행이나 중요한 약속은 이때 잡아 보세요. ${monthsA[lowTogether]!.label}은 두 사람의 점수가 함께 낮은 달이라 일정에 여유를 두는 것이 좋습니다.`,
      ],
      basis: `월운 점수(${target}년) ${A} ${monthsA.map((m) => m.score).join('·')} / ${B} ${monthsB.map((m) => m.score).join('·')} · ${A} ${da ? `${da.ganzhi.hangul} 대운 ${da.stemTenGod}` : '대운 전'} · ${B} ${db ? `${db.ganzhi.hangul} 대운 ${db.stemTenGod}` : '대운 전'} · ${thisYear}년 ${ya[0]!.ev.pillar.ganzhi.hangul} · ${thisYear + 1}년 ${ya[1]!.ev.pillar.ganzhi.hangul}`,
    },
    {
      key: 'advice',
      title: '더 좋은 관계를 위한 조언',
      summary: COMPAT_GRADE_LABEL[r.grade],
      paragraphs: [
        FORTUNE_TEMPLATES.compatibilityAdvice[r.grade],
        `두 사람이 특히 신경 쓰면 좋은 영역은 '${CATEGORY_LABEL[lowCat]}'${particle(CATEGORY_LABEL[lowCat], '이에요', '예요')}. 이 부분은 한 달에 한 번쯤 서로의 생각을 묻는 시간을 정해 두면 도움이 됩니다.`,
        '궁합은 두 사람의 기운이 만나는 방식을 살펴보는 참고 자료입니다. 이 리포트를 서로를 이해하는 대화의 출발점으로 활용해 보세요.',
      ],
      basis: `궁합 등급 ${r.grade} · 가장 낮은 영역 ${CATEGORY_LABEL[lowCat]} ${r.categories[lowCat]}`,
    },
  ];
}
