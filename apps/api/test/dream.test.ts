import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  DREAM_CATEGORIES,
  DREAM_ENTRIES,
  dreamTitle,
  extractDreamSymbols,
  getDreamEntry,
  normalizeDreamQuery,
  resolveDreamTerm,
  searchDreams,
} from '@saju/shared/dream';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { seedProducts } from '../src/db/seed.js';
import type { DreamAiInput } from '../src/modules/ai/service.js';

const BIRTH = { calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' } as const;

// ---------------------------------------------------------------------------
// 사전 무결성
// ---------------------------------------------------------------------------

describe('꿈해몽 사전 — 무결성', () => {
  it('300개 이상, 분류마다 항목이 있다', () => {
    expect(DREAM_ENTRIES.length).toBeGreaterThanOrEqual(300);
    for (const c of DREAM_CATEGORIES) expect(DREAM_ENTRIES.filter((e) => e.category === c).length, c).toBeGreaterThan(0);
  });

  it('키워드·슬러그는 유일하고, 슬러그는 주소에 그대로 쓸 수 있다', () => {
    const keywords = DREAM_ENTRIES.map((e) => e.keyword);
    const slugs = DREAM_ENTRIES.map((e) => e.slug);
    expect(new Set(keywords).size).toBe(keywords.length);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) {
      expect(s, s).toMatch(/^[0-9a-z가-힣-]+$/);
      expect(getDreamEntry(s)?.slug).toBe(s);
    }
  });

  it('키워드·별칭은 사전 전체에서 겹치지 않고(띄어쓰기 무시), 모두 자기 항목으로 찾아진다', () => {
    const owner = new Map<string, string>();
    for (const e of DREAM_ENTRIES) {
      for (const term of [e.keyword, ...e.aliases]) {
        expect(normalizeDreamQuery(term), `${e.keyword}: '${term}' 정규화 후 빈 문자열`).not.toBe('');
        const k = term.replace(/\s+/g, '');
        const prev = owner.get(k);
        expect(prev === undefined || prev === e.slug, `'${term}' 이(가) ${prev} 와 ${e.slug} 에 함께 있어요`).toBe(true);
        owner.set(k, e.slug);
        expect(resolveDreamTerm(term)?.slug, `${term} → ${e.slug}`).toBe(e.slug);
      }
    }
  });

  it('모든 항목이 빠짐없이 채워져 있다', () => {
    for (const e of DREAM_ENTRIES) {
      expect(['good', 'bad', 'neutral'], e.keyword).toContain(e.tone);
      expect(e.summary.length, `${e.keyword} summary`).toBeGreaterThanOrEqual(10);
      expect(e.summary.length, `${e.keyword} summary`).toBeLessThanOrEqual(45);
      expect(e.meaning.length, `${e.keyword} meaning`).toBeGreaterThanOrEqual(60);
      expect(e.variations.length, `${e.keyword} variations`).toBeGreaterThanOrEqual(2);
      expect(e.variations.length, `${e.keyword} variations`).toBeLessThanOrEqual(4);
      expect(new Set(e.variations.map((v) => v.title)).size, `${e.keyword} 상황 제목 중복`).toBe(e.variations.length);
      for (const v of e.variations) {
        expect(v.title.endsWith('꿈'), `${e.keyword} / ${v.title}`).toBe(true);
        expect(v.text.length, `${e.keyword} / ${v.title}`).toBeGreaterThanOrEqual(25);
        expect(v.hints.length, `${e.keyword} / ${v.title} hints`).toBeGreaterThan(0);
        if (v.tone) expect(['good', 'bad', 'neutral']).toContain(v.tone);
      }
      for (const k of ['extract', 'exclude'] as const) if (e[k]) expect(e[k]!.every((x) => x.trim().length > 0), `${e.keyword} ${k}`).toBe(true);
    }
  });

  it('문안 원칙 — 단정·공포 조장·성별 단정·도박 권유·진단 표현이 없다', () => {
    const banned = /반드시|틀림없이|100%|큰일|재앙|저주|살이 ?끼|죽게 될|복권을 사|로또를 사|우울증|트라우마|진단|(?<![가-힣])아들|!!/;
    for (const e of DREAM_ENTRIES) {
      for (const text of [e.summary, e.meaning, ...e.variations.map((v) => v.text)]) expect(banned.test(text), `${e.keyword}: ${text}`).toBe(false);
    }
  });

  it('화면 제목 — 키워드가 꿈으로 끝나면 그대로', () => {
    expect(dreamTitle({ keyword: '뱀' })).toBe('뱀 꿈');
    expect(dreamTitle({ keyword: '쫓기는 꿈' })).toBe('쫓기는 꿈');
  });
});

// ---------------------------------------------------------------------------
// 검색
// ---------------------------------------------------------------------------

describe('꿈해몽 사전 — 검색', () => {
  const first = (q: string) => searchDreams(q)[0]?.keyword;

  it("'꿈'·'해몽'·띄어쓰기를 떼고 찾는다", () => {
    expect(normalizeDreamQuery('뱀 꿈 해몽')).toBe('뱀');
    expect(first('뱀꿈')).toBe('뱀');
    expect(first('뱀 꿈 해몽')).toBe('뱀');
    expect(first('돼지꿈')).toBe('돼지');
    expect(first('쫓기는꿈')).toBe('쫓기는 꿈');
    // '꿈'까지가 한 낱말인 항목은 그대로 — 개꿈은 개(동물)가 아니다
    expect(first('개꿈')).toBe('개꿈');
    expect(resolveDreamTerm('개꿈')?.keyword).toBe('개꿈');
    expect(first('개 꿈 해몽')).toBe('개');
  });

  it('별칭으로 찾는다', () => {
    expect(first('구렁이')).toBe('뱀');
    expect(first('이가 빠지는 꿈')).toBe('이빨');
    expect(first('강아지')).toBe('개');
  });

  it('입력 중인 앞부분·초성으로 찾는다', () => {
    expect(first('호랑')).toBe('호랑이');
    expect(first('호랑ㅇ')).toBe('호랑이');
    expect(first('ㅎㄹㅇ')).toBe('호랑이');
  });

  it('문장 속 키워드도 찾는다', () => {
    expect(searchDreams('뱀이 나오는 꿈').map((e) => e.keyword)).toContain('뱀');
  });

  it('빈 검색어·없는 말은 빈 결과', () => {
    expect(searchDreams('   ')).toEqual([]);
    expect(searchDreams('qqqzzz')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 꿈 이야기에서 상징 찾기 (AI 꿈풀이의 규칙 기반 근거)
// ---------------------------------------------------------------------------

describe('꿈해몽 사전 — 상징 추출', () => {
  const keys = (text: string) => extractDreamSymbols(text, 10).map((m) => m.entry.keyword);

  it('조사를 떼고 찾고, 맞는 상황(variation)을 고른다', () => {
    const m = extractDreamSymbols('큰 뱀이 집 안으로 들어와 제 손을 물었어요.', 10);
    const names = m.map((x) => x.entry.keyword);
    expect(names).toEqual(expect.arrayContaining(['뱀', '집', '손']));
    expect(names.indexOf('뱀')).toBeLessThan(names.indexOf('집'));
    expect(m.find((x) => x.entry.keyword === '뱀')?.variation?.title).toContain('물리');
  });

  it('붙여 쓴 꾸밈말·꿈도 떼어 본다', () => {
    expect(keys('흰뱀을 봤어요')).toContain('뱀');
    expect(keys('돼지꿈을 꿨어요')).toContain('돼지');
    expect(keys('소나무 아래에 있었어요')).toContain('나무');
  });

  it('동음이의어·다른 낱말 속 글자에는 걸리지 않는다', () => {
    expect(keys('어젯밤에 이상한 꿈을 꿨어요')).not.toContain('밤');
    expect(keys('어제 비가 많이 왔어요')).not.toContain('제비');
    expect(keys('친구를 기다리다가 잠이 들었어요')).not.toContain('다리');
    expect(keys('한 달 동안 바빴어요')).not.toContain('달');
    expect(keys('새 옷을 입고 나갔어요')).not.toContain('새');
    expect(keys('그 사람과 말을 했어요')).not.toContain('말');
    expect(keys('다리에 쥐가 났어요')).not.toContain('쥐');
  });

  it('구절로 찾는 항목 — 이가 빠지는 꿈, 하늘을 나는 꿈', () => {
    expect(keys('이가 몽땅 빠지는 꿈을 꿨어요')).toContain('이빨');
    expect(keys('하늘을 날아다니는 꿈')).toContain('하늘을 나는 꿈');
  });

  it('찾을 상징이 없으면 빈 배열, 개수 제한을 지킨다', () => {
    expect(extractDreamSymbols('그냥 그랬어요')).toEqual([]);
    expect(extractDreamSymbols('뱀 호랑이 돼지 용 거북이 잉어 학 소 말을 탔어요', 3)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// API — POST /api/v1/dream/interpret
// ---------------------------------------------------------------------------

type Api = (method: 'GET' | 'POST', url: string, opts?: { token?: string; body?: unknown }) => Promise<{ status: number; body: any }>;
const client =
  (app: FastifyInstance): Api =>
  async (method, url, opts = {}) => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
      ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
    });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };

async function makeApp(withKey: boolean) {
  const config = loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: withKey ? 'sk-ant-test-not-real' : '', SIGNUP_BONUS_CREDITS: '0' });
  const { db } = createDb(':memory:');
  runMigrations(db);
  seedProducts(db);
  const app = await buildApp({ config, db, logger: false });
  return { app, api: client(app) };
}

async function signup(api: Api, credits: number, app: FastifyInstance) {
  const r = await api('POST', '/auth/signup', { body: { email: `dream-${Math.random().toString(36).slice(2)}@example.com`, password: 'password1234', nickname: '꿈꾸는이' } });
  expect(r.status).toBe(201);
  if (credits > 0) app.ctx.services.commerce.grantFreeCredits(r.body.user.id, credits, '테스트 지급');
  return r.body.accessToken as string;
}

describe('AI 꿈풀이 API — AI 키 없음', () => {
  let app: FastifyInstance;
  let api: Api;
  beforeAll(async () => ({ app, api } = await makeApp(false)));
  afterAll(async () => app.close());

  it('로그인(게스트 포함) 필요', async () => {
    const r = await api('POST', '/dream/interpret', { body: { text: '뱀이 나오는 꿈을 꿨어요' } });
    expect(r.status).toBe(401);
  });

  it('규칙 기반 풀이, 질문권은 차감하지 않는다', async () => {
    const token = await signup(api, 3, app);
    const r = await api('POST', '/dream/interpret', { token, body: { text: '큰 뱀이 집 안으로 들어와 제 손을 물었어요.' } });
    expect(r.status).toBe(200);
    expect(r.body.generator).toBe('rule');
    expect(r.body.creditsCharged).toBe(0);
    expect(r.body.creditsLeft).toBe(3);
    expect(r.body.symbols.map((s: any) => s.slug)).toEqual(expect.arrayContaining(['뱀', '집', '손']));
    expect(r.body.paragraphs.length).toBeGreaterThanOrEqual(3);
    expect(r.body.paragraphs.join(' ')).toContain('뱀');
    expect(r.body.notice).toContain('규칙');
    expect(r.body.disclaimer).toContain('예언이 아니에요');
    expect(r.body.profileName).toBeNull();
    expect((await api('GET', '/wallet', { token })).body.credits).toBe(3);
  });

  it('상징이 없으면 더 적어 달라고 안내한다', async () => {
    const token = await signup(api, 0, app);
    const r = await api('POST', '/dream/interpret', { token, body: { text: '그냥 그런 하루였어요' } });
    expect(r.status).toBe(200);
    expect(r.body.symbols).toEqual([]);
    expect(r.body.headline).toContain('찾지 못했어요');
  });

  it('위기 신호가 있으면 상담 전화 안내를 먼저', async () => {
    const token = await signup(api, 0, app);
    const r = await api('POST', '/dream/interpret', { token, body: { text: '꿈에서도 너무 힘들어서 죽고 싶었어요' } });
    expect(r.body.crisis).toBe(true);
    expect(r.body.paragraphs[0]).toContain('109');
  });

  it('길이 검증 — 너무 짧거나 길면 400', async () => {
    const token = await signup(api, 0, app);
    expect((await api('POST', '/dream/interpret', { token, body: { text: '뱀' } })).status).toBe(400);
    expect((await api('POST', '/dream/interpret', { token, body: { text: '뱀'.repeat(501) } })).status).toBe(400);
  });

  it('남의 프로필로는 볼 수 없다', async () => {
    const owner = await signup(api, 0, app);
    const profile = await api('POST', '/profiles', { token: owner, body: { name: '서윤', relation: 'self', birth: BIRTH } });
    const other = await signup(api, 0, app);
    const r = await api('POST', '/dream/interpret', { token: other, body: { text: '뱀이 나오는 꿈을 꿨어요', profileId: profile.body.id } });
    expect(r.status).toBe(400);
  });
});

describe('AI 꿈풀이 API — AI 키 있음 (AI 응답은 가짜로 대체)', () => {
  let app: FastifyInstance;
  let api: Api;
  let calls: DreamAiInput[] = [];
  let reply: { headline: string; paragraphs: string[] } | null = null;

  beforeAll(async () => {
    ({ app, api } = await makeApp(true));
    // 실제 Anthropic 호출 대신 — 서비스는 같은 ai 객체를 참조한다
    app.ctx.services.ai.dreamInterpret = async (input) => {
      calls.push(input);
      return reply;
    };
  });
  afterAll(async () => app.close());

  it('질문권 1회 차감 + AI 풀이, 대표 프로필의 사주를 함께 넘긴다', async () => {
    expect(app.ctx.services.ai.enabled).toBe(true);
    const token = await signup(api, 3, app);
    await api('POST', '/profiles', { token, body: { name: '서윤', relation: 'self', birth: BIRTH } });
    calls = [];
    reply = { headline: '반가운 기회가 다가오는 꿈이에요', paragraphs: ['첫 문단', '둘째 문단', '셋째 문단'] };
    const r = await api('POST', '/dream/interpret', { token, body: { text: '큰 뱀이 집 안으로 들어와 제 손을 물었어요.' } });
    expect(r.status).toBe(200);
    expect(r.body.generator).toBe('ai');
    expect(r.body.creditsCharged).toBe(1);
    expect(r.body.creditsLeft).toBe(2);
    expect(r.body.headline).toBe('반가운 기회가 다가오는 꿈이에요');
    expect(r.body.profileName).toBe('서윤');
    expect(r.body.notice).toContain('AI');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.symbols.map((s) => s.keyword)).toEqual(expect.arrayContaining(['뱀', '집', '손']));
    expect(calls[0]!.saju?.profileName).toBe('서윤');
    expect(calls[0]!.saju?.summary).toContain('일간');
    expect((await api('GET', '/wallet', { token })).body.credits).toBe(2);
  });

  it("'사주 없이'를 고르면 사주를 넘기지 않는다", async () => {
    const token = await signup(api, 1, app);
    await api('POST', '/profiles', { token, body: { name: '서윤', relation: 'self', birth: BIRTH } });
    calls = [];
    reply = { headline: '한 줄', paragraphs: ['문단'] };
    const r = await api('POST', '/dream/interpret', { token, body: { text: '돼지꿈을 꿨어요', withoutSaju: true } });
    expect(r.body.generator).toBe('ai');
    expect(r.body.profileName).toBeNull();
    expect(calls[0]!.saju).toBeNull();
  });

  it('AI 가 실패하면 규칙 기반으로 대체하고 질문권을 돌려준다', async () => {
    const token = await signup(api, 2, app);
    reply = null;
    const r = await api('POST', '/dream/interpret', { token, body: { text: '돼지꿈을 꿨어요' } });
    expect(r.status).toBe(200);
    expect(r.body.generator).toBe('rule');
    expect(r.body.creditsCharged).toBe(0);
    expect(r.body.creditsLeft).toBe(2);
    const w = (await api('GET', '/wallet', { token })).body;
    expect(w.ledger.some((l: any) => l.memo === 'AI 꿈풀이 실패 환급')).toBe(true);
  });

  it('질문권이 없으면 402 이고 AI 를 부르지 않는다', async () => {
    const token = await signup(api, 0, app);
    calls = [];
    reply = { headline: '한 줄', paragraphs: ['문단'] };
    const r = await api('POST', '/dream/interpret', { token, body: { text: '돼지꿈을 꿨어요' } });
    expect(r.status).toBe(402);
    expect(r.body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(calls).toHaveLength(0);
  });
});
