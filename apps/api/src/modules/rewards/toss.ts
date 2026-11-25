/**
 * 토스 미니앱 보상형 광고 지급 — 토스 광고에는 서버 측 확인 콜백(AdMob SSV 같은 것)이 문서에 없다.
 * 그래서 광고를 띄우기 전에 서버가 서명한 일회용 토큰을 주고(start), 광고를 끝까지 본 뒤 그 토큰으로 지급을 요청한다(claim).
 *  - 토큰은 사용자·종류에 묶이고 10분 안에 한 번만 쓸 수 있다(webhook_events 에 기록해 재사용을 막는다).
 *  - 시작 직후의 지급 요청(TOO_EARLY)은 거절한다 — 광고를 보지 않고 바로 요청하는 것을 줄인다.
 *  - credit: 무상 질문권. AdMob 보상과 같은 하루 한도(REWARDED_AD_DAILY_LIMIT)를 함께 쓴다.
 *  - unlock: 무료 콘텐츠 열기(내일 운세 미리 보기). 슬롯마다 하루 1회.
 * 한계: 앱이 광고를 실제로 끝까지 보여 줬는지는 서버가 확인할 수 없다 — 그래서 한도를 작게 둔다.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import type { TossRewardClaimDto, TossRewardSlot, TossRewardStartDto, TossRewardStartRequestDto } from '@saju/shared';
import { TOSS_REWARD_SLOTS } from '@saju/shared';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { users, webhookEvents } from '../../db/schema.js';
import { badRequest, conflict, forbidden, notConfigured } from '../../lib/errors.js';
import type { CommerceService } from '../commerce/service.js';
import type { TossClient } from '../toss/client.js';
import type { RewardsService } from './service.js';

const ISSUER = 'saju-toss-reward';
const TOKEN_TTL_SEC = 10 * 60;
export const TOSS_REWARD_MIN_WATCH_MS = 3_000;
const REWARD_MEMO = '광고 보상';
const PROVIDER = 'toss_ad';

export interface TossRewardsDeps {
  now?: () => number;
}

export function createTossRewardsService(config: AppConfig, db: Db, commerce: CommerceService, rewards: RewardsService, client: TossClient, deps: TossRewardsDeps = {}) {
  const now = deps.now ?? Date.now;
  // 로그인 토큰과 섞이지 않게 발급자와 키를 따로 둔다
  const key = new TextEncoder().encode(`${config.JWT_ACCESS_SECRET}:toss-reward`);

  /** 한국 시간 날짜 (YYYY-MM-DD) */
  const dateKeyKst = () => new Date(now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const unlockId = (userId: string, slot: string, dateKey: string) => `tossad:unlock:${slot}:${userId}:${dateKey}`;

  const requireTossUser = async (userId: string) => {
    if (!client.isConfigured()) throw notConfigured('토스 광고 보상', client.envKeys);
    const [user] = await db.select({ provider: users.provider }).from(users).where(eq(users.id, userId));
    if (user?.provider !== 'toss') throw forbidden('토스 앱에서만 받을 수 있는 보상이에요.');
  };

  const unlockedToday = async (userId: string, slot: string) =>
    (await db.select({ id: webhookEvents.id }).from(webhookEvents).where(eq(webhookEvents.id, unlockId(userId, slot, dateKeyKst())))).length > 0;

  return {
    enabled: () => client.isConfigured(),

    /** 광고를 띄우기 직전 — 일회용 토큰 발급 */
    async start(userId: string, req: TossRewardStartRequestDto): Promise<TossRewardStartDto> {
      await requireTossUser(userId);
      const limitReached = () => conflict('오늘 받을 수 있는 광고 보상을 모두 받았어요.', { reason: 'DAILY_LIMIT' });
      if (req.kind === 'credit') {
        if ((await rewards.todayCount(userId)) >= config.REWARDED_AD_DAILY_LIMIT) throw limitReached();
      } else if (await unlockedToday(userId, req.slot)) {
        throw limitReached();
      }
      const issuedAt = now();
      const token = await new SignJWT({ kind: req.kind, slot: req.kind === 'unlock' ? req.slot : undefined, st: issuedAt })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setJti(randomUUID())
        .setIssuer(ISSUER)
        .setIssuedAt(Math.floor(issuedAt / 1000))
        .setExpirationTime(Math.floor(issuedAt / 1000) + TOKEN_TTL_SEC)
        .sign(key);
      return { token, expiresAt: new Date(issuedAt + TOKEN_TTL_SEC * 1000).toISOString(), minWatchMs: TOSS_REWARD_MIN_WATCH_MS };
    },

    /** 광고를 끝까지 본 뒤 — 토큰 확인 후 지급 */
    async claim(userId: string, token: string): Promise<TossRewardClaimDto> {
      await requireTossUser(userId);
      let payload;
      try {
        ({ payload } = await jwtVerify(token, key, { issuer: ISSUER, currentDate: new Date(now()) }));
      } catch {
        throw badRequest('광고 보상을 확인하지 못했어요. 광고를 다시 봐 주세요.');
      }
      const kind = payload.kind;
      const slot = payload.slot as TossRewardSlot | undefined;
      const jti = payload.jti;
      const startedAt = typeof payload.st === 'number' ? payload.st : 0;
      if (payload.sub !== userId || !jti || (kind !== 'credit' && kind !== 'unlock') || (kind === 'unlock' && !(slot && TOSS_REWARD_SLOTS.includes(slot)))) {
        throw badRequest('광고 보상을 확인하지 못했어요. 광고를 다시 봐 주세요.');
      }
      if (now() - startedAt < TOSS_REWARD_MIN_WATCH_MS) return { granted: false, reason: 'TOO_EARLY' };

      if (kind === 'unlock') {
        const dateKey = dateKeyKst();
        // 하루 1회 — 같은 날 다시 요청해도 이미 열린 상태를 그대로 알려 준다
        await db
          .insert(webhookEvents)
          .values({ id: unlockId(userId, slot!, dateKey), provider: PROVIDER, eventType: `unlock:${slot}`, payload: { userId, dateKey, jti }, processedAt: now() })
          .onConflictDoNothing();
        return { granted: true, kind: 'unlock', slot: slot!, dateKey };
      }

      // 같은 토큰이 동시에 두 번 와도 먼저 기록한 쪽만 지급한다
      const recorded = await db
        .insert(webhookEvents)
        .values({ id: `tossad:${jti}`, provider: PROVIDER, eventType: 'credit', payload: { userId }, processedAt: now() })
        .onConflictDoNothing()
        .returning({ id: webhookEvents.id });
      if (recorded.length === 0) return { granted: false, reason: 'DUPLICATE' };
      let credits: number | null;
      try {
        // 하루 한도는 지급 묶음 실행 시점에 확인한다 — 미리 받아 둔 토큰 여러 개로 동시에 요청해도 한도를 넘지 않는다
        credits = await commerce.grantDailyCapped(userId, config.REWARDED_AD_CREDITS, REWARD_MEMO, config.REWARDED_AD_DAILY_LIMIT, rewards.todayStart());
      } catch (e) {
        // 지급하지 못했으니 토큰 사용 기록을 지운다 — 앱이 같은 토큰으로 다시 요청하면 그때 지급한다
        await db.delete(webhookEvents).where(eq(webhookEvents.id, `tossad:${jti}`));
        throw e;
      }
      if (credits === null) return { granted: false, reason: 'DAILY_LIMIT' };
      return { granted: true, kind: 'credit', credits };
    },
  };
}

export type TossRewardsService = ReturnType<typeof createTossRewardsService>;
