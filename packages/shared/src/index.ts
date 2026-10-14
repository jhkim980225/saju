/**
 * @saju/shared — 프론트엔드·백엔드·모바일 앱이 공유하는 API 계약.
 * 요청 바디는 zod 스키마로 정의해 서버 검증과 클라이언트 폼 검증에 함께 사용한다.
 */
import { z } from 'zod';
import type {
  CompatibilityResult,
  DaeunInfo,
  FortuneEvaluation,
  FortuneScores,
  MonthLuck,
  SajuChart,
  YearLuck,
} from '@saju/core';

export const API_VERSION = 'v1';

// ---------------------------------------------------------------------------
// 공통
// ---------------------------------------------------------------------------

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const ERROR_CODES = {
  VALIDATION: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL_ERROR',
} as const;

// ---------------------------------------------------------------------------
// 출생 정보
// ---------------------------------------------------------------------------

export const birthInputSchema = z.object({
  calendar: z.enum(['solar', 'lunar']),
  year: z.number().int().min(1900).max(2100),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  isLeapMonth: z.boolean().optional().default(false),
  hour: z.number().int().min(0).max(23).nullable().optional(),
  minute: z.number().int().min(0).max(59).nullable().optional(),
  gender: z.enum(['male', 'female']),
  timeZone: z.string().min(1).max(64).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  timeCorrection: z.enum(['lmt', 'trueSolar', 'clock']).optional(),
  ziHourRule: z.enum(['nextDay', 'midnight']).optional(),
});
export type BirthInputDto = z.input<typeof birthInputSchema>;

export const PROFILE_RELATIONS = ['self', 'partner', 'family', 'friend', 'colleague', 'other'] as const;
export type ProfileRelation = (typeof PROFILE_RELATIONS)[number];

export const profileCreateSchema = z.object({
  name: z.string().trim().min(1, '이름을 입력해 주세요.').max(20, '이름은 20자 이내로 입력해 주세요.'),
  relation: z.enum(PROFILE_RELATIONS).default('self'),
  birth: birthInputSchema,
  cityName: z.string().max(40).optional(),
  isPrimary: z.boolean().optional(),
});
export type ProfileCreateDto = z.input<typeof profileCreateSchema>;
export const profileUpdateSchema = profileCreateSchema.partial();
export type ProfileUpdateDto = z.input<typeof profileUpdateSchema>;

export interface ProfileDto {
  id: string;
  name: string;
  relation: ProfileRelation;
  birth: Required<Pick<BirthInputDto, 'calendar' | 'year' | 'month' | 'day' | 'gender'>> & {
    isLeapMonth: boolean;
    hour: number | null;
    minute: number | null;
    timeZone: string;
    longitude: number;
    timeCorrection: 'lmt' | 'trueSolar' | 'clock';
    ziHourRule: 'nextDay' | 'midnight';
  };
  cityName: string | null;
  isPrimary: boolean;
  /** 일주 한자 (목록 표시용) */
  dayPillar: string;
  zodiac: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 인증
// ---------------------------------------------------------------------------

export const signupSchema = z.object({
  email: z.email('올바른 이메일 주소를 입력해 주세요.').max(120),
  password: z.string().min(8, '비밀번호는 8자 이상이어야 해요.').max(72),
  nickname: z.string().trim().min(1).max(20).optional(),
  marketingConsent: z.boolean().optional(),
  /** 게스트로 쓰던 데이터를 이어받을 때 */
  guestToken: z.string().optional(),
});
export type SignupDto = z.input<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.email('올바른 이메일 주소를 입력해 주세요.'),
  password: z.string().min(1, '비밀번호를 입력해 주세요.'),
});
export type LoginDto = z.input<typeof loginSchema>;

export const guestSchema = z.object({ deviceId: z.string().min(8).max(128).optional() });
export const refreshSchema = z.object({ refreshToken: z.string().min(10) });

export const SOCIAL_PROVIDERS = ['kakao', 'naver', 'google', 'apple'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];
export const oauthCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().optional(),
  redirectUri: z.string().url().optional(),
  /** Apple 은 최초 로그인 시에만 이름을 전달 */
  name: z.string().optional(),
  idToken: z.string().optional(),
});

export interface UserDto {
  id: string;
  email: string | null;
  nickname: string;
  provider: 'guest' | 'email' | SocialProvider;
  role: 'user' | 'admin';
  credits: number;
  marketingConsent: boolean;
  isPremium: boolean;
  premiumUntil: string | null;
  createdAt: string;
}

export interface AuthTokensDto {
  accessToken: string;
  refreshToken: string;
  /** access token 만료(초) */
  expiresIn: number;
  user: UserDto;
}

export const updateMeSchema = z.object({
  nickname: z.string().trim().min(1).max(20).optional(),
  marketingConsent: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// 사주 / 해석
// ---------------------------------------------------------------------------

export type { SajuChart, FortuneEvaluation, FortuneScores, CompatibilityResult, DaeunInfo, YearLuck, MonthLuck };

export const chartRequestSchema = z.object({
  birth: birthInputSchema.optional(),
  profileId: z.string().optional(),
}).refine((v) => v.birth || v.profileId, { message: 'birth 또는 profileId 가 필요합니다.' });
export type ChartRequestDto = z.input<typeof chartRequestSchema>;

/** 해석 섹션 — 무료/유료 공통 포맷 */
export interface ReadingSection {
  key: string;
  title: string;
  /** 한 줄 요약 */
  summary: string;
  /** 본문 문단 */
  paragraphs: string[];
  /** 키워드 칩 */
  keywords?: string[];
  /** 0~100 점수(있으면 게이지 표시) */
  score?: number;
  /** 유료 잠금 여부 — true 면 paragraphs 는 미리보기 1문단만 제공 */
  locked?: boolean;
  /** 잠금 해제에 필요한 상품 */
  unlockProductId?: string;
}

export interface ReadingDto {
  chart: SajuChart;
  headline: string;
  /** 일주 별칭(예: '바위 위의 소나무') */
  dayPillarTitle: string;
  sections: ReadingSection[];
  generator: 'rule' | 'ai';
  disclaimer: string;
}

export interface DailyFortuneDto {
  date: string;
  profileId: string | null;
  dayPillar: { hanja: string; hangul: string };
  evaluation: FortuneEvaluation;
  gradeLabel: string;
  headline: string;
  message: string;
  categories: { key: keyof FortuneScores; label: string; score: number; message: string }[];
  advice: string;
  lucky: { color: string; number: number; direction: string; item: string; time: string };
  /** 오늘의 한마디(공유 카드용) */
  shareText: string;
}

export const yearlyRequestSchema = z.object({
  profileId: z.string(),
  year: z.number().int().min(1900).max(2100),
});

export interface YearlyFortuneDto {
  year: number;
  yearPillar: { hanja: string; hangul: string };
  evaluation: FortuneEvaluation;
  headline: string;
  sections: ReadingSection[];
  months: { order: number; label: string; ganzhi: string; score: number; summary: string; locked: boolean }[];
  locked: boolean;
}

export const compatibilityRequestSchema = z.object({
  profileIdA: z.string().optional(),
  birthA: birthInputSchema.optional(),
  nameA: z.string().max(20).optional(),
  profileIdB: z.string().optional(),
  birthB: birthInputSchema.optional(),
  nameB: z.string().max(20).optional(),
}).refine((v) => (v.profileIdA || v.birthA) && (v.profileIdB || v.birthB), { message: '두 사람의 정보가 모두 필요합니다.' });
export type CompatibilityRequestDto = z.input<typeof compatibilityRequestSchema>;

export interface CompatibilityDto {
  a: { name: string; dayPillar: string; zodiac: string; chart: SajuChart };
  b: { name: string; dayPillar: string; zodiac: string; chart: SajuChart };
  result: CompatibilityResult;
  gradeLabel: string;
  headline: string;
  sections: ReadingSection[];
  locked: boolean;
}

export interface ManseDto {
  date: string;
  lunar: { year: number; month: number; day: number; isLeapMonth: boolean } | null;
  yearPillar: string;
  monthPillar: string;
  dayPillar: string;
  solarTerms: { name: string; at: string }[];
}

// ---------------------------------------------------------------------------
// 리포트 (유료)
// ---------------------------------------------------------------------------

export const REPORT_TYPES = ['lifetime', 'yearly', 'compatibility', 'love', 'wealth', 'career'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const reportCreateSchema = z.object({
  type: z.enum(REPORT_TYPES),
  profileId: z.string(),
  partnerProfileId: z.string().optional(),
  year: z.number().int().min(1900).max(2100).optional(),
});
export type ReportCreateDto = z.input<typeof reportCreateSchema>;

export interface ReportDto {
  id: string;
  type: ReportType;
  title: string;
  profileId: string;
  partnerProfileId: string | null;
  year: number | null;
  sections: ReadingSection[];
  generator: 'rule' | 'ai';
  createdAt: string;
}

export interface ReportSummaryDto {
  id: string;
  type: ReportType;
  title: string;
  profileName: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// AI 상담
// ---------------------------------------------------------------------------

export const chatSendSchema = z.object({
  profileId: z.string(),
  message: z.string().trim().min(1).max(500),
});
export interface ChatMessageDto {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}
export interface ChatReplyDto {
  reply: ChatMessageDto;
  creditsLeft: number;
  generator: 'rule' | 'ai';
}

// ---------------------------------------------------------------------------
// 커머스 — 상품 / 주문 / 결제 / 크레딧
// ---------------------------------------------------------------------------

export const PRODUCT_TYPES = ['one_time', 'credit_pack', 'subscription'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export interface ProductDto {
  id: string;
  name: string;
  description: string;
  type: ProductType;
  /** 현재 판매가(원) — 할인 기간이 끝나면 정가 */
  price: number;
  /** 정가(할인 표시용) */
  listPrice: number | null;
  /** 지급 질문권(AI 상담) 수 */
  credits: number;
  /** 지급 권한 템플릿 (report:lifetime, report:yearly:2027, ticket:compatibility …) */
  grants: string[];
  /** 대상 프로필이 필요한 상품인가 (리포트류) */
  requiresProfile: boolean;
  /** 궁합처럼 상대 프로필이 필요한가 */
  requiresPartner: boolean;
  /** 타로 상세 리딩처럼 특정 리딩에 적용되는가 */
  requiresReading: boolean;
  periodDays: number | null;
  perUserLimit: number | null;
  /** 이 사용자가 더 구매할 수 있는가 */
  purchasable: boolean;
  saleEndsAt: string | null;
  badge: string | null;
  comingSoon: boolean;
  iosProductId: string | null;
  androidProductId: string | null;
}

export const PAYMENT_PROVIDERS = ['mock', 'toss', 'portone', 'iap_apple', 'iap_google'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const orderCreateSchema = z.object({
  productId: z.string(),
  /** 단건 상품이 적용될 프로필(리포트 대상) */
  profileId: z.string().optional(),
  partnerProfileId: z.string().optional(),
  year: z.number().int().optional(),
  /** 타로 상세 리딩 대상 리딩 ID */
  readingId: z.string().optional(),
  couponCode: z.string().max(40).optional(),
});
export type OrderCreateDto = z.input<typeof orderCreateSchema>;

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'canceled' | 'refunded';

export interface OrderDto {
  id: string;
  productId: string;
  orderName: string;
  amount: number;
  status: OrderStatus;
  provider: PaymentProvider;
  createdAt: string;
  paidAt: string | null;
}

/** 주문 생성 결과 — 클라이언트는 provider 에 맞는 결제창을 띄운다 */
export interface CheckoutDto {
  order: OrderDto;
  provider: PaymentProvider;
  /** 결제창 호출 파라미터 (provider 별) */
  checkout: {
    clientKey?: string;
    customerKey: string;
    orderId: string;
    orderName: string;
    amount: number;
    successUrl: string;
    failUrl: string;
    customerEmail?: string;
    customerName?: string;
    /** PortOne */
    storeId?: string;
    channelKey?: string;
  };
}

export const paymentConfirmSchema = z.object({
  provider: z.enum(PAYMENT_PROVIDERS),
  orderId: z.string(),
  amount: z.number().int().nonnegative(),
  /** 토스: paymentKey / 포트원: paymentId */
  paymentKey: z.string().optional(),
});
export type PaymentConfirmDto = z.input<typeof paymentConfirmSchema>;

export const iapVerifySchema = z.object({
  platform: z.enum(['ios', 'android']),
  productId: z.string(),
  /** iOS: transactionId / signedTransaction, Android: purchaseToken */
  receipt: z.string().min(1),
  profileId: z.string().optional(),
  readingId: z.string().optional(),
});

export interface PaymentResultDto {
  order: OrderDto;
  /** 결제 후 지급된 것 */
  granted: { credits: number; entitlements: string[]; premiumUntil: string | null };
  creditsBalance: number;
}

export interface WalletDto {
  credits: number;
  paidCredits: number;
  freeCredits: number;
  ledger: { id: string; delta: number; reason: string; source: 'paid' | 'free'; memo: string | null; balanceAfter: number; createdAt: string }[];
  entitlements: { key: string; expiresAt: string | null; createdAt: string }[];
}

// ---------------------------------------------------------------------------
// 타로
// ---------------------------------------------------------------------------

/** 주제 — 홈 타일 순서. spread 는 이 주제로 뽑을 때 쓰는 펼침 방식 */
export const TAROT_TOPICS = {
  love: { label: '연애', title: '우리 관계, 지금 어디쯤일까요?', spread: 'three' },
  feelings: { label: '속마음', title: '그 사람은 어떤 마음일까요?', spread: 'feelings5' },
  reunion: { label: '재회', title: '지난 관계, 다시 생각나요', spread: 'reunion5' },
  career: { label: '일·진로', title: '이 길로 가도 괜찮을까요?', spread: 'three' },
  money: { label: '돈', title: '돈의 흐름, 어떻게 챙길까요?', spread: 'three' },
  relation: { label: '관계', title: '사람 사이, 어떻게 풀어 볼까요?', spread: 'three' },
  self: { label: '나', title: '요즘 내 마음은 어디에 있을까요?', spread: 'three' },
} as const;
export type TarotTopic = keyof typeof TAROT_TOPICS;
export const TAROT_TOPIC_KEYS = Object.keys(TAROT_TOPICS) as TarotTopic[];

export interface TarotPositionDef {
  key: string;
  label: string;
  hint: string;
}

/** 펼침 방식 — freeCards: 무료로 자리별 풀이까지 보여 주는 앞쪽 카드 수 */
export const TAROT_SPREADS = {
  daily: {
    name: '오늘의 카드',
    cards: 1,
    freeCards: 1,
    productId: null,
    positions: [{ key: 'today', label: '오늘의 메시지', hint: '오늘 마음에 두면 좋은 한 가지' }],
  },
  three: {
    name: '질문 리딩 3장',
    cards: 3,
    freeCards: 0,
    productId: 'tarot_question_3',
    positions: [
      { key: 'situation', label: '지금 상황', hint: '지금 가장 크게 작용하는 것' },
      { key: 'flow', label: '흐름', hint: '이대로 갈 때 이어지기 쉬운 방향' },
      { key: 'advice', label: '조언', hint: '지금 해 볼 수 있는 한 가지' },
    ],
  },
  feelings5: {
    name: '연애 속마음 5장',
    cards: 5,
    freeCards: 1,
    productId: 'tarot_love_5',
    positions: [
      { key: 'me', label: '나의 마음', hint: '이 관계에서 내가 느끼는 것' },
      { key: 'outer', label: '겉으로 보이는 마음', hint: '말과 행동으로 드러나는 것' },
      { key: 'inner', label: '안에 있는 마음', hint: '쉽게 드러내지 않는 생각' },
      { key: 'between', label: '둘 사이의 흐름', hint: '두 사람 사이에 흐르는 기운' },
      { key: 'help', label: '도움이 되는 것', hint: '관계를 위해 해 볼 수 있는 일' },
    ],
  },
  reunion5: {
    name: '재회 5장',
    cards: 5,
    freeCards: 1,
    productId: 'tarot_love_5',
    positions: [
      { key: 'why', label: '멀어진 이유', hint: '관계가 어긋난 흐름' },
      { key: 'me', label: '지금 나의 마음', hint: '아직 남아 있는 감정' },
      { key: 'them', label: '상대 쪽 흐름', hint: '상대에게서 보이는 신호' },
      { key: 'ahead', label: '앞으로의 흐름', hint: '지금 그대로 갈 때 이어지기 쉬운 방향' },
      { key: 'need', label: '나에게 필요한 것', hint: '다시 다가가든 놓아주든, 먼저 챙길 것' },
    ],
  },
} as const satisfies Record<string, { name: string; cards: number; freeCards: number; productId: string | null; positions: readonly TarotPositionDef[] }>;
export type TarotSpread = keyof typeof TAROT_SPREADS;
/** 사용자가 직접 뽑는 펼침 방식 (오늘의 카드 제외) */
export const TAROT_DRAW_SPREADS = ['three', 'feelings5', 'reunion5'] as const;
export type TarotDrawSpread = (typeof TAROT_DRAW_SPREADS)[number];
export const TAROT_DECK_SIZE = 78;
export const TAROT_QUESTION_MAX = 80;

const tarotQuestion = z.string().trim().max(TAROT_QUESTION_MAX).optional();

export const tarotShuffleSchema = z.object({
  spread: z.enum(TAROT_DRAW_SPREADS),
  topic: z.enum(TAROT_TOPIC_KEYS as [TarotTopic, ...TarotTopic[]]),
  question: tarotQuestion,
});
export type TarotShuffleDto = z.input<typeof tarotShuffleSchema>;

export const tarotDrawSchema = tarotShuffleSchema.extend({
  deckToken: z.string().min(10).max(200),
  /** 뒤집힌 78장 중 고른 자리(0~77), 펼침 순서대로 */
  picks: z.array(z.number().int().min(0).max(TAROT_DECK_SIZE - 1)).min(1).max(10),
  /** 사주 결합 해석에 쓸 프로필 */
  profileId: z.string().optional(),
});
export type TarotDrawDto = z.input<typeof tarotDrawSchema>;

export interface TarotShuffleResultDto {
  deckToken: string;
  deckSize: number;
  expiresAt: string;
  /** 오늘 같은 질문으로 이미 뽑은 리딩 — 있으면 다시 뽑지 않고 그 결과로 안내 */
  existingReadingId: string | null;
}

export interface TarotCardDto {
  id: string;
  /** 덱 인덱스 0~77 */
  index: number;
  nameKo: string;
  nameEn: string;
  arcana: 'major' | 'minor';
  suit: 'wands' | 'cups' | 'swords' | 'pentacles' | null;
  number: number;
  orientation: 'upright' | 'reversed';
  /** 카드 그림 경로 (웹 public 기준) */
  image: string;
  /** 그림 설명 — 대체 텍스트 */
  imagery: string;
  keywords: string[];
  /** 전통적인 카드 뜻 한 줄 */
  meaning: string;
  /** 달빛사주 방식의 오행 연결 */
  element: 'wood' | 'fire' | 'earth' | 'metal' | 'water';
  yesNo: 'yes' | 'no' | 'maybe';
}

export interface TarotPlacedCardDto extends TarotCardDto {
  position: TarotPositionDef;
  /** 이 자리·질문에 맞춘 한 줄 */
  line: string;
}

export interface TarotReadingDto {
  id: string;
  spread: TarotSpread;
  spreadName: string;
  topic: TarotTopic | null;
  question: string | null;
  /** 리딩 날짜(KST, YYYY-MM-DD) */
  date: string;
  createdAt: string;
  cards: TarotPlacedCardDto[];
  /** 카드가 건네는 한 줄 */
  headline: string;
  /** 무료·유료 공통 섹션 — 잠긴 섹션은 첫 문단만 */
  sections: ReadingSection[];
  locked: boolean;
  productId: string | null;
  /** 사주 결합에 쓴 프로필 이름 */
  profileName: string | null;
  /** 해석 근거 한 줄 (일간·용신·카드 원소) */
  basis: string | null;
  generator: 'rule' | 'ai';
  disclaimer: string;
}

export interface TarotHistoryItemDto {
  id: string;
  spread: TarotSpread;
  spreadName: string;
  topic: TarotTopic | null;
  question: string | null;
  date: string;
  cards: { id: string; nameKo: string; orientation: 'upright' | 'reversed'; image: string }[];
  locked: boolean;
}

// ---------------------------------------------------------------------------
// 공개 설정(서버 주도 UI) / 광고 / 푸시
// ---------------------------------------------------------------------------

export interface PublicConfigDto {
  appName: string;
  paymentProvider: PaymentProvider;
  tossClientKey: string | null;
  portone: { storeId: string | null; channelKey: string | null };
  socialLogin: Record<SocialProvider, boolean>;
  ai: { enabled: boolean };
  ads: { enabled: boolean; provider: 'adsense' | 'adfit' | 'admob' | 'none' };
  features: Record<string, boolean>;
  notices: { id: string; title: string; body: string }[];
}

export const pushRegisterSchema = z.object({
  token: z.string().min(10),
  platform: z.enum(['web', 'ios', 'android']),
});

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

export const ELEMENT_LABEL = { wood: '목', fire: '화', earth: '토', metal: '금', water: '수' } as const;
export const FORTUNE_CATEGORY_LABEL = { total: '총운', wealth: '재물운', love: '애정운', career: '직장·사업운', health: '건강운', study: '학업운' } as const;
export const RELATION_LABEL: Record<ProfileRelation, string> = { self: '나', partner: '연인·배우자', family: '가족', friend: '친구', colleague: '동료', other: '기타' };

// ---------------------------------------------------------------------------
// 토정비결 (무료 · 신년 시즌 콘텐츠)
// ---------------------------------------------------------------------------

/** 토정비결 기본 대상 연도 — 2027 丁未년 */
export const TOJEONG_DEFAULT_YEAR = 2027;

/** 토정비결은 음력 생년월일만 쓴다 — 저장된 출생 정보(BirthInputDto)를 그대로 넣어도 된다(시각·성별은 무시) */
export const tojeongBirthSchema = z.object({
  calendar: z.enum(['solar', 'lunar']),
  year: z.number().int().min(1900).max(2050),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  isLeapMonth: z.boolean().optional().default(false),
});
export type TojeongBirthDto = z.input<typeof tojeongBirthSchema>;

export const tojeongRequestSchema = z
  .object({
    birth: tojeongBirthSchema.optional(),
    profileId: z.string().optional(),
    /** 신수를 보는 해 (기본 TOJEONG_DEFAULT_YEAR) */
    year: z.number().int().min(1900).max(2049).optional(),
  })
  .refine((v) => v.birth || v.profileId, { message: 'birth 또는 profileId 가 필요합니다.' });
export type TojeongRequestDto = z.input<typeof tojeongRequestSchema>;

/** 그달의 기운 — rise 힘이 붙는 달, even 고른 달, care 살피는 달 */
export type TojeongMonthFlow = 'rise' | 'even' | 'care';

export interface TojeongDto {
  year: number;
  yearPillar: { hanja: string; hangul: string };
  profileId: string | null;
  gwae: {
    /** 괘 번호 111 ~ 863 */
    code: number;
    upper: number;
    middle: number;
    lower: number;
    /** 괘사 한문 원문 */
    verse: string;
    /** 괘사 한글 독음 */
    reading: string;
    title: string;
    summary: string;
    keywords: string[];
  };
  /** 총평 문단 */
  overview: string[];
  /** 음력 1~12월 */
  months: {
    month: number;
    /** '음력 1월' */
    label: string;
    /** 양력 기간 '2.7 ~ 3.7' (그달 뒤에 윤달이 있으면 윤달 끝까지) */
    period: string;
    flow: TojeongMonthFlow;
    flowLabel: string;
    text: string;
  }[];
  /** 작괘 근거 — 화면의 '괘를 뽑은 방법' */
  basis: {
    lunarBirth: { year: number; month: number; day: number; isLeapMonth: boolean };
    /** 그해 세는나이 */
    age: number;
    /** 상괘: 세는나이 + 태세수 */
    upper: { ganzhi: string; value: number; sum: number };
    /** 중괘: 그해 생월 날수 + 월건수 */
    middle: { ganzhi: string; value: number; monthDays: number; sum: number };
    /** 하괘: 생일수 + 그해 생일 일진수 */
    lower: { ganzhi: string; value: number; birthDay: number; solarDate: string; sum: number };
    notes: string[];
  };
  /** 공유 문구(생년월일 없이) */
  shareText: string;
  disclaimer: string;
}
