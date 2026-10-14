/**
 * 타로 — 셔플(덱 토큰) → 자리 고르기 → 리딩 저장 → 열람(권한에 따라 잠금) / 오늘의 카드 / 기록.
 *
 * - 같은 날 같은 질문(펼침·주제·질문 정규화)은 다시 뽑지 않고 기존 리딩으로 안내한다(결과 고정).
 *   양자택일은 선택지 A·B, 궁합 타로는 상대까지 같아야 같은 질문이다.
 * - 상세 리딩 권한: tarot:reading:<readingId> (구매) 또는 플러스 구독. 상품이 없는 펼침(오늘의 카드·예·아니오)은 전부 무료.
 * - 예·아니오는 무료 대신 하루 TAROT_YESNO_DAILY_FREE 회 — 넘으면 429 (details.readingId = 오늘 본 리딩).
 * - AI 종합 문단은 유료 열람 시 1회만 만들고 저장한다.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { SajuChart } from '@saju/core';
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
import type { Db } from '../../db/client.js';
import { tarotReadings, type TarotReading } from '../../db/schema.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { AiService } from '../ai/service.js';
import type { CommerceService } from '../commerce/service.js';
import type { ProfileService } from '../profiles/service.js';
import { todayInSeoul } from '../saju/routes.js';
import { DECK_SIZE, dailyCard, deckTokenFingerprint, drawAt, issueDeckToken, readDeckToken, type DrawnCard } from './deck.js';
import { TAROT_DISCLAIMER, buildTarotReading, cardDto, type TarotPerson } from './reading.js';

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
/** 상품이 없는 펼침 방식(오늘의 카드·예·아니오)은 전부 무료 */
const isFreeSpread = (spread: string) => !TAROT_SPREADS[spread as TarotSpread].productId;

export function createTarotService(config: AppConfig, db: Db, profiles: ProfileService, commerce: CommerceService, ai: AiService) {
  const secret = `${config.JWT_ACCESS_SECRET}|tarot-deck`;
  const inflight = new Map<string, Promise<string[] | null>>();

  const unlocked = (userId: string, r: TarotReading) => isFreeSpread(r.spread) || commerce.isPremium(userId) || commerce.hasEntitlement(userId, tarotKey(r.id));

  /** 사주 결합용 원국 — 지정 프로필이 없거나 지워졌으면 대표 프로필, 그것도 없으면 null */
  const chartFor = (userId: string, profileId: string | null): { chart: SajuChart; name: string; id: string } | null => {
    try {
      const p = profileId ? profiles.getOwned(userId, profileId) : profiles.primary(userId);
      return p ? { chart: profiles.chartOf(p), name: p.name, id: p.id } : null;
    } catch {
      return null;
    }
  };

  /** 궁합 타로 상대 — 대표 프로필로 대신하지 않는다. 지워졌으면 null */
  const partnerFor = (userId: string, profileId: string | null | undefined): { chart: SajuChart; name: string; id: string } | null => {
    if (!profileId) return null;
    try {
      const p = profiles.getOwned(userId, profileId);
      return { chart: profiles.chartOf(p), name: p.name, id: p.id };
    } catch {
      return null;
    }
  };

  const existing = (userId: string, dateKey: string, qKey: string) =>
    db.select().from(tarotReadings).where(and(eq(tarotReadings.userId, userId), eq(tarotReadings.dateKey, dateKey), eq(tarotReadings.questionKey, qKey))).get();

  /**
   * 펼침 방식별 추가 입력 — 양자택일 선택지 A·B(서로 달라야 함), 궁합 타로 상대(내 프로필 중 하나).
   * extra 는 같은 질문 판정 키에 붙는다.
   */
  const extrasOf = (userId: string, dto: TarotShuffleDto): { options: { a: string; b: string } | null; partner: ReturnType<typeof partnerFor>; extra: string | null } => {
    if (TAROT_TOPICS[dto.topic].spread !== dto.spread) throw badRequest('이 주제에 맞지 않는 펼침 방식이에요.');
    if (dto.spread === 'choice') {
      const a = dto.optionA?.trim();
      const b = dto.optionB?.trim();
      if (!a || !b) throw badRequest('두 선택지를 모두 적어 주세요.');
      if (normalize(a) === normalize(b)) throw badRequest('서로 다른 두 선택지를 적어 주세요.');
      return { options: { a, b }, partner: null, extra: `${normalize(a)}|${normalize(b)}` };
    }
    if (dto.spread === 'compat') {
      if (!dto.partnerProfileId) throw badRequest('함께 볼 상대를 골라 주세요.');
      const partner = partnerFor(userId, dto.partnerProfileId);
      if (!partner) throw badRequest('함께 볼 상대의 사주를 다시 골라 주세요.');
      return { options: null, partner, extra: partner.id };
    }
    return { options: null, partner: null, extra: null };
  };

  /** 예·아니오 하루 무료 횟수 — 넘으면 429, 오늘 마지막으로 본 리딩으로 안내 */
  const assertYesNoQuota = (userId: string, dateKey: string) => {
    const used = db
      .select({ id: tarotReadings.id })
      .from(tarotReadings)
      .where(and(eq(tarotReadings.userId, userId), eq(tarotReadings.dateKey, dateKey), eq(tarotReadings.spread, 'yesno')))
      .orderBy(desc(tarotReadings.createdAt))
      .all();
    if (used.length >= TAROT_YESNO_DAILY_FREE) {
      throw new AppError(429, ERROR_CODES.RATE_LIMITED, `예·아니오 카드는 하루 ${TAROT_YESNO_DAILY_FREE}번 무료로 볼 수 있어요. 내일 다시 물어봐 주세요.`, { readingId: used[0]!.id, limit: TAROT_YESNO_DAILY_FREE });
    }
  };

  /** AI 종합 문단 — 열람 권한이 있을 때 한 번만 만들고 저장 (무료 펼침은 규칙 기반만) */
  const ensureAiStory = async (r: TarotReading, built: ReturnType<typeof buildTarotReading>, people: { me: TarotPerson; partner: TarotPerson } | null): Promise<string[] | null> => {
    if (r.aiParagraphs?.length) return r.aiParagraphs;
    if (!ai.enabled || isFreeSpread(r.spread)) return null;
    const running = inflight.get(r.id);
    if (running) return running;
    const job = ai
      .tarotStory({
        spreadName: TAROT_SPREADS[r.spread as TarotSpread].name,
        topicLabel: r.topic ? TAROT_TOPICS[r.topic as TarotTopic].label : null,
        question: r.question,
        cards: built.cards.map((c) => ({ position: c.position.label, hint: c.position.hint, name: c.nameKo, orientation: c.orientation, meaning: c.meaning, line: c.line, keywords: c.keywords })),
        basis: built.basis,
        ...(r.options ? { options: r.options } : {}),
        ...(people ? { people: { me: people.me.name, partner: people.partner.name } } : {}),
      })
      .then((paragraphs) => {
        if (paragraphs) db.update(tarotReadings).set({ aiParagraphs: paragraphs, model: ai.premiumModel }).where(eq(tarotReadings.id, r.id)).run();
        return paragraphs;
      })
      .finally(() => inflight.delete(r.id));
    inflight.set(r.id, job);
    return job;
  };

  const view = async (userId: string, r: TarotReading): Promise<TarotReadingDto> => {
    const spread = r.spread as TarotSpread;
    const topic = (r.topic as TarotTopic | null) ?? null;
    const isUnlocked = unlocked(userId, r);
    const owner = chartFor(userId, r.profileId);
    const partner = spread === 'compat' ? partnerFor(userId, r.partnerProfileId) : null;
    const people = owner && partner ? { me: owner, partner } : null;
    const input = { id: r.id, spread, topic, drawn: r.cards, chart: owner?.chart ?? null, unlocked: isUnlocked, options: r.options ?? null, people };
    let built = buildTarotReading(input);
    let aiParagraphs: string[] | null = null;
    if (isUnlocked) {
      aiParagraphs = await ensureAiStory(r, built, people);
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
      basis: built.basis,
      generator: aiParagraphs ? 'ai' : 'rule',
      disclaimer: TAROT_DISCLAIMER,
      lean: built.lean,
      options: r.options ?? null,
      partnerName: partner?.name ?? null,
    };
  };

  const ownedRow = (userId: string, id: string): TarotReading => {
    const r = db.select().from(tarotReadings).where(and(eq(tarotReadings.id, id), eq(tarotReadings.userId, userId))).get();
    if (!r) throw notFound('타로 기록을 찾을 수 없어요.');
    return r;
  };

  return {
    unlocked,

    shuffle(userId: string, dto: TarotShuffleDto): TarotShuffleResultDto {
      const { extra } = extrasOf(userId, dto);
      const dateKey = todayKey();
      const prev = existing(userId, dateKey, questionKey(dto.spread, dto.topic, dto.question, extra));
      // 같은 질문이면 횟수와 상관없이 그 결과로 안내, 새 질문이면 예·아니오 무료 횟수를 먼저 확인
      if (!prev && dto.spread === 'yesno') assertYesNoQuota(userId, dateKey);
      const { token, expiresAt } = issueDeckToken(secret, userId);
      return { deckToken: token, deckSize: DECK_SIZE, expiresAt: new Date(expiresAt).toISOString(), existingReadingId: prev?.id ?? null };
    },

    async draw(userId: string, dto: TarotDrawDto): Promise<TarotReadingDto> {
      const spread = dto.spread;
      const topic = dto.topic;
      const { options, partner, extra } = extrasOf(userId, dto);
      const need = TAROT_SPREADS[spread].cards;
      if (dto.picks.length !== need) throw badRequest(`카드를 ${need}장 골라 주세요.`);
      if (new Set(dto.picks).size !== dto.picks.length) throw badRequest('같은 카드를 두 번 고를 수 없어요.');
      const seed = readDeckToken(secret, userId, dto.deckToken);
      if (!seed) throw badRequest('카드를 섞은 지 오래됐어요. 다시 섞어 주세요.');
      const fingerprint = deckTokenFingerprint(dto.deckToken);
      const dateKey = todayKey();
      const qKey = questionKey(spread, topic, dto.question, extra);
      const prev = existing(userId, dateKey, qKey);
      if (prev) throw conflict('오늘 같은 질문으로 이미 카드를 뽑았어요. 그 결과로 이어서 읽어 볼게요.', { readingId: prev.id });
      if (db.select({ id: tarotReadings.id }).from(tarotReadings).where(eq(tarotReadings.deckFingerprint, fingerprint)).get()) {
        throw conflict('이미 사용한 카드 묶음이에요. 다시 섞어 주세요.');
      }
      if (spread === 'yesno') assertYesNoQuota(userId, dateKey);
      const owner = chartFor(userId, dto.profileId ?? null);
      if (dto.profileId && !owner) throw badRequest('사주를 함께 볼 프로필을 다시 선택해 주세요.');
      if (spread === 'compat') {
        if (!owner) throw badRequest('궁합 타로는 내 사주를 먼저 저장해야 볼 수 있어요.');
        if (owner.id === partner?.id) throw badRequest('나와 다른 사람을 골라 주세요.');
      }
      const drawn = drawAt(seed, dto.picks);
      const id = newId();
      try {
        db.insert(tarotReadings)
          .values({
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
          })
          .run();
      } catch (e) {
        // 같은 질문·같은 덱 토큰으로 동시에 들어온 요청 — 먼저 저장된 리딩으로 안내
        if (!String((e as Error).message).includes('UNIQUE')) throw e;
        const won = existing(userId, dateKey, qKey);
        throw conflict('오늘 같은 질문으로 이미 카드를 뽑았어요. 그 결과로 이어서 읽어 볼게요.', won ? { readingId: won.id } : undefined);
      }
      return view(userId, ownedRow(userId, id));
    },

    async daily(userId: string, profileId?: string): Promise<TarotReadingDto> {
      const dateKey = todayKey();
      const qKey = questionKey('daily', null, null);
      let r = existing(userId, dateKey, qKey);
      if (!r) {
        const owner = chartFor(userId, profileId ?? null);
        const drawn: DrawnCard[] = [dailyCard(userId, dateKey)];
        db.insert(tarotReadings).values({ id: newId(), userId, profileId: owner?.id ?? null, spread: 'daily', topic: null, question: null, questionKey: qKey, dateKey, cards: drawn }).onConflictDoNothing().run();
        r = existing(userId, dateKey, qKey)!;
      }
      return view(userId, r);
    },

    get(userId: string, id: string): Promise<TarotReadingDto> {
      return view(userId, ownedRow(userId, id));
    },

    /** 결제 전 확인 — 내 리딩이고 이 상품으로 열 수 있는가 */
    assertPurchasable(userId: string, readingId: string, productId: string) {
      const r = ownedRow(userId, readingId);
      if (TAROT_SPREADS[r.spread as TarotSpread].productId !== productId) throw badRequest('이 리딩에 맞지 않는 상품이에요.');
    },

    history(userId: string): TarotHistoryItemDto[] {
      return db
        .select()
        .from(tarotReadings)
        .where(eq(tarotReadings.userId, userId))
        .orderBy(desc(tarotReadings.createdAt))
        .limit(100)
        .all()
        .map((r) => ({
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
          locked: !unlocked(userId, r),
        }));
    },

    remove(userId: string, id: string) {
      ownedRow(userId, id);
      db.delete(tarotReadings).where(and(eq(tarotReadings.id, id), eq(tarotReadings.userId, userId))).run();
    },
  };
}

export type TarotService = ReturnType<typeof createTarotService>;
