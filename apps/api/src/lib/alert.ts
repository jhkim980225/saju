/**
 * 운영 알림 — 결제·가입·장애 같은 사건을 OPS_ALERT_WEBHOOK_URL 로 보낸다(무엇을 언제 보내는지는 modules/ops/service.ts).
 * Discord 웹훅 형식({"content": "..."})이라 Discord·Slack 호환 웹훅에 그대로 쓸 수 있다.
 * 알림 실패가 결제 처리를 깨지 않도록 오류는 삼키고, 로그는 언제나 남긴다. 개인정보(이메일·이름·연락처·생년월일)는 넣지 않는다.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AppConfig } from '../config/env.js';

export type OpsAlert = (text: string) => Promise<void>;

const DISCORD_CONTENT_MAX = 1900;

export function createOpsAlert(config: Pick<AppConfig, 'OPS_ALERT_WEBHOOK_URL' | 'APP_NAME'>): OpsAlert {
  return async (text) => {
    console.warn(`[ops-alert] ${text}`);
    const url = config.OPS_ALERT_WEBHOOK_URL;
    if (!url) return;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: `[${config.APP_NAME}] ${text}`.slice(0, DISCORD_CONTENT_MAX) }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) console.warn(`[ops-alert] 알림 전송 실패 HTTP ${res.status}`);
    } catch (e) {
      console.warn('[ops-alert] 알림 전송 실패', e instanceof Error ? e.message : String(e));
    }
  };
}

// ── 응답 뒤 작업 ────────────────────────────────────────────
// 가입·결제 응답이 알림 전송(외부 호출)을 기다리지 않게 한다. Worker 는 응답을 보낸 뒤 waitUntil 로 받은 작업만 끝까지 돌려 주므로
// 요청마다 그 요청의 waitUntil 을 AsyncLocalStorage 에 두고 꺼내 쓴다(요청 사이에 작업을 섞으면 Worker 가 막는다).
// 테스트·Node 처럼 요청 범위가 없으면 그냥 돌리고, flushBackground() 로 끝날 때까지 기다릴 수 있다.

type WaitUntil = (task: Promise<unknown>) => void;
const scope = new AsyncLocalStorage<WaitUntil>();
const loose = new Set<Promise<unknown>>();

/** 이 요청(예약 실행)의 응답 뒤 작업을 받을 waitUntil 을 걸고 fn 을 실행한다 */
export function withBackground<T>(waitUntil: WaitUntil, fn: () => T): T {
  return scope.run(waitUntil, fn);
}

/** 응답을 기다리게 하지 않고 뒤에서 끝낸다 — 작업의 오류는 삼킨다(로그만) */
export function background(task: Promise<unknown>): void {
  const safe = task.catch((e: unknown) => console.warn('[background] 작업 실패', e instanceof Error ? e.message : String(e)));
  const waitUntil = scope.getStore();
  if (waitUntil) {
    waitUntil(safe);
    return;
  }
  loose.add(safe);
  void safe.finally(() => loose.delete(safe));
}

/** 테스트용 — 요청 범위 밖에서 시작한 뒤 작업이 모두 끝날 때까지 기다린다 */
export async function flushBackground(): Promise<void> {
  while (loose.size > 0) await Promise.all([...loose]);
}
