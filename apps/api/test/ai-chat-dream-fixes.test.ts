/**
 * AI 상담·꿈풀이 알려진 이슈 회귀(docs/features/ask.md · dream.md '알려진 이슈').
 * - 장애 환급은 차감한 몫 그대로(유상분은 유상으로), 같은 차감을 두 번 돌려주지 않는다
 * - 꿈풀이 차감은 원장에 ref_type='dream'
 * - 문체 검사 탈락(filtered)도 환급, AI 출력에서 한자·'당신'·비유 문장을 거른다
 * - 상담 사주 요약의 오늘 날짜·현재 대운은 KST 기준
 * - 위기 표현은 상담·꿈풀이가 같은 기준, 규칙 기반 상담 답변에도 상담 전화 안내
 * - 프로필을 지우면 그 프로필의 상담 기록도 지운다, 화면용 대화 지우기(DELETE /chat)
 * AI 응답은 가짜로 대체한다(실제 Anthropic 호출 없음).
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { calculateSaju } from '@saju/core';
import { CRISIS_PATTERN } from '@saju/shared';
import { DREAM_CRISIS_PATTERN } from '@saju/shared/dream';
import type { App } from '../src/app.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/local.js';
import { chatMessages, creditLedger, users } from '../src/db/schema.js';
import { seedProducts } from '../src/db/seed.js';
import type { AiFailure } from '../src/modules/ai/service.js';
import { cleanAiLine, cleanAiParagraphs, cleanAiText } from '../src/modules/ai/plainOutput.js';
import { AI_REFUND_REF } from '../src/modules/commerce/service.js';
import { chartSummary } from '../src/modules/chat/service.js';

const BIRTH = { calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' } as const;

let db: ReturnType<typeof createDb>['db'];
let app: App;

beforeAll(async () => {
  const config = loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: 'sk-ant-test-not-real', SIGNUP_BONUS_CREDITS: '0' });
  ({ db } = createDb(':memory:'));
  await runMigrations(db);
  await seedProducts(db);
  app = await buildApp({ config, db });
});
afterAll(async () => {
  await app.close();
});
afterEach(() => {
  vi.useRealTimers();
});

const api = async (method: 'GET' | 'POST' | 'DELETE', url: string, opts: { token?: string; body?: unknown } = {}) => {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null };
};

let seq = 0;
async function member(opts: { free?: number; paid?: number } = {}) {
  const r = await api('POST', '/auth/signup', { body: { email: `ask-fix-${++seq}@example.com`, password: 'password1234', nickname: '서윤' } });
  const userId = r.body.user.id as string;
  const token = r.body.accessToken as string;
  const free = opts.free ?? 0;
  const paid = opts.paid ?? 0;
  if (free || paid) await db.update(users).set({ credits: free + paid, paidCredits: paid }).where(eq(users.id, userId));
  const profileId = (await api('POST', '/profiles', { token, body: { name: '서윤', relation: 'self', birth: BIRTH } })).body.id as string;
  return { token, userId, profileId };
}
const walletOf = async (userId: string) => (await db.select({ credits: users.credits, paidCredits: users.paidCredits }).from(users).where(eq(users.id, userId)))[0]!;

describe('질문권 — 장애 환급은 차감한 몫 그대로, 꿈풀이는 ref_type=dream', () => {
  let chatReply: { text: string; generator: 'ai' } | AiFailure = { failed: 'unavailable' };
  let dreamReply: { headline: string; paragraphs: string[] } | AiFailure = { failed: 'unavailable' };
  beforeAll(() => {
    app.ctx.services.ai.chat = async () => chatReply;
    app.ctx.services.ai.dreamInterpret = async () => dreamReply;
  });

  it('유상 질문권만 있는 사용자가 장애를 겪으면 유상으로 돌려준다(환불할 수 있는 잔액이 무상으로 바뀌지 않는다)', async () => {
    const m = await member({ paid: 2 });
    chatReply = { failed: 'unavailable' };
    const r = await api('POST', '/chat', { token: m.token, body: { profileId: m.profileId, message: '올해 이직해도 될까요?' } });
    expect(r.status).toBe(200);
    expect(await walletOf(m.userId)).toEqual({ credits: 2, paidCredits: 2 });
    const refunds = await db.select().from(creditLedger).where(and(eq(creditLedger.userId, m.userId), eq(creditLedger.refType, AI_REFUND_REF)));
    expect(refunds.map((l) => [l.source, l.delta])).toEqual([['paid', 1]]);
  });

  it('무상분이 있으면 무상분을 쓰고 무상으로 돌려준다', async () => {
    const m = await member({ free: 1, paid: 1 });
    chatReply = { failed: 'unavailable' };
    await api('POST', '/chat', { token: m.token, body: { profileId: m.profileId, message: '연애운은 어떤가요?' } });
    expect(await walletOf(m.userId)).toEqual({ credits: 2, paidCredits: 1 });
  });

  it('같은 차감(refId)을 두 번 돌려주지 않는다', async () => {
    const m = await member({ paid: 1 });
    const refId = 'manual-ref-0001';
    await app.ctx.services.commerce.consumeCredits(m.userId, 1, '테스트 차감', refId, 'chat');
    expect(await app.ctx.services.commerce.refundAiFailure(m.userId, 1, '테스트 환급', refId)).toBe(true);
    expect(await app.ctx.services.commerce.refundAiFailure(m.userId, 1, '테스트 환급', refId)).toBe(false);
    expect(await walletOf(m.userId)).toEqual({ credits: 1, paidCredits: 1 });
  });

  it('꿈풀이 차감은 원장에 ref_type=dream, 상담은 chat 으로 남는다', async () => {
    const m = await member({ free: 3 });
    chatReply = { text: '하반기가 낫습니다.', generator: 'ai' };
    dreamReply = { headline: '새로운 기회를 뜻하는 꿈이에요', paragraphs: ['뱀은 재물과 기회를 뜻하는 상징으로 풀이해요.'] };
    await api('POST', '/chat', { token: m.token, body: { profileId: m.profileId, message: '이직 시기는요?' } });
    await api('POST', '/dream/interpret', { token: m.token, body: { text: '큰 뱀이 집 안으로 들어왔어요' } });
    const consumes = await db.select().from(creditLedger).where(and(eq(creditLedger.userId, m.userId), eq(creditLedger.reason, 'consume')));
    expect(consumes.map((l) => [l.refType, l.memo]).sort()).toEqual([
      ['chat', 'AI 사주 상담'],
      ['dream', 'AI 꿈풀이'],
    ]);
  });

  it('문체 검사에 걸려 AI 답을 쓰지 못하면(filtered) 규칙 기반 답과 함께 돌려준다', async () => {
    const m = await member({ free: 2 });
    chatReply = { failed: 'filtered' };
    dreamReply = { failed: 'filtered' };
    const c = await api('POST', '/chat', { token: m.token, body: { profileId: m.profileId, message: '올해 운은 어떤가요?' } });
    expect(c.body).toMatchObject({ generator: 'rule', creditsLeft: 2 });
    const d = await api('POST', '/dream/interpret', { token: m.token, body: { text: '큰 뱀이 집 안으로 들어왔어요' } });
    expect(d.body).toMatchObject({ generator: 'rule', creditsCharged: 0, creditsLeft: 2 });
  });

  it('위기 표현이 있으면 규칙 기반 상담 답변 맨 앞에 상담 전화 안내를 넣는다', async () => {
    const m = await member({ free: 1 });
    chatReply = { failed: 'refused' };
    const r = await api('POST', '/chat', { token: m.token, body: { profileId: m.profileId, message: '요즘 목숨을 끊고 싶다는 생각이 들어요' } });
    expect(r.body.generator).toBe('rule');
    expect(r.body.reply.content.split('\n\n')[0]).toContain('109');
  });
});

describe('위기 표현 — 상담·꿈풀이·타로가 같은 기준', () => {
  it('꿈풀이 패턴은 공용 패턴과 같고, 상담에서 빠져 있던 표현도 잡는다', () => {
    expect(DREAM_CRISIS_PATTERN).toBe(CRISIS_PATTERN);
    for (const t of ['죽고 싶어요', '자살', '자해했어요', '살기 싫다', '사라지고 싶다', '목숨을 끊고 싶다', '극단적 선택']) expect(CRISIS_PATTERN.test(t), t).toBe(true);
    expect(CRISIS_PATTERN.test('오늘 회사에서 회의가 길었어요')).toBe(false);
  });
});

describe('상담 사주 요약 — 오늘 날짜·현재 대운은 KST 기준', () => {
  const chart = calculateSaju({ ...BIRTH, hour: 14, minute: 30 });

  it('UTC 로는 전날인 KST 새해 0시대에도 KST 날짜와 그해 대운을 쓴다', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-31T16:30:00Z')); // KST 2027-01-01 01:30
    const text = chartSummary(chart);
    expect(text).toContain('오늘 날짜: 2027-01-01');
    const daeun2027 = chart.daeun.periods.find((d) => 2027 >= d.startYear && 2027 <= d.endYear);
    if (daeun2027) expect(text).toContain(`${daeun2027.startYear}~${daeun2027.endYear}`);
  });

  it('날짜를 넘기면 그 날짜로 만든다', () => {
    expect(chartSummary(chart, { year: 2030, month: 3, day: 7 })).toContain('오늘 날짜: 2030-03-07');
  });
});

describe('상담 기록 지우기', () => {
  beforeAll(() => {
    app.ctx.services.ai.chat = async () => ({ text: '하반기가 낫습니다.', generator: 'ai' as const });
  });
  const rowsOf = async (userId: string, profileId: string) => (await db.select().from(chatMessages).where(and(eq(chatMessages.userId, userId), eq(chatMessages.profileId, profileId)))).length;

  it('대화 지우기(DELETE /chat) — 그 프로필의 대화만 지운다', async () => {
    const m = await member({ free: 2 });
    const other = (await api('POST', '/profiles', { token: m.token, body: { name: '지은', relation: 'friend', birth: { ...BIRTH, year: 1993 } } })).body.id as string;
    await api('POST', '/chat', { token: m.token, body: { profileId: m.profileId, message: '이직 시기는요?' } });
    await api('POST', '/chat', { token: m.token, body: { profileId: other, message: '연애운은요?' } });
    expect((await api('DELETE', `/chat?profileId=${m.profileId}`, { token: m.token })).status).toBe(204);
    expect((await api('GET', `/chat?profileId=${m.profileId}`, { token: m.token })).body).toEqual([]);
    expect(await rowsOf(m.userId, other)).toBe(2);
  });

  it('프로필을 지우면 그 프로필의 상담 기록도 함께 지운다', async () => {
    const m = await member({ free: 1 });
    await api('POST', '/chat', { token: m.token, body: { profileId: m.profileId, message: '올해 운은요?' } });
    expect(await rowsOf(m.userId, m.profileId)).toBe(2);
    expect((await api('DELETE', `/profiles/${m.profileId}`, { token: m.token })).status).toBe(204);
    expect(await rowsOf(m.userId, m.profileId)).toBe(0);
  });
});

describe('AI 출력 문체 검사(plainOutput)', () => {
  const none = { tone: '', hanja: '' };

  it('괄호 속 한자 표기는 괄호째 지우고, 그 밖의 한자가 든 문장은 뺀다', () => {
    expect(cleanAiParagraphs(['서윤님의 일간은 경금(庚金)이에요. 맺고 끊는 것이 분명한 편이에요. 올해는 목 기운이 들어오는 해로 봅니다.'], none)).toEqual([
      '서윤님의 일간은 경금이에요. 맺고 끊는 것이 분명한 편이에요. 올해는 목 기운이 들어오는 해로 봅니다.',
    ]);
    expect(cleanAiParagraphs(['庚金 일간이에요. 꼼꼼한 편이에요. 결정을 미루지 않아요. 계획을 세워 두세요.'], none)).toEqual(['꼼꼼한 편이에요. 결정을 미루지 않아요. 계획을 세워 두세요.']);
  });

  it("'당신'·비유·유아적인 표현이 든 문장을 빼고, 많이 빠지면 쓰지 않는다(null)", () => {
    expect(cleanAiParagraphs(['당신은 꼼꼼해요. 일정이 순조로운 날이에요. 연락은 오후에 하세요.'], none)).toEqual(['일정이 순조로운 날이에요. 연락은 오후에 하세요.']);
    expect(cleanAiParagraphs(['순풍에 돛 단 듯한 날이에요. 술술 풀려요.', '연락은 오후에 하세요.'], none)).toBeNull();
    expect(cleanAiParagraphs([], none)).toBeNull();
  });

  it('사용자가 쓴 말이나 근거 자료에 있는 표현은 허용한다(꿈에 나온 보물, 질문 속 한자)', () => {
    expect(cleanAiParagraphs(['꿈에서 본 보물은 재물을 뜻하는 상징이에요.'], { tone: '꿈에서 보물을 찾았어요', hanja: '' })).toEqual(['꿈에서 본 보물은 재물을 뜻하는 상징이에요.']);
    expect(cleanAiText('庚金은 경금이라고 읽어요.\n쇠의 기운을 뜻합니다.', { tone: '庚金이 뭐예요?', hanja: '庚金이 뭐예요?' })).toBe('庚金은 경금이라고 읽어요.\n쇠의 기운을 뜻합니다.');
  });

  it('머리말은 어긴 곳이 있으면 null', () => {
    expect(cleanAiLine('재물이 들어오는 꿈이에요', none)).toBe('재물이 들어오는 꿈이에요');
    expect(cleanAiLine('순풍에 돛 단 듯한 꿈이에요', none)).toBeNull();
  });
});
