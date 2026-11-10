/**
 * Node 에서 쓰는 SQLite — 테스트·스크립트용. Worker 번들에는 들어가지 않는다.
 *  - 기본: libSQL 인메모리/파일. D1 과 같은 SQLite 이고 drizzle 쿼리 API 도 같다(batch 는 한 트랜잭션). D1 처럼 외래 키를 켠다.
 *  - TEST_D1=1: 진짜 D1(Miniflare — wrangler dev 와 같은 workerd 의 D1)로 돌린다. CI 가 한 번 더 이렇게 돈다.
 */
import { createClient } from '@libsql/client';
import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import { migrate as migrateD1 } from 'drizzle-orm/d1/migrator';
import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql';
import { migrate as migrateLibsql } from 'drizzle-orm/libsql/migrator';
import { resolve } from 'node:path';
import type { Db } from './client.js';
import * as schema from './schema.js';

const migrators = new WeakMap<Db, (folder: string) => Promise<void>>();

/**
 * @param url ':memory:'(기본) 또는 SQLite 파일 경로
 */
export function createDb(url = ':memory:'): { db: Db; close: () => Promise<void> } {
  if (process.env.TEST_D1 && url === ':memory:') return createMiniflareDb();
  const client = createClient({ url: url === ':memory:' ? ':memory:' : `file:${resolve(url)}` });
  const lib = drizzleLibsql(client, { schema });
  // libSQL 과 D1 드라이버는 쿼리 API 가 같다 — 결과 타입만 다르다
  const db = lib as unknown as Db;
  migrators.set(db, async (migrationsFolder) => {
    await client.execute('PRAGMA foreign_keys = ON');
    await migrateLibsql(lib, { migrationsFolder });
  });
  return { db, close: async () => client.close() };
}

/**
 * Miniflare 의 D1 — 띄우는 일이 비동기라, 첫 쿼리 때 준비된 D1 으로 넘겨주는 얇은 대리 객체를 drizzle 에 준다
 * (drizzle 은 prepare 를 동기로 부르고, 실제 실행 bind().all()/run()/raw()·batch() 는 비동기)
 */
function createMiniflareDb(): { db: Db; close: () => Promise<void> } {
  const started = import('miniflare').then(async ({ Miniflare, convertV4MiniflareOptions }) => {
    const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {}', compatibilityDate: '2026-10-20', d1Databases: { DB: 'test' } }));
    return { mf, d1: (await mf.getD1Database('DB')) as unknown as D1Database };
  });
  type Lazy = { sql: string; params: unknown[] };
  const real = async (s: Lazy) => (await started).d1.prepare(s.sql).bind(...s.params);
  const statement = (sql: string, params: unknown[] = []) => {
    const s: Lazy & Record<string, unknown> = {
      sql,
      params,
      bind: (...p: unknown[]) => statement(sql, p),
      all: async () => (await real(s)).all(),
      run: async () => (await real(s)).run(),
      raw: async (o?: { columnNames?: boolean }) => (await real(s)).raw(o as { columnNames: true }),
      first: async (col?: string) => (await real(s)).first(col as string),
    };
    return s;
  };
  const proxy = {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: Lazy[]) => (await started).d1.batch(await Promise.all(stmts.map(real))),
    exec: async (sql: string) => (await started).d1.exec(sql),
  } as unknown as D1Database;
  const d1 = drizzleD1(proxy, { schema });
  migrators.set(d1, (migrationsFolder) => migrateD1(d1, { migrationsFolder }));
  return { db: d1, close: async () => (await started).mf.dispose() };
}

/** drizzle/*.sql 적용 — 운영·wrangler dev 는 wrangler d1 migrations apply 가 같은 파일을 적용한다 */
export async function runMigrations(db: Db, migrationsFolder = resolve(process.cwd(), 'drizzle')) {
  const run = migrators.get(db);
  if (!run) throw new Error('db/local.ts 의 createDb 로 만든 DB 가 아니에요.');
  await run(migrationsFolder);
}

export type { Db } from './client.js';
