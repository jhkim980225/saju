/**
 * 보상형 광고(AdMob) 서버 측 검증(SSV) — 광고 시청 보상으로 무상 질문권을 지급한다.
 * - AdMob 콘솔 > 광고 단위 > 서버 측 확인 URL: {API}/api/v1/rewards/admob-ssv
 * - 앱은 광고 요청 시 serverSideVerificationOptions.userId = 사용자 ID 로 설정한다.
 * - Google 공개키(https://www.gstatic.com/admob/reward/verifier-keys.json)로 ECDSA(SHA-256) 서명을 검증한다.
 * - 거래 ID(transaction_id)로 멱등 처리, 하루 지급 한도(REWARDED_AD_DAILY_LIMIT, 기본 3) 적용.
 */
import { createPublicKey, verify } from 'node:crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { creditLedger, users, webhookEvents } from '../../db/schema.js';
import { badRequest } from '../../lib/errors.js';
import type { CommerceService } from '../commerce/service.js';

export const ADMOB_KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
const REWARD_MEMO = '광고 보상';
const KEY_CACHE_MS = 24 * 3_600_000;
/** 알 수 없는 key_id 로 인한 공개키 재조회 최소 간격 (외부 요청 증폭 방지) */
const KEY_REFETCH_MIN_MS = 10 * 60_000;

export interface RewardsDeps {
  /** keyId → PEM 공개키 (테스트 주입용) */
  fetchKeys?: () => Promise<Map<string, string>>;
  now?: () => number;
}

export function createRewardsService(config: AppConfig, db: Db, commerce: CommerceService, deps: RewardsDeps = {}) {
  const now = deps.now ?? Date.now;
  let cache: { keys: Map<string, string>; at: number } | undefined;

  const fetchKeys =
    deps.fetchKeys ??
    (async () => {
      const res = await fetch(ADMOB_KEYS_URL, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`AdMob 공개키 조회 실패 HTTP ${res.status}`);
      const body = (await res.json()) as { keys?: { keyId: number | string; pem: string }[] };
      return new Map((body.keys ?? []).map((k) => [String(k.keyId), k.pem]));
    });

  const keyFor = async (keyId: string): Promise<string | undefined> => {
    const stale = !cache || now() - cache.at > KEY_CACHE_MS;
    const unknownButMayRefetch = cache && !cache.keys.has(keyId) && now() - cache.at > KEY_REFETCH_MIN_MS;
    if (stale || unknownButMayRefetch) cache = { keys: await fetchKeys(), at: now() };
    return cache!.keys.get(keyId);
  };
  const allowedUnits = config.ADMOB_REWARDED_AD_UNITS.split(',').map((u) => u.trim()).filter(Boolean);

  /** KST 오늘 0시(epoch ms) */
  const startOfTodayKst = () => {
    const kst = now() + 9 * 3_600_000;
    return Math.floor(kst / 86_400_000) * 86_400_000 - 9 * 3_600_000;
  };

  return {
    /** 오늘 받은 광고 보상 횟수 */
    todayCount(userId: string): number {
      return (
        db
          .select({ n: sql<number>`count(*)` })
          .from(creditLedger)
          .where(and(eq(creditLedger.userId, userId), eq(creditLedger.reason, 'bonus'), eq(creditLedger.memo, REWARD_MEMO), gte(creditLedger.createdAt, startOfTodayKst())))
          .get()?.n ?? 0
      );
    },

    /**
     * SSV 콜백 처리. rawQuery 는 URL 의 "?" 뒤 원문(인코딩 그대로) — 서명 대상이 원문 순서이므로 파싱 전 문자열이 필요하다.
     * @returns granted: 지급 여부, reason: 미지급 사유
     */
    async handleAdmobSsv(rawQuery: string): Promise<{ granted: boolean; reason?: string; credits?: number }> {
      const sigIndex = rawQuery.indexOf('&signature=');
      if (sigIndex < 0) throw badRequest('서명이 없어요.');
      const message = rawQuery.slice(0, sigIndex);
      const params = new URLSearchParams(rawQuery);
      const signature = params.get('signature');
      const keyId = params.get('key_id');
      if (!signature || !keyId) throw badRequest('서명 정보가 올바르지 않아요.');
      const pem = await keyFor(keyId);
      if (!pem) throw badRequest('알 수 없는 서명 키예요.');
      const ok = verify('sha256', Buffer.from(message, 'utf8'), { key: createPublicKey(pem), dsaEncoding: 'der' }, Buffer.from(signature, 'base64url'));
      if (!ok) throw badRequest('서명 검증에 실패했어요.');

      // 다른 앱의 광고 단위가 콜백 URL 을 우리 서버로 지정해 보상을 받아 가는 것 방지
      const adUnit = params.get('ad_unit') ?? '';
      if (allowedUnits.length > 0 ? !allowedUnits.some((u) => adUnit === u || u.endsWith(`/${adUnit}`)) : config.isProd) {
        return { granted: false, reason: 'AD_UNIT_NOT_ALLOWED' };
      }
      const transactionId = params.get('transaction_id');
      const userId = params.get('user_id');
      if (!transactionId || !userId) return { granted: false, reason: 'MISSING_PARAMS' };
      const eventId = `admob:${transactionId}`;
      if (db.select({ id: webhookEvents.id }).from(webhookEvents).where(eq(webhookEvents.id, eventId)).get()) return { granted: false, reason: 'DUPLICATE' };
      db.insert(webhookEvents).values({ id: eventId, provider: 'admob', eventType: 'reward', payload: Object.fromEntries(params), processedAt: now() }).run();

      const user = db.select({ id: users.id, deletedAt: users.deletedAt }).from(users).where(eq(users.id, userId)).get();
      if (!user || user.deletedAt) return { granted: false, reason: 'UNKNOWN_USER' };
      if (this.todayCount(userId) >= config.REWARDED_AD_DAILY_LIMIT) return { granted: false, reason: 'DAILY_LIMIT' };
      const credits = commerce.grantFreeCredits(userId, config.REWARDED_AD_CREDITS, REWARD_MEMO);
      return { granted: true, credits };
    },
  };
}

export type RewardsService = ReturnType<typeof createRewardsService>;
