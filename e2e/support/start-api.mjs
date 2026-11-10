/**
 * E2E 전용 API 기동 스크립트 (playwright.config.ts 의 webServer 가 실행).
 *  1) 임시 로컬 D1 저장 폴더(apps/api/.wrangler/e2e-state)를 지우고
 *  2) e2e 설정 파일(.wrangler/e2e.env — playwright webServer.env 로 받은 값)을 써서
 *  3) apps/api/scripts/local.mjs 로 마이그레이션 + wrangler dev 를 띄운다(운영과 같은 workerd·D1).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const apiDir = resolve(root, 'apps/api');
const stateDir = resolve(apiDir, '.wrangler/e2e-state');
const envFile = resolve(apiDir, '.wrangler/e2e.env');

rmSync(stateDir, { recursive: true, force: true });
mkdirSync(dirname(envFile), { recursive: true });
console.log(`[e2e] 임시 DB 초기화: ${stateDir}`);

// playwright webServer.env 로 받은 설정 — apps/api/.env(개인 키 포함)는 읽지 않는다
const KEYS = ['NODE_ENV', 'CORS_ORIGINS', 'PUBLIC_WEB_URL', 'PAYMENT_PROVIDER', 'ANTHROPIC_API_KEY', 'RESEND_API_KEY', 'MAIL_FROM', 'SUPPORT_EMAIL', 'DAILY_PUSH_ENABLED', 'ADS_ENABLED', 'SIGNUP_BONUS_CREDITS'];
writeFileSync(envFile, KEYS.map((k) => `${k}=${process.env[k] ?? ''}`).join('\n') + '\n');

const child = spawn(
  process.execPath,
  [resolve(apiDir, 'scripts/local.mjs'), '--port', process.env.PORT ?? '4100', '--ip', '127.0.0.1', '--persist-to', stateDir, '--env-file', envFile, '--show-interactive-dev-session=false'],
  { cwd: apiDir, stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
