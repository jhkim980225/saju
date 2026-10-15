/**
 * 유료 리포트 AI 다듬기 — 결제 직후 미리 만들기, 규칙 기반 본문 즉시 응답, 진행률, 중복 생성·중복 차감 방지, 끊긴 다듬기 재시작.
 * Anthropic SDK 는 vi.mock 으로 바꿔 끼우고, 덩어리마다 응답 시점을 테스트가 정한다(네트워크 없음).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations, type Db } from '../src/db/client.js';
import { reports } from '../src/db/schema.js';
import { seedProducts } from '../src/db/seed.js';

interface DraftSection {
  key: string;
  summary: string;
  paragraphs: string[];
}
interface Call {
  part: DraftSection[];
  /** 응답했는가 — resolve/reject 는 한 번만 효과가 있다 */
  done: boolean;
  resolve: () => void;
  reject: () => void;
}

const h = vi.hoisted(() => ({
  calls: [] as Call[],
  /** true: 바로 응답, 'fail': 바로 실패, false: 테스트가 resolve/reject 할 때까지 대기 */
  auto: false as boolean | 'fail',
  inFlight: 0,
}));

vi.mock('@anthropic-ai/sdk/helpers/zod', () => ({ zodOutputFormat: () => ({ type: 'json_schema' }) }));
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class RateLimitError extends APIError {}
  class AuthenticationError extends APIError {}
  class BadRequestError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static RateLimitError = RateLimitError;
    static AuthenticationError = AuthenticationError;
    static BadRequestError = BadRequestError;
    messages = {
      parse: (req: { messages: { content: string }[] }) => {
        const content = req.messages[0]!.content;
        const { draft } = JSON.parse(content.slice(content.indexOf('\n\n') + 2)) as { draft: DraftSection[] };
        h.inFlight++;
        return new Promise((resolve, reject) => {
          const call: Call = {
            part: draft,
            done: false,
            resolve: () => {
              if (call.done) return;
              call.done = true;
              h.inFlight--;
              resolve({
                stop_reason: 'end_turn',
                usage: { output_tokens: 1000 },
                parsed_output: { sections: draft.map((s) => ({ key: s.key, summary: `다듬은 ${s.summary}`, paragraphs: s.paragraphs.map((p) => `[AI] ${p}`) })) },
              });
            },
            reject: () => {
              if (call.done) return;
              call.done = true;
              h.inFlight--;
              reject(new APIError('overloaded'));
            },
          };
          h.calls.push(call);
          if (h.auto === true) call.resolve();
          else if (h.auto === 'fail') call.reject();
        });
      },
    };
    beta = { messages: { create: async () => ({ stop_reason: 'end_turn', content: [] }) } };
  }
  return { default: Anthropic };
});

let app: FastifyInstance;
let db: Db;
const BIRTH = { calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' } as const;

beforeAll(async () => {
  const config = loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: 'test-key', SIGNUP_BONUS_CREDITS: '0' });
  db = createDb(':memory:').db;
  runMigrations(db);
  seedProducts(db);
  app = await buildApp({ config, db, logger: false });
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  h.calls.length = 0;
  h.auto = false;
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  // 다음 테스트에 남은 호출이 새지 않게 모두 끝낸다
  h.auto = true;
  h.calls.splice(0).forEach((c) => c.resolve());
  vi.restoreAllMocks();
});

const api = async (method: 'GET' | 'POST', url: string, opts: { token?: string; body?: unknown; via?: FastifyInstance } = {}) => {
  const res = await (opts.via ?? app).inject({
    method,
    url: `/api/v1${url}`,
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null };
};

let seq = 0;
async function member() {
  const r = await api('POST', '/auth/signup', { body: { email: `polish${++seq}@example.com`, password: 'password123', nickname: '테스트' } });
  return r.body.accessToken as string;
}
async function profile(token: string, name = '민수', birth: object = BIRTH) {
  return (await api('POST', '/profiles', { token, body: { name, relation: 'self', birth } })).body.id as string;
}
async function buy(token: string, productId: string, body: Record<string, unknown> = {}) {
  const o = await api('POST', '/orders', { token, body: { productId, ...body } });
  const c = await api('POST', '/payments/confirm', { token, body: { provider: 'mock', orderId: o.body.order.id, amount: o.body.order.amount } });
  expect(c.status).toBe(200);
  return c.body;
}
/** 아직 응답하지 않은 호출 n 개에 응답 (기본: 전부) */
function settle(n = Infinity, how: 'resolve' | 'reject' = 'resolve') {
  for (const c of h.calls.filter((x) => !x.done).slice(0, n)) c[how]();
}
const progressOf = async (token: string, id: string) => (await api('GET', `/reports/${id}/progress`, { token })).body;

describe('사주분석서 — 결제 직후 미리 만들고, 규칙 기반 본문을 바로 보여 준다', () => {
  it('결제 확정 → 보관함에 바로 생기고 덩어리 전부를 한 번에(동시에) 다듬는다', async () => {
    const token = await member();
    const profileId = await profile(token);
    await buy(token, 'report_saju_lifetime', { profileId });

    const list = await api('GET', '/reports', { token });
    expect(list.body).toHaveLength(1);
    // 예전에는 4개씩 차례로 보냈다 — 이제 한 번에 모두 보낸다(쉬운 말로 다시 쓴 뒤 약 1만 7천 자 → 7덩어리 안팎)
    const n = h.calls.length;
    expect(n).toBeGreaterThanOrEqual(6);
    expect(h.inFlight).toBe(n);

    // 처음 열기 — 기다리지 않고 규칙 기반 본문 + 진행률
    const t0 = Date.now();
    const first = await api('POST', '/reports', { token, body: { type: 'lifetime', profileId } });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(first.status).toBe(201);
    expect(first.body.id).toBe(list.body[0].id);
    expect(first.body).toMatchObject({ status: 'polishing', generator: 'rule', progress: { done: 0, total: n } });
    expect(first.body.sections.length).toBeGreaterThan(30);
    expect(first.body.sections.flatMap((s: DraftSection) => s.paragraphs).some((p: string) => p.startsWith('[AI]'))).toBe(false);

    settle(4);
    await vi.waitFor(async () => expect((await progressOf(token, first.body.id)).progress).toEqual({ done: 4, total: n }));

    // 다듬는 중에 다시 열어도 같은 리포트 — AI 를 다시 부르지 않는다
    const again = await api('POST', '/reports', { token, body: { type: 'lifetime', profileId } });
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.status).toBe('polishing');
    expect(h.calls).toHaveLength(n);

    settle();
    await vi.waitFor(async () => expect((await progressOf(token, first.body.id)).status).toBe('ready'));
    const done = await api('GET', `/reports/${first.body.id}`, { token });
    expect(done.body).toMatchObject({ status: 'ready', generator: 'ai', progress: null });
    expect(done.body.sections.map((s: DraftSection) => s.key)).toEqual(first.body.sections.map((s: DraftSection) => s.key));
    expect(done.body.sections.every((s: DraftSection) => s.paragraphs.every((p) => p.startsWith('[AI]')))).toBe(true);
    expect((await progressOf(token, first.body.id)).progress).toBeNull();
    expect((await api('GET', '/reports', { token })).body).toHaveLength(1);
  });

  it('실패한 덩어리만 규칙 기반으로 남고, 전부 실패하면 규칙 기반으로 마무리한다', async () => {
    const token = await member();
    const partly = await profile(token, '일부');
    await buy(token, 'report_saju_lifetime', { profileId: partly });
    const failedKeys = h.calls[0]!.part.map((s) => s.key);
    settle(1, 'reject');
    settle();
    const id = (await api('GET', '/reports', { token })).body[0].id;
    await vi.waitFor(async () => expect((await progressOf(token, id)).status).toBe('ready'));
    const r = (await api('GET', `/reports/${id}`, { token })).body;
    expect(r.generator).toBe('ai');
    for (const s of r.sections as DraftSection[]) expect(s.paragraphs[0]!.startsWith('[AI]')).toBe(!failedKeys.includes(s.key));

    h.auto = 'fail';
    const all = await profile(token, '전부');
    await buy(token, 'report_saju_lifetime', { profileId: all });
    const created = await api('POST', '/reports', { token, body: { type: 'lifetime', profileId: all } });
    await vi.waitFor(async () => expect((await progressOf(token, created.body.id)).status).toBe('ready'));
    const rule = (await api('GET', `/reports/${created.body.id}`, { token })).body;
    expect(rule).toMatchObject({ status: 'ready', generator: 'rule' });
    expect(rule.sections).toEqual(created.body.sections);
  });

  it('서버 재시작으로 끊긴 다듬기는 다음 열람 때 처음부터 다시 다듬는다', async () => {
    const token = await member();
    const profileId = await profile(token);
    await buy(token, 'report_saju_lifetime', { profileId });
    const id = (await api('GET', '/reports', { token })).body[0].id;
    const n = h.calls.length;
    expect(n).toBeGreaterThanOrEqual(6);
    // 다듬던 중 프로세스가 죽었다 — 먼저 띄운 서버의 호출은 끝나지 않고, 새 서버는 진행 기록이 없다
    const lost = h.calls.splice(0);
    const restarted = await buildApp({ config: app.ctx.config, db, logger: false });
    try {
      expect(db.select().from(reports).where(eq(reports.id, id)).get()!.generator).toBe('polishing');
      const reopened = await api('GET', `/reports/${id}`, { token, via: restarted });
      expect(reopened.body).toMatchObject({ status: 'polishing', progress: { done: 0, total: n } });
      expect(h.calls).toHaveLength(n);
      // 한 번 더 열어도 다시 시작하지 않는다
      await api('GET', `/reports/${id}/progress`, { token, via: restarted });
      expect(h.calls).toHaveLength(n);
      settle();
      await vi.waitFor(async () => expect((await api('GET', `/reports/${id}`, { token, via: restarted })).body).toMatchObject({ status: 'ready', generator: 'ai' }));
    } finally {
      lost.forEach((c) => c.resolve());
      await restarted.close();
    }
  });

  it('여러 리포트가 한꺼번에 다듬어져도 동시 호출은 16개까지만', async () => {
    const token = await member();
    const a = await profile(token, '가');
    const b = await profile(token, '나', { ...BIRTH, year: 1991 });
    const c = await profile(token, '다', { ...BIRTH, year: 1987 });
    await buy(token, 'report_saju_lifetime', { profileId: a });
    await buy(token, 'report_saju_lifetime', { profileId: b });
    await buy(token, 'report_saju_lifetime', { profileId: c });
    expect(h.inFlight).toBe(16);
    expect(h.calls).toHaveLength(16);
    // 세 리포트의 덩어리 수 합(본문 길이에 따라 6~8개씩) — 16을 넘는 만큼은 자리가 날 때까지 기다린다
    const ids = (await api('GET', '/reports', { token })).body.map((r: { id: string }) => r.id);
    let total = 0;
    for (const id of ids) total += (await progressOf(token, id)).progress!.total;
    expect(total).toBeGreaterThan(16);
    settle();
    // 자리가 나면 남은 덩어리가 이어서 나간다
    await vi.waitFor(() => expect(h.calls).toHaveLength(total));
    settle();
    for (const id of ids) await vi.waitFor(async () => expect((await progressOf(token, id)).status).toBe('ready'));
  });
});

describe('주제별 리포트(연애·결혼운 · 재물·직업운) — 같은 방식으로 미리 만들고 다듬는다', () => {
  it('결제 확정 → 규칙 기반 본문을 바로 저장하고, 덩어리 단위 진행률과 함께 AI 가 다듬는다', async () => {
    const token = await member();
    const profileId = await profile(token);
    await buy(token, 'report_love', { profileId });
    const [saved] = (await api('GET', '/reports', { token })).body;
    expect(saved.type).toBe('love');
    // 약 1만 자 → 3,500자 덩어리 몇 개를 한 번에 보낸다
    const chunks = h.calls.length;
    expect(chunks).toBeGreaterThanOrEqual(2);
    expect(chunks).toBeLessThanOrEqual(5);

    const first = await api('POST', '/reports', { token, body: { type: 'love', profileId } });
    expect(first.body).toMatchObject({ id: saved.id, status: 'polishing', generator: 'rule', progress: { done: 0, total: chunks } });
    settle(1);
    await vi.waitFor(async () => expect((await progressOf(token, saved.id)).progress).toEqual({ done: 1, total: chunks }));
    settle();
    await vi.waitFor(async () => expect((await progressOf(token, saved.id)).status).toBe('ready'));
    const done = (await api('GET', `/reports/${saved.id}`, { token })).body;
    expect(done.generator).toBe('ai');
    expect(done.sections.map((s: DraftSection) => s.key)).toEqual(first.body.sections.map((s: DraftSection) => s.key));
    expect(done.sections.every((s: DraftSection) => s.paragraphs.every((p) => p.startsWith('[AI]')))).toBe(true);

    // 재물·직업운은 따로 산다 — 연애·결혼운 권한으로는 열리지 않는다
    expect((await api('POST', '/reports', { token, body: { type: 'career_wealth', profileId } })).status).toBe(402);
    h.auto = true;
    await buy(token, 'report_career_wealth', { profileId });
    const types = (await api('GET', '/reports', { token })).body.map((r: { type: string }) => r.type).sort();
    expect(types).toEqual(['career_wealth', 'love']);
  });
});

describe('신년 패키지 · 궁합 1회권', () => {
  it('패키지 결제 → 분석서·신년운세를 미리 만들고, 1회권은 대상이 정해질 때 한 번만 쓴다', async () => {
    h.auto = true;
    const token = await member();
    const me = await profile(token);
    const partner = await profile(token, '지은', { ...BIRTH, year: 1992, month: 8, day: 21, gender: 'female' });
    await buy(token, 'bundle_newyear_2027', { profileId: me });
    const types = (await api('GET', '/reports', { token })).body.map((r: { type: string }) => r.type).sort();
    expect(types).toEqual(['lifetime', 'yearly']);

    // 두 번 눌러도(동시에 열어도) 리포트 하나, 1회권 한 장
    const [r1, r2] = await Promise.all([
      api('POST', '/reports', { token, body: { type: 'compatibility', profileId: me, partnerProfileId: partner } }),
      api('POST', '/reports', { token, body: { type: 'compatibility', profileId: me, partnerProfileId: partner } }),
    ]);
    expect(r1.status).toBe(201);
    expect(r2.body.id).toBe(r1.body.id);
    const wallet = (await api('GET', '/wallet', { token })).body;
    const keys = wallet.entitlements.map((e: { key: string }) => e.key);
    expect(keys.filter((k: string) => k.startsWith('ticket:compatibility:'))).toHaveLength(0);
    expect(keys.filter((k: string) => k.startsWith('report:compatibility:'))).toHaveLength(1);
    await vi.waitFor(async () => expect((await progressOf(token, r1.body.id)).status).toBe('ready'));
  });

  it('궁합 단건 결제 → 주문의 두 사람 순서대로 미리 만든다', async () => {
    h.auto = true;
    const token = await member();
    const me = await profile(token);
    const partner = await profile(token, '지은', { ...BIRTH, year: 1992, month: 8, day: 21, gender: 'female' });
    await buy(token, 'report_compat', { profileId: me, partnerProfileId: partner });
    const list = (await api('GET', '/reports', { token })).body;
    expect(list).toHaveLength(1);
    const opened = await api('POST', '/reports', { token, body: { type: 'compatibility', profileId: me, partnerProfileId: partner } });
    expect(opened.body.id).toBe(list[0].id);
  });
});
