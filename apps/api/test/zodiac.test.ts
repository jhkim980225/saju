import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { signOfBody } from '@saju/core';
import { FREE_FORTUNE_PERIODS, STAR_SIGNS, ZODIAC_ANIMALS, starSignOfBirthday, zodiacAnimalByName } from '@saju/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { buildHoroscope } from '../src/modules/zodiac/horoscope.js';
import { buildZodiacFortune } from '../src/modules/zodiac/zodiacFortune.js';

let app: FastifyInstance;
const DATE = '2026-10-15';
const BASE = { year: 2026, month: 10, day: 15 };

beforeAll(async () => {
  const config = loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: '' });
  const { db } = createDb(':memory:');
  runMigrations(db);
  app = await buildApp({ config, db, logger: false });
});
afterAll(async () => {
  await app.close();
});

const get = async (url: string) => {
  const res = await app.inject({ method: 'GET', url: `/api/v1${url}` });
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body) as any };
};

/** 카피 가이드 금지 표현 — 공포 조장·단정·과장 */
const BANNED = /반드시|최악|대박|망한|망하|살이 꼈|큰일|!!|\{\{|undefined|NaN/;
const allText = (v: unknown): string => JSON.stringify(v);

describe('띠별 운세 API', () => {
  it('호랑이띠 오늘(2026-10-15 壬戌일) — 寅戌 삼합과 壬水 생조가 근거로 보인다', async () => {
    const r = await get(`/zodiac/tiger?period=today&date=${DATE}`);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toContain('max-age');
    const d = r.body;
    expect(d.animal).toMatchObject({ slug: 'tiger', name: '호랑이', hanja: '寅' });
    expect(d.pillar).toEqual({ label: '오늘 일진', hanja: '壬戌', hangul: '임술' });
    expect(d.tone).toBe('good');
    expect(d.reasons[0].title).toBe('오늘 일진 壬戌 · 寅戌 삼합(불의 무리)');
    expect(d.reasons.at(-1).title).toContain('壬(물) → 띠 글자 寅(나무)');
    expect(d.range).toMatchObject({ start: DATE, end: DATE });
    expect(d.basisNote).toContain('입춘');
    // 년생별: 2010 庚寅 … 1938 戊寅 (7개, 어린 순)
    expect(d.years.map((y: { year: number }) => y.year)).toEqual([2010, 1998, 1986, 1974, 1962, 1950, 1938]);
    expect(d.years[0].ganzhi).toBe('庚寅');
    expect(d.years.find((y: { year: number }) => y.year === 1986).reason).toContain('丙壬충');
    expect(d.years.find((y: { year: number }) => y.year === 1962).reason).toContain('비견');
  });

  it('용띠 오늘 — 辰戌충은 살펴 가기', async () => {
    const d = (await get(`/zodiac/dragon?period=today&date=${DATE}`)).body;
    expect(d.tone).toBe('caution');
    expect(d.reasons[0].title).toContain('辰戌 충');
  });

  it('내일은 다음 날 일진(癸亥) — 寅亥 육합과 파가 함께 → 섞임', async () => {
    const d = (await get(`/zodiac/tiger?period=tomorrow&date=${DATE}`)).body;
    expect(d.pillar.hanja).toBe('癸亥');
    expect(d.range.start).toBe('2026-10-16');
    expect(d.reasons.map((x: { title: string }) => x.title).join('|')).toMatch(/寅亥 육합\(나무\).*寅亥 파/);
    expect(d.tone).toBe('mixed');
  });

  it('이번 주 — 월~일 7일 일진, 좋은 날·살필 날에 관계 이유', async () => {
    const d = (await get(`/zodiac/tiger?period=week&date=${DATE}`)).body;
    expect(d.pillar).toBeNull();
    expect(d.range).toMatchObject({ start: '2026-10-12', end: '2026-10-18' });
    expect(d.keyDays).toEqual(
      expect.arrayContaining([
        // 날짜 표시는 그날 붙는 띠 동물로(庚申 → 원숭이, 癸亥 → 돼지) — 간지 한자를 쓰지 않는다
        expect.objectContaining({ date: '2026-10-13', marker: '원숭이의 날', kind: 'caution' }),
        expect.objectContaining({ date: '2026-10-16', marker: '돼지의 날', kind: 'good' }),
      ]),
    );
    for (const k of d.keyDays) expect(k.date >= d.range.start && k.date <= d.range.end).toBe(true);
    expect(d.years[0].text).toMatch(/^이번 주에는 .요일이 가장 잘 맞아요\./);
    expect(d.years[0].reason).toMatch(/요일\(..일\) 천간/);
  });

  it('이번 달은 절기 달(戊戌월), 올해는 입춘 기준 세운(丙午)', async () => {
    const m = (await get(`/zodiac/tiger?period=month&date=${DATE}`)).body;
    expect(m.pillar.hanja).toBe('戊戌');
    expect(m.range.label).toBe('10월 8일 한로 ~ 11월 7일 입동 전');
    const y = (await get(`/zodiac/tiger?period=year&date=${DATE}`)).body;
    expect(y.pillar.hanja).toBe('丙午');
    expect(y.range.label).toMatch(/^2026년 2월 4일 입춘 ~ 2027년 2월 4일 입춘 전$/);
  });

  it('12띠 요약', async () => {
    const d = (await get(`/zodiac?date=${DATE}`)).body;
    expect(d.period).toBe('today');
    expect(d.items).toHaveLength(12);
    expect(d.items.map((i: { animal: { slug: string } }) => i.animal.slug)).toEqual(ZODIAC_ANIMALS.map((a) => a.slug));
    const w = (await get(`/zodiac?period=week&date=${DATE}`)).body;
    expect(w.items[2].reason).toMatch(/좋은 날 .+ · 살필 날 .+/);
  });

  it('없는 띠는 404, 잘못된 기간·날짜는 400', async () => {
    expect((await get('/zodiac/cat')).status).toBe(404);
    expect((await get('/zodiac/tiger?period=decade')).status).toBe(400);
    expect((await get('/zodiac/tiger?date=2026-02-30')).status).toBe(400);
    expect((await get('/horoscope/ophiuchus')).status).toBe(404);
  });
});

describe('별자리 운세 API', () => {
  it('양자리 오늘 — 달 사수자리(아홉 번째 자리, 120°) → 좋음', async () => {
    const d = (await get(`/horoscope/aries?period=today&date=${DATE}`)).body;
    expect(d.sign).toMatchObject({ slug: 'aries', name: '양자리', element: 'fire', dates: '3월 21일 ~ 4월 19일' });
    expect(d.sky[0]).toMatchObject({ body: 'moon', signName: '사수자리', house: 9, houseLabel: '아홉 번째 자리', aspect: '잘 어울리는 자리' });
    expect(d.tone).toBe('good');
    expect(d.basisNote).toContain('간이 천문 계산');
  });

  it('처녀자리 오늘 — 달 사수자리는 90° → 살펴 가기', async () => {
    const d = (await get(`/horoscope/virgo?period=today&date=${DATE}`)).body;
    expect(d.sky[0]).toMatchObject({ house: 4, aspect: '엇갈리는 자리' });
    expect(d.tone).toBe('caution');
  });

  it('이번 달은 태양 천칭자리 기간, 올해는 목성 사자자리·토성 양자리', async () => {
    const m = (await get(`/horoscope/aries?period=month&date=${DATE}`)).body;
    expect(m.sky[0]).toMatchObject({ body: 'sun', signName: '천칭자리', house: 7 });
    expect(m.range).toMatchObject({ start: '2026-09-23', end: '2026-10-23' });
    expect(m.paragraphs.join(' ')).toContain('10월 23일 오후 7시 무렵부터는 태양이 전갈자리로');
    const y = (await get(`/horoscope/aries?period=year&date=${DATE}`)).body;
    expect(y.sky.map((s: { body: string; signName: string; house: number }) => [s.body, s.signName, s.house])).toEqual([
      ['jupiter', '사자자리', 5],
      ['saturn', '양자리', 1],
    ]);
    expect(y.sky[0].note).toContain('2027년 7월 무렵 처녀자리로');
  });

  it('이번 주 — 달이 지나는 별자리마다 근거, 좋은 날·살필 날', async () => {
    const d = (await get(`/horoscope/aries?period=week&date=${DATE}`)).body;
    expect(d.sky.filter((s: { body: string }) => s.body === 'moon').map((s: { signName: string }) => s.signName)).toEqual(['전갈자리', '사수자리', '염소자리']);
    expect(d.keyDays).toEqual([
      expect.objectContaining({ date: '2026-10-14', kind: 'good', marker: '사수자리' }),
      expect.objectContaining({ date: '2026-10-17', kind: 'caution', marker: '염소자리' }),
    ]);
  });

  it('12별자리 요약', async () => {
    const d = (await get(`/horoscope?date=${DATE}`)).body;
    expect(d.items).toHaveLength(12);
    expect(d.items[0].reason).toBe("달이 사수자리를 지나요 — 나에게는 '먼 곳 · 공부 · 새로운 관점' 자리예요");
  });
});

describe('결정성과 문구 품질', () => {
  it('같은 입력은 같은 결과, 날짜가 바뀌면 일진이 바뀐다', () => {
    const a = buildZodiacFortune(ZODIAC_ANIMALS[6], 'today', BASE);
    const b = buildZodiacFortune(ZODIAC_ANIMALS[6], 'today', BASE);
    expect(a).toEqual(b);
    expect(buildZodiacFortune(ZODIAC_ANIMALS[6], 'today', { ...BASE, day: 16 }).pillar!.hanja).not.toBe(a.pillar!.hanja);
    expect(buildHoroscope(STAR_SIGNS[4], 'week', BASE)).toEqual(buildHoroscope(STAR_SIGNS[4], 'week', BASE));
  });

  it('이번 달·올해 문구는 그 기간 안에서 날짜가 달라도 같다', () => {
    const a = buildZodiacFortune(ZODIAC_ANIMALS[0], 'month', BASE);
    const b = buildZodiacFortune(ZODIAC_ANIMALS[0], 'month', { ...BASE, day: 20 });
    expect(b.headline).toBe(a.headline);
    expect(b.paragraphs).toEqual(a.paragraphs);
  });

  it('12띠 × 5기간, 12별자리 × 5기간 — 빈 문장·금지 표현 없음 (2026년 매주 표본)', () => {
    for (let i = 0; i < 52; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i * 7));
      const base = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
      for (const period of FREE_FORTUNE_PERIODS) {
        for (const a of ZODIAC_ANIMALS) {
          const f = buildZodiacFortune(a, period, base);
          expect(f.headline.length).toBeGreaterThan(5);
          expect(f.paragraphs.length).toBeGreaterThanOrEqual(2);
          expect(f.tip.length).toBeGreaterThan(5);
          expect(f.reasons.length).toBeGreaterThan(0);
          expect(f.years.length).toBeGreaterThanOrEqual(7);
          expect(allText(f)).not.toMatch(BANNED);
        }
        for (const s of STAR_SIGNS) {
          const h = buildHoroscope(s, period, base);
          expect(h.headline.length).toBeGreaterThan(5);
          expect(h.sky.length).toBeGreaterThan(0);
          expect(allText(h)).not.toMatch(BANNED);
        }
      }
    }
  }, 30_000); // 1년치 매주 표본 — 전체 테스트를 함께 돌리면 5초를 넘길 때가 있다
});

describe('생일 → 별자리 도우미 (@saju/shared)', () => {
  it.each([
    [3, 20, 'pisces'], [3, 21, 'aries'], [4, 19, 'aries'], [4, 20, 'taurus'],
    [6, 21, 'gemini'], [6, 22, 'cancer'], [10, 22, 'libra'], [10, 23, 'scorpio'],
    [12, 21, 'sagittarius'], [12, 22, 'capricorn'], [12, 31, 'capricorn'], [1, 1, 'capricorn'],
    [1, 19, 'capricorn'], [1, 20, 'aquarius'], [2, 18, 'aquarius'], [2, 19, 'pisces'], [2, 29, 'pisces'],
  ])('%i월 %i일 → %s', (m, d, slug) => {
    expect(starSignOfBirthday(m, d)?.sign.slug).toBe(slug);
  });
  it('경계일은 isCusp, 없는 날짜는 null', () => {
    expect(starSignOfBirthday(3, 21)?.isCusp).toBe(true);
    expect(starSignOfBirthday(4, 5)?.isCusp).toBe(false);
    expect(starSignOfBirthday(2, 30)).toBeNull();
    expect(starSignOfBirthday(13, 1)).toBeNull();
    expect(starSignOfBirthday(4, 0)).toBeNull();
  });
  it('날짜표는 실제 태양 위치(정오 KST)와 경계일 하루 앞뒤를 빼고 모두 일치 — 1950~2049', () => {
    const boundaries = new Set<string>();
    for (const s of STAR_SIGNS) {
      for (const [m, d] of [s.from, s.to]) {
        const t = Date.UTC(2001, m - 1, d);
        for (const k of [-1, 0, 1]) {
          const x = new Date(t + k * 86_400_000);
          boundaries.add(`${x.getUTCMonth() + 1}-${x.getUTCDate()}`);
        }
      }
    }
    let checked = 0;
    for (let y = 1950; y <= 2049; y++) {
      for (let t = Date.UTC(y, 0, 1); t < Date.UTC(y + 1, 0, 1); t += 86_400_000) {
        const day = new Date(t);
        const m = day.getUTCMonth() + 1;
        const d = day.getUTCDate();
        if (boundaries.has(`${m}-${d}`)) continue;
        const table = starSignOfBirthday(m, d)!.sign.index;
        expect(signOfBody('sun', t + 3 * 3_600_000), `${y}-${m}-${d}`).toBe(table);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30_000);
  });
  it('프로필의 띠 이름 → 띠', () => {
    expect(zodiacAnimalByName('말')?.slug).toBe('horse');
    expect(zodiacAnimalByName('호랑이띠')?.slug).toBe('tiger');
    expect(zodiacAnimalByName('午')?.slug).toBe('horse');
    expect(zodiacAnimalByName('고양이')).toBeNull();
  });
});
