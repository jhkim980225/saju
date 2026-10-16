/**
 * 띠별 운세 생성 — 띠(년지)와 기간의 운 기둥(일진·월건·세운)의 관계를 @saju/core 로 계산하고,
 * 관계에 맞는 문구 풀에서 결정적으로 골라 근거와 함께 돌려준다.
 */
import {
  BOND_WEIGHT,
  BRANCHES,
  ELEMENT_INFO,
  STEMS,
  addDays,
  birthYearsOfAnimal,
  dayPillarAt,
  evaluateZodiac,
  generatedBy,
  hashSeed,
  mod,
  monthPillarAt,
  stemBond,
  weekDatesOf,
  yearPillarAt,
  type BranchBond,
  type BranchBondInfo,
  type Element,
  type ZodiacEvaluation,
} from '@saju/core';
import {
  FREE_FORTUNE_PERIOD_LABEL,
  FREE_FORTUNE_TONE_LABEL,
  ZODIAC_ANIMALS,
  type FreeFortuneKeyDayDto,
  type FreeFortunePeriod,
  type FreeFortuneReasonDto,
  type FreeFortuneTone,
  type ZodiacAnimal,
  type ZodiacFortuneDto,
  type ZodiacOverviewDto,
} from '@saju/shared';
import { firstNoonDateOnOrAfter, isoOf, keyDaySummary, kstDateOf, monthDay, pick, range, rangeLabel, weekdayOf, type Ymd } from './common.js';
import {
  ANIMAL_TRAITS,
  BOND_GLOSS,
  BOND_REASON,
  BOND_SHORT,
  FLOW_GLOSS,
  FLOW_TEXT,
  KEYDAY_TEXT,
  MIXED_NOTE,
  RELATION_TEXT,
  SELF_PUNISH_NOTE,
  STAGE_TIP,
  STEM_RANK,
  STEM_TONE,
  TEN_GOD_PLAIN,
  WEEK_TEXT,
  YEAR_STEM_TEXT,
  ZODIAC_BASIS_NOTE,
  ZODIAC_DISCLAIMER,
  lifeStageOf,
  type BondKey,
  type StemKey,
} from './content/zodiacText.js';

/** 오행 이름 — 근거 카드 제목은 정식 이름('목'), 문장 안은 쉬운 이름을 붙여 '목(나무)'. 한 화면에서 같은 표기를 쓴다 */
const EL_NAME: Record<Element, string> = { wood: '목', fire: '화', earth: '토', metal: '금', water: '수' };
const EL_FULL: Record<Element, string> = { wood: '목(나무)', fire: '화(불)', earth: '토(흙)', metal: '금(쇠)', water: '수(물)' };
/** 정식 이름 뒤 목적격 조사 — '목을', '화를' */
const EL_OBJ: Record<Element, string> = { wood: '을', fire: '를', earth: '를', metal: '을', water: '를' };
/** '오늘' → '오늘은', '올해' → '올해는' */
const topic = (w: string) => w + (/[가-힣]$/.test(w) && (w.charCodeAt(w.length - 1) - 0xac00) % 28 !== 0 ? '은' : '는');
const animalName = (branch: number) => BRANCHES[mod(branch, 12)]!.animal;

const stemHanja = (s: number) => STEMS[mod(s, 10)]!.hanja;
const branchHanja = (b: number) => BRANCHES[mod(b, 12)]!.hanja;
const ganzhi = (p: { stem: number; branch: number }) => stemHanja(p.stem) + branchHanja(p.branch);
const ganzhiKo = (p: { stem: number; branch: number }) => STEMS[mod(p.stem, 10)]!.hangul + BRANCHES[mod(p.branch, 12)]!.hangul;

/** 두 지지를 순서대로 붙인 이름 — '寅申' */
const pairName = (a: number, b: number) => (mod(a, 12) <= mod(b, 12) ? branchHanja(a) + branchHanja(b) : branchHanja(b) + branchHanja(a));
const stemPairName = (a: number, b: number) => (mod(a, 10) <= mod(b, 10) ? stemHanja(a) + stemHanja(b) : stemHanja(b) + stemHanja(a));

function bondTitle(animal: number, other: number, bond: BranchBondInfo): string {
  if (bond.kind === '동일') return `같은 글자 ${branchHanja(animal)}`;
  if (bond.kind === '자형') return `${branchHanja(animal)}${branchHanja(animal)} 자형`;
  const el = bond.element ? `(${EL_NAME[bond.element]} 기운)` : '';
  return `${pairName(animal, other)} ${bond.kind}${el}`;
}

const keyOf = (ev: ZodiacEvaluation): BondKey => (ev.primary === '자형' ? '동일' : (ev.primary ?? 'none'));

/** 하루 단위 관계 점수 — 합충만 (이번 주 좋은 날·조심할 날 판정) */
const dayScore = (bonds: BranchBondInfo[]) => bonds.reduce((s, b) => s + BOND_WEIGHT[b.kind], 0);

/** 그날 가장 강하게 드러나는 관계 */
function strongestBond(bonds: BranchBondInfo[], sign: 1 | -1): BranchBondInfo | null {
  const list = bonds.filter((b) => Math.sign(BOND_WEIGHT[b.kind]) === sign);
  return list.sort((a, b) => Math.abs(BOND_WEIGHT[b.kind]) - Math.abs(BOND_WEIGHT[a.kind]))[0] ?? null;
}

interface SinglePillar {
  stem: number;
  branch: number;
  /** '오늘 일진' */
  label: string;
  /** 년생별 근거에 쓰는 짧은 이름: '오늘' */
  short: string;
}

interface PeriodContext {
  period: FreeFortunePeriod;
  target: Ymd;
  range: ReturnType<typeof range>;
  pillar: SinglePillar | null;
  week: Ymd[] | null;
  /** 이번 주의 바탕(월건) */
  background: SinglePillar | null;
}

function periodContext(period: FreeFortunePeriod, base: Ymd): PeriodContext {
  if (period === 'today' || period === 'tomorrow') {
    const target = period === 'today' ? base : addDays(base, 1);
    const p = dayPillarAt(target);
    const label = period === 'today' ? '오늘' : '내일';
    return { period, target, range: range(target, target, rangeLabel(target, target)), pillar: { stem: p.stem, branch: p.branch, label: `${label} 일진`, short: label }, week: null, background: null };
  }
  if (period === 'week') {
    const days = weekDatesOf(base);
    const m = monthPillarAt(base);
    return {
      period,
      target: base,
      range: range(days[0]!, days[6]!, rangeLabel(days[0]!, days[6]!, { withWeekday: true })),
      pillar: null,
      week: days,
      background: { stem: m.stem, branch: m.branch, label: '이번 달 월건', short: '이번 달' },
    };
  }
  if (period === 'month') {
    const m = monthPillarAt(base);
    const start = firstNoonDateOnOrAfter(m.startUtc);
    const end = addDays(firstNoonDateOnOrAfter(m.endUtc), -1);
    return { period, target: base, range: range(start, end, `${monthDay(kstDateOf(m.startUtc))} ${m.termName} ~ ${monthDay(kstDateOf(m.endUtc))} ${m.nextTermName} 전`), pillar: { stem: m.stem, branch: m.branch, label: '이번 달 월건', short: '이번 달' }, week: null, background: null };
  }
  const y = yearPillarAt(base);
  const start = firstNoonDateOnOrAfter(y.startUtc);
  const end = addDays(firstNoonDateOnOrAfter(y.endUtc), -1);
  const ys = kstDateOf(y.startUtc);
  const ye = kstDateOf(y.endUtc);
  return { period, target: base, range: range(start, end, `${ys.year}년 ${monthDay(ys)} 입춘 ~ ${ye.year}년 ${monthDay(ye)} 입춘 전`), pillar: { stem: y.stem, branch: y.branch, label: '올해 세운', short: '올해' }, week: null, background: null };
}

/** when — '오늘' · '내일' · '이번 달' · '올해' (기운이 들어오는 때) */
function luckyOf(animal: ZodiacAnimal, ev: ZodiacEvaluation, seed: string, when: string): ZodiacFortuneDto['lucky'] {
  const combo = ev.bonds.find((b) => (b.kind === '육합' || b.kind === '삼합') && b.element);
  const animalEl = BRANCHES[animal.branch]!.element;
  const el = combo?.element ?? generatedBy(animalEl);
  const info = ELEMENT_INFO[el];
  const basis = combo
    ? `${animal.name}띠가 ${when}의 기운과 ${combo.kind === '육합' ? '짝을 이뤄' : '힘을 모아'} 만드는 ${EL_FULL[el]} 기운`
    : `${animal.name}띠의 오행인 ${EL_FULL[animalEl]}${EL_OBJ[animalEl]} 생하는 ${EL_FULL[el]} 기운`;
  return { color: info.color, direction: info.direction, number: info.numbers[hashSeed(seed) % 2]!, basis };
}

function stemKeyOf(birthStem: number, periodStem: number): StemKey {
  const b = stemBond(birthStem, periodStem);
  return b.combine ? '합' : b.clash ? '충' : b.tenGod;
}

function stemRelLabel(birthStem: number, periodStem: number, key: StemKey): string {
  if (key === '합') return `${stemPairName(birthStem, periodStem)}합(${EL_NAME[stemBond(birthStem, periodStem).combine!]} 기운으로 묶임)`;
  if (key === '충') return `${stemPairName(birthStem, periodStem)}충`;
  return `${key}(${TEN_GOD_PLAIN[key]})`;
}

function yearLines(animal: ZodiacAnimal, ctx: PeriodContext, seedBase: string): ZodiacFortuneDto['years'] {
  const ref = ctx.target.year;
  const years = birthYearsOfAnimal(animal.branch, ref - 90, ref - 7).reverse();
  return years.map((y) => {
    const birthStem = mod(y - 4, 10);
    const seed = `${seedBase}|${y}`;
    const stage = lifeStageOf(ref - y);
    let stem: number;
    let lead = '';
    let where: string;
    if (ctx.pillar) {
      stem = ctx.pillar.stem;
      where = `${ctx.pillar.short} 천간 ${stemHanja(stem)}`;
    } else {
      // 이번 주: 7일 중 태어난 해 천간과 가장 잘 맞는 날
      const days = ctx.week!.map((d) => ({ d, p: dayPillarAt(d) }));
      const best = days.reduce((a, b) => (STEM_RANK[stemKeyOf(birthStem, b.p.stem)] > STEM_RANK[stemKeyOf(birthStem, a.p.stem)] ? b : a));
      stem = best.p.stem;
      lead = `이번 주에는 ${weekdayOf(best.d)}이 가장 잘 맞아요. `;
      where = `${weekdayOf(best.d)}(${ganzhi(best.p)}일) 천간 ${stemHanja(stem)}`;
    }
    const key = stemKeyOf(birthStem, stem);
    const h = hashSeed(seed);
    const text = `${lead}${YEAR_STEM_TEXT[key][h % 2]} ${STAGE_TIP[stage][STEM_TONE[key]][(h >>> 3) % 2]}`;
    return {
      year: y,
      ganzhi: ganzhi({ stem: birthStem, branch: animal.branch }),
      text,
      reason: `태어난 해 천간 ${stemHanja(birthStem)} · ${where} → ${stemRelLabel(birthStem, stem, key)}`,
    };
  });
}

function bondReasons(animal: ZodiacAnimal, pillar: SinglePillar, ev: ZodiacEvaluation): FreeFortuneReasonDto[] {
  const head = `${pillar.label} ${ganzhi(pillar)}`;
  if (ev.bonds.length === 0) return [{ title: `${head} · ${animal.hanja} 기준 합충 없음`, body: BOND_GLOSS.none }];
  return ev.bonds.map((b) => ({ title: `${head} · ${bondTitle(animal.branch, pillar.branch, b)}`, body: BOND_GLOSS[b.kind] }));
}

function flowReason(animal: ZodiacAnimal, pillar: SinglePillar, ev: ZodiacEvaluation): FreeFortuneReasonDto {
  const stemEl = STEMS[pillar.stem]!.element;
  const animalEl = BRANCHES[animal.branch]!.element;
  return { title: `${pillar.label} 천간 ${stemHanja(pillar.stem)}(${EL_NAME[stemEl]}) → 띠 글자 ${animal.hanja}(${EL_NAME[animalEl]})`, body: FLOW_GLOSS[ev.flow] };
}

export function buildZodiacFortune(animal: ZodiacAnimal, period: FreeFortunePeriod, base: Ymd): ZodiacFortuneDto {
  const ctx = periodContext(period, base);
  const seedBase = `zodiac|${animal.slug}|${period}|${ctx.range.start}`;
  const common = {
    animal: { slug: animal.slug, name: animal.name, hanja: animal.hanja, branch: animal.branch },
    period,
    periodLabel: FREE_FORTUNE_PERIOD_LABEL[period],
    date: isoOf(base),
    range: ctx.range,
    trait: ANIMAL_TRAITS[animal.branch]!,
    basisNote: ZODIAC_BASIS_NOTE,
    disclaimer: ZODIAC_DISCLAIMER,
  };

  if (ctx.pillar) {
    const pillar = ctx.pillar;
    const ev = evaluateZodiac(animal.branch, pillar);
    const scale = period === 'today' || period === 'tomorrow' ? 'day' : 'span';
    const text = pick(RELATION_TEXT[keyOf(ev)][scale], `${seedBase}|main`);
    const flowSentence = pick(FLOW_TEXT[ev.flow], `${seedBase}|flow`)({
      when: topic(pillar.short),
      animal: animal.name,
      stemEl: EL_FULL[STEMS[pillar.stem]!.element],
      animalEl: EL_FULL[BRANCHES[animal.branch]!.element],
    });
    const paragraphs = [text.body, flowSentence];
    if (ev.tone === 'mixed') paragraphs.push(pick(MIXED_NOTE, `${seedBase}|mixed`));
    if (ev.bonds.some((b) => b.kind === '자형')) paragraphs.push(SELF_PUNISH_NOTE);
    return {
      ...common,
      pillar: { label: pillar.label, hanja: ganzhi(pillar), hangul: ganzhiKo(pillar) },
      tone: ev.tone,
      toneLabel: FREE_FORTUNE_TONE_LABEL[ev.tone],
      headline: text.headline,
      paragraphs,
      tip: text.tip,
      reasons: [...bondReasons(animal, pillar, ev), flowReason(animal, pillar, ev)],
      keyDays: [],
      lucky: luckyOf(animal, ev, seedBase, pillar.short),
      years: yearLines(animal, ctx, seedBase),
    };
  }

  // 이번 주 — 7일 일진의 관계를 모은다
  const days = ctx.week!.map((d) => {
    const p = dayPillarAt(d);
    const ev = evaluateZodiac(animal.branch, p);
    return { d, p, ev, score: dayScore(ev.bonds) };
  });
  const total = days.reduce((s, x) => s + x.score, 0);
  const goods = days.filter((x) => x.score >= 2);
  const cautions = days.filter((x) => x.score <= -2);
  const tone: FreeFortuneTone = total >= 2 && cautions.length <= 1 ? 'good' : total <= -3 && goods.length <= 1 ? 'caution' : goods.length > 0 && cautions.length > 0 ? 'mixed' : 'calm';
  const text = pick(WEEK_TEXT[tone], `${seedBase}|main`);

  const keyDay = (x: (typeof days)[number], kind: 'good' | 'caution'): FreeFortuneKeyDayDto => {
    const b = strongestBond(x.ev.bonds, kind === 'good' ? 1 : -1)!;
    // 그날 붙는 띠 동물('말의 날')로 부른다 — 간지 한자·관계 용어는 쓰지 않는다
    return { date: isoOf(x.d), weekday: weekdayOf(x.d), marker: `${animalName(x.p.branch)}의 날`, kind, reason: KEYDAY_TEXT[b.kind as BranchBond] };
  };
  const keyDays = [
    ...[...goods].sort((a, b) => b.score - a.score).slice(0, 2).map((x) => keyDay(x, 'good')),
    ...[...cautions].sort((a, b) => a.score - b.score).slice(0, 2).map((x) => keyDay(x, 'caution')),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const bg = ctx.background!;
  const bgEv = evaluateZodiac(animal.branch, bg);
  const paragraphs = [text.body, `이번 주가 속한 이번 달의 기운은 ${animal.name}띠와 ${BOND_SHORT[keyOf(bgEv)]}`];
  const firstDay = days[0]!.d;
  const lastDay = days[6]!.d;
  const reasons: FreeFortuneReasonDto[] = [
    {
      title: `${monthDay(firstDay)} ~ ${monthDay(lastDay)} 일진 7일`,
      body: `${days.map((x) => `${weekdayOf(x.d).slice(0, 1)} ${ganzhi(x.p)}`).join(' · ')} — ${animal.name}띠와 잘 맞는 날 ${goods.length}일, 부딪치는 날 ${cautions.length}일이에요.`,
    },
    ...bondReasons(animal, bg, bgEv),
  ];
  return {
    ...common,
    pillar: null,
    tone,
    toneLabel: FREE_FORTUNE_TONE_LABEL[tone],
    headline: text.headline,
    paragraphs,
    tip: text.tip,
    reasons,
    keyDays,
    lucky: luckyOf(animal, bgEv, seedBase, bg.short),
    years: yearLines(animal, ctx, seedBase),
  };
}

export function buildZodiacOverview(period: FreeFortunePeriod, base: Ymd): ZodiacOverviewDto {
  const items = ZODIAC_ANIMALS.map((a) => buildZodiacFortune(a, period, base));
  return {
    date: isoOf(base),
    period,
    periodLabel: FREE_FORTUNE_PERIOD_LABEL[period],
    range: items[0]!.range,
    pillar: items[0]!.pillar,
    items: items.map((f) => ({ animal: f.animal, tone: f.tone, toneLabel: f.toneLabel, headline: f.headline, reason: period === 'week' ? keyDaySummary(f.keyDays) : plainReason(f, period, base) })),
  };
}

/** 12띠 한눈에 보기의 한 줄 이유 — 한자·관계 용어 없이 */
function plainReason(f: ZodiacFortuneDto, period: FreeFortunePeriod, base: Ymd): string {
  const ctx = periodContext(period, base);
  const ev = evaluateZodiac(f.animal.branch, ctx.pillar!);
  return BOND_REASON[keyOf(ev)](`${ctx.pillar!.short}의`, f.animal.name);
}

