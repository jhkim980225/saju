/**
 * 유료 리포트(사주분석서 · 신년운세 · 궁합 · 연애·결혼운 · 재물·직업운)
 * — 권한 확인 → 규칙 기반 생성·저장(즉시 응답) → (AI 설정 시) 뒤에서 문장 다듬기 → 같은 행을 최종본으로 교체.
 * - 결제가 확정되면 지급 알림으로 미리 만들기 시작한다(prewarm). 사용자가 처음 열 때는 이미 다듬는 중이거나 끝나 있다.
 * - 같은 조건의 리포트는 다시 만들지 않고 저장본을 돌려준다(AI 비용 절감).
 *   같은 대상 리포트는 DB 유니크 인덱스(reports_target_uq)로 하나만 저장된다 — 동시에 만들면 먼저 저장된 것을 쓴다.
 * - 다듬기는 응답 뒤 작업(background — Worker 는 Queue, Node 는 같은 프로세스)으로 돌린다. 요청마다 다른 인스턴스가 받으므로
 *   진행률과 담당 기한(lease)은 DB 에 둔다. 기한이 지나도록 진행 소식이 없으면(작업이 죽음) 다음 열람 때 처음부터 다시 다듬는다.
 */
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { calculateCompatibility } from '@saju/core';
import type { ReadingSection, ReportCreateDto, ReportDto, ReportProgressDto, ReportSummaryDto, ReportType } from '@saju/shared';
import type { Db } from '../../db/client.js';
import { profiles as profilesTable, reports, type Report } from '../../db/schema.js';
import { badRequest, notFound, paymentRequired } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { polishChunkCount, type AiService } from '../ai/service.js';
import { compatKey, type CommerceService, type FulfilledEvent } from '../commerce/service.js';
import { buildCareerWealthReport } from '../interpretation/careerWealthReport.js';
import { buildLoveReport } from '../interpretation/loveReport.js';
import { targetFortuneYear, yearPillarHangul, type ReadingAccess } from '../interpretation/reading.js';
import { buildCompatibilityReport, buildSajuAnalysis, buildYearlyReport } from '../interpretation/report.js';
import type { ProfileService } from '../profiles/service.js';

type CreateInput = Omit<ReportCreateDto, 'year'> & { year?: number };

/** 응답 뒤에 이어 할 작업 — 맡긴 작업이 시작되면(Queue 는 보내지면) 끝난다 */
export type BackgroundJob = { kind: 'polish'; reportId: string };
export type StartJob = (job: BackgroundJob) => Promise<void>;

/** 다듬기 담당 기한 — 덩어리 하나가 끝날 때마다 늘린다. 덩어리 호출 제한 시간(2분)보다 넉넉하게 */
export const POLISH_LEASE_MS = 5 * 60_000;

/**
 * 프로필 하나에 대한 주제별 리포트 — 권한 키 report:<type>:<profileId> (카탈로그 grant report:<type>)
 * 평생 사주분석서와 같은 방식: 구매한 프로필만 열리고, 같은 프로필은 저장본을 다시 쓴다.
 */
const TOPIC_REPORTS = {
  love: { productId: 'report_love', name: '연애·결혼운 리포트', build: buildLoveReport },
  career_wealth: { productId: 'report_career_wealth', name: '재물·직업운 리포트', build: buildCareerWealthReport },
} as const;
type TopicReportType = keyof typeof TOPIC_REPORTS;
const isTopicReport = (type: string): type is TopicReportType => Object.hasOwn(TOPIC_REPORTS, type);

export function createReportService(db: Db, profiles: ProfileService, commerce: CommerceService, ai: AiService, startJob: StartJob) {
  const access = async (userId: string, profileId: string): Promise<ReadingAccess> => {
    if ((await commerce.isPremium(userId)) || (await commerce.hasEntitlement(userId, `report:lifetime:${profileId}`))) return 'full';
    if (await commerce.hasEntitlement(userId, `report:mini:${profileId}`)) return 'mini';
    return 'none';
  };
  const yearlyUnlocked = async (userId: string, profileId: string, year: number) =>
    (await commerce.isPremium(userId)) || commerce.hasEntitlement(userId, `report:yearly:${profileId}:${year}`);
  const compatUnlocked = async (userId: string, a: string, b: string) => (await commerce.isPremium(userId)) || commerce.hasEntitlement(userId, compatKey(a, b));
  const topicUnlocked = async (userId: string, type: TopicReportType, profileId: string) =>
    (await commerce.isPremium(userId)) || commerce.hasEntitlement(userId, `report:${type}:${profileId}`);

  /** 저장된 리포트를 지금도 볼 권한이 있는가 (환불 후 열람 차단) */
  const canView = async (userId: string, r: Report): Promise<boolean> => {
    if (r.type === 'lifetime') return (await access(userId, r.profileId)) === 'full';
    if (r.type === 'yearly') return r.year !== null && yearlyUnlocked(userId, r.profileId, r.year);
    if (r.type === 'compatibility') return r.partnerProfileId !== null && compatUnlocked(userId, r.profileId, r.partnerProfileId);
    if (isTopicReport(r.type)) return topicUnlocked(userId, r.type, r.profileId);
    return false;
  };

  const toDto = (r: Report): ReportDto => {
    const running = r.generator === 'polishing';
    return {
      id: r.id,
      type: r.type as ReportType,
      title: r.title,
      profileId: r.profileId,
      partnerProfileId: r.partnerProfileId,
      year: r.year,
      sections: r.content as ReadingSection[],
      generator: r.generator === 'ai' ? 'ai' : 'rule',
      status: running ? 'polishing' : 'ready',
      progress: running ? { done: r.polishDone, total: r.polishTotal } : null,
      createdAt: new Date(r.createdAt).toISOString(),
    };
  };

  const stillPolishing = (id: string) => and(eq(reports.id, id), eq(reports.generator, 'polishing'));

  /**
   * 다듬기 맡기기 — 담당 기한이 비었거나 지났을 때만 맡는다(조건부 UPDATE: 같은 리포트를 두 작업이 다듬지 않게).
   * 진행률 총량을 정해 두고 작업을 넘긴 뒤, 갱신된 행을 돌려준다. 끝나기를 기다리지는 않는다
   */
  const startPolish = async (r: Report): Promise<Report> => {
    const now = Date.now();
    const [claimed] = await db
      .update(reports)
      .set({ polishDone: 0, polishTotal: polishChunkCount(r.content as ReadingSection[]), polishLeaseUntil: now + POLISH_LEASE_MS })
      .where(and(stillPolishing(r.id), or(isNull(reports.polishLeaseUntil), lt(reports.polishLeaseUntil, now))))
      .returning();
    if (!claimed) return (await db.select().from(reports).where(eq(reports.id, r.id)))[0] ?? r;
    await startJob({ kind: 'polish', reportId: r.id });
    return claimed;
  };

  /**
   * 다듬기 작업 본체(background) — 끝나면(실패해도) 같은 행을 최종본으로 바꾼다.
   * started 는 AI 호출을 건 직후 불린다(같은 프로세스에서 돌릴 때 호출이 나간 뒤 응답하게).
   */
  const runPolish = async (reportId: string, started?: () => void): Promise<void> => {
    const [r] = await db.select().from(reports).where(stillPolishing(reportId));
    if (!r) return;
    // 진행 기록은 순서대로 — 앞의 기록이 늦게 끝나 뒤의 기록을 덮지 않게
    let writes = Promise.resolve();
    const record = (done: number, total: number) => {
      writes = writes
        .then(async () => {
          await db.update(reports).set({ polishDone: done, polishTotal: total, polishLeaseUntil: Date.now() + POLISH_LEASE_MS }).where(stillPolishing(reportId));
        })
        .catch((error: unknown) => console.error('[reports] 다듬기 진행 기록 실패', error));
    };
    const finish = async (set: Partial<Pick<Report, 'content' | 'generator' | 'model'>>) => {
      await writes;
      try {
        // 다듬는 사이 탈퇴로 행이 지워졌을 수 있다 — 아직 다듬는 중인 행만 바꾼다
        await db.update(reports).set({ ...set, polishLeaseUntil: null }).where(stillPolishing(reportId));
      } catch (error) {
        console.error('[reports] 다듬은 본문 저장 실패', error);
      }
    };
    let job: ReturnType<AiService['enhanceSections']>;
    try {
      const chart = profiles.chartOf(await profiles.getOwned(r.userId, r.profileId));
      job = ai.enhanceSections({ title: r.title, chart, draft: r.content as ReadingSection[], onProgress: record });
    } catch (error) {
      job = Promise.reject(error);
    }
    started?.();
    try {
      const e = await job;
      await finish({ content: e.sections, generator: e.generator, model: e.model });
    } catch (error) {
      console.error('[reports] AI 다듬기 실패 — 규칙 기반 본문으로 마무리', error);
      await finish({ generator: 'rule' });
    }
  };

  /** 끊긴 다듬기(담당 기한이 지나도록 진행 소식 없음)를 처음부터 다시 한다. 그 사이 AI 키를 뺐다면 규칙 기반으로 마무리 */
  const resumeIfStalled = async (r: Report): Promise<Report> => {
    if (r.generator !== 'polishing' || (r.polishLeaseUntil !== null && r.polishLeaseUntil >= Date.now())) return r;
    if (ai.enabled) return startPolish(r);
    await db.update(reports).set({ generator: 'rule', polishLeaseUntil: null }).where(eq(reports.id, r.id));
    return { ...r, generator: 'rule' };
  };

  const create = async (userId: string, dto: CreateInput): Promise<ReportDto> => {
    const profile = await profiles.getOwned(userId, dto.profileId);
    const now = new Date();
    let title: string;
    let build: () => ReadingSection[];
    let year: number | null = null;
    let partnerId: string | null = null;

    switch (dto.type) {
      case 'lifetime': {
        if ((await access(userId, profile.id)) !== 'full') throw paymentRequired('평생 사주분석서를 구매하면 볼 수 있어요.', { productId: 'report_saju_lifetime' });
        title = `${profile.name}님의 사주분석서`;
        build = () => buildSajuAnalysis(profiles.chartOf(profile), now, profile.name);
        break;
      }
      case 'yearly': {
        const y = dto.year ?? targetFortuneYear(now);
        year = y;
        if (!(await yearlyUnlocked(userId, profile.id, y))) throw paymentRequired(`${y} 신년운세를 구매하면 볼 수 있어요.`, { productId: `report_newyear_${y}` });
        title = `${profile.name}님의 ${y} ${yearPillarHangul(y)}년 신년운세`;
        build = () => buildYearlyReport(profiles.chartOf(profile), y, profile.name);
        break;
      }
      case 'compatibility': {
        if (!dto.partnerProfileId) throw badRequest('궁합을 볼 상대 프로필을 선택해 주세요.');
        if (dto.partnerProfileId === profile.id) throw badRequest('서로 다른 두 사람을 선택해 주세요.');
        const partner = await profiles.getOwned(userId, dto.partnerProfileId);
        partnerId = partner.id;
        // 이미 열린 조합이면 1회권을 쓰지 않는다 — 같은 궁합을 다시 열어도 두 번 차감되지 않는다.
        // 1회권이 없을 때 한 번 더 확인 — 동시에 연 다른 요청이 방금 1회권으로 이 조합을 열었을 수 있다
        const key = compatKey(profile.id, partner.id);
        if (!(await compatUnlocked(userId, profile.id, partner.id)) && !(await commerce.redeemTicket(userId, 'compatibility', key)) && !(await compatUnlocked(userId, profile.id, partner.id))) {
          throw paymentRequired('궁합 리포트를 구매하면 볼 수 있어요.', { productId: 'report_compat' });
        }
        title = `${profile.name} ♥ ${partner.name} 궁합 리포트`;
        build = () => {
          const a = profiles.chartOf(profile);
          const b = profiles.chartOf(partner);
          return buildCompatibilityReport(a, b, calculateCompatibility(a, b), { a: profile.name, b: partner.name }, now);
        };
        break;
      }
      case 'love':
      case 'career_wealth': {
        const topic = TOPIC_REPORTS[dto.type];
        if (!(await topicUnlocked(userId, dto.type, profile.id))) throw paymentRequired(`${topic.name}를 구매하면 볼 수 있어요.`, { productId: topic.productId });
        title = `${profile.name}님의 ${topic.name}`;
        build = () => topic.build(profiles.chartOf(profile), now, profile.name);
        break;
      }
      default:
        throw badRequest('곧 출시될 리포트예요.');
    }

    // 동일 조건 저장본이 있으면 재사용 (결제 직후 미리 만든 것 포함)
    const findExisting = async () =>
      (
        await db
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
          .orderBy(desc(reports.createdAt), desc(reports.id))
          .limit(1)
      )[0];
    const existing = await findExisting();
    if (existing) return toDto(await resumeIfStalled(existing));

    // 규칙 기반 본문은 수 ms 안에 만들어진다 — 먼저 저장해 바로 보여 주고, AI 는 뒤에서 다듬는다
    const id = newId();
    const inserted = await db
      .insert(reports)
      .values({ id, userId, profileId: profile.id, partnerProfileId: partnerId, type: dto.type, year, title, content: build(), generator: ai.enabled ? 'polishing' : 'rule', model: null })
      .onConflictDoNothing()
      .returning();
    const row = inserted[0];
    // 동시에 만든 다른 요청이 먼저 저장했다 — 그 저장본을 쓴다(다듬기도 그쪽이 맡는다)
    if (!row) return toDto(await resumeIfStalled((await findExisting())!));
    return toDto(ai.enabled ? await startPolish(row) : row);
  };

  const get = async (userId: string, id: string): Promise<ReportDto> => {
    const [r] = await db.select().from(reports).where(and(eq(reports.id, id), eq(reports.userId, userId)));
    if (!r) throw notFound('리포트를 찾을 수 없어요.');
    if (!(await canView(userId, r))) throw paymentRequired('환불되었거나 열람 권한이 없는 리포트예요.');
    return toDto(await resumeIfStalled(r));
  };

  return {
    access,
    yearlyUnlocked,
    compatUnlocked,
    topicUnlocked,
    create,
    get,
    runPolish,

    /** 다듬기 진행 — 화면은 본문 대신 이것만 폴링하다가 ready 가 되면 본문을 다시 받는다 */
    async progress(userId: string, id: string): Promise<ReportProgressDto> {
      const { status, progress } = await get(userId, id);
      return { status, progress };
    },

    /**
     * 결제 지급 직후 — 산 리포트를 미리 만든다(규칙 기반 저장 + AI 다듬기 시작).
     * 궁합 1회권·미니 리포트·구독은 대상 리포트가 정해지지 않아 건너뛴다. 실패해도 결제에는 영향이 없다(처음 열 때 다시 만든다).
     */
    async prewarm(e: FulfilledEvent) {
      for (const key of e.entitlements) {
        const [kind, type, profileId, year] = key.split(':');
        let dto: CreateInput | null = null;
        if (kind !== 'report' || !profileId) continue;
        if (type === 'lifetime') dto = { type: 'lifetime', profileId };
        else if (type && isTopicReport(type)) dto = { type, profileId };
        else if (type === 'yearly') dto = { type: 'yearly', profileId, year: Number(year) };
        // 권한 키는 두 ID 를 정렬해 두므로, 화면이 여는 순서(주문의 profileId → partnerProfileId)로 만든다
        else if (type === 'compatibility' && e.profileId && e.partnerProfileId) dto = { type: 'compatibility', profileId: e.profileId, partnerProfileId: e.partnerProfileId };
        if (!dto) continue;
        try {
          await create(e.userId, dto);
        } catch (error) {
          console.warn(`[reports] 결제 후 미리 만들기 실패 (${key})`, error);
        }
      }
    },

    async list(userId: string): Promise<ReportSummaryDto[]> {
      const rows = await db
        .select({ r: reports, name: profilesTable.name })
        .from(reports)
        .leftJoin(profilesTable, eq(profilesTable.id, reports.profileId))
        .where(eq(reports.userId, userId))
        .orderBy(desc(reports.createdAt), desc(reports.id));
      const visible = await Promise.all(rows.map(({ r }) => canView(userId, r)));
      return rows.filter((_, i) => visible[i]).map(({ r, name }) => ({ id: r.id, type: r.type as ReportType, title: r.title, profileName: name ?? '삭제된 프로필', createdAt: new Date(r.createdAt).toISOString() }));
    },
  };
}

export type ReportService = ReturnType<typeof createReportService>;
