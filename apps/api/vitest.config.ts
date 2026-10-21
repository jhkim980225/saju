import { defineConfig } from 'vitest/config';

// 테스트 DB 는 PGlite(WASM PostgreSQL) — 파일마다 띄우고 마이그레이션하는 데 몇 초 걸린다
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
