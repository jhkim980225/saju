/**
 * 유료 보고서 생성기 — 사주분석서(평생) · 신년운세 · 궁합 리포트.
 *
 * 규칙 기반 초안이 사실(간지·십신·점수·기간)을 모두 담고, AI 는 이 초안을 근거로 문장만 다듬는다(ai/service.ts).
 * 분량 목표(공백 제외): 사주분석서 약 2만 자 · 신년운세 약 8천 자 · 궁합 약 5천 자.
 */
import {
  ELEMENT_INFO,
  GRADE_LABEL,
  TEN_GOD_GROUP,
  evaluateFortune,
  wolun,
  yearPillarOf,
  type CompatibilityFactor,
  type ElementFit,
  type CompatibilityResult,
  type Element,
  type FortuneHighlight,
  type SajuChart,
  type TenGod,
  type TenGodGroup,
} from '@saju/core';
import type { ReadingSection } from '@saju/shared';
import {
  ELEMENT_CONTENT,
  FORTUNE_TEMPLATES,
  STRENGTH_CONTENT,
  TEN_GOD_CONTENT,
  TWELVE_STAGE_CONTENT,
  YONGSIN_CONTENT,
  type CompatFactorKey,
  type ElementLevel,
} from './content/index.js';
import { LUCK_CONTENT } from './content/luck.js';
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
  pick,
  targetFortuneYear,
  yearBriefSection,
} from './reading.js';

const ELEMENTS: Element[] = ['wood', 'fire', 'earth', 'metal', 'water'];
const GROUPS: TenGodGroup[] = ['비겁', '식상', '재성', '관성', '인성'];
const POSITION_LABEL = { year: '년주 · 초년과 조상의 자리', month: '월주 · 청년기와 사회의 자리', day: '일주 · 나와 배우자의 자리', hour: '시주 · 말년과 자녀의 자리' } as const;

/** 조사만 — '정관' → '과', '편재' → '와' */
const particle = (word: string, withBatchim: string, without: string) => josa(word, withBatchim, without).slice(word.length);
/** 오행 이름('목(木)')은 앞 글자로 조사를 고른다 */
const elp = (el: Element, withBatchim: string, without: string) => particle(EL_NAME[el].slice(0, 1), withBatchim, without);
const ieyo = (word: string) => particle(word, '이에요', '예요');
/** 목록 + 마지막 낱말에 맞춘 조사 */
const list = (items: string[], withBatchim: string, without: string) => items.join(', ') + particle(items[items.length - 1] ?? '', withBatchim, without);
const kstYear = (now: Date) => new Date(now.getTime() + 9 * 3_600_000).getUTCFullYear();
const pct = (n: number) => Math.round(n);

/** 웹 ElementBars 의 elementStatus 와 같은 기준 */
export function elementLevel(count: number, percent: number): ElementLevel {
  if (count === 0) return 'none';
  if (percent >= 35) return 'excess';
  if (percent >= 25) return 'developed';
  if (percent >= 12) return 'balanced';
  return 'weak';
}

const FIT_TAG = { yongsin: '용신이 드는 때', heesin: '희신이 드는 때', gisin: '기신이 드는 때', neutral: '' } as const;
/**
 * 보고서 한 권 안에서 같은 안내 문장(용신·기신 fit, 신살·합충 하이라이트, 지지 대운 해설)을 되풀이하지 않도록,
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
    highlights(hs: FortuneHighlight[], n: number): string[] {
      return hs
        .filter((h) => !h.startsWith('yongsin') && !h.startsWith('gisin'))
        .filter((h) => first(`hl:${h}`))
        .slice(0, n)
        .map((h) => FORTUNE_TEMPLATES.highlights[h]);
    },
    first,
  };
}
type Once = ReturnType<typeof reportOnce>;

// ---------------------------------------------------------------------------
// 사주분석서 — 원국 장
// ---------------------------------------------------------------------------

function chartSection(chart: SajuChart): ReadingSection {
  const dm = dayMasterContent(chart);
  const rows = (['year', 'month', 'day', 'hour'] as const).map((pos) => chart.pillars[pos]).filter((p): p is NonNullable<typeof p> => p !== null);
  const paragraphs = rows.map((p) => {
    const stemRole = p.stem.tenGod === '일간' ? '일간(나 자신)' : p.stem.tenGod;
    return `${POSITION_LABEL[p.position]} — ${p.ganzhi.hangul}(${p.ganzhi.hanja}). 천간 ${p.stem.hangul}${particle(p.stem.hangul, '은', '는')} ${EL_NAME[p.stem.element]} 기운으로 ${stemRole} 자리이고, 지지 ${p.branch.hangul}${particle(p.branch.hangul, '은', '는')} ${EL_NAME[p.branch.element]} 기운으로 ${p.branch.tenGod} 자리예요. 일간이 이 지지에서 맞는 12운성은 ${p.branch.twelveStage}${ieyo(p.branch.twelveStage)}.`;
  });
  if (!chart.pillars.hour) paragraphs.push('태어난 시간을 몰라 시주는 비워 두고 여섯 글자로 풀었어요. 시간을 알게 되면 말년·자녀 자리와 오행 비율이 더 정확해져요.');
  paragraphs.unshift(`사주 원국은 태어난 해·달·날·시를 네 기둥(四柱)으로 세운 여덟 글자예요. 그중 일간(태어난 날의 천간)이 '나'를 뜻하고, 나머지 글자는 모두 일간과의 관계(십성)로 읽어요. 당신의 일간은 ${dm.name}, ${dm.title}${ieyo(dm.title)}.`);
  return {
    key: 'chart',
    title: '사주 원국 — 여덟 글자의 구성',
    summary: rows.map((p) => p.ganzhi.hanja).join(' · '),
    keywords: [`일간 ${dm.name}`, `${chart.zodiac.animal}띠`],
    paragraphs,
  };
}

function strengthSection(chart: SajuChart): ReadingSection {
  const s = chart.strength;
  const st = STRENGTH_CONTENT[s.level];
  const helps = [s.deukryeong && '월지(태어난 달)', s.deukji && '일지(태어난 날의 지지)', s.deukse && '주변 글자들'].filter(Boolean) as string[];
  return {
    key: 'strength',
    title: '일간의 힘 — 신강과 신약',
    summary: st.title,
    keywords: [s.level, `돕는 기운 ${pct(s.score)}%`],
    paragraphs: [
      `일간을 돕는 기운(비겁·인성)이 사주 전체의 약 ${pct(s.score)}%를 차지해, 일간의 힘은 '${s.level}'에 가까워요. ${helps.length ? `${helps.join(', ')}에서 힘을 얻고 있어요.` : '월지·일지·주변 글자에서 직접 받는 도움이 적은 편이라, 운에서 들어오는 기운의 영향을 크게 받아요.'}`,
      '일간의 힘은 세 가지로 가늠해요. 태어난 달의 기운이 나를 돕는지(득령), 내가 앉은 자리인 일지가 나를 돕는지(득지), 주변 글자들 중 나를 돕는 쪽이 많은지(득세)예요. 힘이 세다고 좋고 약하다고 나쁜 게 아니라, 어떤 방식으로 살 때 편안한지를 알려 주는 기준이에요.',
      st.advice,
    ],
  };
}

function elementRatioSection(chart: SajuChart): ReadingSection {
  const e = chart.elements;
  const paragraphs = [
    `지장간과 태어난 달의 힘까지 더해 계산한 오행 비율은 ${ELEMENTS.map((el) => `${EL_NAME[el]} ${pct(e.percent[el])}%`).join(' · ')}예요. 글자 수로는 ${ELEMENTS.map((el) => `${EL_NAME[el].slice(0, 1)} ${e.count[el]}개`).join(', ')}예요.`,
    ...ELEMENTS.map((el) => `${EL_NAME[el]} ${pct(e.percent[el])}% — ${REPORT_MISC.elementLevel[el][elementLevel(e.count[el], e.percent[el])]}`),
    `가장 강한 ${EL_NAME[e.dominant]} 기운의 성질: ${ELEMENT_CONTENT[e.dominant].nature}`,
  ];
  for (const el of e.lacking) paragraphs.push(`${EL_NAME[el]} 기운을 채우는 생활 습관: ${ELEMENT_CONTENT[el].balanceTips.join(', ')}.`);
  return {
    key: 'elements',
    title: '오행 비율 — 다섯 기운의 균형',
    summary: e.lacking.length ? `${e.lacking.map((x) => EL_NAME[x]).join('·')} 기운을 채워 주면 균형이 잡혀요` : `${EL_NAME[e.dominant]} 기운이 중심을 잡고 있어요`,
    keywords: ELEMENTS.map((el) => `${EL_NAME[el].slice(0, 1)} ${pct(e.percent[el])}%`),
    paragraphs,
  };
}

function yongsinDetailSection(base: ReadingSection, chart: SajuChart): ReadingSection {
  const y = chart.yongsin;
  return {
    ...base,
    paragraphs: [
      ...base.paragraphs,
      `희신 ${EL_NAME[y.heesin]}${elp(y.heesin, '은', '는')} 용신을 곁에서 돕는 기운이에요. 용신과 함께 챙기면 효과가 커지고, 운에서 이 기운이 들어오는 시기에는 일이 한결 순하게 풀려요.`,
      `기신 ${EL_NAME[y.gisin]}${elp(y.gisin, '은', '는')} 지나치면 균형을 흔드는 기운이에요. 나쁜 기운이라기보다 '과하면 피곤해지는 기운'으로 이해하고, 이 기운이 강하게 들어오는 해·달에는 속도를 조절해 주세요.`,
      ...(chart.elements.lacking.includes(y.yongsin) ? [] : [`${EL_NAME[y.yongsin]} 기운을 생활에서 채우는 방법: ${ELEMENT_CONTENT[y.yongsin].balanceTips.join(', ')}.`]),
    ],
  };
}

function tenGodDetailSection(chart: SajuChart): ReadingSection {
  const g = groupCount(chart);
  const top = dominantTenGod(chart);
  const present = (Object.entries(chart.tenGodCount) as [TenGod, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const paragraphs = [
    `십성은 일간을 기준으로 다른 글자들이 어떤 역할을 하는지 나눈 열 가지 관계예요. 당신의 사주는 ${GROUPS.map((k) => `${k} ${g[k]}`).join(' · ')}로 구성돼 있어요.`,
    ...present.map(([tg, n]) => `${tg}(${TEN_GOD_CONTENT[tg].keyword}) ${n}개 — ${TEN_GOD_CONTENT[tg].meaning}`),
    `그중 가장 두드러지는 ${top}의 기운은 이렇게 드러나요. ${TEN_GOD_CONTENT[top].strong}`,
  ];
  for (const group of GROUPS.filter((k) => g[k] === 0)) {
    const rep = (Object.keys(TEN_GOD_CONTENT) as TenGod[]).find((t) => TEN_GOD_GROUP[t] === group)!;
    paragraphs.push(`${group}${particle(group, '이', '가')} 없는 사주예요. ${TEN_GOD_CONTENT[rep].absent}`);
  }
  return { key: 'tenGods', title: '십성 분포 — 나를 움직이는 열 가지 힘', summary: `${top} 기운이 삶의 중심 테마예요`, keywords: present.slice(0, 4).map(([tg, n]) => `${tg} ${n}`), paragraphs };
}

// ---------------------------------------------------------------------------
// 대운 80년
// ---------------------------------------------------------------------------

function daeunSections(chart: SajuChart, now: Date, once: Once): ReadingSection[] {
  const year = kstYear(now);
  const periods = chart.daeun.periods.slice(0, 8);
  const current = periods.find((p) => year >= p.startYear && year <= p.endYear);
  const intro: ReadingSection = {
    key: 'daeun',
    title: '대운 80년 — 인생의 계절',
    summary: current ? `지금은 ${current.ganzhi.hangul}(${current.ganzhi.hanja}) 대운을 지나고 있어요` : `만 ${chart.daeun.startAge}세부터 첫 대운이 시작돼요`,
    keywords: [`대운수 ${chart.daeun.startAge}`, chart.daeun.direction === 'forward' ? '순행' : '역행'],
    paragraphs: [
      `대운은 10년마다 바뀌는 인생의 계절이에요. 같은 사주라도 어떤 계절을 지나느냐에 따라 힘을 쓰기 좋은 때와 쉬어 가야 할 때가 달라져요. 당신의 대운은 만 ${chart.daeun.startAge}세(정밀 ${chart.daeun.startExact.years}년 ${chart.daeun.startExact.months}개월)부터 ${chart.daeun.direction === 'forward' ? '순행' : '역행'}으로 흘러가요.`,
      ...periods.map((p) => {
        const ev = evaluateFortune(chart, p);
        return `${p === current ? '▶ ' : ''}${p.startAge}~${p.endAge}세(${p.startYear}~${p.endYear}) ${p.ganzhi.hangul}(${p.ganzhi.hanja}) — ${p.stemTenGod}·${p.branchTenGod}, ${GRADE_LABEL[ev.grade]} (${ev.scores.total}점)`;
      }),
    ],
  };
  const each = periods.map((p, i): ReadingSection => {
    const ev = evaluateFortune(chart, p);
    const fs = once.fit(ev.fit.stem, 'stem');
    const fb = once.fit(ev.fit.branch, 'branch');
    const c = LUCK_CONTENT.daeun[p.stemTenGod];
    const stage = TWELVE_STAGE_CONTENT[p.twelveStage];
    const kw = TEN_GOD_CONTENT[p.stemTenGod].keyword;
    const paragraphs = [
      `천간에 ${p.stemTenGod}(${kw})${particle(p.stemTenGod, '이', '가')}, 지지에 ${p.branchTenGod}(${TEN_GOD_CONTENT[p.branchTenGod].keyword})${particle(p.branchTenGod, '이', '가')} 흐르는 10년이에요. ${c.general}`,
      [fs.text, fb.text].filter(Boolean).join(' '),
    ].filter(Boolean);
    if (p.branchTenGod !== p.stemTenGod) {
      paragraphs.push(
        once.first(`daeun-branch:${p.branchTenGod}`)
          ? `생활의 바탕(지지)에 깔린 ${p.branchTenGod}의 기운도 함께 작용해요. ${LUCK_CONTENT.daeun[p.branchTenGod].general}`
          : `생활의 바탕(지지)에는 ${p.branchTenGod}(${TEN_GOD_CONTENT[p.branchTenGod].keyword})의 기운이 다시 깔려요. 앞선 대운에서 이 기운을 어떻게 썼는지 떠올려 보면, 이번 10년을 꾸리는 데 좋은 참고가 돼요.`,
      );
    }
    paragraphs.push(
      `재물 — ${c.wealth}`,
      `애정·관계 — ${c.love}`,
      `일·커리어 — ${c.career}`,
      `건강 — ${c.health}`,
      `이 대운의 12운성은 ${stage.name}(${stage.keyword})${ieyo(stage.name)}. ${stage.meaning}`,
      ...once.highlights(ev.highlights, 2),
    );
    return {
      key: `daeun-${i + 1}`,
      title: `${p.startAge}~${p.endAge}세 · ${p.ganzhi.hangul}(${p.ganzhi.hanja}) 대운`,
      summary: `${p.startYear}~${p.endYear}년 · ${GRADE_LABEL[ev.grade]}${p === current ? ' · 지금 지나는 대운' : ''}`,
      score: ev.scores.total,
      keywords: [p.stemTenGod, p.branchTenGod, `12운성 ${p.twelveStage}`, ...(fs.tag ? [fs.tag] : [])],
      paragraphs,
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
      `달마다 바뀌는 기운(월운)은 절기를 기준으로 나눠요. 그래서 '2월'은 입춘부터, '3월'은 경칩부터 시작해요. 아래 점수는 월운이 내 사주와 얼마나 잘 맞는지를 100점 만점으로 나타낸 거예요.`,
      months.map((m, i) => `${label(i)} ${m.ganzhi.hanja} ${evals[i]!.scores.total}점`).join(' · '),
      `새로운 일을 시작하거나 중요한 약속을 잡기 좋은 달은 ${best.map(label).join(', ')}이고, ${careful.map(label).join(', ')}에는 속도를 늦추고 컨디션과 일정에 여유를 두면 좋아요.`,
    ],
  };
  const each = months.map((m, i): ReadingSection => {
    const ev = evals[i]!;
    const v = (seen.get(m.stemTenGod) ?? 0) % 2;
    seen.set(m.stemTenGod, v + 1);
    const c = LUCK_CONTENT.month[m.stemTenGod];
    const fs = once.fit(ev.fit.stem, 'stem');
    return {
      key: `month-${m.order}`,
      title: `${label(i)} · ${m.ganzhi.hangul}(${m.ganzhi.hanja})월`,
      summary: pick(FORTUNE_TEMPLATES.monthlySummary[ev.grade], `${seed}-ms${m.order}`),
      score: ev.scores.total,
      keywords: [`${m.termName}부터`, `${m.stemTenGod}·${m.branchTenGod}`, GRADE_LABEL[ev.grade], ...(fs.tag ? [fs.tag] : [])],
      paragraphs: [
        `${m.termName}부터 다음 절기 전까지는 ${m.ganzhi.hangul}(${m.ganzhi.hanja})월이에요. 천간으로 ${m.stemTenGod}, 지지로 ${m.branchTenGod}의 기운이 들어와요. ${c.general[v]}`,
        ...(fs.text ? [fs.text] : []),
        `재물 — ${c.wealth[v]}`,
        `애정·관계 — ${c.love[v]}`,
        `일·커리어 — ${c.career[v]}`,
        `건강 — ${c.health[v]}`,
        ...once.highlights(ev.highlights, 1),
        `이달의 실천 — ${c.advice[v]}`,
      ],
    };
  });
  return [intro, ...each];
}

// ---------------------------------------------------------------------------
// 사주분석서 (평생)
// ---------------------------------------------------------------------------

export function buildSajuAnalysis(chart: SajuChart, now = new Date()): ReadingSection[] {
  const basic = new Map(buildBasicReading(chart, { access: 'full', now }).sections.map((s) => [s.key, s]));
  const get = (key: string) => basic.get(key)!;
  const thisYear = kstYear(now);
  const dm = dayMasterContent(chart);
  const y = chart.yongsin;
  const info = ELEMENT_INFO[y.yongsin];
  const once = reportOnce();

  const relations: ReadingSection = {
    key: 'relations',
    title: '합과 충 — 글자들의 관계',
    summary: chart.relations.length ? chart.relations.slice(0, 3).map((r) => r.label).join(', ') : '글자들끼리 큰 충돌 없이 안정적이에요',
    paragraphs: chart.relations.length
      ? [
          '사주의 글자들은 서로 손을 잡기도(합) 부딪히기도(충·형·해·파) 해요. 합은 협력과 인연을, 충은 변화와 움직임을 만들어요. 어느 쪽이든 좋고 나쁨보다 "어디에 힘이 몰리는지"를 읽는 단서예요.',
          ...chart.relations.map((r) => `${r.label}: ${r.tone === 'positive' ? '서로 손을 잡고 힘을 모으는 관계로, 해당 기둥이 뜻하는 시기·영역에서 협력과 기회가 생기기 쉬워요.' : '서로 부딪히며 변화를 만드는 관계로, 긴장감이 있지만 잘 쓰면 성장의 동력이 돼요.'}`),
        ]
      : ['원국에 두드러진 합·충이 없어 기질이 한결같고 예측 가능한 편이에요. 큰 변화는 주로 대운·세운에서 들어오니, 운의 흐름을 함께 보면 좋아요.'],
  };
  const stages: ReadingSection = {
    key: 'stages',
    title: '12운성 — 기둥별 에너지',
    summary: `일지 ${chart.pillars.day.branch.twelveStage}`,
    paragraphs: (['year', 'month', 'day', 'hour'] as const)
      .map((pos) => chart.pillars[pos])
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map((p) => {
        const s = TWELVE_STAGE_CONTENT[p.branch.twelveStage];
        return `${POSITION_LABEL[p.position]} — ${s.name}(${s.keyword}): ${s.meaning}`;
      }),
  };
  const closing: ReadingSection = {
    key: 'closing',
    title: '마무리 — 나답게 사는 법',
    summary: dm.advice,
    keywords: [`행운의 색 ${info.color}`, `행운의 방향 ${info.direction}`, `행운의 숫자 ${info.numbers.join('·')}`],
    paragraphs: [
      REPORT_MISC.closingByStrength[chart.strength.level],
      `${dm.name}인 당신에게 건네는 한마디: ${dm.advice}`,
      `기억해 두면 좋은 것 — 힘이 되는 기운 ${EL_NAME[y.yongsin]}, 행운의 색 ${info.color}, 행운의 방향 ${info.direction}, 행운의 숫자 ${info.numbers.join('·')}. ${YONGSIN_CONTENT[y.yongsin].tips.slice(0, 2).join(' / ')}`,
      '사주는 정해진 운명표가 아니라 나를 이해하는 지도예요. 이 분석서가 나의 강점을 믿고, 쉬어 갈 때를 알아차리는 데 작은 도움이 되면 좋겠어요.',
    ],
  };

  return [
    get('overview'),
    chartSection(chart),
    get('personality'),
    strengthSection(chart),
    elementRatioSection(chart),
    yongsinDetailSection(get('yongsin'), chart),
    tenGodDetailSection(chart),
    relations,
    stages,
    get('shinsal'),
    get('wealth'),
    get('love'),
    get('career'),
    get('health'),
    ...daeunSections(chart, now, once),
    yearBriefSection(chart, thisYear),
    yearBriefSection(chart, thisYear + 1),
    ...monthSections(chart, targetFortuneYear(now), once),
    closing,
  ];
}

// ---------------------------------------------------------------------------
// 신년운세 리포트
// ---------------------------------------------------------------------------

export function buildYearlyReport(chart: SajuChart, year: number): ReadingSection[] {
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

  const area = (key: 'wealth' | 'love' | 'career' | 'health', title: string): ReadingSection => ({
    key,
    title,
    score: ev.scores[key],
    summary: pick(FORTUNE_TEMPLATES.dailyCategory[key][band(ev.scores[key])], `${seed}${key[0]}`),
    paragraphs: [
      `천간의 ${stg}${particle(stg, '은', '는')} 이렇게 작용해요. ${tg.inLuck[key]}`,
      btg !== stg ? `지지의 ${btg}${particle(btg, '은', '는')} 생활의 바탕에서 이렇게 작용해요. ${bt.inLuck[key]}` : '',
      `더 긴 흐름으로 보면: ${LUCK_CONTENT.daeun[stg][key]}`,
    ].filter(Boolean),
  });

  return [
    {
      key: 'total',
      title: `${year}년 총운`,
      score: ev.scores.total,
      summary: pick(FORTUNE_TEMPLATES.yearlyHeadline[ev.grade], seed),
      keywords: [`${ev.pillar.ganzhi.hangul}(${ev.pillar.ganzhi.hanja})년`, `${stg}·${btg}`, GRADE_LABEL[ev.grade]],
      paragraphs: [
        `${year}년 ${ev.pillar.ganzhi.hangul}(${ev.pillar.ganzhi.hanja})년은 천간으로 ${stg}(${tg.keyword}), 지지로 ${btg}(${bt.keyword})의 기운이 들어오는 해예요. ${tg.inLuck.general}`,
        btg !== stg ? bt.inLuck.general : LUCK_CONTENT.daeun[stg].general,
        totalFit,
        `올해 지지에서 일간이 맞는 12운성은 ${stage.name}(${stage.keyword})${ieyo(stage.name)}. ${stage.meaning}`,
        ...once.highlights(ev.highlights, 3),
      ],
    },
    {
      key: 'daeunContext',
      title: '올해가 속한 10년의 흐름',
      summary: daeun ? `${daeun.ganzhi.hangul}(${daeun.ganzhi.hanja}) 대운 안의 한 해예요` : '첫 대운이 시작되기 전의 한 해예요',
      paragraphs: daeun
        ? [
            `${year}년은 ${daeun.startAge}~${daeun.endAge}세에 걸친 ${daeun.ganzhi.hangul}(${daeun.ganzhi.hanja}) 대운(${daeun.startYear}~${daeun.endYear}) 안에 있어요. 한 해의 운은 이 10년의 큰 계절 위에서 움직여요.`,
            LUCK_CONTENT.daeun[daeun.stemTenGod].general,
          ]
        : ['대운이 시작되기 전에는 원국의 기질과 한 해의 운이 그대로 드러나요. 올해의 흐름을 더 직접적으로 느낄 수 있어요.'],
    },
    area('wealth', '재물운'),
    area('love', '애정운'),
    area('career', '직장·사업운'),
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
const factorText = (f: CompatibilityFactor) => {
  const c = REPORT_MISC.compatFactor[factorKey(f.key)];
  return c ? `${f.label} ${c.detail} ${c.tip}` : f.label;
};

const CATEGORY_LABEL = { personality: '성격 궁합', romance: '연애·끌림', stability: '생활·안정', complement: '서로 채워 주는 정도' } as const;

export function buildCompatibilityReport(a: SajuChart, b: SajuChart, r: CompatibilityResult, names: { a: string; b: string }, now = new Date()): ReadingSection[] {
  const dmA = dayMasterContent(a);
  const dmB = dayMasterContent(b);
  const dpA = dayPillarContent(a);
  const dpB = dayPillarContent(b);
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
  /** 앞 장(본성·오행)에서 이미 풀이한 요인은 끌림·조율 장에서 다시 쓰지 않는다 */
  const shown = (f: CompatibilityFactor) => f.key.startsWith('stem_') || f.category === 'complement';
  const posRest = pos.filter((f) => !shown(f));
  const topGroup = (c: SajuChart) => {
    const g = groupCount(c);
    return GROUPS.reduce((best, k) => (g[k] > g[best] ? k : best), GROUPS[0]!);
  };
  const ga = topGroup(a);
  const gb = topGroup(b);
  const daeunNow = (c: SajuChart) => c.daeun.periods.find((p) => thisYear >= p.startYear && thisYear <= p.endYear);
  const da = daeunNow(a);
  const db = daeunNow(b);
  const negRest = [...neg, ...neutral].filter((f) => !shown(f));

  return [
    {
      key: 'summary',
      title: '한눈에 보는 궁합',
      summary: pick(FORTUNE_TEMPLATES.compatibilityHeadline[r.grade], `${a.birthUtc}|${b.birthUtc}`),
      score: r.score,
      keywords: [COMPAT_GRADE_LABEL[r.grade], `${r.score}점`],
      paragraphs: [
        `${names.a}님과 ${names.b}님의 궁합은 100점 만점에 ${r.score}점, '${COMPAT_GRADE_LABEL[r.grade]}'이에요. 일간(본성), 일지(배우자 자리), 띠, 오행의 보완 관계를 함께 따져 본 점수예요.`,
        `${names.a}님은 ${dmA.title}(${dmA.name}), ${names.b}님은 ${dmB.title}(${dmB.name})의 기운을 지녔어요.`,
        `좋은 인연 포인트 ${pos.length}가지, 함께 조율할 포인트 ${neg.length}가지가 보여요. 점수는 출발점일 뿐, 두 사람이 서로를 이해하는 만큼 관계는 달라져요.`,
      ],
    },
    {
      key: 'persons',
      title: '두 사람의 타고난 기질',
      summary: `${dmA.title}${particle(dmA.title, '과', '와')} ${dmB.title}의 만남`,
      paragraphs: [
        `${names.a}님 — ${dpA.title}. ${dmA.summary} ${dmA.personality[0] ?? ''}`,
        dpA.personality,
        `${names.b}님 — ${dpB.title}. ${dmB.summary} ${dmB.personality[0] ?? ''}`,
        dpB.personality,
        `${names.a}님의 강점 — ${dmA.strengths.slice(0, 3).join(', ')}. ${names.b}님의 강점 — ${dmB.strengths.slice(0, 3).join(', ')}. 서로의 강점이 다를수록 역할을 나누기 쉬워요.`,
      ],
    },
    {
      key: 'stemRelation',
      title: '본성의 관계 — 두 일간',
      summary: stemFactors[0]?.label ?? '두 사람의 본성이 만나는 방식',
      paragraphs: [
        `${names.a}님의 일간은 ${EL_NAME[a.dayMaster.element]}, ${names.b}님의 일간은 ${EL_NAME[b.dayMaster.element]}${elp(b.dayMaster.element, '이에요', '예요')}. ${REPORT_MISC.compatStemRelation[relKey]}`,
        ...stemFactors.map(factorText),
      ],
    },
    {
      key: 'balance',
      title: '오행으로 본 균형',
      summary: balanceFactors.some((f) => f.tone === 'positive') ? '서로에게 필요한 기운을 채워 주는 사이예요' : '각자의 기운을 존중하며 맞춰 가는 사이예요',
      paragraphs: [
        `${names.a}님의 오행은 ${ELEMENTS.map((el) => `${EL_NAME[el].slice(0, 1)} ${pct(a.elements.percent[el])}%`).join(' · ')}, ${names.b}님은 ${ELEMENTS.map((el) => `${EL_NAME[el].slice(0, 1)} ${pct(b.elements.percent[el])}%`).join(' · ')}예요.`,
        `${names.a}님에게 필요한 기운(용신)은 ${EL_NAME[a.yongsin.yongsin]}, ${names.b}님에게 필요한 기운은 ${EL_NAME[b.yongsin.yongsin]}${elp(b.yongsin.yongsin, '이에요', '예요')}.`,
        ...(balanceFactors.length ? balanceFactors.map(factorText) : ['두 사람의 오행이 서로를 크게 채우거나 누르지 않아, 각자의 색을 지키며 함께하기 좋아요.']),
      ],
    },
    {
      key: 'strengths',
      title: '서로 끌리는 이유',
      summary: pos.length ? `${pos.length}가지 좋은 인연 포인트` : '천천히 쌓아 가는 인연',
      score: r.categories.romance,
      paragraphs: posRest.length ? posRest.map(factorText) : pos.length ? ['앞에서 본 본성과 오행의 조화가 두 사람을 이어 주는 가장 큰 끌림이에요.'] : ['눈에 띄는 끌림보다 시간이 지날수록 깊어지는 관계예요. 함께 보낸 시간이 신뢰로 쌓이는 타입이에요.'],
    },
    {
      key: 'cautions',
      title: '함께 조율할 점',
      summary: neg.length ? `${neg.length}가지 조율 포인트` : '큰 갈등 요소가 적어요',
      score: r.categories.stability,
      paragraphs: negRest.length ? negRest.map(factorText) : neg.length ? ['본성과 오행에서 본 차이 말고는 크게 부딪히는 기운이 적어요. 앞의 조언만 기억해 두면 충분해요.'] : ['서로 부딪히는 기운이 적어 편안한 관계를 만들기 좋아요. 다만 편안함이 무관심이 되지 않도록 표현은 아끼지 마세요.'],
    },
    {
      key: 'categories',
      title: '영역별 궁합',
      summary: (Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).map((k) => `${CATEGORY_LABEL[k]} ${r.categories[k]}`).join(' · '),
      paragraphs: (Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).map((k) => `${CATEGORY_LABEL[k]} ${r.categories[k]}점 — ${REPORT_MISC.compatCategory[k][band(r.categories[k])]}`),
    },
    {
      key: 'communication',
      title: '대화와 표현 방식',
      summary: ga === gb ? `두 사람 모두 ${ga} 기운이 강해 말이 잘 통해요` : `${ga}${particle(ga, '과', '와')} ${gb}, 서로 다른 언어로 마음을 전해요`,
      paragraphs: [
        `${names.a}님은 사주에서 ${ga} 기운이 가장 강해요. ${REPORT_MISC.compatCommunication[ga]}`,
        `${names.b}님은 사주에서 ${gb} 기운이 가장 강해요. ${REPORT_MISC.compatCommunication[gb]}`,
        ga === gb
          ? '같은 방식으로 마음을 표현하니 오해는 적지만, 둘 다 같은 지점에서 지칠 수 있어요. 가끔은 상대가 잘 하지 않는 방식으로 먼저 다가가 보세요.'
          : '표현 방식이 다르다는 건 서로에게 없는 언어를 가르쳐 줄 수 있다는 뜻이에요. 상대의 방식을 "틀렸다"가 아니라 "다르다"로 읽어 주세요.',
      ],
    },
    {
      key: 'conflict',
      title: '갈등이 생길 때',
      summary: `${a.strength.level}${particle(a.strength.level, '과', '와')} ${b.strength.level}의 만남`,
      paragraphs: [
        `${names.a}님(${a.strength.level}) — ${REPORT_MISC.compatConflict[a.strength.level]}`,
        `${names.b}님(${b.strength.level}) — ${REPORT_MISC.compatConflict[b.strength.level]}`,
        '다툼이 길어질 때는 "누가 맞나"보다 "우리가 원하는 건 뭘까"로 질문을 바꿔 보세요. 감정이 가라앉을 시간을 정해 두고 다시 이야기하는 것도 좋은 방법이에요.',
      ],
    },
    {
      key: 'loveStyle',
      title: '두 사람의 연애 스타일',
      summary: '서로의 사랑법을 알면 오해가 줄어요',
      paragraphs: [`${names.a}님 — ${dmA.love}`, dpA.love, `${names.b}님 — ${dmB.love}`, dpB.love],
    },
    {
      key: 'manual',
      title: '서로를 위한 사용설명서',
      summary: '상대가 힘을 얻는 순간과 조심할 지점',
      paragraphs: [
        `${names.a}님은 ${dmA.keywords.slice(0, 3).join(' · ')}의 사람이에요. ${list(dmA.strengths.slice(0, 2), '을', '를')} 알아봐 줄 때 힘을 얻고, ${dmA.weaknesses.slice(0, 2).join(', ')} 같은 면은 너그럽게 봐 주면 좋아요.`,
        `${names.a}님에게 건네면 좋은 말: ${dmA.advice}`,
        `${names.b}님은 ${dmB.keywords.slice(0, 3).join(' · ')}의 사람이에요. ${list(dmB.strengths.slice(0, 2), '을', '를')} 알아봐 줄 때 힘을 얻고, ${dmB.weaknesses.slice(0, 2).join(', ')} 같은 면은 너그럽게 봐 주면 좋아요.`,
        `${names.b}님에게 건네면 좋은 말: ${dmB.advice}`,
      ],
    },
    {
      key: 'together',
      title: '함께하면 좋은 것',
      summary: a.yongsin.yongsin === b.yongsin.yongsin ? `두 사람 모두 ${EL_NAME[a.yongsin.yongsin]} 기운에서 힘을 얻어요` : `${EL_NAME[a.yongsin.yongsin]}${elp(a.yongsin.yongsin, '과', '와')} ${EL_NAME[b.yongsin.yongsin]} 기운을 함께 채워요`,
      paragraphs: [
        `${names.a}님에게 힘이 되는 ${EL_NAME[a.yongsin.yongsin]} 기운: ${ELEMENT_CONTENT[a.yongsin.yongsin].balanceTips.slice(0, 3).join(', ')}.`,
        a.yongsin.yongsin === b.yongsin.yongsin
          ? '두 사람에게 필요한 기운이 같아서, 위의 활동을 함께하면 둘 다 충전돼요. 정기적인 데이트 루틴으로 만들어 보세요.'
          : `${names.b}님에게 힘이 되는 ${EL_NAME[b.yongsin.yongsin]} 기운: ${ELEMENT_CONTENT[b.yongsin.yongsin].balanceTips.slice(0, 3).join(', ')}. 번갈아 상대에게 필요한 활동을 골라 함께하면 서로를 채워 주는 시간이 돼요.`,
        `함께 쓰면 좋은 색 — ${[...new Set([ELEMENT_INFO[a.yongsin.yongsin].color, ELEMENT_INFO[b.yongsin.yongsin].color])].join(', ')}. 함께 가면 좋은 방향 — ${[...new Set([ELEMENT_INFO[a.yongsin.yongsin].direction, ELEMENT_INFO[b.yongsin.yongsin].direction])].join(', ')}.`,
      ],
    },
    {
      key: 'timing',
      title: '함께 보는 올해와 내년',
      summary: `${thisYear}년 ${names.a} ${GRADE_LABEL[ya[0]!.ev.grade]} · ${names.b} ${GRADE_LABEL[yb[0]!.ev.grade]}`,
      paragraphs: [
        [da && `${names.a}님은 지금 ${da.ganzhi.hangul}(${da.ganzhi.hanja}) 대운(${da.startYear}~${da.endYear})을 지나며 ${da.stemTenGod}의 10년을 보내고 있어요. ${LUCK_CONTENT.daeun[da.stemTenGod].love}`, db && `${names.b}님은 지금 ${db.ganzhi.hangul}(${db.ganzhi.hanja}) 대운(${db.startYear}~${db.endYear})을 지나며 ${db.stemTenGod}의 10년을 보내고 있어요. ${LUCK_CONTENT.daeun[db.stemTenGod].love}`].filter((x): x is string => Boolean(x)),
        [0, 1].map((i) => {
        const ea = ya[i]!.ev;
        const eb = yb[i]!.ev;
        const both = ea.scores.total >= 65 && eb.scores.total >= 65;
        const gap = Math.abs(ea.scores.total - eb.scores.total) >= 15;
        return `${ya[i]!.yr}년 — ${names.a}님은 ${ea.pillar.stemTenGod}의 해로 ${ea.scores.total}점, ${names.b}님은 ${eb.pillar.stemTenGod}의 해로 ${eb.scores.total}점이에요. ${both ? '두 사람 모두 기운이 오르는 해라 함께 계획한 일을 시작하기 좋아요.' : gap ? '한 사람의 기운이 더 높은 해라, 여유가 있는 쪽이 상대의 속도를 기다려 주면 관계가 단단해져요.' : '두 사람 모두 차분히 다지는 해라, 큰 결정보다 일상의 리듬을 맞추는 데 힘을 쓰면 좋아요.'}`;
        }),
      ].flat(),
    },
    {
      key: 'advice',
      title: '더 좋은 관계를 위한 조언',
      summary: COMPAT_GRADE_LABEL[r.grade],
      paragraphs: [
        FORTUNE_TEMPLATES.compatibilityAdvice[r.grade],
        ...r.factors.slice(0, 3).map((f) => REPORT_MISC.compatFactor[factorKey(f.key)]?.tip).filter((t): t is string => Boolean(t)),
        '궁합은 두 사람의 기운이 만나는 방식을 보는 참고 자료예요. 관계의 답은 결국 서로를 대하는 매일의 태도에 있어요.',
      ],
    },
  ];
}
