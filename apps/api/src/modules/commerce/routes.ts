import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { iapVerifySchema, orderCreateSchema, paymentConfirmSchema } from '@saju/shared';
import { AppError, forbidden } from '../../lib/errors.js';
import { headersOf, readJson, requireUser, type AppEnv, type Ctx, type RouteKit } from '../../lib/http.js';
import { parse } from '../../lib/validate.js';

export function commerceRoutes({ ctx, authenticate, optionalAuth, adminLimit }: RouteKit) {
  const { commerce } = ctx.services;
  const app = new Hono<AppEnv>();
  const idParam = z.object({ id: z.string() });

  const requireAdmin = (c: Ctx) => {
    const token = c.req.header('x-admin-token');
    const expected = ctx.config.ADMIN_API_TOKEN;
    const digest = (v: string) => createHash('sha256').update(v).digest();
    const byToken = Boolean(expected) && typeof token === 'string' && timingSafeEqual(digest(token), digest(expected!));
    if (!byToken && c.get('user')?.role !== 'admin') throw forbidden('관리자만 사용할 수 있어요.');
  };

  /** 상품 목록 — 로그인 시 계정당 구매 제한 반영 */
  app.get('/products', optionalAuth, async (c) => c.json(await commerce.listProducts(c.get('user')?.id)));

  app.get('/wallet', authenticate, async (c) => c.json(await commerce.wallet(requireUser(c).id)));

  // ── 주문 ────────────────────────────────────────────────────
  app.post('/orders', authenticate, async (c) => {
    const body = parse(orderCreateSchema, await readJson(c));
    return c.json(await commerce.createOrder(requireUser(c).id, body), 201);
  });
  app.get('/orders', authenticate, async (c) => c.json(await commerce.listOrders(requireUser(c).id)));
  app.get('/orders/:id', authenticate, async (c) => {
    const { id } = parse(idParam, c.req.param());
    return c.json(await commerce.getOrder(requireUser(c).id, id));
  });

  // ── 결제 ────────────────────────────────────────────────────
  /** 결제창 성공 리다이렉트 후 서버 승인 (금액 검증 포함) */
  app.post('/payments/confirm', authenticate, async (c) => {
    const body = parse(paymentConfirmSchema, await readJson(c));
    return c.json(await commerce.confirmPayment(requireUser(c).id, body));
  });

  /** 결제창 실패/취소 리다이렉트 */
  app.post('/payments/fail', authenticate, async (c) => {
    const body = parse(z.object({ orderId: z.string(), code: z.string().optional(), message: z.string().optional() }), await readJson(c));
    return c.json(await commerce.markFailed(requireUser(c).id, body.orderId, `${body.code ?? 'USER_CANCEL'}: ${body.message ?? ''}`));
  });

  /** 앱 인앱결제 영수증 검증 */
  app.post('/payments/iap/verify', authenticate, async (c) => {
    const body = parse(iapVerifySchema, await readJson(c));
    return c.json(await commerce.verifyIap(requireUser(c).id, body));
  });

  /**
   * 스토어 서버 알림 — App Store Server Notifications V2 / Google Play RTDN(Pub/Sub 푸시).
   * 사용자 토큰이 아니라 알림 자체(Apple 서명 체인 / Pub/Sub OIDC 토큰)로 인증한다. 콘솔 등록 URL: docs/PAYMENTS.md 5장
   */
  const storeNotification = (platform: 'ios' | 'android') => async (c: Ctx) => {
    try {
      const result = await commerce.handleStoreNotification(platform, headersOf(c), await readJson(c));
      console.info('[commerce] 스토어 알림 처리', { platform, ...result });
      return c.json({ ok: true, ...result });
    } catch (e) {
      // 거부 사유(서명·인증 실패 원인)는 응답에 넣지 않고 서버 로그에만 남긴다
      if (e instanceof AppError && e.statusCode < 500 && e.cause) console.warn('[commerce] 스토어 알림 거부', { platform, reason: e.cause });
      throw e;
    }
  };
  app.post('/payments/iap/notifications/apple', storeNotification('ios'));
  app.post('/payments/iap/notifications/google', storeNotification('android'));

  /**
   * 결제사 웹훅 — 서명 검증을 위해 원문(raw body)을 그대로 받는다.
   * 그로블: 검증 실패는 400(재전송 안 함), 처리 중 오류는 5xx(재전송). 410 은 그로블이 엔드포인트를 꺼 버리므로 쓰지 않는다.
   */
  app.post('/payments/webhooks/:provider', async (c) => {
    const { provider } = parse(z.object({ provider: z.enum(['toss', 'portone', 'groble', 'mock']) }), c.req.param());
    const result = await commerce.handleWebhook(provider, headersOf(c), await c.req.text());
    return c.json({ ok: true, ...result });
  });

  // ── 관리자 ──────────────────────────────────────────────────
  app.post('/admin/orders/:id/refund', adminLimit, optionalAuth, async (c) => {
    requireAdmin(c);
    const { id } = parse(idParam, c.req.param());
    const body = parse(z.object({ reason: z.string().min(1).max(200) }), await readJson(c));
    return c.json(await commerce.refund(id, body.reason));
  });

  app.post('/admin/users/:id/credits', adminLimit, optionalAuth, async (c) => {
    requireAdmin(c);
    const { id } = parse(idParam, c.req.param());
    const body = parse(z.object({ amount: z.number().int().min(1).max(1000), memo: z.string().max(100).default('운영 지급') }), await readJson(c));
    return c.json({ credits: await commerce.grantFreeCredits(id, body.amount, body.memo) });
  });

  return app;
}
