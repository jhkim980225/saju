/**
 * 요청 ID 선점 — 질문권을 쓰는 요청(AI 상담·꿈풀이)이 같은 요청 ID 로 두 번 와도 한 번만 처리한다.
 * webhook_events 의 기본 키(<종류>:<사용자 ID>:<요청 ID>)를 먼저 넣은 요청만 처리하고, 처리 결과(답변 ID 등)를 payload 에 적는다.
 * 처리 중 오류가 나면 선점을 풀어(release) 같은 요청 ID 로 다시 시도할 수 있게 한다.
 * 기록은 재전송을 막는 동안만 필요하다 — 정리 작업(ops cleanup)이 2일 뒤 지우고, 탈퇴하면 userEventsWhere 로 바로 지운다.
 */
import { and, eq, like, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { webhookEvents } from '../db/schema.js';

/** 요청 ID 선점 행의 provider 값 */
export const REQUEST_CLAIM_PROVIDER = 'app';
/** 요청 ID 를 쓰는 종류 — 키 앞부분(<종류>:<사용자 ID>:)으로 한 사용자의 기록을 찾는다 */
export const REQUEST_CLAIM_KINDS = ['chat', 'dream'] as const;

export type Claim<T> = { claimed: true; key: string } | { claimed: false; key: string; result: T | null };

/**
 * 한 사용자에게 묶인 webhook_events 행 — 요청 ID 선점(chat·dream)과 토스 날짜 열기 기록(tossad:unlock:<slot>:<사용자 ID>:<날짜>).
 * 탈퇴 처리(users.deleteAccount)가 같은 묶음 안에서 `db.delete(webhookEvents).where(userEventsWhere(id))` 로 지운다.
 * D1 은 LIKE 패턴을 50바이트까지만 받는다(넘으면 "pattern too complex" 로 문장 전체가 실패해 탈퇴가 500 이 된다).
 * 사용자 ID(36자)를 패턴에 넣으면 이 한도를 넘을 수 있어, 접두어는 substr 로 비교하고 토스 기록은 instr 로 사용자 ID 를 찾는다.
 */
export function userEventsWhere(userId: string) {
  const prefixes = REQUEST_CLAIM_KINDS.map((k) => `${k}:${userId}:`);
  return or(
    ...prefixes.map((p) => sql`substr(${webhookEvents.id}, 1, ${p.length}) = ${p}`),
    and(like(webhookEvents.id, 'tossad:unlock:%'), sql`instr(${webhookEvents.id}, ${`:${userId}:`}) > 0`),
  )!;
}

export function createRequestClaims(db: Db) {
  return {
    async claim<T>(kind: (typeof REQUEST_CLAIM_KINDS)[number], userId: string, requestId: string): Promise<Claim<T>> {
      const key = `${kind}:${userId}:${requestId}`;
      const inserted = await db
        .insert(webhookEvents)
        .values({ id: key, provider: REQUEST_CLAIM_PROVIDER, eventType: `${kind}_request`, payload: {} })
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
