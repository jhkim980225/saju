/**
 * E2E 전용 API 기동 스크립트 (playwright.config.ts 의 webServer 가 실행).
 *  1) 임시 DB(DATABASE_PATH, 기본 ./data/e2e.db)를 지우고
 *  2) cwd 를 apps/api 로 옮긴 뒤(.env·drizzle 마이그레이션 폴더가 cwd 기준) tsx 로 src/server.ts 를 같은 프로세스에서 실행한다.
 * 같은 프로세스에서 실행하므로 Playwright 가 종료 시 이 프로세스만 정리하면 서버도 함께 내려간다.
 * 환경 변수는 webServer.env 로 넘긴 값이 apps/api/.env 보다 우선한다(process.loadEnvFile 은 기존 값을 덮어쓰지 않음).
 */
import { rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const apiDir = resolve(root, 'apps/api');
process.chdir(apiDir);

const dbPath = resolve(apiDir, process.env.DATABASE_PATH ?? './data/e2e.db');
// 안전장치: 개발 DB(saju.db)를 실수로 지우지 않도록 e2e 전용 파일명만 허용
if (!/e2e/i.test(basename(dbPath))) {
  console.error(`[e2e] DATABASE_PATH 는 e2e 전용 파일이어야 해요: ${dbPath}`);
  process.exit(1);
}
for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(dbPath + suffix, { force: true });
console.log(`[e2e] 임시 DB 초기화: ${dbPath}`);

register();
await import(pathToFileURL(resolve(apiDir, 'src/server.ts')).href);
