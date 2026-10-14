import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SOCIAL_PROVIDERS, guestSchema, loginSchema, oauthCallbackSchema, refreshSchema, signupSchema, updateMeSchema } from '@saju/shared';
import { requireUser } from '../../app.js';
import { unauthorized } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { parse } from '../../lib/validate.js';

const providerParam = z.object({ provider: z.enum(SOCIAL_PROVIDERS) });

export const authRoutes: FastifyPluginAsync = async (app) => {
  const { users, auth, oauth } = app.ctx.services;
  /** 무차별 대입·계정 대량 생성 방지용 엄격 제한 (테스트 환경에서는 rate-limit 미등록) */
  const strict = { config: { rateLimit: { max: app.ctx.config.AUTH_RATE_LIMIT_PER_MIN, timeWindow: '1 minute' } } };
  const ua = (h: unknown) => (typeof h === 'string' ? h : undefined);

  /** 게스트(비회원) 시작 — 앱 첫 실행 시 기기 ID 로 호출 */
  app.post('/guest', strict, async (req) => {
    const body = parse(guestSchema, req.body ?? {});
    const user = users.createGuest(body.deviceId);
    return auth.issue(user, ua(req.headers['user-agent']));
  });

  app.post('/signup', { ...strict, preHandler: app.optionalAuth }, async (req, reply) => {
    const body = parse(signupSchema, req.body);
    const user = users.createEmailUser({
      email: body.email,
      passwordHash: await hashPassword(body.password),
      nickname: body.nickname,
      marketingConsent: body.marketingConsent,
      guestUserId: req.user?.id,
    });
    reply.status(201);
    return auth.issue(user, ua(req.headers['user-agent']));
  });

  app.post('/login', { ...strict, preHandler: app.optionalAuth }, async (req) => {
    const body = parse(loginSchema, req.body);
    const user = users.findByEmail(body.email);
    if (!user?.passwordHash || !(await verifyPassword(body.password, user.passwordHash))) {
      throw unauthorized('이메일 또는 비밀번호가 일치하지 않아요.');
    }
    users.mergeGuestInto(req.user?.id, user.id);
    return auth.issue(user, ua(req.headers['user-agent']));
  });

  app.post('/refresh', strict, async (req) => {
    const body = parse(refreshSchema, req.body);
    return auth.refresh(body.refreshToken, ua(req.headers['user-agent']));
  });

  app.post('/logout', async (req, reply) => {
    const body = parse(refreshSchema, req.body);
    auth.logout(body.refreshToken);
    reply.status(204);
  });

  // ── 소셜 로그인 ───────────────────────────────────────────────
  app.get('/oauth/:provider/authorize', async (req) => {
    const { provider } = parse(providerParam, req.params);
    const q = parse(z.object({ redirectUri: z.string().url(), state: z.string().min(8) }), req.query);
    return { url: oauth.getAuthorizeUrl(provider, q.redirectUri, q.state) };
  });

  app.post('/oauth/:provider/callback', { preHandler: app.optionalAuth }, async (req) => {
    const { provider } = parse(providerParam, req.params);
    const body = parse(oauthCallbackSchema, req.body);
    const redirectUri = body.redirectUri ?? `${app.ctx.config.PUBLIC_WEB_URL}/auth/callback/${provider}`;
    const profile = await oauth.exchangeCode(provider, { code: body.code, redirectUri, state: body.state, idToken: body.idToken, name: body.name });
    const { user, created } = users.upsertSocialUser({ provider, ...profile, guestUserId: req.user?.id });
    if (!created) users.mergeGuestInto(req.user?.id, user.id);
    return auth.issue(user, ua(req.headers['user-agent']));
  });

  /**
   * Apple 웹 로그인은 response_mode=form_post 로 결과를 POST 한다. 정적 웹(SPA)은 POST 를 받을 수 없으므로
   * 여기서 받아 웹 콜백 페이지로 302 리다이렉트한다. (Apple 콘솔 Return URL: {API}/api/v1/auth/oauth/apple/form-post)
   */
  await app.register(async (fp) => {
    fp.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    });
    fp.post('/oauth/apple/form-post', async (req, reply) => {
      const body = parse(z.object({ code: z.string().optional(), state: z.string().optional(), user: z.string().optional(), id_token: z.string().optional(), error: z.string().optional() }), req.body ?? {});
      const target = new URL(`${app.ctx.config.PUBLIC_WEB_URL.replace(/\/$/, '')}/auth/callback/apple`);
      if (body.error) target.searchParams.set('error', body.error);
      if (body.code) target.searchParams.set('code', body.code);
      if (body.state) target.searchParams.set('state', body.state);
      if (body.user) {
        try {
          const u = JSON.parse(body.user) as { name?: { firstName?: string; lastName?: string } };
          const name = [u.name?.lastName, u.name?.firstName].filter(Boolean).join('');
          if (name) target.searchParams.set('name', name);
        } catch {
          /* 이름 파싱 실패는 무시 */
        }
      }
      return reply.redirect(target.toString(), 302);
    });
  });

  // ── 내 정보 ──────────────────────────────────────────────────
  app.get('/me', { preHandler: app.authenticate }, async (req) => users.toDto(users.get(requireUser(req).id)));

  app.patch('/me', { preHandler: app.authenticate }, async (req) => {
    const body = parse(updateMeSchema, req.body);
    return users.toDto(users.update(requireUser(req).id, body));
  });

  /** 회원 탈퇴 (앱스토어 정책상 앱 내 탈퇴 기능 필수) */
  app.delete('/me', { preHandler: app.authenticate }, async (req, reply) => {
    const me = users.get(requireUser(req).id);
    // Apple 로그인 회원은 탈퇴 시 토큰 철회 요청(App Store 심사 요건). 실패해도 탈퇴는 진행
    if (me.providerRefreshToken) await oauth.revoke(me.provider, me.providerRefreshToken);
    users.deleteAccount(me.id);
    reply.status(204);
  });
};
