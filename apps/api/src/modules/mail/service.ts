/**
 * 메일 발송 — Resend HTTPS API (`POST https://api.resend.com/emails`).
 * 필요한 env: RESEND_API_KEY, MAIL_FROM. 없으면 501 NOT_CONFIGURED (웹은 문의 안내로 대체). 설정 방법은 docs/ENV_KEYS.md 참고.
 *
 * - 새 의존성 없이 fetch 로 호출한다(푸시 모듈의 FCM 호출과 같은 방식)
 * - 테스트 환경(config.isTest)에서는 실제로 보내지 않고 메모리 outbox 에 쌓는다 → 테스트가 본문에서 토큰을 읽는다
 */
import type { AppConfig } from '../../config/env.js';
import { notConfigured } from '../../lib/errors.js';

export const MAIL_ENV_KEYS = ['RESEND_API_KEY', 'MAIL_FROM'];

export interface MailMessage {
  to: string;
  subject: string;
  /** 본문(텍스트). HTML 을 못 읽는 클라이언트용이자 테스트가 토큰을 읽는 곳 */
  text: string;
  html?: string;
}

/** 테스트용 의존성 주입 */
export interface MailDeps {
  fetch?: typeof fetch;
}

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

export function createMailService(config: AppConfig, deps: MailDeps = {}) {
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => fetch(input, init));
  /** 테스트 환경에서 "보낸" 메일 (실제 발송 없음) */
  const outbox: MailMessage[] = [];

  return {
    /** 키가 있어 실제로 보낼 수 있는지 */
    get enabled() {
      return config.features.mail;
    },
    outbox,
    async send(msg: MailMessage): Promise<void> {
      if (!config.features.mail) throw notConfigured('비밀번호 재설정 메일(Resend)', MAIL_ENV_KEYS);
      if (config.isTest) {
        outbox.push(msg);
        return;
      }
      const res = await doFetch(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.RESEND_API_KEY!}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: config.MAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text, ...(msg.html ? { html: msg.html } : {}) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: unknown; name?: unknown };
        throw new Error(`메일 발송 실패 (HTTP ${res.status} ${String(body.name ?? '')} ${String(body.message ?? '')})`.trim());
      }
    },
  };
}

export type MailService = ReturnType<typeof createMailService>;
