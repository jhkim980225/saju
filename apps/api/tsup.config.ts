import { defineConfig } from 'tsup';

/** 운영 빌드 — 워크스페이스 패키지(@saju/*)는 번들에 포함, 나머지 의존성은 node_modules 에서 로드 */
export default defineConfig({
  entry: ['src/server.ts', 'src/db/migrate.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  splitting: false,
  noExternal: [/^@saju\//],
});
