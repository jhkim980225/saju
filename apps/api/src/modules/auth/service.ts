import { and, eq, isNull } from 'drizzle-orm';
import type { AuthTokensDto } from '@saju/shared';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { refreshTokens, type User } from '../../db/schema.js';
import { unauthorized } from '../../lib/errors.js';
import { newId, randomToken } from '../../lib/ids.js';
import { hashToken, signAccessToken } from '../../lib/tokens.js';
import type { UserService } from '../users/service.js';

const DAY = 86_400_000;

export function createAuthService(config: AppConfig, db: Db, users: UserService) {
  const issue = async (user: User, userAgent?: string): Promise<AuthTokensDto> => {
    const accessToken = await signAccessToken({ sub: user.id, role: user.role === 'admin' ? 'admin' : 'user', provider: user.provider }, config.JWT_ACCESS_SECRET, config.ACCESS_TOKEN_TTL_SEC);
    const refreshToken = randomToken(48);
    db.insert(refreshTokens)
      .values({ id: newId(), userId: user.id, tokenHash: hashToken(refreshToken), expiresAt: Date.now() + config.REFRESH_TOKEN_TTL_DAYS * DAY, userAgent: userAgent?.slice(0, 200) ?? null })
      .run();
    return { accessToken, refreshToken, expiresIn: config.ACCESS_TOKEN_TTL_SEC, user: users.toDto(user) };
  };

  return {
    issue,
    /** refresh token 회전. 이미 폐기된 토큰이 재사용되면 탈취로 보고 전체 세션을 폐기한다 */
    async refresh(refreshToken: string, userAgent?: string): Promise<AuthTokensDto> {
      const row = db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hashToken(refreshToken))).get();
      if (!row) throw unauthorized('다시 로그인해 주세요.');
      if (row.revokedAt) {
        db.update(refreshTokens).set({ revokedAt: Date.now() }).where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt))).run();
        throw unauthorized('보안을 위해 다시 로그인해 주세요.');
      }
      if (row.expiresAt < Date.now()) throw unauthorized('로그인이 만료되었어요. 다시 로그인해 주세요.');
      if (!users.isActive(row.userId)) throw unauthorized('탈퇴했거나 존재하지 않는 계정이에요.');
      db.update(refreshTokens).set({ revokedAt: Date.now() }).where(eq(refreshTokens.id, row.id)).run();
      return issue(users.get(row.userId), userAgent);
    },
    logout(refreshToken: string) {
      db.update(refreshTokens).set({ revokedAt: Date.now() }).where(eq(refreshTokens.tokenHash, hashToken(refreshToken))).run();
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
