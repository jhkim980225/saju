/**
 * 원자적 쓰기 — D1 에는 BEGIN…COMMIT 대화형 트랜잭션이 없다. 대신 batch 는 한 번에(다른 요청이 끼어들지 않고) 실행되고,
 * 한 문장이라도 실패하면 묶음 전체가 취소된다.
 *
 * atomic(db, fn): fn 안에서 읽기는 바로 하고, 쓰기(u.write)는 모아 두었다가 끝에서 batch 하나로 실행한다.
 * fn 이 읽고 내린 판단의 전제(u.expect — 예: "주문이 아직 pending", "무상 질문권이 1 이상")를 batch 맨 앞에서 다시 확인해,
 * 조건이 참(1)이 아니면(거짓·NULL) — 그사이 다른 요청이 바꿨으면 — 묶음을 취소하고 fn 을 처음부터 다시 실행한다(낙관적 동시성 제어).
 *
 * 주의: fn 안의 읽기에는 아직 실행되지 않은 이 묶음의 쓰기가 보이지 않는다 — 누적 갱신은 SQL 로(credits = credits + ?) 쓴다.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { conflict } from '../lib/errors.js';
import { errorMentions, type Db } from './client.js';
import { atomicGuards } from './schema.js';

export interface Unit {
  /** batch 실행 시점에도 참이어야 하는 조건(SQL) — 거짓이면 묶음을 취소하고 처음부터 다시 */
  expect(condition: SQL): void;
  /** 묶음에 넣을 쓰기 */
  write(query: BatchItem<'sqlite'>): void;
}

const GUARD_FAILED = 'atomic_guards.guard_failed';
const ATTEMPTS = 12;

export async function atomic<T>(db: Db, fn: (u: Unit) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const guards: SQL[] = [];
    const writes: BatchItem<'sqlite'>[] = [];
    const value = await fn({ expect: (c) => guards.push(c), write: (q) => writes.push(q) });
    if (writes.length === 0) return value;
    // insert … select 로 쓴다 — drizzle 의 D1 batch 는 인자가 있는 db.run(sql) 원시 문장을 실행하지 못한다
    const checks = guards.map((c) => db.insert(atomicGuards).select(sql`select null where (${c}) is not 1`));
    const [first, ...rest] = [...checks, ...writes];
    try {
      await db.batch([first!, ...rest]);
      return value;
    } catch (e) {
      if (!errorMentions(e, GUARD_FAILED)) throw e;
      if (attempt >= ATTEMPTS) throw conflict('요청이 한꺼번에 몰려 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
      // 같은 자원을 두고 겨루는 요청끼리 다시 부딪히지 않게 조금씩 다르게 쉰다
      await new Promise((r) => setTimeout(r, Math.random() * 5 * attempt));
    }
  }
}
