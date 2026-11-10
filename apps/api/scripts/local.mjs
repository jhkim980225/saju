#!/usr/bin/env node
/**
 * 로컬 Worker 실행 — 개발(npm run dev)과 E2E(e2e/support/start-api.mjs)가 같이 쓴다.
 *  1) 웹 빌드 폴더(../web/dist)가 없으면 빈 폴더를 만든다(wrangler.jsonc assets 가 가리키는 곳 — 개발 중 웹은 Vite 가 낸다)
 *  2) 로컬 D1 에 마이그레이션(drizzle/*.sql) 적용
 *  3) wrangler dev 실행 — 넘긴 인자(--port, --persist-to, --env-file …)는 그대로 전달
 * 설정은 apps/api/.env 를 읽는다(wrangler dev 가 wrangler.jsonc vars 위에 덮어쓴다).
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const persist = args.includes('--persist-to') ? ['--persist-to', args[args.indexOf('--persist-to') + 1]] : [];
const wrangler = resolve(apiDir, '../../node_modules/wrangler/bin/wrangler.js');
// CI=true — 마이그레이션 적용 확인 질문을 건너뛴다
const env = { ...process.env, CI: 'true' };

mkdirSync(resolve(apiDir, '../web/dist'), { recursive: true });

const migrate = spawnSync(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', ...persist], { cwd: apiDir, env, stdio: 'inherit' });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const dev = spawn(process.execPath, [wrangler, 'dev', ...args], { cwd: apiDir, env: process.env, stdio: 'inherit' });
dev.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => dev.kill(signal));
