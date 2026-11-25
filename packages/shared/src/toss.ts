/**
 * 토스 미니앱(앱인토스) 전용 API 계약 — 로그인·인앱 결제·보상형 광고.
 * 계약 문서: toss/daldal-saju/docs/API-CONTRACT.md
 */
import { z } from 'zod';

/** POST /auth/toss — SDK(User.createAnonymousKeyAuthCode)가 준 일회용 코드 */
export const tossAuthSchema = z.object({ code: z.string().trim().min(1).max(2000) });
export type TossAuthDto = z.input<typeof tossAuthSchema>;

/** GET /payments/iap/toss/products — SKU 가 연결된 상품 */
export interface TossIapProductDto {
  productId: string;
  sku: string;
  /** 서버 기록용 토스 판매가(원). 화면 가격은 SDK 의 displayAmount 를 쓴다 */
  amount: number;
}

/** POST /payments/iap/toss/orders — 결제 전 주문 의도 */
export const tossIapIntentSchema = z.object({
  productId: z.string().min(1),
  profileId: z.string().optional(),
  partnerProfileId: z.string().optional(),
  year: z.number().int().optional(),
  readingId: z.string().optional(),
});
export type TossIapIntentCreateDto = z.input<typeof tossIapIntentSchema>;

export interface TossIapIntentDto {
  /** 우리 주문 ID — 검증 때 함께 보낸다 */
  intentId: string;
  productId: string;
  sku: string;
  amount: number;
}

/** POST /payments/iap/verify (platform: 'toss') */
export const tossIapVerifySchema = z.object({
  platform: z.literal('toss'),
  /** 토스 주문 ID (processProductGrant · getPendingOrders 가 준다) */
  orderId: z.string().min(1).max(200),
  intentId: z.string().max(100).optional(),
  /** 개발용 모의 모드에서만 쓰인다 — 운영은 토스 서버가 알려 준 SKU 만 믿는다 */
  sku: z.string().max(200).optional(),
});
export type TossIapVerifyDto = z.input<typeof tossIapVerifySchema>;

/** 광고 보상으로 여는 무료 콘텐츠 */
export const TOSS_REWARD_SLOTS = ['tomorrow_fortune'] as const;
export type TossRewardSlot = (typeof TOSS_REWARD_SLOTS)[number];

/** POST /rewards/toss/start */
export const tossRewardStartSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('credit') }),
  z.object({ kind: z.literal('unlock'), slot: z.enum(TOSS_REWARD_SLOTS) }),
]);
export type TossRewardStartRequestDto = z.input<typeof tossRewardStartSchema>;

export interface TossRewardStartDto {
  token: string;
  expiresAt: string;
  /** 시작 뒤 이만큼 지나야 지급을 요청할 수 있다 */
  minWatchMs: number;
}

/** POST /rewards/toss/claim */
export const tossRewardClaimSchema = z.object({ token: z.string().min(1).max(2000) });

export type TossRewardClaimDto =
  | { granted: true; kind: 'credit'; credits: number }
  | { granted: true; kind: 'unlock'; slot: TossRewardSlot; dateKey: string }
  | { granted: false; reason: 'TOO_EARLY' | 'DUPLICATE' | 'DAILY_LIMIT' };
