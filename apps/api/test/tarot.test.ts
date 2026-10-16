import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { seedProducts } from '../src/db/seed.js';
import { calculateSaju } from '@saju/core';
import { TAROT_DRAW_SPREADS, TAROT_SPREADS, TAROT_SPREAD_TOPICS, TAROT_TOPICS, TAROT_YESNO_DAILY_FREE } from '@saju/shared';
import { CATALOG } from '../src/modules/commerce/catalog.js';
import { DECK } from '../src/modules/tarot/content/index.js';
import { DECK_SIZE, dailyCard, drawAt, issueDeckToken, readDeckToken, shuffledDeck } from '../src/modules/tarot/deck.js';
import { buildTarotReading, cardElement } from '../src/modules/tarot/reading.js';
import { questionKey } from '../src/modules/tarot/service.js';
import { YES_NO_LABEL, yesNoLean } from '../src/modules/tarot/yesno.js';

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
    // 잠긴 사주 섹션은 쉬운 말 결론만 — 용어 근거(basis)는 열린 뒤에만
    const lockedSaju = res.body.sections.find((s: any) => s.key === 'saju');
    expect(lockedSaju.summary).toMatch(/카드예요$/);
    expect(lockedSaju.basis).toBeUndefined();
    expect(res.body.basis).toContain('달빛사주 방식');
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

// ── 2차 펼침 방식: 예·아니오 · 양자택일 · 궁합 타로 · 켈틱 크로스 ──────────────

/** docs/API.md '예·아니오 기울기 표'와 같은 내용 — 카드 문안(content yesNo)을 고치면 문서와 이 표도 함께 고친다 */
const YES_NO_TABLE = {
  /** 정방향 — 나머지 51장은 예 */
  upright: {
    maybe: ['여사제', '은둔자', '정의', '매달린 사람', '죽음', '달', '완드 5', '완드 10', '컵 4', '컵 7', '소드 2', '소드 4', '소드 페이지', '펜타클 2', '펜타클 4', '펜타클 7'],
    no: ['악마', '탑', '컵 5', '컵 8', '소드 3', '소드 5', '소드 7', '소드 8', '소드 9', '소드 10', '펜타클 5'],
  },
  /** 역방향 — 나머지 51장은 조건부 */
  reversed: {
    yes: ['완드 5', '컵 4', '컵 7', '소드 8'],
    no: ['바보', '마법사', '여사제', '황제', '연인', '전차', '은둔자', '운명의 수레바퀴', '정의', '매달린 사람', '죽음', '완드 7', '완드 나이트', '컵 에이스', '소드 에이스', '소드 페이지', '소드 나이트', '소드 퀸', '소드 킹', '펜타클 2', '펜타클 7', '펜타클 나이트', '펜타클 킹'],
  },
};

describe('2차 펼침 방식 정의', () => {
  it('장수·자리·상품 — 예·아니오 1(무료) · 양자택일 3 · 궁합 5 · 켈틱 10', () => {
    expect(TAROT_DRAW_SPREADS).toEqual(expect.arrayContaining(['yesno', 'choice', 'compat', 'celtic']));
    const keys = (s: keyof typeof TAROT_SPREADS) => TAROT_SPREADS[s].positions.map((p) => p.key);
    expect(TAROT_SPREADS.yesno.cards).toBe(1);
    expect(TAROT_SPREADS.yesno.productId).toBeNull();
    expect(TAROT_SPREADS.choice.cards).toBe(3);
    expect(keys('choice')).toEqual(['now', 'optionA', 'optionB']);
    expect(TAROT_SPREADS.compat.cards).toBe(5);
    expect(keys('compat')).toEqual(['me', 'partner', 'bond', 'friction', 'together']);
    expect(TAROT_SPREADS.celtic.cards).toBe(10);
    expect(keys('celtic')).toEqual(['present', 'cross', 'root', 'past', 'goal', 'near', 'attitude', 'surroundings', 'hopes', 'outcome']);
    for (const s of Object.keys(TAROT_SPREADS) as (keyof typeof TAROT_SPREADS)[]) expect(TAROT_SPREADS[s].positions, s).toHaveLength(TAROT_SPREADS[s].cards);
    // 펼침 방식이 곧 주제 — 주제 ↔ 펼침이 1:1
    for (const t of TAROT_SPREAD_TOPICS) expect(TAROT_TOPICS[t].spread).toBe(t);
  });

  it('카탈로그 — 990 / 2,900 / 4,900원, 리딩 1건을 여는 권한, kr.dalbitsaju.* 상품 ID', () => {
    const byId = (id: string) => CATALOG.find((c) => c.id === id)!;
    expect(byId('tarot_choice_3')).toMatchObject({ price: 990, credits: 1, grants: ['tarot:reading'], iosProductId: 'kr.dalbitsaju.tarot.choice3', androidProductId: 'tarot_choice_3', type: 'one_time' });
    expect(byId('tarot_compat_5')).toMatchObject({ price: 2900, credits: 1, grants: ['tarot:reading'], iosProductId: 'kr.dalbitsaju.tarot.compat5', androidProductId: 'tarot_compat_5', type: 'one_time' });
    expect(byId('tarot_celtic_10')).toMatchObject({ price: 4900, credits: 3, grants: ['tarot:reading'], iosProductId: 'kr.dalbitsaju.tarot.celtic10', androidProductId: 'tarot_celtic_10', type: 'one_time' });
    expect(TAROT_SPREADS.choice.productId).toBe('tarot_choice_3');
    expect(TAROT_SPREADS.compat.productId).toBe('tarot_compat_5');
    expect(TAROT_SPREADS.celtic.productId).toBe('tarot_celtic_10');
    // 질문 3장과 같은 가격대
    expect(byId('tarot_choice_3').price).toBe(byId('tarot_question_3').price);
  });

  it('예·아니오 기울기 표 — 156칸이 문서 표와 같고, 정방향 51/16/11 · 역방향 4/51/23', () => {
    const count = { upright: { yes: 0, maybe: 0, no: 0 }, reversed: { yes: 0, maybe: 0, no: 0 } };
    DECK.forEach((c, i) => {
      const up = YES_NO_TABLE.upright.maybe.includes(c.nameKo) ? 'maybe' : YES_NO_TABLE.upright.no.includes(c.nameKo) ? 'no' : 'yes';
      const rev = YES_NO_TABLE.reversed.yes.includes(c.nameKo) ? 'yes' : YES_NO_TABLE.reversed.no.includes(c.nameKo) ? 'no' : 'maybe';
      expect(yesNoLean(i, 'upright'), `${c.nameKo} 정방향`).toBe(up);
      expect(yesNoLean(i, 'reversed'), `${c.nameKo} 역방향`).toBe(rev);
      count.upright[up]++;
      count.reversed[rev]++;
    });
    expect(count).toEqual({ upright: { yes: 51, maybe: 16, no: 11 }, reversed: { yes: 4, maybe: 51, no: 23 } });
    // 표에 적은 이름이 실제 카드 이름과 맞는지 (오타로 '나머지'에 섞이지 않게)
    for (const name of [...YES_NO_TABLE.upright.maybe, ...YES_NO_TABLE.upright.no, ...YES_NO_TABLE.reversed.yes, ...YES_NO_TABLE.reversed.no]) expect(DECK.some((c) => c.nameKo === name), name).toBe(true);
    expect(YES_NO_LABEL.maybe).toContain('조건부');
  });

  it('예·아니오 리딩 — 전부 무료, 기울기·조건 문장, 큰 YES/NO 대신 경향', () => {
    const sun = DECK.findIndex((c) => c.id === 'major-19');
    const moon = DECK.findIndex((c) => c.id === 'major-18');
    const tower = DECK.findIndex((c) => c.id === 'major-16');
    const yes = buildTarotReading({ id: 'y', spread: 'yesno', topic: 'yesno', drawn: [{ index: sun, orientation: 'upright' }], chart: null, unlocked: true });
    expect(yes.lean).toBe('yes');
    expect(yes.sections.every((s) => !s.locked)).toBe(true);
    expect(yes.sections[0]).toMatchObject({ key: 'lean', summary: YES_NO_LABEL.yes });
    const maybe = buildTarotReading({ id: 'm', spread: 'yesno', topic: 'yesno', drawn: [{ index: moon, orientation: 'upright' }], chart: calculateSaju(BIRTH), unlocked: true });
    expect(maybe.lean).toBe('maybe');
    expect(maybe.sections[0]!.paragraphs[1]).toMatch(/^조건 — /);
    expect(maybe.sections.find((s) => s.key === 'saju')!.paragraphs.join(' ')).toContain('이번에 뽑은 달 카드는');
    expect(maybe.sections.find((s) => s.key === 'saju')!.basis).toMatch(/^일간 .+ · 용신 .+ · 카드 원소 달=/);
    const no = buildTarotReading({ id: 'n', spread: 'yesno', topic: 'yesno', drawn: [{ index: tower, orientation: 'upright' }], chart: null, unlocked: true });
    expect(no.lean).toBe('no');
    expect(no.sections.map((s) => s.paragraphs.join(' ')).join(' ')).not.toMatch(/YES|NO|정답/);
  });

  it('양자택일 — 선택지가 자리 힌트에 들어가고, 한 줄·행동·이야기에서 어느 쪽도 정답으로 고르지 않는다', () => {
    const drawn = [{ index: 9, orientation: 'upright' as const }, { index: 19, orientation: 'upright' as const }, { index: 16, orientation: 'reversed' as const }];
    const r = buildTarotReading({ id: 'c', spread: 'choice', topic: 'choice', drawn, chart: calculateSaju(BIRTH), unlocked: true, options: { a: '지금 회사에 남기', b: '새 회사로 옮기기' } });
    expect(r.cards.map((c) => c.position.hint)).toEqual(['고민하는 나의 상태', '지금 회사에 남기 쪽의 흐름', '새 회사로 옮기기 쪽의 흐름']);
    // 한 줄은 '지금의 나' 카드 — 선택지 자리에 메이저 카드가 있어도 그 카드가 한 줄을 차지하지 않는다
    expect(r.headline).toBe(r.cards[0]!.meaning);
    const actions = r.sections.find((s) => s.key === 'actions')!.paragraphs;
    expect(actions).toHaveLength(3);
    expect(actions[1]).toMatch(/^A를 고른다면 — /);
    expect(actions[2]).toMatch(/^B를 고른다면 — /);
    const text = r.sections.map((s) => s.paragraphs.join(' ')).join(' ');
    expect(text).toContain('지금 회사에 남기');
    expect(text).toContain('새 회사로 옮기기');
    expect(text).not.toMatch(/정답(이에요|입니다)|추천해요|고르세요/);
    expect(r.sections.find((s) => s.key === 'saju')!.paragraphs.join(' ')).toContain("'지금의 나' 자리의");
    // 잠금 — 지금의 나 자리만 무료, 두 선택지 자리는 똑같이 잠긴다
    const locked = buildTarotReading({ id: 'c', spread: 'choice', topic: 'choice', drawn, chart: null, unlocked: false, options: { a: 'A안', b: 'B안' } });
    expect(locked.sections.find((s) => s.key === 'pos-now')!.locked).toBeUndefined();
    expect(locked.sections.find((s) => s.key === 'pos-optionA')!.locked).toBe(true);
    expect(locked.sections.find((s) => s.key === 'pos-optionB')!.locked).toBe(true);
  });

  it('궁합 타로 — 두 사람의 타고난 기운으로 쉽게 읽고, 일간·용신은 근거(basis)에만', () => {
    const me = { name: '민수', chart: calculateSaju(BIRTH) };
    const partner = { name: '지은', chart: calculateSaju({ ...BIRTH, year: 1992, month: 8, day: 20, gender: 'female' }) };
    const drawn = [3, 22, 40, 58, 70].map((index) => ({ index, orientation: 'upright' as const }));
    const r = buildTarotReading({ id: 'p', spread: 'compat', topic: 'compat', drawn, chart: me.chart, unlocked: true, people: { me, partner } });
    const saju = r.sections.find((s) => s.key === 'saju')!;
    expect(r.basis).toMatch(/^민수 일간 .+·용신 .+ · 지은 일간 .+·용신 .+ · 카드 원소/);
    expect(saju.basis).toBe(r.basis);
    expect(saju.paragraphs[0]).toMatch(/^사주로 보면 민수님은 .+의 기운을, 지은님은 .+의 기운을 타고났어요\./);
    expect(saju.paragraphs[1]).toMatch(/^'나의 마음' 자리의 .+ 민수님에게 .+이에요\.$/);
    expect(saju.paragraphs[2]).toMatch(/^'상대의 마음' 자리의 .+ 지은님에게 .+이에요\.$/);
    expect(saju.paragraphs[3]).toMatch(/민수님에게는 .+, 지은님에게는 .+이에요\./);
    expect(saju.paragraphs.join(' ')).toMatch(/받쳐 주는 사이예요|이끌고 다잡아 주는 사이예요|같은 기운을 타고나서/);
    expect(saju.paragraphs.join(' ')).not.toMatch(/일간|용신|[一-鿿]/);
    expect(r.sections[0]!.paragraphs[0]).toMatch(/^민수님과 지은님 사이를 다섯 장으로/);
    // 상대 자리는 '속마음' 문안, 함께 챙길 것은 '조언' 문안
    expect(DECK[22]!.upright.feelings.startsWith(r.cards[1]!.line)).toBe(true);
    expect(DECK[70]!.upright.advice.startsWith(r.cards[4]!.line)).toBe(true);
  });

  it('켈틱 크로스 — 10자리, 자리 풀이는 모두 깊은 풀이(첫 문단 미리보기), 이야기는 십자·기둥 순서', () => {
    const drawn = Array.from({ length: 10 }, (_, i) => ({ index: i * 7, orientation: i % 3 === 0 ? ('reversed' as const) : ('upright' as const) }));
    const locked = buildTarotReading({ id: 'k', spread: 'celtic', topic: 'celtic', drawn, chart: null, unlocked: false });
    expect(locked.cards).toHaveLength(10);
    expect(locked.sections.filter((s) => s.key.startsWith('pos-')).every((s) => s.locked)).toBe(true);
    expect(locked.sections.find((s) => s.key === 'overview')!.locked).toBeUndefined();
    const open = buildTarotReading({ id: 'k', spread: 'celtic', topic: 'celtic', drawn, chart: null, unlocked: true });
    const story = open.sections.find((s) => s.key === 'story')!.paragraphs;
    expect(story).toHaveLength(4);
    expect(story[0]).toContain('가로지르고 있어요');
    expect(story[3]).toMatch(/^흐름의 방향 자리의/);
  });
});

describe('2차 펼침 방식 API', () => {
  /** 셔플 → 뽑기. 셔플이 실패하면 그 응답을 그대로 돌려준다 */
  const draw = async (token: string, body: Record<string, unknown>) => {
    const { picks, profileId, ...shuffleBody } = body;
    const s = await api('POST', '/tarot/shuffle', { token, body: shuffleBody });
    if (s.status !== 200) return { shuffle: s, res: s };
    return { shuffle: s, res: await api('POST', '/tarot/readings', { token, body: { deckToken: s.body.deckToken, picks, profileId, ...shuffleBody } }) };
  };
  /** 목업 결제로 리딩 열기 */
  const buy = async (token: string, productId: string, readingId: string, amount: number) => {
    const o = await api('POST', '/orders', { token, body: { productId, readingId } });
    expect(o.status).toBe(201);
    expect(o.body.order.amount).toBe(amount);
    return api('POST', '/payments/confirm', { token, body: { provider: 'mock', orderId: o.body.order.id, amount, paymentKey: `mock_${o.body.order.id}` } });
  };

  let member: string;
  let meId: string;
  let partnerId: string;
  beforeAll(async () => {
    member = (await api('POST', '/auth/signup', { body: { email: 'tarot2@example.com', password: 'password123', nickname: '민수' } })).body.accessToken;
    meId = (await api('POST', '/profiles', { token: member, body: { name: '민수', relation: 'self', birth: BIRTH } })).body.id;
    partnerId = (await api('POST', '/profiles', { token: member, body: { name: '지은', relation: 'partner', birth: { ...BIRTH, year: 1992, month: 8, day: 20, gender: 'female' } } })).body.id;
  });

  it(`예·아니오 — 무료, 하루 ${TAROT_YESNO_DAILY_FREE}번. 같은 질문은 그 결과로, 새 질문은 429 + 오늘 본 리딩`, async () => {
    const guest = (await api('POST', '/auth/guest', { body: { deviceId: 'tarot-device-yesno' } })).body.accessToken;
    const first = await draw(guest, { spread: 'yesno', topic: 'yesno', question: '이번 주말에 먼저 연락해 볼까요?', picks: [42] });
    expect(first.res.status).toBe(200);
    expect(first.res.body).toMatchObject({ spread: 'yesno', locked: false, productId: null, generator: 'rule' });
    expect(['yes', 'no', 'maybe']).toContain(first.res.body.lean);
    expect(first.res.body.lean).toBe(first.res.body.cards[0].yesNo);
    expect(first.res.body.sections[0].key).toBe('lean');
    expect(first.res.body.sections.every((s: any) => !s.locked)).toBe(true);

    // 같은 질문 → 횟수와 상관없이 처음 결과로 안내
    const same = await api('POST', '/tarot/shuffle', { token: guest, body: { spread: 'yesno', topic: 'yesno', question: '이번 주말에  먼저 연락해 볼까요' } });
    expect(same.status).toBe(200);
    expect(same.body.existingReadingId).toBe(first.res.body.id);

    // 새 질문 → 셔플 단계에서 429, 오늘 본 리딩으로 안내
    const other = await api('POST', '/tarot/shuffle', { token: guest, body: { spread: 'yesno', topic: 'yesno', question: '모임에 나가 볼까요?' } });
    expect(other.status).toBe(429);
    expect(other.body.error.code).toBe('RATE_LIMITED');
    expect(other.body.error.details).toMatchObject({ readingId: first.res.body.id, limit: TAROT_YESNO_DAILY_FREE });

    // 새 질문을 셔플 없이(같은 질문 셔플로 받은 토큰으로) 바로 뽑으려 해도 429
    const sneak = await api('POST', '/tarot/readings', { token: guest, body: { deckToken: same.body.deckToken, spread: 'yesno', topic: 'yesno', question: '모임에 나가 볼까요?', picks: [7] } });
    expect(sneak.status).toBe(429);

    // 다른 사람·다른 펼침 방식에는 영향 없음
    const other2 = (await api('POST', '/auth/guest', { body: { deviceId: 'tarot-device-yesno-2' } })).body.accessToken;
    expect((await draw(other2, { spread: 'yesno', topic: 'yesno', question: '모임에 나가 볼까요?', picks: [1, 2] })).res.status).toBe(400);
    expect((await draw(other2, { spread: 'yesno', topic: 'yesno', question: '모임에 나가 볼까요?', picks: [1] })).res.status).toBe(200);
    expect((await draw(guest, { spread: 'three', topic: 'self', question: '요즘 내 마음', picks: [1, 2, 3] })).res.status).toBe(200);
  });

  it('양자택일 — 선택지 A·B 필수(20자), 같은 선택지 거부, 990원으로 열면 질문권 1회', async () => {
    expect((await api('POST', '/tarot/shuffle', { token: member, body: { spread: 'choice', topic: 'choice', optionA: '남기' } })).status).toBe(400);
    expect((await api('POST', '/tarot/shuffle', { token: member, body: { spread: 'choice', topic: 'choice', optionA: '남기', optionB: ' 남기 ' } })).status).toBe(400);
    expect((await api('POST', '/tarot/shuffle', { token: member, body: { spread: 'choice', topic: 'choice', optionA: '가'.repeat(21), optionB: '나' } })).status).toBe(400);
    expect((await api('POST', '/tarot/shuffle', { token: member, body: { spread: 'choice', topic: 'love', optionA: '가', optionB: '나' } })).status).toBe(400);

    const { res } = await draw(member, { spread: 'choice', topic: 'choice', question: '어느 쪽이 나을까요?', optionA: '지금 회사에 남기', optionB: '새 회사로 옮기기', picks: [3, 30, 60] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ spread: 'choice', productId: 'tarot_choice_3', locked: true, options: { a: '지금 회사에 남기', b: '새 회사로 옮기기' } });
    expect(res.body.cards.map((c: any) => c.position.key)).toEqual(['now', 'optionA', 'optionB']);
    expect(res.body.cards[1].position.hint).toBe('지금 회사에 남기 쪽의 흐름');
    expect(res.body.sections.find((s: any) => s.key === 'pos-now').locked).toBeUndefined();
    expect(res.body.sections.find((s: any) => s.key === 'pos-optionA').locked).toBe(true);
    expect(res.body.sections.find((s: any) => s.key === 'pos-optionB').locked).toBe(true);

    // 같은 질문이라도 선택지가 다르면 다른 질문
    const changed = await api('POST', '/tarot/shuffle', { token: member, body: { spread: 'choice', topic: 'choice', question: '어느 쪽이 나을까요?', optionA: '지금 회사에 남기', optionB: '프리랜서로 일하기' } });
    expect(changed.body.existingReadingId).toBeNull();
    const again = await api('POST', '/tarot/shuffle', { token: member, body: { spread: 'choice', topic: 'choice', question: '어느 쪽이 나을까요', optionA: '지금 회사에 남기', optionB: '새 회사로 옮기기' } });
    expect(again.body.existingReadingId).toBe(res.body.id);

    // 다른 펼침 방식 상품으로는 열 수 없다
    expect((await api('POST', '/orders', { token: member, body: { productId: 'tarot_question_3', readingId: res.body.id } })).status).toBe(400);
    const paid = await buy(member, 'tarot_choice_3', res.body.id, 990);
    expect(paid.status).toBe(200);
    expect(paid.body.granted).toMatchObject({ credits: 1, entitlements: [`tarot:reading:${res.body.id}`] });
    const opened = await api('GET', `/tarot/readings/${res.body.id}`, { token: member });
    expect(opened.body.locked).toBe(false);
    expect(opened.body.sections.every((s: any) => !s.locked)).toBe(true);
  });

  it('궁합 타로 — 상대 프로필 필수, 두 사람의 사주 근거, 2,900원', async () => {
    expect((await api('POST', '/tarot/shuffle', { token: member, body: { spread: 'compat', topic: 'compat' } })).status).toBe(400);
    expect((await api('POST', '/tarot/shuffle', { token: member, body: { spread: 'compat', topic: 'compat', partnerProfileId: 'nope' } })).status).toBe(400);
    // 나와 같은 사람은 안 된다
    expect((await draw(member, { spread: 'compat', topic: 'compat', partnerProfileId: meId, profileId: meId, picks: [1, 2, 3, 4, 5] })).res.status).toBe(400);

    const { res } = await draw(member, { spread: 'compat', topic: 'compat', question: '우리 잘 맞을까요?', partnerProfileId: partnerId, profileId: meId, picks: [10, 20, 30, 40, 50] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ spread: 'compat', productId: 'tarot_compat_5', locked: true, profileName: '민수', partnerName: '지은' });
    expect(res.body.cards).toHaveLength(5);
    expect(res.body.basis).toMatch(/민수 일간 .+ · 지은 일간 .+/);
    expect(res.body.sections.find((s: any) => s.key === 'pos-me').locked).toBeUndefined();
    expect(res.body.sections.find((s: any) => s.key === 'pos-partner').locked).toBe(true);

    const paid = await buy(member, 'tarot_compat_5', res.body.id, 2900);
    expect(paid.body.granted).toMatchObject({ credits: 1, entitlements: [`tarot:reading:${res.body.id}`] });
    const opened = await api('GET', `/tarot/readings/${res.body.id}`, { token: member });
    expect(opened.body.locked).toBe(false);
    const openedSaju = opened.body.sections.find((s: any) => s.key === 'saju');
    expect(openedSaju.paragraphs.join(' ')).toContain('지은님');
    expect(openedSaju.basis).toMatch(/지은 일간 .+·용신/);

    // 다른 계정의 프로필은 상대로 쓸 수 없다
    const stranger = (await api('POST', '/auth/guest', { body: { deviceId: 'tarot-device-compat' } })).body.accessToken;
    expect((await api('POST', '/tarot/shuffle', { token: stranger, body: { spread: 'compat', topic: 'compat', partnerProfileId: partnerId } })).status).toBe(400);
  });

  it('켈틱 크로스 — 10장, 4,900원으로 열면 질문권 3회, 기록에 잠금 해제로 남는다', async () => {
    expect((await draw(member, { spread: 'celtic', topic: 'celtic', question: '올해 이직', picks: [1, 2, 3] })).res.status).toBe(400);
    const { res } = await draw(member, { spread: 'celtic', topic: 'celtic', question: '올해 이직, 어떻게 준비할까요?', picks: [0, 7, 14, 21, 28, 35, 42, 49, 56, 63] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ spread: 'celtic', productId: 'tarot_celtic_10', locked: true });
    expect(res.body.cards).toHaveLength(10);
    expect(res.body.cards[1].position).toMatchObject({ key: 'cross', label: '가로막는 것' });
    expect(res.body.sections.filter((s: any) => s.key.startsWith('pos-')).every((s: any) => s.locked)).toBe(true);

    const before = (await api('GET', '/wallet', { token: member })).body.credits;
    const paid = await buy(member, 'tarot_celtic_10', res.body.id, 4900);
    expect(paid.body.granted).toMatchObject({ credits: 3, entitlements: [`tarot:reading:${res.body.id}`] });
    expect((await api('GET', '/wallet', { token: member })).body.credits).toBe(before + 3);
    const h = await api('GET', '/tarot/readings', { token: member });
    expect(h.body.find((x: any) => x.id === res.body.id)).toMatchObject({ spread: 'celtic', spreadName: '켈틱 크로스 10장', locked: false });
  });

  it('상품 목록에 새 타로 상품이 리딩 필요 상품으로 나온다', async () => {
    const p = await api('GET', '/products');
    for (const [id, price] of [['tarot_choice_3', 990], ['tarot_compat_5', 2900], ['tarot_celtic_10', 4900]] as const) {
      expect(p.body.find((x: any) => x.id === id), id).toMatchObject({ price, requiresReading: true, requiresProfile: false, purchasable: true });
    }
  });
});
