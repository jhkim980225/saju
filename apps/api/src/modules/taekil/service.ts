/**
 * 택일 — 목적·날짜 입력 → 엔진 계산(규칙 기반) → 저장 → 열람(권한에 따라 잠금).
 *
 * - 무료: 날짜마다 등급, 추천 Top 3 날짜, 한 줄 요약, 계산 기준
 * - 상세(report_taekil 990원): Top 3 근거·황도시, 날짜마다 이유와 빠진 까닭, 종합 분석·목적 맞춤 조언·위기를 기회로
 * - 권한: taekil:reading:<id> (구매) 또는 플러스 구독. 결제는 타로처럼 readingId 로 '이 결과 하나'를 연다.
 * - 저장: 마이그레이션 없이 reports 테이블에 type='taekil' 로 둔다. 계산 결과(selection)를 그대로 저장해
 *   엔진이 바뀌어도 산 결과는 그대로다. reports 서비스는 모르는 type 을 열람 불가로 보므로 리포트 목록·조회에는 섞이지 않는다.
 * - AI(설정 시): 상세가 열린 뒤 서술형 섹션만 한 번 다듬어 저장한다. 날짜별 근거는 규칙 기반 그대로 둔다.
 */
import { and, desc, eq } from 'drizzle-orm';
import { TAEKIL_PURPOSES, TaekilInputError, parseYmd, selectTaekilDays, taekilDateRange, ymdKey, type SajuChart, type TaekilPurpose, type TaekilSelection } from '@saju/core';
import { TAEKIL_LIMITS, TAEKIL_PRODUCT_ID, type ReadingSection, type TaekilCreateDto, type TaekilResultDto, type TaekilSummaryDto } from '@saju/shared';
import type { Db } from '../../db/client.js';
import { reports, type Report } from '../../db/schema.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { AiService } from '../ai/service.js';
import type { CommerceService } from '../commerce/service.js';
import type { ProfileService } from '../profiles/service.js';
import { todayInSeoul } from '../saju/routes.js';
import { AI_SECTION_KEYS, TAEKIL_DISCLAIMER, basisOf, buildSections, dayDtos, headlineOf, lockedSections, type TaekilTextContext } from './content.js';

export const TAEKIL_REPORT_TYPE = 'taekil';
export const taekilKey = (id: string) => `taekil:reading:${id}`;

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
  const unlocked = (userId: string, r: Report) => commerce.isPremium(userId) || commerce.hasEntitlement(userId, taekilKey(r.id));
  const stored = (r: Report) => r.content as StoredTaekil;

  const ownedRow = (userId: string, id: string): Report => {
    const r = db.select().from(reports).where(and(eq(reports.id, id), eq(reports.userId, userId), eq(reports.type, TAEKIL_REPORT_TYPE))).get();
    if (!r) throw notFound('택일 결과를 찾을 수 없어요.');
    return r;
  };

  const ctxOf = (s: StoredTaekil): TaekilTextContext => ({ purpose: s.purpose, mode: s.mode, profileName: s.profileName, partnerName: s.partnerName, chart: s.chart, sel: s.selection });

  /** 상세가 열린 뒤 서술형 섹션을 AI 로 한 번 다듬어 저장 (키가 없거나 실패하면 null → 규칙 기반 그대로) */
  const ensureAi = async (r: Report, draft: ReadingSection[]): Promise<ReadingSection[] | null> => {
    const s = stored(r);
    if (s.ai?.sections.length) return s.ai.sections;
    if (!ai.enabled) return null;
    const running = inflight.get(r.id);
    if (running) return running;
    const job = ai
      .enhanceSections({ title: r.title, chart: s.chart, draft: draft.filter((x) => AI_SECTION_KEYS.includes(x.key)) })
      .then((res) => {
        if (res.generator !== 'ai') return null;
        const fresh = db.select().from(reports).where(eq(reports.id, r.id)).get();
        if (fresh) db.update(reports).set({ content: { ...(fresh.content as StoredTaekil), ai: { sections: res.sections, model: res.model } }, generator: 'ai', model: res.model }).where(eq(reports.id, r.id)).run();
        return res.sections;
      })
      .catch(() => null)
      .finally(() => inflight.delete(r.id));
    inflight.set(r.id, job);
    return job;
  };

  const view = async (userId: string, r: Report): Promise<TaekilResultDto> => {
    const s = stored(r);
    const ctx = ctxOf(s);
    const isUnlocked = unlocked(userId, r);
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

  const summary = (userId: string, r: Report): TaekilSummaryDto => {
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
      locked: !unlocked(userId, r),
      createdAt: new Date(r.createdAt).toISOString(),
    };
  };

  return {
    unlocked,

    async create(userId: string, dto: TaekilCreateDto): Promise<TaekilResultDto> {
      const profile = profiles.getOwned(userId, dto.profileId);
      const chart = profiles.chartOf(profile);
      const purpose = dto.purpose as TaekilPurpose;
      let partner: { id: string; name: string; chart: SajuChart } | null = null;
      if (purpose === 'wedding' && dto.partnerProfileId) {
        if (dto.partnerProfileId === profile.id) throw badRequest('서로 다른 두 사람을 골라 주세요.');
        const p = profiles.getOwned(userId, dto.partnerProfileId);
        partner = { id: p.id, name: p.name, chart: profiles.chartOf(p) };
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

      // 같은 입력이면 저장본으로 안내(이미 산 결과를 다시 사지 않게)
      const key = [purpose, profile.id, partner?.id ?? '', mode, dates.join(',')].join('|');
      const existing = db
        .select()
        .from(reports)
        .where(and(eq(reports.userId, userId), eq(reports.type, TAEKIL_REPORT_TYPE), eq(reports.profileId, profile.id)))
        .orderBy(desc(reports.createdAt))
        .all()
        .find((r) => stored(r).key === key);
      if (existing) return view(userId, existing);

      const selection = selectTaekilDays(chart, purpose, dates.map(parseYmd), { partner: partner?.chart ?? null });
      const from = dates[0]!;
      const to = dates[dates.length - 1]!;
      const range = mode === 'range' ? ` (${Number(from.slice(5, 7))}.${Number(from.slice(8))}~${Number(to.slice(5, 7))}.${Number(to.slice(8))})` : '';
      const title = partner ? `${profile.name}·${partner.name}님의 결혼 택일${range}` : `${profile.name}님의 ${TAEKIL_PURPOSES[purpose].label} 택일${range}`;
      const content: StoredTaekil = { v: 1, key, purpose, mode, from, to, profileName: profile.name, partnerName: partner?.name ?? null, chart, selection };
      const id = newId();
      db.insert(reports).values({ id, userId, profileId: profile.id, partnerProfileId: partner?.id ?? null, type: TAEKIL_REPORT_TYPE, year: null, title, content, generator: 'rule', model: null }).run();
      return view(userId, ownedRow(userId, id));
    },

    get(userId: string, id: string): Promise<TaekilResultDto> {
      return view(userId, ownedRow(userId, id));
    },

    list(userId: string): TaekilSummaryDto[] {
      return db
        .select()
        .from(reports)
        .where(and(eq(reports.userId, userId), eq(reports.type, TAEKIL_REPORT_TYPE)))
        .orderBy(desc(reports.createdAt))
        .limit(100)
        .all()
        .map((r) => summary(userId, r));
    },

    /** 결제 전 확인 — 내 택일 결과이고 이 상품으로 열 수 있는가 */
    assertPurchasable(userId: string, readingId: string, productId: string) {
      ownedRow(userId, readingId);
      if (productId !== TAEKIL_PRODUCT_ID) throw badRequest('이 택일 결과에 맞지 않는 상품이에요.');
    },
  };
}

export type TaekilService = ReturnType<typeof createTaekilService>;
