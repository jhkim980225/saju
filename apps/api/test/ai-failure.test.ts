/**
 * AI 실패 처리 — 비용이 되풀이해 나지 않게.
 * - 타로 이야기·택일 다듬기: 실패해도 결과당 최대 횟수·재시도 간격 안에서만 다시 부르고, 동시 요청(다른 인스턴스 포함)은 한 번만 부른다.
 * - 상담·꿈풀이: 거절(refused)이면 질문권을 차감한 채 규칙 기반 답, 서비스 쪽 장애(unavailable)면 환급 — 환급은 하루 상한까지.
 * AI 응답은 가짜로 대체한다(실제 Anthropic 호출 없음).
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/local.js';
import { creditLedger, reports, tarotReadings, users } from '../src/db/schema.js';
import { seedProducts } from '../src/db/seed.js';
import type { AiFailure } from '../src/modules/ai/service.js';
import { AI_REFUND_DAILY_LIMIT, AI_REFUND_REF } from '../src/modules/commerce/service.js';
import { AI_POLISH_MAX_ATTEMPTS } from '../src/modules/taekil/service.js';
import { AI_STORY_MAX_ATTEMPTS } from '../src/modules/tarot/service.js';

const BIRTH = { calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' } as const;
const DAY = 86_400_000;
const kstDay = (n: number) => new Date(Date.now() + 9 * 3_600_000 + n * DAY).toISOString().slice(0, 10);

let config: AppConfig;
let db: ReturnType<typeof createDb>['db'];
let app: App;
/** 같은 DB 를 쓰는 두 번째 인스턴스 — 다른 Worker 인스턴스처럼 메모리(inflight)를 나누지 않는다 */
let other: App;

beforeAll(async () => {
  config = loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: 'sk-ant-test-not-real', SIGNUP_BONUS_CREDITS: '0' });
  ({ db } = createDb(':memory:'));
  await runMigrations(db);
  await seedProducts(db);
  app = await buildApp({ config, db });
  other = await buildApp({ config, db });
});
afterAll(async () => {
  await app.close();
  await other.close();
});

const call = async (target: App, method: 'GET' | 'POST', url: string, opts: { token?: string; body?: unknown } = {}) => {
  const res = await target.inject({
    method,
    url: `/api/v1${url}`,
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null };
};
const api = (method: 'GET' | 'POST', url: string, opts: { token?: string; body?: unknown } = {}) => call(app, method, url, opts);

let seq = 0;
/** 회원 + 프로필 (+ 질문권, 플러스 구독으로 유료 결과를 모두 연다) */
async function member(opts: { credits?: number; premium?: boolean } = {}) {
  const r = await api('POST', '/auth/signup', { body: { email: `ai-fail-${++seq}@example.com`, password: 'password1234', nickname: '서윤' } });
  expect(r.status).toBe(201);
  const userId = r.body.user.id as string;
  const token = r.body.accessToken as string;
  if (opts.credits) await app.ctx.services.commerce.grantFreeCredits(userId, opts.credits, '테스트 지급');
  if (opts.premium) await db.update(users).set({ premiumUntil: Date.now() + 30 * DAY }).where(eq(users.id, userId));
  const profileId = (await api('POST', '/profiles', { token, body: { name: '서윤', relation: 'self', birth: BIRTH } })).body.id as string;
  return { token, userId, profileId };
}
const credits = async (token: string) => (await api('GET', '/wallet', { token })).body.credits as number;

describe('타로 이야기 — 실패해도 재시도 횟수·간격 제한', () => {
  let calls = 0;
  let delay = 0;
  let reply: string[] | null = null;
  beforeAll(() => {
    const stub = async () => {
      calls++;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return reply;
    };
    app.ctx.services.ai.tarotStory = stub;
    other.ctx.services.ai.tarotStory = stub;
  });

  const draw = async (token: string, question: string) => {
    const s = await api('POST', '/tarot/shuffle', { token, body: { spread: 'three', topic: 'self', question } });
    const r = await api('POST', '/tarot/readings', { token, body: { deckToken: s.body.deckToken, spread: 'three', topic: 'self', question, picks: [0, 1, 2] } });
    expect(r.status).toBe(200);
    return r.body;
  };
  const row = async (id: string) => (await db.select().from(tarotReadings).where(eq(tarotReadings.id, id)))[0]!;
  /** 재시도 간격이 지난 것처럼 */
  const elapse = (id: string) => db.update(tarotReadings).set({ aiRetryAt: Date.now() - 1 }).where(eq(tarotReadings.id, id));

  it('실패한 리딩을 여러 번 열어도 간격 안에서는 다시 부르지 않고, 간격이 지나도 최대 횟수까지만 부른다', async () => {
    const { token } = await member({ premium: true });
    calls = 0;
    reply = null;
    const reading = await draw(token, '요즘 내 흐름');
    expect(reading.locked).toBe(false);
    expect(reading.generator).toBe('rule');
    expect(calls).toBe(1);
    for (let i = 0; i < 5; i++) expect((await api('GET', `/tarot/readings/${reading.id}`, { token })).body.generator).toBe('rule');
    expect(calls).toBe(1);
    expect((await row(reading.id)).aiAttempts).toBe(1);
    expect((await row(reading.id)).aiRetryAt).toBeGreaterThan(Date.now() + 9 * 60_000);

    for (let attempt = 2; attempt <= AI_STORY_MAX_ATTEMPTS + 2; attempt++) {
      await elapse(reading.id);
      await api('GET', `/tarot/readings/${reading.id}`, { token });
      await api('GET', `/tarot/readings/${reading.id}`, { token });
    }
    expect(calls).toBe(AI_STORY_MAX_ATTEMPTS);
    expect((await row(reading.id)).aiAttempts).toBe(AI_STORY_MAX_ATTEMPTS);
  });

  it('동시에 여러 번 열어도(다른 인스턴스 포함) 한 번만 부른다', async () => {
    const { token } = await member();
    calls = 0;
    reply = null;
    const reading = await draw(token, '동시에 열기'); // 아직 잠김 — AI 를 부르지 않는다
    expect(reading.locked).toBe(true);
    expect(calls).toBe(0);
    const userId = (await db.select({ userId: tarotReadings.userId }).from(tarotReadings).where(eq(tarotReadings.id, reading.id)))[0]!.userId;
    await db.update(users).set({ premiumUntil: Date.now() + DAY }).where(eq(users.id, userId));
    delay = 30;
    const opened = await Promise.all(Array.from({ length: 6 }, (_, i) => call(i % 2 ? other : app, 'GET', `/tarot/readings/${reading.id}`, { token })));
    delay = 0;
    expect(opened.every((r) => r.status === 200)).toBe(true);
    expect(calls).toBe(1);
  });

  it('재시도가 성공하면 저장하고, 그 뒤로는 부르지 않는다', async () => {
    const { token } = await member({ premium: true });
    calls = 0;
    reply = null;
    const reading = await draw(token, '성공할 때까지');
    await elapse(reading.id);
    reply = ['카드끼리 이어지는 이야기 첫 문단', '둘째 문단'];
    const ok = await api('GET', `/tarot/readings/${reading.id}`, { token });
    expect(ok.body.generator).toBe('ai');
    expect(calls).toBe(2);
    expect((await row(reading.id)).aiParagraphs).toEqual(reply);
    await elapse(reading.id);
    await api('GET', `/tarot/readings/${reading.id}`, { token });
    expect(calls).toBe(2);
  });
});

describe('택일 AI 다듬기 — 실패해도 재시도 횟수·간격 제한', () => {
  let calls = 0;
  let delay = 0;
  let succeed = false;
  beforeAll(() => {
    const stub: App['ctx']['services']['ai']['enhanceSections'] = async ({ draft }) => {
      calls++;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return succeed ? { sections: draft.map((s) => ({ ...s, summary: `다듬은 ${s.summary}` })), generator: 'ai', model: 'stub' } : { sections: draft, generator: 'rule', model: null };
    };
    app.ctx.services.ai.enhanceSections = stub;
    other.ctx.services.ai.enhanceSections = stub;
  });
  const row = async (id: string) => (await db.select().from(reports).where(eq(reports.id, id)))[0]!;
  const elapse = (id: string) => db.update(reports).set({ polishLeaseUntil: Date.now() - 1 }).where(eq(reports.id, id));

  it('실패한 결과를 여러 번 열어도 간격 안에서는 다시 부르지 않고, 최대 횟수까지만 부른다', async () => {
    const { token, profileId } = await member({ premium: true });
    calls = 0;
    succeed = false;
    const r = await api('POST', '/taekil', { token, body: { profileId, purpose: 'move', from: kstDay(3), to: kstDay(20) } });
    expect(r.status).toBe(201);
    expect(r.body.locked).toBe(false);
    expect(r.body.generator).toBe('rule');
    expect(calls).toBe(1);
    for (let i = 0; i < 5; i++) await api('GET', `/taekil/${r.body.id}`, { token });
    expect(calls).toBe(1);
    for (let i = 0; i < AI_POLISH_MAX_ATTEMPTS + 2; i++) {
      await elapse(r.body.id);
      await api('GET', `/taekil/${r.body.id}`, { token });
    }
    expect(calls).toBe(AI_POLISH_MAX_ATTEMPTS);
    expect((await row(r.body.id)).polishDone).toBe(AI_POLISH_MAX_ATTEMPTS);
  });

  it('동시에 여러 번 열어도(다른 인스턴스 포함) 한 번만 부르고, 성공하면 저장한다', async () => {
    const { token, profileId, userId } = await member();
    calls = 0;
    const r = await api('POST', '/taekil', { token, body: { profileId, purpose: 'move', from: kstDay(5), to: kstDay(25) } });
    expect(r.body.locked).toBe(true);
    expect(calls).toBe(0);
    await db.update(users).set({ premiumUntil: Date.now() + DAY }).where(eq(users.id, userId));
    succeed = true;
    delay = 30;
    const opened = await Promise.all(Array.from({ length: 6 }, (_, i) => call(i % 2 ? other : app, 'GET', `/taekil/${r.body.id}`, { token })));
    delay = 0;
    expect(opened.every((x) => x.status === 200)).toBe(true);
    expect(calls).toBe(1);
    expect((await row(r.body.id)).generator).toBe('ai');
    expect((await api('GET', `/taekil/${r.body.id}`, { token })).body.generator).toBe('ai');
    expect(calls).toBe(1);
  });
});

describe('상담·꿈풀이 — 거절은 차감, 장애는 환급(하루 상한)', () => {
  let chatReply: { text: string; generator: 'ai' } | AiFailure = { failed: 'unavailable' };
  let dreamReply: { headline: string; paragraphs: string[] } | AiFailure = { failed: 'unavailable' };
  let chatCalls = 0;
  beforeAll(() => {
    app.ctx.services.ai.chat = async () => {
      chatCalls++;
      return chatReply;
    };
    app.ctx.services.ai.dreamInterpret = async () => dreamReply;
  });
  const chat = (token: string, profileId: string, message = '올해 이직해도 될까요?') => api('POST', '/chat', { token, body: { profileId, message } });
  const dream = (token: string) => api('POST', '/dream/interpret', { token, body: { text: '큰 뱀이 집 안으로 들어왔어요' } });
  const refundsOf = async (userId: string) => (await db.select().from(creditLedger).where(and(eq(creditLedger.userId, userId), eq(creditLedger.refType, AI_REFUND_REF)))).length;

  it('상담 — 거절이면 질문권을 차감한 채 규칙 기반 답을 준다', async () => {
    const { token, profileId, userId } = await member({ credits: 3 });
    chatReply = { failed: 'refused' };
    const r = await chat(token, profileId);
    expect(r.status).toBe(200);
    expect(r.body.generator).toBe('rule');
    expect(r.body.reply.content.length).toBeGreaterThan(20);
    expect(r.body.creditsLeft).toBe(2);
    expect(await refundsOf(userId)).toBe(0);
  });

  it('상담 — 서비스 쪽 장애면 규칙 기반 답과 함께 질문권을 돌려준다', async () => {
    const { token, profileId, userId } = await member({ credits: 3 });
    chatReply = { failed: 'unavailable' };
    const r = await chat(token, profileId);
    expect(r.body.generator).toBe('rule');
    expect(r.body.creditsLeft).toBe(3);
    const w = (await api('GET', '/wallet', { token })).body;
    expect(w.ledger.some((l: any) => l.memo === 'AI 상담 실패 환급' && l.delta === 1)).toBe(true);
    expect(await refundsOf(userId)).toBe(1);
  });

  it('상담 — 성공하면 차감, 환급 없음', async () => {
    const { token, profileId } = await member({ credits: 2 });
    chatReply = { text: '이직은 하반기가 낫습니다.', generator: 'ai' };
    const r = await chat(token, profileId);
    expect(r.body.generator).toBe('ai');
    expect(r.body.creditsLeft).toBe(1);
  });

  it('꿈풀이 — 거절이면 차감(creditsCharged 1), 장애면 환급(creditsCharged 0)', async () => {
    const { token } = await member({ credits: 3 });
    dreamReply = { failed: 'refused' };
    const refused = await dream(token);
    expect(refused.body).toMatchObject({ generator: 'rule', creditsCharged: 1, creditsLeft: 2 });
    dreamReply = { failed: 'unavailable' };
    const down = await dream(token);
    expect(down.body).toMatchObject({ generator: 'rule', creditsCharged: 0, creditsLeft: 2 });
  });

  it(`장애 환급은 상담·꿈풀이를 합쳐 하루 ${AI_REFUND_DAILY_LIMIT}번까지 — 넘으면 차감한 채로 둔다`, async () => {
    const { token, profileId, userId } = await member({ credits: 20 });
    chatReply = { failed: 'unavailable' };
    dreamReply = { failed: 'unavailable' };
    for (let i = 0; i < AI_REFUND_DAILY_LIMIT - 1; i++) expect((await chat(token, profileId, `질문 ${i}`)).body.creditsLeft).toBe(20);
    expect((await dream(token)).body).toMatchObject({ creditsCharged: 0, creditsLeft: 20 });
    expect(await refundsOf(userId)).toBe(AI_REFUND_DAILY_LIMIT);

    expect((await chat(token, profileId, '한 번 더')).body.creditsLeft).toBe(19);
    expect((await dream(token)).body).toMatchObject({ creditsCharged: 1, creditsLeft: 18 });
    expect(await refundsOf(userId)).toBe(AI_REFUND_DAILY_LIMIT);

    // 어제 받은 환급은 오늘 상한에 세지 않는다
    await db.update(creditLedger).set({ createdAt: Date.now() - 2 * DAY }).where(and(eq(creditLedger.userId, userId), eq(creditLedger.refType, AI_REFUND_REF)));
    expect((await chat(token, profileId, '다음 날')).body.creditsLeft).toBe(18);
  });

  it('동시에 장애가 나도 하루 환급 상한을 넘지 않는다', async () => {
    const { token, profileId, userId } = await member({ credits: 20 });
    chatReply = { failed: 'unavailable' };
    await Promise.all(Array.from({ length: AI_REFUND_DAILY_LIMIT + 3 }, (_, i) => chat(token, profileId, `동시 ${i}`)));
    expect(await refundsOf(userId)).toBe(AI_REFUND_DAILY_LIMIT);
    expect(await credits(token)).toBe(20 - 3);
  });

  it('AI 키가 없으면(규칙 기반 운영) 차감하지 않는다', async () => {
    const plain = loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: '', SIGNUP_BONUS_CREDITS: '0' });
    const created = createDb(':memory:');
    await runMigrations(created.db);
    await seedProducts(created.db);
    const noKey = await buildApp({ config: plain, db: created.db });
    const signup = await call(noKey, 'POST', '/auth/signup', { body: { email: 'ai-fail-nokey@example.com', password: 'password1234' } });
    await noKey.ctx.services.commerce.grantFreeCredits(signup.body.user.id, 2, '테스트 지급');
    const token = signup.body.accessToken as string;
    const profileId = (await call(noKey, 'POST', '/profiles', { token, body: { name: '서윤', relation: 'self', birth: BIRTH } })).body.id;
    const r = await call(noKey, 'POST', '/chat', { token, body: { profileId, message: '올해 운은 어떤가요?' } });
    expect(r.body).toMatchObject({ generator: 'rule', creditsLeft: 2 });
    const d = await call(noKey, 'POST', '/dream/interpret', { token, body: { text: '큰 뱀이 집 안으로 들어왔어요' } });
    expect(d.body).toMatchObject({ generator: 'rule', creditsCharged: 0, creditsLeft: 2 });
    await noKey.close();
  });
});
