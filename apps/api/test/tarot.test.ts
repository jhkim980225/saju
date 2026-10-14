import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { seedProducts } from '../src/db/seed.js';
import { DECK } from '../src/modules/tarot/content/index.js';
import { DECK_SIZE, dailyCard, drawAt, issueDeckToken, readDeckToken, shuffledDeck } from '../src/modules/tarot/deck.js';
import { buildTarotReading, cardElement } from '../src/modules/tarot/reading.js';
import { questionKey } from '../src/modules/tarot/service.js';

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

const api = async (method: 'GET' | 'POST' | 'DELETE', url: string, opts: { token?: string; body?: unknown } = {}) => {
  const res = await app.inject({
    method,
    url: `/api/v1${url}`,
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null };
};

describe('덱', () => {
  it('78장 — 메이저 22 + 마이너 56, id 중복 없음, 문안이 모두 채워져 있다', () => {
    expect(DECK).toHaveLength(78);
    expect(new Set(DECK.map((c) => c.id)).size).toBe(78);
    expect(DECK.filter((c) => c.arcana === 'major')).toHaveLength(22);
    for (const c of DECK) for (const o of [c.upright, c.reversed]) for (const f of ['summary', 'general', 'love', 'feelings', 'career', 'money', 'advice'] as const) expect(o[f].length, `${c.id} ${f}`).toBeGreaterThan(10);
  });

  it('셔플은 78장 순열이고, 같은 시드·같은 자리는 언제나 같은 카드', () => {
    const seed = Buffer.alloc(16, 7);
    const deck = shuffledDeck(seed);
    expect(new Set(deck.map((d) => d.index)).size).toBe(DECK_SIZE);
    expect(drawAt(seed, [3, 40, 77])).toEqual([deck[3], deck[40], deck[77]]);
    expect(drawAt(seed, [3, 40, 77])).toEqual(drawAt(Buffer.alloc(16, 7), [3, 40, 77]));
    expect(shuffledDeck(Buffer.alloc(16, 8)).map((d) => d.index)).not.toEqual(deck.map((d) => d.index));
  });

  it('역방향 비율은 대략 35%', () => {
    let reversed = 0;
    for (let i = 0; i < 200; i++) reversed += shuffledDeck(Buffer.from(String(i).padStart(16, '0'))).filter((d) => d.orientation === 'reversed').length;
    expect(reversed / (200 * 78)).toBeGreaterThan(0.3);
    expect(reversed / (200 * 78)).toBeLessThan(0.4);
  });

  it('오늘의 카드는 사람·날짜마다 고정', () => {
    expect(dailyCard('u1', '2026-10-12')).toEqual(dailyCard('u1', '2026-10-12'));
    const days = new Set(Array.from({ length: 10 }, (_, i) => dailyCard('u1', `2026-10-${10 + i}`).index));
    expect(days.size).toBeGreaterThan(3);
  });

  it('덱 토큰 — 위조·다른 계정·만료는 거부', () => {
    const now = Date.now();
    const { token } = issueDeckToken('secret', 'user-a', now);
    expect(readDeckToken('secret', 'user-a', token, now)).toHaveLength(16);
    expect(readDeckToken('secret', 'user-b', token, now)).toBeNull();
    expect(readDeckToken('other-secret', 'user-a', token, now)).toBeNull();
    expect(readDeckToken('secret', 'user-a', token, now + 31 * 60_000)).toBeNull();
    const [s, e, sig] = token.split('.');
    expect(readDeckToken('secret', 'user-a', `${s}.${Number(e) + 1}.${sig}`, now)).toBeNull();
  });

  it('같은 질문 판정 — 띄어쓰기·끝 문장부호 차이는 같은 질문', () => {
    expect(questionKey('three', 'love', ' 그 사람  연락 올까요?? ')).toBe(questionKey('three', 'love', '그 사람 연락 올까요'));
    expect(questionKey('three', 'love', '연락 올까요')).not.toBe(questionKey('three', 'career', '연락 올까요'));
  });

  it('원소 연결 — 완드 木, 컵 水, 소드 金, 펜타클 土, 메이저는 카드별', () => {
    expect(cardElement(DECK.find((c) => c.id === 'wands-01')!)).toBe('wood');
    expect(cardElement(DECK.find((c) => c.id === 'cups-01')!)).toBe('water');
    expect(cardElement(DECK.find((c) => c.id === 'swords-01')!)).toBe('metal');
    expect(cardElement(DECK.find((c) => c.id === 'pentacles-01')!)).toBe('earth');
    expect(cardElement(DECK.find((c) => c.id === 'major-16')!)).toBe('fire'); // 탑 = 화성(火星)
    expect(cardElement(DECK.find((c) => c.id === 'major-10')!)).toBe('wood'); // 운명의 수레바퀴 = 목성(木星)
  });

  it('잠긴 리딩은 유료 섹션의 첫 문단 미리보기만 담는다', () => {
    const r = buildTarotReading({ id: 'x', spread: 'three', topic: 'love', drawn: [{ index: 0, orientation: 'upright' }, { index: 30, orientation: 'reversed' }, { index: 60, orientation: 'upright' }], chart: null, unlocked: false });
    const overview = r.sections.find((s) => s.key === 'overview')!;
    expect(overview.locked).toBeUndefined();
    for (const s of r.sections.filter((x) => x.key !== 'overview')) {
      expect(s.locked).toBe(true);
      expect(s.paragraphs).toHaveLength(1);
    }
    const open = buildTarotReading({ id: 'x', spread: 'three', topic: 'love', drawn: [{ index: 0, orientation: 'upright' }, { index: 30, orientation: 'reversed' }, { index: 60, orientation: 'upright' }], chart: null, unlocked: true });
    expect(open.sections.every((s) => !s.locked)).toBe(true);
    expect(open.cards.map((c) => c.position.key)).toEqual(['situation', 'flow', 'advice']);
  });
});

describe('타로 API', () => {
  let guest: string;
  let profileId: string;

  beforeAll(async () => {
    guest = (await api('POST', '/auth/guest', { body: { deviceId: 'tarot-device-0001' } })).body.accessToken;
    profileId = (await api('POST', '/profiles', { token: guest, body: { name: '민수', relation: 'self', birth: BIRTH } })).body.id;
  });

  const draw = async (token: string, body: Record<string, unknown>) => {
    const s = await api('POST', '/tarot/shuffle', { token, body: { spread: body.spread, topic: body.topic, question: body.question } });
    expect(s.status).toBe(200);
    return { shuffle: s.body, res: await api('POST', '/tarot/readings', { token, body: { deckToken: s.body.deckToken, ...body } }) };
  };

  it('로그인(게스트 포함)이 필요하다', async () => {
    expect((await api('GET', '/tarot/daily')).status).toBe(401);
  });

  it('오늘의 카드 — 무료, 같은 날 다시 열어도 같은 카드, 사주 결합 근거 포함', async () => {
    const a = await api('GET', '/tarot/daily', { token: guest });
    expect(a.status).toBe(200);
    expect(a.body.spread).toBe('daily');
    expect(a.body.locked).toBe(false);
    expect(a.body.cards).toHaveLength(1);
    expect(a.body.cards[0].image).toMatch(/^\/tarot\/cards\/[a-z]+-\d{2}\.webp$/);
    expect(a.body.basis).toContain('일간 庚金');
    const b = await api('GET', '/tarot/daily', { token: guest });
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.cards[0].id).toBe(a.body.cards[0].id);
  });

  it('질문 3장 — 카드·총평 첫 문단은 무료, 자리별 풀이는 잠김', async () => {
    const { res } = await draw(guest, { spread: 'three', topic: 'career', question: '이직해도 될까요?', picks: [5, 33, 70] });
    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(3);
    expect(res.body.locked).toBe(true);
    expect(res.body.productId).toBe('tarot_question_3');
    expect(res.body.sections.find((s: any) => s.key === 'overview').locked).toBeUndefined();
    expect(res.body.sections.find((s: any) => s.key === 'pos-situation').locked).toBe(true);
    expect(res.body.sections.find((s: any) => s.key === 'saju').summary).toContain('달빛사주 방식');
  });

  it('같은 날 같은 질문은 다시 뽑지 않는다 (셔플 단계 안내 + 409)', async () => {
    const first = await draw(guest, { spread: 'three', topic: 'money', question: '이번 달 돈 관리', picks: [1, 2, 3] });
    expect(first.res.status).toBe(200);
    const again = await draw(guest, { spread: 'three', topic: 'money', question: '이번 달   돈 관리?', picks: [10, 20, 30] });
    expect(again.shuffle.existingReadingId).toBe(first.res.body.id);
    expect(again.res.status).toBe(409);
    expect(again.res.body.error.details.readingId).toBe(first.res.body.id);
  });

  it('덱 토큰은 한 번만, 장수·주제 불일치는 400', async () => {
    const s = await api('POST', '/tarot/shuffle', { token: guest, body: { spread: 'three', topic: 'self', question: '요즘 내 마음' } });
    const ok = await api('POST', '/tarot/readings', { token: guest, body: { deckToken: s.body.deckToken, spread: 'three', topic: 'self', question: '요즘 내 마음', picks: [0, 1, 2] } });
    expect(ok.status).toBe(200);
    const reuse = await api('POST', '/tarot/readings', { token: guest, body: { deckToken: s.body.deckToken, spread: 'three', topic: 'self', question: '다른 질문', picks: [0, 1, 2] } });
    expect(reuse.status).toBe(409);
    const s2 = await api('POST', '/tarot/shuffle', { token: guest, body: { spread: 'three', topic: 'love' } });
    expect((await api('POST', '/tarot/readings', { token: guest, body: { deckToken: s2.body.deckToken, spread: 'three', topic: 'love', picks: [0, 1] } })).status).toBe(400);
    expect((await api('POST', '/tarot/readings', { token: guest, body: { deckToken: s2.body.deckToken, spread: 'three', topic: 'love', picks: [4, 4, 5] } })).status).toBe(400);
    expect((await api('POST', '/tarot/shuffle', { token: guest, body: { spread: 'three', topic: 'feelings' } })).status).toBe(400);
  });

  it('다른 사람의 리딩은 볼 수 없다', async () => {
    const { res } = await draw(guest, { spread: 'feelings5', topic: 'feelings', picks: [7, 8, 9, 10, 11] });
    const other = (await api('POST', '/auth/guest', { body: { deviceId: 'tarot-device-0002' } })).body.accessToken;
    expect((await api('GET', `/tarot/readings/${res.body.id}`, { token: other })).status).toBe(404);
  });

  it('연애 5장 — 첫 자리만 무료, 구매하면 전부 열리고 질문권 1회 지급', async () => {
    const { res } = await draw(guest, { spread: 'reunion5', topic: 'reunion', question: '다시 연락해도 될까', picks: [12, 13, 14, 15, 16] });
    expect(res.status).toBe(200);
    const pos = res.body.sections.filter((s: any) => s.key.startsWith('pos-'));
    expect(pos[0].locked).toBeUndefined();
    expect(pos.slice(1).every((s: any) => s.locked)).toBe(true);

    // 비회원은 구매 전 로그인
    expect((await api('POST', '/orders', { token: guest, body: { productId: 'tarot_love_5', readingId: res.body.id } })).status).toBe(403);
    const signup = await api('POST', '/auth/signup', { token: guest, body: { email: 'tarot@example.com', password: 'password123', nickname: '민수' } });
    expect(signup.status).toBe(201);
    const token = signup.body.accessToken;

    // 리딩 없이·다른 상품으로는 주문 불가
    expect((await api('POST', '/orders', { token, body: { productId: 'tarot_love_5' } })).status).toBe(400);
    expect((await api('POST', '/orders', { token, body: { productId: 'tarot_question_3', readingId: res.body.id } })).status).toBe(400);

    const o = await api('POST', '/orders', { token, body: { productId: 'tarot_love_5', readingId: res.body.id } });
    expect(o.status).toBe(201);
    const c = await api('POST', '/payments/confirm', { token, body: { provider: 'mock', orderId: o.body.order.id, amount: 2900, paymentKey: 'mock_tarot_1' } });
    expect(c.status).toBe(200);
    expect(c.body.granted.entitlements).toEqual([`tarot:reading:${res.body.id}`]);
    expect(c.body.granted.credits).toBe(1);

    const opened = await api('GET', `/tarot/readings/${res.body.id}`, { token });
    expect(opened.body.locked).toBe(false);
    expect(opened.body.sections.every((s: any) => !s.locked)).toBe(true);
    expect(opened.body.cards.map((x: any) => x.id)).toEqual(res.body.cards.map((x: any) => x.id));
  });

  it('기록 — 최신순, 카드 이미지·잠금 상태 포함, 삭제 가능', async () => {
    const token = (await api('POST', '/auth/login', { body: { email: 'tarot@example.com', password: 'password123' } })).body.accessToken;
    const h = await api('GET', '/tarot/readings', { token });
    expect(h.status).toBe(200);
    expect(h.body.length).toBeGreaterThanOrEqual(5);
    expect(h.body[0].cards[0].image).toMatch(/\.webp$/);
    const target = h.body.find((x: any) => x.spread === 'three');
    expect((await api('DELETE', `/tarot/readings/${target.id}`, { token })).status).toBe(204);
    expect((await api('GET', `/tarot/readings/${target.id}`, { token })).status).toBe(404);
  });

  it('상품 목록에 타로 상품이 리딩 필요 상품으로 나온다', async () => {
    const p = await api('GET', '/products');
    const t = p.body.find((x: any) => x.id === 'tarot_question_3');
    expect(t.price).toBe(990);
    expect(t.requiresReading).toBe(true);
    expect(t.requiresProfile).toBe(false);
    expect(profileId).toBeTruthy();
  });
});
