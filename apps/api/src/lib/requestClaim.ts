/**
 * 요청 ID 선점 — 질문권을 쓰는 요청(AI 상담·꿈풀이)이 같은 요청 ID 로 두 번 와도 한 번만 처리한다.
 * webhook_events 의 기본 키(<종류>:<사용자 ID>:<요청 ID>)를 먼저 넣은 요청만 처리하고, 처리 결과(답변 ID 등)를 payload 에 적는다.
 * 처리 중 오류가 나면 선점을 풀어(release) 같은 요청 ID 로 다시 시도할 수 있게 한다.
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { webhookEvents } from '../db/schema.js';

export type Claim<T> = { claimed: true; key: string } | { claimed: false; key: string; result: T | null };

export function createRequestClaims(db: Db) {
  return {
    async claim<T>(kind: string, userId: string, requestId: string): Promise<Claim<T>> {
      const key = `${kind}:${userId}:${requestId}`;
      const inserted = await db
        .insert(webhookEvents)
        .values({ id: key, provider: 'app', eventType: `${kind}_request`, payload: {} })
        .onConflictDoNothing()
        .returning({ id: webhookEvents.id });
      if (inserted.length === 1) return { claimed: true, key };
      const [row] = await db.select({ payload: webhookEvents.payload, processedAt: webhookEvents.processedAt }).from(webhookEvents).where(eq(webhookEvents.id, key));
      return { claimed: false, key, result: row?.processedAt ? ((row.payload as T) ?? null) : null };
    },
    async complete(key: string, result: object) {
      await db.update(webhookEvents).set({ payload: result, processedAt: Date.now() }).where(eq(webhookEvents.id, key));
    },
    async release(key: string) {
      await db.delete(webhookEvents).where(eq(webhookEvents.id, key));
    },
  };
}

export type RequestClaims = ReturnType<typeof createRequestClaims>;
