/**
 * 토스 미니앱 로그인 — 사용자 식별키 인증 코드 방식(로그인 화면 없음).
 * 식별키(anonKey) 원문은 저장하지 않고 HMAC 값만 users.providerUserId 에 둔다(provider = 'toss').
 * 같은 토스 사용자는 기기를 바꿔도 같은 식별키를 받으므로 같은 계정으로 들어온다.
 */
import { createHmac } from 'node:crypto';
import type { AppConfig } from '../../config/env.js';
import type { User } from '../../db/schema.js';
import { AppError, notConfigured } from '../../lib/errors.js';
import { ERROR_CODES } from '@saju/shared';
import type { UserService } from '../users/service.js';
import { TossApiError, type TossClient } from './client.js';

export const TOSS_PROVIDER = 'toss';
const DEV_SECRET = 'dev-toss-user-key-secret';

export function createTossAuthService(config: AppConfig, client: TossClient, users: UserService) {
  // 운영에서는 개발용 고정 키를 쓰지 않는다 — 키가 없으면 토스 로그인을 켜지 않는다(누구나 아는 키면 계정 식별값을 위조할 수 있다)
  const secret = config.TOSS_USER_KEY_SECRET ?? (config.isProd ? undefined : DEV_SECRET);
  const hashKey = (anonKey: string) => createHmac('sha256', secret!).update(anonKey).digest('hex');

  return {
    enabled: () => client.isConfigured() && Boolean(secret),
    /** 인증 코드 → 사용자(없으면 만든다). guestUserId 가 있으면 그 게스트 계정을 토스 계정으로 바꾼다 */
    async login(code: string, guestUserId?: string): Promise<User> {
      if (!client.isConfigured() || !secret) throw notConfigured('토스 로그인', client.envKeys);
      let anonKey: string;
      try {
        anonKey = await client.exchangeAnonKey(code);
      } catch (e) {
        if (e instanceof TossApiError) {
          console.warn('[toss] 인증 코드 교환 실패', { code: e.code, reason: e.message });
          throw new AppError(401, ERROR_CODES.UNAUTHORIZED, '토스 인증을 확인하지 못했어요. 다시 시도해 주세요.', { reason: 'TOSS_AUTH_FAILED', tossErrorCode: e.code });
        }
        throw e;
      }
      // 게스트를 이어받을 때는 게스트 별명을 그대로 쓴다
      let nickname: string | null = null;
      if (guestUserId) {
        try {
          const guest = await users.get(guestUserId);
          if (guest.provider === 'guest') nickname = guest.nickname;
        } catch {
          /* 게스트가 없으면 새 계정 */
        }
      }
      const { user, created } = await users.upsertSocialUser({ provider: TOSS_PROVIDER, providerUserId: hashKey(anonKey), email: null, nickname, guestUserId });
      if (!created) await users.mergeGuestInto(guestUserId, user.id);
      return user;
    },
  };
}

export type TossAuthService = ReturnType<typeof createTossAuthService>;
