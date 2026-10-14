/**
 * 띠별 운세 · 별자리 운세 (무료 SEO 콘텐츠) — 공용 상수, 생일 → 별자리 도우미, 응답 DTO.
 * 계산은 서버(apps/api/src/modules/zodiac)에서 하고, 웹은 이 상수로 URL·선택 UI 를 만든다.
 */

/** 기간 — URL 의 마지막 조각(`/zodiac/tiger/today`)과 같다 */
export const FREE_FORTUNE_PERIODS = ['today', 'tomorrow', 'week', 'month', 'year'] as const;
export type FreeFortunePeriod = (typeof FREE_FORTUNE_PERIODS)[number];
export const FREE_FORTUNE_PERIOD_LABEL: Record<FreeFortunePeriod, string> = {
  today: '오늘',
  tomorrow: '내일',
  week: '이번 주',
  month: '이번 달',
  year: '올해',
};

export type FreeFortuneTone = 'good' | 'calm' | 'mixed' | 'caution';
export const FREE_FORTUNE_TONE_LABEL: Record<FreeFortuneTone, string> = {
  good: '흐름이 좋아요',
  calm: '무난한 흐름',
  mixed: '좋고 궂음이 섞여요',
  caution: '살펴 가면 좋아요',
};

// ---------------------------------------------------------------------------
// 띠
// ---------------------------------------------------------------------------

/** 12띠 — branch 는 지지 인덱스(子 = 0) */
export const ZODIAC_ANIMALS = [
  { slug: 'rat', branch: 0, name: '쥐', hanja: '子', hangul: '자' },
  { slug: 'ox', branch: 1, name: '소', hanja: '丑', hangul: '축' },
  { slug: 'tiger', branch: 2, name: '호랑이', hanja: '寅', hangul: '인' },
  { slug: 'rabbit', branch: 3, name: '토끼', hanja: '卯', hangul: '묘' },
  { slug: 'dragon', branch: 4, name: '용', hanja: '辰', hangul: '진' },
  { slug: 'snake', branch: 5, name: '뱀', hanja: '巳', hangul: '사' },
  { slug: 'horse', branch: 6, name: '말', hanja: '午', hangul: '오' },
  { slug: 'sheep', branch: 7, name: '양', hanja: '未', hangul: '미' },
  { slug: 'monkey', branch: 8, name: '원숭이', hanja: '申', hangul: '신' },
  { slug: 'rooster', branch: 9, name: '닭', hanja: '酉', hangul: '유' },
  { slug: 'dog', branch: 10, name: '개', hanja: '戌', hangul: '술' },
  { slug: 'pig', branch: 11, name: '돼지', hanja: '亥', hangul: '해' },
] as const;
export type ZodiacAnimal = (typeof ZODIAC_ANIMALS)[number];
export type ZodiacAnimalSlug = ZodiacAnimal['slug'];
export const ZODIAC_ANIMAL_SLUGS = ZODIAC_ANIMALS.map((a) => a.slug) as [ZodiacAnimalSlug, ...ZodiacAnimalSlug[]];

export function zodiacAnimalBySlug(slug: string | undefined): ZodiacAnimal | null {
  return ZODIAC_ANIMALS.find((a) => a.slug === slug) ?? null;
}

/** 띠 이름('호랑이') 또는 지지 한자('寅') → 띠. 프로필의 zodiac(입춘 기준 년지 동물)을 띠 페이지로 잇는 데 쓴다 */
export function zodiacAnimalByName(name: string | null | undefined): ZodiacAnimal | null {
  if (!name) return null;
  const n = name.replace(/띠$/, '');
  return ZODIAC_ANIMALS.find((a) => a.name === n || a.hanja === n) ?? null;
}

// ---------------------------------------------------------------------------
// 별자리 (태양 별자리)
// ---------------------------------------------------------------------------

export type StarElement = 'fire' | 'earth' | 'air' | 'water';
export const STAR_ELEMENT_LABEL: Record<StarElement, string> = { fire: '불', earth: '흙', air: '공기', water: '물' };

/**
 * 12별자리 — index 는 황도 순서(양자리 = 0, 황경 0~30°). from/to 는 흔히 쓰는 날짜표(양력 월·일)이고,
 * 실제 태양이 별자리를 옮기는 날은 해마다 하루쯤 앞뒤로 움직인다. glyph 는 화면에 쓰는 한자 표지(황도 12궁 이름에서 한 글자).
 */
export const STAR_SIGNS = [
  { slug: 'aries', index: 0, name: '양자리', en: 'Aries', glyph: '羊', element: 'fire', from: [3, 21], to: [4, 19] },
  { slug: 'taurus', index: 1, name: '황소자리', en: 'Taurus', glyph: '牛', element: 'earth', from: [4, 20], to: [5, 20] },
  { slug: 'gemini', index: 2, name: '쌍둥이자리', en: 'Gemini', glyph: '雙', element: 'air', from: [5, 21], to: [6, 21] },
  { slug: 'cancer', index: 3, name: '게자리', en: 'Cancer', glyph: '蟹', element: 'water', from: [6, 22], to: [7, 22] },
  { slug: 'leo', index: 4, name: '사자자리', en: 'Leo', glyph: '獅', element: 'fire', from: [7, 23], to: [8, 22] },
  { slug: 'virgo', index: 5, name: '처녀자리', en: 'Virgo', glyph: '女', element: 'earth', from: [8, 23], to: [9, 22] },
  { slug: 'libra', index: 6, name: '천칭자리', en: 'Libra', glyph: '秤', element: 'air', from: [9, 23], to: [10, 22] },
  { slug: 'scorpio', index: 7, name: '전갈자리', en: 'Scorpio', glyph: '蝎', element: 'water', from: [10, 23], to: [11, 22] },
  { slug: 'sagittarius', index: 8, name: '사수자리', en: 'Sagittarius', glyph: '弓', element: 'fire', from: [11, 23], to: [12, 21] },
  { slug: 'capricorn', index: 9, name: '염소자리', en: 'Capricorn', glyph: '羯', element: 'earth', from: [12, 22], to: [1, 19] },
  { slug: 'aquarius', index: 10, name: '물병자리', en: 'Aquarius', glyph: '甁', element: 'air', from: [1, 20], to: [2, 18] },
  { slug: 'pisces', index: 11, name: '물고기자리', en: 'Pisces', glyph: '魚', element: 'water', from: [2, 19], to: [3, 20] },
] as const satisfies readonly { slug: string; index: number; name: string; en: string; glyph: string; element: StarElement; from: readonly [number, number]; to: readonly [number, number] }[];
export type StarSign = (typeof STAR_SIGNS)[number];
export type StarSignSlug = StarSign['slug'];
export const STAR_SIGN_SLUGS = STAR_SIGNS.map((s) => s.slug) as [StarSignSlug, ...StarSignSlug[]];

export function starSignBySlug(slug: string | undefined): StarSign | null {
  return STAR_SIGNS.find((s) => s.slug === slug) ?? null;
}

/** '3월 21일 ~ 4월 19일' */
export function starSignDates(sign: StarSign): string {
  return `${sign.from[0]}월 ${sign.from[1]}일 ~ ${sign.to[0]}월 ${sign.to[1]}일`;
}

/**
 * 양력 생일(월·일) → 태양 별자리 (날짜표 기준).
 * 경계일 앞뒤 하루는 태어난 해·시각에 따라 옆 별자리일 수 있다 → isCusp 로 알려 준다.
 * 잘못된 날짜면 null.
 */
export function starSignOfBirthday(month: number, day: number): { sign: StarSign; isCusp: boolean } | null {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return null;
  const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  if (day > maxDay) return null;
  const md = month * 100 + day;
  const sign =
    STAR_SIGNS.find((s) => {
      const from = s.from[0] * 100 + s.from[1];
      const to = s.to[0] * 100 + s.to[1];
      return from <= to ? md >= from && md <= to : md >= from || md <= to;
    }) ?? STAR_SIGNS[0];
  const isCusp = STAR_SIGNS.some((s) => {
    const from = s.from[0] * 100 + s.from[1];
    const to = s.to[0] * 100 + s.to[1];
    return md === from || md === to;
  });
  return { sign, isCusp };
}

// ---------------------------------------------------------------------------
// 응답 DTO
// ---------------------------------------------------------------------------

/** 기간 범위 — start/end 는 KST 날짜(YYYY-MM-DD, end 포함), label 은 화면 표시용 */
export interface FreeFortuneRangeDto {
  start: string;
  end: string;
  label: string;
}

/** 풀이 근거 한 줄 — title 은 짧은 근거(예: '오늘 일진 甲申 · 寅申충'), body 는 쉬운 말 설명 */
export interface FreeFortuneReasonDto {
  title: string;
  body: string;
}

/** 이번 주에서 눈여겨볼 날 */
export interface FreeFortuneKeyDayDto {
  date: string;
  /** '수요일' */
  weekday: string;
  /** 그날의 표지 — 띠: 일진 간지('甲申'), 별자리: 달 별자리('사자자리') */
  marker: string;
  kind: 'good' | 'caution';
  reason: string;
}

export interface ZodiacFortuneDto {
  animal: { slug: ZodiacAnimalSlug; name: string; hanja: string; branch: number };
  period: FreeFortunePeriod;
  periodLabel: string;
  /** 기준 날짜(KST) */
  date: string;
  range: FreeFortuneRangeDto;
  /** 이 기간의 운 기둥 — 이번 주는 7일 일진을 함께 보므로 null */
  pillar: { label: string; hanja: string; hangul: string } | null;
  tone: FreeFortuneTone;
  toneLabel: string;
  /** 띠 성향 한 줄 */
  trait: string;
  headline: string;
  paragraphs: string[];
  tip: string;
  reasons: FreeFortuneReasonDto[];
  keyDays: FreeFortuneKeyDayDto[];
  lucky: { color: string; direction: string; number: number; basis: string };
  /** 년생별 한 줄 — 태어난 해 천간과 이 기간 천간의 관계 */
  years: { year: number; ganzhi: string; text: string; reason: string }[];
  /** 띠 기준(입춘) 안내 */
  basisNote: string;
  disclaimer: string;
}

export interface ZodiacOverviewDto {
  date: string;
  period: FreeFortunePeriod;
  periodLabel: string;
  range: FreeFortuneRangeDto;
  /** 모든 띠에 공통인 운 기둥 (이번 주는 null) */
  pillar: ZodiacFortuneDto['pillar'];
  items: { animal: ZodiacFortuneDto['animal']; tone: FreeFortuneTone; toneLabel: string; headline: string; reason: string }[];
}

export type SkyBodyKey = 'sun' | 'moon' | 'jupiter' | 'saturn';

export interface HoroscopeDto {
  sign: { slug: StarSignSlug; name: string; en: string; glyph: string; element: StarElement; elementLabel: string; dates: string };
  period: FreeFortunePeriod;
  periodLabel: string;
  date: string;
  range: FreeFortuneRangeDto;
  tone: FreeFortuneTone;
  toneLabel: string;
  trait: string;
  headline: string;
  paragraphs: string[];
  tip: string;
  /** 하늘의 근거 — 천체가 지나는 별자리와, 내 별자리에서 몇 번째 자리인지 */
  sky: { body: SkyBodyKey; bodyLabel: string; signName: string; house: number; houseLabel: string; houseTheme: string; aspect: string; note: string }[];
  keyDays: FreeFortuneKeyDayDto[];
  /** 계산 방법 안내 */
  basisNote: string;
  disclaimer: string;
}

export interface HoroscopeOverviewDto {
  date: string;
  period: FreeFortunePeriod;
  periodLabel: string;
  range: FreeFortuneRangeDto;
  items: { sign: HoroscopeDto['sign']; tone: FreeFortuneTone; toneLabel: string; headline: string; reason: string }[];
}
