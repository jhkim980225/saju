/**
 * 이메일 로그인 무차별 대입 방지 — 같은 이메일로 WINDOW_MS 안에 MAX_FAILURES 번 틀리면 창이 끝날 때까지 그 이메일의 로그인을 막는다.
 * IP 를 바꿔 가며 한 계정의 비밀번호를 맞히는 공격을 막는다(IP 기준 제한은 lib/http.ts 의 rateLimit).
 * 가입하지 않은 이메일도 똑같이 세서, 막히는 동작으로 계정이 있는지 알 수 없게 한다.
 */
import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { ERROR_CODES } from '@saju/shared';
import type { Db } from '../../db/client.js';
import { loginFailures } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';

export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60_000;

const keyOf = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

export function createLoginThrottle(db: Db, now: () => number = Date.now, onLocked?: () => void) {
  return {
    /** 막힌 이메일이면 429 — 비밀번호를 확인하기 전에 부른다 */
    async assertAllowed(email: string) {
      const [row] = await db.select().from(loginFailures).where(eq(loginFailures.emailHash, keyOf(email)));
      if (row && now() - row.windowStart < LOGIN_WINDOW_MS && row.count >= LOGIN_MAX_FAILURES) {
        const minutes = Math.ceil((row.windowStart + LOGIN_WINDOW_MS - now()) / 60_000);
        throw new AppError(429, ERROR_CODES.RATE_LIMITED, `로그인 시도가 너무 많아요. ${minutes}분 뒤에 다시 시도해 주세요.`);
      }
    },
    /** 틀렸을 때 — 창이 지났으면 1부터 다시 센다(한 문장으로 올려서 동시 요청에도 빠지지 않는다) */
    async recordFailure(email: string) {
      const t = now();
      const windowFrom = t - LOGIN_WINDOW_MS;
      const [row] = await db
        .insert(loginFailures)
        .values({ emailHash: keyOf(email), count: 1, windowStart: t })
        .onConflictDoUpdate({
          target: loginFailures.emailHash,
          set: {
            count: sql`case when ${loginFailures.windowStart} < ${windowFrom} then 1 else ${loginFailures.count} + 1 end`,
            windowStart: sql`case when ${loginFailures.windowStart} < ${windowFrom} then ${t} else ${loginFailures.windowStart} end`,
          },
        })
        .returning({ count: loginFailures.count });
      // 이번 실패로 잠겼다(하루 요약의 '로그인 잠금' 횟수)
      if (row?.count === LOGIN_MAX_FAILURES) onLocked?.();
    },
    /** 맞혔을 때 — 기록을 지운다 */
    async clear(email: string) {
      await db.delete(loginFailures).where(eq(loginFailures.emailHash, keyOf(email)));
    },
  };
}

export type LoginThrottle = ReturnType<typeof createLoginThrottle>;
