import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

/** DB 연결 생성. path 가 ':memory:' 면 테스트용 인메모리 DB */
export function createDb(path: string): { db: BetterSQLite3Database<typeof schema>; sqlite: Database.Database } {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export function runMigrations(db: Db, migrationsFolder = resolve(process.cwd(), 'drizzle')) {
  migrate(db, { migrationsFolder });
}
