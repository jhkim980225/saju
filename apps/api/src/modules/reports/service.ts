/**
 * 유료 리포트 — 권한 확인 → 규칙 기반 생성 → (AI 설정 시) 문장 고도화 → 저장.
 * 같은 조건의 리포트는 재생성하지 않고 저장본을 돌려준다(AI 비용 절감).
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { calculateCompatibility } from '@saju/core';
import type { ReadingSection, ReportCreateDto, ReportDto, ReportSummaryDto, ReportType } from '@saju/shared';
import type { Db } from '../../db/client.js';
import { profiles as profilesTable, reports, type Report } from '../../db/schema.js';
import { badRequest, notFound, paymentRequired } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import type { AiService } from '../ai/service.js';
import { compatKey, type CommerceService } from '../commerce/service.js';
import { targetFortuneYear, yearPillarHangul, type ReadingAccess } from '../interpretation/reading.js';
import { buildCompatibilityReport, buildSajuAnalysis, buildYearlyReport } from '../interpretation/report.js';
import type { ProfileService } from '../profiles/service.js';

export function createReportService(db: Db, profiles: ProfileService, commerce: CommerceService, ai: AiService) {
  const access = (userId: string, profileId: string): ReadingAccess => {
    if (commerce.isPremium(userId) || commerce.hasEntitlement(userId, `report:lifetime:${profileId}`)) return 'full';
    if (commerce.hasEntitlement(userId, `report:mini:${profileId}`)) return 'mini';
    return 'none';
  };
  const yearlyUnlocked = (userId: string, profileId: string, year: number) =>
    commerce.isPremium(userId) || commerce.hasEntitlement(userId, `report:yearly:${profileId}:${year}`);
  const compatUnlocked = (userId: string, a: string, b: string) => commerce.isPremium(userId) || commerce.hasEntitlement(userId, compatKey(a, b));

  /** 저장된 리포트를 지금도 볼 권한이 있는가 (환불 후 열람 차단) */
  const canView = (userId: string, r: Report): boolean => {
    if (r.type === 'lifetime') return access(userId, r.profileId) === 'full';
    if (r.type === 'yearly') return r.year !== null && yearlyUnlocked(userId, r.profileId, r.year);
    if (r.type === 'compatibility') return r.partnerProfileId !== null && compatUnlocked(userId, r.profileId, r.partnerProfileId);
    return false;
  };
  /** 같은 조건의 리포트 동시 생성 방지(AI 중복 호출 차단) — 단일 인스턴스 기준 */
  const inflight = new Map<string, Promise<ReportDto>>();

  const toDto = (r: Report): ReportDto => ({
    id: r.id,
    type: r.type as ReportType,
    title: r.title,
    profileId: r.profileId,
    partnerProfileId: r.partnerProfileId,
    year: r.year,
    sections: r.content as ReadingSection[],
    generator: r.generator === 'ai' ? 'ai' : 'rule',
    createdAt: new Date(r.createdAt).toISOString(),
  });

  return {
    access,
    yearlyUnlocked,
    compatUnlocked,

    async create(userId: string, dto: Omit<ReportCreateDto, 'year'> & { year?: number }): Promise<ReportDto> {
      const flightKey = [userId, dto.type, dto.profileId, dto.partnerProfileId ?? '', dto.year ?? ''].join('|');
      const running = inflight.get(flightKey);
      if (running) return running;
      const job = this.createUncached(userId, dto).finally(() => inflight.delete(flightKey));
      inflight.set(flightKey, job);
      return job;
    },

    async createUncached(userId: string, dto: Omit<ReportCreateDto, 'year'> & { year?: number }): Promise<ReportDto> {
      const profile = profiles.getOwned(userId, dto.profileId);
      const chart = profiles.chartOf(profile);
      const now = new Date();
      let title: string;
      let sections: ReadingSection[];
      let year: number | null = null;
      let partnerId: string | null = null;

      switch (dto.type) {
        case 'lifetime': {
          if (access(userId, profile.id) !== 'full') throw paymentRequired('평생 사주분석서를 구매하면 볼 수 있어요.', { productId: 'report_saju_lifetime' });
          title = `${profile.name}님의 사주분석서`;
          sections = buildSajuAnalysis(chart, now);
          break;
        }
        case 'yearly': {
          year = dto.year ?? targetFortuneYear(now);
          if (!yearlyUnlocked(userId, profile.id, year)) throw paymentRequired(`${year} 신년운세를 구매하면 볼 수 있어요.`, { productId: `report_newyear_${year}` });
          title = `${profile.name}님의 ${year} ${yearPillarHangul(year)}년 신년운세`;
          sections = buildYearlyReport(chart, year);
          break;
        }
        case 'compatibility': {
          if (!dto.partnerProfileId) throw badRequest('궁합을 볼 상대 프로필을 선택해 주세요.');
          if (dto.partnerProfileId === profile.id) throw badRequest('서로 다른 두 사람을 선택해 주세요.');
          const partner = profiles.getOwned(userId, dto.partnerProfileId);
          partnerId = partner.id;
          if (!compatUnlocked(userId, profile.id, partner.id) && !commerce.redeemTicket(userId, 'compatibility', compatKey(profile.id, partner.id))) {
            throw paymentRequired('궁합 리포트를 구매하면 볼 수 있어요.', { productId: 'report_compat' });
          }
          const b = profiles.chartOf(partner);
          const result = calculateCompatibility(chart, b);
          title = `${profile.name} ♥ ${partner.name} 궁합 리포트`;
          sections = buildCompatibilityReport(chart, b, result, { a: profile.name, b: partner.name }, now);
          break;
        }
        default:
          throw badRequest('곧 출시될 리포트예요.');
      }

      // 동일 조건 저장본이 있으면 재사용
      const existing = db
        .select()
        .from(reports)
        .where(
          and(
            eq(reports.userId, userId),
            eq(reports.profileId, profile.id),
            eq(reports.type, dto.type),
            year === null ? isNull(reports.year) : eq(reports.year, year),
            partnerId === null ? isNull(reports.partnerProfileId) : eq(reports.partnerProfileId, partnerId),
          ),
        )
        .orderBy(desc(reports.createdAt))
        .get();
      if (existing) return toDto(existing);

      const enhanced = await ai.enhanceSections({ title, chart, draft: sections });
      const id = newId();
      db.insert(reports)
        .values({ id, userId, profileId: profile.id, partnerProfileId: partnerId, type: dto.type, year, title, content: enhanced.sections, generator: enhanced.generator, model: enhanced.model })
        .run();
      return toDto(db.select().from(reports).where(eq(reports.id, id)).get()!);
    },

    list(userId: string): ReportSummaryDto[] {
      const rows = db
        .select({ r: reports, name: profilesTable.name })
        .from(reports)
        .leftJoin(profilesTable, eq(profilesTable.id, reports.profileId))
        .where(eq(reports.userId, userId))
        .orderBy(desc(reports.createdAt))
        .all();
      return rows.filter(({ r }) => canView(userId, r)).map(({ r, name }) => ({ id: r.id, type: r.type as ReportType, title: r.title, profileName: name ?? '삭제된 프로필', createdAt: new Date(r.createdAt).toISOString() }));
    },

    get(userId: string, id: string): ReportDto {
      const r = db.select().from(reports).where(and(eq(reports.id, id), eq(reports.userId, userId))).get();
      if (!r) throw notFound('리포트를 찾을 수 없어요.');
      if (!canView(userId, r)) throw paymentRequired('환불되었거나 열람 권한이 없는 리포트예요.');
      return toDto(r);
    },
  };
}

export type ReportService = ReturnType<typeof createReportService>;
