/**
 * 커머스 코어 — 상품 / 주문 / 결제 승인 / 지급(fulfillment) / 질문권 원장 / 권한(entitlement).
 * 결제사 연동은 providers/* 게이트웨이가 담당하고, 여기서는 금액 검증과 지급의 원자성을 보장한다.
 */
import { and, asc, desc, eq, inArray, like, sql } from 'drizzle-orm';
import type { CheckoutDto, OrderCreateDto, OrderDto, PaymentProvider, PaymentResultDto, ProductDto, WalletDto } from '@saju/shared';
import { ERROR_CODES } from '@saju/shared';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { creditLedger, entitlements, orders, products, profiles, users, webhookEvents, type Order, type Product } from '../../db/schema.js';
import { AppError, badRequest, conflict, forbidden, insufficientCredits, notConfigured, notFound } from '../../lib/errors.js';
import { newId, newOrderId } from '../../lib/ids.js';
import { CATALOG } from './catalog.js';
import type { Gateways } from './providers/index.js';
import { GatewayError } from './providers/types.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Channel = 'web' | 'ios' | 'android' | 'system';

/** 결제 지급 완료 — 지급된 권한 키와 주문의 대상 프로필 */
export interface FulfilledEvent {
  userId: string;
  entitlements: string[];
  profileId?: string;
  partnerProfileId?: string;
}

const DAY = 86_400_000;

/** 카탈로그 → DB upsert */
export function seedCatalog(db: Db) {
  CATALOG.forEach((c, i) => {
    const values = {
      name: c.name,
      description: c.description,
      type: c.type,
      price: c.price,
      listPrice: c.listPrice ?? null,
      credits: c.credits ?? 0,
      grants: c.grants ?? [],
      periodDays: c.periodDays ?? null,
      perUserLimit: c.perUserLimit ?? null,
      saleEndsAt: c.saleEndsAt ? Date.parse(c.saleEndsAt) : null,
      badge: c.badge ?? null,
      comingSoon: c.comingSoon ?? false,
      iosProductId: c.iosProductId ?? null,
      androidProductId: c.androidProductId ?? null,
      active: true,
      sortOrder: i,
      updatedAt: Date.now(),
    };
    db.insert(products).values({ id: c.id, ...values }).onConflictDoUpdate({ target: products.id, set: values }).run();
  });
}

export const requiresProfile = (p: Pick<Product, 'grants'>) => p.grants.some((g) => g.startsWith('report:'));
export const requiresPartner = (p: Pick<Product, 'grants'>) => p.grants.includes('report:compatibility');
/** 타로 상세 리딩처럼 특정 리딩 하나를 여는 상품 */
export const requiresReading = (p: Pick<Product, 'grants'>) => p.grants.includes('tarot:reading') || p.grants.includes('taekil:reading');

/** 현재 판매가 — 할인 기간이 끝나면 정가 */
export function currentPrice(p: Product, now = Date.now()): number {
  if (p.saleEndsAt && now > p.saleEndsAt && p.listPrice) return p.listPrice;
  return p.price;
}

export function compatKey(a: string, b: string) {
  const [x, y] = [a, b].sort();
  return `report:compatibility:${x}:${y}`;
}

export function createCommerceService(config: AppConfig, db: Db, gateways: Gateways) {
  const getProduct = (id: string): Product => {
    const p = db.select().from(products).where(and(eq(products.id, id), eq(products.active, true))).get();
    if (!p) throw notFound('상품을 찾을 수 없어요.');
    return p;
  };

  const paidCount = (userId: string, productId: string) =>
    db.select({ n: sql<number>`count(*)` }).from(orders).where(and(eq(orders.userId, userId), eq(orders.productId, productId), eq(orders.status, 'paid'))).get()?.n ?? 0;

  const productDto = (p: Product, userId?: string): ProductDto => {
    const price = currentPrice(p);
    const purchasable = !p.comingSoon && (p.perUserLimit === null || !userId || paidCount(userId, p.id) < p.perUserLimit);
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      type: p.type as ProductDto['type'],
      price,
      listPrice: p.listPrice && p.listPrice > price ? p.listPrice : null,
      credits: p.credits,
      grants: p.grants,
      requiresProfile: requiresProfile(p),
      requiresPartner: requiresPartner(p),
      requiresReading: requiresReading(p),
      periodDays: p.periodDays,
      perUserLimit: p.perUserLimit,
      purchasable,
      saleEndsAt: p.saleEndsAt && p.saleEndsAt > Date.now() ? new Date(p.saleEndsAt).toISOString() : null,
      badge: p.badge,
      comingSoon: p.comingSoon,
      iosProductId: p.iosProductId,
      androidProductId: p.androidProductId,
    };
  };

  const orderDto = (o: Order): OrderDto => ({
    id: o.id,
    productId: o.productId,
    orderName: o.orderName,
    amount: o.amount,
    status: o.status as OrderDto['status'],
    provider: o.provider as PaymentProvider,
    createdAt: new Date(o.createdAt).toISOString(),
    paidAt: o.paidAt ? new Date(o.paidAt).toISOString() : null,
  });

  const getOwnedOrder = (userId: string, orderId: string): Order => {
    const o = db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId))).get();
    if (!o) throw notFound('주문을 찾을 수 없어요.');
    return o;
  };

  /** 타로 리딩 소유·상품 일치 확인 — 타로 서비스가 만들어진 뒤 setReadingCheck 로 연결된다 */
  let readingCheck: ((userId: string, readingId: string, productId: string) => void) | null = null;
  /** 타로 외에 결과 하나를 여는 상품(택일 등)의 확인 함수 — grant 별로 setGrantReadingCheck 로 연결 */
  const grantReadingChecks = new Map<string, (userId: string, readingId: string, productId: string) => void>();
  const assertReading = (userId: string, product: Product, readingId: string | undefined) => {
    if (!requiresReading(product)) return;
    if (!readingId) throw badRequest('열어 볼 타로 리딩을 다시 선택해 주세요.');
    const byGrant = product.grants.map((g) => grantReadingChecks.get(g)).find(Boolean);
    (byGrant ?? readingCheck)?.(userId, readingId, product.id);
  };

  const assertOwnedProfile = (userId: string, profileId: string) => {
    const p = db.select({ id: profiles.id }).from(profiles).where(and(eq(profiles.id, profileId), eq(profiles.userId, userId))).get();
    if (!p) throw badRequest('리포트를 받을 프로필을 다시 선택해 주세요.');
  };

  // ── 질문권 원장 ─────────────────────────────────────────────
  const addCredits = (tx: Tx, userId: string, delta: number, opts: { reason: string; source: 'paid' | 'free'; channel: Channel; memo?: string; refType?: string; refId?: string }) => {
    const u = tx.select({ credits: users.credits, paidCredits: users.paidCredits }).from(users).where(eq(users.id, userId)).get();
    if (!u) throw notFound('사용자를 찾을 수 없어요.');
    const credits = u.credits + delta;
    const paidCredits = opts.source === 'paid' ? u.paidCredits + delta : u.paidCredits;
    tx.update(users).set({ credits, paidCredits, updatedAt: Date.now() }).where(eq(users.id, userId)).run();
    tx.insert(creditLedger)
      .values({ id: newId(), userId, delta, reason: opts.reason, source: opts.source, channel: opts.channel, memo: opts.memo ?? null, refType: opts.refType ?? null, refId: opts.refId ?? null, balanceAfter: credits })
      .run();
    return credits;
  };

  const grantEntitlement = (tx: Tx, userId: string, key: string, orderId: string | null, expiresAt: number | null = null) => {
    tx.insert(entitlements).values({ id: newId(), userId, key, orderId, expiresAt }).onConflictDoNothing().run();
  };

  /** grants 템플릿 → 이 주문의 실제 권한 키 (지급·환불 철회 공용) */
  const entitlementKeys = (product: Product, order: Order): string[] => {
    const meta = (order.metadata ?? {}) as { profileId?: string; partnerProfileId?: string; readingId?: string };
    return product.grants.map((g) => {
      if (g === 'ticket:compatibility') return `ticket:compatibility:${order.id}`;
      if (g === 'report:compatibility') return meta.profileId && meta.partnerProfileId ? compatKey(meta.profileId, meta.partnerProfileId) : `ticket:compatibility:${order.id}`;
      if (g.startsWith('report:yearly:')) return `report:yearly:${meta.profileId}:${g.split(':')[2]}`;
      if (g === 'tarot:reading') return `tarot:reading:${meta.readingId}`;
      if (g === 'taekil:reading') return `taekil:reading:${meta.readingId}`;
      return `${g}:${meta.profileId}`;
    });
  };

  /** 상품 지급 — 질문권 / 권한 / 구독 기간 */
  const fulfill = (tx: Tx, order: Order, channel: Channel) => {
    const product = tx.select().from(products).where(eq(products.id, order.productId)).get();
    if (!product) throw notFound('상품을 찾을 수 없어요.');
    const granted = entitlementKeys(product, order);
    for (const key of granted) grantEntitlement(tx, order.userId, key, order.id);
    let premiumUntil: number | null = null;
    if (product.type === 'subscription' && product.periodDays) {
      const u = tx.select({ premiumUntil: users.premiumUntil }).from(users).where(eq(users.id, order.userId)).get()!;
      premiumUntil = Math.max(Date.now(), u.premiumUntil ?? 0) + product.periodDays * DAY;
      tx.update(users).set({ premiumUntil }).where(eq(users.id, order.userId)).run();
    }
    if (product.credits > 0) {
      addCredits(tx, order.userId, product.credits, { reason: 'purchase', source: 'paid', channel, memo: product.name, refType: 'order', refId: order.id });
    }
    return { credits: product.credits, entitlements: granted, premiumUntil: premiumUntil ? new Date(premiumUntil).toISOString() : null };
  };

  /**
   * 지급분 회수 — 권한 삭제 + 유상 질문권 차감(남은 만큼).
   * paid 주문일 때만 조건부로 바꾼다 → 관리자 환불·결제사 웹훅·스토어 알림이 겹쳐도 회수는 1회. 회수했으면 true
   */
  const revokeOrder = (tx: Tx, order: Order, status: 'refunded' | 'canceled', reason: string): boolean => {
    const r = tx
      .update(orders)
      .set({ status, canceledAt: Date.now(), failureReason: reason, updatedAt: Date.now() })
      .where(and(eq(orders.id, order.id), eq(orders.status, 'paid')))
      .run();
    if (r.changes !== 1) return false;
    tx.delete(entitlements).where(eq(entitlements.orderId, order.id)).run();
    const product = tx.select().from(products).where(eq(products.id, order.productId)).get();
    if (product && product.credits > 0) {
      const u = tx.select({ paidCredits: users.paidCredits }).from(users).where(eq(users.id, order.userId)).get()!;
      const revoke = Math.min(product.credits, u.paidCredits);
      if (revoke > 0) addCredits(tx, order.userId, -revoke, { reason: 'refund', source: 'paid', channel: 'system', memo: `${product.name} ${status === 'refunded' ? '환불' : '결제 취소'}`, refType: 'order', refId: order.id });
    }
    return true;
  };

  /**
   * 환불 철회(App Store REFUND_REVERSED) — refunded 주문을 paid 로 되돌리고 권한·질문권을 다시 지급한다.
   * 질문권은 이 주문 원장(refType=order)의 순합계가 상품 질문권 수가 될 만큼만 채운다
   * (환불 때 이미 써 버려 회수하지 못한 몫은 다시 주지 않는다). 복구했으면 true
   */
  const restoreOrder = (tx: Tx, order: Order): boolean => {
    const r = tx
      .update(orders)
      .set({ status: 'paid', canceledAt: null, failureReason: null, updatedAt: Date.now() })
      .where(and(eq(orders.id, order.id), eq(orders.status, 'refunded')))
      .run();
    if (r.changes !== 1) return false;
    const product = tx.select().from(products).where(eq(products.id, order.productId)).get();
    if (!product) return true;
    for (const key of entitlementKeys(product, order)) grantEntitlement(tx, order.userId, key, order.id);
    if (product.credits > 0) {
      const net =
        tx
          .select({ n: sql<number>`coalesce(sum(${creditLedger.delta}), 0)` })
          .from(creditLedger)
          .where(and(eq(creditLedger.refType, 'order'), eq(creditLedger.refId, order.id)))
          .get()?.n ?? 0;
      const give = product.credits - net;
      if (give > 0) addCredits(tx, order.userId, give, { reason: 'purchase', source: 'paid', channel: 'system', memo: `${product.name} 환불 철회`, refType: 'order', refId: order.id });
    }
    return true;
  };

  type Granted = ReturnType<typeof fulfill>;

  /** 지급 직후 알림(산 리포트 미리 만들기) — 리포트 서비스가 만들어진 뒤 setFulfilledListener 로 연결된다 */
  let fulfilledListener: ((e: FulfilledEvent) => void) | null = null;
  const notifyFulfilled = (order: Order, granted: Granted) => {
    if (!fulfilledListener || granted.entitlements.length === 0) return;
    const meta = (order.metadata ?? {}) as { profileId?: string; partnerProfileId?: string };
    try {
      fulfilledListener({ userId: order.userId, entitlements: granted.entitlements, profileId: meta.profileId, partnerProfileId: meta.partnerProfileId });
    } catch (e) {
      // 결제·지급은 이미 끝났다 — 후처리 실패가 결제 응답을 깨지 않게 한다
      console.error('[commerce] 지급 후처리 실패', e);
    }
  };

  /**
   * 결제 확정 + 지급을 한 트랜잭션에서 원자적으로 처리한다.
   * - pending/failed 주문만 paid 로 바꾼다(조건부 UPDATE) → 동시 승인·웹훅 경쟁에서도 지급은 정확히 1회
   * - 계정당 구매 한도를 트랜잭션 안에서 다시 확인한다(주문 생성 시점 확인만으로는 우회 가능)
   * - 커밋된 뒤에만 지급 알림을 보낸다(웹 승인·인앱결제·웹훅 모두 여기를 지난다)
   */
  type Payment = { paymentKey: string | null; method: string | null; paidAt: number };
  type Settled = { ok: true; granted: Granted } | { ok: false; reason: 'ALREADY_SETTLED' | 'PER_USER_LIMIT' };
  const settle = (order: Order, pay: Payment, channel: Channel): Settled => {
    const result = settleTx(order, pay, channel);
    if (result.ok) notifyFulfilled(order, result.granted);
    return result;
  };
  const settleTx = (order: Order, pay: Payment, channel: Channel): Settled =>
    db.transaction((tx) => {
      const product = tx.select().from(products).where(eq(products.id, order.productId)).get();
      if (product && product.perUserLimit !== null) {
        const n = tx.select({ n: sql<number>`count(*)` }).from(orders).where(and(eq(orders.userId, order.userId), eq(orders.productId, order.productId), eq(orders.status, 'paid'))).get()?.n ?? 0;
        if (n >= product.perUserLimit) return { ok: false as const, reason: 'PER_USER_LIMIT' as const };
      }
      const r = tx
        .update(orders)
        .set({ status: 'paid', providerPaymentKey: pay.paymentKey ?? order.providerPaymentKey, method: pay.method ?? order.method, paidAt: pay.paidAt, failureReason: null, updatedAt: Date.now() })
        .where(and(eq(orders.id, order.id), inArray(orders.status, ['pending', 'failed'])))
        .run();
      if (r.changes !== 1) return { ok: false as const, reason: 'ALREADY_SETTLED' as const };
      return { ok: true as const, granted: fulfill(tx, order, channel) };
    });

  /** pending 일 때만 실패로 표시(이미 paid 된 주문을 덮어쓰지 않음) */
  const failIfPending = (orderId: string, reason: string) =>
    db.update(orders).set({ status: 'failed', failureReason: reason.slice(0, 300), updatedAt: Date.now() }).where(and(eq(orders.id, orderId), eq(orders.status, 'pending'))).run();

  const EMPTY_GRANT = { credits: 0, entitlements: [] as string[], premiumUntil: null };

  const balance = (userId: string) => db.select({ credits: users.credits }).from(users).where(eq(users.id, userId)).get()?.credits ?? 0;

  // ── 웹훅·스토어 알림 이벤트 기록 (webhook_events, 멱등) ─────────────
  /** 처리 완료된 이벤트면 true. 처음 보는 이벤트는 기록해 둔다 — 처리 중 오류로 끝나면 재전송 때 다시 처리 */
  const alreadyProcessed = (key: string, provider: string, type: string, payload: unknown): boolean => {
    const seen = db.select({ processedAt: webhookEvents.processedAt }).from(webhookEvents).where(eq(webhookEvents.id, key)).get();
    if (seen?.processedAt) return true;
    if (!seen) db.insert(webhookEvents).values({ id: key, provider, eventType: type, payload: (payload ?? {}) as object }).onConflictDoNothing().run();
    return false;
  };
  const markProcessed = (key: string) => db.update(webhookEvents).set({ processedAt: Date.now() }).where(eq(webhookEvents.id, key)).run();
  /** 스토어가 무효화(환불·취소)한 거래 표시 — 앱이 검증하기 전에 환불된 구매를 나중에 지급하지 않도록 */
  const voidedKey = (provider: string, transactionId: string) => `${provider}:voided:${transactionId}`;
  const isVoided = (provider: string, transactionId: string) => Boolean(db.select({ id: webhookEvents.id }).from(webhookEvents).where(eq(webhookEvents.id, voidedKey(provider, transactionId))).get());

  return {
    getProduct,
    productDto,
    orderDto,

    listProducts(userId?: string): ProductDto[] {
      return db.select().from(products).where(eq(products.active, true)).orderBy(asc(products.sortOrder)).all().map((p) => productDto(p, userId));
    },

    /** 주문 생성 → 결제창 파라미터 반환 */
    createOrder(userId: string, dto: OrderCreateDto): CheckoutDto {
      const user = db.select().from(users).where(eq(users.id, userId)).get();
      if (!user) throw notFound('사용자를 찾을 수 없어요.');
      if (user.provider === 'guest') throw new AppError(403, ERROR_CODES.FORBIDDEN, '구매 내역을 안전하게 보관하려면 로그인이 필요해요.', { reason: 'LOGIN_REQUIRED' });
      const product = getProduct(dto.productId);
      if (product.comingSoon) throw badRequest('곧 출시될 상품이에요.');
      if (product.perUserLimit !== null && paidCount(userId, product.id) >= product.perUserLimit) throw conflict('이미 구매한 상품이에요. (계정당 1회)');
      if (requiresProfile(product)) {
        if (!dto.profileId) throw badRequest('리포트를 받을 프로필을 선택해 주세요.');
        assertOwnedProfile(userId, dto.profileId);
      }
      if (dto.partnerProfileId) assertOwnedProfile(userId, dto.partnerProfileId);
      assertReading(userId, product, dto.readingId);

      const gateway = gateways.active;
      if (!gateway.isConfigured()) throw notConfigured('결제', gateway.envKeys);

      const order: typeof orders.$inferInsert = {
        id: newOrderId(),
        userId,
        productId: product.id,
        orderName: product.name,
        amount: currentPrice(product),
        status: 'pending',
        provider: gateway.id,
        metadata: { profileId: dto.profileId, partnerProfileId: dto.partnerProfileId, year: dto.year, readingId: dto.readingId, couponCode: dto.couponCode },
      };
      db.insert(orders).values(order).run();
      const saved = getOwnedOrder(userId, order.id);
      const web = config.PUBLIC_WEB_URL.replace(/\/$/, '');
      return {
        order: orderDto(saved),
        provider: gateway.id,
        checkout: {
          clientKey: gateway.id === 'toss' ? config.TOSS_CLIENT_KEY : undefined,
          storeId: gateway.id === 'portone' ? config.PORTONE_STORE_ID : undefined,
          channelKey: gateway.id === 'portone' ? config.PORTONE_CHANNEL_KEY : undefined,
          customerKey: userId,
          orderId: saved.id,
          orderName: saved.orderName,
          amount: saved.amount,
          successUrl: `${web}/payments/success`,
          failUrl: `${web}/payments/fail`,
          customerEmail: user.email ?? undefined,
          customerName: user.nickname,
        },
      };
    },

    listOrders(userId: string): OrderDto[] {
      return db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.createdAt)).all().map(orderDto);
    },

    getOrder(userId: string, orderId: string): OrderDto {
      return orderDto(getOwnedOrder(userId, orderId));
    },

    /** 결제 승인 — 금액 검증 → 결제사 승인 → 지급 (멱등) */
    async confirmPayment(userId: string, input: { orderId: string; amount: number; paymentKey?: string }): Promise<PaymentResultDto> {
      const order = getOwnedOrder(userId, input.orderId);
      const already = () => ({ order: orderDto(getOwnedOrder(userId, order.id)), granted: EMPTY_GRANT, creditsBalance: balance(userId) });
      if (order.status === 'paid') return already();
      if (order.status !== 'pending') throw conflict('이미 처리된 주문이에요.');
      if (input.amount !== order.amount) {
        failIfPending(order.id, 'AMOUNT_MISMATCH');
        throw badRequest('결제 금액이 주문 금액과 달라요. 다시 시도해 주세요.');
      }
      const gateway = gateways.byId[order.provider as keyof Gateways['byId']];
      if (!gateway) throw badRequest('지원하지 않는 결제 수단이에요.');
      let confirmed;
      try {
        confirmed = await gateway.confirm({ orderId: order.id, amount: order.amount, paymentKey: input.paymentKey ?? '' });
      } catch (e) {
        if (e instanceof GatewayError) {
          failIfPending(order.id, `${e.code}: ${e.message}`);
          // 동시 요청 중 다른 요청이 이미 확정했다면 실패가 아니라 완료로 응답
          if (getOwnedOrder(userId, order.id).status === 'paid') return already();
          throw new AppError(402, ERROR_CODES.PAYMENT_FAILED, e.message, { code: e.code });
        }
        throw e;
      }
      if (confirmed.totalAmount !== order.amount) {
        await gateway.cancel({ paymentKey: confirmed.paymentKey, reason: '결제 금액 불일치' }).catch(() => undefined);
        failIfPending(order.id, 'AMOUNT_MISMATCH_AFTER_CONFIRM');
        throw badRequest('결제 금액 검증에 실패해 결제를 취소했어요.');
      }
      const settled = settle(order, { paymentKey: confirmed.paymentKey, method: confirmed.method, paidAt: confirmed.approvedAt }, 'web');
      if (!settled.ok) {
        if (settled.reason === 'PER_USER_LIMIT') {
          await gateway.cancel({ paymentKey: confirmed.paymentKey, reason: '계정당 구매 한도 초과' }).catch(() => undefined);
          db.update(orders).set({ status: 'canceled', canceledAt: Date.now(), failureReason: 'PER_USER_LIMIT', updatedAt: Date.now() }).where(and(eq(orders.id, order.id), inArray(orders.status, ['pending', 'failed']))).run();
          throw conflict('이미 구매한 상품이라 결제를 취소했어요. (계정당 1회)');
        }
        return already();
      }
      return { order: orderDto(getOwnedOrder(userId, order.id)), granted: settled.granted, creditsBalance: balance(userId) };
    },

    /** 결제창에서 사용자가 취소/실패한 경우 */
    markFailed(userId: string, orderId: string, reason: string) {
      const order = getOwnedOrder(userId, orderId);
      if (order.status === 'pending') failIfPending(order.id, reason);
      return orderDto(getOwnedOrder(userId, orderId));
    },

    /** 앱 인앱결제 영수증 검증 → 주문 생성 + 지급 (거래 ID 로 멱등) */
    async verifyIap(userId: string, input: { platform: 'ios' | 'android'; productId: string; receipt: string; profileId?: string; readingId?: string }): Promise<PaymentResultDto> {
      const user = db.select().from(users).where(eq(users.id, userId)).get();
      if (!user || user.provider === 'guest') throw forbidden('구매 내역을 안전하게 보관하려면 로그인이 필요해요.');
      const verifier = gateways.iap[input.platform];
      if (!verifier.isConfigured()) throw notConfigured(input.platform === 'ios' ? 'App Store 결제' : 'Google Play 결제', verifier.envKeys);
      const product = db
        .select()
        .from(products)
        .where(input.platform === 'ios' ? eq(products.iosProductId, input.productId) : eq(products.androidProductId, input.productId))
        .get();
      if (!product) throw notFound('스토어 상품과 연결된 상품이 없어요.');
      if (requiresProfile(product)) {
        if (!input.profileId) throw badRequest('리포트를 받을 프로필을 선택해 주세요.');
        assertOwnedProfile(userId, input.profileId);
      }
      assertReading(userId, product, input.readingId);
      let v;
      try {
        v = await verifier.verify({ productId: input.productId, receipt: input.receipt });
      } catch (e) {
        if (e instanceof GatewayError) throw new AppError(402, ERROR_CODES.PAYMENT_FAILED, e.message);
        throw e;
      }
      const provider = input.platform === 'ios' ? 'iap_apple' : 'iap_google';
      const existing = db.select().from(orders).where(and(eq(orders.provider, provider), eq(orders.providerPaymentKey, v.transactionId))).get();
      if (existing) {
        if (existing.userId !== userId) throw conflict('다른 계정에서 이미 사용된 구매예요.');
        return { order: orderDto(existing), granted: { credits: 0, entitlements: [], premiumUntil: null }, creditsBalance: balance(userId) };
      }
      if (isVoided(provider, v.transactionId)) throw new AppError(402, ERROR_CODES.PAYMENT_FAILED, '환불되었거나 취소된 구매예요.', { code: 'REVOKED' });
      const id = newOrderId();
      try {
        db.insert(orders)
          .values({ id, userId, productId: product.id, orderName: product.name, amount: currentPrice(product), status: 'pending', provider, providerPaymentKey: v.transactionId, method: 'IAP', metadata: { profileId: input.profileId, readingId: input.readingId } })
          .run();
      } catch {
        // 같은 거래가 동시에 검증되는 경우(유니크 인덱스) — 먼저 들어간 요청이 처리한다
        const dup = db.select().from(orders).where(and(eq(orders.provider, provider), eq(orders.providerPaymentKey, v.transactionId))).get();
        if (dup && dup.userId === userId) return { order: orderDto(dup), granted: EMPTY_GRANT, creditsBalance: balance(userId) };
        throw conflict('다른 계정에서 이미 사용된 구매예요.');
      }
      const order = db.select().from(orders).where(eq(orders.id, id)).get()!;
      const settled = settle(order, { paymentKey: v.transactionId, method: 'IAP', paidAt: v.purchasedAt }, input.platform);
      if (!settled.ok && settled.reason === 'PER_USER_LIMIT') {
        failIfPending(id, 'PER_USER_LIMIT');
        throw conflict('이미 구매한 상품이에요. (계정당 1회) 스토어 결제는 완료 처리되지 않아 자동 환불돼요.');
      }
      const granted = settled.ok ? settled.granted : EMPTY_GRANT;
      return { order: orderDto(getOwnedOrder(userId, id)), granted, creditsBalance: balance(userId) };
    },

    /** 결제사 웹훅 처리 (가상계좌 입금, 결제 취소 등 비동기 상태 변경) */
    async handleWebhook(providerId: string, headers: Record<string, string | string[] | undefined>, rawBody: string) {
      const gateway = gateways.byId[providerId as keyof Gateways['byId']];
      if (!gateway || (providerId === 'mock' && config.isProd)) throw notFound('알 수 없는 결제사예요.');
      const event = await gateway.parseWebhook({ headers, rawBody });
      if (!event) throw badRequest('웹훅 검증에 실패했어요.');
      const eventKey = `${providerId}:${event.id}`;
      if (alreadyProcessed(eventKey, providerId, event.type, event.raw)) return { duplicate: true };
      const found = event.orderId ? db.select().from(orders).where(eq(orders.id, event.orderId)).get() : undefined;
      // 다른 결제사로 생성된 주문은 이 웹훅으로 상태를 바꿀 수 없다(목업·타 PG 웹훅 위조 방지)
      const order = found && found.provider === providerId ? found : undefined;
      if (order && event.status === 'canceled' && order.status === 'paid') {
        // 결제사 관리자 화면 등에서 취소된 경우에도 지급분을 회수한다
        db.transaction((tx) => revokeOrder(tx, order, 'canceled', `웹훅(${event.type})`));
      } else if (order && event.status === 'paid' && (order.status === 'pending' || order.status === 'failed')) {
        // 승인 응답 유실 등으로 지급되지 않은 결제를 복구 — 결제사가 확인한 금액이 주문 금액과 같을 때만
        if (event.amount !== order.amount) {
          if (event.paymentKey) await gateway.cancel({ paymentKey: event.paymentKey, reason: '결제 금액 불일치' }).catch(() => undefined);
          db.update(orders)
            .set({ status: 'failed', failureReason: `WEBHOOK_AMOUNT_MISMATCH: ${event.amount ?? 'unknown'} != ${order.amount}`, updatedAt: Date.now() })
            .where(eq(orders.id, order.id))
            .run();
          markProcessed(eventKey);
          return { duplicate: false };
        }
        const settled = settle(order, { paymentKey: event.paymentKey, method: null, paidAt: Date.now() }, 'web');
        if (!settled.ok && settled.reason === 'PER_USER_LIMIT' && event.paymentKey) {
          await gateway.cancel({ paymentKey: event.paymentKey, reason: '계정당 구매 한도 초과' }).catch(() => undefined);
        }
      }
      markProcessed(eventKey);
      return { duplicate: false };
    },

    /**
     * 스토어 서버 알림(App Store Server Notifications V2 / Google Play RTDN) — 스토어 환불·취소를 지급분에 반영.
     * 회수는 관리자 환불과 같은 revokeOrder 를 쓰고(스토어가 이미 환불했으므로 결제사 취소 호출은 없음), 알림 ID 로 멱등.
     * 외부 호출 없이 DB 만 다루므로 바로 응답한다. 모르는 유형·우리 주문이 없는 알림은 기록만 하고 성공 응답.
     */
    async handleStoreNotification(platform: 'ios' | 'android', headers: Record<string, string | string[] | undefined>, body: unknown) {
      const source = gateways.notifications[platform];
      if (!source.isConfigured()) throw notConfigured(platform === 'ios' ? 'App Store 서버 알림' : 'Google Play 실시간 개발자 알림', source.envKeys);
      const n = await source.parse({ headers, body });
      const provider = platform === 'ios' ? 'iap_apple' : 'iap_google';
      const eventKey = `${provider}:${n.id}`;
      if (alreadyProcessed(eventKey, provider, n.type, n.raw)) return { duplicate: true, type: n.type, applied: false };

      let applied = false;
      if (n.action !== 'none' && n.transactionIds.length > 0) {
        const order = db.select().from(orders).where(and(eq(orders.provider, provider), inArray(orders.providerPaymentKey, n.transactionIds))).get();
        db.transaction((tx) => {
          if (n.action === 'revoke') {
            if (order) applied = revokeOrder(tx, order, n.revokeStatus ?? 'refunded', n.reason);
            // 앱이 아직 검증(/payments/iap/verify)하지 않은 구매도 있다 — 나중에 검증 요청이 와도 지급하지 않도록 표시
            for (const txId of n.transactionIds) {
              tx.insert(webhookEvents).values({ id: voidedKey(provider, txId), provider, eventType: 'VOIDED', payload: { notification: n.id, reason: n.reason }, processedAt: Date.now() }).onConflictDoNothing().run();
            }
          } else {
            if (order) applied = restoreOrder(tx, order);
            for (const txId of n.transactionIds) tx.delete(webhookEvents).where(eq(webhookEvents.id, voidedKey(provider, txId))).run();
          }
        });
      }
      markProcessed(eventKey);
      return { duplicate: false, type: n.type, applied };
    },

    /** 환불 — 결제사 취소 후 지급분 회수 (관리자/CS 용) */
    async refund(orderId: string, reason: string) {
      const order = db.select().from(orders).where(eq(orders.id, orderId)).get();
      if (!order) throw notFound('주문을 찾을 수 없어요.');
      if (order.status !== 'paid') throw conflict('결제 완료된 주문만 환불할 수 있어요.');
      // 스토어 환불은 스토어 서버 알림(handleStoreNotification)으로 같은 revokeOrder 가 적용된다
      if (order.provider.startsWith('iap_')) throw badRequest('인앱결제는 스토어(App Store/Google Play)에서 환불이 진행돼요.');
      const gateway = gateways.byId[order.provider as keyof Gateways['byId']];
      // 질문권 팩은 미사용 유상 질문권 비율만큼만 부분 환불 (PAYMENTS.md 환불 정책)
      const product = db.select().from(products).where(eq(products.id, order.productId)).get();
      let cancelAmount: number | undefined;
      if (product?.type === 'credit_pack' && product.credits > 0) {
        const paid = db.select({ paidCredits: users.paidCredits }).from(users).where(eq(users.id, order.userId)).get()?.paidCredits ?? 0;
        const unused = Math.min(product.credits, paid);
        if (unused === 0) throw conflict('이미 모두 사용한 질문권은 환불할 수 없어요.');
        if (unused < product.credits) cancelAmount = Math.floor((order.amount * unused) / product.credits);
      }
      if (order.providerPaymentKey) await gateway.cancel({ paymentKey: order.providerPaymentKey, reason, amount: cancelAmount });
      db.transaction((tx) => revokeOrder(tx, order, 'refunded', reason));
      return orderDto(db.select().from(orders).where(eq(orders.id, order.id)).get()!);
    },

    // ── 권한 ───────────────────────────────────────────────────
    setReadingCheck(fn: (userId: string, readingId: string, productId: string) => void) {
      readingCheck = fn;
    },
    setFulfilledListener(fn: (e: FulfilledEvent) => void) {
      fulfilledListener = fn;
    },
    /** 특정 grant(예: taekil:reading)를 가진 상품의 결과 소유·상품 일치 확인 */
    setGrantReadingCheck(grant: string, fn: (userId: string, readingId: string, productId: string) => void) {
      grantReadingChecks.set(grant, fn);
    },

    hasEntitlement(userId: string, key: string): boolean {
      const now = Date.now();
      const row = db.select().from(entitlements).where(and(eq(entitlements.userId, userId), eq(entitlements.key, key))).get();
      return Boolean(row && (row.expiresAt === null || row.expiresAt > now));
    },
    isPremium(userId: string): boolean {
      const u = db.select({ premiumUntil: users.premiumUntil }).from(users).where(eq(users.id, userId)).get();
      return Boolean(u?.premiumUntil && u.premiumUntil > Date.now());
    },
    /** 1회권(ticket) 사용 → 실제 권한으로 전환. 사용 가능한 티켓이 없으면 false */
    redeemTicket(userId: string, kind: 'compatibility', newKey: string): boolean {
      return db.transaction((tx) => {
        const ticket = tx.select().from(entitlements).where(and(eq(entitlements.userId, userId), like(entitlements.key, `ticket:${kind}:%`))).orderBy(asc(entitlements.createdAt)).get();
        if (!ticket) return false;
        tx.delete(entitlements).where(eq(entitlements.id, ticket.id)).run();
        grantEntitlement(tx, userId, newKey, ticket.orderId);
        return true;
      });
    },
    ticketCount(userId: string, kind: 'compatibility'): number {
      return db.select({ id: entitlements.id }).from(entitlements).where(and(eq(entitlements.userId, userId), like(entitlements.key, `ticket:${kind}:%`))).all().length;
    },

    // ── 질문권 ─────────────────────────────────────────────────
    /** 무상분부터 차감(유상분은 환불 대상으로 최대한 보존) */
    consumeCredits(userId: string, amount: number, memo: string, refId?: string): number {
      return db.transaction((tx) => {
        const u = tx.select({ credits: users.credits, paidCredits: users.paidCredits }).from(users).where(eq(users.id, userId)).get();
        if (!u) throw notFound('사용자를 찾을 수 없어요.');
        if (u.credits < amount) throw insufficientCredits(amount, u.credits);
        const free = u.credits - u.paidCredits;
        const fromFree = Math.min(free, amount);
        const fromPaid = amount - fromFree;
        let left = u.credits;
        if (fromFree > 0) left = addCredits(tx, userId, -fromFree, { reason: 'consume', source: 'free', channel: 'system', memo, refType: 'chat', refId });
        if (fromPaid > 0) left = addCredits(tx, userId, -fromPaid, { reason: 'consume', source: 'paid', channel: 'system', memo, refType: 'chat', refId });
        return left;
      });
    },
    grantFreeCredits(userId: string, amount: number, memo: string): number {
      return db.transaction((tx) => addCredits(tx, userId, amount, { reason: 'bonus', source: 'free', channel: 'system', memo }));
    },
    wallet(userId: string): WalletDto {
      const u = db.select({ credits: users.credits, paidCredits: users.paidCredits }).from(users).where(eq(users.id, userId)).get();
      if (!u) throw notFound('사용자를 찾을 수 없어요.');
      const ledger = db.select().from(creditLedger).where(eq(creditLedger.userId, userId)).orderBy(desc(creditLedger.createdAt)).limit(100).all();
      const ents = db.select().from(entitlements).where(eq(entitlements.userId, userId)).orderBy(desc(entitlements.createdAt)).all();
      return {
        credits: u.credits,
        paidCredits: u.paidCredits,
        freeCredits: u.credits - u.paidCredits,
        ledger: ledger.map((l) => ({ id: l.id, delta: l.delta, reason: l.reason, source: l.source === 'paid' ? 'paid' : 'free', memo: l.memo, balanceAfter: l.balanceAfter, createdAt: new Date(l.createdAt).toISOString() })),
        entitlements: ents.map((e) => ({ key: e.key, expiresAt: e.expiresAt ? new Date(e.expiresAt).toISOString() : null, createdAt: new Date(e.createdAt).toISOString() })),
      };
    },
  };
}

export type CommerceService = ReturnType<typeof createCommerceService>;
