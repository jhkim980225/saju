/**
 * 택일 — 목적·날짜 입력 → 엔진 계산(규칙 기반) → 저장 → 열람(권한에 따라 잠금).
 *
 * - 무료: 날짜마다 등급, 추천 Top 3 날짜, 한 줄 요약, 계산 기준
 * - 상세(report_taekil 990원): Top 3 근거·황도시, 날짜마다 이유와 빠진 까닭, 종합 분석·목적 맞춤 조언·날짜를 바꿀 수 없을 때
 * - 권한: taekil:reading:<id> (구매) 또는 플러스 구독. 결제는 타로처럼 readingId 로 '이 결과 하나'를 연다.
 * - 저장: 마이그레이션 없이 reports 테이블에 type='taekil' 로 둔다. 계산 결과(selection)를 그대로 저장해
 *   엔진이 바뀌어도 산 결과는 그대로다. reports 서비스는 모르는 type 을 열람 불가로 보므로 리포트 목록·조회에는 섞이지 않는다.
 * - AI(설정 시): 상세가 열린 뒤 서술형 섹션만 한 번 다듬어 저장한다. 날짜별 근거는 규칙 기반 그대로 둔다.
 *   실패하면 다시 열 때 재시도하되 결과당 AI_POLISH_MAX_ATTEMPTS 번까지, 직전 시도 뒤 AI_POLISH_RETRY_MS 가 지나야 한다.
 *   시도 횟수·다음 시도 시각은 택일 행에서 쓰지 않는 reports.polish_done·polish_lease_until 에 둔다(조건부 갱신으로 한 곳만 맡는다).
 * - 생성 상한: 사용자마다 하루(KST) TAEKIL_DAILY_CREATE_LIMIT 건 — 무료로 무제한 쌓이지 않게. 같은 입력(저장본 안내)은 세지 않는다.
 *   같은 입력 판정은 content.key 식 인덱스(reports_taekil_key_idx)로 찾아 행 전체를 읽지 않는다. 저장된 결과는 지우지 않는다.
 * - 같은 입력 판정 키에는 두 사람의 출생 정보 지문(birthPrint)을 넣는다 — 프로필의 출생 정보를 고친 뒤에는 고치기 전 원국으로 계산한
 *   저장본을 돌려주지 않고 새로 계산한다(예전 저장본은 기록에 그대로 남는다).
 * - AI 다듬기는 사용자가 기다리는 호출이라 호출별 제한 시간(AI_INTERACTIVE_TIMEOUT_MS)으로 부르고, 리포트 다듬기의 동시 호출 자리를 기다리지 않는다.
 * - 목록은 최근 TAEKIL_LIST_RECENT 건에 더해 그보다 오래된 구매 결과(taekil:reading 권한)도 싣는다.
 */
import { createHash } from 'node:crypto';
import { and, count, desc, eq, gte, inArray, isNull, like, lt, lte, ne, or, sql } from 'drizzle-orm';
import { TAEKIL_PURPOSES, TaekilInputError, parseYmd, selectTaekilDays, taekilDateRange, ymdKey, type SajuChart, type TaekilPurpose, type TaekilSelection } from '@saju/core';
import { ERROR_CODES, TAEKIL_LIMITS, TAEKIL_PRODUCT_ID, type ReadingSection, type TaekilCreateDto, type TaekilResultDto, type TaekilSummaryDto } from '@saju/shared';
import type { Db } from '../../db/client.js';
import { safeErrorText } from '../../lib/log.js';
import { entitlements, reports, type Profile, type Report } from '../../db/schema.js';
import { atomic } from '../../db/atomic.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { AiService } from '../ai/service.js';
import { startOfSeoulDay, type CommerceService } from '../commerce/service.js';
import { profileToBirth, type ProfileService } from '../profiles/service.js';
import { todayInSeoul } from '../saju/routes.js';
import { AI_SECTION_KEYS, TAEKIL_DISCLAIMER, basisOf, buildSections, dayDtos, headlineOf, lockedSections, type TaekilTextContext } from './content.js';

export const TAEKIL_REPORT_TYPE = 'taekil';
export const taekilKey = (id: string) => `taekil:reading:${id}`;
/** 사용자마다 하루(KST) 새로 만들 수 있는 택일 결과 수 */
export const TAEKIL_DAILY_CREATE_LIMIT = 30;
/** AI 다듬기 — 결과 하나에 부르는 최대 횟수 */
export const AI_POLISH_MAX_ATTEMPTS = 3;
/** AI 다듬기 — 직전 시도(실패)에서 다음 시도까지 기다리는 시간. 시도를 맡는 동안의 담당 기한도 겸한다 */
export const AI_POLISH_RETRY_MS = 10 * 60_000;
/** 목록에 기본으로 싣는 최근 결과 수 — 구매한 결과는 이보다 오래되어도 함께 싣는다 */
export const TAEKIL_LIST_RECENT = 100;
/** D1 은 문장 하나에 바인딩 값을 100개까지 받는다 — IN 목록을 나눠 묻는다 */
const IN_CHUNK = 90;
/** 출생 정보 지문 — 같은 입력 판정 키에 넣는다(출생 정보를 고치면 키가 달라진다). 출생 정보 자체는 키에 그대로 쓰지 않는다 */
export const birthPrint = (p: Profile) => createHash('sha256').update(JSON.stringify(profileToBirth(p))).digest('hex').slice(0, 16);
/** 같은 입력 판정 키 — reports_taekil_key_idx 인덱스 식과 글자까지 같아야 인덱스를 탄다 */
const storedKey = sql`json_extract("content", '$.key')`;
/**
 * 같은 입력의 저장본 찾기 — 판정 키 인덱스(reports_taekil_key_idx)로 그 행만 읽는다.
 * type 조건 앞의 단항 + 는 그 열의 인덱스를 고르지 않게 한다(사용자·종류·시각 인덱스로 이 사용자의 택일을 전부 훑지 않게)
 */
export const taekilByKey = (db: Db, userId: string, key: string) =>
  db
    .select()
    .from(reports)
    .where(and(eq(reports.userId, userId), sql`${storedKey} = ${key}`, sql`+${reports.type} = ${TAEKIL_REPORT_TYPE}`))
    .orderBy(desc(reports.createdAt), desc(reports.id))
    .limit(1);

/** reports.content 에 저장하는 모양 */
interface StoredTaekil {
  v: 1;
  /** 같은 입력 재요청 판별 키 */
  key: string;
  purpose: TaekilPurpose;
  mode: 'range' | 'dates';
  from: string;
  to: string;
  profileName: string;
  partnerName: string | null;
  /** 계산 당시 원국 — 프로필을 고치거나 지워도 산 결과의 문장이 바뀌지 않게 함께 저장 */
  chart: SajuChart;
  selection: TaekilSelection;
  ai?: { sections: ReadingSection[]; model: string | null };
}

export function createTaekilService(db: Db, profiles: ProfileService, commerce: CommerceService, ai: AiService) {
  const inflight = new Map<string, Promise<ReadingSection[] | null>>();
  const unlocked = async (userId: string, r: Report) => (await commerce.isPremium(userId)) || commerce.hasEntitlement(userId, taekilKey(r.id));
  const stored = (r: Report) => r.content as StoredTaekil;

  const ownedRow = async (userId: string, id: string): Promise<Report> => {
    const [r] = await db.select().from(reports).where(and(eq(reports.id, id), eq(reports.userId, userId), eq(reports.type, TAEKIL_REPORT_TYPE)));
    if (!r) throw notFound('택일 결과를 찾을 수 없어요.');
    return r;
  };

  const ctxOf = (s: StoredTaekil): TaekilTextContext => ({ purpose: s.purpose, mode: s.mode, profileName: s.profileName, partnerName: s.partnerName, chart: s.chart, sel: s.selection });

  /**
   * 상세가 열린 뒤 서술형 섹션을 AI 로 한 번 다듬어 저장 (키가 없거나 실패하면 null → 규칙 기반 그대로).
   * 부르기 전에 조건부 갱신으로 시도를 맡는다(시도 횟수 +1, 다음 시도 시각을 뒤로) — 여러 인스턴스가 동시에 열어도 한 곳만 부르고,
   * 실패가 이어져도 AI_POLISH_MAX_ATTEMPTS 번·AI_POLISH_RETRY_MS 간격을 넘겨 부르지 않는다
   */
  const ensureAi = async (r: Report, draft: ReadingSection[]): Promise<ReadingSection[] | null> => {
    const s = stored(r);
    if (s.ai?.sections.length) return s.ai.sections;
    if (!ai.enabled) return null;
    const running = inflight.get(r.id);
    if (running) return running;
    const job = (async () => {
      const now = Date.now();
      const [claimed] = await db
        .update(reports)
        .set({ polishDone: sql`${reports.polishDone} + 1`, polishLeaseUntil: now + AI_POLISH_RETRY_MS })
        .where(
          and(
            eq(reports.id, r.id),
            ne(reports.generator, 'ai'),
            lt(reports.polishDone, AI_POLISH_MAX_ATTEMPTS),
            or(isNull(reports.polishLeaseUntil), lte(reports.polishLeaseUntil, now)),
          ),
        )
        .returning({ id: reports.id });
      if (!claimed) {
        // 다른 요청이 그사이 다듬어 저장했을 수 있다
        const [fresh] = await db.select().from(reports).where(eq(reports.id, r.id));
        return fresh ? (stored(fresh).ai?.sections ?? null) : null;
      }
      try {
        const res = await ai.enhanceSections({ title: r.title, chart: s.chart, draft: draft.filter((x) => AI_SECTION_KEYS.includes(x.key)), interactive: true });
        if (res.generator === 'ai') {
          const [fresh] = await db.select().from(reports).where(eq(reports.id, r.id));
          if (fresh) {
            await db
              .update(reports)
              .set({ content: { ...(fresh.content as StoredTaekil), ai: { sections: res.sections, model: res.model } }, generator: 'ai', model: res.model, polishLeaseUntil: null })
              .where(eq(reports.id, r.id));
          }
          return res.sections;
        }
      } catch (error) {
        console.error('[taekil] AI 다듬기 실패', safeErrorText(error));
      }
      // 실패 — 다음 시도는 지금부터 AI_POLISH_RETRY_MS 뒤 (AI 호출이 오래 걸렸어도 간격을 지킨다)
      await db.update(reports).set({ polishLeaseUntil: Date.now() + AI_POLISH_RETRY_MS }).where(eq(reports.id, r.id));
      return null;
    })()
      .catch((error: unknown) => {
        console.error('[taekil] AI 다듬기 기록 실패', safeErrorText(error));
        return null;
      })
      .finally(() => inflight.delete(r.id));
    inflight.set(r.id, job);
    return job;
  };

  const view = async (userId: string, r: Report): Promise<TaekilResultDto> => {
    const s = stored(r);
    const ctx = ctxOf(s);
    const isUnlocked = await unlocked(userId, r);
    let sections: ReadingSection[];
    let generator: 'rule' | 'ai' = 'rule';
    if (isUnlocked) {
      sections = buildSections(ctx);
      const polished = await ensureAi(r, sections);
      if (polished?.length) {
        const byKey = new Map(polished.map((x) => [x.key, x]));
        sections = sections.map((x) => byKey.get(x.key) ?? x);
        generator = 'ai';
      }
    } else {
      sections = lockedSections(ctx, TAEKIL_PRODUCT_ID);
    }
    return {
      id: r.id,
      title: r.title,
      purpose: s.purpose,
      purposeLabel: TAEKIL_PURPOSES[s.purpose].label,
      profileId: r.profileId,
      profileName: s.profileName,
      partnerName: s.partnerName,
      mode: s.mode,
      from: s.from,
      to: s.to,
      createdAt: new Date(r.createdAt).toISOString(),
      headline: headlineOf(s.selection, s.purpose),
      basis: basisOf(s.chart, s.partnerName),
      counts: s.selection.counts,
      top: s.selection.top,
      days: dayDtos(ctx, !isUnlocked),
      sections,
      locked: !isUnlocked,
      productId: TAEKIL_PRODUCT_ID,
      generator,
      disclaimer: TAEKIL_DISCLAIMER,
    };
  };

  const summary = (r: Report, isLocked: boolean): TaekilSummaryDto => {
    const s = stored(r);
    return {
      id: r.id,
      title: r.title,
      purpose: s.purpose,
      purposeLabel: TAEKIL_PURPOSES[s.purpose].label,
      profileName: s.profileName,
      from: s.from,
      to: s.to,
      top: s.selection.top,
      locked: isLocked,
      createdAt: new Date(r.createdAt).toISOString(),
    };
  };

  return {
    unlocked,

    async create(userId: string, dto: TaekilCreateDto): Promise<TaekilResultDto> {
      const profile = await profiles.getOwned(userId, dto.profileId);
      const chart = profiles.chartOf(profile);
      const purpose = dto.purpose as TaekilPurpose;
      let partner: { id: string; name: string; chart: SajuChart; print: string } | null = null;
      if (purpose === 'wedding' && dto.partnerProfileId) {
        if (dto.partnerProfileId === profile.id) throw badRequest('서로 다른 두 사람을 골라 주세요.');
        const p = await profiles.getOwned(userId, dto.partnerProfileId);
        partner = { id: p.id, name: p.name, chart: profiles.chartOf(p), print: birthPrint(p) };
      }

      // 날짜 — 오늘(KST)부터, 너무 먼 날은 받지 않는다
      const t = todayInSeoul();
      const today = ymdKey(t);
      const last = new Date(Date.UTC(t.year, t.month - 1, t.day + TAEKIL_LIMITS.maxDaysAhead)).toISOString().slice(0, 10);
      let dates: string[];
      let mode: 'range' | 'dates';
      try {
        if (dto.dates) {
          mode = 'dates';
          dates = [...new Set(dto.dates)].sort();
          if (dates.length < TAEKIL_LIMITS.minCandidates) throw badRequest(`서로 다른 후보 날짜를 ${TAEKIL_LIMITS.minCandidates}개 이상 골라 주세요.`);
          dates.forEach((d) => parseYmd(d));
        } else {
          mode = 'range';
          dates = taekilDateRange(dto.from!, dto.to!).map(ymdKey);
        }
      } catch (e) {
        if (e instanceof TaekilInputError) throw badRequest(e.message);
        throw e;
      }
      if (dates[0]! < today) throw badRequest('지난 날짜는 고를 수 없어요. 오늘 이후 날짜로 골라 주세요.');
      if (dates[dates.length - 1]! > last) throw badRequest('택일은 앞으로 2년 안의 날짜만 볼 수 있어요.');

      // 같은 입력이면 저장본으로 안내(이미 산 결과를 다시 사지 않게). 출생 정보 지문을 넣어 고친 출생 정보에는 새로 계산한다
      const key = [purpose, `${profile.id}~${birthPrint(profile)}`, partner ? `${partner.id}~${partner.print}` : '', mode, dates.join(',')].join('|');
      const [existing] = await taekilByKey(db, userId, key);
      if (existing) return view(userId, existing);

      // 하루 생성 상한 — 계산 전에 한 번, 저장 묶음 실행 시점에 한 번 더(동시 요청으로 넘지 않게) 확인한다
      const madeToday = and(eq(reports.userId, userId), eq(reports.type, TAEKIL_REPORT_TYPE), gte(reports.createdAt, startOfSeoulDay()));
      const assertDailyQuota = async () => {
        const made = (await db.select({ n: count() }).from(reports).where(madeToday))[0]?.n ?? 0;
        if (made >= TAEKIL_DAILY_CREATE_LIMIT) {
          throw new AppError(429, ERROR_CODES.RATE_LIMITED, `택일은 하루 ${TAEKIL_DAILY_CREATE_LIMIT}번까지 새로 볼 수 있어요. 앞서 본 결과는 택일 기록에서 다시 열 수 있어요.`, {
            limit: TAEKIL_DAILY_CREATE_LIMIT,
          });
        }
      };
      await assertDailyQuota();

      const selection = selectTaekilDays(chart, purpose, dates.map(parseYmd), { partner: partner?.chart ?? null });
      const from = dates[0]!;
      const to = dates[dates.length - 1]!;
      const range = mode === 'range' ? ` (${Number(from.slice(5, 7))}.${Number(from.slice(8))}~${Number(to.slice(5, 7))}.${Number(to.slice(8))})` : '';
      const title = partner ? `${profile.name}·${partner.name}님의 결혼 택일${range}` : `${profile.name}님의 ${TAEKIL_PURPOSES[purpose].label} 택일${range}`;
      const content: StoredTaekil = { v: 1, key, purpose, mode, from, to, profileName: profile.name, partnerName: partner?.name ?? null, chart, selection };
      const id = newId();
      await atomic(db, async (u) => {
        await assertDailyQuota();
        u.expect(sql`(select count(*) from ${reports} where ${madeToday}) < ${TAEKIL_DAILY_CREATE_LIMIT}`);
        u.write(db.insert(reports).values({ id, userId, profileId: profile.id, partnerProfileId: partner?.id ?? null, type: TAEKIL_REPORT_TYPE, year: null, title, content, generator: 'rule', model: null, createdAt: Date.now() }));
      });
      return view(userId, await ownedRow(userId, id));
    },

    async get(userId: string, id: string): Promise<TaekilResultDto> {
      return view(userId, await ownedRow(userId, id));
    },

    /**
     * 목록 — 최근 TAEKIL_LIST_RECENT 건에 더해 그보다 오래된 구매 결과도 싣는다(산 결과가 보관함·목록에서 사라지지 않게).
     * 잠금 여부는 플러스 구독 1번, 권한 목록 1번만 조회해서 정한다(결과마다 따로 묻지 않는다)
     */
    async list(userId: string): Promise<TaekilSummaryDto[]> {
      const mine = and(eq(reports.userId, userId), eq(reports.type, TAEKIL_REPORT_TYPE));
      const recent = await db.select().from(reports).where(mine).orderBy(desc(reports.createdAt), desc(reports.id)).limit(TAEKIL_LIST_RECENT);
      const now = Date.now();
      const prefix = taekilKey('');
      const bought = new Set(
        (await db.select({ key: entitlements.key, expiresAt: entitlements.expiresAt }).from(entitlements).where(and(eq(entitlements.userId, userId), like(entitlements.key, `${prefix}%`))))
          .filter((e) => e.expiresAt === null || e.expiresAt > now)
          .map((e) => e.key.slice(prefix.length)),
      );
      const shown = new Set(recent.map((r) => r.id));
      const missing = [...bought].filter((id) => !shown.has(id));
      const older: Report[] = [];
      for (let i = 0; i < missing.length; i += IN_CHUNK) {
        older.push(...(await db.select().from(reports).where(and(mine, inArray(reports.id, missing.slice(i, i + IN_CHUNK))))));
      }
      older.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
      const premium = await commerce.isPremium(userId);
      return [...recent, ...older].map((r) => summary(r, !(premium || bought.has(r.id))));
    },

    /** 결제 전 확인 — 내 택일 결과이고 이 상품으로 열 수 있는가 */
    async assertPurchasable(userId: string, readingId: string, productId: string) {
      await ownedRow(userId, readingId);
      if (productId !== TAEKIL_PRODUCT_ID) throw badRequest('이 택일 결과에 맞지 않는 상품이에요.');
    },
  };
}

export type TaekilService = ReturnType<typeof createTaekilService>;
