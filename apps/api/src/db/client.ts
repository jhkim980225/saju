/**
 * DB 연결 — PostgreSQL.
 *  - 운영: DATABASE_URL=postgres://… (Supabase 등). postgres.js 드라이버.
 *  - 개발·테스트: PGlite(프로세스 안에서 도는 PostgreSQL). ':memory:' 면 인메모리, 그 밖의 값은 데이터 폴더 경로.
 * 두 드라이버 모두 drizzle 의 같은 PostgreSQL 쿼리 API 를 쓰므로 서비스 코드는 Db 하나만 안다.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;
/** db.transaction 콜백이 받는 트랜잭션 — Db 와 같은 쿼리 API */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const isPostgresUrl = (url: string) => /^postgres(ql)?:\/\//i.test(url);

interface Handle {
  migrate: (migrationsFolder: string) => Promise<void>;
  close: () => Promise<void>;
}
const handles = new WeakMap<Db, Handle>();

/**
 * DB 연결 생성.
 * @param url postgres://… | ':memory:' | PGlite 데이터 폴더 경로
 */
export function createDb(url: string): { db: Db; close: () => Promise<void> } {
  // 테스트를 실제 PostgreSQL 로 돌릴 때(TEST_DATABASE_URL) — 인메모리 요청마다 빈 데이터베이스를 따로 만들어 서로 섞이지 않게 한다
  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  if (url === ':memory:' && testUrl) {
    const name = `t_${randomBytes(6).toString('hex')}`;
    const u = new URL(testUrl);
    u.pathname = `/${name}`;
    return createPostgres(u.toString(), { adminUrl: testUrl, name });
  }
  if (isPostgresUrl(url)) return createPostgres(url);
  if (url !== ':memory:') mkdirSync(resolve(url), { recursive: true });
  const client = url === ':memory:' ? new PGlite() : new PGlite(resolve(url));
  const pg = drizzlePglite(client, { schema });
  // pglite 와 postgres-js 드라이버는 쿼리 API 가 같다 — 결과 타입만 다르다
  const db = pg as unknown as Db;
  const close = () => client.close();
  handles.set(db, { migrate: (migrationsFolder) => migratePglite(pg, { migrationsFolder }), close });
  return { db, close };
}

function createPostgres(url: string, testDb?: { adminUrl: string; name: string }): { db: Db; close: () => Promise<void> } {
  // Supabase 트랜잭션 풀러(6543)는 prepared statement 를 지원하지 않는다
  const client = postgres(url, {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    onnotice: () => undefined,
  });
  const db = drizzlePostgres(client, { schema });
  const admin = async (sql: string) => {
    const a = postgres(testDb!.adminUrl, { max: 1, onnotice: () => undefined });
    try {
      await a.unsafe(sql);
    } finally {
      await a.end({ timeout: 5 });
    }
  };
  const close = async () => {
    await client.end({ timeout: 5 });
    if (testDb) await admin(`drop database if exists "${testDb.name}" with (force)`);
  };
  const migrate = async (migrationsFolder: string) => {
    // 연결은 첫 쿼리 때 열린다 — 그 전에 테스트용 데이터베이스를 만든다
    if (testDb) await admin(`create database "${testDb.name}"`);
    await migratePostgres(db, { migrationsFolder });
  };
  handles.set(db, { migrate, close });
  return { db, close };
}

export async function runMigrations(db: Db, migrationsFolder = resolve(process.cwd(), 'drizzle')) {
  const h = handles.get(db);
  if (!h) throw new Error('createDb 로 만든 DB 가 아니에요.');
  await h.migrate(migrationsFolder);
}

/** 유니크 제약 위반(23505) — drizzle 이 드라이버 오류를 cause 로 감싸는 경우까지 본다 */
export function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 4; cur = (cur as { cause?: unknown }).cause, depth++) {
    if ((cur as { code?: unknown }).code === '23505') return true;
  }
  return false;
}
