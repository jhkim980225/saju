/**
 * 연애·결혼운 리포트 생성기 — 프로필 한 사람의 사주로 본 사랑의 방식과 인연의 흐름.
 *
 * 구성(12장): 요약 → 일간으로 본 사랑의 방식 → 배우자 자리(일지) → 십성 균형 → 끌림과 매력(도화·홍염)
 *   → 나에게 맞는 사람(용신·희신·신강도·일지 육합) → 관계 패턴 → 부딪히기 쉬운 지점(일지 합충)
 *   → 앞으로 10년의 인연 흐름(세운 + 대운) → 가까운 3년 한 해씩 → 실천 → 마무리.
 * 분량 목표: 공백 제외 약 8천~1만 자. 규칙 기반 초안이 사실(간지·십성·점수·연도)을 모두 담고, AI 는 문장만 다듬는다.
 *
 * 성별 중립:
 * - 전통 명리는 성별에 따라 재성/관성 가운데 하나를 배우자의 별로 읽지만, 여기서는 둘 다 '인연의 별'로 함께 읽는다.
 * - chart.input.gender 와 엔진의 scores.love(성별로 계산한다)는 쓰지 않고, 인연·약속 점수를 따로 매긴다.
 * - 대운은 성별로 방향이 바뀌므로 요약(summary)과 10년 흐름(decade) 장에서만 쓴다. 나머지 장은 성별과 무관하게 같다.
 */
import {
  BRANCHES,
  ELEMENT_INFO,
  TEN_GOD_GROUP,
  evaluateFortune,
  sixCombine,
  threeCombineGroupOf,
  wolun,
  yearPillarOf,
  type PillarPosition,
  type RelationType,
  type SajuChart,
  type TenGod,
  type TenGodGroup,
  type TwelveStage,
} from '@saju/core';
import type { ReadingSection } from '@saju/shared';
import { LUCK_CONTENT, TEN_GOD_CONTENT, TWELVE_STAGE_CONTENT } from './content/index.js';
import { LOVE_REPORT as C, type DayBranchRelation, type LoveYearSignal } from './content/loveReport.js';
import { EL_NAME, band, dayMasterContent, dayPillarContent, groupCount, targetFortuneYear } from './reading.js';
import { GROUPS, elp, ieyo, list, particle, pct } from './report.js';

const POSITION_NAME: Record<PillarPosition, string> = { year: '년주', month: '월주', day: '일주', hour: '시주' };
/** 신살이 놓인 자리 — 일지는 배우자 자리로 부른다 */
const SHINSAL_POS: Record<PillarPosition, string> = { year: '년주', month: '월주', day: '일지(배우자 자리)', hour: '시주' };
const POSITION_MEANING: Record<Exclude<PillarPosition, 'day'>, string> = {
  year: '집안과 뿌리의 자리',
  month: '사회·일·주변 사람의 자리',
  hour: '앞으로의 계획과 생활의 끝자락',
};
/** 관계를 차분히 다음 단계로 옮기기 좋은 12운성 */
const STEADY: TwelveStage[] = ['관대', '건록', '제왕', '쇠'];
const SIGNAL_ORDER: LoveYearSignal[] = ['combine', 'half', 'trine', 'stemCombine', 'dohwa', 'jae', 'gwan', 'proper', 'siksang', 'steady', 'clash', 'punish', 'wonjin', 'harmBreak'];
const POSITIVE: LoveYearSignal[] = ['combine', 'half', 'trine', 'stemCombine', 'dohwa', 'jae', 'gwan', 'proper', 'siksang', 'steady'];
const CHANGE: LoveYearSignal[] = ['clash', 'punish', 'wonjin', 'harmBreak'];
/** 목록 줄 꼬리표로 보여 줄 신호(정재·정관·식상·안정은 풀이 문장에서만) */
const TAGGED: LoveYearSignal[] = ['combine', 'half', 'trine', 'stemCombine', 'dohwa', 'jae', 'gwan', 'clash', 'punish', 'wonjin', 'harmBreak'];
const DAY_BRANCH_RELATIONS: DayBranchRelation[] = ['육합', '반합', '삼합', '방합', '충', '형', '자형', '파', '해', '원진'];

const clamp = (n: number) => Math.max(20, Math.min(98, Math.round(n)));
/** '(으)로' — 받침이 없거나 ㄹ 받침이면 '로' (갑술 → 갑술로) */
const euro = (word: string) => {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code < 0 || code > 11171 || code % 28 === 0 || code % 28 === 8 ? '로' : '으로';
};

interface LoveYear {
  year: number;
  hanja: string;
  hangul: string;
  stemTenGod: TenGod;
  branchTenGod: TenGod;
  stage: TwelveStage;
  total: number;
  signals: LoveYearSignal[];
  /** 인연 — 새 만남·설렘·관계가 깊어지는 기운 */
  love: number;
  /** 약속 — 관계를 묶어 주는 기운(결혼이나 함께 사는 약속을 생각할 때) */
  bond: number;
}

/** 한 해의 인연·약속 점수 — 성별을 쓰지 않는다(엔진의 scores.love 대신 총운 + 일지·일간 관계 + 인연의 별) */
function loveYear(chart: SajuChart, year: number): LoveYear {
  const ev = evaluateFortune(chart, yearPillarOf(year), `love-${year}`);
  const p = ev.pillar;
  const day = ev.interactions.filter((i) => i.with === 'day');
  const has = (t: RelationType, target: 'stem' | 'branch' = 'branch') => day.some((i) => i.type === t && i.target === target);
  const db = chart.pillars.day.branch.index;
  const sg = TEN_GOD_GROUP[p.stemTenGod];
  const bg = TEN_GOD_GROUP[p.branchTenGod];
  const s = new Set<LoveYearSignal>();
  if (has('육합')) s.add('combine');
  if (has('반합')) s.add('half');
  else if (p.branch !== db && threeCombineGroupOf(db).includes(p.branch)) s.add('trine');
  if (has('천간합', 'stem')) s.add('stemCombine');
  if (ev.highlights.includes('dohwa')) s.add('dohwa');
  if (sg === '재성' || bg === '재성') s.add('jae');
  if (sg === '관성' || bg === '관성') s.add('gwan');
  if (sg === '식상') s.add('siksang');
  const proper = (t: TenGod) => t === '정재' || t === '정관';
  if (proper(p.stemTenGod) || proper(p.branchTenGod)) s.add('proper');
  if (STEADY.includes(p.twelveStage)) s.add('steady');
  if (has('충')) s.add('clash');
  if (has('형') || has('자형')) s.add('punish');
  if (has('원진')) s.add('wonjin');
  if (has('해') || has('파')) s.add('harmBreak');

  const t = ev.scores.total;
  const w = (k: LoveYearSignal, n: number) => (s.has(k) ? n : 0);
  const star = (g: TenGodGroup) => (sg === g ? 5 : 0) + (bg === g ? 3 : 0);
  const love = clamp(t * 0.7 + 18 + w('combine', 8) + w('half', 5) + w('trine', 3) + w('stemCombine', 6) + w('dohwa', 7) + star('재성') + star('관성') + w('siksang', 2) - w('clash', 4) - w('punish', 3) - w('wonjin', 2));
  const properPts = (proper(p.stemTenGod) ? 6 : 0) + (proper(p.branchTenGod) ? 4 : 0);
  const bond = clamp(t * 0.6 + 22 + w('combine', 10) + w('half', 7) + w('trine', 4) + w('stemCombine', 7) + properPts + w('steady', 3) - w('clash', 5) - w('punish', 3) - w('wonjin', 3) - w('harmBreak', 2));
  return {
    year,
    hanja: p.ganzhi.hanja,
    hangul: p.ganzhi.hangul,
    stemTenGod: p.stemTenGod,
    branchTenGod: p.branchTenGod,
    stage: p.twelveStage,
    total: t,
    signals: SIGNAL_ORDER.filter((k) => s.has(k)),
    love,
    bond,
  };
}

/** 한 해 안에서 인연의 기운이 높은 두 달(절기 기준 월운) — 해마다 쓰는 신호와 같은 기준, 성별을 쓰지 않는다 */
function bestLoveMonths(chart: SajuChart, year: number): string[] {
  const scored = wolun(chart.dayMaster.index, year).map((m, i) => {
    const ev = evaluateFortune(chart, m, `love-${year}-m${m.order}`);
    const day = ev.interactions.filter((x) => x.with === 'day');
    const has = (t: RelationType) => day.some((x) => x.type === t);
    const star = (t: TenGod, n: number) => (TEN_GOD_GROUP[t] === '재성' || TEN_GOD_GROUP[t] === '관성' ? n : 0);
    const s = ev.scores.total + (has('육합') ? 8 : 0) + (has('반합') ? 5 : 0) + (has('천간합') ? 6 : 0) + (ev.highlights.includes('dohwa') ? 7 : 0) + star(m.stemTenGod, 5) + star(m.branchTenGod, 3) - (has('충') ? 4 : 0);
    return { i, s };
  });
  // 寅월 ≈ 양력 2월 … 丑월 = 다음 해 1월
  return scored
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, 2)
    .sort((a, b) => a.i - b.i)
    .map(({ i }) => (i === 11 ? `${year + 1}년 1월` : `${i + 2}월`));
}

/** 점수 높은 순(같으면 이른 해) */
const topBy = (ys: LoveYear[], k: 'love' | 'bond', n: number) => [...ys].sort((a, b) => b[k] - a[k] || a.year - b.year).slice(0, n);
const yearList = (ys: LoveYear[]) => ys.map((y) => `${y.year}년`).join(', ');
const tagLine = (y: LoveYear) => y.signals.filter((k) => TAGGED.includes(k)).map((k) => C.signal[k].tag);

/** 왜 이 해인가 — 짧은 근거 한 줄 */
function reasonLine(y: LoveYear, k: 'love' | 'bond'): string {
  // 인연은 만남·설렘의 신호, 약속은 묶어 주는 신호로 — 정재·정관이 있으면 같은 뜻의 '인연의 별'은 빼고 쓴다
  const proper = y.signals.includes('proper');
  const keep = (s: LoveYearSignal) =>
    k === 'love' ? s !== 'steady' && s !== 'proper' : s !== 'dohwa' && s !== 'siksang' && !(proper && (s === 'jae' || s === 'gwan'));
  const reasons = y.signals.filter((s) => POSITIVE.includes(s) && keep(s)).map((s) => C.signal[s].reason);
  const label = k === 'love' ? '인연' : '약속';
  return reasons.length
    ? `${y.year}년 ${y.hanja} — ${list(reasons.slice(0, 3), '이', '가')} ${reasons.length > 1 ? '겹쳐' : '들어와'} ${label} ${y[k]}점이에요.`
    : `${y.year}년 ${y.hanja} — 그해의 기운이 내 사주와 잘 맞아(총운 ${y.total}점) 마음에 여유가 생기기 쉬워 ${label} ${y[k]}점이에요.`;
}

/** 원국에서 일지와 얽힌 지지 관계 — 같은 종류는 한 문단으로 묶는다 */
function dayBranchRelations(chart: SajuChart): { type: DayBranchRelation; positions: Exclude<PillarPosition, 'day'>[] }[] {
  const out = new Map<DayBranchRelation, Set<Exclude<PillarPosition, 'day'>>>();
  for (const r of chart.relations) {
    if (r.target !== 'branch' || !r.positions.includes('day')) continue;
    const type = r.type as DayBranchRelation;
    if (!DAY_BRANCH_RELATIONS.includes(type)) continue;
    const set = out.get(type) ?? new Set();
    for (const p of r.positions) if (p !== 'day') set.add(p);
    out.set(type, set);
  }
  const order: Exclude<PillarPosition, 'day'>[] = ['year', 'month', 'hour'];
  return DAY_BRANCH_RELATIONS.filter((t) => out.has(t)).map((type) => ({ type, positions: order.filter((p) => out.get(type)!.has(p)) }));
}

export function buildLoveReport(chart: SajuChart, now = new Date()): ReadingSection[] {
  const dm = dayMasterContent(chart);
  const dp = dayPillarContent(chart);
  const stem = C.stem[chart.dayMaster.index]!;
  const day = chart.pillars.day;
  const db = day.branch;
  const dbEl = db.element;
  const g = groupCount(chart);
  const y = chart.yongsin;
  const level = chart.strength.level;
  const shinsal = new Map<string, Set<PillarPosition>>();
  for (const s of chart.shinsal) {
    const set = shinsal.get(s.name) ?? new Set();
    s.positions.forEach((p) => set.add(p));
    shinsal.set(s.name, set);
  }
  const hasDohwa = shinsal.has('도화살');
  const hasHongyeom = shinsal.has('홍염살');
  const dominant = GROUPS.reduce((best, k) => (g[k] > g[best] ? k : best), GROUPS[0]!);
  const stars = g.재성 + g.관성;

  const start = targetFortuneYear(now);
  const years = Array.from({ length: 10 }, (_, i) => loveYear(chart, start + i));
  const topLove = topBy(years, 'love', 3);
  const topBond = topBy(years, 'bond', 2);
  const best = topLove[0]!;
  const bestBond = topBond[0]!;

  // ── 1. 요약 ────────────────────────────────────────────────
  const charm = hasDohwa && hasHongyeom ? '원국에 도화살과 홍염살이 함께 있어 사람을 끄는 매력이 뚜렷한 편이에요.' : hasDohwa ? '원국에 도화살이 있어 사람을 끄는 매력이 뚜렷한 편이에요.' : hasHongyeom ? '원국에 홍염살이 있어 은은한 분위기로 마음을 끄는 편이에요.' : '원국에 도화살·홍염살은 없어, 알수록 깊어지는 잔잔한 매력이 강점이에요.';
  const daeunNow = chart.daeun.periods.find((p) => start >= p.startYear && start <= p.endYear);
  const summary: ReadingSection = {
    key: 'summary',
    title: '한눈에 보는 연애·결혼운',
    summary: `${best.year}년에 인연의 기운이 가장 두드러져요`,
    keywords: [`일간 ${dm.name}`, `배우자 자리 ${db.hanja}`, `인연의 별 ${stars}`, ...(hasDohwa ? ['도화'] : []), ...(hasHongyeom ? ['홍염'] : []), `인연 ${best.year}`, `약속 ${bestBond.year}`],
    paragraphs: [
      `일간은 ${dm.name}, 배우자 자리(일지)에는 ${db.hanja}(${db.hangul})${particle(db.hangul, '이', '가')} 앉아 있어요. ${EL_NAME[dbEl]} 기운이고 일간에서 보면 ${db.tenGod}${ieyo(db.tenGod)}. 인연의 별은 재성 ${g.재성}개와 관성 ${g.관성}개예요. 이 리포트는 이 글자들이 사랑과 관계에서 어떻게 움직이는지를 하나씩 풀어 봐요.`,
      C.method,
      `${charm} 사주에서 가장 많은 기운은 ${dominant}, 나에게 힘이 되는 기운(용신)은 ${EL_NAME[y.yongsin]}${elp(y.yongsin, '이에요', '예요')}. 이 두 가지가 관계의 습관과 나에게 맞는 사람을 읽는 열쇠가 돼요.`,
      `${
        best.year === bestBond.year
          ? `앞으로 10년(${start}~${start + 9}년) 가운데 ${best.year}년(${best.hanja})은 새로운 인연의 기운과, 결혼이나 함께 사는 약속처럼 관계의 다음 단계를 이야기할 기운이 함께 가장 높은 해예요.`
          : `앞으로 10년(${start}~${start + 9}년) 가운데 인연의 기운이 가장 두드러지는 해는 ${best.year}년(${best.hanja}), 결혼이나 함께 사는 약속처럼 관계의 다음 단계를 이야기하기 좋은 해는 ${bestBond.year}년(${bestBond.hanja})이에요.`
      }${daeunNow ? ` 지금은 ${daeunNow.ganzhi.hangul}(${daeunNow.ganzhi.hanja}) 대운 안에서 ${daeunNow.stemTenGod}의 10년을 지나고 있어요.` : ''}`,
      C.howToRead,
    ],
  };

  // ── 2. 일간으로 본 사랑의 방식 ─────────────────────────────
  const loveNature: ReadingSection = {
    key: 'loveNature',
    title: '일간으로 본 사랑의 방식',
    summary: `${dm.title}처럼 사랑하는 사람`,
    keywords: [dm.name, chart.dayMaster.yinYang === 'yang' ? '양의 일간' : '음의 일간', ...dm.keywords.slice(0, 2)],
    paragraphs: [
      `일간(태어난 날의 천간)은 사주에서 '나'를 뜻해요. 당신의 일간은 ${dm.name}, ${dm.title}${ieyo(dm.title)}. ${C.yinYang[chart.dayMaster.yinYang]} ${stem.style}`,
      `마음을 표현하는 방식 — ${stem.expression}`,
      `관계에서 필요한 것 — ${stem.needs}`,
      dm.love,
      `다툼이 생겼을 때 — ${stem.conflict}`,
      `조심하면 좋은 점 — ${stem.caution}`,
    ],
  };

  // ── 3. 배우자 자리(일지) ──────────────────────────────────
  const palaceTg = C.palace.tenGod[db.tenGod];
  const stage = TWELVE_STAGE_CONTENT[db.twelveStage];
  const hidden = db.hiddenStems.map((h) => `${h.hanja}(${h.tenGod})`);
  const spousePalace: ReadingSection = {
    key: 'spousePalace',
    title: '배우자 자리 — 일지로 본 가까운 관계',
    summary: `배우자 자리에 ${db.tenGod}${particle(db.tenGod, '이', '가')} 앉아 있어요`,
    keywords: [`일지 ${db.hanja}`, EL_NAME[dbEl], db.tenGod, `12운성 ${db.twelveStage}`],
    paragraphs: [
      `${C.palace.intro} 당신의 일지는 ${db.hanja}(${db.hangul}), ${EL_NAME[dbEl]} 기운이라 ${C.palace.element[dbEl]} ${C.palace.branch[db.index]}`,
      `일간에서 보면 이 자리는 ${db.tenGod}(${TEN_GOD_CONTENT[db.tenGod].keyword})${ieyo(db.tenGod)}. ${palaceTg.palace}`,
      `일지 안에 숨은 글자(지장간)는 ${hidden.join(', ')}${particle(db.hiddenStems[db.hiddenStems.length - 1]?.tenGod ?? '', '이에요', '예요')}. ${C.palace.hidden}`,
      `일지에서 일간이 맞는 12운성은 '${stage.name}'(${stage.keyword})${ieyo(stage.name)}. ${C.palace.stage[db.twelveStage]}`,
      `${day.ganzhi.hangul}(${day.ganzhi.hanja}) 일주의 배우자 자리 풀이 — ${dp.love}`,
      `생활 속 실천 — ${palaceTg.tip}`,
    ],
  };

  // ── 4. 십성 균형 ─────────────────────────────────────────
  const absent = GROUPS.filter((k) => g[k] === 0);
  /** 인연의 별(재성·관성)이 천간이나 지지에 놓인 기둥 */
  const isStar = (t: string) => t !== '일간' && (TEN_GOD_GROUP[t as TenGod] === '재성' || TEN_GOD_GROUP[t as TenGod] === '관성');
  const starPositions = (['year', 'month', 'day', 'hour'] as const).filter((pos) => {
    const p = chart.pillars[pos];
    return p !== null && (isStar(p.stem.tenGod) || isStar(p.branch.tenGod));
  });
  const starText = stars >= 4 ? C.stars.many : g.재성 > 0 && g.관성 > 0 ? C.stars.both : g.재성 > 0 ? C.stars.jaeOnly : g.관성 > 0 ? C.stars.gwanOnly : C.stars.none;
  const tenGodBalance: ReadingSection = {
    key: 'tenGodBalance',
    title: '십성 균형으로 본 관계 습관',
    summary: `${dominant} 기운이 관계의 습관을 이끌어요`,
    keywords: GROUPS.map((k) => `${k} ${g[k]}`),
    paragraphs: [
      `십성은 일간을 기준으로 다른 글자들이 맡는 역할이에요. 당신의 사주를 다섯 무리로 나누면 ${GROUPS.map((k) => `${k} ${g[k]}`).join(' · ')}의 구성이에요.`,
      C.methodDetail,
      `인연의 별은 재성 ${g.재성}개, 관성 ${g.관성}개예요. ${starText}`,
      ...(starPositions.length ? [`인연의 별이 놓인 자리 — ${starPositions.map((p) => C.starPosition[p]).join(' ')}`] : []),
      C.group[dominant].strong,
      ...absent.filter((k) => k !== dominant).map((k) => C.group[k].absent),
      `작은 실천 — ${C.group[dominant].tip}`,
    ],
  };

  // ── 5. 끌림과 매력 ───────────────────────────────────────
  const firePct = pct(chart.elements.percent.fire);
  const fireBand = firePct >= 25 ? 'high' : firePct >= 12 ? 'mid' : 'low';
  const dohwaParas: string[] = [];
  if (hasDohwa) {
    const ps = (['year', 'month', 'day', 'hour'] as const).filter((p) => shinsal.get('도화살')!.has(p));
    dohwaParas.push(`${C.attraction.dohwaIntro} 당신의 사주에는 ${list(ps.map((p) => SHINSAL_POS[p]), '에', '에')} 도화살이 있어요.`, ...ps.map((p) => C.attraction.dohwaAt[p]));
  }
  if (hasHongyeom) {
    const ps = (['year', 'month', 'day', 'hour'] as const).filter((p) => shinsal.get('홍염살')!.has(p));
    dohwaParas.push(`${C.attraction.hongyeom} 당신의 사주에는 ${list(ps.map((p) => SHINSAL_POS[p]), '에', '에')} 홍염살이 있어요.`);
  }
  if (hasDohwa && hasHongyeom) dohwaParas.push(C.attraction.both);
  const dohwaYears = years.filter((x) => x.signals.includes('dohwa'));
  const attraction: ReadingSection = {
    key: 'attraction',
    title: '끌림과 매력',
    summary: hasDohwa || hasHongyeom ? '사람을 끄는 매력이 뚜렷해요' : '알수록 깊어지는 잔잔한 매력이에요',
    keywords: [...(hasDohwa ? ['도화살'] : []), ...(hasHongyeom ? ['홍염살'] : []), `식상 ${g.식상}`, `화(火) ${firePct}%`],
    paragraphs: [
      ...(dohwaParas.length ? [...dohwaParas, C.attraction.tip] : [C.attraction.quiet]),
      `일간이 ${EL_NAME[chart.dayMaster.element]}${elp(chart.dayMaster.element, '이라', '라')} 첫인상은 ${C.attraction.firstImpression[chart.dayMaster.element]}`,
      `사주에서 가장 강한 기운은 ${EL_NAME[chart.elements.dominant]}${elp(chart.elements.dominant, '이에요', '예요')}. 그래서 ${C.attraction.charm[chart.elements.dominant]} ${C.attraction.charmTip[chart.elements.dominant]}`,
      `마음을 데우는 화(火) 기운은 ${firePct}%예요. ${C.attraction.fire[fireBand]} 표현하는 기운(식상)은 ${g.식상}개라 ${C.attraction.siksang[g.식상 >= 3 ? 'many' : g.식상 > 0 ? 'some' : 'none']}`,
      ...(db.twelveStage === '목욕' ? [C.attraction.bath] : []),
      ...(dohwaYears.length ? [`앞으로 10년 가운데 ${yearList(dohwaYears)}에는 ${C.attraction.dohwaYears}`] : []),
    ],
  };

  // ── 6. 나에게 맞는 사람 ──────────────────────────────────
  const partner = C.partner[y.yongsin];
  const comboBranch = BRANCHES.find((b) => b.index !== db.index && sixCombine(db.index, b.index) !== null);
  const lacking = chart.elements.lacking;
  const idealPartner: ReadingSection = {
    key: 'idealPartner',
    title: '나에게 맞는 사람',
    summary: `${EL_NAME[y.yongsin]} 기운이 살아 있는 사람이 힘이 돼요`,
    keywords: [`용신 ${EL_NAME[y.yongsin]}`, `희신 ${EL_NAME[y.heesin]}`, level],
    paragraphs: [
      `나에게 힘이 되는 기운(용신)은 ${EL_NAME[y.yongsin]}${elp(y.yongsin, '이에요', '예요')}. 그래서 이 기운이 살아 있는 사람, 곧 ${partner.temperament}${particle(partner.temperament, '이', '가')} 잘 맞아요. ${partner.why}`,
      `용신을 돕는 희신은 ${EL_NAME[y.heesin]}${elp(y.heesin, '이에요', '예요')}. ${C.heesin[y.heesin]}`,
      C.partnerStrength[level],
      ...(comboBranch
        ? [`배우자 자리 ${db.hanja}${particle(db.hangul, '과', '와')} 육합을 이루는 글자는 ${comboBranch.hanja}(${comboBranch.hangul})${ieyo(comboBranch.hangul)}. ${EL_NAME[comboBranch.element]} 기운을 띤 글자라, 이 기운처럼 ${C.combineTemperament[comboBranch.element]} 사람과는 함께 있을 때 자연스럽게 손발이 맞기 쉬워요. 띠로 정해지는 인연이 아니라, 이런 기질의 사람 곁에서 편안함을 느끼기 쉽다는 뜻이에요.`]
        : []),
      ...(lacking.length
        ? [`원국에 ${lacking.map((el) => EL_NAME[el]).join('·')}${elp(lacking[lacking.length - 1]!, '이', '가')} 비어 있어, 이 기운이 넉넉한 사람에게서 ${list(lacking.map((el) => C.complement[el]), '을', '를')} 자연스럽게 배우기 쉬워요. 서로 다른 점이 관계를 넓혀 주는 경우예요.`]
        : []),
      `반대로 기신 ${EL_NAME[y.gisin]}의 기운이 지나친 관계, 곧 ${C.partnerCaution[y.gisin]}에서는 마음이 빨리 지치는 편이에요. 사람의 문제라기보다 기운의 방향 차이라, 이런 장면이 되풀이되면 속도와 거리를 조절해 보세요.`,
      `만남의 자리 — ${partner.meet}`,
      C.partnerNote,
    ],
  };

  // ── 7. 관계 패턴 ─────────────────────────────────────────
  const give = g.식상 + g.재성;
  const receive = g.인성;
  const pattern: ReadingSection = {
    key: 'pattern',
    title: '관계 패턴 — 가까워지는 속도와 주고받는 방식',
    summary: `${level}의 속도, ${dominant}의 방식으로 가까워져요`,
    keywords: [level, `${dominant} 중심`],
    paragraphs: [
      `일간의 힘은 '${level}'에 가까워요(돕는 기운 ${pct(chart.strength.score)}%). ${C.pattern[level]}`,
      `사주에서 ${dominant} 기운이 가장 많은 편이에요. ${C.patternGroup[dominant]}`,
      `시간에 따라 보면, ${C.phase[dominant].early} ${C.phase[dominant].middle} ${C.phase[dominant].settled}`,
      `배우자 자리의 오행이 ${EL_NAME[dbEl]}${elp(dbEl, '이라', '라')}, 연락과 만남은 ${C.rhythm[dbEl]}`,
      give >= receive + 2 ? C.giveReceive.give : receive >= give + 2 ? C.giveReceive.receive : C.giveReceive.even,
    ],
  };

  // ── 8. 부딪히기 쉬운 지점 ────────────────────────────────
  const rels = dayBranchRelations(chart);
  const stemRels = chart.relations.filter((r) => r.target === 'stem' && r.positions.includes('day'));
  const frictionParas: string[] = [C.friction.intro];
  for (const r of rels) {
    const c = C.friction.branch[r.type];
    const names = r.positions.map((p) => POSITION_NAME[p]);
    frictionParas.push(
      `일지 ${db.hanja}${particle(db.hangul, '과', '와')} ${list(names, '이', '가')} ${r.type}${particle(r.type, '을', '를')} 이뤄요. ${r.positions.map((p) => `${POSITION_NAME[p]}는 ${POSITION_MEANING[p]}${ieyo(POSITION_MEANING[p])}.`).join(' ')} ${c.text} ${r.positions.map((p) => C.friction.position[p]).filter((v, i, a) => a.indexOf(v) === i).join(' ')}`,
      `관리 포인트 — ${c.tip}`,
    );
  }
  if (rels.length === 0) frictionParas.push(C.friction.calm);
  if (stemRels.some((r) => r.type === '천간합')) frictionParas.push(C.friction.stemCombine);
  if (stemRels.some((r) => r.type === '천간충')) frictionParas.push(C.friction.stemClash);
  if (shinsal.has('귀문관살')) frictionParas.push(C.friction.gwimun);
  frictionParas.push(`다툼의 씨앗 — ${C.friction.seed[dominant]}`, `다툰 뒤 회복하는 방식 — ${C.friction.recover[level]}`, `기신 ${EL_NAME[y.gisin]} ${C.friction.gisin}`);
  const friction: ReadingSection = {
    key: 'friction',
    title: '부딪히기 쉬운 지점',
    summary: rels.length ? `일지의 ${rels.map((r) => r.type).join('·')}${particle(rels[rels.length - 1]!.type, '을', '를')} 관리 포인트로 봐요` : '배우자 자리가 고요하고 안정적인 편이에요',
    keywords: rels.length ? rels.map((r) => `일지 ${r.type}`) : ['일지 고요'],
    paragraphs: frictionParas,
  };

  // ── 9. 앞으로 10년 ───────────────────────────────────────
  const changeYears = years.filter((x) => x.signals.some((s) => CHANGE.includes(s)));
  const lowLove = [...years].sort((a, b) => a.love - b.love || a.year - b.year).slice(0, 2).sort((a, b) => a.year - b.year);
  const end = start + 9;
  const periods = chart.daeun.periods.filter((p) => p.endYear >= start && p.startYear <= end);
  const shift = periods.find((p) => p.startYear > start && p.startYear <= end);
  const decade: ReadingSection = {
    key: 'decade',
    title: `앞으로 10년의 인연 흐름 (${start}~${end})`,
    summary: `인연은 ${topLove.map((x) => x.year).join('·')}년, 약속은 ${topBond.map((x) => x.year).join('·')}년이 두드러져요`,
    keywords: [...topLove.map((x) => `인연 ${x.year}`), ...topBond.map((x) => `약속 ${x.year}`)],
    paragraphs: [
      C.decade.intro,
      ...years.map((x) => [`${x.year}년 ${x.hanja}`, `인연 ${x.love}점`, `약속 ${x.bond}점`, ...tagLine(x)].join(' · ')),
      `새로운 인연이나 관계의 설렘이 커지기 쉬운 해는 ${yearList(topLove)}이에요.`,
      ...topLove.map((x) => reasonLine(x, 'love')),
      `결혼이나 함께 사는 약속처럼 관계의 다음 단계를 생각한다면, 약속 점수가 높은 ${yearList(topBond)}에 이야기를 꺼내기 좋은 흐름이에요.`,
      ...topBond.map((x) => reasonLine(x, 'bond')),
      ...(changeYears.length ? [`${yearList(changeYears)}에는 배우자 자리와 충·형·원진 같은 기운이 걸려요. ${C.decade.change}`] : []),
      `${yearList(lowLove)}은 인연 점수가 상대적으로 낮은 해예요. ${C.decade.low}`,
      ...periods.map((p, i) => {
        const grp = TEN_GOD_GROUP[p.stemTenGod];
        // 이어지는 두 대운이 같은 무리면 무리 설명은 한 번만
        const groupText = i > 0 && TEN_GOD_GROUP[periods[i - 1]!.stemTenGod] === grp ? '' : ` ${C.decade.daeunGroup[grp]}`;
        return `${p.startYear}~${p.endYear}년 ${p.ganzhi.hangul}(${p.ganzhi.hanja}) 대운 — 천간 ${p.stemTenGod}, 지지 ${p.branchTenGod}.${groupText} ${LUCK_CONTENT.daeun[p.stemTenGod].love}`;
      }),
      ...(shift ? [`${shift.startYear}년에 대운이 ${shift.ganzhi.hangul}(${shift.ganzhi.hanja})${euro(shift.ganzhi.hangul)} 바뀌어요. ${C.decade.daeunShift}`] : []),
    ],
  };

  // ── 10. 가까운 3년 ───────────────────────────────────────
  const three = years.slice(0, 3);
  const bandSeen = new Map<string, number>();
  const usedTg = new Set<TenGod>();
  const actionSeen = new Map<TenGodGroup, number>();
  const threeParas: string[] = ['가까운 3년을 한 해씩 짚어 볼게요. 각 해의 첫 줄은 간지, 인연·약속 점수, 들어오는 십성, 배우자 자리와의 관계를 한 줄로 정리한 거예요.'];
  for (const x of three) {
    const b = band(x.love);
    const v = bandSeen.get(b) ?? 0;
    bandSeen.set(b, v + 1);
    const sit = C.situation[b][v % 3]!;
    const tags = tagLine(x);
    const texts = x.signals.filter((s) => s !== 'steady' || x.signals.length === 1).slice(0, 3).map((s) => C.signal[s].text);
    const stemSeen = usedTg.has(x.stemTenGod);
    usedTg.add(x.stemTenGod);
    const grp = TEN_GOD_GROUP[x.stemTenGod];
    const actionIdx = actionSeen.get(grp) ?? 0;
    actionSeen.set(grp, actionIdx + 1);
    threeParas.push(
      [`${x.year}년 ${x.hangul}(${x.hanja})`, `인연 ${x.love}점`, `약속 ${x.bond}점`, `${x.stemTenGod}·${x.branchTenGod}`, ...tags.filter((t) => !t.startsWith('인연의 별'))].join(' · '),
      `천간으로 ${x.stemTenGod}(${TEN_GOD_CONTENT[x.stemTenGod].keyword}), 지지로 ${x.branchTenGod}(${TEN_GOD_CONTENT[x.branchTenGod].keyword})의 기운이 들어오는 해예요. ${stemSeen ? LUCK_CONTENT.month[x.stemTenGod].love[1] : TEN_GOD_CONTENT[x.stemTenGod].inLuck.love}`,
      ...(x.branchTenGod !== x.stemTenGod && !usedTg.has(x.branchTenGod) ? [`생활의 바탕(지지)에서는 ${x.branchTenGod}의 기운이 이렇게 작용해요. ${TEN_GOD_CONTENT[x.branchTenGod].inLuck.love}`] : []),
      texts.length ? texts.join(' ') : C.noSignal,
      `${x.year}년 안에서는 ${bestLoveMonths(chart, x.year).join('과 ')}${C.bestMonths}`,
      `혼자인 분 — ${sit.single}`,
      `만나는 사람이 있는 분 — ${sit.dating}`,
      `함께 살거나 약속한 분 — ${sit.committed}`,
      `${x.year}년의 실천 — ${C.yearAction[grp][actionIdx % 2]}`,
    );
    usedTg.add(x.branchTenGod);
  }
  const bestThree = topBy(three, 'love', 1)[0]!;
  const threeYears: ReadingSection = {
    key: 'threeYears',
    title: `가까운 3년, 한 해씩 (${start}~${start + 2})`,
    summary: `${bestThree.year}년의 인연 기운이 가장 높아요`,
    keywords: three.map((x) => `${x.year} 인연 ${x.love}`),
    paragraphs: threeParas,
  };

  // ── 11. 실천 ─────────────────────────────────────────────
  const advice: ReadingSection = {
    key: 'advice',
    title: '관계를 위한 실천',
    summary: `${EL_NAME[y.yongsin]} 기운을 채우는 데이트가 잘 맞아요`,
    keywords: [`용신 ${EL_NAME[y.yongsin]}`, level, `${dominant} 중심`],
    paragraphs: [
      `${level}인 당신에게 — ${C.advice.strength[level]}`,
      `용신 ${EL_NAME[y.yongsin]}${elp(y.yongsin, '을', '를')} 채우는 시간 — ${C.advice.date[y.yongsin]}`,
      `대화의 기술 — ${C.advice.communication[dominant]}`,
      `나를 채우는 습관 — 관계를 건강하게 지키는 힘은 나를 돌보는 데서 나와요. ${C.advice.selfCare[y.yongsin]}`,
      `내가 지쳤다는 신호 — 일간이 ${EL_NAME[chart.dayMaster.element]}${elp(chart.dayMaster.element, '이라', '라')} ${C.advice.tired[chart.dayMaster.element]} 이런 신호가 보이면 "요즘 좀 지쳤어"라고 먼저 알려 주세요. 상대가 내 상태를 알면 오해 대신 배려가 돌아와요.`,
      `함께 쓰면 좋은 색은 ${ELEMENT_INFO[y.yongsin].color}, 함께 가면 좋은 방향은 ${ELEMENT_INFO[y.yongsin].direction}${ieyo(ELEMENT_INFO[y.yongsin].direction)}. 데이트 장소나 선물을 고를 때 가볍게 참고해 보세요.`,
      `이번 달에 해 볼 일 세 가지 — 하나, 고마운 점을 하루 한 가지씩 말로 전하기. 둘, ${C.advice.action[y.yongsin]}. 셋, 서운한 일은 일주일을 넘기지 않고 부드럽게 꺼내기.`,
    ],
  };

  // ── 12. 마무리 ───────────────────────────────────────────
  const closing: ReadingSection = {
    key: 'closing',
    title: '마무리 — 나다운 사랑을 위해',
    summary: stem.oneLine,
    paragraphs: [C.closing[0]!, `${dm.name}인 당신에게 건네는 한마디: ${stem.oneLine}`, C.closing[1]!, `이 리포트는 명리학 이론을 바탕으로 한 참고용 풀이예요. ${C.closing[2]!}`, C.closing[3]!],
  };

  return [summary, loveNature, spousePalace, tenGodBalance, attraction, idealPartner, pattern, friction, decade, threeYears, advice, closing];
}
