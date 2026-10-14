/**
 * 환경 변수 로딩·검증. 외부 연동 키는 모두 선택값이며, 비어 있으면 해당 기능은
 * "미설정(NOT_CONFIGURED)" 상태로 동작한다(목업/규칙 기반 대체). 키 목록은 docs/ENV_KEYS.md 참고.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');
const opt = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  APP_NAME: z.string().default('달빛사주'),
  /** CORS 허용 오리진(콤마 구분). Capacitor 앱 오리진도 포함 */
  CORS_ORIGINS: z.string().default('http://localhost:5173,capacitor://localhost,http://localhost,https://localhost'),
  /** 결제·소셜로그인 리다이렉트 기준이 되는 웹 주소 */
  PUBLIC_WEB_URL: z.string().default('http://localhost:5173'),
  DATABASE_PATH: z.string().default('./data/saju.db'),
  JWT_ACCESS_SECRET: opt.transform((v) => v ?? 'dev-access-secret-change-me-please-32chars'),
  JWT_REFRESH_SECRET: opt.transform((v) => v ?? 'dev-refresh-secret-change-me-please-32chars'),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().default(60 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().default(120),
  /** 로그인·가입·게스트 생성 등 인증 경로의 분당 제한 */
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().default(10),
  /** 앞단 리버스 프록시 홉 수(nginx 1대면 1). 0 이면 X-Forwarded-For 를 신뢰하지 않음 — IP 위조로 rate limit 우회 방지 */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  ADMIN_API_TOKEN: opt,
  /** 신규 가입 보너스 크레딧 */
  SIGNUP_BONUS_CREDITS: z.coerce.number().int().default(0),

  // AI (Anthropic Claude)
  ANTHROPIC_API_KEY: opt,
  /** 상담(채팅)·리포트 다듬기 — 초안을 다듬는 일이라 가장 싼 모델로 충분 */
  ANTHROPIC_MODEL: z.string().default('claude-haiku-5-5'),
  /** 타로 이야기 — 카드끼리 엮어 읽는 품질 차이가 커서 한 단계 위 모델 */
  ANTHROPIC_MODEL_PREMIUM: z.string().default('claude-sonnet-5-5'),
  AI_CHAT_CREDIT_COST: z.coerce.number().int().default(1),

  // 결제
  PAYMENT_PROVIDER: z.enum(['mock', 'toss', 'portone']).default('mock'),
  TOSS_CLIENT_KEY: opt,
  TOSS_SECRET_KEY: opt,
  TOSS_WEBHOOK_SECRET: opt,
  PORTONE_STORE_ID: opt,
  PORTONE_CHANNEL_KEY: opt,
  PORTONE_API_SECRET: opt,
  PORTONE_WEBHOOK_SECRET: opt,
  APPLE_IAP_ISSUER_ID: opt,
  APPLE_IAP_KEY_ID: opt,
  APPLE_IAP_PRIVATE_KEY: opt,
  APPLE_BUNDLE_ID: opt,
  GOOGLE_PLAY_PACKAGE_NAME: opt,
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: opt,

  // 소셜 로그인
  KAKAO_REST_API_KEY: opt,
  KAKAO_CLIENT_SECRET: opt,
  NAVER_CLIENT_ID: opt,
  NAVER_CLIENT_SECRET: opt,
  GOOGLE_CLIENT_ID: opt,
  GOOGLE_CLIENT_SECRET: opt,
  APPLE_CLIENT_ID: opt,
  APPLE_TEAM_ID: opt,
  APPLE_KEY_ID: opt,
  APPLE_PRIVATE_KEY: opt,

  // 푸시 (FCM HTTP v1)
  FCM_PROJECT_ID: opt,
  FCM_CLIENT_EMAIL: opt,
  FCM_PRIVATE_KEY: opt,
  /** 매일 08:00 KST 오늘의 운세 푸시 발송 (단일 인스턴스에서만 true) */
  DAILY_PUSH_ENABLED: bool,

  // 광고 (서버 주도 노출 제어)
  ADS_ENABLED: bool,
  ADS_PROVIDER: z.enum(['adsense', 'adfit', 'admob', 'none']).default('none'),
  /** 앱 보상형 광고 1회 시청 시 지급할 무상 질문권 */
  REWARDED_AD_CREDITS: z.coerce.number().int().min(0).default(1),
  /** 하루 보상형 광고 지급 한도 (마케팅 정책: 3회) */
  REWARDED_AD_DAILY_LIMIT: z.coerce.number().int().min(0).default(3),
  /** 우리 앱의 AdMob 보상형 광고 단위 ID 허용 목록(콤마 구분, 숫자 부분). 운영에서 비어 있으면 SSV 지급 거부 */
  ADMOB_REWARDED_AD_UNITS: z.string().default(''),
});

export type AppConfig = z.infer<typeof schema> & {
  corsOrigins: string[];
  isProd: boolean;
  isTest: boolean;
  features: {
    ai: boolean;
    toss: boolean;
    portone: boolean;
    appleIap: boolean;
    googleIap: boolean;
    kakao: boolean;
    naver: boolean;
    google: boolean;
    apple: boolean;
    push: boolean;
  };
};

let envFileLoaded = false;
function loadEnvFile() {
  if (envFileLoaded) return;
  envFileLoaded = true;
  const path = resolve(process.cwd(), '.env');
  if (existsSync(path)) process.loadEnvFile(path);
}

export function loadConfig(overrides: Record<string, string | undefined> = {}): AppConfig {
  if (!overrides.__SKIP_ENV_FILE) loadEnvFile();
  const raw = { ...process.env, ...overrides };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`환경 변수 오류:\n${parsed.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  const c = parsed.data;
  const isProd = c.NODE_ENV === 'production';
  if (isProd && [c.JWT_ACCESS_SECRET, c.JWT_REFRESH_SECRET].some((s) => s.startsWith('dev-') || s.length < 32)) {
    throw new Error('운영 환경에서는 JWT_ACCESS_SECRET / JWT_REFRESH_SECRET 을 32자 이상 임의 문자열로 설정해야 합니다.');
  }
  if (isProd && c.PAYMENT_PROVIDER === 'mock') {
    throw new Error('운영 환경에서는 PAYMENT_PROVIDER=mock 을 사용할 수 없습니다.');
  }
  return {
    ...c,
    corsOrigins: c.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    isProd,
    isTest: c.NODE_ENV === 'test',
    features: {
      ai: Boolean(c.ANTHROPIC_API_KEY),
      toss: Boolean(c.TOSS_CLIENT_KEY && c.TOSS_SECRET_KEY),
      portone: Boolean(c.PORTONE_STORE_ID && c.PORTONE_CHANNEL_KEY && c.PORTONE_API_SECRET),
      appleIap: Boolean(c.APPLE_IAP_ISSUER_ID && c.APPLE_IAP_KEY_ID && c.APPLE_IAP_PRIVATE_KEY && c.APPLE_BUNDLE_ID),
      googleIap: Boolean(c.GOOGLE_PLAY_PACKAGE_NAME && c.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON),
      kakao: Boolean(c.KAKAO_REST_API_KEY),
      naver: Boolean(c.NAVER_CLIENT_ID && c.NAVER_CLIENT_SECRET),
      google: Boolean(c.GOOGLE_CLIENT_ID && c.GOOGLE_CLIENT_SECRET),
      apple: Boolean(c.APPLE_CLIENT_ID && c.APPLE_TEAM_ID && c.APPLE_KEY_ID && c.APPLE_PRIVATE_KEY),
      push: Boolean(c.FCM_PROJECT_ID && c.FCM_CLIENT_EMAIL && c.FCM_PRIVATE_KEY),
    },
  };
}
