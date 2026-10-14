import { and, asc, desc, eq, like } from 'drizzle-orm';
import { calculateSaju, type BirthInput, type SajuChart } from '@saju/core';
import { birthInputSchema, type ProfileCreateDto, type ProfileDto, type ProfileRelation, type ProfileUpdateDto } from '@saju/shared';
import type { z } from 'zod';
import type { Db } from '../../db/client.js';
import { entitlements, profiles, type Profile } from '../../db/schema.js';
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

  const getOwned = (userId: string, id: string): Profile => {
    const p = db.select().from(profiles).where(and(eq(profiles.id, id), eq(profiles.userId, userId))).get();
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

  return {
    toDto,
    getOwned,
    chartOf(p: Profile): SajuChart {
      return calculateSaju(profileToBirth(p));
    },
    list(userId: string): Profile[] {
      return db.select().from(profiles).where(eq(profiles.userId, userId)).orderBy(desc(profiles.isPrimary), asc(profiles.createdAt)).all();
    },
    primary(userId: string): Profile | undefined {
      return db.select().from(profiles).where(eq(profiles.userId, userId)).orderBy(desc(profiles.isPrimary), asc(profiles.createdAt)).get();
    },
    create(userId: string, dto: Omit<ProfileCreateDto, 'birth'> & { birth: z.output<typeof birthInputSchema> }): Profile {
      const count = db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, userId)).all().length;
      if (count >= MAX_PROFILES) throw badRequest(`프로필은 최대 ${MAX_PROFILES}개까지 저장할 수 있어요.`);
      calculateSaju(birthDtoToInput(dto.birth)); // 날짜 유효성 검증(SajuInputError → 400)
      const id = newId();
      const isPrimary = dto.isPrimary ?? (count === 0 || dto.relation === 'self');
      db.transaction((tx) => {
        if (isPrimary) tx.update(profiles).set({ isPrimary: false }).where(eq(profiles.userId, userId)).run();
        tx.insert(profiles).values({ id, userId, name: dto.name, relation: dto.relation ?? 'self', cityName: dto.cityName ?? null, isPrimary, ...values(dto.birth) }).run();
      });
      return getOwned(userId, id);
    },
    update(userId: string, id: string, dto: Omit<ProfileUpdateDto, 'birth'> & { birth?: z.output<typeof birthInputSchema> }): Profile {
      const current = getOwned(userId, id);
      if (dto.birth) {
        calculateSaju(birthDtoToInput(dto.birth));
        // 구매한 리포트 권한은 프로필 ID 에 묶여 있으므로, 출생정보를 바꿔 다른 사람 풀이에 재사용하는 것을 막는다
        const changed = JSON.stringify(values(dto.birth)) !== JSON.stringify(values(birthDtoFromProfile(current)));
        const purchased = db.select({ id: entitlements.id }).from(entitlements).where(and(eq(entitlements.userId, userId), like(entitlements.key, `report:%${id}%`))).get();
        if (changed && purchased) throw conflict('구매한 풀이가 있는 사주는 출생 정보를 바꿀 수 없어요. 새 사주로 추가해 주세요. (입력 실수는 고객센터로 문의해 주세요)');
      }
      db.transaction((tx) => {
        if (dto.isPrimary) tx.update(profiles).set({ isPrimary: false }).where(eq(profiles.userId, userId)).run();
        tx.update(profiles)
          .set({
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.relation !== undefined ? { relation: dto.relation } : {}),
            ...(dto.cityName !== undefined ? { cityName: dto.cityName } : {}),
            ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
            ...(dto.birth ? values(dto.birth) : {}),
            updatedAt: Date.now(),
          })
          .where(eq(profiles.id, id))
          .run();
      });
      return getOwned(userId, id);
    },
    remove(userId: string, id: string) {
      getOwned(userId, id);
      db.delete(profiles).where(eq(profiles.id, id)).run();
    },
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;
