import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { UserDto } from '@saju/shared';
import type { AppConfig } from '../../config/env.js';
import { atomic } from '../../db/atomic.js';
import { isUniqueViolation, type Db } from '../../db/client.js';
import { chatMessages, creditLedger, entitlements, passwordResets, profiles, pushTokens, refreshTokens, reports, tarotReadings, users, webhookEvents, type User } from '../../db/schema.js';
import { conflict, notFound } from '../../lib/errors.js';
import { userEventsWhere } from '../../lib/requestClaim.js';
import { newId } from '../../lib/ids.js';
import { balanceNow } from '../commerce/service.js';
import type { OpsService } from '../ops/service.js';

const GUEST_NAMES = ['별빛', '새벽', '달무리', '은하', '노을', '바람', '구름', '햇살'];

export function createUserService(config: AppConfig, db: Db, ops?: Pick<OpsService, 'signup'>) {
  const get = async (id: string): Promise<User> => {
    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (!u || u.deletedAt) throw notFound('사용자를 찾을 수 없어요.');
    return u;
  };

  const toDto = (u: User): UserDto => {
    const premium = u.premiumUntil !== null && u.premiumUntil > Date.now();
    return {
      id: u.id,
      email: u.email,
      nickname: u.nickname,
      provider: u.provider as UserDto['provider'],
      role: u.role === 'admin' ? 'admin' : 'user',
      credits: u.credits,
      marketingConsent: u.marketingConsent,
      pushEnabled: u.pushEnabled,
      isPremium: premium,
      premiumUntil: premium ? new Date(u.premiumUntil!).toISOString() : null,
      createdAt: new Date(u.createdAt).toISOString(),
    };
  };

  const grantSignupBonus = async (userId: string) => {
    if (config.SIGNUP_BONUS_CREDITS <= 0) return;
    const bonus = config.SIGNUP_BONUS_CREDITS;
    // 누적은 SQL 로, 원장의 잔액은 같은 묶음 안에서 갱신 직후 값을 읽어 적는다
    await db.batch([
      db
        .update(users)
        .set({ credits: sql`${users.credits} + ${bonus}` })
        .where(eq(users.id, userId)),
      db.insert(creditLedger).values({ id: newId(), userId, delta: bonus, reason: 'bonus', memo: '가입 축하 크레딧', balanceAfter: balanceNow(userId) }),
    ]);
  };

  const emailTakenError = () => conflict('이미 가입된 이메일이에요.');

  /**
   * 게스트 행을 회원으로 바꾼다 — 아직 게스트일 때만(실행 시점 확인). 바꿨으면 true.
   * 가입 버튼을 두 번 누르는 등 같은 게스트의 전환 요청이 겹쳐도 전환과 가입 보너스는 한 번이다
   */
  const convertGuest = async (guestId: string, patch: Partial<typeof users.$inferInsert>) =>
    (
      await db
        .update(users)
        .set({ ...patch, registeredAt: Date.now(), updatedAt: Date.now() })
        .where(and(eq(users.id, guestId), eq(users.provider, 'guest'), isNull(users.deletedAt)))
        .returning({ id: users.id })
    ).length === 1;

  /** 소셜 계정(제공자 + 제공자 사용자 ID)으로 이미 있는 회원 */
  const findSocial = async (provider: string, providerUserId: string) => {
    const [u] = await db.select().from(users).where(and(eq(users.provider, provider), eq(users.providerUserId, providerUserId)));
    return u && !u.deletedAt ? u : undefined;
  };

  return {
    get,
    toDto,
    async isActive(id: string): Promise<boolean> {
      const [u] = await db.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.id, id));
      return Boolean(u && !u.deletedAt);
    },
    async findByEmail(email: string): Promise<User | undefined> {
      const [u] = await db.select().from(users).where(and(eq(users.email, email.toLowerCase()), isNull(users.deletedAt)));
      return u;
    },
    /**
     * 게스트 시작 — 같은 기기 ID 의 게스트가 있으면 그 계정을 돌려준다.
     * 같은 기기의 첫 요청 두 개가 동시에 와도 부분 유니크 인덱스(users_guest_device_uq: 살아 있는 게스트의 device_id)가
     * 나중 저장을 건너뛰게 하므로, 저장하지 못했으면 먼저 만든 게스트를 돌려준다
     */
    async createGuest(deviceId?: string): Promise<User> {
      const sameDevice = (id: string) =>
        db
          .select()
          .from(users)
          .where(and(eq(users.deviceId, id), eq(users.provider, 'guest'), isNull(users.deletedAt)))
          .orderBy(asc(users.id));
      if (deviceId) {
        const [existing] = await sameDevice(deviceId);
        if (existing) return existing;
      }
      const id = newId();
      const nickname = `${GUEST_NAMES[Math.floor(Math.random() * GUEST_NAMES.length)]}${Math.floor(1000 + Math.random() * 9000)}`;
      const inserted = await db.insert(users).values({ id, nickname, provider: 'guest', deviceId: deviceId ?? null }).onConflictDoNothing().returning({ id: users.id });
      if (inserted.length === 0 && deviceId) {
        const [first] = await sameDevice(deviceId);
        if (first) return first;
      }
      return get(id);
    },
    /** 이메일 가입. guestUserId 가 있으면 게스트 계정을 정회원으로 전환(데이터 유지) */
    async createEmailUser(input: { email: string; passwordHash: string; nickname?: string; marketingConsent?: boolean; guestUserId?: string }): Promise<User> {
      const email = input.email.toLowerCase();
      if ((await db.select({ id: users.id }).from(users).where(eq(users.email, email))).length > 0) throw emailTakenError();
      try {
        if (input.guestUserId) {
          const [guest] = await db.select().from(users).where(eq(users.id, input.guestUserId));
          if (guest && guest.provider === 'guest' && !guest.deletedAt) {
            if (await convertGuest(guest.id, { email, passwordHash: input.passwordHash, provider: 'email', nickname: input.nickname ?? guest.nickname, marketingConsent: input.marketingConsent ?? false })) {
              await grantSignupBonus(guest.id);
              ops?.signup({ provider: 'email', converted: true });
              return get(guest.id);
            }
            // 다른 요청이 먼저 전환했다 — 같은 이메일이면 같은 가입이 두 번 들어온 것(두 번 누름)이라 409 로 알린다
            const [after] = await db.select({ email: users.email }).from(users).where(eq(users.id, guest.id));
            if (after?.email === email) throw emailTakenError();
          }
        }
        const id = newId();
        await db.insert(users).values({ id, email, passwordHash: input.passwordHash, nickname: input.nickname ?? email.split('@')[0]!.slice(0, 20), provider: 'email', marketingConsent: input.marketingConsent ?? false, registeredAt: Date.now() });
        await grantSignupBonus(id);
        ops?.signup({ provider: 'email', converted: false });
        return get(id);
      } catch (e) {
        // 같은 이메일로 동시에 가입한 경우 — 확인과 저장 사이에 다른 요청이 먼저 들어갔다
        if (isUniqueViolation(e)) throw emailTakenError();
        throw e;
      }
    },
    /** 소셜 로그인 사용자 찾기/생성 (게스트 전환 지원) */
    async upsertSocialUser(input: { provider: string; providerUserId: string; email: string | null; nickname: string | null; refreshToken?: string | null; guestUserId?: string }): Promise<{ user: User; created: boolean }> {
      const found = await findSocial(input.provider, input.providerUserId);
      if (found) {
        if (input.refreshToken) await db.update(users).set({ providerRefreshToken: input.refreshToken }).where(eq(users.id, found.id));
        return { user: found, created: false };
      }
      const email = input.email?.toLowerCase() ?? null;
      // 같은 이메일의 다른 계정이 있으면 이메일은 비워 둔다(계정 병합은 정책 결정 필요)
      const emailTaken = email ? (await db.select({ id: users.id }).from(users).where(eq(users.email, email))).length > 0 : false;
      const nickname = (input.nickname ?? email?.split('@')[0] ?? '사용자').slice(0, 20);
      if (input.guestUserId) {
        const [guest] = await db.select().from(users).where(eq(users.id, input.guestUserId));
        if (guest && guest.provider === 'guest' && !guest.deletedAt) {
          try {
            if (await convertGuest(guest.id, { provider: input.provider, providerUserId: input.providerUserId, providerRefreshToken: input.refreshToken ?? null, email: emailTaken ? null : email, nickname })) {
              await grantSignupBonus(guest.id);
              ops?.signup({ provider: input.provider, converted: true });
              return { user: await get(guest.id), created: true };
            }
          } catch (e) {
            if (!isUniqueViolation(e)) throw e;
          }
          // 같은 소셜 계정의 로그인이 겹쳐 다른 요청이 먼저 전환(또는 생성)했다 — 그 계정으로 로그인한다
          const again = await findSocial(input.provider, input.providerUserId);
          if (again) return { user: again, created: false };
        }
      }
      const id = newId();
      try {
        await db.insert(users).values({ id, provider: input.provider, providerUserId: input.providerUserId, providerRefreshToken: input.refreshToken ?? null, email: emailTaken ? null : email, nickname, registeredAt: Date.now() });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        // 같은 소셜 계정의 첫 로그인이 동시에 두 번 들어왔다 — 먼저 만든 계정으로 로그인한다(보너스도 그쪽에서 한 번)
        const again = await findSocial(input.provider, input.providerUserId);
        if (again) return { user: again, created: false };
        throw e;
      }
      await grantSignupBonus(id);
      ops?.signup({ provider: input.provider, converted: false });
      return { user: await get(id), created: true };
    },
    /**
     * 게스트 데이터(프로필·리포트·상담·타로 기록)를 기존 회원 계정으로 옮기고 게스트를 정리한다.
     * 게스트로 사주를 저장한 뒤 "이미 있는 계정"으로 로그인한 경우의 유실을 막는다.
     * 게스트는 결제할 수 없어서(commerce: LOGIN_REQUIRED) 주문·열람 권한·유상 질문권은 옮길 것이 없다.
     * 무상 질문권(앱 보상형 광고 등)이 남아 있으면 회원 계정으로 넘기고 두 원장에 이동을 적는다.
     * 타로 기록은 (사용자, 날짜, 질문) 유니크라 회원이 같은 날 같은 질문을 이미 뽑았으면 그 한 건은 회원 것을 남긴다(OR IGNORE).
     */
    async mergeGuestInto(guestUserId: string | undefined, userId: string): Promise<number> {
      if (!guestUserId || guestUserId === userId) return 0;
      // 같은 게스트로 로그인이 겹쳐도(두 번 누름·두 탭) 옮기기는 한 번 — 게스트가 실행 시점에도 그대로(삭제 전, 질문권 그대로)여야 한다
      return atomic(db, async (u) => {
        const [guest] = await db.select().from(users).where(eq(users.id, guestUserId));
        if (!guest || guest.provider !== 'guest' || guest.deletedAt) return 0;
        u.expect(
          sql`exists (select 1 from ${users} where ${users.id} = ${guestUserId} and ${users.provider} = 'guest' and ${users.deletedAt} is null and ${users.credits} = ${guest.credits} and ${users.paidCredits} = ${guest.paidCredits})`,
        );
        const freeCredits = Math.max(0, guest.credits - guest.paidCredits);
        if (freeCredits > 0) {
          u.write(db.update(users).set({ credits: sql`${users.credits} - ${freeCredits}` }).where(eq(users.id, guestUserId)));
          u.write(db.insert(creditLedger).values({ id: newId(), userId: guestUserId, delta: -freeCredits, reason: 'admin', memo: '로그인한 회원 계정으로 이동', balanceAfter: balanceNow(guestUserId) }));
          u.write(db.update(users).set({ credits: sql`${users.credits} + ${freeCredits}` }).where(eq(users.id, userId)));
          u.write(db.insert(creditLedger).values({ id: newId(), userId, delta: freeCredits, reason: 'admin', memo: '게스트로 받은 질문권 이동', balanceAfter: balanceNow(userId) }));
        }
        const moved = (await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.userId, guestUserId))).length;
        u.write(db.update(profiles).set({ userId, isPrimary: false, updatedAt: Date.now() }).where(eq(profiles.userId, guestUserId)));
        u.write(db.update(reports).set({ userId }).where(eq(reports.userId, guestUserId)));
        u.write(db.update(chatMessages).set({ userId }).where(eq(chatMessages.userId, guestUserId)));
        // 회원이 같은 날 같은 질문을 이미 뽑은 게스트 리딩은 지우고(유니크 충돌), 나머지를 옮긴다.
        // (D1 의 batch 는 db.run(sql) 문을 받지 못해 'update or ignore' 대신 쿼리 빌더 두 문장으로 쓴다)
        u.write(
          db
            .delete(tarotReadings)
            .where(
              and(
                eq(tarotReadings.userId, guestUserId),
                sql`exists (select 1 from ${tarotReadings} as m where m.user_id = ${userId} and m.date_key = ${tarotReadings.dateKey} and m.question_key = ${tarotReadings.questionKey})`,
              ),
            ),
        );
        u.write(db.update(tarotReadings).set({ userId }).where(eq(tarotReadings.userId, guestUserId)));
        u.write(db.delete(refreshTokens).where(eq(refreshTokens.userId, guestUserId)));
        u.write(db.update(users).set({ deviceId: null, deletedAt: Date.now(), nickname: '병합된 게스트', updatedAt: Date.now() }).where(eq(users.id, guestUserId)));
        return moved;
      });
    },
    async update(id: string, patch: { nickname?: string; marketingConsent?: boolean; pushEnabled?: boolean }): Promise<User> {
      await db.update(users).set({ ...patch, updatedAt: Date.now() }).where(eq(users.id, id));
      return get(id);
    },
    /**
     * 회원 탈퇴 — 개인정보(프로필·리포트·상담·타로 기록·열람 권한·토큰)는 즉시 삭제하고, 주문/결제 기록과
     * 질문권 원장은 전자상거래법상 보존 의무(5년)를 위해 익명화된 사용자 행에 남긴다.
     */
    async deleteAccount(id: string) {
      await db.batch([
        db.delete(profiles).where(eq(profiles.userId, id)),
        db.delete(reports).where(eq(reports.userId, id)),
        db.delete(chatMessages).where(eq(chatMessages.userId, id)),
        // 타로 기록에는 사용자가 쓴 질문 글이 들어 있다
        db.delete(tarotReadings).where(eq(tarotReadings.userId, id)),
        db.delete(entitlements).where(eq(entitlements.userId, id)),
        db.delete(passwordResets).where(eq(passwordResets.userId, id)),
        db.delete(refreshTokens).where(eq(refreshTokens.userId, id)),
        db.delete(pushTokens).where(eq(pushTokens.userId, id)),
        // 요청 ID 선점 기록(꿈풀이 결과·프로필 이름이 담긴다)과 토스 날짜 열기 기록 — lib/requestClaim.ts
        db.delete(webhookEvents).where(userEventsWhere(id)),
        db
          .update(users)
          .set({ email: null, passwordHash: null, providerUserId: null, providerRefreshToken: null, deviceId: null, nickname: '탈퇴한 사용자', deletedAt: Date.now(), updatedAt: Date.now() })
          .where(eq(users.id, id)),
      ]);
    },
  };
}

export type UserService = ReturnType<typeof createUserService>;
