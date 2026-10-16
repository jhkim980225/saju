/**
 * 별자리 운세 생성 — @saju/core 의 간이 천문 계산(astro.ts)으로 달·태양·목성·토성이 지나는 별자리를 구하고,
 * 내 태양 별자리에서 몇 번째 자리(홀사인 하우스)인지와 각에 맞는 문구를 결정적으로 고른다.
 */
import { addDays, kstNoonUtc, nextSignChange, signAspect, signOfBody, solarHouse, weekDatesOf, zonedToUtc, type AspectKind, type SkyBody } from '@saju/core';
import {
  FREE_FORTUNE_PERIOD_LABEL,
  FREE_FORTUNE_TONE_LABEL,
  STAR_ELEMENT_LABEL,
  STAR_SIGNS,
  starSignDates,
  type FreeFortuneKeyDayDto,
  type FreeFortunePeriod,
  type FreeFortuneTone,
  type HoroscopeDto,
  type HoroscopeOverviewDto,
  type StarSign,
} from '@saju/shared';
import { firstNoonDateOnOrAfter, houseLabel, isoOf, keyDaySummary, kstDateOf, kstHourLabel, monthDay, pick, range, rangeLabel, weekdayOf, type Ymd } from './common.js';
import { ASPECT_TEXT, ASPECT_TONE, HOROSCOPE_BASIS_NOTE, HOROSCOPE_DISCLAIMER, HORO_WEEK_TEXT, HOUSES, SIGN_STYLE, SIGN_TRAITS } from './content/horoscopeText.js';

const BODY_LABEL: Record<SkyBody, string> = { sun: '태양', moon: '달', jupiter: '목성', saturn: '토성' };
const DAY_MS = 86_400_000;

const signName = (i: number) => STAR_SIGNS[((i % 12) + 12) % 12]!.name;
const styleOf = (sign: StarSign, tone: FreeFortuneTone) => SIGN_STYLE[sign.index]![tone === 'good' ? 'good' : tone === 'caution' ? 'caution' : 'calm'];

const kstMidnightUtc = (d: Ymd) => zonedToUtc({ ...d, hour: 0, minute: 0 }, 'Asia/Seoul');

function skyItem(sign: StarSign, body: SkyBody, bodySign: number, note: string): HoroscopeDto['sky'][number] {
  const house = solarHouse(sign.index, bodySign);
  const aspect = signAspect(sign.index, bodySign);
  return {
    body,
    bodyLabel: BODY_LABEL[body],
    signName: signName(bodySign),
    house,
    houseLabel: houseLabel(house),
    houseTheme: HOUSES[house - 1]!.theme,
    aspect: ASPECT_TEXT[aspect].label,
    note: note ? `${ASPECT_TEXT[aspect].gloss} ${note}` : ASPECT_TEXT[aspect].gloss,
  };
}

function signMeta(sign: StarSign): HoroscopeDto['sign'] {
  return { slug: sign.slug, name: sign.name, en: sign.en, glyph: sign.glyph, element: sign.element, elementLabel: STAR_ELEMENT_LABEL[sign.element], dates: starSignDates(sign) };
}

/** 태양이 지금 별자리에 들어온 시각과 떠나는 시각 */
function sunSpan(atUtc: number): { start: number; end: number; next: number } {
  let t = atUtc - 33 * DAY_MS;
  let start = t;
  let c = nextSignChange('sun', t);
  while (c && c.utcMs <= atUtc) {
    start = c.utcMs;
    t = c.utcMs + 60_000;
    c = nextSignChange('sun', t);
  }
  return { start, end: c!.utcMs, next: c!.to };
}

const ASPECT_RANK_GOOD: Partial<Record<AspectKind, number>> = { trine: 3, conjunction: 2.5, sextile: 2 };
const ASPECT_RANK_CAUTION: Partial<Record<AspectKind, number>> = { square: 2, opposition: 1 };

export function buildHoroscope(sign: StarSign, period: FreeFortunePeriod, base: Ymd): HoroscopeDto {
  const common = {
    sign: signMeta(sign),
    period,
    periodLabel: FREE_FORTUNE_PERIOD_LABEL[period],
    date: isoOf(base),
    trait: SIGN_TRAITS[sign.index]!,
    basisNote: HOROSCOPE_BASIS_NOTE,
    disclaimer: HOROSCOPE_DISCLAIMER,
  };

  if (period === 'today' || period === 'tomorrow') {
    const target = period === 'today' ? base : addDays(base, 1);
    const seed = `horoscope|${sign.slug}|${period}|${isoOf(target)}`;
    const noon = kstNoonUtc(target);
    const moonSign = signOfBody('moon', noon);
    const house = solarHouse(sign.index, moonSign);
    const aspect = signAspect(sign.index, moonSign);
    const tone = ASPECT_TONE[aspect];
    const text = pick(HOUSES[house - 1]!.moon, `${seed}|main`);
    const paragraphs = [text.body, styleOf(sign, tone)];

    // 그날(KST 0~24시) 안에 달이 별자리를 옮기면 알려 준다
    const dayStart = kstMidnightUtc(target);
    const change = nextSignChange('moon', dayStart, { stepMs: 3_600_000, maxMs: DAY_MS });
    let moonNote = '';
    if (change && change.utcMs < dayStart + DAY_MS) {
      const before = change.utcMs < noon;
      const otherSign = before ? change.from : change.to;
      const otherHouse = solarHouse(sign.index, otherSign);
      moonNote = before
        ? `달은 ${kstHourLabel(change.utcMs)} 무렵 ${signName(otherSign)}에서 옮겨 왔어요.`
        : `달은 ${kstHourLabel(change.utcMs)} 무렵 ${signName(change.to)}로 옮겨 가요.`;
      if (!before) paragraphs.push(`${moonNote} 그 뒤로는 ${houseLabel(otherHouse)}(${HOUSES[otherHouse - 1]!.theme}) 쪽으로 마음이 옮겨 가기 쉬워요.`);
    }
    const sunSign = signOfBody('sun', noon);
    return {
      ...common,
      range: range(target, target, rangeLabel(target, target)),
      tone,
      toneLabel: FREE_FORTUNE_TONE_LABEL[tone],
      headline: text.headline,
      paragraphs,
      tip: text.tip,
      sky: [skyItem(sign, 'moon', moonSign, `정오 기준이에요. ${moonNote}`.trim()), skyItem(sign, 'sun', sunSign, '이번 달의 바탕이 되는 자리예요.')],
      keyDays: [],
    };
  }

  if (period === 'week') {
    const days = weekDatesOf(base).map((d) => {
      const moonSign = signOfBody('moon', kstNoonUtc(d));
      const aspect = signAspect(sign.index, moonSign);
      return { d, moonSign, house: solarHouse(sign.index, moonSign), aspect, tone: ASPECT_TONE[aspect] };
    });
    const seed = `horoscope|${sign.slug}|week|${isoOf(days[0]!.d)}`;
    const goods = days.filter((x) => ASPECT_RANK_GOOD[x.aspect]);
    const cautions = days.filter((x) => ASPECT_RANK_CAUTION[x.aspect]);
    const tone: FreeFortuneTone =
      goods.length >= 4 && cautions.length <= 1 ? 'good' : cautions.length >= 3 && goods.length <= 2 ? 'caution' : goods.length > 0 && cautions.length > 0 ? 'mixed' : goods.length >= 2 ? 'good' : 'calm';
    const text = pick(HORO_WEEK_TEXT[tone], `${seed}|main`);

    /** 같은 별자리에 달이 머무는 날은 첫날만, 순위가 높은 두 자리까지 */
    const pickDays = (list: typeof days, rank: Partial<Record<AspectKind, number>>, kind: 'good' | 'caution'): FreeFortuneKeyDayDto[] => {
      const seen = new Set<number>();
      return [...list]
        .sort((a, b) => (rank[b.aspect] ?? 0) - (rank[a.aspect] ?? 0) || a.d.day - b.d.day)
        .filter((x) => (seen.has(x.moonSign) ? false : (seen.add(x.moonSign), true)))
        .slice(0, 2)
        .map((x) => ({
          date: isoOf(x.d),
          weekday: weekdayOf(x.d),
          marker: signName(x.moonSign),
          kind,
          reason: `${HOUSES[x.house - 1]!.short}이에요. 달이 ${signName(x.moonSign)}에 있어, 내 별자리와 ${ASPECT_TEXT[x.aspect].label}예요.`,
        }));
    };
    const keyDays = [...pickDays(goods, ASPECT_RANK_GOOD, 'good'), ...pickDays(cautions, ASPECT_RANK_CAUTION, 'caution')].sort((a, b) => a.date.localeCompare(b.date));

    const sunSign = signOfBody('sun', kstNoonUtc(base));
    const sunHouse = solarHouse(sign.index, sunSign);
    const paragraphs = [
      text.body,
      `이번 주에는 태양이 ${signName(sunSign)}에 있어요. 내 별자리에서 ${houseLabel(sunHouse)}(${HOUSES[sunHouse - 1]!.theme})라서 이쪽 일에 관심이 가기 쉬워요.`,
      styleOf(sign, tone),
    ];
    // 달이 지나는 별자리마다 근거 한 줄
    const runs: { sign: number; from: Ymd; to: Ymd }[] = [];
    for (const x of days) {
      const last = runs[runs.length - 1];
      if (last && last.sign === x.moonSign) last.to = x.d;
      else runs.push({ sign: x.moonSign, from: x.d, to: x.d });
    }
    const first = days[0]!.d;
    const lastDay = days[6]!.d;
    return {
      ...common,
      range: range(first, lastDay, rangeLabel(first, lastDay, { withWeekday: true })),
      tone,
      toneLabel: FREE_FORTUNE_TONE_LABEL[tone],
      headline: text.headline,
      paragraphs,
      tip: text.tip,
      sky: [
        ...runs.map((r) => skyItem(sign, 'moon', r.sign, isoOf(r.from) === isoOf(r.to) ? `${monthDay(r.from)} 정오 기준이에요.` : `${monthDay(r.from)} ~ ${monthDay(r.to)} 정오 기준이에요.`)),
        skyItem(sign, 'sun', sunSign, '한 주의 바탕이 되는 자리예요.'),
      ],
      keyDays,
    };
  }

  if (period === 'month') {
    const noon = kstNoonUtc(base);
    const span = sunSpan(noon);
    const sunSign = signOfBody('sun', noon);
    const house = solarHouse(sign.index, sunSign);
    const aspect = signAspect(sign.index, sunSign);
    const tone = ASPECT_TONE[aspect];
    const text = HOUSES[house - 1]!.sun;
    const inDay = kstDateOf(span.start);
    const outDay = kstDateOf(span.end);
    const nextHouse = solarHouse(sign.index, span.next);
    const paragraphs = [
      text.body,
      `${monthDay(outDay)} ${kstHourLabel(span.end)} 무렵부터는 태양이 ${signName(span.next)}로 옮겨, ${houseLabel(nextHouse)}(${HOUSES[nextHouse - 1]!.theme}) 쪽으로 관심이 옮겨 가요.`,
      styleOf(sign, tone),
    ];
    // ISO 범위는 정오 기준(그날 정오에 태양이 이 별자리에 있는 날들)
    const start = firstNoonDateOnOrAfter(span.start);
    const end = addDays(firstNoonDateOnOrAfter(span.end), -1);
    return {
      ...common,
      range: range(start, end, `${monthDay(inDay)} ~ ${monthDay(outDay)} (태양 ${signName(sunSign)} 기간)`),
      tone,
      toneLabel: FREE_FORTUNE_TONE_LABEL[tone],
      headline: text.headline,
      paragraphs,
      tip: text.tip,
      sky: [skyItem(sign, 'sun', sunSign, `${monthDay(inDay)}에 들어와 ${monthDay(outDay)}에 ${signName(span.next)}로 옮겨요.`)],
      keyDays: [],
    };
  }

  // 올해 — 목성(넓어지는 것)과 토성(다지는 것)
  const noon = kstNoonUtc(base);
  const jSign = signOfBody('jupiter', noon);
  const sSign = signOfBody('saturn', noon);
  const jHouse = solarHouse(sign.index, jSign);
  const sHouse = solarHouse(sign.index, sSign);
  const aspect = signAspect(sign.index, jSign);
  const tone = ASPECT_TONE[aspect];
  const jText = HOUSES[jHouse - 1]!;
  const paragraphs = [jText.jupiter, HOUSES[sHouse - 1]!.saturn];
  const yearEnd = Date.UTC(base.year + 1, 0, 1) - 9 * 3_600_000;
  const jNext = nextSignChange('jupiter', noon, { maxMs: 400 * DAY_MS });
  let jNote = '';
  if (jNext) {
    const at = kstDateOf(jNext.utcMs);
    jNote = `${at.year}년 ${at.month}월 무렵 ${signName(jNext.to)}로 옮겨요.`;
    if (jNext.utcMs < yearEnd) {
      const h = solarHouse(sign.index, jNext.to);
      paragraphs.push(`${at.month}월 무렵 목성이 ${signName(jNext.to)}로 옮기면 기회가 많은 쪽이 ${houseLabel(h)}(${HOUSES[h - 1]!.theme})로 바뀌어요.`);
    }
  }
  paragraphs.push(styleOf(sign, tone));
  const start = { year: base.year, month: 1, day: 1 };
  const end = { year: base.year, month: 12, day: 31 };
  return {
    ...common,
    range: range(start, end, `${base.year}년 (${monthDay(base)} 기준 하늘)`),
    tone,
    toneLabel: FREE_FORTUNE_TONE_LABEL[tone],
    headline: `${jText.focus} 쪽에서 기회가 늘어나는 해예요`,
    paragraphs,
    tip: jText.yearTip,
    sky: [skyItem(sign, 'jupiter', jSign, jNote), skyItem(sign, 'saturn', sSign, '')],
    keyDays: [],
  };
}

export function buildHoroscopeOverview(period: FreeFortunePeriod, base: Ymd): HoroscopeOverviewDto {
  const items = STAR_SIGNS.map((s) => buildHoroscope(s, period, base));
  return {
    date: isoOf(base),
    period,
    periodLabel: FREE_FORTUNE_PERIOD_LABEL[period],
    range: items[0]!.range,
    // 한 줄 이유 — '몇 번째 자리' 대신 그 자리의 주제로: '달이 사수자리를 지나요 — 나에게는 먼 곳 · 공부 쪽이에요'
    items: items.map((h) => ({ sign: h.sign, tone: h.tone, toneLabel: h.toneLabel, headline: h.headline, reason: period === 'week' ? keyDaySummary(h.keyDays) : `${h.sky[0]!.bodyLabel}이 ${h.sky[0]!.signName}를 지나요 — 나에게는 '${h.sky[0]!.houseTheme}' 자리예요` })),
  };
}
