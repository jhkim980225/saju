/**
 * DB 스키마 (Drizzle ORM / Cloudflare D1 — SQLite).
 * 금액은 원(KRW) 정수, 시각은 epoch ms 정수로 저장한다. JSON 은 text(json 모드).
 */
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`),
};

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email'),
    passwordHash: text('password_hash'),
    nickname: text('nickname').notNull(),
    /** guest | email | kakao | naver | google | apple */
    provider: text('provider').notNull(),
    providerUserId: text('provider_user_id'),
    /** Apple refresh_token (탈퇴 시 철회용) */
    providerRefreshToken: text('provider_refresh_token'),
    deviceId: text('device_id'),
    role: text('role').notNull().default('user'),
    /** 보유 질문권 합계 (= 유상 + 무상) */
    credits: integer('credits').notNull().default(0),
    /** 보유 질문권 중 유상(환불 대상) 수량 */
    paidCredits: integer('paid_credits').notNull().default(0),
    premiumUntil: integer('premium_until'),
    marketingConsent: integer('marketing_consent', { mode: 'boolean' }).notNull().default(false),
    pushEnabled: integer('push_enabled', { mode: 'boolean' }).notNull().default(true),
    deletedAt: integer('deleted_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    uniqueIndex('users_provider_uq').on(t.provider, t.providerUserId),
  ],
);

export const refreshTokens = sqliteTable(
  'refresh_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at').notNull(),
    revokedAt: integer('revoked_at'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash), index('refresh_tokens_user_idx').on(t.userId)],
);

/** 비밀번호 재설정 링크 토큰 — 원문은 메일로만 보내고 DB 에는 sha256 해시만 둔다. 30분 만료, 1회 사용 */
export const passwordResets = sqliteTable(
  'password_resets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex('password_resets_hash_uq').on(t.tokenHash), index('password_resets_user_idx').on(t.userId)],
);

export const profiles = sqliteTable(
  'profiles',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    relation: text('relation').notNull().default('self'),
    gender: text('gender').notNull(),
    calendar: text('calendar').notNull(),
    birthYear: integer('birth_year').notNull(),
    birthMonth: integer('birth_month').notNull(),
    birthDay: integer('birth_day').notNull(),
    isLeapMonth: integer('is_leap_month', { mode: 'boolean' }).notNull().default(false),
    birthHour: integer('birth_hour'),
    birthMinute: integer('birth_minute'),
    timeZone: text('time_zone').notNull().default('Asia/Seoul'),
    longitude: real('longitude').notNull().default(126.978),
    cityName: text('city_name'),
    timeCorrection: text('time_correction').notNull().default('lmt'),
    ziHourRule: text('zi_hour_rule').notNull().default('nextDay'),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (t) => [index('profiles_user_idx').on(t.userId)],
);

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  /** one_time | credit_pack | subscription */
  type: text('type').notNull(),
  price: integer('price').notNull(),
  listPrice: integer('list_price'),
  /** 지급 질문권 수 */
  credits: integer('credits').notNull().default(0),
  /** 지급 권한 템플릿 목록. 예: ["report:lifetime", "report:yearly:2027", "ticket:compatibility"] */
  grants: text('grants', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  /** 구독 주기(일) */
  periodDays: integer('period_days'),
  /** 계정당 구매 가능 횟수 (null = 무제한) */
  perUserLimit: integer('per_user_limit'),
  /** 할인 종료 시각(epoch ms) — 지나면 listPrice 로 판매 */
  saleEndsAt: integer('sale_ends_at'),
  /** 2차 출시 예정 상품 */
  comingSoon: integer('coming_soon', { mode: 'boolean' }).notNull().default(false),
  badge: text('badge'),
  iosProductId: text('ios_product_id'),
  androidProductId: text('android_product_id'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

export const orders = sqliteTable(
  'orders',
  {
    /** 결제사에 전달하는 orderId (영숫자·-_ 6~64자) */
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    productId: text('product_id').notNull().references(() => products.id),
    orderName: text('order_name').notNull(),
    amount: integer('amount').notNull(),
    /** pending | paid | failed | canceled | refunded */
    status: text('status').notNull().default('pending'),
    provider: text('provider').notNull(),
    /** 토스 paymentKey / 포트원 paymentId / IAP transactionId */
    providerPaymentKey: text('provider_payment_key'),
    method: text('method'),
    /** JSON: { profileId, partnerProfileId, year, couponCode } */
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    failureReason: text('failure_reason'),
    paidAt: integer('paid_at'),
    canceledAt: integer('canceled_at'),
    ...timestamps,
  },
  (t) => [index('orders_user_idx').on(t.userId), uniqueIndex('orders_payment_key_uq').on(t.provider, t.providerPaymentKey)],
);

export const creditLedger = sqliteTable(
  'credit_ledger',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(),
    /** purchase | consume | refund | bonus | admin */
    reason: text('reason').notNull(),
    /** paid(유상) | free(무상) */
    source: text('source').notNull().default('free'),
    /** 결제 채널: web | ios | android | system */
    channel: text('channel').notNull().default('system'),
    memo: text('memo'),
    refType: text('ref_type'),
    refId: text('ref_id'),
    balanceAfter: integer('balance_after').notNull(),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index('credit_ledger_user_idx').on(t.userId)],
);

export const entitlements = sqliteTable(
  'entitlements',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** 예: report:lifetime:<profileId>, report:yearly:<profileId>:2027, report:compatibility:<a>:<b> */
    key: text('key').notNull(),
    orderId: text('order_id'),
    expiresAt: integer('expires_at'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex('entitlements_user_key_uq').on(t.userId, t.key)],
);

export const reports = sqliteTable(
  'reports',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    profileId: text('profile_id').notNull(),
    partnerProfileId: text('partner_profile_id'),
    type: text('type').notNull(),
    year: integer('year'),
    title: text('title').notNull(),
    /** ReadingSection[] JSON */
    content: text('content', { mode: 'json' }).$type<unknown>().notNull(),
    /** 'rule' | 'ai' | 'polishing'(규칙 기반 본문을 저장해 두고 AI 가 다듬는 중 — 끝나면 'ai' 또는 'rule') */
    generator: text('generator').notNull(),
    model: text('model'),
    /**
     * AI 다듬기 진행 — 끝낸 덩어리 / 전체. 요청마다 다른 인스턴스가 받으므로 메모리가 아니라 DB 에 둔다.
     * 택일(type='taekil')은 덩어리로 나누지 않으므로 polishDone 을 AI 다듬기 시도 횟수로 쓴다(modules/taekil/service.ts)
     */
    polishDone: integer('polish_done').notNull().default(0),
    polishTotal: integer('polish_total').notNull().default(0),
    /**
     * 다듬기 담당 기한(epoch ms) — 이 시각까지 진행 소식이 없으면 끊긴 것으로 보고 다시 맡는다.
     * 택일은 AI 다듬기를 다시 시도할 수 있는 시각으로 쓴다(맡을 때 미뤄 두고, 실패하면 재시도 간격이 된다)
     */
    polishLeaseUntil: integer('polish_lease_until'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index('reports_user_idx').on(t.userId),
    // 같은 대상(사람·종류·연도·상대)의 리포트는 하나만 — 결제 직후 미리 만들기와 첫 열람이 겹쳐도 두 번 만들지 않는다.
    // 택일 결과는 같은 사람으로 여러 번 볼 수 있어 제외
    uniqueIndex('reports_target_uq')
      .on(t.userId, t.profileId, t.type, sql`coalesce("year", 0)`, sql`coalesce("partner_profile_id", '')`)
      .where(sql`"type" <> 'taekil'`),
    // 택일 — 하루 생성 수 세기·목록(사용자·종류·시각)과, 같은 입력 판정(content.key)을 행 전체를 읽지 않고 찾는다.
    // 같은 입력 판정은 유니크로 두지 않는다 — 이미 쌓인 중복 행(결제된 것일 수 있음)을 지우지 않고 마이그레이션하려고
    index('reports_user_type_created_idx').on(t.userId, t.type, t.createdAt),
    index('reports_taekil_key_idx').on(t.userId, sql`json_extract("content", '$.key')`),
  ],
);

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    profileId: text('profile_id').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [index('chat_messages_profile_idx').on(t.userId, t.profileId)],
);

export const tarotReadings = sqliteTable(
  'tarot_readings',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** 사주 결합 해석에 쓴 프로필 (삭제돼도 리딩은 남는다) */
    profileId: text('profile_id'),
    /** daily | three | feelings5 | reunion5 | yesno | choice | compat | celtic */
    spread: text('spread').notNull(),
    topic: text('topic'),
    question: text('question'),
    /** 같은 날 같은 질문 다시 뽑기 방지 키: spread|topic|정규화한 질문 */
    questionKey: text('question_key').notNull(),
    /** KST 날짜 YYYY-MM-DD */
    dateKey: text('date_key').notNull(),
    /** [{ index, orientation }] — 펼침 순서 */
    cards: text('cards', { mode: 'json' }).$type<{ index: number; orientation: 'upright' | 'reversed' }[]>().notNull(),
    /** 덱 토큰 지문 — 같은 토큰으로 두 번 뽑지 못하게 (오늘의 카드는 null) */
    deckFingerprint: text('deck_fingerprint'),
    /** AI 종합 문단(유료 열람 시 1회 생성 후 저장) */
    aiParagraphs: text('ai_paragraphs', { mode: 'json' }).$type<string[]>(),
    model: text('model'),
    /** AI 종합 문단 시도 횟수 — 실패가 이어져도 정해진 횟수까지만 부른다(modules/tarot/service.ts) */
    aiAttempts: integer('ai_attempts').notNull().default(0),
    /** AI 종합 문단을 다시 시도할 수 있는 시각(epoch ms) — 맡을 때 미뤄 두어 다른 요청이 겹쳐 부르지 않고, 실패하면 재시도 간격이 된다 */
    aiRetryAt: integer('ai_retry_at'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
    /** 궁합 타로 — 함께 본 상대 프로필 (삭제돼도 리딩은 남는다) */
    partnerProfileId: text('partner_profile_id'),
    /** 양자택일 선택지 { a, b } */
    options: text('options', { mode: 'json' }).$type<{ a: string; b: string }>(),
  },
  (t) => [
    index('tarot_readings_user_idx').on(t.userId, t.createdAt),
    uniqueIndex('tarot_readings_question_uq').on(t.userId, t.dateKey, t.questionKey),
    uniqueIndex('tarot_readings_deck_uq').on(t.deckFingerprint),
  ],
);

export const pushTokens = sqliteTable(
  'push_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: text('platform').notNull(),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => [uniqueIndex('push_tokens_token_uq').on(t.token)],
);

export const webhookEvents = sqliteTable('webhook_events', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  eventType: text('event_type').notNull(),
  payload: text('payload', { mode: 'json' }).$type<unknown>().notNull(),
  processedAt: integer('processed_at'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
});

/** 서버가 관리하는 작은 값들 — 예: 상품 카탈로그 지문(catalog_hash, 바뀌었을 때만 다시 넣는다) */
export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/**
 * 이메일 로그인 실패 횟수(계정 단위 무차별 대입 방지, modules/auth/loginThrottle.ts).
 * IP 기준 요청 제한(Cloudflare Rate Limiting)은 느슨하고 IP 를 바꾸면 피할 수 있어서 따로 센다.
 * 이메일 원문 대신 SHA-256 해시를 키로 쓰고, 로그인에 성공하면 지운다.
 */
export const loginFailures = sqliteTable('login_failures', {
  emailHash: text('email_hash').primaryKey(),
  count: integer('count').notNull(),
  /** 이번 집계 창이 시작된 시각(epoch ms) */
  windowStart: integer('window_start').notNull(),
});

/**
 * 원자적 쓰기 묶음의 전제 확인용(db/atomic.ts) — 행은 쌓이지 않는다.
 * 전제가 깨졌으면 NULL 을 넣으려다 NOT NULL 위반으로 묶음 전체가 취소된다.
 */
export const atomicGuards = sqliteTable('atomic_guards', {
  guardFailed: integer('guard_failed').notNull(),
});

export type User = typeof users.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type TarotReading = typeof tarotReadings.$inferSelect;
