/**
 * Cloudflare Worker 진입점 — 웹(정적 파일)과 API 를 한 Worker 로 낸다(wrangler.jsonc).
 *  - fetch: /api/*·/health 만 이 코드가 받는다(assets.run_worker_first). 나머지 주소는 정적 파일(apps/web/dist)
 *  - scheduled: 매일 08:00 KST 오늘의 운세 푸시·운영 하루 요약, 10분마다 결제 확인 지연·묶음 알림 정리
 *  - queue: 리포트 AI 다듬기(응답 뒤 작업)
 */
import { buildApp, type App } from './app.js';
import { withBackground } from './lib/alert.js';
import { loadConfig } from './config/env.js';
import { d1Db } from './db/client.js';
import { ensureCatalog } from './db/seed.js';
import { runDailyPush } from './jobs/dailyPush.js';
import type { BackgroundJob } from './modules/reports/service.js';

export interface Env {
  DB: D1Database;
  JOBS: Queue<BackgroundJob>;
  RATE_LIMIT_API?: RateLimit;
  RATE_LIMIT_AUTH?: RateLimit;
  RATE_LIMIT_SESSION?: RateLimit;
  RATE_LIMIT_ADMIN?: RateLimit;
  /** 토스 파트너 API 용 mTLS 인증서 바인딩(wrangler.jsonc mtls_certificates). 없으면 토스 기능은 꺼진다 */
  TOSS_MTLS?: Fetcher;
}

/** 매일 08:00 KST(23:00 UTC) 예약 실행 — wrangler.jsonc triggers.crons 와 같은 글이어야 한다 */
const DAILY_CRON = '0 23 * * *';

/** 예약 작업 하나 — 실패해도 다음 작업은 이어서 한다 */
async function run(name: string, task: () => Promise<unknown>) {
  try {
    await task();
  } catch (error) {
    console.error(`[scheduled] ${name} 실패`, error instanceof Error ? error.message : String(error));
  }
}

/** 인스턴스(isolate)마다 한 번 조립한다 — env 는 인스턴스 안에서 같다 */
let instance: { app: App; ready: Promise<void> } | undefined;

function boot(env: Env) {
  if (instance) return instance;
  // vars·시크릿은 문자열 바인딩으로 들어온다 — D1·Queue 같은 객체 바인딩은 빼고 설정으로 읽는다
  const vars = Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === 'string'));
  const config = loadConfig({ ...vars, __SKIP_ENV_FILE: '1' });
  const db = d1Db(env.DB);
  const app = buildApp({
    config,
    db,
    deps: {
      startJob: async (job) => {
        await env.JOBS.send(job);
      },
      tossFetch: env.TOSS_MTLS ? (input, init) => env.TOSS_MTLS!.fetch(input, init) : undefined,
    },
    // 요청 수 제한은 운영에서만 — 로컬(wrangler dev)·E2E 는 한 IP 에서 계정을 잔뜩 만든다
    rateLimiters: config.isProd ? { general: env.RATE_LIMIT_API, auth: env.RATE_LIMIT_AUTH, session: env.RATE_LIMIT_SESSION, admin: env.RATE_LIMIT_ADMIN } : {},
  });
  const ready = ensureCatalog(db).catch((error: unknown) => {
    instance = undefined; // 다음 요청에서 다시 시도
    throw error;
  });
  instance = { app, ready };
  return instance;
}

export default {
  async fetch(request, env, ctx) {
    const { app, ready } = boot(env);
    await ready;
    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    const { app, ready } = boot(env);
    await ready;
    const { config, services } = app.ctx;
    await withBackground(
      (task) => ctx.waitUntil(task),
      async () => {
        // 10분마다 — 결제 확인 지연, 끝난 묶음 창의 'N건 더' 알림. 23:00 UTC 에는 두 예약이 함께 실행되므로 하루 작업 쪽에서는 하지 않는다
        if (controller.cron !== DAILY_CRON) {
          await run('결제 확인 지연', () => services.ops.checkPendingPayments());
          await run('묶음 알림 정리', () => services.ops.flushWindows());
          return;
        }
        await run('운영 하루 요약', () => services.ops.sendDailySummary());
        await run('운영 집계 정리', () => services.ops.cleanup());
        if (config.features.push && config.DAILY_PUSH_ENABLED) await run('오늘의 운세 푸시', () => runDailyPush(services));
        // 토스 인앱 결제에는 환불 알림이 없다 — 하루 한 번 최근 주문의 환불 여부를 다시 확인한다
        if (services.tossIap.enabled()) await run('토스 환불 확인', async () => console.info('[toss] 환불 확인', await services.tossIap.syncRefunds()));
      },
    );
  },

  async queue(batch, env, ctx) {
    const { app, ready } = boot(env);
    await ready;
    await withBackground(
      (task) => ctx.waitUntil(task),
      async () => {
        for (const message of batch.messages) {
          // 다듬기는 실패해도 규칙 기반 본문으로 마무리하고 끝난다 — 다시 보낼 일이 없다
          if (message.body.kind === 'polish') await app.ctx.services.reports.runPolish(message.body.reportId);
          message.ack();
        }
      },
    );
  },
} satisfies ExportedHandler<Env, BackgroundJob>;
