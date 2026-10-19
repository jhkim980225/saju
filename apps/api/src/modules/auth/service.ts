import { and, eq, isNull } from 'drizzle-orm';
import type { AuthTokensDto } from '@saju/shared';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { passwordResets, refreshTokens, users as usersTable, type User } from '../../db/schema.js';
import { badRequest, notConfigured, unauthorized } from '../../lib/errors.js';
import { newId, randomToken } from '../../lib/ids.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { hashToken, signAccessToken } from '../../lib/tokens.js';
import { MAIL_ENV_KEYS, type MailService } from '../mail/service.js';
import type { UserService } from '../users/service.js';

const DAY = 86_400_000;
/** 비밀번호 재설정 링크 유효 시간 */
export const PASSWORD_RESET_TTL_MS = 30 * 60_000;
export const PASSWORD_RESET_INVALID = '링크가 만료됐거나 이미 사용됐습니다. 다시 요청해 주세요.';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 재설정 메일 본문 — 차분한 안내체(docs/PLAIN_KOREAN.md). 텍스트와 HTML 을 같은 내용으로 */
export function buildPasswordResetMail(link: string, appName: string): { subject: string; text: string; html: string } {
  const lines = [
    `안녕하세요, ${appName}입니다.`,
    '',
    '비밀번호 재설정 요청을 받았습니다. 아래 링크를 30분 안에 누르면 새 비밀번호를 정할 수 있습니다.',
    '',
    link,
    '',
    '링크는 한 번만 쓸 수 있고, 30분이 지나면 효력이 없어집니다. 그때는 로그인 화면에서 다시 요청해 주세요.',
    '',
    '본인이 요청하지 않았다면 이 메일은 무시해도 됩니다. 비밀번호는 바뀌지 않습니다.',
  ];
  const p = (s: string) => `<p style="margin:0 0 16px;line-height:1.7">${escapeHtml(s)}</p>`;
  const html = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif;font-size:15px;color:#1f1d1a;max-width:560px;margin:0 auto;padding:24px 16px">',
    p(lines[0]!),
    p(lines[2]!),
    `<p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#1f1d1a;color:#fff;text-decoration:none;font-weight:600">새 비밀번호 정하기</a></p>`,
    `<p style="margin:0 0 16px;font-size:13px;color:#6b665e;word-break:break-all">버튼이 열리지 않으면 이 주소를 복사해 브라우저에 붙여 넣어 주세요.<br>${escapeHtml(link)}</p>`,
    p(lines[6]!),
    p(lines[8]!),
    '</div>',
  ].join('');
  return { subject: `${appName} 비밀번호 재설정`, text: lines.join('\n'), html };
}

export function createAuthService(config: AppConfig, db: Db, users: UserService, mail: MailService) {
  const issue = async (user: User, userAgent?: string): Promise<AuthTokensDto> => {
    const accessToken = await signAccessToken({ sub: user.id, role: user.role === 'admin' ? 'admin' : 'user', provider: user.provider }, config.JWT_ACCESS_SECRET, config.ACCESS_TOKEN_TTL_SEC);
    const refreshToken = randomToken(48);
    db.insert(refreshTokens)
      .values({ id: newId(), userId: user.id, tokenHash: hashToken(refreshToken), expiresAt: Date.now() + config.REFRESH_TOKEN_TTL_DAYS * DAY, userAgent: userAgent?.slice(0, 200) ?? null })
      .run();
    return { accessToken, refreshToken, expiresIn: config.ACCESS_TOKEN_TTL_SEC, user: users.toDto(user) };
  };

  /** 사용자의 모든 refresh 토큰 폐기 — 비밀번호가 바뀌면 다른 기기의 로그인도 끊는다 */
  const revokeAllSessions = (userId: string) => {
    db.update(refreshTokens).set({ revokedAt: Date.now() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt))).run();
  };

  return {
    issue,
    /** refresh token 회전. 이미 폐기된 토큰이 재사용되면 탈취로 보고 전체 세션을 폐기한다 */
    async refresh(refreshToken: string, userAgent?: string): Promise<AuthTokensDto> {
      const row = db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hashToken(refreshToken))).get();
      if (!row) throw unauthorized('다시 로그인해 주세요.');
      if (row.revokedAt) {
        revokeAllSessions(row.userId);
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

    // ── 비밀번호 재설정 · 변경 ─────────────────────────────────
    /**
     * 재설정 메일 요청. 계정 유무를 응답으로 드러내지 않으므로 이메일 계정이 아니면 조용히 끝낸다.
     * 메일 연동이 없으면 501 (웹은 문의 안내로 대체).
     */
    async requestPasswordReset(email: string): Promise<void> {
      if (!mail.enabled) throw notConfigured('비밀번호 재설정 메일(Resend)', MAIL_ENV_KEYS);
      const user = users.findByEmail(email);
      if (!user || user.provider !== 'email' || !user.passwordHash) return;
      const token = randomToken(32);
      db.transaction((tx) => {
        // 같은 사용자의 이전 미사용 토큰은 무효화 — 가장 최근 링크만 유효
        tx.delete(passwordResets).where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt))).run();
        tx.insert(passwordResets).values({ id: newId(), userId: user.id, tokenHash: hashToken(token), expiresAt: Date.now() + PASSWORD_RESET_TTL_MS }).run();
      });
      const link = `${config.PUBLIC_WEB_URL.replace(/\/$/, '')}/password/reset?token=${encodeURIComponent(token)}`;
      await mail.send({ to: user.email!, ...buildPasswordResetMail(link, config.APP_NAME) });
    },
    /** 메일 링크의 토큰으로 비밀번호를 바꾸고, 그 사용자의 모든 세션을 끊는다 */
    async resetPassword(token: string, password: string): Promise<void> {
      const row = db.select().from(passwordResets).where(eq(passwordResets.tokenHash, hashToken(token))).get();
      if (!row || row.usedAt || row.expiresAt < Date.now() || !users.isActive(row.userId)) throw badRequest(PASSWORD_RESET_INVALID);
      const passwordHash = await hashPassword(password);
      db.transaction((tx) => {
        tx.update(passwordResets).set({ usedAt: Date.now() }).where(eq(passwordResets.id, row.id)).run();
        tx.update(usersTable).set({ passwordHash, updatedAt: Date.now() }).where(eq(usersTable.id, row.userId)).run();
      });
      revokeAllSessions(row.userId);
    },
    /** 로그인 상태에서 현재 비밀번호를 확인하고 변경 (이메일 계정만). 현재 세션은 유지한다 */
    async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
      const user = users.get(userId);
      if (user.provider !== 'email' || !user.passwordHash) throw badRequest('이메일로 가입한 계정만 비밀번호를 바꿀 수 있어요.');
      if (!(await verifyPassword(currentPassword, user.passwordHash))) throw badRequest('현재 비밀번호가 일치하지 않아요.');
      db.update(usersTable).set({ passwordHash: await hashPassword(newPassword), updatedAt: Date.now() }).where(eq(usersTable.id, user.id)).run();
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
