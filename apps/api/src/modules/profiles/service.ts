import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm';
import { calculateSaju, type BirthInput, type SajuChart } from '@saju/core';
import { birthInputSchema, type ProfileCreateDto, type ProfileDto, type ProfileRelation, type ProfileUpdateDto } from '@saju/shared';
import type { z } from 'zod';
import { atomic } from '../../db/atomic.js';
import type { Db } from '../../db/client.js';
import { chatMessages, entitlements, profiles, reports, tarotReadings, type Profile } from '../../db/schema.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';

const MAX_PROFILES = 50;

export function profileToBirth(p: Profile): BirthInput {
  return {
    calendar: p.calendar as BirthInput['calendar'],
    year: p.birthYear,
    month: p.birthMonth,
    day: p.birthDay,
    isLeapMonth: p.isLeapMonth,
    hour: p.birthHour,
    minute: p.birthMinute,
    gender: p.gender as BirthInput['gender'],
    timeZone: p.timeZone,
    longitude: p.longitude,
    timeCorrection: p.timeCorrection as BirthInput['timeCorrection'],
    ziHourRule: p.ziHourRule as BirthInput['ziHourRule'],
  };
}

export function birthDtoToInput(b: z.output<typeof birthInputSchema>): BirthInput {
  return { ...b, hour: b.hour ?? null, minute: b.minute ?? null };
}

function birthDtoFromProfile(p: Profile): z.output<typeof birthInputSchema> {
  return {
    calendar: p.calendar as 'solar' | 'lunar',
    year: p.birthYear,
    month: p.birthMonth,
    day: p.birthDay,
    isLeapMonth: p.isLeapMonth,
    hour: p.birthHour,
    minute: p.birthMinute,
    gender: p.gender as 'male' | 'female',
    timeZone: p.timeZone,
    longitude: p.longitude,
    timeCorrection: p.timeCorrection as 'lmt' | 'trueSolar' | 'clock',
    ziHourRule: p.ziHourRule as 'nextDay' | 'midnight',
  };
}

export function createProfileService(db: Db) {
  const toDto = (p: Profile, chart?: SajuChart): ProfileDto => {
    const c = chart ?? calculateSaju(profileToBirth(p));
    const birth = profileToBirth(p);
    return {
      id: p.id,
      name: p.name,
      relation: p.relation as ProfileRelation,
      birth: {
        calendar: birth.calendar,
        year: birth.year,
        month: birth.month,
        day: birth.day,
        gender: birth.gender,
        isLeapMonth: p.isLeapMonth,
        hour: p.birthHour,
        minute: p.birthMinute,
        timeZone: p.timeZone,
        longitude: p.longitude,
        timeCorrection: p.timeCorrection as ProfileDto['birth']['timeCorrection'],
        ziHourRule: p.ziHourRule as ProfileDto['birth']['ziHourRule'],
      },
      cityName: p.cityName,
      isPrimary: p.isPrimary,
      dayPillar: c.pillars.day.ganzhi.hanja,
      zodiac: c.zodiac.animal,
      createdAt: new Date(p.createdAt).toISOString(),
    };
  };

  const getOwned = async (userId: string, id: string): Promise<Profile> => {
    const [p] = await db.select().from(profiles).where(and(eq(profiles.id, id), eq(profiles.userId, userId)));
    if (!p) throw notFound('프로필을 찾을 수 없어요.');
    return p;
  };

  const values = (b: z.output<typeof birthInputSchema>) => ({
    gender: b.gender,
    calendar: b.calendar,
    birthYear: b.year,
    birthMonth: b.month,
    birthDay: b.day,
    isLeapMonth: b.calendar === 'lunar' ? Boolean(b.isLeapMonth) : false,
    birthHour: b.hour ?? null,
    birthMinute: b.hour === null || b.hour === undefined ? null : (b.minute ?? 0),
    timeZone: b.timeZone ?? 'Asia/Seoul',
    longitude: b.longitude ?? 126.978,
    timeCorrection: b.timeCorrection ?? 'lmt',
    ziHourRule: b.ziHourRule ?? 'nextDay',
  });

  /** 대표를 넘겨받을 사주 — 관계가 '본인'인 사주를 먼저, 없으면 가장 먼저 저장한 사주 */
  const nextPrimary = async (userId: string, excludeId: string): Promise<string | undefined> => {
    const rest = await db.select({ id: profiles.id, relation: profiles.relation }).from(profiles).where(eq(profiles.userId, userId)).orderBy(asc(profiles.createdAt), asc(profiles.id));
    const others = rest.filter((p) => p.id !== excludeId);
    return (others.find((p) => p.relation === 'self') ?? others[0])?.id;
  };

  /**
   * 이 사주에 묶인 구매가 있는가 — 리포트 권한(report:…<프로필 ID>…, 궁합은 두 사람 모두)과
   * 상세를 연 택일 결과(taekil:reading:<결과 ID>, 그 결과의 본인이나 상대가 이 사주)
   */
  const hasPurchase = async (userId: string, id: string): Promise<boolean> => {
    const [report] = await db.select({ id: entitlements.id }).from(entitlements).where(and(eq(entitlements.userId, userId), like(entitlements.key, `report:%${id}%`))).limit(1);
    if (report) return true;
    const [taekil] = await db
      .select({ id: reports.id })
      .from(reports)
      .innerJoin(entitlements, and(eq(entitlements.userId, userId), eq(entitlements.key, sql`'taekil:reading:' || ${reports.id}`)))
      .where(and(eq(reports.userId, userId), eq(reports.type, 'taekil'), or(eq(reports.profileId, id), eq(reports.partnerProfileId, id))))
      .limit(1);
    return Boolean(taekil);
  };

  return {
    toDto,
    getOwned,
    chartOf(p: Profile): SajuChart {
      return calculateSaju(profileToBirth(p));
    },
    async list(userId: string): Promise<Profile[]> {
      return db.select().from(profiles).where(eq(profiles.userId, userId)).orderBy(desc(profiles.isPrimary), asc(profiles.createdAt), asc(profiles.id));
    },
    async primary(userId: string): Promise<Profile | undefined> {
      const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId)).orderBy(desc(profiles.isPrimary), asc(profiles.createdAt), asc(profiles.id)).limit(1);
      return p;
    },
    async create(userId: string, dto: Omit<ProfileCreateDto, 'birth'> & { birth: z.output<typeof birthInputSchema> }): Promise<Profile> {
      calculateSaju(birthDtoToInput(dto.birth)); // 날짜 유효성 검증(SajuInputError → 400)
      const relation = dto.relation ?? 'self';
      // 개수 확인·대표 판단과 저장을 한 묶음으로 — 동시에 저장해도 50개를 넘지 않고 대표가 둘이 되지 않는다(개수가 바뀌었으면 처음부터 다시)
      const id = await atomic(db, async (u) => {
        const count = (await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId))).length;
        if (count >= MAX_PROFILES) throw badRequest(`프로필은 최대 ${MAX_PROFILES}개까지 저장할 수 있어요.`);
        u.expect(sql`(select count(*) from ${profiles} where ${profiles.userId} = ${userId}) = ${count}`);
        const newIdValue = newId();
        const isPrimary = dto.isPrimary ?? (count === 0 || relation === 'self');
        // 대표 사주는 하나 — 다른 사주의 대표 표시를 끄는 것과 새 사주 저장을 한 묶음으로
        if (isPrimary) u.write(db.update(profiles).set({ isPrimary: false }).where(eq(profiles.userId, userId)));
        u.write(db.insert(profiles).values({ id: newIdValue, userId, name: dto.name, relation, cityName: dto.cityName ?? null, isPrimary, ...values(dto.birth) }));
        return newIdValue;
      });
      return getOwned(userId, id);
    },
    async update(userId: string, id: string, dto: Omit<ProfileUpdateDto, 'birth'> & { birth?: z.output<typeof birthInputSchema> }): Promise<Profile> {
      const current = await getOwned(userId, id);
      if (dto.birth) {
        calculateSaju(birthDtoToInput(dto.birth));
        // 구매한 리포트·택일 권한은 프로필 ID 에 묶여 있으므로, 출생정보를 바꿔 다른 사람 풀이에 재사용하는 것을 막는다
        const changed = JSON.stringify(values(dto.birth)) !== JSON.stringify(values(birthDtoFromProfile(current)));
        if (changed && (await hasPurchase(userId, id))) throw conflict('구매한 풀이가 있는 사주는 출생 정보를 바꿀 수 없어요. 새 사주로 추가해 주세요. (입력 실수는 고객센터로 문의해 주세요)');
      }
      // 대표를 끄면 다른 사주를 대표로 올린다(대표가 비지 않게). 다른 사주가 없으면 그대로 대표로 둔다
      const handOver = dto.isPrimary === false && current.isPrimary ? await nextPrimary(userId, id) : undefined;
      const isPrimary = dto.isPrimary === false && current.isPrimary && !handOver ? undefined : dto.isPrimary;
      const update = db
        .update(profiles)
        .set({
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.relation !== undefined ? { relation: dto.relation } : {}),
          ...(dto.cityName !== undefined ? { cityName: dto.cityName } : {}),
          ...(isPrimary !== undefined ? { isPrimary } : {}),
          ...(dto.birth ? values(dto.birth) : {}),
          updatedAt: Date.now(),
        })
        .where(eq(profiles.id, id));
      if (isPrimary) await db.batch([db.update(profiles).set({ isPrimary: false }).where(eq(profiles.userId, userId)), update]);
      else if (handOver) await db.batch([update, db.update(profiles).set({ isPrimary: true }).where(eq(profiles.id, handOver))]);
      else await update;
      return getOwned(userId, id);
    },
    async remove(userId: string, id: string) {
      const current = await getOwned(userId, id);
      const remove = db.delete(profiles).where(and(eq(profiles.id, id), eq(profiles.userId, userId)));
      // 이 프로필과 나눈 AI 상담 대화도 함께 지운다 — 프로필이 없으면 다시 볼 수 없는 대화가 탈퇴 전까지 남지 않게
      const removeChat = db.delete(chatMessages).where(and(eq(chatMessages.userId, userId), eq(chatMessages.profileId, id)));
      // 타로 리딩에 저장해 둔 이 사람의 출생 정보(스냅샷)도 비운다 — 지운 사람의 출생 정보가 남지 않게
      const clearTarot = db
        .update(tarotReadings)
        .set({ sajuSnapshot: null })
        .where(and(eq(tarotReadings.userId, userId), or(eq(tarotReadings.profileId, id), eq(tarotReadings.partnerProfileId, id))));
      // 대표를 지우면 남은 사주 하나를 대표로 올린다 — 지우기와 한 묶음으로
      const handOver = current.isPrimary ? await nextPrimary(userId, id) : undefined;
      if (handOver) await db.batch([remove, removeChat, clearTarot, db.update(profiles).set({ isPrimary: true }).where(eq(profiles.id, handOver))]);
      else await db.batch([remove, removeChat, clearTarot]);
    },
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;
