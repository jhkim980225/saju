import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { iapVerifySchema, orderCreateSchema, paymentConfirmSchema } from '@saju/shared';
import { requireUser } from '../../app.js';
import { AppError, forbidden } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';

export const commerceRoutes: FastifyPluginAsync = async (app) => {
  const { commerce } = app.ctx.services;
  const idParam = z.object({ id: z.string() });

  const requireAdmin = (req: FastifyRequest) => {
    const token = req.headers['x-admin-token'];
    const expected = app.ctx.config.ADMIN_API_TOKEN;
    const digest = (v: string) => createHash('sha256').update(v).digest();
    const byToken = Boolean(expected) && typeof token === 'string' && timingSafeEqual(digest(token), digest(expected!));
    if (!byToken && req.user?.role !== 'admin') throw forbidden('관리자만 사용할 수 있어요.');
  };

  /** 상품 목록 — 로그인 시 계정당 구매 제한 반영 */
  app.get('/products', { preHandler: app.optionalAuth }, async (req) => commerce.listProducts(req.user?.id));

  app.get('/wallet', { preHandler: app.authenticate }, async (req) => commerce.wallet(requireUser(req).id));

  // ── 주문 ────────────────────────────────────────────────────
  app.post('/orders', { preHandler: app.authenticate }, async (req, reply) => {
    const body = parse(orderCreateSchema, req.body);
    reply.status(201);
    return commerce.createOrder(requireUser(req).id, body);
  });
  app.get('/orders', { preHandler: app.authenticate }, async (req) => commerce.listOrders(requireUser(req).id));
  app.get('/orders/:id', { preHandler: app.authenticate }, async (req) => {
    const { id } = parse(idParam, req.params);
    return commerce.getOrder(requireUser(req).id, id);
  });

  // ── 결제 ────────────────────────────────────────────────────
  /** 결제창 성공 리다이렉트 후 서버 승인 (금액 검증 포함) */
  app.post('/payments/confirm', { preHandler: app.authenticate }, async (req) => {
    const body = parse(paymentConfirmSchema, req.body);
    return commerce.confirmPayment(requireUser(req).id, body);
  });

  /** 결제창 실패/취소 리다이렉트 */
  app.post('/payments/fail', { preHandler: app.authenticate }, async (req) => {
    const body = parse(z.object({ orderId: z.string(), code: z.string().optional(), message: z.string().optional() }), req.body);
    return commerce.markFailed(requireUser(req).id, body.orderId, `${body.code ?? 'USER_CANCEL'}: ${body.message ?? ''}`);
  });

  /** 앱 인앱결제 영수증 검증 */
  app.post('/payments/iap/verify', { preHandler: app.authenticate }, async (req) => {
    const body = parse(iapVerifySchema, req.body);
    return commerce.verifyIap(requireUser(req).id, body);
  });

  /**
   * 스토어 서버 알림 — App Store Server Notifications V2 / Google Play RTDN(Pub/Sub 푸시).
   * 사용자 토큰이 아니라 알림 자체(Apple 서명 체인 / Pub/Sub OIDC 토큰)로 인증한다. 콘솔 등록 URL: docs/PAYMENTS.md 5장
   */
  const storeNotification = (platform: 'ios' | 'android') => async (req: FastifyRequest) => {
    try {
      const result = await commerce.handleStoreNotification(platform, req.headers, req.body);
      req.log.info({ platform, ...result }, '스토어 알림 처리');
      return { ok: true, ...result };
    } catch (e) {
      // 거부 사유(서명·인증 실패 원인)는 응답에 넣지 않고 서버 로그에만 남긴다
      if (e instanceof AppError && e.statusCode < 500 && e.cause) req.log.warn({ platform, reason: e.cause }, '스토어 알림 거부');
      throw e;
    }
  };
  app.post('/payments/iap/notifications/apple', storeNotification('ios'));
  app.post('/payments/iap/notifications/google', storeNotification('android'));

  /** 결제사 웹훅 — 서명 검증을 위해 원문(raw body)을 그대로 받는다 */
  await app.register(async (wh) => {
    wh.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    wh.post('/payments/webhooks/:provider', async (req) => {
      const { provider } = parse(z.object({ provider: z.enum(['toss', 'portone', 'mock']) }), req.params);
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
      const result = await commerce.handleWebhook(provider, req.headers, raw);
      return { ok: true, ...result };
    });
  });

  // ── 관리자 ──────────────────────────────────────────────────
  const adminLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };
  app.post('/admin/orders/:id/refund', { ...adminLimit, preHandler: app.optionalAuth }, async (req) => {
    requireAdmin(req);
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ reason: z.string().min(1).max(200) }), req.body);
    return commerce.refund(id, body.reason);
  });

  app.post('/admin/users/:id/credits', { ...adminLimit, preHandler: app.optionalAuth }, async (req) => {
    requireAdmin(req);
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ amount: z.number().int().min(1).max(1000), memo: z.string().max(100).default('운영 지급') }), req.body);
    return { credits: commerce.grantFreeCredits(id, body.amount, body.memo) };
  });
};
