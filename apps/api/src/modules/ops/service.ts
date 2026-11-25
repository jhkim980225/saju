/**
 * 운영 알림·집계 — 운영 채널(OPS_ALERT_WEBHOOK_URL)에 보내는 알림을 한곳에서 만든다.
 *
 * 바로 보내는 알림: 회원 가입, 결제 완료, 환불·결제 취소, 환불이 필요한 결제(commerce), 결제 확인 지연,
 * AI 장애(잔액 부족·키 오류·요청 한도·서버 장애), 서버 오류(5분 창으로 묶음), 서명이 틀린 결제 웹훅.
 * 하루 한 번(08:00 KST): 어제의 가입·탈퇴, 매출·환불, 이용량, AI 호출·예상 비용, 보안 지표 요약.
 *
 * 알림에는 이메일·이름·생년월일·질문 내용을 넣지 않는다 — 가입 방식, 상품, 금액, 주문 번호만 적는다.
 * 사용자 응답을 기다리게 하지 않도록 요청 처리 중의 알림은 응답 뒤에 보낸다(lib/alert.ts background).
 */
import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { chatMessages, opsCounters, orders, reports, tarotReadings, users } from '../../db/schema.js';
import { background, createOpsAlert } from '../../lib/alert.js';
import { safeErrorText } from '../../lib/log.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KST_OFFSET = 9 * HOUR;

/** 서버 오류 알림 묶음 창 — 창의 첫 오류는 바로 알리고, 나머지는 창이 끝난 뒤 'N건 더'로 한 번에 알린다 */
export const ERROR_ALERT_WINDOW_MS = 5 * 60_000;
/** AI 장애·웹훅 서명 오류 알림 묶음 창 */
export const INCIDENT_ALERT_WINDOW_MS = 30 * 60_000;
/** 결제 확인 화면에 들어온 뒤 이만큼 지나도 결제 알림이 없으면 운영자에게 알린다 */
export const PAYMENT_DELAY_MS = 30 * 60_000;
/** 하루 집계·묶음 창 행 보관 기간 */
const COUNTER_RETENTION_MS = 40 * DAY;

/** AI 단가(달러 / 100만 토큰: 입력, 출력). 캐시 쓰기는 입력의 1.25배, 캐시 읽기는 0.1배로 어림한다 */
const AI_PRICES: [prefix: string, input: number, output: number][] = [
  ['claude-haiku-5-5', 0.1, 0.5],
  ['claude-sonnet-5-5', 2, 10],
  ['claude-opus-5-5', 4, 20],
];
/** 비용을 원으로 어림할 때 쓰는 환율 */
const USD_KRW = 1450;

const PROVIDER_LABELS: Record<string, string> = {
  guest: '게스트',
  email: '이메일',
  kakao: '카카오',
  naver: '네이버',
  google: '구글',
  apple: '애플',
  toss: '토스',
};
const PAYMENT_LABELS: Record<string, string> = {
  groble: '웹(그로블)',
  toss: '웹(토스페이먼츠)',
  portone: '웹(포트원)',
  mock: '테스트 결제',
  iap_toss: '토스 미니앱',
  iap_apple: 'App Store',
  iap_google: 'Google Play',
};
const AI_KIND_LABELS: Record<string, string> = { report: '리포트 다듬기', chat: 'AI 상담', tarot: '타로 이야기', dream: 'AI 꿈풀이' };

export type AiFailureKind = 'credit' | 'auth' | 'rate' | 'outage';
const AI_FAILURE_TEXT: Record<AiFailureKind, string> = {
  credit: 'Anthropic 잔액(크레딧)이 부족해 AI 응답이 실패하고 있어요. 콘솔에서 충전해 주세요. 그동안 상담·꿈풀이는 실패하고 리포트는 규칙 기반 본문으로 나가요',
  auth: 'ANTHROPIC_API_KEY 가 유효하지 않아 AI 응답이 실패하고 있어요. 키를 확인해 주세요',
  rate: 'Anthropic 요청 한도를 넘어 AI 응답 일부가 실패하고 있어요',
  outage: 'Anthropic 서버 장애·연결 실패로 AI 응답이 실패하고 있어요',
};

export interface AiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export const kstDate = (t: number) => new Date(t + KST_OFFSET).toISOString().slice(0, 10);
/** KST 날짜(YYYY-MM-DD) 하루의 시작 시각(epoch ms) */
const kstDayStart = (date: string) => Date.parse(`${date}T00:00:00Z`) - KST_OFFSET;
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n));
const hhmm = (t: number) => new Date(t + KST_OFFSET).toISOString().slice(11, 16);
export const providerLabel = (p: string) => PROVIDER_LABELS[p] ?? p;
export const paymentLabel = (p: string) => PAYMENT_LABELS[p] ?? p;

/** 주소의 ID 부분(주문 번호·프로필 ID 등)을 :id 로 바꿔 같은 종류의 오류를 같은 글로 묶는다 */
export const routeOf = (path: string) =>
  path
    .split('/')
    .map((seg) => (seg.length >= 12 || /\d{3,}/.test(seg) ? ':id' : seg))
    .join('/');

export function createOpsService(config: Pick<AppConfig, 'OPS_ALERT_WEBHOOK_URL' | 'APP_NAME'>, db: Db, now: () => number = () => Date.now()) {
  const alert = createOpsAlert(config);
  /** DB 를 쓸 수 없을 때(그것 자체가 장애) 묶음 창을 이 인스턴스 메모리로 대신한다 */
  const memoryWindows = new Map<string, number>();

  const dayKey = (name: string, t = now()) => `d:${kstDate(t)}:${name}`;

  /** 하루 횟수 올리기 — 여러 개를 한 묶음으로 */
  const bump = async (entries: Record<string, number>) => {
    const t = now();
    const rows = Object.entries(entries).filter(([, n]) => n > 0);
    if (rows.length === 0) return;
    const stmts = rows.map(([name, n]) =>
      db
        .insert(opsCounters)
        .values({ key: dayKey(name, t), value: n, updatedAt: t })
        .onConflictDoUpdate({ target: opsCounters.key, set: { value: sql`${opsCounters.value} + ${n}`, updatedAt: t } }),
    );
    await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
  };

  /**
   * 묶음 창 알림 — 같은 종류는 창마다 첫 건만 바로 보낸다. 나머지는 세어 두었다가 창이 끝난 뒤 flushWindows 가 'N건 더'로 알린다.
   * 인스턴스가 여러 개여도 DB 의 한 행을 올려서 세므로 창마다 한 번이다
   */
  const once = async (kind: string, windowMs: number, text: string): Promise<boolean> => {
    const t = now();
    const end = (Math.floor(t / windowMs) + 1) * windowMs;
    const key = `b:${kind}:${end}`;
    let first: boolean;
    try {
      const [row] = await db
        .insert(opsCounters)
        .values({ key, value: 1, note: text.slice(0, 300), updatedAt: t })
        .onConflictDoUpdate({ target: opsCounters.key, set: { value: sql`${opsCounters.value} + 1`, updatedAt: t } })
        .returning({ value: opsCounters.value });
      first = row?.value === 1;
    } catch {
      first = (memoryWindows.get(key) ?? 0) === 0;
      memoryWindows.set(key, (memoryWindows.get(key) ?? 0) + 1);
    }
    if (first) await alert(`${text}\n(같은 알림은 ${hhmm(end)}까지 묶어서 보내요)`);
    return first;
  };

/** 어제(KST) 하루 요약 글 */
const dailySummaryText = async (): Promise<string> => {
    const today = kstDate(now());
    const end = kstDayStart(today);
    const start = end - DAY;
    const date = kstDate(start);
    const inDay = (col: Parameters<typeof gte>[0]) => and(gte(col, start), lt(col, end));
    const n = sql<number>`count(*)`.mapWith(Number);

    const [signups, withdrawals, members, paid, refunds, byProduct, tarot, chat, reportRows, counters] = await Promise.all([
      db.select({ provider: users.provider, n }).from(users).where(inDay(users.registeredAt)).groupBy(users.provider),
      db.select({ n }).from(users).where(and(inDay(users.deletedAt), eq(users.nickname, '탈퇴한 사용자'))),
      db.select({ n }).from(users).where(and(isNotNull(users.registeredAt), sql`${users.deletedAt} is null`)),
      db.select({ n, sum: sql<number>`coalesce(sum(${orders.amount}), 0)`.mapWith(Number) }).from(orders).where(inDay(orders.paidAt)),
      db
        .select({ n, sum: sql<number>`coalesce(sum(${orders.amount}), 0)`.mapWith(Number) })
        .from(orders)
        .where(and(inDay(orders.canceledAt), inArray(orders.status, ['refunded', 'canceled']), isNotNull(orders.paidAt))),
      db.select({ name: orders.orderName, n }).from(orders).where(inDay(orders.paidAt)).groupBy(orders.orderName).orderBy(sql`count(*) desc`),
      db.select({ n }).from(tarotReadings).where(inDay(tarotReadings.createdAt)),
      db.select({ n }).from(chatMessages).where(and(inDay(chatMessages.createdAt), eq(chatMessages.role, 'assistant'))),
      db.select({ n }).from(reports).where(inDay(reports.createdAt)),
      db.select().from(opsCounters).where(sql`${opsCounters.key} like ${`d:${date}:%`}`),
    ]);
    const c = new Map(counters.map((r) => [r.key.slice(`d:${date}:`.length), r.value]));
    const get = (k: string) => c.get(k) ?? 0;

    const signupTotal = signups.reduce((s, r) => s + r.n, 0);
    const signupBy = signups
      .sort((a, b) => b.n - a.n)
      .map((r) => `${providerLabel(r.provider)} ${r.n}`)
      .join(' · ');

    // AI 호출·비용 — 모델별 토큰에 단가를 곱한다
    const models = [...new Set([...c.keys()].filter((k) => k.startsWith('ai.model.')).map((k) => k.slice('ai.model.'.length, k.lastIndexOf('.'))))];
    let usd = 0;
    let unpriced = false;
    let calls = 0;
    let inTok = 0;
    let outTok = 0;
    for (const m of models) {
      const [inp, out, cw, cr] = ['in', 'out', 'cw', 'cr'].map((s) => get(`ai.model.${m}.${s}`)) as [number, number, number, number];
      calls += get(`ai.model.${m}.calls`);
      inTok += inp + cw + cr;
      outTok += out;
      const price = AI_PRICES.find(([prefix]) => m.startsWith(prefix));
      if (!price) {
        unpriced = true;
        continue;
      }
      usd += ((inp + cw * 1.25 + cr * 0.1) * price[1] + out * price[2]) / 1_000_000;
    }
    const cost = calls === 0 ? '' : ` · 예상 비용 약 ${won(Math.round(usd * USD_KRW))} ($${usd.toFixed(2)})${unpriced ? ' · 단가를 모르는 모델 제외' : ''}`;

    const lines = [
      `📊 어제(${date}) 요약`,
      `👤 가입 ${signupTotal}명${signupBy ? ` (${signupBy})` : ''} · 탈퇴 ${withdrawals[0]?.n ?? 0}명 · 전체 회원 ${(members[0]?.n ?? 0).toLocaleString('ko-KR')}명`,
      `💰 결제 ${paid[0]?.n ?? 0}건 ${won(paid[0]?.sum ?? 0)} · 환불·취소 ${refunds[0]?.n ?? 0}건 ${won(refunds[0]?.sum ?? 0)}`,
      ...(byProduct.length > 0 ? [`   └ ${byProduct.map((p) => `${p.name} ${p.n}건`).join(', ')}`] : []),
      `🔮 타로 ${tarot[0]?.n ?? 0}회 · AI 꿈풀이 ${get('ai.kind.dream')}회 · 상담 답변 ${chat[0]?.n ?? 0}회 · 리포트 ${reportRows[0]?.n ?? 0}건`,
      `🧾 AI 호출 ${calls}회 · 입력 ${tokens(inTok)} / 출력 ${tokens(outTok)} 토큰${cost}${get('ai.fail') > 0 ? ` · 실패 ${get('ai.fail')}회` : ''}`,
      `🛡️ 로그인 잠금 ${get('auth.locked')}회 · 검증 실패 웹훅 ${get('webhook.rejected')}건 · 서버 오류 ${get('server.error')}건`,
    ];
    return lines.join('\n');
  };

  return {
    /** 바로 보내고 끝날 때까지 기다린다(웹훅·예약 실행처럼 사용자가 기다리지 않는 곳) */
    alert,
    /** 응답 뒤에 보낸다(사용자 요청 처리 중) */
    later(text: string) {
      background(alert(text));
    },
    count(name: string, n = 1) {
      background(bump({ [name]: n }));
    },

    // ── 바로 알림 ───────────────────────────────────────────
    /** 회원 가입(바로 가입·게스트 전환) — 게스트 생성은 알리지 않는다 */
    signup(input: { provider: string; converted: boolean }) {
      background(
        (async () => {
          const [row] = await db
            .select({ n: sql<number>`count(*)`.mapWith(Number) })
            .from(users)
            .where(and(isNotNull(users.registeredAt), sql`${users.deletedAt} is null`));
          const how = `${providerLabel(input.provider)}${input.converted ? ' (게스트에서 전환)' : ''}`;
          await alert(`👤 새 회원이 가입했어요 · ${how} · 전체 회원 ${(row?.n ?? 0).toLocaleString('ko-KR')}명`);
        })(),
      );
    },
    paid(input: { productName: string; amount: number; provider: string; orderId: string; repeat?: boolean }) {
      background(alert(`💳 결제 완료 · ${input.productName} ${won(input.amount)} · ${paymentLabel(input.provider)}${input.repeat ? ' · 같은 결제창으로 한 번 더 결제(새 주문으로 지급)' : ''} · 주문 ${input.orderId}`));
    },
    refunded(input: { productName: string; amount: number; provider: string; orderId: string; status: 'refunded' | 'canceled'; reason: string }) {
      const what = input.status === 'refunded' ? '환불' : '결제 취소';
      background(alert(`↩️ ${what} · ${input.productName} ${won(input.amount)} · ${paymentLabel(input.provider)} · 지급분 회수 완료 · 주문 ${input.orderId} · ${input.reason}`));
    },
    /** 처리하지 못한 서버 오류(500) — 5분 창으로 묶는다 */
    serverError(method: string, path: string, error: unknown) {
      const route = routeOf(path);
      const first = safeErrorText(error).split('\n')[0]!.slice(0, 200);
      background(Promise.all([bump({ 'server.error': 1 }), once(`err:${method}:${route}`, ERROR_ALERT_WINDOW_MS, `🔥 서버 오류 · ${method} ${route} · ${first}`)]));
    },
    /** AI 호출 결과 — 하루 호출 수·토큰을 모델별로 센다(하루 요약의 예상 비용) */
    aiUsage(kind: string, model: string, usage: AiUsage) {
      background(
        bump({
          [`ai.kind.${kind}`]: 1,
          [`ai.model.${model}.calls`]: 1,
          [`ai.model.${model}.in`]: usage.input_tokens,
          [`ai.model.${model}.out`]: usage.output_tokens,
          [`ai.model.${model}.cw`]: usage.cache_creation_input_tokens ?? 0,
          [`ai.model.${model}.cr`]: usage.cache_read_input_tokens ?? 0,
        }),
      );
    },
    aiFailure(kind: AiFailureKind, where: string) {
      background(Promise.all([bump({ 'ai.fail': 1 }), once(`ai:${kind}`, INCIDENT_ALERT_WINDOW_MS, `🤖 AI 장애 · ${AI_FAILURE_TEXT[kind]} (처음 실패: ${AI_KIND_LABELS[where] ?? where})`)]));
    },
    /** 서명·형식 검증에 실패한 결제 웹훅 — 웹훅 비밀값이 바뀌었으면 결제가 확인되지 않으니 바로 알린다 */
    async webhookRejected(providerId: string) {
      await Promise.all([
        bump({ 'webhook.rejected': 1 }),
        once(`webhook:${providerId}`, INCIDENT_ALERT_WINDOW_MS, `🚫 결제 웹훅 검증 실패 · ${paymentLabel(providerId)} · 서명이 틀린 알림을 거절했어요. 웹훅 비밀값(시크릿)이 결제사 설정과 같은지 확인해 주세요. 계속되면 결제가 확인되지 않아요`),
      ]);
    },
    /** 이메일 로그인 잠금 발동(같은 이메일로 여러 번 틀림) */
    loginLocked() {
      background(bump({ 'auth.locked': 1 }));
    },

    // ── 예약 실행 ───────────────────────────────────────────
    /** 끝난 묶음 창 정리 — 창 안에서 같은 알림이 더 있었으면 'N건 더'를 알린다 */
    async flushWindows() {
      const t = now();
      const rows = await db.select().from(opsCounters).where(sql`${opsCounters.key} like 'b:%'`);
      for (const row of rows) {
        const end = Number(row.key.slice(row.key.lastIndexOf(':') + 1));
        if (!Number.isFinite(end) || end > t) continue;
        if (row.value > 1) await alert(`↪︎ 같은 알림 ${row.value - 1}건 더 (${hhmm(end)}까지) · ${row.note ?? row.key}`);
        await db.delete(opsCounters).where(eq(opsCounters.key, row.key));
      }
      for (const [key] of memoryWindows) if (Number(key.slice(key.lastIndexOf(':') + 1)) <= t) memoryWindows.delete(key);
    },

    /**
     * 결제 확인 지연 — 결제 확인 화면에 들어왔는데(결제했다고 보고 기다리는 중) 30분이 지나도 결제 알림이 오지 않은 주문.
     * 웹훅 전달이 끊겼거나 결제창에서 결제하지 않고 돌아온 경우다. 주문마다 한 번만 알린다
     */
    async checkPendingPayments() {
      const t = now();
      const stale = await db
        .select({ id: orders.id, orderName: orders.orderName, amount: orders.amount, provider: orders.provider })
        .from(orders)
        .where(
          and(
            eq(orders.status, 'pending'),
            sql`json_extract(${orders.metadata}, '$.awaitingAt') <= ${t - PAYMENT_DELAY_MS}`,
            sql`json_extract(${orders.metadata}, '$.delayAlerted') is null`,
          ),
        )
        .limit(20);
      if (stale.length === 0) return 0;
      await db
        .update(orders)
        .set({ metadata: sql`json_set(coalesce(${orders.metadata}, '{}'), '$.delayAlerted', ${t})` })
        .where(and(inArray(orders.id, stale.map((o) => o.id)), eq(orders.status, 'pending')));
      const lines = stale.map((o) => `· ${o.orderName} ${won(o.amount)} · ${paymentLabel(o.provider)} · 주문 ${o.id}`);
      await alert(`⏳ 결제 확인 지연 · 결제 확인 화면에 들어왔지만 30분 넘게 결제 알림이 오지 않은 주문 ${stale.length}건이에요. 결제사 판매자 화면에서 결제됐는지 확인해 주세요(결제하지 않고 돌아온 경우일 수도 있어요)\n${lines.join('\n')}`);
      return stale.length;
    },

    dailySummaryText,
    async sendDailySummary() {
      await alert(await dailySummaryText());
    },
    /** 오래된 하루 집계 행 지우기 */
    async cleanup() {
      await db.delete(opsCounters).where(and(sql`${opsCounters.key} like 'd:%'`, lt(opsCounters.updatedAt, now() - COUNTER_RETENTION_MS)));
    },
  };
}

export type OpsService = ReturnType<typeof createOpsService>;
