import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { TOJEONG_CODES } from '@saju/core';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { seedProducts } from '../src/db/seed.js';
import { GWAE_LIST } from '../src/modules/tojeong/content/index.js';

let app: FastifyInstance;
const BIRTH = { calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' } as const;

beforeAll(async () => {
  const config = loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: '', SIGNUP_BONUS_CREDITS: '0' });
  const { db } = createDb(':memory:');
  runMigrations(db);
  seedProducts(db);
  app = await buildApp({ config, db, logger: false });
});
afterAll(async () => {
  await app.close();
});

const api = async (method: 'GET' | 'POST', url: string, opts: { token?: string; body?: unknown } = {}) => {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null };
};

const len = (s: string) => [...s].length;
const HANJA = /[㐀-鿿豈-﫿]/;
/** 카피 가이드 §5.4~5.6 — 공포 조장·단정·성별·출산 전제 표현 */
const BANNED = ['흉', '재앙', '횡액', '액운', '죽음', '사망', '상복', '초상', '아들', '득남', '귀자', '과부', '반드시', '대박', '최악', '!', '관재', '송사', '여자', '남자', '아내', '남편', '성씨', '팔자'];

describe('토정비결 144괘 원고', () => {
  it('144괘가 괘 번호 순서대로 모두 있다', () => {
    expect(GWAE_LIST.map((g) => g.code)).toEqual([...TOJEONG_CODES]);
  });

  it('괘마다 괘사·독음·제목·요약·키워드 3개·총평 2문단·열두 달이 채워져 있다', () => {
    for (const g of GWAE_LIST) {
      expect(g.verse, `${g.code}`).toMatch(/^[㐀-鿿豈-﫿]{4} [㐀-鿿豈-﫿]{4}$/);
      expect(g.reading, `${g.code}`).toMatch(/^[가-힣]{4} [가-힣]{4}$/);
      expect(len(g.title), `${g.code} title`).toBeGreaterThanOrEqual(6);
      expect(len(g.title), `${g.code} title`).toBeLessThanOrEqual(22);
      expect(len(g.summary), `${g.code} summary`).toBeGreaterThanOrEqual(20);
      expect(len(g.summary), `${g.code} summary`).toBeLessThanOrEqual(55);
      expect(g.keywords).toHaveLength(3);
      expect(g.overview).toHaveLength(2);
      const overview = len(g.overview.join(''));
      expect(overview, `${g.code} overview`).toBeGreaterThanOrEqual(200);
      expect(overview, `${g.code} overview`).toBeLessThanOrEqual(460);
      expect(g.months).toHaveLength(12);
      for (const m of g.months) {
        expect(['rise', 'even', 'care']).toContain(m.flow);
        expect(len(m.text), `${g.code} month`).toBeGreaterThanOrEqual(40);
        expect(len(m.text), `${g.code} month`).toBeLessThanOrEqual(120);
      }
    }
  });

  it('우리말 문장에는 한자·금지어가 없고, 제목과 달 문장이 겹치지 않는다', () => {
    const titles = new Set<string>();
    const monthTexts = new Set<string>();
    for (const g of GWAE_LIST) {
      const texts = [g.title, g.summary, ...g.keywords, ...g.overview, ...g.months.map((m) => m.text)];
      for (const t of texts) {
        expect(HANJA.test(t), `${g.code}: ${t}`).toBe(false);
        for (const b of BANNED) expect(t.includes(b), `${g.code} '${b}': ${t}`).toBe(false);
      }
      expect(titles.has(g.title), `${g.code} 제목 중복: ${g.title}`).toBe(false);
      titles.add(g.title);
      for (const m of g.months) {
        expect(monthTexts.has(m.text), `${g.code} 달 문장 중복: ${m.text}`).toBe(false);
        monthTexts.add(m.text);
      }
    }
  });
});

describe('POST /tojeong', () => {
  it('비회원 — 양력 1990-05-15생의 2027 토정비결은 163괘', async () => {
    const r = await api('POST', '/tojeong', { body: { birth: BIRTH } });
    expect(r.status).toBe(200);
    expect(r.body.year).toBe(2027);
    expect(r.body.yearPillar).toEqual({ hanja: '丁未', hangul: '정미' });
    expect(r.body.gwae.code).toBe(163);
    expect([r.body.gwae.upper, r.body.gwae.middle, r.body.gwae.lower]).toEqual([1, 6, 3]);
    expect(r.body.gwae.verse).toBe(GWAE_LIST.find((g) => g.code === 163)!.verse);
    expect(r.body.overview).toHaveLength(2);
    expect(r.body.months).toHaveLength(12);
    expect(r.body.months[0]).toMatchObject({ month: 1, label: '음력 1월', period: '2.7 ~ 3.7' });
    expect(r.body.months[11].period).toBe('12.28 ~ 1.26');
    expect(r.body.basis).toMatchObject({
      lunarBirth: { year: 1990, month: 4, day: 21, isLeapMonth: false },
      age: 38,
      upper: { ganzhi: '丁未', value: 19, sum: 57 },
      middle: { ganzhi: '乙巳', value: 12, monthDays: 30, sum: 42 },
      lower: { ganzhi: '乙巳', value: 15, birthDay: 21, solarDate: '2027-05-26', sum: 36 },
    });
    expect(r.body.profileId).toBeNull();
    expect(r.body.shareText).toContain('163괘');
    expect(r.body.shareText).not.toContain('1990');
    expect(r.body.disclaimer).toBeTruthy();
  });

  it('음력 윤달 입력과 대상 연도 지정', async () => {
    const r = await api('POST', '/tojeong', { body: { birth: { calendar: 'lunar', year: 1987, month: 6, day: 10, isLeapMonth: true }, year: 2027 } });
    expect(r.status).toBe(200);
    expect(r.body.gwae.code).toBe(411);
    expect(r.body.basis.notes[0]).toContain('평달');
    const y2028 = await api('POST', '/tojeong', { body: { birth: { calendar: 'lunar', year: 1980, month: 5, day: 5 }, year: 2028 } });
    expect(y2028.body.gwae.code).toBe(223);
    expect(y2028.body.yearPillar.hanja).toBe('戊申');
  });

  it('저장한 프로필로 보기 — 세션이 있어야 하고 프로필 id 를 돌려준다', async () => {
    const g = await api('POST', '/auth/guest', { body: { deviceId: 'device-tojeong-01' } });
    const token = g.body.accessToken as string;
    const p = await api('POST', '/profiles', { token, body: { name: '민수', relation: 'self', birth: BIRTH } });
    expect(p.status).toBe(201);
    const r = await api('POST', '/tojeong', { token, body: { profileId: p.body.id } });
    expect(r.status).toBe(200);
    expect(r.body.gwae.code).toBe(163);
    expect(r.body.profileId).toBe(p.body.id);
    expect((await api('POST', '/tojeong', { body: { profileId: p.body.id } })).status).toBe(401);
    const other = await api('POST', '/auth/guest', { body: { deviceId: 'device-tojeong-02' } });
    expect((await api('POST', '/tojeong', { token: other.body.accessToken, body: { profileId: p.body.id } })).status).toBe(404);
  });

  it('잘못된 입력은 400', async () => {
    expect((await api('POST', '/tojeong', { body: {} })).status).toBe(400);
    const noDay = await api('POST', '/tojeong', { body: { birth: { calendar: 'lunar', year: 1995, month: 1, day: 30 } } });
    expect(noDay.status).toBe(400);
    expect(noDay.body.error.code).toBe('VALIDATION_ERROR');
    expect((await api('POST', '/tojeong', { body: { birth: BIRTH, year: 2050 } })).status).toBe(400);
    expect((await api('POST', '/tojeong', { body: { birth: { ...BIRTH, year: 2030 } } })).status).toBe(400);
  });
});
