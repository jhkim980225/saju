/**
 * 재물·직업운 리포트(report_career_wealth) — 저장한 프로필 하나에 대한 주제별 유료 리포트.
 *
 * 구성(12장): 한눈에 보기 → 돈이 흐르는 구조 → 신강·신약과 돈 그릇 → 버는·지키는 방식 → 일하는 방식
 *   → 어울리는 분야 → 직장형·독립형 → 앞으로 10년 → 가까운 3년 → 조심할 점 → 재물 습관 → 마무리.
 * 근거: 십성 개수(재성·식상·비겁·관성·인성)와 세력, 일간의 힘(득령·득지·득세), 용신·희신·기신, 신살,
 *   세운(십성·월지/일지 합충·역마·용신 적합도), 대운.
 * 성별은 읽지 않는다. 대운은 성별에 따라 순행·역행이 갈리므로 요약(summary)과 10년 흐름(decade) 장에서만 쓴다.
 * 분량 목표: 공백 뺀 8천~1만 자(AI 다듬기 전). 규칙 기반 초안이 사실을 모두 담고, AI 는 문장만 다듬는다.
 */
import {
  TEN_GOD_GROUP,
  elementOfGroup,
  evaluateFortune,
  yearPillarOf,
  type FortuneEvaluation,
  type SajuChart,
  type TenGod,
  type TenGodGroup,
} from '@saju/core';
import type { ReadingSection } from '@saju/shared';
import {
  CAREER_WEALTH_REPORT as C,
  type CareerShinsalName,
  type EarnKey,
  type EmploymentKey,
  type KeepKey,
  type MoneyStructureKey,
  type RiskKey,
  type StrengthBand,
  type TransitionKey,
  type YearSignalKey,
} from './content/careerWealthReport.js';
import { TEN_GOD_CONTENT } from './content/index.js';
import { LUCK_CONTENT } from './content/luck.js';
import { EL_NAME, band as scoreBand, dayMasterContent, dayPillarContent, groupCount, targetFortuneYear } from './reading.js';
import { GROUPS, elp, ieyo, particle, pct } from './report.js';

/** 세운 목록 줄에 붙이는 짧은 꼬리표 */
const SIGNAL_TAG: Record<YearSignalKey, string> = {
  monthClash: '월지 충',
  monthCombine: '월지 합',
  dayClash: '일지 충',
  dayCombine: '일지 합',
  yeokma: '역마',
  cheoneul: '천을귀인',
  munchang: '문창귀인',
};
const TRANSITION_TAG: Record<TransitionKey, string> = { daeun: '대운 교체', monthClash: '월지 충', yeokma: '역마', dayClash: '일지 충' };
const TRANSITION_WEIGHT: Record<TransitionKey, number> = { daeun: 3, monthClash: 2, yeokma: 1, dayClash: 1 };
const CAREER_SHINSAL: CareerShinsalName[] = ['역마살', '문창귀인', '화개살', '천을귀인', '학당귀인'];
const EARN_ORDER: Exclude<EarnKey, 'none'>[] = ['정재', '편재', '식신', '상관'];
const KEEP_SUMMARY: Record<KeepKey, string> = {
  shared: '나눌 돈의 선을 정하면 지켜져요',
  active: '흐름을 한 장에 정리하면 지켜져요',
  expressive: '즐거움 예산을 정하면 지켜져요',
  cautious: '결정 규칙을 세우면 지켜져요',
  steady: '이름 붙인 통장으로 지켜져요',
};
const BAND_SUMMARY: Record<StrengthBand, string> = {
  strong: '그릇이 크고 단단한 편이에요',
  mid: '상황에 따라 그릇을 조절하는 편이에요',
  weak: '작은 그릇 여러 개로 나눠 담는 편이에요',
};

/** 글자 수·가짓수를 우리말로 */
const COUNT_WORD: Record<number, string> = { 1: '한', 2: '두', 3: '세', 4: '네', 5: '다섯', 6: '여섯', 7: '일곱' };

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
  return {
    year,
    ev,
    hanja: ev.pillar.ganzhi.hanja,
    stemTenGod: ev.pillar.stemTenGod,
    wealth: ev.scores.wealth,
    career: ev.scores.career,
    signals,
  };
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

export function buildCareerWealthReport(chart: SajuChart, now = new Date()): ReadingSection[] {
  const dm = dayMasterContent(chart);
  const dp = dayPillarContent(chart);
  const g = groupCount(chart);
  const tc = chart.tenGodCount;
  const st = chart.strength;
  const level = st.level;
  const band: StrengthBand = st.score > 58 ? 'strong' : st.score < 42 ? 'weak' : 'mid';
  const y = chart.yongsin;
  const structureKey = structureOf(g, band === 'weak');
  const S = C.structure[structureKey];
  const E = C.element[y.yongsin];

  // 세력(가중치)으로 본 가장 강한 무리 — 글자 수보다 월지·일지의 무게가 반영된다
  const gs = st.groupScore;
  const gsTotal = GROUPS.reduce((n, k) => n + gs[k], 0) || 1;
  const ranked = [...GROUPS].sort((a, b) => gs[b] - gs[a] || GROUPS.indexOf(a) - GROUPS.indexOf(b));
  const top = ranked[0]!;
  const second = ranked[1]!;
  const share = (k: TenGodGroup) => pct((gs[k] / gsTotal) * 100);

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

  // ── 한눈에 보기 ───────────────────────────────────────────
  const summary: ReadingSection = {
    key: 'summary',
    title: '한눈에 보는 재물·직업운',
    summary: `${S.name} — ${S.title}`,
    keywords: [S.name, level, `용신 ${EL_NAME[y.yongsin]}`, EMP.title],
    paragraphs: [
      `${dm.title}에 비유되는 일간 ${dm.name}의 재물 구조는 '${S.name}'에 가까워요. ${S.title}${particle(S.title, '이라는', '라는')} 뜻이에요. 일간의 힘은 '${level}'이고, 나에게 힘이 되는 기운(용신)은 ${EL_NAME[y.yongsin]}${elp(y.yongsin, '이에요', '예요')}.`,
      `일하는 방식은 ${top}의 힘이 중심이고, 직장형·독립형으로 보면 '${EMP.title}'에 조금 더 가까워요.`,
      C.summaryAdvice[structureKey],
      `앞으로 10년(${start}~${start + 9}년) 가운데 재물의 흐름이 가장 넉넉한 해는 ${bestWealth[0]!.year}년, 일에 힘이 실리는 해는 ${bestCareer[0]!.year}년이에요. ${
        transitions.length
          ? `일의 자리가 바뀌기 쉬운 전환의 창은 ${transitions.map((t) => `${t.year}년(${t.keys.map((k) => TRANSITION_TAG[k]).join('·')})`).join(', ')}이에요.`
          : '일의 자리를 크게 흔드는 전환 신호는 두드러지지 않아, 지금의 자리에서 깊이를 더하기 좋은 10년이에요.'
      }`,
      C.summaryGuide,
    ],
  };

  // ── 돈이 흐르는 구조 ─────────────────────────────────────
  const total = GROUPS.reduce((n, k) => n + g[k], 0);
  const wealthEl = elementOfGroup(chart.dayMaster.index, '재성');
  const wealthPct = pct(chart.elements.percent[wealthEl]);
  const wealthLevel =
    wealthPct >= 25 ? '재물의 기운이 넉넉한 편이에요' : wealthPct >= 12 ? '재물의 기운이 알맞게 흐르는 편이에요' : wealthPct > 0 ? '재물의 기운이 가볍게 깔린 편이에요' : '재물의 기운이 원국에서는 쉬고 있는 편이에요';
  const structureReason: Record<MoneyStructureKey, string> = {
    siksangSaengjae: `식상(${g.식상}개)이 재성(${g.재성}개)으로 이어지는 길이 열려 있기 때문이에요.`,
    jaedaSinyak: `재성이 ${g.재성}개로 넉넉한데 일간의 힘은 '${level}'이라, 재물이 일간보다 무겁기 때문이에요.`,
    bigeop: `비겁이 ${g.비겁}개로 많고 재성은 ${g.재성}개로 적기 때문이에요.`,
    gwanin: `관성 ${g.관성}개와 인성 ${g.인성}개가 중심을 이루고 재성은 ${g.재성}개로 적기 때문이에요.`,
    hiddenWealth: '재성이 원국에 한 글자도 드러나 있지 않기 때문이에요.',
    balanced: `재성 ${g.재성}개를 중심으로 어느 기운도 한쪽으로 크게 기울지 않았기 때문이에요.`,
  };
  const moneyFlow: ReadingSection = {
    key: 'moneyFlow',
    title: '돈이 흐르는 구조 — 재성·식상·비겁',
    summary: `${S.name} — ${S.title}`,
    keywords: [`재성 ${g.재성}`, `식상 ${g.식상}`, `비겁 ${g.비겁}`, S.name],
    paragraphs: [
      `일간을 뺀 ${COUNT_WORD[total] ?? total} 글자를 십성으로 나눠 보면 재물을 다루는 재성 ${g.재성}개, 재물을 낳는 식상 ${g.식상}개, 재물을 나눠 갖는 비겁 ${g.비겁}개예요. ${
        g.관성 && g.인성
          ? `여기에 자리와 책임의 관성 ${g.관성}개, 배움의 인성 ${g.인성}개가 함께 있어요.`
          : g.관성
            ? `여기에 자리와 책임의 관성 ${g.관성}개가 함께 있고, 배움의 인성은 드러나 있지 않아요.`
            : g.인성
              ? `여기에 배움의 인성 ${g.인성}개가 함께 있고, 자리와 책임의 관성은 드러나 있지 않아요.`
              : '자리와 책임의 관성, 배움의 인성은 원국에 드러나 있지 않아요.'
      }`,
      C.moneyFlowIntro,
      `이 비율로 보면 '${S.name}'에 가까워요. ${structureReason[structureKey]}`,
      S.flow,
      S.example,
      `오행으로 보면 재물의 오행인 ${EL_NAME[wealthEl]}${elp(wealthEl, '이', '가')} 지장간까지 더해 사주의 약 ${wealthPct}%를 차지해, ${wealthLevel}.`,
      ...(['재성', '식상', '비겁'] as const).filter((k) => g[k] === 0 && !(k === '재성' && structureKey === 'hiddenWealth')).map((k) => C.groupAbsentMoney[k]),
      `강점 — ${S.strength}`,
      `살필 점 — ${S.watch}`,
    ],
  };

  // ── 신강·신약과 돈 그릇 ──────────────────────────────────
  const helps = [st.deukryeong && '태어난 달(월지)', st.deukji && '내가 앉은 자리(일지)', st.deukse && '주변 글자들'].filter((x): x is string => Boolean(x));
  const terms = [st.deukryeong && '득령', st.deukji && '득지', st.deukse && '득세'].filter((x): x is string => Boolean(x));
  const strengthWealth =
    band === 'strong' ? (g.재성 > 0 ? C.strengthWealth.strongWith : C.strengthWealth.strongWithout) : band === 'weak' ? (g.재성 >= 2 ? C.strengthWealth.weakHeavy : C.strengthWealth.weakLight) : C.strengthWealth.mid;
  const monthStage = chart.pillars.month.branch.twelveStage;
  const strength: ReadingSection = {
    key: 'strength',
    title: '신강·신약으로 본 돈 그릇',
    summary: `일간의 힘은 '${level}', ${BAND_SUMMARY[band]}`,
    keywords: [level, `돕는 기운 ${pct(st.score)}%`],
    paragraphs: [
      `일간을 돕는 기운(비겁·인성)이 사주 전체의 약 ${pct(st.score)}%여서, 일간의 힘은 '${level}'에 가까워요. ${
        helps.length
          ? `${helps.join(', ')}에서 힘을 얻고 있어요. 명리에서는 이를 ${terms.join('·')}${particle(terms[terms.length - 1]!, '이라고', '라고')} 불러요.`
          : '월지·일지·주변 글자에서 직접 받는 도움이 적어, 운에서 들어오는 기운에 따라 재물 흐름이 크게 달라지는 편이에요.'
      }`,
      `돈 그릇 — ${C.strength[level].vessel}`,
      `감당하기 좋은 크기 — ${C.strength[level].scale}`,
      `힘을 쓰는 방식 — ${C.strength[level].work}`,
      strengthWealth,
      `일터에서의 기운 — 사회의 자리(월지)에서 일간이 맞는 12운성은 ${monthStage}${ieyo(monthStage)}. ${C.monthStage[monthStage]}`,
      C.strength[level].action,
    ],
  };

  // ── 버는 방식과 지키는 방식 ──────────────────────────────
  const earnRanked = EARN_ORDER.filter((k) => tc[k] > 0).sort((a, b) => tc[b] - tc[a] || EARN_ORDER.indexOf(a) - EARN_ORDER.indexOf(b));
  const earn: EarnKey = earnRanked[0] ?? 'none';
  const earnSecond = earnRanked[1];
  const keep: KeepKey = g.비겁 >= 3 || tc.겁재 >= 2 ? 'shared' : g.재성 >= 3 ? 'active' : g.식상 >= 3 ? 'expressive' : g.인성 >= 3 ? 'cautious' : 'steady';
  const keepBasis: Record<KeepKey, string> = {
    shared: `비겁 ${g.비겁}개 · 겁재 ${tc.겁재}개`,
    active: `재성 ${g.재성}개`,
    expressive: `식상 ${g.식상}개`,
    cautious: `인성 ${g.인성}개`,
    steady: '고른 분포',
  };
  const earnKeep: ReadingSection = {
    key: 'earnKeep',
    title: '버는 방식과 지키는 방식',
    summary: earn === 'none' ? `자리와 경력이 버는 길을 만들고, ${KEEP_SUMMARY[keep]}` : `${earn}의 기운으로 벌고, ${KEEP_SUMMARY[keep]}`,
    keywords: [earn === 'none' ? '자리·경력형' : `${earn} ${tc[earn]}개`, keepBasis[keep]],
    paragraphs: [
      C.earnIntro,
      `버는 방식${earn === 'none' ? '' : `(${earn} ${tc[earn]}개)`} — ${C.earn[earn]}${earnSecond ? ` ${C.earnSecond[earnSecond]}` : ''}`,
      C.earnGoal[earn],
      `지키는 방식(${keepBasis[keep]}) — ${C.keep[keep]}`,
      `일지 ${chart.pillars.day.branch.hanja} — ${C.dayBranchMoney[chart.pillars.day.branch.tenGod]}`,
      `일간 ${dm.name}의 재물 성향 — ${dm.wealth}`,
    ],
  };

  // ── 일하는 방식 ──────────────────────────────────────────
  const workStyle: ReadingSection = {
    key: 'workStyle',
    title: '일하는 방식 — 십성으로 본 업무 성향',
    summary: `${top}의 힘이 일하는 방식의 중심이에요`,
    keywords: [`${top} ${share(top)}%`, `${second} ${share(second)}%`],
    paragraphs: [
      `월지·일지의 무게까지 따져 사주의 힘을 십성 무리별로 나눠 보면 ${GROUPS.map((k) => `${k} ${share(k)}%`).join(' · ')}로, ${top}의 힘이 가장 커요.`,
      C.group[top].style,
      C.group[second].second,
      `잘 맞는 환경 — ${C.group[top].environment}`,
      `월지 ${chart.pillars.month.branch.hanja} — ${C.monthBranchCareer[chart.pillars.month.branch.tenGod]}`,
      `일간 ${dm.name}의 일 — ${dm.career}`,
      `일주 ${chart.pillars.day.ganzhi.hanja}의 일 — ${dp.career}`,
      `일에서 쓰는 강점 — ${dm.strengths.slice(0, 3).join(', ')}.`,
      `보완하면 좋은 점 — ${dm.weaknesses[0]!.replace(' — ', '. ')}.`,
    ],
  };

  // ── 어울리는 일과 분야 ────────────────────────────────────
  const shinsalNames = new Set(chart.shinsal.map((s) => s.name));
  const careerShinsal = CAREER_SHINSAL.filter((n) => shinsalNames.has(n)).slice(0, 3);
  const H = C.element[y.heesin];
  const fields: ReadingSection = {
    key: 'fields',
    title: '어울리는 일과 분야',
    summary: `${EL_NAME[y.yongsin]}의 기운이 흐르는 일에서 힘을 얻어요`,
    keywords: E.fields.slice(0, 4),
    paragraphs: [
      `나에게 힘이 되는 기운(용신)은 ${EL_NAME[y.yongsin]}${elp(y.yongsin, '이에요', '예요')}. ${E.why} ${E.fields.join(', ')} 같은 일이 이 기운과 잘 맞아요.`,
      `용신을 돕는 희신 ${EL_NAME[y.heesin]} 쪽으로는 ${H.fields.slice(0, 3).join(', ')} 같은 분야도 함께 살펴볼 만해요.`,
      C.gisinEnvironment[y.gisin],
      `일간 ${dm.name}의 타고난 기질로 보면 ${dm.jobs.join(', ')} 같은 일이 잘 어울려요.`,
      C.group[top].fields,
      `함께 살펴볼 분야 — ${C.group[second].fields}`,
      ...(careerShinsal.length ? careerShinsal.map((n) => C.shinsal[n]) : [C.shinsalNone]),
      C.fieldsOutro,
    ],
  };

  // ── 직장형·독립형 ────────────────────────────────────────
  const employment: ReadingSection = {
    key: 'employment',
    title: '직장형일까, 독립형일까',
    summary: `'${EMP.title}'에 조금 더 가까워요`,
    keywords: [`조직형 기운 ${org}`, `독립형 기운 ${indep}`],
    paragraphs: [
      `조직에서 힘을 얻는 기운은 관성 ${g.관성}개와 인성 ${g.인성}개로 모두 ${org}개, 스스로 꾸리는 쪽의 기운은 식상 ${g.식상}개·비겁 ${g.비겁}개·편재 ${tc.편재}개로 모두 ${indep}개예요.`,
      `${C.employmentIntro} 이 사주는 '${EMP.title}'에 조금 더 가까워요.`,
      EMP.body,
      C.employmentByStrength[band],
      EMP.tip,
      C.employmentPath[employmentKey],
      C.employmentCheck[employmentKey],
      C.employmentOutro,
    ],
  };

  // ── 앞으로 10년 ──────────────────────────────────────────
  const tagsOf = (t: YearInfo) => {
    const tags: string[] = [];
    if (chart.daeun.periods.some((p) => p.startYear === t.year)) tags.push('대운 교체');
    if (t.ev.fit.stem === 'yongsin') tags.push('용신');
    if (t.ev.fit.stem === 'gisin') tags.push('기신');
    tags.push(...t.signals.map((k) => SIGNAL_TAG[k]));
    return tags.slice(0, 3);
  };
  const avg = (t: YearInfo) => t.wealth + t.career;
  const byAvg = [...infos].sort((a, b) => avg(b) - avg(a) || a.year - b.year);
  const rhythm = { push: byAvg.slice(0, 3).sort((a, b) => a.year - b.year), rest: byAvg.slice(-2).sort((a, b) => a.year - b.year) };
  const yearReason = (t: YearInfo, key: 'yearWealth' | 'yearCareer') => `${t.year}년은 천간에 ${t.stemTenGod}${particle(t.stemTenGod, '이', '가')} 들어와 ${C[key][t.stemTenGod]}`;
  const periods = chart.daeun.periods;
  const cur = periods.find((p) => start >= p.startYear && start <= p.endYear);
  const next = periods.find((p) => p.startYear > start && p.startYear <= start + 9);
  const daeunLines: string[] = [];
  if (cur) {
    const grp = TEN_GOD_GROUP[cur.stemTenGod];
    daeunLines.push(
      `${start}년은 ${cur.startYear}~${cur.endYear}년에 걸친 ${cur.ganzhi.hanja} 대운 안에 들어 있어요. 천간에 ${cur.stemTenGod}${particle(cur.stemTenGod, '이', '가')} 흐르는 10년이에요. ${C.group[grp].decade}`,
      C.daeunUse[cur.stemTenGod],
      `일 — ${LUCK_CONTENT.daeun[cur.stemTenGod].career}`,
      `재물 — ${LUCK_CONTENT.daeun[cur.stemTenGod].wealth}`,
    );
  } else if (next) {
    daeunLines.push(`${start}년은 첫 대운이 시작되기 전이라, 원국의 기질과 해마다 들어오는 기운이 그대로 드러나는 시기예요.`);
  } else {
    daeunLines.push('대운표의 마지막 계절을 지나, 해마다 들어오는 기운(세운)의 영향을 더 직접 받는 시기예요.');
  }
  if (next) {
    const ngrp = TEN_GOD_GROUP[next.stemTenGod];
    const same = cur !== undefined && TEN_GOD_GROUP[cur.stemTenGod] === ngrp;
    daeunLines.push(
      `${next.startYear}년부터는 ${next.ganzhi.hanja} 대운으로 넘어가 천간에 ${next.stemTenGod}${particle(next.stemTenGod, '이', '가')} 흘러요. ${same ? C.sameGroupDaeun : C.group[ngrp].decade}`,
      `일 — ${LUCK_CONTENT.daeun[next.stemTenGod].career}`,
      `재물 — ${LUCK_CONTENT.daeun[next.stemTenGod].wealth}`,
    );
  }
  const decade: ReadingSection = {
    key: 'decade',
    title: `앞으로 10년의 흐름 (${start}~${start + 9})`,
    summary: `재물은 ${bestWealth[0]!.year}년, 일은 ${bestCareer[0]!.year}년에 힘이 실려요`,
    keywords: [`재물 ${bestWealth[0]!.year}`, `일 ${bestCareer[0]!.year}`, ...transitions.map((t) => `전환 ${t.year}`)],
    paragraphs: [
      C.decadeIntro,
      ...infos.map((t) => [`${t.year}년 ${t.hanja}`, `재물 ${t.wealth}`, `일 ${t.career}`, `${t.stemTenGod}, ${C.yearLine[t.stemTenGod]}`, ...tagsOf(t)].join(' · ')),
      `재물과 일의 점수를 함께 보면 넓히기 좋은 해는 ${rhythm.push.map((t) => `${t.year}년`).join(', ')}, 다지기 좋은 해는 ${rhythm.rest.map((t) => `${t.year}년`).join(', ')}이에요. ${C.rhythmTail}`,
      `재물의 흐름이 가장 넉넉한 해는 ${bestWealth.map((t) => `${t.year}년`).join('과 ')}이에요. ${bestWealth.map((t) => yearReason(t, 'yearWealth')).join(' ')}`,
      `일에 힘이 가장 실리는 해는 ${bestCareer.map((t) => `${t.year}년`).join('과 ')}이에요. ${bestCareer.map((t) => yearReason(t, 'yearCareer')).join(' ')}`,
      ...(transitions.length
        ? [
            `일의 자리가 바뀌기 쉬운 전환의 창은 ${transitions.map((t) => `${t.year}년`).join(', ')}이에요. 이런 해에는 미리 이력과 포트폴리오를 정리해 두면 기회가 왔을 때 빠르게 움직일 수 있어요.`,
            ...transitions.map((t) => `${t.year}년 — ${t.keys.map((k) => C.transition[k]).join(' ')}`),
          ]
        : [C.noTransition]),
      ...daeunLines,
    ],
  };

  // ── 가까운 3년 ───────────────────────────────────────────
  const best3W = topBy(three, 'wealth', 1)[0]!;
  const best3C = topBy(three, 'career', 1)[0]!;
  const threeYears: ReadingSection = {
    key: 'threeYears',
    title: `가까운 3년, 한 해씩 (${start}~${start + 2})`,
    summary: best3W.year === best3C.year ? `${best3W.year}년에 재물과 일 모두 힘이 실려요` : `${best3W.year}년은 재물, ${best3C.year}년은 일에 힘이 실려요`,
    keywords: three.map((t) => `${t.year} ${t.hanja}`),
    paragraphs: [
      C.threeYearsIntro,
      ...three.flatMap((t) => {
        const btg = t.ev.pillar.branchTenGod;
        const flow = [t.ev.fit.stem !== 'neutral' ? C.fit[t.ev.fit.stem] : null, ...t.signals.slice(0, 2).map((k) => C.signal[k])].filter((x): x is string => Boolean(x));
        return [
          `${t.year}년 ${t.hanja} — 재물 ${t.wealth}점 · 일 ${t.career}점 · 천간 ${t.stemTenGod} · 지지 ${btg}`,
          `일 — ${TEN_GOD_CONTENT[t.stemTenGod].inLuck.career}`,
          `재물 — ${TEN_GOD_CONTENT[t.stemTenGod].inLuck.wealth}`,
          ...(btg !== t.stemTenGod ? [`바탕 — 지지에 ${btg}${particle(btg, '이', '가')} 깔리는 해예요. ${C.yearBase[btg]}`] : []),
          `점수로 보면 — ${C.wealthBand[scoreBand(t.wealth)]} ${C.careerBand[scoreBand(t.career)]}`,
          `흐름 — ${flow.length ? flow.join(' ') : C.quietYear}`,
          `기운의 세기 — 그해 일간이 맞는 12운성은 ${t.ev.pillar.twelveStage}${ieyo(t.ev.pillar.twelveStage)}. ${C.stageWork[t.ev.pillar.twelveStage]}`,
          `실천 — ${C.yearAction[t.stemTenGod]}`,
        ];
      }),
    ],
  };

  // ── 조심할 점 ────────────────────────────────────────────
  const riskChecks: [RiskKey, boolean, string][] = [
    ['bigeop', g.비겁 >= 3 || tc.겁재 >= 2, `비겁 ${g.비겁}개 · 겁재 ${tc.겁재}개`],
    ['jaedaSinyak', g.재성 >= 3 && band === 'weak', `재성 ${g.재성}개 · ${level}`],
    ['sanggwanGyeongwan', tc.상관 >= 1 && tc.정관 >= 1, `상관 ${tc.상관}개 · 정관 ${tc.정관}개`],
    ['extremeStrong', level === '극신강', `일간의 힘 ${level}`],
    ['extremeWeak', level === '극신약', `일간의 힘 ${level}`],
    ['gwanHeavy', g.관성 >= 3, `관성 ${g.관성}개`],
    ['siksangHeavy', g.식상 >= 3, `식상 ${g.식상}개`],
    ['inseongHeavy', g.인성 >= 3, `인성 ${g.인성}개`],
    ['noWealth', g.재성 === 0, '재성 0개'],
  ];
  const risksHit = riskChecks.filter(([, hit]) => hit).slice(0, 3);
  const gisinYears = three.filter((t) => t.ev.fit.stem === 'gisin' || t.ev.fit.branch === 'gisin');
  const risks: ReadingSection = {
    key: 'risks',
    title: '조심할 점 — 미리 알아 두는 관리 포인트',
    summary: risksHit.length ? `${COUNT_WORD[risksHit.length]} 가지 관리 포인트를 알아 두면 흔들림이 줄어요` : '크게 치우친 곳이 적어, 점검 습관만 챙기면 돼요',
    keywords: risksHit.map(([, , label]) => label),
    paragraphs: [
      C.riskIntro,
      ...(risksHit.length ? risksHit.map(([k, , label]) => `${label} — ${C.risk[k]}`) : [C.riskGeneral]),
      C.riskMind[band],
      gisinYears.length
        ? `가까운 3년 가운데 ${gisinYears.map((t) => t.year).join('·')}년에는 균형을 흔들기 쉬운 기신인 ${EL_NAME[y.gisin]} 기운이 들어와요. 이런 해에는 새 일을 크게 벌이기보다 지출과 계약을 한 번 더 점검하는 편이 마음 편해요.`
        : `가까운 3년에는 기신인 ${EL_NAME[y.gisin]} 기운이 천간이나 지지로 강하게 들어오는 해가 없어, 큰 흔들림 없이 계획을 이어 가기 좋아요.`,
      C.riskChecklist,
    ],
  };

  // ── 재물 습관 ────────────────────────────────────────────
  const habits: ReadingSection = {
    key: 'habits',
    title: '재물을 지키는 습관',
    summary: `자동이체·지출 기록·비상금, 그리고 ${EL_NAME[y.yongsin]} 기운에 맞춘 습관 하나`,
    keywords: ['자동이체', '지출 기록', '비상금'],
    paragraphs: [
      `나에게 힘이 되는 ${EL_NAME[y.yongsin]} 기운을 돈 습관으로 옮기면 이래요. ${E.habit}`,
      `${S.name}에 맞는 습관 — ${S.habit}`,
      `${C.habitBasic} ${C.habitByBand[band]}`,
      C.habitMonthly,
      C.financeNote,
    ],
  };

  // ── 마무리 ───────────────────────────────────────────────
  const closing: ReadingSection = {
    key: 'closing',
    title: '마무리 — 나답게 벌고 쓰는 법',
    summary: '사주는 정해진 답이 아니라 나를 이해하는 지도예요',
    paragraphs: [S.closing, C.closingByBand[band], `${dm.name}에게 건네는 한마디 — ${dm.advice}`, C.closingNote],
  };

  return [summary, moneyFlow, strength, earnKeep, workStyle, fields, employment, decade, threeYears, risks, habits, closing];
}
