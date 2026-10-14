import { and, eq, isNull } from 'drizzle-orm';
import type { UserDto } from '@saju/shared';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { chatMessages, creditLedger, profiles, pushTokens, refreshTokens, reports, users, type User } from '../../db/schema.js';
import { conflict, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';

const GUEST_NAMES = ['별빛', '새벽', '달무리', '은하', '노을', '바람', '구름', '햇살'];

export function createUserService(config: AppConfig, db: Db) {
  const get = (id: string): User => {
    const u = db.select().from(users).where(eq(users.id, id)).get();
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
      isPremium: premium,
      premiumUntil: premium ? new Date(u.premiumUntil!).toISOString() : null,
      createdAt: new Date(u.createdAt).toISOString(),
    };
  };

  const grantSignupBonus = (userId: string) => {
    if (config.SIGNUP_BONUS_CREDITS <= 0) return;
    db.transaction((tx) => {
      const u = tx.select({ credits: users.credits }).from(users).where(eq(users.id, userId)).get()!;
      const balance = u.credits + config.SIGNUP_BONUS_CREDITS;
      tx.update(users).set({ credits: balance }).where(eq(users.id, userId)).run();
      tx.insert(creditLedger).values({ id: newId(), userId, delta: config.SIGNUP_BONUS_CREDITS, reason: 'bonus', memo: '가입 축하 크레딧', balanceAfter: balance }).run();
    });
  };

  return {
    get,
    toDto,
    isActive(id: string): boolean {
      const u = db.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.id, id)).get();
      return Boolean(u && !u.deletedAt);
    },
    findByEmail(email: string): User | undefined {
      return db.select().from(users).where(and(eq(users.email, email.toLowerCase()), isNull(users.deletedAt))).get();
    },
    createGuest(deviceId?: string): User {
      if (deviceId) {
        const existing = db.select().from(users).where(and(eq(users.deviceId, deviceId), eq(users.provider, 'guest'), isNull(users.deletedAt))).get();
        if (existing) return existing;
      }
      const id = newId();
      const nickname = `${GUEST_NAMES[Math.floor(Math.random() * GUEST_NAMES.length)]}${Math.floor(1000 + Math.random() * 9000)}`;
      db.insert(users).values({ id, nickname, provider: 'guest', deviceId: deviceId ?? null }).run();
      return get(id);
    },
    /** 이메일 가입. guestUserId 가 있으면 게스트 계정을 정회원으로 전환(데이터 유지) */
    createEmailUser(input: { email: string; passwordHash: string; nickname?: string; marketingConsent?: boolean; guestUserId?: string }): User {
      const email = input.email.toLowerCase();
      if (db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) throw conflict('이미 가입된 이메일이에요.');
      if (input.guestUserId) {
        const guest = db.select().from(users).where(eq(users.id, input.guestUserId)).get();
        if (guest && guest.provider === 'guest' && !guest.deletedAt) {
          db.update(users)
            .set({ email, passwordHash: input.passwordHash, provider: 'email', nickname: input.nickname ?? guest.nickname, marketingConsent: input.marketingConsent ?? false, updatedAt: Date.now() })
            .where(eq(users.id, guest.id))
            .run();
          grantSignupBonus(guest.id);
          return get(guest.id);
        }
      }
      const id = newId();
      db.insert(users).values({ id, email, passwordHash: input.passwordHash, nickname: input.nickname ?? email.split('@')[0]!.slice(0, 20), provider: 'email', marketingConsent: input.marketingConsent ?? false }).run();
      grantSignupBonus(id);
      return get(id);
    },
    /** 소셜 로그인 사용자 찾기/생성 (게스트 전환 지원) */
    upsertSocialUser(input: { provider: string; providerUserId: string; email: string | null; nickname: string | null; refreshToken?: string | null; guestUserId?: string }): { user: User; created: boolean } {
      const found = db.select().from(users).where(and(eq(users.provider, input.provider), eq(users.providerUserId, input.providerUserId))).get();
      if (found && !found.deletedAt) {
        if (input.refreshToken) db.update(users).set({ providerRefreshToken: input.refreshToken }).where(eq(users.id, found.id)).run();
        return { user: found, created: false };
      }
      const email = input.email?.toLowerCase() ?? null;
      // 같은 이메일의 다른 계정이 있으면 이메일은 비워 둔다(계정 병합은 정책 결정 필요)
      const emailTaken = email ? Boolean(db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) : false;
      const nickname = (input.nickname ?? email?.split('@')[0] ?? '사용자').slice(0, 20);
      if (input.guestUserId) {
        const guest = db.select().from(users).where(eq(users.id, input.guestUserId)).get();
        if (guest && guest.provider === 'guest' && !guest.deletedAt) {
          db.update(users)
            .set({ provider: input.provider, providerUserId: input.providerUserId, providerRefreshToken: input.refreshToken ?? null, email: emailTaken ? null : email, nickname, updatedAt: Date.now() })
            .where(eq(users.id, guest.id))
            .run();
          grantSignupBonus(guest.id);
          return { user: get(guest.id), created: true };
        }
      }
      const id = newId();
      db.insert(users).values({ id, provider: input.provider, providerUserId: input.providerUserId, providerRefreshToken: input.refreshToken ?? null, email: emailTaken ? null : email, nickname }).run();
      grantSignupBonus(id);
      return { user: get(id), created: true };
    },
    /**
     * 게스트 데이터(프로필·리포트·상담)를 기존 회원 계정으로 옮기고 게스트를 정리한다.
     * 게스트로 사주를 저장한 뒤 "이미 있는 계정"으로 로그인한 경우의 유실을 막는다.
     */
    mergeGuestInto(guestUserId: string | undefined, userId: string): number {
      if (!guestUserId || guestUserId === userId) return 0;
      const guest = db.select().from(users).where(eq(users.id, guestUserId)).get();
      if (!guest || guest.provider !== 'guest' || guest.deletedAt) return 0;
      return db.transaction((tx) => {
        const moved = tx.update(profiles).set({ userId, isPrimary: false, updatedAt: Date.now() }).where(eq(profiles.userId, guestUserId)).run().changes;
        tx.update(reports).set({ userId }).where(eq(reports.userId, guestUserId)).run();
        tx.update(chatMessages).set({ userId }).where(eq(chatMessages.userId, guestUserId)).run();
        tx.delete(refreshTokens).where(eq(refreshTokens.userId, guestUserId)).run();
        tx.update(users).set({ deviceId: null, deletedAt: Date.now(), nickname: '병합된 게스트', updatedAt: Date.now() }).where(eq(users.id, guestUserId)).run();
        return moved;
      });
    },
    update(id: string, patch: { nickname?: string; marketingConsent?: boolean; pushEnabled?: boolean }): User {
      db.update(users).set({ ...patch, updatedAt: Date.now() }).where(eq(users.id, id)).run();
      return get(id);
    },
    /**
     * 회원 탈퇴 — 개인정보(프로필·리포트·상담·토큰)는 즉시 삭제하고, 주문/결제 기록은
     * 전자상거래법상 보존 의무(5년)를 위해 익명화된 사용자 행에 남긴다.
     */
    deleteAccount(id: string) {
      db.transaction((tx) => {
        tx.delete(profiles).where(eq(profiles.userId, id)).run();
        tx.delete(reports).where(eq(reports.userId, id)).run();
        tx.delete(chatMessages).where(eq(chatMessages.userId, id)).run();
        tx.delete(refreshTokens).where(eq(refreshTokens.userId, id)).run();
        tx.delete(pushTokens).where(eq(pushTokens.userId, id)).run();
        tx.update(users)
          .set({ email: null, passwordHash: null, providerUserId: null, providerRefreshToken: null, deviceId: null, nickname: '탈퇴한 사용자', deletedAt: Date.now(), updatedAt: Date.now() })
          .where(eq(users.id, id))
          .run();
      });
    },
  };
}

export type UserService = ReturnType<typeof createUserService>;
