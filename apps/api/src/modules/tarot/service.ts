/**
 * 타로 — 셔플(덱 토큰) → 자리 고르기 → 리딩 저장 → 열람(권한에 따라 잠금) / 오늘의 카드 / 기록.
 *
 * - 같은 날 같은 질문(펼침·주제·질문 정규화)은 다시 뽑지 않고 기존 리딩으로 안내한다(결과 고정).
 *   양자택일은 선택지 A·B, 궁합 타로는 상대까지 같아야 같은 질문이다.
 * - 상세 리딩 권한: tarot:reading:<readingId> (구매) 또는 플러스 구독. 상품이 없는 펼침(오늘의 카드·예·아니오)은 전부 무료.
 * - 예·아니오는 무료 대신 하루 TAROT_YESNO_DAILY_FREE 회 — 넘으면 429 (details.readingId = 오늘 본 리딩).
 *   횟수 확인은 저장과 한 묶음(atomic guard)이라 서로 다른 질문을 동시에 보내도 하루 횟수를 넘지 않는다.
 * - 오늘 뽑은 리딩을 지우면 행을 지우지 않고 표지(questionKey = 'deleted:<해시>')로 바꾸고 내용(질문·카드·선택지·AI 문단)을 비운다.
 *   그래서 지운 뒤에도 하루 횟수와 같은 질문 판정은 그대로 남는다(지우고 다시 뽑아 새 카드를 보는 우회 차단). 지난날의 리딩과 표지는 바로 지운다.
 * - 사주 섹션은 리딩에 저장한 프로필(profileId)로만 만든다. 그 프로필이 지워졌거나 프로필 없이 뽑았으면 사주 섹션이 없다(그때의 대표 프로필로 바꾸지 않는다).
 * - AI 종합 문단은 유료 열람 시 1회만 만들고 저장한다. 실패하면 규칙 기반 문단을 보여 주고, 다시 열 때 재시도하되
 *   리딩당 AI_STORY_MAX_ATTEMPTS 번까지, 직전 시도 뒤 AI_STORY_RETRY_MS 가 지나야 한다(실패가 이어져도 비용이 계속 나지 않게).
 */
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, isNull, like, lt, lte, notLike, or, sql } from 'drizzle-orm';
import { calculateSaju, type BirthInput, type SajuChart } from '@saju/core';
import {
  ERROR_CODES,
  TAROT_SPREADS,
  TAROT_TOPICS,
  TAROT_YESNO_DAILY_FREE,
  type TarotDrawDto,
  type TarotHistoryItemDto,
  type TarotReadingDto,
  type TarotShuffleDto,
  type TarotShuffleResultDto,
  type TarotSpread,
  type TarotTopic,
} from '@saju/shared';
import type { AppConfig } from '../../config/env.js';
import { safeErrorText } from '../../lib/log.js';
import { atomic } from '../../db/atomic.js';
import { isUniqueViolation, type Db } from '../../db/client.js';
import { entitlements, tarotReadings, type TarotReading, type TarotSajuSnapshot } from '../../db/schema.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { AiService } from '../ai/service.js';
import type { CommerceService } from '../commerce/service.js';
import { profileToBirth, type ProfileService } from '../profiles/service.js';
import { todayInSeoul } from '../saju/routes.js';
import { DECK_SIZE, dailyCard, deckTokenFingerprint, drawAt, issueDeckToken, readDeckToken, type DrawnCard } from './deck.js';
import { TAROT_DISCLAIMER, buildTarotReading, cardDto, type TarotPerson } from './reading.js';

/** 사주를 함께 보는 사람 — 계산한 원국과 그 근거(이름·출생 정보) */
type Person = { chart: SajuChart; name: string; id: string; birth: BirthInput };

const pad = (n: number) => String(n).padStart(2, '0');
const todayKey = () => {
  const d = todayInSeoul();
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
};
const normalize = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/[\s?!.~…]+$/u, '').trim();
/** 다시 뽑기 방지 키 — 띄어쓰기·끝 문장부호·대소문자 차이는 같은 질문으로 본다. extra: 양자택일 선택지·궁합 상대 */
export function questionKey(spread: TarotSpread, topic: TarotTopic | null, question: string | null | undefined, extra?: string | null): string {
  return `${spread}|${topic ?? ''}|${normalize(question)}${extra ? `|${extra}` : ''}`;
}
export const tarotKey = (readingId: string) => `tarot:reading:${readingId}`;
/** AI 종합 문단 — 리딩 하나에 부르는 최대 횟수 */
export const AI_STORY_MAX_ATTEMPTS = 3;
/** AI 종합 문단 — 직전 시도(실패)에서 다음 시도까지 기다리는 시간. 시도를 맡는 동안의 담당 기한도 겸한다 */
export const AI_STORY_RETRY_MS = 10 * 60_000;
/** 상품이 없는 펼침 방식(오늘의 카드·예·아니오)은 전부 무료 */
const isFreeSpread = (spread: string) => !TAROT_SPREADS[spread as TarotSpread].productId;
/** 기록 목록에 기본으로 싣는 최근 리딩 수 — 구매한 리딩은 이보다 오래되어도 함께 싣는다 */
export const TAROT_HISTORY_RECENT = 100;
/** 지운 오늘 리딩의 표지 — 같은 질문 판정 키를 해시로 바꿔 질문 글은 남기지 않는다 */
const DELETED_PREFIX = 'deleted:';
export const deletedQuestionKey = (qKey: string) => `${DELETED_PREFIX}${createHash('sha256').update(qKey).digest('hex')}`;
const isDeleted = (r: Pick<TarotReading, 'questionKey'>) => r.questionKey.startsWith(DELETED_PREFIX);
const notDeleted = notLike(tarotReadings.questionKey, `${DELETED_PREFIX}%`);
const DELETED_TODAY_MESSAGE = '오늘 같은 질문으로 뽑은 기록을 지웠어요. 같은 질문은 내일 다시 볼 수 있어요.';
/** D1 은 문장 하나에 바인딩 값을 100개까지 받는다 — IN 목록을 나눠 묻는다 */
const IN_CHUNK = 90;

export function createTarotService(config: AppConfig, db: Db, profiles: ProfileService, commerce: CommerceService, ai: AiService) {
  const secret = `${config.JWT_ACCESS_SECRET}|tarot-deck`;
  const inflight = new Map<string, Promise<string[] | null>>();

  const unlocked = async (userId: string, r: TarotReading) => isFreeSpread(r.spread) || (await commerce.isPremium(userId)) || (await commerce.hasEntitlement(userId, tarotKey(r.id)));

  /**
   * 사주 결합용 원국.
   * - 뽑을 때(fallbackToPrimary=true): 지정 프로필, 지정하지 않았으면 대표 프로필. 지정 프로필이 내 것이 아니거나 지워졌으면 null
   * - 열람할 때(false): 리딩에 저장한 프로필만. 프로필 없이 뽑았거나 그 프로필이 지워졌으면 null(그때의 대표 프로필로 바꾸지 않는다)
   */
  const chartFor = async (userId: string, profileId: string | null, fallbackToPrimary: boolean): Promise<Person | null> => {
    try {
      const p = profileId ? await profiles.getOwned(userId, profileId) : fallbackToPrimary ? await profiles.primary(userId) : undefined;
      return p ? { chart: profiles.chartOf(p), name: p.name, id: p.id, birth: profileToBirth(p) } : null;
    } catch {
      return null;
    }
  };

  /** 궁합 타로 상대 — 대표 프로필로 대신하지 않는다. 지워졌으면 null */
  const partnerFor = async (userId: string, profileId: string | null | undefined): Promise<Person | null> => {
    if (!profileId) return null;
    try {
      const p = await profiles.getOwned(userId, profileId);
      return { chart: profiles.chartOf(p), name: p.name, id: p.id, birth: profileToBirth(p) };
    } catch {
      return null;
    }
  };

  /** 리딩에 저장할 사주 — 뽑을 때의 이름·출생 정보 */
  const snapshotOf = (owner: Person | null, partner: Person | null): TarotSajuSnapshot => ({
    owner: owner ? { id: owner.id, name: owner.name, birth: owner.birth } : null,
    partner: partner ? { id: partner.id, name: partner.name, birth: partner.birth } : null,
  });

  /**
   * 열람할 때의 사람 — 프로필이 아직 있으면 뽑을 때 저장한 사주(스냅샷)로 계산해, 나중에 프로필을 고쳐도 산 리딩이 바뀌지 않게 한다.
   * 프로필이 지워졌으면 null(지울 때 스냅샷도 비운다). 스냅샷이 없는 이전 리딩은 지금 프로필로 계산한다
   */
  const personAt = async (live: Person | null, saved: TarotSajuSnapshot['owner'] | undefined): Promise<Person | null> => {
    if (!live) return null;
    if (!saved || saved.id !== live.id) return live;
    try {
      return { chart: calculateSaju(saved.birth), name: saved.name, id: saved.id, birth: saved.birth };
    } catch {
      return live;
    }
  };

  /** 오늘 같은 질문의 리딩 — 지운 표지도 찾는다(isDeleted 로 구분) */
  const existing = async (userId: string, dateKey: string, qKey: string) =>
    (
      await db
        .select()
        .from(tarotReadings)
        .where(and(eq(tarotReadings.userId, userId), eq(tarotReadings.dateKey, dateKey), inArray(tarotReadings.questionKey, [qKey, deletedQuestionKey(qKey)])))
    )[0];
  /** 같은 질문으로 다시 뽑으려 할 때 — 남아 있으면 그 리딩으로 안내, 지웠으면 내일 다시 보라는 409 */
  const alreadyDrawn = (prev: TarotReading) =>
    isDeleted(prev) ? conflict(DELETED_TODAY_MESSAGE, { reason: 'DELETED_TODAY' }) : conflict('오늘 같은 질문으로 이미 카드를 뽑았어요. 앞서 뽑은 결과를 보여 드릴게요.', { readingId: prev.id });

  /**
   * 펼침 방식별 추가 입력 — 양자택일 선택지 A·B(서로 달라야 함), 궁합 타로 상대(내 프로필 중 하나).
   * extra 는 같은 질문 판정 키에 붙는다.
   */
  const extrasOf = async (userId: string, dto: TarotShuffleDto): Promise<{ options: { a: string; b: string } | null; partner: Awaited<ReturnType<typeof partnerFor>>; extra: string | null }> => {
    if (TAROT_TOPICS[dto.topic].spread !== dto.spread) throw badRequest('이 주제에 맞지 않는 펼침 방식이에요.');
    // 예·아니오는 질문이 있어야 기울기를 읽을 수 있다 — 화면뿐 아니라 서버에서도 받지 않는다
    if (dto.spread === 'yesno' && !dto.question?.trim()) throw badRequest('예·아니오로 물어볼 질문을 적어 주세요.');
    if (dto.spread === 'choice') {
      const a = dto.optionA?.trim();
      const b = dto.optionB?.trim();
      if (!a || !b) throw badRequest('두 선택지를 모두 적어 주세요.');
      if (normalize(a) === normalize(b)) throw badRequest('서로 다른 두 선택지를 적어 주세요.');
      return { options: { a, b }, partner: null, extra: `${normalize(a)}|${normalize(b)}` };
    }
    if (dto.spread === 'compat') {
      if (!dto.partnerProfileId) throw badRequest('함께 볼 상대를 골라 주세요.');
      const partner = await partnerFor(userId, dto.partnerProfileId);
      if (!partner) throw badRequest('함께 볼 상대의 사주를 다시 골라 주세요.');
      return { options: null, partner, extra: partner.id };
    }
    return { options: null, partner: null, extra: null };
  };

  /** 오늘 뽑은 예·아니오(지운 표지 포함) — 하루 횟수 조건 */
  const yesNoToday = (userId: string, dateKey: string) => and(eq(tarotReadings.userId, userId), eq(tarotReadings.dateKey, dateKey), eq(tarotReadings.spread, 'yesno'));
  /** 예·아니오 하루 무료 횟수 — 지운 리딩도 센다. 넘으면 429, 오늘 마지막으로 본(지우지 않은) 리딩으로 안내 */
  const assertYesNoQuota = async (userId: string, dateKey: string) => {
    const used = await db
      .select({ id: tarotReadings.id, questionKey: tarotReadings.questionKey })
      .from(tarotReadings)
      .where(yesNoToday(userId, dateKey))
      .orderBy(desc(tarotReadings.createdAt), desc(tarotReadings.id));
    if (used.length >= TAROT_YESNO_DAILY_FREE) {
      const last = used.find((r) => !isDeleted(r));
      throw new AppError(429, ERROR_CODES.RATE_LIMITED, `예·아니오 카드는 하루 ${TAROT_YESNO_DAILY_FREE}번까지 무료로 볼 수 있어요. 내일 다시 이용해 주세요.`, {
        ...(last ? { readingId: last.id } : {}),
        limit: TAROT_YESNO_DAILY_FREE,
      });
    }
  };

  /**
   * AI 종합 문단 — 열람 권한이 있을 때 한 번만 만들고 저장 (무료 펼침은 규칙 기반만).
   * 부르기 전에 조건부 갱신으로 시도를 맡는다(횟수 +1, 다음 시도 시각을 뒤로) — 여러 인스턴스에서 동시에 열어도 한 곳만 부르고,
   * 실패가 이어져도 AI_STORY_MAX_ATTEMPTS 번·AI_STORY_RETRY_MS 간격을 넘겨 부르지 않는다. 맡지 못하면 null(규칙 기반 문단).
   * 같은 인스턴스의 동시 요청은 inflight 로 한 작업을 함께 기다린다.
   */
  const ensureAiStory = async (r: TarotReading, built: ReturnType<typeof buildTarotReading>, people: { me: TarotPerson; partner: TarotPerson } | null, profileName: string | null): Promise<string[] | null> => {
    if (r.aiParagraphs?.length) return r.aiParagraphs;
    if (!ai.enabled || isFreeSpread(r.spread)) return null;
    const running = inflight.get(r.id);
    if (running) return running;
    const job = (async () => {
      const now = Date.now();
      const [claimed] = await db
        .update(tarotReadings)
        .set({ aiAttempts: sql`${tarotReadings.aiAttempts} + 1`, aiRetryAt: now + AI_STORY_RETRY_MS })
        .where(
          and(
            eq(tarotReadings.id, r.id),
            isNull(tarotReadings.aiParagraphs),
            lt(tarotReadings.aiAttempts, AI_STORY_MAX_ATTEMPTS),
            or(isNull(tarotReadings.aiRetryAt), lte(tarotReadings.aiRetryAt, now)),
          ),
        )
        .returning({ id: tarotReadings.id });
      if (!claimed) {
        // 다른 요청이 그사이 만들어 저장했을 수 있다
        const [fresh] = await db.select({ aiParagraphs: tarotReadings.aiParagraphs }).from(tarotReadings).where(eq(tarotReadings.id, r.id));
        return fresh?.aiParagraphs?.length ? fresh.aiParagraphs : null;
      }
      let paragraphs: string[] | null = null;
      try {
        paragraphs = await ai.tarotStory({
          spreadName: TAROT_SPREADS[r.spread as TarotSpread].name,
          topicLabel: r.topic ? TAROT_TOPICS[r.topic as TarotTopic].label : null,
          question: r.question,
          cards: built.cards.map((c) => ({ position: c.position.label, hint: c.position.hint, name: c.nameKo, orientation: c.orientation, meaning: c.meaning, line: c.line, keywords: c.keywords })),
          basis: built.basis,
          profileName,
          ...(r.options ? { options: r.options } : {}),
          ...(people ? { people: { me: people.me.name, partner: people.partner.name } } : {}),
        });
      } catch (error) {
        console.error('[tarot] AI 종합 문단 실패', safeErrorText(error));
      }
      if (paragraphs?.length) {
        await db.update(tarotReadings).set({ aiParagraphs: paragraphs, model: ai.premiumModel, aiRetryAt: null }).where(eq(tarotReadings.id, r.id));
        return paragraphs;
      }
      // 실패 — 다음 시도는 지금부터 AI_STORY_RETRY_MS 뒤 (AI 호출이 오래 걸렸어도 간격을 지킨다)
      await db.update(tarotReadings).set({ aiRetryAt: Date.now() + AI_STORY_RETRY_MS }).where(eq(tarotReadings.id, r.id));
      return null;
    })().finally(() => inflight.delete(r.id));
    inflight.set(r.id, job);
    return job;
  };

  const view = async (userId: string, r: TarotReading): Promise<TarotReadingDto> => {
    const spread = r.spread as TarotSpread;
    const topic = (r.topic as TarotTopic | null) ?? null;
    const isUnlocked = await unlocked(userId, r);
    const owner = await personAt(await chartFor(userId, r.profileId, false), r.sajuSnapshot?.owner);
    const partner = spread === 'compat' ? await personAt(await partnerFor(userId, r.partnerProfileId), r.sajuSnapshot?.partner) : null;
    const people = owner && partner ? { me: owner, partner } : null;
    const input = { id: r.id, spread, topic, drawn: r.cards, chart: owner?.chart ?? null, unlocked: isUnlocked, options: r.options ?? null, people, name: owner?.name ?? null };
    let built = buildTarotReading(input);
    let aiParagraphs: string[] | null = null;
    if (isUnlocked) {
      aiParagraphs = await ensureAiStory(r, built, people, owner?.name ?? null);
      if (aiParagraphs) built = buildTarotReading({ ...input, aiParagraphs });
    }
    const def = TAROT_SPREADS[spread];
    return {
      id: r.id,
      spread,
      spreadName: def.name,
      topic,
      question: r.question,
      date: r.dateKey,
      createdAt: new Date(r.createdAt).toISOString(),
      cards: built.cards,
      headline: built.headline,
      sections: built.sections,
      locked: !isUnlocked,
      productId: def.productId,
      profileName: owner?.name ?? null,
      // 잠긴 리딩은 용어 근거(basis)를 보내지 않는다 — 잠긴 '사주로 본 근거' 섹션과 같은 규칙
      basis: isUnlocked ? built.basis : null,
      generator: aiParagraphs ? 'ai' : 'rule',
      disclaimer: TAROT_DISCLAIMER,
      lean: built.lean,
      options: r.options ?? null,
      partnerName: partner?.name ?? null,
    };
  };

  /** 내 리딩 — 지운 표지는 없는 것으로 본다 */
  const ownedRow = async (userId: string, id: string): Promise<TarotReading> => {
    const [r] = await db.select().from(tarotReadings).where(and(eq(tarotReadings.id, id), eq(tarotReadings.userId, userId), notDeleted));
    if (!r) throw notFound('타로 기록을 찾을 수 없어요.');
    return r;
  };

  /** 지난날의 표지 정리 — 하루 횟수·같은 질문 판정은 그날만 쓰므로 날이 바뀌면 남길 까닭이 없다 */
  const purgeOldTombstones = (userId: string, today: string) =>
    db.delete(tarotReadings).where(and(eq(tarotReadings.userId, userId), like(tarotReadings.questionKey, `${DELETED_PREFIX}%`), lt(tarotReadings.dateKey, today)));

  return {
    unlocked,

    async shuffle(userId: string, dto: TarotShuffleDto): Promise<TarotShuffleResultDto> {
      const { extra } = await extrasOf(userId, dto);
      const dateKey = todayKey();
      const prev = await existing(userId, dateKey, questionKey(dto.spread, dto.topic, dto.question, extra));
      // 오늘 같은 질문으로 뽑고 지웠으면 다시 뽑지 않는다
      if (prev && isDeleted(prev)) throw alreadyDrawn(prev);
      // 같은 질문이면 횟수와 상관없이 그 결과로 안내, 새 질문이면 예·아니오 무료 횟수를 먼저 확인
      if (!prev && dto.spread === 'yesno') await assertYesNoQuota(userId, dateKey);
      const { token, expiresAt } = issueDeckToken(secret, userId);
      return { deckToken: token, deckSize: DECK_SIZE, expiresAt: new Date(expiresAt).toISOString(), existingReadingId: prev?.id ?? null };
    },

    async draw(userId: string, dto: TarotDrawDto): Promise<TarotReadingDto> {
      const spread = dto.spread;
      const topic = dto.topic;
      const { options, partner, extra } = await extrasOf(userId, dto);
      const need = TAROT_SPREADS[spread].cards;
      if (dto.picks.length !== need) throw badRequest(`카드를 ${need}장 골라 주세요.`);
      if (new Set(dto.picks).size !== dto.picks.length) throw badRequest('같은 카드를 두 번 고를 수 없어요.');
      const seed = readDeckToken(secret, userId, dto.deckToken);
      if (!seed) throw badRequest('카드를 섞은 뒤 시간이 오래 지났어요. 카드를 다시 섞어 주세요.');
      const fingerprint = deckTokenFingerprint(dto.deckToken);
      const dateKey = todayKey();
      const qKey = questionKey(spread, topic, dto.question, extra);
      const prev = await existing(userId, dateKey, qKey);
      if (prev) throw alreadyDrawn(prev);
      if ((await db.select({ id: tarotReadings.id }).from(tarotReadings).where(eq(tarotReadings.deckFingerprint, fingerprint))).length > 0) {
        throw conflict('이미 사용한 카드 묶음이에요. 카드를 다시 섞어 주세요.');
      }
      if (spread === 'yesno') await assertYesNoQuota(userId, dateKey);
      const owner = await chartFor(userId, dto.profileId ?? null, true);
      if (dto.profileId && !owner) throw badRequest('사주를 함께 볼 프로필을 다시 선택해 주세요.');
      if (spread === 'compat') {
        if (!owner) throw badRequest('궁합 타로는 내 사주를 먼저 저장해야 볼 수 있어요.');
        if (owner.id === partner?.id) throw badRequest('나와 다른 사람을 골라 주세요.');
      }
      const drawn = drawAt(seed, dto.picks);
      const id = newId();
      try {
        // 예·아니오는 하루 횟수 확인을 저장과 한 묶음으로 — 서로 다른 질문을 동시에 보내도 횟수를 넘겨 저장되지 않는다
        await atomic(db, async (u) => {
          if (spread === 'yesno') {
            await assertYesNoQuota(userId, dateKey);
            u.expect(sql`(select count(*) from ${tarotReadings} where ${yesNoToday(userId, dateKey)}) < ${TAROT_YESNO_DAILY_FREE}`);
          }
          u.write(
            db.insert(tarotReadings).values({
              id,
              userId,
              profileId: owner?.id ?? null,
              spread,
              topic,
              question: dto.question?.trim() || null,
              questionKey: qKey,
              dateKey,
              cards: drawn,
              deckFingerprint: fingerprint,
              partnerProfileId: partner?.id ?? null,
              options,
              sajuSnapshot: snapshotOf(owner, partner),
            }),
          );
        });
      } catch (e) {
        // 같은 질문·같은 덱 토큰으로 동시에 들어온 요청 — 먼저 저장된 리딩으로 안내
        if (!isUniqueViolation(e)) throw e;
        const won = await existing(userId, dateKey, qKey);
        if (won) throw alreadyDrawn(won);
        throw conflict('이미 사용한 카드 묶음이에요. 카드를 다시 섞어 주세요.');
      }
      return view(userId, await ownedRow(userId, id));
    },

    /**
     * 오늘의 카드 — 카드는 사람·날짜로 정해진다(dailyCard). 사주 결합 프로필은 profileId 를 주면 그 프로필로 바꿔 둔다
     * (카드는 그대로, 사주 섹션만 고른 사람 기준). 주지 않으면 처음 연 때의 프로필을 그대로 쓴다.
     */
    async daily(userId: string, profileId?: string): Promise<TarotReadingDto> {
      const dateKey = todayKey();
      const qKey = questionKey('daily', null, null);
      let r = await existing(userId, dateKey, qKey);
      if (!r) {
        const owner = await chartFor(userId, profileId ?? null, true);
        const drawn: DrawnCard[] = [dailyCard(userId, dateKey)];
        await db
          .insert(tarotReadings)
          .values({ id: newId(), userId, profileId: owner?.id ?? null, spread: 'daily', topic: null, question: null, questionKey: qKey, dateKey, cards: drawn, sajuSnapshot: snapshotOf(owner, null) })
          .onConflictDoNothing();
        r = (await existing(userId, dateKey, qKey))!;
      } else if (profileId && profileId !== r.profileId) {
        const owner = await chartFor(userId, profileId, false);
        if (owner) {
          const sajuSnapshot = snapshotOf(owner, null);
          await db.update(tarotReadings).set({ profileId: owner.id, sajuSnapshot }).where(and(eq(tarotReadings.id, r.id), eq(tarotReadings.userId, userId)));
          r = { ...r, profileId: owner.id, sajuSnapshot };
        }
      }
      return view(userId, r);
    },

    async get(userId: string, id: string): Promise<TarotReadingDto> {
      return view(userId, await ownedRow(userId, id));
    },

    /** 결제 전 확인 — 내 리딩이고 이 상품으로 열 수 있는가 */
    async assertPurchasable(userId: string, readingId: string, productId: string) {
      const r = await ownedRow(userId, readingId);
      if (TAROT_SPREADS[r.spread as TarotSpread].productId !== productId) throw badRequest('이 리딩에 맞지 않는 상품이에요.');
    },

    /**
     * 기록 목록 — 최근 TAROT_HISTORY_RECENT 개에 더해, 그보다 오래된 구매 리딩(tarot:reading 권한)도 모두 싣는다(산 결과가 목록에서 사라지지 않게).
     * 잠금 여부는 플러스 구독 1번, 권한 목록 1번만 조회해서 정한다(리딩마다 따로 묻지 않는다)
     */
    async history(userId: string): Promise<TarotHistoryItemDto[]> {
      const mine = and(eq(tarotReadings.userId, userId), notDeleted);
      const recent = await db.select().from(tarotReadings).where(mine).orderBy(desc(tarotReadings.createdAt), desc(tarotReadings.id)).limit(TAROT_HISTORY_RECENT);
      const now = Date.now();
      const prefix = tarotKey('');
      const bought = new Set(
        (await db.select({ key: entitlements.key, expiresAt: entitlements.expiresAt }).from(entitlements).where(and(eq(entitlements.userId, userId), like(entitlements.key, `${prefix}%`))))
          .filter((e) => e.expiresAt === null || e.expiresAt > now)
          .map((e) => e.key.slice(prefix.length)),
      );
      const shown = new Set(recent.map((r) => r.id));
      const missing = [...bought].filter((id) => !shown.has(id));
      const older: TarotReading[] = [];
      for (let i = 0; i < missing.length; i += IN_CHUNK) {
        older.push(...(await db.select().from(tarotReadings).where(and(mine, inArray(tarotReadings.id, missing.slice(i, i + IN_CHUNK))))));
      }
      older.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
      const premium = await commerce.isPremium(userId);
      return [...recent, ...older].map((r) => ({
        id: r.id,
        spread: r.spread as TarotSpread,
        spreadName: TAROT_SPREADS[r.spread as TarotSpread].name,
        topic: (r.topic as TarotTopic | null) ?? null,
        question: r.question,
        date: r.dateKey,
        cards: r.cards.map((d) => {
          const c = cardDto(d);
          return { id: c.id, nameKo: c.nameKo, orientation: c.orientation, image: c.image };
        }),
        locked: !(isFreeSpread(r.spread) || premium || bought.has(r.id)),
      }));
    },

    /**
     * 리딩 지우기 — 지난날 리딩은 행을 지운다. 오늘 뽑은 리딩(오늘의 카드 제외)은 표지로 바꿔 내용만 비운다:
     * 하루 횟수와 같은 질문 판정에 남겨 지우고 다시 뽑는 우회를 막는다. 지난날의 표지는 이 사용자가 다음에 리딩을 지울 때 함께 정리한다(탈퇴 때는 모두 지운다).
     * 오늘의 카드는 같은 날 다시 열어도 같은 카드라 행을 지운다.
     */
    async remove(userId: string, id: string) {
      const r = await ownedRow(userId, id);
      const today = todayKey();
      const where = and(eq(tarotReadings.id, id), eq(tarotReadings.userId, userId));
      if (r.dateKey === today && r.spread !== 'daily') {
        await db
          .update(tarotReadings)
          .set({ questionKey: deletedQuestionKey(r.questionKey), question: null, topic: null, cards: [], options: null, aiParagraphs: null, model: null, profileId: null, partnerProfileId: null, sajuSnapshot: null })
          .where(where);
      } else {
        await db.delete(tarotReadings).where(where);
      }
      await purgeOldTombstones(userId, today);
    },
  };
}

export type TarotService = ReturnType<typeof createTarotService>;
