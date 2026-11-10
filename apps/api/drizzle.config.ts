import { defineConfig } from 'drizzle-kit';

// 마이그레이션 SQL 생성(npm run db:generate)은 DB 연결 없이 스키마만 본다.
// 결과(drizzle/*.sql)는 wrangler d1 migrations apply 가 그대로 적용한다(wrangler.jsonc migrations_dir)
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
