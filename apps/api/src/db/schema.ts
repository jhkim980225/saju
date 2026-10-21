/**
 * DB 스키마 (Drizzle ORM / PostgreSQL — 운영 Supabase, 개발·테스트 PGlite).
 * 금액은 원(KRW) 정수, 시각은 epoch ms 정수(bigint)로 저장한다. JSON 은 jsonb.
 */
import { sql } from 'drizzle-orm';
import { bigint, boolean, doublePrecision, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

/** epoch ms — int4 범위를 넘으므로 bigint(number 로 읽음) */
const ms = (name: string) => bigint(name, { mode: 'number' });
/** 지금 시각(epoch ms) 기본값 */
const NOW_MS = sql`(extract(epoch from now()) * 1000)::bigint`;

const timestamps = {
  createdAt: ms('created_at').notNull().default(NOW_MS),
  updatedAt: ms('updated_at').notNull().default(NOW_MS),
};

export const users = pgTable(
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
    premiumUntil: ms('premium_until'),
    marketingConsent: boolean('marketing_consent').notNull().default(false),
    pushEnabled: boolean('push_enabled').notNull().default(true),
    deletedAt: ms('deleted_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    uniqueIndex('users_provider_uq').on(t.provider, t.providerUserId),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ms('expires_at').notNull(),
    revokedAt: ms('revoked_at'),
    userAgent: text('user_agent'),
    createdAt: ms('created_at').notNull().default(NOW_MS),
  },
  (t) => [uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash), index('refresh_tokens_user_idx').on(t.userId)],
);

/** 비밀번호 재설정 링크 토큰 — 원문은 메일로만 보내고 DB 에는 sha256 해시만 둔다. 30분 만료, 1회 사용 */
export const passwordResets = pgTable(
  'password_resets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ms('expires_at').notNull(),
    usedAt: ms('used_at'),
    createdAt: ms('created_at').notNull().default(NOW_MS),
  },
  (t) => [uniqueIndex('password_resets_hash_uq').on(t.tokenHash), index('password_resets_user_idx').on(t.userId)],
);

export const profiles = pgTable(
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
    isLeapMonth: boolean('is_leap_month').notNull().default(false),
    birthHour: integer('birth_hour'),
    birthMinute: integer('birth_minute'),
    timeZone: text('time_zone').notNull().default('Asia/Seoul'),
    longitude: doublePrecision('longitude').notNull().default(126.978),
    cityName: text('city_name'),
    timeCorrection: text('time_correction').notNull().default('lmt'),
    ziHourRule: text('zi_hour_rule').notNull().default('nextDay'),
    isPrimary: boolean('is_primary').notNull().default(false),
    ...timestamps,
  },
  (t) => [index('profiles_user_idx').on(t.userId)],
);

export const products = pgTable('products', {
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
  grants: jsonb('grants').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** 구독 주기(일) */
  periodDays: integer('period_days'),
  /** 계정당 구매 가능 횟수 (null = 무제한) */
  perUserLimit: integer('per_user_limit'),
  /** 할인 종료 시각(epoch ms) — 지나면 listPrice 로 판매 */
  saleEndsAt: ms('sale_ends_at'),
  /** 2차 출시 예정 상품 */
  comingSoon: boolean('coming_soon').notNull().default(false),
  badge: text('badge'),
  iosProductId: text('ios_product_id'),
  androidProductId: text('android_product_id'),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

export const orders = pgTable(
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
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    failureReason: text('failure_reason'),
    paidAt: ms('paid_at'),
    canceledAt: ms('canceled_at'),
    ...timestamps,
  },
  (t) => [index('orders_user_idx').on(t.userId), uniqueIndex('orders_payment_key_uq').on(t.provider, t.providerPaymentKey)],
);

export const creditLedger = pgTable(
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
    createdAt: ms('created_at').notNull().default(NOW_MS),
  },
  (t) => [index('credit_ledger_user_idx').on(t.userId)],
);

export const entitlements = pgTable(
  'entitlements',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    /** 예: report:lifetime:<profileId>, report:yearly:<profileId>:2027, report:compatibility:<a>:<b> */
    key: text('key').notNull(),
    orderId: text('order_id'),
    expiresAt: ms('expires_at'),
    createdAt: ms('created_at').notNull().default(NOW_MS),
  },
  (t) => [uniqueIndex('entitlements_user_key_uq').on(t.userId, t.key)],
);

export const reports = pgTable(
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
    content: jsonb('content').$type<unknown>().notNull(),
    /** 'rule' | 'ai' | 'polishing'(규칙 기반 본문을 저장해 두고 AI 가 다듬는 중 — 끝나면 'ai' 또는 'rule') */
    generator: text('generator').notNull(),
    model: text('model'),
    createdAt: ms('created_at').notNull().default(NOW_MS),
  },
  (t) => [
    index('reports_user_idx').on(t.userId),
    // 같은 대상(사람·종류·연도·상대)의 리포트는 하나만 — 결제 직후 미리 만들기와 첫 열람이 겹쳐도 두 번 만들지 않는다.
    // 택일 결과는 같은 사람으로 여러 번 볼 수 있어 제외
    uniqueIndex('reports_target_uq')
      .on(t.userId, t.profileId, t.type, sql`coalesce("year", 0)`, sql`coalesce("partner_profile_id", '')`)
      .where(sql`"type" <> 'taekil'`),
  ],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    profileId: text('profile_id').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    createdAt: ms('created_at').notNull().default(NOW_MS),
  },
  (t) => [index('chat_messages_profile_idx').on(t.userId, t.profileId)],
);

export const tarotReadings = pgTable(
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
    cards: jsonb('cards').$type<{ index: number; orientation: 'upright' | 'reversed' }[]>().notNull(),
    /** 덱 토큰 지문 — 같은 토큰으로 두 번 뽑지 못하게 (오늘의 카드는 null) */
    deckFingerprint: text('deck_fingerprint'),
    /** AI 종합 문단(유료 열람 시 1회 생성 후 저장) */
    aiParagraphs: jsonb('ai_paragraphs').$type<string[]>(),
    model: text('model'),
    createdAt: ms('created_at').notNull().default(NOW_MS),
    /** 궁합 타로 — 함께 본 상대 프로필 (삭제돼도 리딩은 남는다) */
    partnerProfileId: text('partner_profile_id'),
    /** 양자택일 선택지 { a, b } */
    options: jsonb('options').$type<{ a: string; b: string }>(),
  },
  (t) => [
    index('tarot_readings_user_idx').on(t.userId, t.createdAt),
    uniqueIndex('tarot_readings_question_uq').on(t.userId, t.dateKey, t.questionKey),
    uniqueIndex('tarot_readings_deck_uq').on(t.deckFingerprint),
  ],
);

export const pushTokens = pgTable(
  'push_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: text('platform').notNull(),
    createdAt: ms('created_at').notNull().default(NOW_MS),
  },
  (t) => [uniqueIndex('push_tokens_token_uq').on(t.token)],
);

export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').$type<unknown>().notNull(),
  processedAt: ms('processed_at'),
  createdAt: ms('created_at').notNull().default(NOW_MS),
});

export type User = typeof users.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type TarotReading = typeof tarotReadings.$inferSelect;
