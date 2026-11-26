/**
 * 유료 리포트(사주분석서 · 신년운세 · 궁합 · 연애·결혼운 · 재물·직업운)
 * — 권한 확인 → 규칙 기반 생성·저장(즉시 응답) → (AI 설정 시) 뒤에서 문장 다듬기 → 같은 행을 최종본으로 교체.
 * - 결제가 확정되면 지급 알림으로 미리 만들기 시작한다(prewarm). 사용자가 처음 열 때는 이미 다듬는 중이거나 끝나 있다.
 * - 같은 조건의 리포트는 다시 만들지 않고 저장본을 돌려준다(AI 비용 절감).
 *   같은 대상 리포트는 DB 유니크 인덱스(reports_target_uq)로 하나만 저장된다 — 동시에 만들면 먼저 저장된 것을 쓴다.
 * - 다듬기는 응답 뒤 작업(background — Worker 는 Queue, Node 는 같은 프로세스)으로 돌린다. 요청마다 다른 인스턴스가 받으므로
 *   진행률과 담당 기한(lease)은 DB 에 둔다. 다듬는 동안에는 1분마다 기한을 늘리고, 기한이 지나도록 진행 소식이 없으면(작업이 죽음)
 *   다음 열람 때 처음부터 다시 다듬는다.
 * - 날짜에 따라 달라지는 리포트('올해·내년', '가까운 3년')는 만든 때와 지금의 기준 연도가 다르면, 이름이 들어간 제목이 지금 프로필 이름과
 *   다르면 열 때 같은 행을 새 본문으로 바꾼다(refreshIfStale).
 */
import { and, asc, desc, eq, isNull, like, lt, ne, or } from 'drizzle-orm';
import { calculateCompatibility } from '@saju/core';
import { REPORT_TYPES, type ReadingSection, type ReportCreateDto, type ReportDto, type ReportProgressDto, type ReportSummaryDto, type ReportType } from '@saju/shared';
import { kstYear } from '@saju/shared/fortune-year';
import type { Db } from '../../db/client.js';
import { entitlements, products as productsTable, profiles as profilesTable, reports, type Profile, type Report } from '../../db/schema.js';
import { badRequest, notFound, paymentRequired } from '../../lib/errors.js';
import { safeErrorText } from '../../lib/log.js';
import { newId } from '../../lib/ids.js';
import { polishChunkCount, type AiService } from '../ai/service.js';
import { compatKey, type CommerceService, type FulfilledEvent } from '../commerce/service.js';
import { buildCareerWealthReport } from '../interpretation/careerWealthReport.js';
import { buildLoveReport } from '../interpretation/loveReport.js';
import { targetFortuneYear, type ReadingAccess } from '../interpretation/reading.js';
import { buildCompatibilityReport, buildSajuAnalysis, buildYearlyReport } from '../interpretation/report.js';
import type { ProfileService } from '../profiles/service.js';

type CreateInput = Omit<ReportCreateDto, 'year'> & { year?: number };

/** 응답 뒤에 이어 할 작업 — 맡긴 작업이 시작되면(Queue 는 보내지면) 끝난다 */
export type BackgroundJob = { kind: 'polish'; reportId: string };
export type StartJob = (job: BackgroundJob) => Promise<void>;

/**
 * 다듬기 담당 기한 — 덩어리 하나가 끝날 때마다, 그리고 다듬는 동안 POLISH_HEARTBEAT_MS 마다 늘린다.
 * 덩어리 하나는 제한 시간 120초에 재시도 2회라 기한보다 오래 걸릴 수 있으므로, 덩어리 완료만으로 늘리면
 * 살아 있는 작업의 기한이 지나 다른 요청이 처음부터 다시 맡는다(AI 비용 두 번). 그래서 작업이 살아 있는 동안 주기적으로 늘린다
 */
export const POLISH_LEASE_MS = 5 * 60_000;
/** 다듬는 동안 담당 기한을 늘리는 간격 — 기한(5분)보다 충분히 짧게 */
export const POLISH_HEARTBEAT_MS = 60_000;

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
const isReportType = (type: string): type is ReportType => (REPORT_TYPES as readonly string[]).includes(type);

/** 권한 확인에 필요한 리포트 칸 — 본문 없이 읽어도 판정할 수 있게 */
type ReportTarget = Pick<Report, 'type' | 'profileId' | 'partnerProfileId' | 'year'>;

/** 저장된 리포트를 열 수 있게 하는 권한 키(하나라도 있으면 열린다) */
function viewKeys(r: ReportTarget): string[] {
  if (r.type === 'lifetime') return [`report:lifetime:${r.profileId}`];
  if (r.type === 'yearly') return r.year === null ? [] : [`report:yearly:${r.profileId}:${r.year}`];
  if (r.type === 'compatibility') return r.partnerProfileId === null ? [] : [compatKey(r.profileId, r.partnerProfileId)];
  if (isTopicReport(r.type)) return [`report:${r.type}:${r.profileId}`];
  return [];
}

/** 본문이 만든 날짜에 기대는가 — 신년운세는 연도가 정해져 있어 날짜와 무관하다 */
const dependsOnDate = (type: ReportType) => type !== 'yearly';
/** 본문의 날짜 기준이 같은가 — '올해'(KST 연도)와 대상 연도(10월부터 다음 해)가 모두 같아야 같은 본문이다 */
const sameBasis = (a: Date, b: Date) => kstYear(a) === kstYear(b) && targetFortuneYear(a) === targetFortuneYear(b);

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

  /** 사용자가 지금 가진 권한 키 전부(만료 제외) — 보관함 목록처럼 여러 리포트를 한 번에 판정할 때 한 번만 읽는다 */
  const ownedKeys = async (userId: string): Promise<Set<string>> => {
    const now = Date.now();
    const rows = await db.select({ key: entitlements.key, expiresAt: entitlements.expiresAt }).from(entitlements).where(and(eq(entitlements.userId, userId), like(entitlements.key, 'report:%')));
    return new Set(rows.filter((r) => r.expiresAt === null || r.expiresAt > now).map((r) => r.key));
  };

  /** 저장된 리포트를 지금도 볼 권한이 있는가 (환불 후 열람 차단) */
  const canView = async (userId: string, r: ReportTarget): Promise<boolean> => {
    const keys = viewKeys(r);
    if (keys.length === 0) return false;
    if (await commerce.isPremium(userId)) return true;
    const owned = await ownedKeys(userId);
    return keys.some((k) => owned.has(k));
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
    try {
      await startJob({ kind: 'polish', reportId: r.id });
    } catch (error) {
      // 대기열에 넣지 못했다 — 열람은 규칙 기반 본문으로 그대로 응답하고, 담당 기한을 비워 다음 열람·진행률 조회 때 다시 맡긴다
      console.error('[reports] 다듬기 작업을 맡기지 못함 — 다음 조회 때 다시 맡긴다', safeErrorText(error));
      await db.update(reports).set({ polishLeaseUntil: null }).where(stillPolishing(r.id));
      return { ...claimed, polishLeaseUntil: null };
    }
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
        .catch((error: unknown) => console.error('[reports] 다듬기 진행 기록 실패', safeErrorText(error)));
    };
    // 덩어리 하나가 오래 걸려도(제한 시간·재시도) 살아 있는 동안은 담당 기한을 늘린다 — 다른 요청이 같은 리포트를 다시 맡지 않게
    const heartbeat = setInterval(() => {
      writes = writes
        .then(async () => {
          await db.update(reports).set({ polishLeaseUntil: Date.now() + POLISH_LEASE_MS }).where(stillPolishing(reportId));
        })
        .catch((error: unknown) => console.error('[reports] 다듬기 담당 기한 연장 실패', safeErrorText(error)));
    }, POLISH_HEARTBEAT_MS);
    (heartbeat as { unref?: () => void }).unref?.();
    const finish = async (set: Partial<Pick<Report, 'content' | 'generator' | 'model'>>) => {
      clearInterval(heartbeat);
      await writes;
      try {
        // 다듬는 사이 탈퇴로 행이 지워졌을 수 있다 — 아직 다듬는 중인 행만 바꾼다
        await db.update(reports).set({ ...set, polishLeaseUntil: null }).where(stillPolishing(reportId));
      } catch (error) {
        console.error('[reports] 다듬은 본문 저장 실패', safeErrorText(error));
      }
    };
    let job: ReturnType<AiService['enhanceSections']>;
    try {
      // 프로필을 지웠으면 원국을 알 수 없다 — 규칙 기반 본문으로 마무리한다
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
      console.error('[reports] AI 다듬기 실패 — 규칙 기반 본문으로 마무리', safeErrorText(error));
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

  /** 리포트 제목과 본문 만들기 — 처음 만들 때와 날짜 기준·이름이 바뀌어 다시 만들 때 함께 쓴다 */
  const planOf = (type: ReportType, profile: Profile, partner: Profile | null, year: number | null, now: Date): { title: string; build: () => ReadingSection[] } => {
    switch (type) {
      case 'lifetime':
        return { title: `${profile.name}님의 사주분석서`, build: () => buildSajuAnalysis(profiles.chartOf(profile), now, profile.name) };
      case 'yearly': {
        const y = year ?? targetFortuneYear(now);
        return { title: `${profile.name}님의 ${y} 신년운세`, build: () => buildYearlyReport(profiles.chartOf(profile), y, profile.name) };
      }
      case 'compatibility': {
        const p = partner!;
        return {
          title: `${profile.name} ♥ ${p.name} 궁합 리포트`,
          build: () => {
            const a = profiles.chartOf(profile);
            const b = profiles.chartOf(p);
            return buildCompatibilityReport(a, b, calculateCompatibility(a, b), { a: profile.name, b: p.name }, now);
          },
        };
      }
      case 'love':
      case 'career_wealth': {
        const topic = TOPIC_REPORTS[type];
        return { title: `${profile.name}님의 ${topic.name}`, build: () => topic.build(profiles.chartOf(profile), now, profile.name) };
      }
    }
  };

  const findProfile = async (userId: string, id: string | null): Promise<Profile | null> =>
    id === null ? null : ((await db.select().from(profilesTable).where(and(eq(profilesTable.id, id), eq(profilesTable.userId, userId))))[0] ?? null);

  /**
   * 저장본이 지금과 맞지 않으면 같은 행을 새 본문으로 바꾼다 — 만든 때와 지금의 날짜 기준('올해'·대상 연도)이 다르거나,
   * 프로필 이름이 바뀌어 제목이 달라졌을 때. 다듬는 중인 행과 프로필을 지운 리포트는 그대로 둔다.
   * 두 요청이 함께 열어도 한 번만 바꾼다(만든 시각이 그대로인 행만 바꾸는 조건부 UPDATE)
   */
  const refreshIfStale = async (r: Report): Promise<Report> => {
    if (!isReportType(r.type) || r.generator === 'polishing') return r;
    const profile = await findProfile(r.userId, r.profileId);
    const partner = r.type === 'compatibility' ? await findProfile(r.userId, r.partnerProfileId) : null;
    if (!profile || (r.type === 'compatibility' && !partner)) return r;
    const now = new Date();
    const plan = planOf(r.type, profile, partner, r.year, now);
    if (plan.title === r.title && (!dependsOnDate(r.type) || sameBasis(new Date(r.createdAt), now))) return r;
    const [row] = await db
      .update(reports)
      .set({ title: plan.title, content: plan.build(), generator: ai.enabled ? 'polishing' : 'rule', model: null, polishDone: 0, polishTotal: 0, polishLeaseUntil: null, createdAt: now.getTime() })
      .where(and(eq(reports.id, r.id), eq(reports.createdAt, r.createdAt), ne(reports.generator, 'polishing')))
      .returning();
    if (!row) return (await db.select().from(reports).where(eq(reports.id, r.id)))[0] ?? r;
    return ai.enabled ? startPolish(row) : row;
  };

  /** 열람 직전 정리 — 끊긴 다듬기는 다시 맡기고, 낡은 저장본은 새로 만든다 */
  const prepare = async (r: Report): Promise<Report> => refreshIfStale(await resumeIfStalled(r));

  const create = async (userId: string, dto: CreateInput): Promise<ReportDto> => {
    const profile = await profiles.getOwned(userId, dto.profileId);
    const now = new Date();
    let year: number | null = null;
    let partner: Profile | null = null;

    switch (dto.type) {
      case 'lifetime': {
        if ((await access(userId, profile.id)) !== 'full') throw paymentRequired('평생 사주분석서를 구매하면 볼 수 있어요.', { productId: 'report_saju_lifetime' });
        break;
      }
      case 'yearly': {
        const y = dto.year ?? targetFortuneYear(now);
        year = y;
        if (!(await yearlyUnlocked(userId, profile.id, y))) {
          // 상품이 없는 연도(?year= 로 연 지난해·먼 미래)는 살 수 있는 상품이 없다 — 없는 상품 ID 를 결제 안내로 보내지 않는다
          const productId = `report_newyear_${y}`;
          const [product] = await db.select({ id: productsTable.id }).from(productsTable).where(and(eq(productsTable.id, productId), eq(productsTable.active, true)));
          if (!product) throw badRequest(`${y}년 신년운세는 판매하지 않아요.`);
          throw paymentRequired(`${y} 신년운세를 구매하면 볼 수 있어요.`, { productId });
        }
        break;
      }
      case 'compatibility': {
        if (!dto.partnerProfileId) throw badRequest('궁합을 볼 상대 프로필을 선택해 주세요.');
        if (dto.partnerProfileId === profile.id) throw badRequest('서로 다른 두 사람을 선택해 주세요.');
        partner = await profiles.getOwned(userId, dto.partnerProfileId);
        // 이미 열린 조합이면 1회권을 쓰지 않는다 — 같은 궁합을 다시 열어도 두 번 차감되지 않는다.
        // 1회권이 없을 때 한 번 더 확인 — 동시에 연 다른 요청이 방금 1회권으로 이 조합을 열었을 수 있다
        const key = compatKey(profile.id, partner.id);
        if (!(await compatUnlocked(userId, profile.id, partner.id)) && !(await commerce.redeemTicket(userId, 'compatibility', key)) && !(await compatUnlocked(userId, profile.id, partner.id))) {
          throw paymentRequired('궁합 리포트를 구매하면 볼 수 있어요.', { productId: 'report_compat' });
        }
        break;
      }
      case 'love':
      case 'career_wealth': {
        const topic = TOPIC_REPORTS[dto.type];
        if (!(await topicUnlocked(userId, dto.type, profile.id))) throw paymentRequired(`${topic.name}를 구매하면 볼 수 있어요.`, { productId: topic.productId });
        break;
      }
      default:
        throw badRequest('곧 출시될 리포트예요.');
    }
    const partnerId = partner?.id ?? null;
    const plan = planOf(dto.type, profile, partner, year, now);

    /**
     * 동일 조건 저장본이 있으면 재사용 (결제 직후 미리 만든 것 포함).
     * 궁합은 두 사람 순서와 무관하게 같은 리포트다 — 권한 키처럼 A×B 와 B×A 를 함께 찾고, 먼저 만든(ID 가 작은) 것을 쓴다
     */
    const sameTarget = (a: string, b: string | null) => and(eq(reports.profileId, a), b === null ? isNull(reports.partnerProfileId) : eq(reports.partnerProfileId, b));
    const findExisting = async () =>
      (
        await db
          .select()
          .from(reports)
          .where(
            and(
              eq(reports.userId, userId),
              eq(reports.type, dto.type),
              year === null ? isNull(reports.year) : eq(reports.year, year),
              partnerId === null ? sameTarget(profile.id, null) : or(sameTarget(profile.id, partnerId), sameTarget(partnerId, profile.id)),
            ),
          )
          .orderBy(asc(reports.id))
          .limit(1)
      )[0];
    const existing = await findExisting();
    if (existing) return toDto(await prepare(existing));

    // 규칙 기반 본문은 수 ms 안에 만들어진다 — 먼저 저장해 바로 보여 주고, AI 는 뒤에서 다듬는다
    const id = newId();
    const inserted = await db
      .insert(reports)
      .values({ id, userId, profileId: profile.id, partnerProfileId: partnerId, type: dto.type, year, title: plan.title, content: plan.build(), generator: ai.enabled ? 'polishing' : 'rule', model: null })
      .onConflictDoNothing()
      .returning();
    const row = inserted[0];
    // 동시에 만든 다른 요청이 먼저 저장했다 — 그 저장본을 쓴다(다듬기도 그쪽이 맡는다)
    if (!row) return toDto(await resumeIfStalled((await findExisting())!));
    if (partnerId !== null) {
      // 유니크 인덱스는 두 사람 순서를 그대로 쓰므로 A×B 와 B×A 를 동시에 만들면 둘 다 저장된다 — 먼저 만든(ID 가 작은) 쪽만 남기고 이쪽을 지운다.
      // 두 요청이 서로를 보면 ID 가 큰 쪽이 물러나므로 언제나 하나만 남는다. 다듬기를 맡기기 전에 정리한다
      const first = await findExisting();
      if (first && first.id !== row.id) {
        await db.delete(reports).where(eq(reports.id, row.id));
        return toDto(await resumeIfStalled(first));
      }
    }
    return toDto(ai.enabled ? await startPolish(row) : row);
  };

  const get = async (userId: string, id: string): Promise<ReportDto> => {
    const [r] = await db.select().from(reports).where(and(eq(reports.id, id), eq(reports.userId, userId)));
    if (!r) throw notFound('리포트를 찾을 수 없어요.');
    if (!(await canView(userId, r))) throw paymentRequired('환불되었거나 열람 권한이 없는 리포트예요.');
    return toDto(await prepare(r));
  };

  return {
    access,
    yearlyUnlocked,
    compatUnlocked,
    topicUnlocked,
    create,
    get,
    runPolish,

    /**
     * 다듬기 진행 — 화면은 본문 대신 이것만 폴링하다가 ready 가 되면 본문을 다시 받는다.
     * 2초마다 불리므로 본문(JSON 수만 자)은 읽지 않는다. 끊긴 다듬기를 다시 맡길 때만 본문을 읽는다
     */
    async progress(userId: string, id: string): Promise<ReportProgressDto> {
      const [r] = await db
        .select({
          type: reports.type,
          profileId: reports.profileId,
          partnerProfileId: reports.partnerProfileId,
          year: reports.year,
          generator: reports.generator,
          polishDone: reports.polishDone,
          polishTotal: reports.polishTotal,
          polishLeaseUntil: reports.polishLeaseUntil,
        })
        .from(reports)
        .where(and(eq(reports.id, id), eq(reports.userId, userId)));
      if (!r) throw notFound('리포트를 찾을 수 없어요.');
      if (!(await canView(userId, r))) throw paymentRequired('환불되었거나 열람 권한이 없는 리포트예요.');
      let state: Pick<Report, 'generator' | 'polishDone' | 'polishTotal'> = r;
      if (r.generator === 'polishing' && (r.polishLeaseUntil === null || r.polishLeaseUntil < Date.now())) {
        const [full] = await db.select().from(reports).where(eq(reports.id, id));
        if (full) state = await resumeIfStalled(full);
      }
      const running = state.generator === 'polishing';
      return { status: running ? 'polishing' : 'ready', progress: running ? { done: state.polishDone, total: state.polishTotal } : null };
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
          console.warn(`[reports] 결제 후 미리 만들기 실패 (${key})`, safeErrorText(error));
        }
      }
    },

    /**
     * 프로필을 지우기 직전 — 이 프로필로 산 리포트 중 아직 만들지 않은 것을 만들어 둔다.
     * 프로필을 지우면 출생 정보가 사라져 산 리포트를 다시 만들 수 없기 때문이다(이미 있는 저장본은 그대로 돌려받는다).
     * 실패해도 지우기는 막지 않는다
     */
    async materializeForProfile(userId: string, profileId: string) {
      const rows = await db.select({ key: entitlements.key }).from(entitlements).where(and(eq(entitlements.userId, userId), like(entitlements.key, `report:%${profileId}%`)));
      for (const { key } of rows) {
        const [, type, a, b] = key.split(':');
        let dto: CreateInput | null = null;
        if (type === 'lifetime' && a === profileId) dto = { type, profileId };
        else if (type && isTopicReport(type) && a === profileId) dto = { type, profileId };
        else if (type === 'yearly' && a === profileId && b) dto = { type, profileId, year: Number(b) };
        else if (type === 'compatibility' && a && b && (a === profileId || b === profileId)) dto = { type, profileId: a, partnerProfileId: b };
        if (!dto) continue;
        try {
          await create(userId, dto);
        } catch (error) {
          console.warn(`[reports] 프로필 삭제 전 리포트 만들기 실패 (${type})`, safeErrorText(error));
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
      // 권한은 한 번만 읽어 리포트마다 메모리에서 판정한다(리포트 수만큼 권한 조회를 하지 않는다)
      const [premium, owned] = await Promise.all([commerce.isPremium(userId), ownedKeys(userId)]);
      const visible = (r: ReportTarget) => {
        const keys = viewKeys(r);
        return keys.length > 0 && (premium || keys.some((k) => owned.has(k)));
      };
      return rows
        .filter(({ r }) => visible(r))
        .map(({ r, name }) => ({ id: r.id, type: r.type as ReportType, title: r.title, profileName: name ?? '삭제된 프로필', createdAt: new Date(r.createdAt).toISOString() }));
    },
  };
}

export type ReportService = ReturnType<typeof createReportService>;
