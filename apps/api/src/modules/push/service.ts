/**
 * 푸시 알림 — 기기 토큰 등록 + 발송(FCM HTTP v1).
 * 필요한 env: FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY (Firebase 서비스 계정). 설정 방법은 docs/AUTH_PUSH.md 참고.
 *
 * - 액세스 토큰: 서비스 계정 키로 서명한 JWT(RS256)를 OAuth2 JWT bearer 그랜트로 교환, 만료 1분 전까지 메모리 캐시
 * - 발송: 토큰마다 messages:send 호출. 404 / UNREGISTERED 응답 토큰은 DB 에서 삭제
 * - users.pushEnabled=false(수신 거부) 사용자에게는 보내지 않는다
 * - "오늘의 운세" 아침 발송은 sendDailyFortuneDigest() 를 스케줄러에서 호출
 */
import { and, eq, isNull } from 'drizzle-orm';
import { SignJWT, importPKCS8, type CryptoKey } from 'jose';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { pushTokens, users } from '../../db/schema.js';
import { notConfigured } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';

export const FCM_ENV_KEYS = ['FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY'];

export interface PushMessage {
  title: string;
  body: string;
  /** 앱 내 이동 경로 (예: /fortune/today) */
  link?: string;
  data?: Record<string, string>;
}

export interface PushSendResult {
  /** 발송 성공 건수(토큰 기준) */
  sent: number;
  /** 일시 오류 등으로 실패한 건수 */
  failed: number;
  /** 만료(UNREGISTERED)되어 DB 에서 삭제한 토큰 수 */
  removed: number;
}

export interface PushDigestResult extends PushSendResult {
  /** 메시지를 만든(발송 대상이 된) 사용자 수 */
  users: number;
  /** buildMessage 가 null 을 반환했거나 예외가 난 사용자 수 */
  skipped: number;
}

/** 테스트용 의존성 주입 */
export interface PushDeps {
  fetch?: typeof fetch;
  now?: () => number;
}

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TIMEOUT_MS = 10_000;
const SEND_CONCURRENCY = 20;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/** env 에 한 줄로 넣은 PEM(`\n` 이스케이프·따옴표 포함)을 정상 PEM 으로 */
function normalizePem(raw: string): string {
  let key = raw.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1).trim();
  return key.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
}

type Outcome = keyof PushSendResult;

export function createPushService(config: AppConfig, db: Db, deps: PushDeps = {}) {
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? Date.now;
  const ensure = () => {
    if (!config.features.push) throw notConfigured('푸시 알림(FCM)', FCM_ENV_KEYS);
  };

  // ── OAuth2 액세스 토큰 (메모리 캐시 + 동시 요청 합치기) ──
  let signingKey: Promise<CryptoKey> | undefined;
  let cached: { value: string; expiresAt: number } | undefined;
  let inFlight: Promise<string> | undefined;

  async function issueAccessToken(): Promise<string> {
    signingKey ??= importPKCS8(normalizePem(config.FCM_PRIVATE_KEY!), 'RS256').catch((e: unknown) => {
      signingKey = undefined;
      throw e;
    });
    const iat = Math.floor(now() / 1000);
    const assertion = await new SignJWT({ scope: FCM_SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(config.FCM_CLIENT_EMAIL!)
      .setAudience(OAUTH_TOKEN_URL)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(await signingKey);
    const res = await doFetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown; error?: unknown; error_description?: unknown };
    if (!res.ok || typeof body.access_token !== 'string') {
      throw new Error(`FCM 액세스 토큰 발급 실패 (HTTP ${res.status} ${String(body.error ?? '')} ${String(body.error_description ?? '')})`.trim());
    }
    const ttlSec = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600;
    cached = { value: body.access_token, expiresAt: now() + ttlSec * 1000 };
    return cached.value;
  }

  function getAccessToken(): Promise<string> {
    if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > now()) return Promise.resolve(cached.value);
    inFlight ??= issueAccessToken().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }

  // ── 메시지 구성 ──
  /** webpush.fcm_options.link 는 HTTPS 절대 URL 만 허용 */
  function webLink(link: string): string | undefined {
    try {
      const url = new URL(link, config.PUBLIC_WEB_URL);
      return url.protocol === 'https:' ? url.toString() : undefined;
    } catch {
      return undefined;
    }
  }

  function buildFcmMessage(token: string, m: PushMessage) {
    const data: Record<string, string> = { ...(m.data ?? {}) };
    if (m.link) data.link = m.link;
    const link = m.link ? webLink(m.link) : undefined;
    return {
      message: {
        token,
        notification: { title: m.title, body: m.body },
        ...(Object.keys(data).length > 0 ? { data } : {}),
        android: { priority: 'HIGH', notification: { sound: 'default' } },
        apns: { headers: { 'apns-priority': '10', 'apns-push-type': 'alert' }, payload: { aps: { sound: 'default' } } },
        webpush: { headers: { Urgency: 'high' }, ...(link ? { fcm_options: { link } } : {}) },
      },
    };
  }

  // ── 발송 ──
  const sendUrl = () => `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.FCM_PROJECT_ID!)}/messages:send`;

  function isUnregistered(status: number, body: unknown): boolean {
    if (status === 404) return true;
    const err = (body as { error?: { status?: string; details?: Array<{ errorCode?: string }> } } | null)?.error;
    return err?.status === 'NOT_FOUND' || Boolean(err?.details?.some((d) => d?.errorCode === 'UNREGISTERED'));
  }

  async function sendOne(token: string, message: PushMessage, retried = false): Promise<Outcome> {
    let res: Response;
    try {
      res = await doFetch(sendUrl(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${await getAccessToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildFcmMessage(token, message)),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return 'failed';
    }
    if (res.ok) return 'sent';
    const body: unknown = await res.json().catch(() => null);
    if (isUnregistered(res.status, body)) {
      db.delete(pushTokens).where(eq(pushTokens.token, token)).run();
      return 'removed';
    }
    if (res.status === 401 && !retried) {
      cached = undefined; // 액세스 토큰 만료·폐기 → 재발급 후 1회 재시도
      return sendOne(token, message, true);
    }
    return 'failed';
  }

  async function deliver(jobs: Array<{ token: string; message: PushMessage }>): Promise<PushSendResult> {
    const result: PushSendResult = { sent: 0, failed: 0, removed: 0 };
    if (jobs.length === 0) return result;
    await getAccessToken(); // 키 형식 오류 등 설정 문제는 개별 실패가 아니라 예외로 드러나게
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++]!;
        result[await sendOne(job.token, job.message)]++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, jobs.length) }, worker));
    return result;
  }

  return {
    enabled: config.features.push,
    register(userId: string, token: string, platform: 'web' | 'ios' | 'android') {
      db.insert(pushTokens)
        .values({ id: newId(), userId, token, platform })
        .onConflictDoUpdate({ target: pushTokens.token, set: { userId, platform } })
        .run();
    },
    unregister(token: string) {
      db.delete(pushTokens).where(eq(pushTokens.token, token)).run();
    },
    /** 한 사용자의 모든 기기로 발송. 수신 거부(pushEnabled=false)·탈퇴 사용자는 보내지 않음 */
    async sendToUser(userId: string, message: PushMessage): Promise<PushSendResult> {
      ensure();
      const user = db.select({ pushEnabled: users.pushEnabled, deletedAt: users.deletedAt }).from(users).where(eq(users.id, userId)).get();
      if (!user || user.deletedAt || !user.pushEnabled) return { sent: 0, failed: 0, removed: 0 };
      const tokens = db.select({ token: pushTokens.token }).from(pushTokens).where(eq(pushTokens.userId, userId)).all();
      return deliver(tokens.map(({ token }) => ({ token, message })));
    },
    /**
     * "오늘의 운세" 일괄 발송 — 푸시 수신 동의 사용자 중 토큰이 있는 사용자마다 buildMessage 로 메시지를 만들어 보낸다.
     * buildMessage 가 null 을 반환하거나 예외를 던지면 그 사용자는 건너뛴다(skipped). 스케줄 연결은 호출 측에서.
     */
    async sendDailyFortuneDigest(buildMessage: (userId: string) => PushMessage | null | Promise<PushMessage | null>): Promise<PushDigestResult> {
      ensure();
      const rows = db
        .select({ userId: pushTokens.userId, token: pushTokens.token })
        .from(pushTokens)
        .innerJoin(users, eq(users.id, pushTokens.userId))
        .where(and(eq(users.pushEnabled, true), isNull(users.deletedAt)))
        .all();
      const tokensByUser = new Map<string, string[]>();
      for (const { userId, token } of rows) {
        const list = tokensByUser.get(userId);
        if (list) list.push(token);
        else tokensByUser.set(userId, [token]);
      }
      const jobs: Array<{ token: string; message: PushMessage }> = [];
      let targeted = 0;
      let skipped = 0;
      for (const [userId, tokens] of tokensByUser) {
        let message: PushMessage | null;
        try {
          message = await buildMessage(userId);
        } catch {
          message = null;
        }
        if (!message) {
          skipped++;
          continue;
        }
        targeted++;
        for (const token of tokens) jobs.push({ token, message });
      }
      return { users: targeted, skipped, ...(await deliver(jobs)) };
    },
  };
}

export type PushService = ReturnType<typeof createPushService>;
