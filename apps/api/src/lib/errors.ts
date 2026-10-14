import { ERROR_CODES } from '@saju/shared';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, ERROR_CODES.VALIDATION, message, details);
export const unauthorized = (message = '로그인이 필요해요.') => new AppError(401, ERROR_CODES.UNAUTHORIZED, message);
export const forbidden = (message = '권한이 없어요.') => new AppError(403, ERROR_CODES.FORBIDDEN, message);
export const notFound = (message = '대상을 찾을 수 없어요.') => new AppError(404, ERROR_CODES.NOT_FOUND, message);
export const conflict = (message: string, details?: unknown) => new AppError(409, ERROR_CODES.CONFLICT, message, details);
export const paymentRequired = (message: string, details?: unknown) => new AppError(402, ERROR_CODES.PAYMENT_REQUIRED, message, details);
export const insufficientCredits = (need: number, have: number) =>
  new AppError(402, ERROR_CODES.INSUFFICIENT_CREDITS, `크레딧이 부족해요. (필요 ${need} / 보유 ${have})`, { need, have });
/** 외부 API 키가 설정되지 않은 기능 호출 */
export const notConfigured = (feature: string, envKeys: string[]) =>
  new AppError(501, ERROR_CODES.NOT_CONFIGURED, `${feature} 연동이 아직 설정되지 않았어요. 서버 환경변수(${envKeys.join(', ')})를 설정해 주세요.`, { envKeys });
