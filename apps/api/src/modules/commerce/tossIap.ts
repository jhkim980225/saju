/**
 * 토스 미니앱 인앱 결제 — 결제 전 주문 의도 등록 → 토스 서버로 주문 상태 확인 → 지급.
 *
 * 흐름(계약: toss/daldal-saju/docs/API-CONTRACT.md)
 *  1) createIntent: 결제창을 띄우기 전에 pending 주문을 만든다 — 살 수 없는 경우(계정당 1회, 프로필·리딩 누락)를 결제 전에 막는다.
 *  2) verify: SDK 의 processProductGrant / getPendingOrders 가 준 토스 주문 ID 를 토스 서버(mTLS)에 물어
 *     PAYMENT_COMPLETED·PURCHASED 일 때만 지급한다. 토스 주문 ID(providerPaymentKey)로 멱등 — 다른 계정이 쓰면 409.
 *  3) syncRefunds: 일회성 구매에는 환불 알림이 없어 최근 주문의 상태를 다시 물어 REFUNDED 면 회수한다(예약 실행).
 *
 * 토스의 주문 상태 조회는 사용자와 금액을 돌려주지 않는다 — 주문과 사용자의 연결은 우리 로그인(JWT)과 멱등 검사로 보장하고,
 * 금액은 tossCatalog 의 가격표에서 기록한다.
 */
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import type { PaymentResultDto, TossIapIntentCreateDto, TossIapIntentDto, TossIapProductDto } from '@saju/shared';
import { ERROR_CODES } from '@saju/shared';
import type { AppConfig } from '../../config/env.js';
import { atomic } from '../../db/atomic.js';
import { isUniqueViolation, type Db } from '../../db/client.js';
import { orders, products, profiles, users, type Order, type Product } from '../../db/schema.js';
import { AppError, badRequest, conflict, notConfigured, notFound } from '../../lib/errors.js';
import { newOrderId } from '../../lib/ids.js';
import { TossApiError, type TossClient, type TossOrder } from '../toss/client.js';
import { currentPrice, requiresProfile, requiresReading, type CommerceService } from './service.js';
import { parseTossSkus, tossPriceFor } from './tossCatalog.js';

export const TOSS_IAP_PROVIDER = 'iap_toss';
const DAY = 86_400_000;
/** 대상 정보가 없는 복구에서 되짚어 볼 대기 주문의 기간 */
const INTENT_LOOKBACK_MS = 7 * DAY;
const REFUND_SYNC_WINDOW_MS = 30 * DAY;
const REFUND_SYNC_MAX = 200;

export interface TossIapDeps {
  now?: () => number;
}

export function createTossIapService(config: AppConfig, db: Db, commerce: CommerceService, client: TossClient, deps: TossIapDeps = {}) {
  const now = deps.now ?? Date.now;
  const kit = commerce.internals;
  const skuByProduct = parseTossSkus(config.TOSS_IAP_SKUS);
  const productBySku = new Map([...skuByProduct].map(([productId, sku]) => [sku, productId]));
  const envKeys = [...client.envKeys, 'TOSS_IAP_SKUS'];

  const enabled = () => client.isConfigured() && skuByProduct.size > 0;
  const paymentFailed = (message: string, code: string) => new AppError(402, ERROR_CODES.PAYMENT_FAILED, message, { code });

  const requireBuyer = async (userId: string) => {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) throw notFound('사용자를 찾을 수 없어요.');
    if (user.provider === 'guest') throw new AppError(403, ERROR_CODES.FORBIDDEN, '구매 내역을 안전하게 보관하려면 로그인이 필요해요.', { reason: 'LOGIN_REQUIRED' });
    return user;
  };

  const byTossOrderId = async (tossOrderId: string): Promise<Order | undefined> =>
    (await db.select().from(orders).where(and(eq(orders.provider, TOSS_IAP_PROVIDER), eq(orders.providerPaymentKey, tossOrderId))))[0];

  const result = async (userId: string, orderId: string, granted: PaymentResultDto['granted'] = kit.emptyGrant): Promise<PaymentResultDto> => ({
    order: commerce.orderDto(await kit.getOwnedOrder(userId, orderId)),
    granted,
    creditsBalance: await kit.balance(userId),
  });

  /** 아직 토스 주문이 붙지 않은 내 대기 주문 */
  const openIntent = (o: Order | undefined, userId: string, productId: string) =>
    o && o.userId === userId && o.provider === TOSS_IAP_PROVIDER && o.productId === productId && o.providerPaymentKey === null && (o.status === 'pending' || o.status === 'failed') ? o : undefined;

  /** 대상(프로필·리딩)을 모르는 복구 — 대상이 필요 없는 상품이거나 대표 프로필로 정할 수 있을 때만 주문을 만든다 */
  const fallbackIntent = async (userId: string, product: Product): Promise<Order> => {
    const targetRequired = () => conflict('구매한 상품을 받을 대상을 다시 선택해 주세요.', { reason: 'TARGET_REQUIRED' });
    if (requiresReading(product)) throw targetRequired();
    let profileId: string | undefined;
    if (requiresProfile(product)) {
      const mine = await db.select({ id: profiles.id, isPrimary: profiles.isPrimary }).from(profiles).where(eq(profiles.userId, userId));
      profileId = (mine.find((p) => p.isPrimary) ?? (mine.length === 1 ? mine[0] : undefined))?.id;
      if (!profileId) throw targetRequired();
    }
    const id = newOrderId();
    await db.insert(orders).values({
      id,
      userId,
      productId: product.id,
      orderName: product.name,
      amount: tossPriceFor(product.id, currentPrice(product, now())),
      status: 'pending',
      provider: TOSS_IAP_PROVIDER,
      method: 'IAP',
      metadata: { profileId, recovered: true },
    });
    return kit.getOwnedOrder(userId, id);
  };

  return {
    enabled,
    envKeys,
    skuOf: (productId: string) => skuByProduct.get(productId) ?? null,

    /** SKU 가 연결된 상품 — 토스 상점에 보여 줄 것 */
    async listProducts(): Promise<TossIapProductDto[]> {
      if (!enabled()) return [];
      const rows = await db.select().from(products).where(eq(products.active, true));
      return rows
        .filter((p) => !p.comingSoon && skuByProduct.has(p.id))
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((p) => ({ productId: p.id, sku: skuByProduct.get(p.id)!, amount: tossPriceFor(p.id, currentPrice(p, now())) }));
    },

    /** 결제 전 주문 의도 등록 */
    async createIntent(userId: string, dto: TossIapIntentCreateDto): Promise<TossIapIntentDto> {
      await requireBuyer(userId);
      if (!client.isConfigured()) throw notConfigured('토스 인앱 결제', envKeys);
      const product = await kit.getProduct(dto.productId);
      const sku = skuByProduct.get(product.id);
      if (!sku) throw notConfigured(`${product.name} 토스 상품`, ['TOSS_IAP_SKUS']);
      if (product.comingSoon) throw badRequest('곧 출시될 상품이에요.');
      if (product.perUserLimit !== null && (await kit.paidCount(userId, product.id)) >= product.perUserLimit) {
        throw conflict('이미 구매한 상품이에요. (계정당 1회)', { reason: 'PER_USER_LIMIT' });
      }
      if (requiresProfile(product)) {
        if (!dto.profileId) throw badRequest('리포트를 받을 프로필을 선택해 주세요.');
        await kit.assertOwnedProfile(userId, dto.profileId);
      }
      if (dto.partnerProfileId) await kit.assertOwnedProfile(userId, dto.partnerProfileId);
      await kit.assertReading(userId, product, dto.readingId);

      const id = newOrderId();
      const amount = tossPriceFor(product.id, currentPrice(product, now()));
      await db.insert(orders).values({
        id,
        userId,
        productId: product.id,
        orderName: product.name,
        amount,
        status: 'pending',
        provider: TOSS_IAP_PROVIDER,
        method: 'IAP',
        metadata: { profileId: dto.profileId, partnerProfileId: dto.partnerProfileId, year: dto.year, readingId: dto.readingId },
      });
      return { intentId: id, productId: product.id, sku, amount };
    },

    /** 토스 주문 검증 → 지급 (토스 주문 ID 로 멱등) */
    async verify(userId: string, input: { orderId: string; intentId?: string; sku?: string }): Promise<PaymentResultDto> {
      await requireBuyer(userId);
      if (!client.isConfigured()) throw notConfigured('토스 인앱 결제', envKeys);

      const existing = await byTossOrderId(input.orderId);
      if (existing) {
        if (existing.userId !== userId) throw conflict('다른 계정에서 이미 사용된 구매예요.', { reason: 'OTHER_ACCOUNT' });
        if (existing.status === 'paid') return result(userId, existing.id);
        if (existing.status === 'refunded' || existing.status === 'canceled') throw paymentFailed('환불되었거나 취소된 구매예요.', 'REVOKED');
      }

      let status: TossOrder;
      try {
        status = await client.getOrderStatus(input.orderId);
      } catch (e) {
        if (e instanceof TossApiError) {
          console.warn('[toss] 주문 상태 조회 실패', { code: e.code, reason: e.message });
          // 일시적 오류일 수 있다 — 지급하지 않고, 앱은 주문을 미결로 남겨 다음에 다시 시도한다
          throw new AppError(502, ERROR_CODES.PAYMENT_FAILED, '결제를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.', { code: 'VERIFY_UNAVAILABLE' });
        }
        throw e;
      }
      if (status.status === 'REFUNDED') throw paymentFailed('환불되었거나 취소된 구매예요.', 'REVOKED');
      if (status.status === 'ORDER_IN_PROGRESS') throw paymentFailed('결제가 아직 진행 중이에요. 잠시 후 다시 확인할게요.', 'IN_PROGRESS');
      if (status.status !== 'PAYMENT_COMPLETED' && status.status !== 'PURCHASED') throw paymentFailed('결제가 완료되지 않은 주문이에요.', 'NOT_PAID');

      // 운영은 토스 서버가 알려 준 SKU 만 믿는다(모의 모드만 요청의 sku 를 쓴다)
      const sku = status.sku ?? (client.isMock ? input.sku : undefined);
      const productId = sku ? productBySku.get(sku) : undefined;
      if (!productId) throw notFound('토스 상품과 연결된 상품이 없어요.');
      const [product] = await db.select().from(products).where(eq(products.id, productId));
      if (!product) throw notFound('토스 상품과 연결된 상품이 없어요.');

      const mismatch = () => paymentFailed('주문한 상품과 결제한 상품이 달라요.', 'SKU_MISMATCH');
      let order = existing;
      if (order && order.productId !== product.id) throw mismatch();
      if (!order && input.intentId) {
        const [byId] = await db.select().from(orders).where(eq(orders.id, input.intentId));
        if (byId && byId.userId === userId && byId.provider === TOSS_IAP_PROVIDER && byId.productId !== product.id) throw mismatch();
        order = openIntent(byId, userId, product.id);
      }
      if (!order) {
        // 복구 — 앱이 주문 의도 ID 를 잊었으면 이 사용자의 같은 상품 최근 대기 주문에서 대상을 찾는다
        const recent = await db
          .select()
          .from(orders)
          .where(
            and(
              eq(orders.userId, userId),
              eq(orders.provider, TOSS_IAP_PROVIDER),
              eq(orders.productId, product.id),
              eq(orders.status, 'pending'),
              isNull(orders.providerPaymentKey),
              gte(orders.createdAt, now() - INTENT_LOOKBACK_MS),
            ),
          )
          .orderBy(desc(orders.createdAt))
          .limit(1);
        order = openIntent(recent[0], userId, product.id) ?? (await fallbackIntent(userId, product));
      }

      // 토스 주문 ID 를 우리 주문에 붙인다 — (provider, providerPaymentKey) 유니크로 같은 결제가 두 주문에 붙지 않는다
      if (order.providerPaymentKey === null) {
        try {
          await db
            .update(orders)
            .set({ providerPaymentKey: input.orderId, updatedAt: now() })
            .where(and(eq(orders.id, order.id), isNull(orders.providerPaymentKey)));
        } catch (e) {
          if (!isUniqueViolation(e)) throw e;
        }
        const attached = await byTossOrderId(input.orderId);
        if (!attached) throw conflict('결제를 처리하는 중이에요. 잠시 후 다시 시도해 주세요.');
        if (attached.userId !== userId) throw conflict('다른 계정에서 이미 사용된 구매예요.', { reason: 'OTHER_ACCOUNT' });
        order = attached;
      }
      if (order.status === 'paid') return result(userId, order.id);

      const paidAt = status.statusDeterminedAt ? Date.parse(status.statusDeterminedAt) || now() : now();
      const settled = await kit.settle(order, { paymentKey: input.orderId, method: 'IAP', paidAt }, 'toss');
      if (!settled.ok && settled.reason === 'PER_USER_LIMIT') {
        await kit.failIfPending(order.id, 'PER_USER_LIMIT');
        throw conflict('이미 구매한 상품이에요. (계정당 1회) 고객센터로 문의하시면 환불을 도와드려요.', { reason: 'PER_USER_LIMIT' });
      }
      return result(userId, order.id, settled.ok ? settled.granted : kit.emptyGrant);
    },

    /**
     * 환불 확인 — 최근 30일 안에 지급한 토스 주문의 상태를 다시 물어 REFUNDED 면 지급분을 회수한다.
     * 일회성 구매에는 환불 알림(웹훅)이 없어 예약 실행(매일)으로 돈다. 조회 실패는 건너뛰고 다음 실행에서 다시 본다.
     */
    async syncRefunds(): Promise<{ checked: number; revoked: number; failed: number }> {
      if (!client.isConfigured() || client.isMock) return { checked: 0, revoked: 0, failed: 0 };
      const rows = await db
        .select()
        .from(orders)
        .where(and(eq(orders.provider, TOSS_IAP_PROVIDER), eq(orders.status, 'paid'), gte(orders.paidAt, now() - REFUND_SYNC_WINDOW_MS)))
        .orderBy(desc(orders.paidAt))
        .limit(REFUND_SYNC_MAX);
      let revoked = 0;
      let failed = 0;
      for (const order of rows) {
        if (!order.providerPaymentKey) continue;
        try {
          const s = await client.getOrderStatus(order.providerPaymentKey);
          if (s.status !== 'REFUNDED') continue;
          if (await atomic(db, (u) => kit.revokeOrder(u, order, 'refunded', '토스 인앱 결제 환불'))) revoked++;
        } catch (e) {
          failed++;
          console.warn('[toss] 환불 확인 실패', { orderId: order.id, reason: e instanceof Error ? e.message : String(e) });
        }
      }
      return { checked: rows.length, revoked, failed };
    },
  };
}

export type TossIapService = ReturnType<typeof createTossIapService>;
