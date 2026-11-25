import { Hono } from 'hono';
import { z } from 'zod';
import { SOCIAL_PROVIDERS, tossAuthSchema, changePasswordSchema, forgotPasswordSchema, guestSchema, loginSchema, oauthCallbackSchema, refreshSchema, resetPasswordSchema, signupSchema, updateMeSchema } from '@saju/shared';
import { unauthorized } from '../../lib/errors.js';
import { noContent, readJson, requireUser, type AppEnv, type RouteKit } from '../../lib/http.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { safeErrorText } from '../../lib/log.js';
import { parse } from '../../lib/validate.js';
import { createLoginThrottle } from './loginThrottle.js';

const providerParam = z.object({ provider: z.enum(SOCIAL_PROVIDERS) });

/** 없는 계정의 로그인에 쓰는 비교용 해시 — 인스턴스마다 한 번 만든다 */
let dummy: Promise<string> | undefined;
const dummyHash = () => (dummy ??= hashPassword('not-a-real-password-for-timing'));

export function authRoutes({ ctx, authenticate, optionalAuth, authLimit: strict }: RouteKit) {
  const { users, auth, oauth } = ctx.services;
  const loginThrottle = createLoginThrottle(ctx.db, Date.now, () => ctx.services.ops.loginLocked());
  const app = new Hono<AppEnv>();

  /** 게스트(비회원) 시작 — 앱 첫 실행 시 기기 ID 로 호출 */
  app.post('/guest', strict, async (c) => {
    const body = parse(guestSchema, (await readJson(c)) ?? {});
    const user = await users.createGuest(body.deviceId);
    return c.json(await auth.issue(user, c.req.header('user-agent')));
  });

  app.post('/signup', strict, optionalAuth, async (c) => {
    const body = parse(signupSchema, await readJson(c));
    const user = await users.createEmailUser({
      email: body.email,
      passwordHash: await hashPassword(body.password),
      nickname: body.nickname,
      marketingConsent: body.marketingConsent,
      guestUserId: c.get('user')?.id,
    });
    return c.json(await auth.issue(user, c.req.header('user-agent')), 201);
  });

  app.post('/login', strict, optionalAuth, async (c) => {
    const body = parse(loginSchema, await readJson(c));
    // 계정(이메일) 단위 실패 횟수 제한 — IP 를 바꿔 가며 한 계정의 비밀번호를 맞히는 공격을 막는다
    await loginThrottle.assertAllowed(body.email);
    const user = await users.findByEmail(body.email);
    // 계정이 없어도 같은 비용의 비교를 한다 — 응답 시간 차이로 가입 여부가 드러나지 않게
    const ok = await verifyPassword(body.password, user?.passwordHash ?? (await dummyHash()));
    if (!user?.passwordHash || !ok) {
      await loginThrottle.recordFailure(body.email);
      throw unauthorized('이메일 또는 비밀번호가 일치하지 않아요.');
    }
    await loginThrottle.clear(body.email);
    await users.mergeGuestInto(c.get('user')?.id, user.id);
    return c.json(await auth.issue(user, c.req.header('user-agent')));
  });

  app.post('/refresh', strict, async (c) => {
    const body = parse(refreshSchema, await readJson(c));
    return c.json(await auth.refresh(body.refreshToken, c.req.header('user-agent')));
  });

  app.post('/logout', async (c) => {
    const body = parse(refreshSchema, await readJson(c));
    await auth.logout(body.refreshToken);
    return noContent(c);
  });

  // ── 비밀번호 재설정(메일 링크) · 변경 ─────────────────────────
  /** 재설정 메일 요청 — 계정 유무와 관계없이 200 (계정 존재 여부 노출 금지). 메일 미설정이면 501 */
  app.post('/password/forgot', strict, async (c) => {
    const body = parse(forgotPasswordSchema, await readJson(c));
    if (!auth.mailEnabled()) await auth.requestPasswordReset(body.email); // 설정 안내(NOT_CONFIGURED)를 그대로 돌려준다
    // 메일 발송은 응답 뒤에 한다 — 계정이 있을 때만 발송 시간이 더해져 응답 시간으로 가입 여부가 드러나지 않게
    const task = auth.requestPasswordReset(body.email).catch((error: unknown) => console.error('[auth] 재설정 메일 처리 실패', safeErrorText(error)));
    try {
      c.executionCtx.waitUntil(task);
    } catch {
      await task; // 테스트·Node 처럼 executionCtx 가 없으면 기다린다
    }
    return c.json({ ok: true });
  });

  /** 메일 링크의 토큰으로 새 비밀번호 설정 — 성공 시 그 사용자의 모든 로그인이 끊긴다 */
  app.post('/password/reset', strict, async (c) => {
    const body = parse(resetPasswordSchema, await readJson(c));
    await auth.resetPassword(body.token, body.password);
    return c.json({ ok: true });
  });

  /** 로그인 상태에서 비밀번호 변경 (이메일 계정만, 현재 비밀번호 확인) */
  app.post('/password/change', strict, authenticate, async (c) => {
    const body = parse(changePasswordSchema, await readJson(c));
    // 다른 기기 세션은 끊기고, 이 기기는 새 토큰으로 이어진다
    const tokens = await auth.changePassword(requireUser(c).id, body.currentPassword, body.newPassword, c.req.header('user-agent'));
    return c.json({ ok: true, ...tokens });
  });

  // ── 소셜 로그인 ───────────────────────────────────────────────
  /**
   * Apple 웹 로그인은 response_mode=form_post 로 결과를 POST 한다. 정적 웹(SPA)은 POST 를 받을 수 없으므로
   * 여기서 받아 웹 콜백 페이지로 302 리다이렉트한다. (Apple 콘솔 Return URL: {API}/api/v1/auth/oauth/apple/form-post)
   * — /oauth/:provider/… 보다 먼저 등록한다
   */
  app.post('/oauth/apple/form-post', async (c) => {
    const form = Object.fromEntries(new URLSearchParams(await c.req.text()));
    const body = parse(z.object({ code: z.string().optional(), state: z.string().optional(), user: z.string().optional(), id_token: z.string().optional(), error: z.string().optional() }), form);
    const target = new URL(`${ctx.config.PUBLIC_WEB_URL.replace(/\/$/, '')}/auth/callback/apple`);
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
    return c.redirect(target.toString(), 302);
  });

  app.get('/oauth/:provider/authorize', async (c) => {
    const { provider } = parse(providerParam, c.req.param());
    const q = parse(z.object({ redirectUri: z.string().url(), state: z.string().min(8) }), c.req.query());
    return c.json({ url: oauth.getAuthorizeUrl(provider, q.redirectUri, q.state) });
  });

  app.post('/oauth/:provider/callback', optionalAuth, async (c) => {
    const { provider } = parse(providerParam, c.req.param());
    const body = parse(oauthCallbackSchema, await readJson(c));
    const redirectUri = body.redirectUri ?? `${ctx.config.PUBLIC_WEB_URL}/auth/callback/${provider}`;
    const profile = await oauth.exchangeCode(provider, { code: body.code, redirectUri, state: body.state, idToken: body.idToken, name: body.name });
    const guestUserId = c.get('user')?.id;
    const { user, created } = await users.upsertSocialUser({ provider, ...profile, guestUserId });
    if (!created) await users.mergeGuestInto(guestUserId, user.id);
    return c.json(await auth.issue(user, c.req.header('user-agent')));
  });

  /** 토스 미니앱 로그인 — SDK 가 준 일회용 코드로 들어온다. 게스트 토큰이 있으면 그 계정을 이어 쓴다 */
  app.post('/toss', strict, optionalAuth, async (c) => {
    const body = parse(tossAuthSchema, await readJson(c));
    const user = await ctx.services.tossAuth.login(body.code, c.get('user')?.id);
    return c.json(await auth.issue(user, c.req.header('user-agent')));
  });

  // ── 내 정보 ──────────────────────────────────────────────────
  app.get('/me', authenticate, async (c) => c.json(users.toDto(await users.get(requireUser(c).id))));

  app.patch('/me', authenticate, async (c) => {
    const body = parse(updateMeSchema, await readJson(c));
    return c.json(users.toDto(await users.update(requireUser(c).id, body)));
  });

  /** 회원 탈퇴 (앱스토어 정책상 앱 내 탈퇴 기능 필수) */
  app.delete('/me', authenticate, async (c) => {
    const me = await users.get(requireUser(c).id);
    // Apple 로그인 회원은 탈퇴 시 토큰 철회 요청(App Store 심사 요건). 실패해도 탈퇴는 진행
    if (me.providerRefreshToken) await oauth.revoke(me.provider, me.providerRefreshToken);
    await users.deleteAccount(me.id);
    return noContent(c);
  });

  return app;
}
