/**
 * 토스 미니앱 전용 API — 요청·응답 형식은 docs/API.md 의 토스 미니앱 절(타입은 @saju/shared 의 toss.ts)
 */
import type { PaymentResultDto, TossIapIntentCreateDto, TossIapIntentDto, TossIapProductDto, TossIapVerifyDto, TossRewardClaimDto, TossRewardStartDto, TossRewardStartRequestDto } from '@saju/shared';
import { request } from '@/lib/api';

export const tossApi = {
  /** SKU 가 연결된 상품만 */
  iapProducts: () => request<TossIapProductDto[]>('GET', '/payments/iap/toss/products', { auth: 'optional' }),
  /** 결제 전 주문 의도 등록 — 살 수 없는 경우를 결제 전에 막는다 */
  iapIntent: (body: TossIapIntentCreateDto) => request<TossIapIntentDto>('POST', '/payments/iap/toss/orders', { body, auth: 'required' }),
  /** 결제 검증과 지급 — 200 일 때만 지급된 것 */
  iapVerify: (body: TossIapVerifyDto) => request<PaymentResultDto>('POST', '/payments/iap/verify', { body, auth: 'required' }),
  rewardStart: (body: TossRewardStartRequestDto) => request<TossRewardStartDto>('POST', '/rewards/toss/start', { body, auth: 'required' }),
  rewardClaim: (token: string) => request<TossRewardClaimDto>('POST', '/rewards/toss/claim', { body: { token }, auth: 'required' }),
};
