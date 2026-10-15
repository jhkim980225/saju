/**
 * 연애·결혼운 리포트 생성기 — 프로필 한 사람의 사주로 본 사랑의 방식과 인연의 흐름.
 *
 * 쉬운 말 기준(docs/PLAIN_KOREAN.md): 사주를 한 번도 본 적 없는 사람이 막힘없이 읽게 쓴다.
 * - 장마다 결론을 먼저 말하고, 용어·간지·점수는 basis('사주로 보면' 접힘)에만 둔다.
 * - 이름이 있으면 "○○님은"으로 부르고, 없으면 주어를 뺀다("당신"은 쓰지 않는다).
 * - 시기는 "2029년 가을쯤"처럼 생활어로, 점수는 '아주 좋음 / 좋음 / 보통 / 잔잔함'으로 말한다.
 *
 * 구성(12장): 요약 → 사랑할 때의 나(일간) → 가까운 사이에서의 나(일지) → 관계를 움직이는 마음(십성)
 *   → 끌림과 매력(도화·홍염) → 나에게 맞는 사람(용신·희신·신강도·일지 육합) → 가까워지는 속도
 *   → 부딪히기 쉬운 지점(일지 합충) → 앞으로 10년(세운 + 대운) → 가까운 3년 → 실천 → 마무리.
 * 분량 목표: 공백 제외 약 8천 자. 규칙 기반 초안이 사실을 모두 담고(근거는 basis), AI 는 문장만 다듬는다.
 *
 * 성별 중립:
 * - 전통 명리는 성별에 따라 재성/관성 가운데 하나를 배우자의 별로 읽지만, 여기서는 둘 다 인연으로 함께 읽는다.
 * - chart.input.gender 와 엔진의 scores.love(성별로 계산한다)는 쓰지 않고, 인연·약속 점수를 따로 매긴다.
 * - 대운은 성별로 방향이 바뀌므로 요약(summary)과 10년 흐름(decade) 장에서만 쓴다. 나머지 장은 성별과 무관하게 같다.
 */
import {
  BRANCHES,
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
import { LOVE_REPORT as C, type DayBranchRelation, type LoveYearSignal } from './content/loveReport.js';
import { displayName, nameSubject } from './content/plain.js';
import { targetFortuneYear } from './reading.js';
import { EL_TERM, EL_WORD, GROUPS, gradeWord, groupCount, listPp, monthsText, pp, prt, scoreBand, seasonOf, stemTerm, yearsText } from './topicReportKit.js';

const POSITION_TERM: Record<PillarPosition, string> = { year: '년주', month: '월주', day: '일주', hour: '시주' };
/** 관계를 차분히 다음 단계로 옮기기 좋은 12운성 */
const STEADY: TwelveStage[] = ['관대', '건록', '제왕', '쇠'];
const SIGNAL_ORDER: LoveYearSignal[] = ['combine', 'stemCombine', 'dohwa', 'half', 'trine', 'jae', 'gwan', 'proper', 'siksang', 'steady', 'clash', 'punish', 'wonjin', 'harmBreak'];
const POSITIVE: LoveYearSignal[] = ['combine', 'half', 'trine', 'stemCombine', 'dohwa', 'jae', 'gwan', 'proper', 'siksang', 'steady'];
const CHANGE: LoveYearSignal[] = ['clash', 'punish', 'wonjin', 'harmBreak'];
/** 가까운 3년 풀이에 문장으로 보여 줄 신호 — 십성으로 읽는 신호(재성·관성·식상·정재정관·안정)는 그해 풀이가 대신한다 */
const RELATION_SIGNALS: LoveYearSignal[] = ['combine', 'half', 'trine', 'stemCombine', 'dohwa', 'clash', 'punish', 'wonjin', 'harmBreak'];
const DAY_BRANCH_RELATIONS: DayBranchRelation[] = ['육합', '반합', '삼합', '방합', '충', '형', '자형', '파', '해', '원진'];
/** 근거에 쓰는 신호 이름 */
const SIGNAL_TERM: Record<LoveYearSignal, string> = {
  combine: '일지 육합', half: '일지 반합', trine: '일지 삼합 기운', stemCombine: '일간 천간합', dohwa: '도화', jae: '재성', gwan: '관성',
  siksang: '식상', proper: '정재·정관', steady: '안정 12운성', clash: '일지 충', punish: '일지 형', wonjin: '일지 원진', harmBreak: '일지 해·파',
};

const clamp = (n: number) => Math.max(20, Math.min(98, Math.round(n)));
const word = (n: number) => gradeWord(n, '잔잔함');

interface LoveYear {
  year: number;
  hanja: string;
  stemTenGod: TenGod;
  branchTenGod: TenGod;
  stage: TwelveStage;
  total: number;
  /** 그해 천간이 균형을 흔드는 기운(기신)인가 — 마음이 쉽게 지치는 해 */
  gisin: boolean;
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
    stemTenGod: p.stemTenGod,
    branchTenGod: p.branchTenGod,
    stage: p.twelveStage,
    total: t,
    gisin: ev.fit.stem === 'gisin',
    signals: SIGNAL_ORDER.filter((k) => s.has(k)),
    love,
    bond,
  };
}

/** 한 해 안에서 인연의 기운이 높은 두 달(절기 기준 월운) — 해마다 쓰는 신호와 같은 기준, 성별을 쓰지 않는다. 양력 달로 돌려준다 */
function bestLoveMonths(chart: SajuChart, year: number): { year: number; month: number }[] {
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
    .map(({ i }) => (i === 11 ? { year: year + 1, month: 1 } : { year, month: i + 2 }));
}

/** 점수 높은 순(같으면 이른 해) */
const topBy = (ys: LoveYear[], k: 'love' | 'bond', n: number) => [...ys].sort((a, b) => b[k] - a[k] || a.year - b.year).slice(0, n);

/** 약속(관계 다지기)의 이유는 묶어 주는 신호부터 */
const BOND_ORDER: LoveYearSignal[] = ['stemCombine', 'proper', 'combine', 'half', 'steady', 'trine', 'gwan', 'jae'];
/** 왜 이 해인가 — 쉬운 말 이유 두 가지까지(없으면 빈 배열) */
function reasonsOf(y: LoveYear, k: 'love' | 'bond'): LoveYearSignal[] {
  // 인연은 만남·설렘의 신호, 약속은 묶어 주는 신호로 — 정재·정관이 있으면 같은 뜻의 재성·관성은 빼고 쓴다
  const proper = y.signals.includes('proper');
  if (k === 'love') return y.signals.filter((s) => POSITIVE.includes(s) && s !== 'steady' && s !== 'proper').slice(0, 2);
  return BOND_ORDER.filter((s) => y.signals.includes(s) && !(proper && (s === 'jae' || s === 'gwan'))).slice(0, 2);
}
const clauses = (rs: LoveYearSignal[]) => (rs.length === 1 ? C.signal[rs[0]!].end : `${C.signal[rs[0]!].and}, ${C.signal[rs[1]!].end}`);
/**
 * 여러 해의 이유 — 같은 문단에서 같은 이유를 되풀이하지 않고, 이유가 없는 해는 한 문장으로 묶는다.
 * told: 앞(새 인연) 문단에서 해마다 말한 이유 — 관계 다지기 문단에서는 그 이유를 빼고 말한다.
 */
function reasonSentences(ys: LoveYear[], k: 'love' | 'bond', told?: Map<number, LoveYearSignal[]>): string {
  const out: string[] = [];
  const plain: number[] = [];
  const plainTold: number[] = [];
  const used = new Set<LoveYearSignal>();
  for (const y of ys) {
    const before = told?.get(y.year);
    const all = reasonsOf(y, k).filter((s) => !(k === 'bond' && before?.includes(s)));
    // 앞 해에서 이미 쓴 이유는 되풀이하지 않는다 — 새 이유가 없을 때만 하나를 다시 쓴다
    const fresh = all.filter((s) => !used.has(s));
    const rs = fresh.length ? fresh.slice(0, 2) : all.slice(0, 1);
    rs.forEach((s) => used.add(s));
    if (k === 'love') told?.set(y.year, rs);
    if (rs.length === 0) {
      if (k === 'bond' && before !== undefined) (before.length ? out.push(`${y.year}년은 새 인연과 관계 다지기가 함께 좋은 해예요.`) : plainTold.push(y.year));
      else plain.push(y.year);
      continue;
    }
    out.push(`${y.year}년${k === 'love' ? '에는' : '은'} ${clauses(rs)}.`);
  }
  if (plain.length) out.push(`${pp(yearsText(plain), '은', '는')} 그해의 흐름이 사주와 잘 맞아 마음에 여유가 생기기 쉬워요.`);
  if (plainTold.length) out.push(`${pp(yearsText(plainTold), '은', '는')} 마음에 여유가 있는 만큼 앞날을 차분히 이야기하기에도 좋아요.`);
  return out.join(' ');
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

export function buildLoveReport(chart: SajuChart, now = new Date(), rawName?: string | null): ReadingSection[] {
  const name = displayName(rawName);
  const stem = C.stem[chart.dayMaster.index]!;
  const stemName = stemTerm(chart);
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
  const groupsTerm = GROUPS.map((k) => `${k} ${g[k]}`).join(' · ');

  const start = targetFortuneYear(now);
  const end = start + 9;
  const years = Array.from({ length: 10 }, (_, i) => loveYear(chart, start + i));
  const topLove = topBy(years, 'love', 3);
  const topBond = topBy(years, 'bond', 2);
  const best = topLove[0]!;
  const bestBond = topBond[0]!;
  const bestMonths = bestLoveMonths(chart, best.year);
  // 같은 해 안의 달을 계절로 — 다음 해 1월로 넘어가는 달은 되도록 쓰지 않는다
  const seasonMonth = (bestMonths.find((m) => m.year === best.year) ?? bestMonths[0]!).month;
  const daeunNow = chart.daeun.periods.find((p) => start >= p.startYear && start <= p.endYear);

  // ── 1. 요약 ────────────────────────────────────────────────
  const partner = C.partner[y.yongsin];
  const timing =
    best.year === bestBond.year
      ? `앞으로 10년 가운데 새 인연이 들어오기 가장 좋은 때는 ${best.year}년 ${seasonOf(seasonMonth)}쯤이에요. 같은 해에 관계를 한 단계 진지하게 이야기하기도 좋아요.`
      : `앞으로 10년 가운데 새 인연이 들어오기 가장 좋은 때는 ${best.year}년 ${seasonOf(seasonMonth)}쯤이에요. 관계를 한 단계 진지하게 이야기하기 좋은 해는 ${bestBond.year}년이에요.`;
  const summary: ReadingSection = {
    key: 'summary',
    title: '한눈에 보는 연애·결혼운',
    summary: `${best.year}년 ${seasonOf(seasonMonth)}쯤 새 인연이 들어오기 좋아요`,
    keywords: [stem.chip, partner.chip, `새 인연 ${best.year}년`, `관계 다지기 ${bestBond.year}년`],
    paragraphs: [
      `${nameSubject(name, '은')}${stem.lead}`,
      `${nameSubject(name, '에게')}잘 맞는 사람은 ${pp(partner.short, '이에요', '예요')}. 성별이나 조건이 아니라 이런 기질을 가진 사람 곁에서 마음이 편해져요.`,
      `${timing}${daeunNow ? ` 10년마다 바뀌는 큰 흐름으로 보면, 지금은 ${pp(C.decade.daeunShort[TEN_GOD_GROUP[daeunNow.stemTenGod]], '이에요', '예요')}.` : ''}`,
      `조심하면 좋은 점은 하나예요. ${stem.caution[0]} ${stem.caution[1]}`,
      C.howToRead,
      C.whereToStart,
    ],
    basis: [
      `일간 ${stemName}`,
      `일지(배우자 자리) ${db.hanja} ${db.tenGod}`,
      `인연의 별 재성 ${g.재성}·관성 ${g.관성}`,
      `용신 ${EL_TERM[y.yongsin]}`,
      `인연 최고 ${best.year} ${best.hanja}(${best.love}점)`,
      `약속 최고 ${bestBond.year} ${bestBond.hanja}(${bestBond.bond}점)`,
      ...(daeunNow ? [`지금 대운 ${daeunNow.ganzhi.hanja}(${daeunNow.stemTenGod})`] : []),
      '전통 명리는 성별에 따라 재성·관성 가운데 하나를 배우자의 별로 읽지만, 이 리포트는 둘 다 인연으로 함께 읽어요',
    ].join(' · '),
  };

  // ── 2. 사랑할 때의 나 ─────────────────────────────────────
  const loveNature: ReadingSection = {
    key: 'loveNature',
    title: '사랑할 때의 나',
    summary: stem.headline,
    paragraphs: [
      `${nameSubject(name, '은')}${stem.style}`,
      stem.attracted,
      `${stem.expression} ${stem.scene}`,
      stem.dateStyle,
      stem.needs,
      stem.conflict,
      stem.heard,
      stem.growth,
      `가까운 사람이 알아 두면 좋은 점도 있어요. ${stem.partnerNote}`,
    ],
    basis: `일간 ${stemName} · ${chart.dayMaster.yinYang === 'yang' ? '양간 — 먼저 다가가는 쪽' : '음간 — 반응을 살피며 다가가는 쪽'}`,
  };

  // ── 3. 가까운 사이에서의 나 ──────────────────────────────
  const palace = C.palace.tenGod[db.tenGod];
  const spousePalace: ReadingSection = {
    key: 'spousePalace',
    title: '가까운 사이에서의 나',
    summary: palace.headline,
    paragraphs: [
      `${nameSubject(name, '은')}가까운 사이가 되면 ${palace.text} ${palace.hurt}`,
      C.palace.element[dbEl],
      C.palace.branch[db.index]!,
      C.palace.stage[db.twelveStage],
      C.palace.longRun[dbEl],
      C.palace.hidden,
    ],
    tips: [palace.tip],
    basis: `일지(태어난 날의 지지, 배우자 자리) ${db.hanja}(${db.hangul}) · ${EL_TERM[dbEl]} · 십성 ${db.tenGod} · 지장간 ${db.hiddenStems.map((h) => `${h.hanja}(${h.tenGod})`).join(', ')} · 12운성 ${db.twelveStage}`,
  };

  // ── 4. 관계를 움직이는 마음 ──────────────────────────────
  const absent = GROUPS.filter((k) => g[k] === 0 && k !== dominant);
  const second = GROUPS.filter((k) => k !== dominant).reduce((b, k) => (g[k] > g[b] ? k : b), GROUPS.find((k) => k !== dominant)!);
  /** 인연의 별(재성·관성)이 천간이나 지지에 놓인 기둥 */
  const isStar = (t: string) => t !== '일간' && (TEN_GOD_GROUP[t as TenGod] === '재성' || TEN_GOD_GROUP[t as TenGod] === '관성');
  const starPositions = (['year', 'month', 'day', 'hour'] as const).filter((pos) => {
    const p = chart.pillars[pos];
    return p !== null && (isStar(p.stem.tenGod) || isStar(p.branch.tenGod));
  });
  const starText = stars >= 4 ? C.stars.many : g.재성 > 0 && g.관성 > 0 ? C.stars.both : g.재성 > 0 ? C.stars.jaeOnly : g.관성 > 0 ? C.stars.gwanOnly : C.stars.none;
  const tenGodBalance: ReadingSection = {
    key: 'tenGodBalance',
    title: '관계를 움직이는 마음',
    summary: `'${C.group[dominant].name}'${prt(C.group[dominant].name, '이', '가')} 관계를 이끌어요`,
    paragraphs: [
      `${nameSubject(name, '의')}관계를 가장 크게 움직이는 건 '${C.group[dominant].name}'이에요. ${C.group[dominant].strong}`,
      C.group[dominant].overdo,
      // 두 번째 마음이 인연의 별(재성·관성)이면 아래 인연 이야기와 겹치니 말하지 않는다
      ...(g[second] > 0 && second !== '재성' && second !== '관성' ? [C.group[second].support] : []),
      starText,
      ...(starPositions.length >= 3 ? [C.starEverywhere] : starPositions.length ? [`인연은 ${starPositions.map((p) => C.starPosition[p]).join(', 또는 ')} 닿기 쉬워요.`] : []),
      ...absent.slice(0, 2).map((k, i) => (i === 0 ? `반대로 ${C.group[k].absent}` : C.group[k].absent)),
    ],
    tips: [C.group[dominant].tip],
    basis: `십성 ${groupsTerm} · 인연의 별(재성·관성) ${stars}개${starPositions.length ? `, 놓인 자리 ${starPositions.map((p) => POSITION_TERM[p]).join('·')}` : ''}`,
  };

  // ── 5. 끌림과 매력 ───────────────────────────────────────
  const firePct = Math.round(chart.elements.percent.fire);
  const fireBand = firePct >= 25 ? 'high' : firePct >= 12 ? 'mid' : 'low';
  const charmParas: string[] = [];
  if (hasDohwa) {
    const ps = (['year', 'month', 'day', 'hour'] as const).filter((p) => shinsal.get('도화살')!.has(p));
    charmParas.push(`${C.attraction.dohwa} ${C.attraction.dohwaAt[ps[0]!]}`);
  }
  if (hasHongyeom) charmParas.push(C.attraction.hongyeom);
  if (hasDohwa && hasHongyeom) charmParas.push(C.attraction.both);
  const dohwaYears = years.filter((x) => x.signals.includes('dohwa'));
  const dmEl = chart.dayMaster.element;
  const domEl = chart.elements.dominant;
  const attraction: ReadingSection = {
    key: 'attraction',
    title: '끌림과 매력',
    summary: hasDohwa || hasHongyeom ? '사람을 끄는 매력이 뚜렷해요' : '알수록 깊어지는 잔잔한 매력이에요',
    paragraphs: [
      ...(charmParas.length ? [...charmParas, C.attraction.tip] : [C.attraction.quiet]),
      `${C.attraction.firstImpression[dmEl]} ${C.attraction.moment[dmEl]}`,
      // 첫인상과 같은 기운이면 같은 말을 되풀이하지 않고 살리는 법만
      domEl === dmEl ? C.attraction.charmTip[domEl] : `${C.attraction.charm[domEl]} ${C.attraction.charmTip[domEl]}`,
      `${C.attraction.fire[fireBand]} ${C.attraction.siksang[g.식상 >= 3 ? 'many' : g.식상 > 0 ? 'some' : 'none']}`,
      C.attraction.style[y.yongsin],
      ...(dohwaYears.length ? [`앞으로 10년 가운데 ${yearsText(dohwaYears.map((x) => x.year))}에는 ${C.attraction.dohwaYears}`] : []),
    ],
    basis: [
      hasDohwa ? `도화살(${[...shinsal.get('도화살')!].map((p) => POSITION_TERM[p]).join('·')})` : '도화살 없음',
      hasHongyeom ? '홍염살 있음' : '홍염살 없음',
      `일간 오행 ${EL_TERM[dmEl]}`,
      `가장 강한 오행 ${EL_TERM[domEl]}`,
      `화(火) 비중 ${firePct}%`,
      `식상 ${g.식상}`,
      ...(dohwaYears.length ? [`도화가 드는 해 ${dohwaYears.map((x) => `${x.year} ${x.hanja}`).join(', ')}`] : []),
    ].join(' · '),
  };

  // ── 6. 나에게 맞는 사람 ──────────────────────────────────
  const comboBranch = BRANCHES.find((b) => b.index !== db.index && sixCombine(db.index, b.index) !== null);
  const lacking = chart.elements.lacking.filter((el) => el !== y.yongsin);
  const idealPartner: ReadingSection = {
    key: 'idealPartner',
    title: '나에게 맞는 사람',
    summary: `${partner.chip} 곁에서 힘이 나요`,
    paragraphs: [
      `${nameSubject(name, '에게')}힘이 되는 사람은 ${pp(partner.temperament, '이에요', '예요')}. ${partner.why} 사주에서는 이런 사람을 '${EL_WORD[y.yongsin]} 기운'이 살아 있는 사람이라고 해요.`,
      `처음 만났을 때 알아보는 법도 있어요. ${partner.spot}`,
      `${partner.together} ${C.partnerGive[dmEl]}`,
      `주로 ${partner.meet}`,
      C.heesin[y.heesin],
      C.partnerStrength[level],
      // 손발이 맞는 기질이 지치게 하는 기질과 같은 기운이면 서로 어긋나 보이니 말하지 않는다
      ...(comboBranch && comboBranch.element !== y.gisin ? [`특히 ${C.combineTemperament[comboBranch.element]} 사람과는 함께 있을 때 자연스럽게 손발이 맞기 쉬워요.`] : []),
      ...(lacking.length ? [`나와 다른 사람에게 끌리는 것도 자연스러워요. ${listPp(lacking.map((el) => C.complement[el]), '을', '를')} 가진 사람 곁에서는 그 힘을 자연스럽게 배우기 쉬워요.`] : []),
      `반대로 ${C.partnerCaution[y.gisin]}에서는 마음이 빨리 지치는 편이에요. 사람이 나빠서라기보다 서로 방향이 달라서라, 이런 장면이 되풀이되면 속도와 거리를 조절해 보세요.`,
      C.partnerNote,
    ],
    basis: [
      `용신 ${EL_TERM[y.yongsin]}`,
      `희신 ${EL_TERM[y.heesin]}`,
      `기신 ${EL_TERM[y.gisin]}`,
      `일간의 힘 ${level}`,
      ...(comboBranch ? [`일지 ${db.hanja}(${db.hangul})${prt(db.hangul, '과', '와')} 육합하는 ${comboBranch.hanja}(${comboBranch.hangul}, ${EL_TERM[comboBranch.element]})`] : []),
      ...(lacking.length ? [`원국에 없는 오행 ${lacking.map((el) => EL_TERM[el]).join('·')}`] : []),
    ].join(' · '),
  };

  // ── 7. 가까워지는 속도 ───────────────────────────────────
  const give = g.식상 + g.재성;
  const receive = g.인성;
  const pattern: ReadingSection = {
    key: 'pattern',
    title: '가까워지는 속도와 주고받는 방식',
    summary: `${C.patternSpeed[level]}, ${give >= receive + 2 ? '주는 쪽에 서기 쉬운 편이에요' : receive >= give + 2 ? '받을 때 힘이 나는 편이에요' : '주고받는 균형이 맞는 편이에요'}`,
    paragraphs: [
      C.pattern[level],
      C.patternGroup[dominant],
      C.firstDate[dominant],
      `시간에 따라 보면, ${C.phase[dominant].early} ${C.phase[dominant].middle} ${C.phase[dominant].settled}`,
      C.longTerm[level],
      C.rhythm[dbEl],
      give >= receive + 2 ? C.giveReceive.give : receive >= give + 2 ? C.giveReceive.receive : C.giveReceive.even,
    ],
    basis: `일간의 힘 ${level}(돕는 기운 ${Math.round(chart.strength.score)}%) · 가장 많은 십성 ${dominant} · 일지 오행 ${EL_TERM[dbEl]} · 주는 기운(식상+재성) ${give} · 받는 기운(인성) ${receive}`,
  };

  // ── 8. 부딪히기 쉬운 지점 ────────────────────────────────
  const rels = dayBranchRelations(chart);
  const stemRels = chart.relations.filter((r) => r.target === 'stem' && r.positions.includes('day'));
  const order: Exclude<PillarPosition, 'day'>[] = ['year', 'month', 'hour'];
  const whereOf = (ps: Exclude<PillarPosition, 'day'>[]) => ps.map((p) => C.friction.where[p]).filter((v, i, a) => a.indexOf(v) === i).join('·');
  const places = whereOf(order.filter((p) => rels.some((r) => r.positions.includes(p))));
  const tiredYears = years.filter((x) => x.gisin);
  const frictionParas: string[] = [];
  if (rels.length) {
    frictionParas.push(`${pp(places, '과', '와')} 사랑 사이를 조금 더 챙기면 좋아요. ${C.friction.intro}`);
    for (const r of rels) {
      const where = whereOf(r.positions);
      frictionParas.push(`${pp(where, '과', '와')} 사랑 사이에는 ${C.friction.branch[r.type].text}`);
    }
  } else {
    frictionParas.push(C.friction.calm);
  }
  if (stemRels.some((r) => r.type === '천간합')) frictionParas.push(C.friction.stemCombine);
  if (stemRels.some((r) => r.type === '천간충')) frictionParas.push(C.friction.stemClash);
  if (shinsal.has('귀문관살')) frictionParas.push(C.friction.gwimun);
  frictionParas.push(C.friction.seed[dominant], C.friction.repair[dmEl], C.friction.recover[level]);
  if (tiredYears.length) frictionParas.push(`앞으로 10년 가운데 ${yearsText(tiredYears.map((x) => x.year))}에는 ${C.friction.tired}`);
  const friction: ReadingSection = {
    key: 'friction',
    title: '부딪히기 쉬운 지점',
    summary: rels.length ? `${pp(places, '과', '와')} 사랑 사이에 힘이 몰려요` : C.friction.calmSummary,
    paragraphs: frictionParas,
    tips: rels.length ? rels.map((r) => C.friction.branch[r.type].tip).filter((v, i, a) => a.indexOf(v) === i) : undefined,
    basis: [
      rels.length ? `일지 ${db.hanja} — ${rels.map((r) => `${r.positions.map((p) => POSITION_TERM[p]).join('·')}와 ${r.type}`).join(', ')}` : `일지 ${db.hanja} — 원국 합충 없음`,
      ...stemRels.filter((r) => r.type === '천간합' || r.type === '천간충').map((r) => `일간 ${r.type}`),
      ...(shinsal.has('귀문관살') ? ['귀문관살'] : []),
      `가장 많은 십성 ${dominant}`,
      `일간의 힘 ${level}`,
      `기신 ${EL_TERM[y.gisin]}${tiredYears.length ? `(기신이 드는 해 ${tiredYears.map((x) => x.year).join('·')})` : ''}`,
    ].join(' · '),
  };

  // ── 9. 앞으로 10년 ───────────────────────────────────────
  // 해·파는 작은 어긋남이라 '변화가 생기는 해' 목록에는 넣지 않는다(목록 줄과 근거에만)
  const told = new Map<number, LoveYearSignal[]>();
  const changeYears = years.filter((x) => x.signals.some((s) => CHANGE.includes(s) && s !== 'harmBreak'));
  const lowLove = [...years].sort((a, b) => a.love - b.love || a.year - b.year).slice(0, 2).sort((a, b) => a.year - b.year);
  const periods = chart.daeun.periods.filter((p) => p.endYear >= start && p.startYear <= end);
  const shift = periods.find((p) => p.startYear > start && p.startYear <= end);
  const yearLine = (x: LoveYear) => {
    // 인연이 보통 이상인 해는 좋은 신호를, 잔잔한 해는 변화 신호를 앞세운다('안정'은 다른 신호가 없을 때만)
    const pos = x.signals.find((s) => POSITIVE.includes(s) && s !== 'steady');
    const chg = x.signals.find((s) => CHANGE.includes(s));
    // 해·파(작은 어긋남)는 인연이 잔잔한 해에만 앞세운다
    const top = x.love >= 50 ? (pos ?? (chg !== 'harmBreak' ? chg : undefined) ?? (x.signals.includes('steady') ? 'steady' : undefined)) : chg;
    const tail = top ? C.signal[top].line : C.decade.quiet[scoreBand(x.love)];
    return `${x.year}년 · 새 인연 ${word(x.love)} · 관계 다지기 ${word(x.bond)} · ${tail}`;
  };
  const sameGroupAsPrev = (i: number) => i > 0 && TEN_GOD_GROUP[periods[i - 1]!.stemTenGod] === TEN_GOD_GROUP[periods[i]!.stemTenGod];
  const decade: ReadingSection = {
    key: 'decade',
    title: `앞으로 10년의 인연 흐름 (${start}~${end})`,
    summary: `새 인연은 ${topLove.map((x) => x.year).join('·')}년, 관계 다지기는 ${topBond.map((x) => x.year).join('·')}년이 좋아요`,
    keywords: [...topLove.map((x) => `새 인연 ${x.year}`), ...topBond.map((x) => `관계 다지기 ${x.year}`)],
    paragraphs: [
      `새로운 인연이나 설렘이 커지기 쉬운 해는 ${yearsText(topLove.map((x) => x.year))}이에요. ${reasonSentences(topLove, 'love', told)} 가장 좋은 ${best.year}년에는 ${monthsText(best.year, bestMonths)} 무렵을 특히 눈여겨보세요.`,
      `결혼이나 함께 사는 약속처럼 관계를 한 단계 진지하게 생각한다면, ${yearsText(topBond.map((x) => x.year))}에 이야기를 꺼내 보기 좋아요. ${reasonSentences(topBond, 'bond', told)}`,
      C.decade.intro,
      ...years.map(yearLine),
      ...(changeYears.length ? [`${yearsText(changeYears.map((x) => x.year))}에는 가까운 관계에 작은 변화가 생기기 쉬워요. ${C.decade.change}`] : []),
      `${pp(yearsText(lowLove.map((x) => x.year)), '은', '는')} 새 인연의 흐름이 잔잔한 해예요. ${C.decade.low}`,
      ...periods.map((p, i) => {
        const grp = TEN_GOD_GROUP[p.stemTenGod];
        const head = i === 0 ? `10년마다 바뀌는 큰 흐름으로 보면, ${p.startYear}년부터 ${p.endYear}년까지는` : `${p.startYear}년부터 ${p.endYear}년까지는`;
        // 이어지는 두 흐름이 같은 무리면 설명은 한 번만
        return sameGroupAsPrev(i) ? `${head} 앞의 10년과 비슷한 흐름이 이어져요.` : `${head} ${C.decade.daeun[grp]} ${C.decade.daeunSingle[grp]} ${C.decade.daeunTip[grp]}`;
      }),
      ...(shift && !sameGroupAsPrev(periods.indexOf(shift)) ? [`${shift.startYear}년에 이 큰 흐름이 바뀌어요. ${C.decade.shift}`] : []),
    ],
    basis: [
      ...years.map((x) => `${x.year} ${x.hanja} 인연 ${x.love}·약속 ${x.bond}${x.signals.length ? `(${x.signals.map((s) => SIGNAL_TERM[s]).join(', ')})` : ''}`),
      ...periods.map((p) => `대운 ${p.startYear}~${p.endYear} ${p.ganzhi.hanja}(${p.stemTenGod}·${p.branchTenGod})`),
    ].join(' · '),
  };

  // ── 10. 가까운 3년 ───────────────────────────────────────
  const three = years.slice(0, 3);
  const bandSeen = new Map<string, number>();
  const actionSeen = new Map<TenGodGroup, number>();
  const shownSignals = new Set<LoveYearSignal>();
  const bestThree = topBy(three, 'love', 1)[0]!;
  const threeParas: string[] = [`가까운 3년 가운데 마음을 열기 가장 좋은 해는 ${bestThree.year}년이에요. 한 해씩 짚어 볼게요.`];
  const threeTips: string[] = [];
  for (const x of three) {
    const b = scoreBand(x.love);
    const v = bandSeen.get(b) ?? 0;
    bandSeen.set(b, v + 1);
    const sit = C.situation[b][v % 3]!;
    // 앞의 해에서 이미 말한 신호는 되풀이하지 않는다
    const texts = x.signals.filter((s) => RELATION_SIGNALS.includes(s) && !shownSignals.has(s)).slice(0, 2);
    texts.forEach((s) => shownSignals.add(s));
    const grp = TEN_GOD_GROUP[x.stemTenGod];
    const actionIdx = actionSeen.get(grp) ?? 0;
    actionSeen.set(grp, actionIdx + 1);
    threeParas.push(
      `${x.year}년 · 새 인연 ${word(x.love)} · 관계 다지기 ${word(x.bond)}`,
      `${x.year}년은 ${C.yearLove[x.stemTenGod]}`,
      ...(x.branchTenGod !== x.stemTenGod ? [`생활 속에서는 ${C.yearBase[x.branchTenGod]}`] : []),
      ...(texts.length ? [texts.map((s) => C.signal[s].text).join(' ')] : []),
      `${x.year}년 안에서는 ${monthsText(x.year, bestLoveMonths(chart, x.year))} 무렵에 마음을 전하거나 중요한 이야기를 꺼내기 좋아요.`,
      `관계를 다지는 쪽으로 보면 ${x.year}년에는 ${C.bondBand[scoreBand(x.bond)]}`,
      `혼자인 분 — ${sit.single}`,
      `만나는 사람이 있는 분 — ${sit.dating}`,
      `함께 살거나 약속한 분 — ${sit.committed}`,
      `혼자의 삶이 편한 분 — ${sit.solo}`,
    );
    threeTips.push(`${x.year}년 — ${C.yearAction[grp][actionIdx % 2]}`);
  }
  const threeYears: ReadingSection = {
    key: 'threeYears',
    title: `가까운 3년, 한 해씩 (${start}~${start + 2})`,
    summary: `${bestThree.year}년의 인연 흐름이 가장 좋아요`,
    keywords: three.map((x) => `${x.year} ${word(x.love)}`),
    paragraphs: threeParas,
    tips: threeTips,
    basis: [
      ...three.map((x) => `${x.year} ${x.hanja} — 천간 ${x.stemTenGod} · 지지 ${x.branchTenGod} · 12운성 ${x.stage}${x.signals.length ? ` · ${x.signals.map((s) => SIGNAL_TERM[s]).join(', ')}` : ''}`),
      '좋은 달은 절기 기준 월운으로 셈',
    ].join(' / '),
  };

  // ── 11. 실천 ─────────────────────────────────────────────
  const advice: ReadingSection = {
    key: 'advice',
    title: '관계를 위한 실천',
    summary: C.advice.summary[y.yongsin],
    paragraphs: [
      `${nameSubject(name, '에게')}잘 맞는 데이트는 ${C.advice.date[y.yongsin]}`,
      `${C.advice.bySituation[y.yongsin].single} ${C.advice.bySituation[y.yongsin].dating} ${C.advice.bySituation[y.yongsin].committed}`,
      C.advice.strength[level],
      C.advice.communication[dominant],
      `${nameSubject(name, '이')}사랑받는다고 느끼는 순간은 상대가 ${stem.loveLanguage} 때예요. 이걸 미리 알려 두면 서로 엇갈리는 마음이 줄어요.`,
      C.advice.ritual[dominant],
      C.advice.selfCare[y.yongsin],
      `내가 지쳤다는 신호도 알아 두세요. ${C.advice.tired[dmEl]} 이런 신호가 보이면 "요즘 좀 지쳤어"라고 먼저 알려 주세요. 상대가 내 상태를 알면 오해 대신 배려가 돌아와요.`,
      `데이트 장소나 선물을 고를 때는 ${C.advice.color[y.yongsin]} 계열을 가볍게 곁들여 보세요. 이번 달에 해 볼 일 세 가지도 골라 두었어요.`,
    ],
    tips: ['고마운 점을 하루 한 가지씩 말로 전하기', C.advice.action[y.yongsin], '서운한 일은 일주일을 넘기지 않고 부드럽게 꺼내기'],
    basis: `용신 ${EL_TERM[y.yongsin]} · 일간의 힘 ${level} · 가장 많은 십성 ${dominant} · 일간 오행 ${EL_TERM[dmEl]}`,
  };

  // ── 12. 마무리 ───────────────────────────────────────────
  const closing: ReadingSection = {
    key: 'closing',
    title: '마무리 — 나다운 사랑을 위해',
    summary: C.closing.summary,
    paragraphs: [C.closing.intro, `${name ? `${name}님에게` : '마지막으로'} 건네고 싶은 한마디가 있어요. ${stem.oneLine}`, C.closing.choice, C.closing.together, C.closing.note, C.closing.reread],
  };

  return [summary, loveNature, spousePalace, tenGodBalance, attraction, idealPartner, pattern, friction, decade, threeYears, advice, closing];
}

