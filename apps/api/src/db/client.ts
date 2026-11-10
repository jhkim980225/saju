/**
 * DB 연결 — Cloudflare D1 (SQLite).
 *  - 운영·wrangler dev: Worker 의 D1 바인딩(env.DB)을 drizzle 로 감싼다(d1Db).
 *  - Node(테스트·스크립트): db/local.ts 의 libSQL 인메모리/파일 DB — 같은 SQLite 쿼리 API.
 * D1 에는 BEGIN…COMMIT 트랜잭션이 없다 — 여러 쓰기를 함께 해야 하면 db.batch, 읽고 판단한 뒤 쓰려면 db/atomic.ts 를 쓴다.
 */
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema.js';

export type Db = DrizzleD1Database<typeof schema>;

export function d1Db(binding: D1Database): Db {
  return drizzle(binding, { schema });
}

/** 오류와 그 원인(drizzle 이 드라이버 오류를 cause 로 감싼다) 중 메시지에 text 가 들어 있는가 */
export function errorMentions(e: unknown, text: string): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 5; cur = (cur as { cause?: unknown }).cause, depth++) {
    if (String((cur as { message?: unknown }).message ?? '').includes(text)) return true;
  }
  return false;
}

/** 유니크 제약 위반 — D1·libSQL 모두 SQLite 메시지를 그대로 쓴다 */
export const isUniqueViolation = (e: unknown) => errorMentions(e, 'UNIQUE constraint failed');
