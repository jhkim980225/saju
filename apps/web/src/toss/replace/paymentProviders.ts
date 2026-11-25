/**
 * 토스 빌드 — lib/payments/providers.ts(토스페이먼츠·포트원 결제창 SDK)를 대신한다.
 * 미니앱 안에서는 외부 결제창을 쓸 수 없고(앱인토스 정책), 결제는 src/toss/purchases.ts 의 인앱 결제만 쓴다.
 */
export const TOSS_SDK_URL = '';
export const PORTONE_SDK_URL = '';

const unavailable = (): Promise<void> => Promise.reject(new Error('이 결제 수단은 토스 앱에서 쓸 수 없어요.'));

export const openToss = (_c: unknown): Promise<void> => unavailable();
export const openPortOne = (_c: unknown): Promise<void> => unavailable();
