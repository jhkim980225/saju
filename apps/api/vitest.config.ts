import { defineConfig } from 'vitest/config';

// 테스트 DB 는 인메모리 SQLite(libSQL) — D1 과 같은 SQLite. 파일마다 새로 만들고 마이그레이션한다
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
