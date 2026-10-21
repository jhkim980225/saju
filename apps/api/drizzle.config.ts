import { defineConfig } from 'drizzle-kit';

// 마이그레이션 SQL 생성(npm run db:generate)은 DB 연결 없이 스키마만 본다
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
