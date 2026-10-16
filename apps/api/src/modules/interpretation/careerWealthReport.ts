/**
 * 재물·직업운 리포트(report_career_wealth) — 저장한 프로필 하나에 대한 주제별 유료 리포트.
 *
 * 문체 기준(docs/PLAIN_KOREAN.md): 사주를 처음 접하는 성인이 읽는 전문 서비스의 글.
 * - 장마다 결론을 먼저 말한다. 정식 명리학 용어를 쓰되 처음 나올 때 뜻을 붙이고(termTracker), 한자·간지·점수는 basis('사주로 보면')에 둔다.
 * - 이름이 있으면 "○○님은"으로 부르고, 없으면 주어를 뺀다("당신"은 쓰지 않는다).
 * - 시기는 연도로, 점수는 '아주 좋음 / 좋음 / 보통 / 낮음'(달빛사주 기준)으로 말한다.
 *
 * 구성(12장): 한눈에 보기 → 돈이 들어오는 방식 → 감당하기 좋은 돈의 크기 → 버는·지키는 방식 → 일하는 방식
 *   → 어울리는 분야 → 직장형·독립형 → 앞으로 10년 → 가까운 3년 → 조심할 점 → 돈 습관 → 마무리.
 * 근거: 십성 개수(재성·식상·비겁·관성·인성)와 세력, 일간의 힘(득령·득지·득세), 용신·희신·기신, 신살,
 *   세운(십성·월지/일지 합충·역마·용신 적합도), 대운.
 * 성별은 읽지 않는다. 대운은 성별에 따라 순행·역행이 갈리므로 요약(summary)과 10년 흐름(decade) 장에서만 쓴다.
 *   10년 흐름 장의 대운 문장은 용어 기록을 갈라(fork) 써서, 뒤 장에서 용어 뜻을 붙일지가 성별에 따라 달라지지 않게 한다.
 * 분량 목표: 공백 뺀 약 8천 자(AI 다듬기 전). 규칙 기반 초안이 사실을 모두 담고(근거는 basis), AI 는 문장만 다듬는다.
 */
import {
  TEN_GOD_GROUP,
  elementOfGroup,
  evaluateFortune,
  wolun,
  yearPillarOf,
  type Element,
  type FortuneEvaluation,
  type SajuChart,
  type TenGod,
  type TenGodGroup,
} from '@saju/core';
import type { ReadingSection } from '@saju/shared';
import {
  CAREER_WEALTH_REPORT as C,
  type CareerShinsalName,
  type Clause,
  type EarnKey,
  type EmploymentKey,
  type KeepKey,
  type MoneyStructureKey,
  type RiskKey,
  type StrengthBand,
  type TransitionKey,
  type YearSignalKey,
} from './content/careerWealthReport.js';
import { displayName, nameSubject } from './content/plain.js';
import { targetFortuneYear } from './reading.js';
import { EL_NAME, EL_TERM, GROUPS, gradeWord, groupCount, monthsText, pp, prt, ro, scoreBand, stemTerm, termTracker, yearsText } from './topicReportKit.js';

/** 근거에 쓰는 신호 이름 */
const SIGNAL_TERM: Record<YearSignalKey, string> = {
  monthClash: '월지 충',
  monthCombine: '월지 합',
  dayClash: '일지 충',
  dayCombine: '일지 합',
  yeokma: '역마',
  cheoneul: '천을귀인',
  munchang: '문창귀인',
};
const TRANSITION_TERM: Record<TransitionKey, string> = { daeun: '대운 교체', monthClash: '월지 충', yeokma: '역마', dayClash: '일지 충' };
const TRANSITION_WEIGHT: Record<TransitionKey, number> = { daeun: 3, monthClash: 2, yeokma: 1, dayClash: 1 };
const CAREER_SHINSAL: CareerShinsalName[] = ['역마살', '문창귀인', '화개살', '천을귀인', '학당귀인'];
/** 본문에 쓰는 신살 이름 — 끝의 '살'은 뗀다(사주 기초 화면과 같게) */
const SHINSAL_NAME: Record<CareerShinsalName, string> = { 역마살: '역마', 문창귀인: '문창귀인', 화개살: '화개', 천을귀인: '천을귀인', 학당귀인: '학당귀인' };
const EARN_ORDER: Exclude<EarnKey, 'none'>[] = ['정재', '편재', '식신', '상관'];
const BAND_SUMMARY: Record<StrengthBand, string> = {
  strong: '규모가 큰 일과 돈도 감당할 수 있는 편이에요',
  mid: '때에 따라 넓히고 줄이는 조절이 잘 맞아요',
  weak: '돈은 나눠서 관리하고, 일은 함께할 때 편한 편이에요',
};
const word = (n: number) => gradeWord(n, '낮음');

interface YearInfo {
  year: number;
  ev: FortuneEvaluation;
  hanja: string;
  stemTenGod: TenGod;
  wealth: number;
  career: number;
  /** 원국과 맺는 관계 — 성별과 무관 */
  signals: YearSignalKey[];
}

/** 세운 한 해 — 신년운세와 같은 시드로 평가해 점수가 서로 어긋나지 않게 한다 */
function yearInfo(chart: SajuChart, year: number): YearInfo {
  const ev = evaluateFortune(chart, yearPillarOf(year), `year-${year}`);
  const h = ev.highlights;
  const signals: YearSignalKey[] = [];
  if (h.includes('branch_clash_month')) signals.push('monthClash');
  if (ev.interactions.some((i) => i.with === 'month' && i.target === 'branch' && i.tone === 'positive')) signals.push('monthCombine');
  if (h.includes('branch_clash_day')) signals.push('dayClash');
  if (h.includes('branch_combine_day')) signals.push('dayCombine');
  if (h.includes('yeokma')) signals.push('yeokma');
  if (h.includes('cheoneul')) signals.push('cheoneul');
  if (h.includes('munchang')) signals.push('munchang');
  return { year, ev, hanja: ev.pillar.ganzhi.hanja, stemTenGod: ev.pillar.stemTenGod, wealth: ev.scores.wealth, career: ev.scores.career, signals };
}

/** 점수 높은 순(같으면 앞선 해) */
const topBy = (infos: YearInfo[], key: 'wealth' | 'career', n: number) => [...infos].sort((a, b) => b[key] - a[key] || a.year - b.year).slice(0, n);

/** 일의 자리가 바뀌기 쉬운 해 — 대운 교체(성별에 따라 달라짐)를 포함하므로 요약·10년 흐름 장에서만 쓴다 */
function transitionsOf(chart: SajuChart, infos: YearInfo[]) {
  const out = infos
    .map((t) => {
      const keys: TransitionKey[] = [];
      if (chart.daeun.periods.some((p) => p.startYear === t.year)) keys.push('daeun');
      if (t.signals.includes('monthClash')) keys.push('monthClash');
      if (t.signals.includes('yeokma')) keys.push('yeokma');
      if (t.signals.includes('dayClash')) keys.push('dayClash');
      return { year: t.year, keys, weight: keys.reduce((n, k) => n + TRANSITION_WEIGHT[k], 0) };
    })
    .filter((t) => t.keys.length > 0);
  return out
    .sort((a, b) => b.weight - a.weight || a.year - b.year)
    .slice(0, 3)
    .sort((a, b) => a.year - b.year);
}

function structureOf(g: Record<TenGodGroup, number>, weak: boolean): MoneyStructureKey {
  if (g.재성 >= 3 && weak) return 'jaedaSinyak';
  if (g.비겁 >= 3 && g.재성 <= 1) return 'bigeop';
  if (g.식상 >= 1 && g.재성 >= 1 && g.식상 + g.재성 >= 3) return 'siksangSaengjae';
  if (g.관성 + g.인성 >= 3 && g.재성 <= 1) return 'gwanin';
  if (g.재성 === 0) return 'hiddenWealth';
  return 'balanced';
}


/** 한 해 안에서 돈·일의 흐름이 좋은 두 달(절기 기준 월운) — 양력 달로 돌려준다. 성별을 쓰지 않는다 */
function bestMonths(chart: SajuChart, year: number, key: 'wealth' | 'career' | 'both' = 'both'): { year: number; month: number }[] {
  return wolun(chart.dayMaster.index, year)
    .map((m, i) => {
      const ev = evaluateFortune(chart, m, `cw-${year}-m${m.order}`);
      return { i, s: key === 'both' ? ev.scores.wealth + ev.scores.career : ev.scores[key] };
    })
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, 2)
    .sort((a, b) => a.i - b.i)
    .map(({ i }) => (i === 11 ? { year: year + 1, month: 1 } : { year, month: i + 2 }));
}

/** 이유 여럿을 한 문장으로 — '○○년에는 …고, …요.' */
const clauseSentence = (head: string, cs: Clause[]) => `${head} ${[...cs.slice(0, -1).map((x) => x.and), cs[cs.length - 1]!.end].join(', ')}.`;

export function buildCareerWealthReport(chart: SajuChart, now = new Date(), rawName?: string | null): ReadingSection[] {
  const name = displayName(rawName);
  /** 용어 — 리포트에서 처음 부를 때만 뜻을 붙인다 */
  const t = termTracker();
  const el = (e: Element, a?: string, b?: string) => t(EL_NAME[e], a, b);
  /** 콘텐츠 문장 속 '{관성}' 같은 자리에 용어를 채운다(처음이면 뜻과 함께) */
  const fill = (s: string) => s.replace(/\{([^}]+)\}/g, (_, k: string) => t(k));
  const stemName = stemTerm(chart);
  const S2 = C.stem[chart.dayMaster.index]!;
  const g = groupCount(chart);
  const tc = chart.tenGodCount;
  const st = chart.strength;
  const level = st.level;
  const band: StrengthBand = st.score > 58 ? 'strong' : st.score < 42 ? 'weak' : 'mid';
  const y = chart.yongsin;
  const structureKey = structureOf(g, band === 'weak');
  const S = C.structure[structureKey];
  const E = C.element[y.yongsin];
  const groupsTerm = GROUPS.map((k) => `${k} ${g[k]}`).join(' · ');

  // 세력(가중치)으로 본 가장 강한 무리 — 글자 수보다 월지·일지의 무게가 반영된다
  const gs = st.groupScore;
  const gsTotal = GROUPS.reduce((n, k) => n + gs[k], 0) || 1;
  const ranked = [...GROUPS].sort((a, b) => gs[b] - gs[a] || GROUPS.indexOf(a) - GROUPS.indexOf(b));
  const top = ranked[0]!;
  const second = ranked[1]!;
  const share = (k: TenGodGroup) => Math.round((gs[k] / gsTotal) * 100);

  // 직장형·독립형
  const org = g.관성 + g.인성;
  const indep = g.식상 + g.비겁 + tc.편재;
  const employmentKey: EmploymentKey = org - indep >= 2 ? 'organization' : indep - org >= 2 ? 'independent' : 'hybrid';
  const EMP = C.employment[employmentKey];

  // 세운 — 앞으로 10년(신년운세와 같은 기준: KST 10월부터는 다음 해부터)
  const start = targetFortuneYear(now);
  const infos = Array.from({ length: 10 }, (_, i) => yearInfo(chart, start + i));
  const three = infos.slice(0, 3);
  const bestWealth = topBy(infos, 'wealth', 2);
  const bestCareer = topBy(infos, 'career', 2);
  const transitions = transitionsOf(chart, infos);

  // ── 한눈에 보기 — 요약 카드라 용어 없이 쓴다(용어는 각 장에서 처음 나올 때 풀이) ──
  const summary: ReadingSection = {
    key: 'summary',
    title: '한눈에 보는 재물·직업운',
    summary: S.title,
    keywords: [S.label, EMP.title, `돈 ${bestWealth[0]!.year}년`, `일 ${bestCareer[0]!.year}년`],
    paragraphs: [
      `${nameSubject(name, '은')}${S.lead}`,
      `일할 때는 '${C.group[top].name}'${prt(C.group[top].name, '이', '가')} 가장 크게 움직이고, 조직과 독립 가운데서는 '${EMP.title}'에 조금 더 가까워요.`,
      C.summaryAdvice[structureKey],
      `${
        bestWealth[0]!.year === bestCareer[0]!.year
          ? `앞으로 10년 가운데 돈과 일 모두 흐름이 가장 좋은 해는 ${bestWealth[0]!.year}년이에요.`
          : `앞으로 10년 가운데 돈의 흐름이 가장 좋은 해는 ${bestWealth[0]!.year}년, 일의 흐름이 가장 좋은 해는 ${bestCareer[0]!.year}년이에요.`
      } ${
        transitions.length
          ? `일의 자리가 바뀌기 쉬운 해는 ${pp(yearsText(transitions.map((x) => x.year)), '이에요', '예요')}.`
          : '일의 자리가 크게 바뀔 만한 해는 따로 보이지 않아요. 지금 하는 일을 이어 가며 경력을 쌓기 좋은 10년이에요.'
      }`,
      C.summaryGuide,
      C.whereToStart,
    ],
    basis: [
      `일간 ${stemName}`,
      `재물 구조 ${S.term}`,
      `일간의 힘 ${level}`,
      `용신 ${EL_TERM[y.yongsin]}`,
      `가장 강한 십성 무리 ${top}`,
      `직장형·독립형 ${org}:${indep}`,
      `재물 최고 ${bestWealth[0]!.year} ${bestWealth[0]!.hanja} · 일 최고 ${bestCareer[0]!.year} ${bestCareer[0]!.hanja}(달빛사주 기준)`,
      ...(transitions.length ? [`전환 신호 ${transitions.map((x) => `${x.year}(${x.keys.map((k) => TRANSITION_TERM[k]).join('·')})`).join(', ')}`] : []),
    ].join(' · '),
  };

  // ── 돈이 들어오는 방식 ─────────────────────────────────────
  const wealthEl = elementOfGroup(chart.dayMaster.index, '재성');
  const wealthPct = Math.round(chart.elements.percent[wealthEl]);
  const wealthLevel = wealthPct >= 25 ? 'rich' : wealthPct >= 12 ? 'fair' : wealthPct > 0 ? 'light' : 'none';
  const termsPara = `사주는 ${t('일간', '을', '를')} 중심으로 읽어요. 돈과 관련해서는 ${t('십성')} 가운데 ${t('재성')}, ${t('식상')}, ${t('비겁', '을', '를')} 함께 봅니다. ${C.moneyFlowIntro} ${fill(S.reason)}`;
  const moneyFlow: ReadingSection = {
    key: 'moneyFlow',
    title: '돈이 들어오는 방식',
    summary: `${S.label}에 가까워요`,
    paragraphs: [
      S.flow,
      S.example,
      termsPara,
      wealthLevel === 'none'
        ? `재성에 해당하는 오행인 ${el(wealthEl, '은', '는')} 사주에서 거의 보이지 않아요. ${C.wealthLevel.none}`
        : `재성에 해당하는 오행인 ${el(wealthEl)}의 비중은 지장간까지 반영한 달빛사주 기준으로 약 ${wealthPct}%예요. ${C.wealthLevel[wealthLevel]}`,
      ...(['재성', '식상', '비겁'] as const).filter((k) => g[k] === 0 && !(k === '재성' && structureKey === 'hiddenWealth')).map((k) => C.groupAbsentMoney[k]),
      `먼저 강점입니다. ${S.strength}`,
      `한편 ${S.watch}`,
      S.leak,
      S.grow,
    ],
    basis: `십성 ${groupsTerm} → ${S.term} · 재물 오행 ${EL_TERM[wealthEl]} 약 ${wealthPct}%(지장간·월령 가중, 달빛사주 기준)`,
  };

  // ── 감당하기 좋은 돈의 크기 ──────────────────────────────
  const helps = (['deukryeong', 'deukji', 'deukse'] as const).filter((k) => st[k]);
  const terms = { deukryeong: '득령', deukji: '득지', deukse: '득세' } as const;
  const shareKey = st.score < 30 ? 'low' : st.score < 45 ? 'someLow' : st.score <= 58 ? 'half' : st.score <= 70 ? 'high' : 'veryHigh';
  const strengthWealth =
    band === 'strong' ? (g.재성 > 0 ? C.strengthWealth.strongWith : C.strengthWealth.strongWithout) : band === 'weak' ? (g.재성 >= 2 ? C.strengthWealth.weakHeavy : C.strengthWealth.weakLight) : C.strengthWealth.mid;
  const monthStage = chart.pillars.month.branch.twelveStage;
  const helpText = helps.length ? `${helps.map((k) => C.helpFrom[k]).join(', ')}에 해당해요.` : C.helpNone;
  const strength: ReadingSection = {
    key: 'strength',
    title: '감당하기 좋은 돈의 크기',
    summary: BAND_SUMMARY[band],
    paragraphs: [
      `${t('신강·신약', '으로')} 보면 ${nameSubject(name, '은')}${level}에 해당해요. ${C.strength[level].vessel}`,
      `일간을 돕는 기운(일간과 같은 오행, 일간을 생하는 오행)의 비중은 ${Math.round(st.score)}%로 ${C.helpShare[shareKey]}. 이 비중과 단계 이름은 달빛사주가 계산한 지표입니다. ${helpText}`,
      C.strength[level].scale,
      C.strength[level].work,
      strengthWealth,
      C.strength[level].grow,
      C.monthStage[monthStage],
    ],
    tips: [C.strength[level].action],
    basis: `일간의 힘 ${level}(돕는 기운 ${Math.round(st.score)}%, 달빛사주 기준)${helps.length ? ` · ${helps.map((k) => terms[k]).join('·')}` : ''} · 재성 ${g.재성} · 월지 12운성 ${monthStage}`,
  };

  // ── 버는 방식과 지키는 방식 ──────────────────────────────
  const earnRanked = EARN_ORDER.filter((k) => tc[k] > 0).sort((a, b) => tc[b] - tc[a] || EARN_ORDER.indexOf(a) - EARN_ORDER.indexOf(b));
  const earn: EarnKey = earnRanked[0] ?? 'none';
  const earnSecond = earnRanked[1];
  const keep: KeepKey = g.비겁 >= 3 || tc.겁재 >= 2 ? 'shared' : g.재성 >= 3 ? 'active' : g.식상 >= 3 ? 'expressive' : g.인성 >= 3 ? 'cautious' : 'steady';
  const keepTerm: Record<KeepKey, string> = {
    shared: `비겁 ${g.비겁}개 · 겁재 ${tc.겁재}개`,
    active: `재성 ${g.재성}개`,
    expressive: `식상 ${g.식상}개`,
    cautious: `인성 ${g.인성}개`,
    steady: '고른 분포',
  };
  const db = chart.pillars.day.branch;
  const earnKeep: ReadingSection = {
    key: 'earnKeep',
    title: '버는 방식과 지키는 방식',
    summary: `${ro(C.earnShort[earn])} 벌고, ${C.keepSummary[keep]}`,
    paragraphs: [
      earn === 'none'
        ? C.earn.none
        : `버는 방식을 보여 주는 십성 가운데 ${t(earn, '이', '가')} 가장 많아요. ${C.earn[earn]}${earnSecond ? ` ${t(earnSecond, '도', '도')} 있어 ${C.earnSecond[earnSecond]}` : ''}`,
      C.earnExample[earn],
      `지키는 쪽을 보면, ${C.keep[keep]}`,
      C.dayBranchMoney[db.tenGod],
      `일간의 기질로 보면 ${S2.money}`,
      C.group[top].negotiate,
    ],
    tips: [C.earnGoal[earn]],
    basis: `버는 방식 ${earn === 'none' ? '편재·정재·식신·상관 없음(자리·경력형)' : `${earn} ${tc[earn]}개`} · 지키는 방식 ${keepTerm[keep]} · 일지 ${db.hanja}(${db.tenGod}) · 일간 ${stemName}`,
  };

  // ── 일하는 방식 ──────────────────────────────────────────
  const mb = chart.pillars.month.branch;
  const workStyle: ReadingSection = {
    key: 'workStyle',
    title: '일하는 방식',
    summary: `'${C.group[top].name}'${prt(C.group[top].name, '이', '가')} 일하는 방식의 중심이에요`,
    keywords: [C.group[top].name, C.group[second].name],
    paragraphs: [
      `${nameSubject(name, '의')}사주에서 세력이 가장 큰 십성 무리는 ${t(top)}입니다. ${C.group[top].style}`,
      `두 번째로는 ${t(second, '이', '가')} 받쳐 줘요. ${C.group[second].second}`,
      C.group[top].environment,
      `${C.group[top].praised} 반대로 ${C.group[top].tired}`,
      `사회생활의 환경은 ${t('월지', '으로')} 보는데, ${nameSubject(name, '의')}월지에는 ${t(mb.tenGod, '이', '가')} 있어요. ${C.monthBranchCareer[mb.tenGod]}`,
      `일간의 기질만 떼어 보면, ${S2.work} ${S2.heard}`,
      `${E.colleague} ${E.dayRhythm}`,
      `일에서 쓰는 강점은 ${pp([...S2.strengths].join(', '), '이에요', '예요')}.`,
      `보완하면 좋은 점도 있어요. ${S2.caution}`,
    ],
    basis: `십성 세력(자리별 가중치, 달빛사주 기준) ${GROUPS.map((k) => `${k} ${share(k)}%`).join(' · ')} · 월지 ${mb.hanja}(${mb.tenGod}) · 일주 ${chart.pillars.day.ganzhi.hanja}`,
  };

  // ── 어울리는 일과 분야 ────────────────────────────────────
  const shinsalNames = new Set(chart.shinsal.map((s) => s.name));
  const careerShinsal = CAREER_SHINSAL.filter((n) => shinsalNames.has(n)).slice(0, 3);
  const H = C.element[y.heesin];
  const shinsalParas = careerShinsal.length
    ? [
        `직업과 관련된 ${t('신살', '으로')}는 ${pp(careerShinsal.map((n) => SHINSAL_NAME[n]).join('·'), '이', '가')} 있어요.`,
        ...careerShinsal.map((n) => `${ro(SHINSAL_NAME[n])} 보면, ${C.shinsal[n]}`),
      ]
    : [`직업과 관련해 눈에 띄는 ${t('신살', '은', '는')} 없어요. ${C.shinsalNone}`];
  const fields: ReadingSection = {
    key: 'fields',
    title: '어울리는 일과 분야',
    summary: `${E.fields.slice(0, 2).join(', ')} 같은 일이 잘 맞아요`,
    keywords: E.fields.slice(0, 4),
    paragraphs: [
      `${nameSubject(name, '의')}${t('용신', '은', '는')} ${el(y.yongsin)}입니다. 그래서 ${E.why} 용신은 학파와 방법에 따라 달라질 수 있으며, 달빛사주는 일간의 강약을 기준으로 정하는 간이 방식(억부)을 씁니다.`,
      `이런 일로는 ${E.fields.join(', ')} 같은 분야가 있어요.`,
      `${t('희신')}인 ${el(y.heesin, '과', '와')} 관련된 ${H.fields.slice(0, 3).join(', ')}도 함께 살펴볼 만해요.`,
      `반대로 ${t('기신')}인 ${el(y.gisin)}의 성질로 보면, ${C.gisinEnvironment[y.gisin]}`,
      `일간의 기질로 보면 ${S2.jobs.join(', ')} 같은 일도 잘 어울려요.`,
      `가장 강한 ${ro(top)} 보면 ${C.group[top].fields}`,
      ...shinsalParas,
      `${C.fieldsOutro} ${E.now}`,
    ],
    basis: [`용신 ${EL_TERM[y.yongsin]}`, `희신 ${EL_TERM[y.heesin]}`, `기신 ${EL_TERM[y.gisin]}`, `가장 강한 십성 무리 ${top}`, careerShinsal.length ? `신살 ${careerShinsal.join(', ')}` : '직업 관련 신살 없음'].join(' · '),
  };

  // ── 직장형·독립형 ────────────────────────────────────────
  const employment: ReadingSection = {
    key: 'employment',
    title: '직장형일까, 독립형일까',
    summary: EMP.summary,
    paragraphs: [
      `${nameSubject(name, '은')}조직과 독립 가운데 '${EMP.title}'에 조금 더 가까워요. ${EMP.body}`,
      `달빛사주는 ${t('관성', '과', '와')} ${t('인성', '을', '를')} 조직 안에서 인정받으며 크는 기운으로, 식상·비겁·${t('편재', '을', '를')} 스스로 일을 꾸리는 기운으로 봅니다. ${C.employmentIntro}`,
      C.employmentByStrength[band],
      C.employmentPath[employmentKey],
      C.employmentCheck[employmentKey],
      C.employmentNow[employmentKey],
      C.employmentOutro,
    ],
    tips: [EMP.tip],
    basis: `조직형 기운(관성 ${g.관성} + 인성 ${g.인성}) ${org} · 독립형 기운(식상 ${g.식상} + 비겁 ${g.비겁} + 편재 ${tc.편재}) ${indep} · 일간의 힘 ${level}`,
  };

  // ── 앞으로 10년 ──────────────────────────────────────────
  // 장 첫 문단(C.decadeIntro)이 세운·대운의 뜻을 말한다 — 성별과 무관한 고정 문장이라 바로 기록한다
  t.mark('세운', '대운');
  // 대운 문단은 성별에 따라 달라지므로 갈라 쓴 기록으로 — 뒤 장의 글이 성별에 따라 바뀌지 않게
  const td = t.fork();
  const avg = (x: YearInfo) => x.wealth + x.career;
  const byAvg = [...infos].sort((a, b) => avg(b) - avg(a) || a.year - b.year);
  const rhythm = { push: byAvg.slice(0, 3).sort((a, b) => a.year - b.year), rest: byAvg.slice(-2).sort((a, b) => a.year - b.year) };
  const periods = chart.daeun.periods;
  const cur = periods.find((p) => start >= p.startYear && start <= p.endYear);
  const next = periods.find((p) => p.startYear > start && p.startYear <= start + 9);
  const daeunLines: string[] = [];
  if (cur) {
    const grp = TEN_GOD_GROUP[cur.stemTenGod];
    daeunLines.push(`대운으로 보면, ${cur.startYear}년부터 ${cur.endYear}년까지는 대운의 천간이 ${td(grp, '에', '에')} 해당해, ${C.group[grp].decade} ${C.group[grp].decadeMoney}`, C.daeunUse[cur.stemTenGod]);
  } else if (next) {
    daeunLines.push(`첫 대운은 ${next.startYear}년에 시작돼요. 그 전까지는 타고난 사주와 해마다 들어오는 세운의 영향이 더 직접 드러난다고 봐요.`);
  } else {
    daeunLines.push('달빛사주가 계산한 대운의 마지막 단계를 지나, 해마다 들어오는 세운의 영향을 더 직접 받는 때로 봐요.');
  }
  if (next && cur) {
    const ngrp = TEN_GOD_GROUP[next.stemTenGod];
    const same = TEN_GOD_GROUP[cur.stemTenGod] === ngrp;
    daeunLines.push(`${next.startYear}년부터 ${next.endYear}년까지는 ${same ? C.sameGroupDaeun : `대운의 천간이 ${td(ngrp, '에', '에')} 해당해, ${C.group[ngrp].decade} ${C.group[ngrp].decadeMoney}`}`);
  }
  if (cur || next) daeunLines.push(C.daeunNote);
  const transitionYears = new Set(transitions.map((x) => x.year));
  const decade: ReadingSection = {
    key: 'decade',
    title: `앞으로 10년의 흐름 (${start}~${start + 9})`,
    summary: bestWealth[0]!.year === bestCareer[0]!.year ? `10년 가운데 ${bestWealth[0]!.year}년이 돈과 일 모두 가장 좋아요` : `10년 가운데 돈은 ${bestWealth[0]!.year}년, 일은 ${bestCareer[0]!.year}년이 가장 좋아요`,
    keywords: [`돈 ${bestWealth[0]!.year}`, `일 ${bestCareer[0]!.year}`, ...transitions.map((x) => `변화 ${x.year}`)],
    paragraphs: [
      C.decadeIntro,
      `돈과 일을 함께 보면 넓히기 좋은 해는 ${yearsText(rhythm.push.map((x) => x.year))}, 다지기 좋은 해는 ${pp(yearsText(rhythm.rest.map((x) => x.year)), '이에요', '예요')}. ${C.rhythmTail}`,
      ...infos.map((x) => `${x.year}년 · 돈 ${word(x.wealth)} · 일 ${word(x.career)} · ${(x.wealth < 50 && x.career < 50 ? C.yearLineLow : C.yearLine)[x.stemTenGod]}${transitionYears.has(x.year) ? ' · 일의 자리가 바뀌기 쉬움' : ''}`),
      `돈의 흐름이 가장 좋은 해는 ${bestWealth.map((x) => `${x.year}년`).join('과 ')}이에요. ${bestWealth.map((x) => `${x.year}년은 ${C.yearWealth[x.stemTenGod]}`).join(' ')} 특히 ${bestWealth[0]!.year}년 ${monthsText(bestWealth[0]!.year, bestMonths(chart, bestWealth[0]!.year, 'wealth'))} 무렵을 눈여겨보세요.`,
      `일의 흐름이 가장 좋은 해는 ${bestCareer.map((x) => `${x.year}년`).join('과 ')}이에요. ${bestCareer.map((x) => `${x.year}년은 ${C.yearCareer[x.stemTenGod]}`).join(' ')} 일은 ${bestCareer[0]!.year}년 ${monthsText(bestCareer[0]!.year, bestMonths(chart, bestCareer[0]!.year, 'career'))} 무렵에 특히 성과를 내기 좋아요.`,
      ...(transitions.length
        ? [
            `${yearsText(transitions.map((x) => x.year))}에는 일에 변화가 생기기 쉬우니, 미리 이력과 포트폴리오를 정리해 두면 기회가 왔을 때 빠르게 움직일 수 있어요.`,
            ...transitions.map((x) => clauseSentence(`${x.year}년에는`, x.keys.map((k) => C.transition[k]))),
            // 같은 신호의 조언은 처음 나온 한 번만
            ...transitions
              .map((x) => x.keys[0]!)
              .filter((k, i, a) => a.indexOf(k) === i)
              .slice(0, 2)
              .map((k) => C.transitionTip[k]),
          ]
        : [C.noTransition]),
      ...daeunLines,
    ],
    basis: [
      ...infos.map((x) => `${x.year} ${x.hanja} 재물 ${x.wealth}·일 ${x.career}(${x.stemTenGod}${x.ev.fit.stem !== 'neutral' ? `, ${x.ev.fit.stem === 'yongsin' ? '용신' : x.ev.fit.stem === 'heesin' ? '희신' : '기신'}` : ''}${x.signals.length ? `, ${x.signals.map((k) => SIGNAL_TERM[k]).join(', ')}` : ''})`),
      ...(cur ? [`대운 ${cur.startYear}~${cur.endYear} ${cur.ganzhi.hanja}(${cur.stemTenGod})`] : []),
      ...(next ? [`대운 ${next.startYear}~${next.endYear} ${next.ganzhi.hanja}(${next.stemTenGod})`] : []),
      '재물·일 점수와 등급은 달빛사주 기준',
    ].join(' · '),
  };

  // ── 가까운 3년 ───────────────────────────────────────────
  const best3W = topBy(three, 'wealth', 1)[0]!;
  const best3C = topBy(three, 'career', 1)[0]!;
  const threeParas: string[] = [C.threeYearsIntro];
  const bandSeen = new Map<string, number>();
  const wSeen = new Map<string, number>();
  const cSeen = new Map<string, number>();
  const nth = (m: Map<string, number>, k: string) => {
    const v = m.get(k) ?? 0;
    m.set(k, v + 1);
    return v % 2;
  };
  for (const x of three) {
    const b = scoreBand(x.career);
    const v = bandSeen.get(b) ?? 0;
    bandSeen.set(b, v + 1);
    const sit = C.situation[b][v % 3]!;
    const btg = x.ev.pillar.branchTenGod;
    const fit = x.ev.fit.stem === 'yongsin' || x.ev.fit.stem === 'heesin' ? [C.fit[x.ev.fit.stem]] : [];
    const flow = [...fit, ...x.signals.map((k) => C.signal[k])].slice(0, 2);
    threeParas.push(
      `${x.year}년 · 돈 ${word(x.wealth)} · 일 ${word(x.career)}`,
      `흐름으로 보면 ${x.year}년은 ${C.wealthBand[scoreBand(x.wealth)][nth(wSeen, scoreBand(x.wealth))]}, ${C.careerBand[scoreBand(x.career)][nth(cSeen, scoreBand(x.career))]}.`,
      `${x.year}년은 세운의 천간이 ${t(x.stemTenGod, '이라', '라')} ${(x.career < 50 ? C.yearWorkLow : C.yearWork)[x.stemTenGod]}`,
      `돈 쪽으로는 ${C.yearMoney[x.stemTenGod]}`,
      ...(btg !== x.stemTenGod ? [`생활 속에서는 ${C.yearBase[btg]}`] : []),
      flow.length ? clauseSentence(`${x.year}년에는`, flow) : `${x.year}년에는 ${C.quietYear}`,
      `한 해의 리듬으로 보면 ${x.year}년은 ${C.stageWork[x.ev.pillar.twelveStage]} ${x.year}년 안에서는 ${monthsText(x.year, bestMonths(chart, x.year))} 무렵의 흐름이 상대적으로 좋아요.`,
      `회사에 다니는 분 — ${sit.employee}`,
      `내 일을 하는 분 — ${sit.own}`,
      `일을 쉬거나 준비 중인 분 — ${sit.rest}`,
    );
  }
  const threeYears: ReadingSection = {
    key: 'threeYears',
    title: `가까운 3년, 한 해씩 (${start}~${start + 2})`,
    summary: best3W.year === best3C.year ? `가까운 3년 가운데는 ${best3W.year}년의 흐름이 가장 좋아요` : `돈은 ${best3W.year}년, 일은 ${best3C.year}년의 흐름이 가장 좋아요`,
    keywords: three.map((x) => `${x.year} 돈 ${word(x.wealth)}`),
    paragraphs: threeParas,
    tips: three.map((x) => `${x.year}년 — ${C.yearAction[x.stemTenGod]}`),
    basis: three
      .map((x) => `${x.year} ${x.hanja} — 천간 ${x.stemTenGod} · 지지 ${x.ev.pillar.branchTenGod} · 12운성 ${x.ev.pillar.twelveStage}${x.ev.fit.stem !== 'neutral' ? ` · 천간 ${x.ev.fit.stem === 'yongsin' ? '용신' : x.ev.fit.stem === 'heesin' ? '희신' : '기신'}` : ''}${x.signals.length ? ` · ${x.signals.map((k) => SIGNAL_TERM[k]).join(', ')}` : ''}`)
      .join(' / '),
  };

  // ── 조심할 점 ────────────────────────────────────────────
  const riskChecks: [RiskKey, boolean, string][] = [
    ['bigeop', g.비겁 >= 3 || tc.겁재 >= 2, `비겁 ${g.비겁}개 · 겁재 ${tc.겁재}개`],
    ['sanggwanGyeongwan', tc.상관 >= 1 && tc.정관 >= 1, `상관 ${tc.상관}개 · 정관 ${tc.정관}개`],
    ['gwanHeavy', g.관성 >= 3, `관성 ${g.관성}개`],
    ['siksangHeavy', g.식상 >= 3, `식상 ${g.식상}개`],
    ['inseongHeavy', g.인성 >= 3, `인성 ${g.인성}개`],
    // 재물 구조가 '실력 축적형'이면 앞 장에서 같은 이야기를 했으니 되풀이하지 않는다
    ['noWealth', g.재성 === 0 && structureKey !== 'hiddenWealth', '재성 0개'],
  ];
  const risksHit = riskChecks.filter(([, hit]) => hit).slice(0, 3);
  const ORDINAL = ['첫째', '둘째', '셋째'];
  const gisinYears = three.filter((x) => x.ev.fit.stem === 'gisin' || x.ev.fit.branch === 'gisin');
  const risks: ReadingSection = {
    key: 'risks',
    title: '조심할 점 — 미리 알아 두면 좋은 것',
    summary: risksHit.length ? `${['', '한', '두', '세'][risksHit.length]} 가지만 알아 두면 돈 때문에 당황할 일이 줄어요` : '크게 치우친 곳이 적어, 점검 습관만 챙기면 돼요',
    paragraphs: [
      C.riskIntro,
      ...(risksHit.length ? risksHit.map(([k], i) => (risksHit.length > 1 ? `${ORDINAL[i]}, ${fill(C.risk[k])}` : fill(C.risk[k]))) : [C.riskGeneral]),
      C.riskMind[band],
      gisinYears.length
        ? `가까운 3년 가운데 ${yearsText(gisinYears.map((x) => x.year))}에는 세운에 ${t('기신')}의 기운이 들어와 균형이 흐트러지기 쉽다고 봐요. 나쁜 해라는 뜻은 아니지만, 새 일을 크게 벌이기보다 지출과 계약을 한 번 더 점검하는 편이 좋습니다.`
        : `가까운 3년에는 세운에 ${t('기신')}의 기운이 들어오는 해가 없어요. 세워 둔 계획을 차분히 이어 가면 됩니다.`,
      C.riskChecklist,
    ],
    tips: [...C.riskChecks],
    basis: [...(risksHit.length ? risksHit.map(([, , label]) => label) : ['두드러진 치우침 없음']), `기신 ${EL_TERM[y.gisin]}${gisinYears.length ? `(기신이 드는 해 ${gisinYears.map((x) => x.year).join('·')})` : ''}`].join(' · '),
  };

  // ── 돈 습관 ──────────────────────────────────────────────
  const habits: ReadingSection = {
    key: 'habits',
    title: '돈을 지키는 습관',
    summary: '자동이체·지출 기록·비상금, 그리고 나에게 맞는 습관 하나',
    keywords: ['자동이체', '지출 기록', '비상금'],
    paragraphs: [
      `용신인 ${EL_NAME[y.yongsin]}의 성향에 맞는 돈 습관부터 살펴볼게요. ${E.habit} ${E.monthAction}`,
      `${S.label}에게 잘 맞는 습관도 있어요. ${S.habit}`,
      C.habitByBand[band],
      C.habitMonthly,
      C.financeNote,
      C.habitIntro,
    ],
    tips: [...C.habitBasic],
    basis: `용신 ${EL_TERM[y.yongsin]} · 재물 구조 ${S.term} · 일간의 힘 ${level}`,
  };

  // ── 마무리 ───────────────────────────────────────────────
  const closing: ReadingSection = {
    key: 'closing',
    title: '마무리 — 나에게 맞게 벌고 쓰는 법',
    summary: '내 속도에 맞춰 벌고 지키면 돼요',
    paragraphs: [`${nameSubject(name, '의')}${S.closing}`, C.closingByBand[band], `${name ? `${name}님에게 마지막으로` : '마지막으로'} 한 가지만 덧붙일게요. ${S2.oneLine}`, C.closingNote, C.closingReread],
  };

  return [summary, moneyFlow, strength, earnKeep, workStyle, fields, employment, decade, threeYears, risks, habits, closing];
}
