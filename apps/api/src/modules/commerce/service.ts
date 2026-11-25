/**
 * 커머스 코어 — 상품 / 주문 / 결제 승인 / 지급(fulfillment) / 질문권 원장 / 권한(entitlement).
 * 결제사 연동은 providers/* 게이트웨이가 담당하고, 여기서는 금액 검증과 지급의 원자성을 보장한다.
 */
import { and, asc, count, desc, eq, gte, inArray, like, notInArray, sql } from 'drizzle-orm';
import type { CheckoutDto, OrderCreateDto, OrderDto, PaymentProvider, PaymentResultDto, ProductDto, WalletDto } from '@saju/shared';
import { ERROR_CODES } from '@saju/shared';
import type { AppConfig } from '../../config/env.js';
import { safeErrorText } from '../../lib/log.js';
import { atomic, type Unit } from '../../db/atomic.js';
import type { Db } from '../../db/client.js';
import { creditLedger, entitlements, orders, products, profiles, users, webhookEvents, type Order, type Product } from '../../db/schema.js';
import { AppError, badRequest, conflict, forbidden, insufficientCredits, notConfigured, notFound } from '../../lib/errors.js';
import { newId, newOrderId } from '../../lib/ids.js';
import { CATALOG } from './catalog.js';
import type { Gateways } from './providers/index.js';
import { GatewayError } from './providers/types.js';

type Channel = 'web' | 'ios' | 'android' | 'toss' | 'system';

/** 결제 지급 완료 — 지급된 권한 키와 주문의 대상 프로필 */
export interface FulfilledEvent {
  userId: string;
  entitlements: string[];
  profileId?: string;
  partnerProfileId?: string;
}

const DAY = 86_400_000;
const KST_OFFSET = 9 * 3_600_000;
/** 오늘(KST) 0시의 epoch ms */
export const startOfSeoulDay = (now = Date.now()) => Math.floor((now + KST_OFFSET) / DAY) * DAY - KST_OFFSET;

/** AI 장애 환급 — 사용자마다 하루(KST) 최대 횟수. 장애가 아닌데 환급이 되풀이되는 경우(실패 유도 등)를 막는다 */
export const AI_REFUND_DAILY_LIMIT = 5;
/** 원장(credit_ledger.ref_type)에 남기는 AI 장애 환급 표시 — 하루 환급 횟수를 이것으로 센다 */
export const AI_REFUND_REF = 'ai_refund';

type FulfilledListener = (e: FulfilledEvent) => Promise<void> | void;
/** 결과 하나를 여는 상품(타로·택일)의 소유·상품 일치 확인 — 맞지 않으면 예외 */
type ReadingCheck = (userId: string, readingId: string, productId: string) => Promise<void> | void;

/** 카탈로그 → DB upsert(한 묶음). 카탈로그에서 뺀 상품은 지우지 않고 판매 중지(active=false) — 지난 주문이 참조한다 */
export async function seedCatalog(db: Db) {
  const deactivate = db
    .update(products)
    .set({ active: false, updatedAt: Date.now() })
    .where(and(eq(products.active, true), notInArray(products.id, CATALOG.map((c) => c.id))));
  const upserts = CATALOG.map((c, i) => {
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
    return db.insert(products).values({ id: c.id, ...values }).onConflictDoUpdate({ target: products.id, set: values });
  });
  await db.batch([deactivate, ...upserts]);
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

/**
 * 원장에 적을 잔액 — 같은 묶음(batch) 안에서 잔액 갱신 바로 뒤에 넣으면 갱신된 값을 읽는다.
 * (drizzle 의 D1 batch 는 db.run(sql) 원시 문장에 인자가 있으면 실패해, insert 의 값 자리에 하위 쿼리로 넣는다)
 */
export const balanceNow = (userId: string) => sql<number>`(select ${users.credits} from ${users} where ${users.id} = ${userId})`;

export function compatKey(a: string, b: string) {
  const [x, y] = [a, b].sort();
  return `report:compatibility:${x}:${y}`;
}

export function createCommerceService(config: AppConfig, db: Db, gateways: Gateways) {
  const getProduct = async (id: string): Promise<Product> => {
    const [p] = await db.select().from(products).where(and(eq(products.id, id), eq(products.active, true)));
    if (!p) throw notFound('상품을 찾을 수 없어요.');
    return p;
  };

  const paidCount = async (userId: string, productId: string) =>
    (await db.select({ n: count() }).from(orders).where(and(eq(orders.userId, userId), eq(orders.productId, productId), eq(orders.status, 'paid'))))[0]?.n ?? 0;

  const productDto = async (p: Product, userId?: string): Promise<ProductDto> => {
    const price = currentPrice(p);
    const purchasable = !p.comingSoon && (p.perUserLimit === null || !userId || (await paidCount(userId, p.id)) < p.perUserLimit);
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

  const getOwnedOrder = async (userId: string, orderId: string): Promise<Order> => {
    const [o] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId)));
    if (!o) throw notFound('주문을 찾을 수 없어요.');
    return o;
  };

  /** 타로 리딩 소유·상품 일치 확인 — 타로 서비스가 만들어진 뒤 setReadingCheck 로 연결된다 */
  let readingCheck: ReadingCheck | null = null;
  /** 타로 외에 결과 하나를 여는 상품(택일 등)의 확인 함수 — grant 별로 setGrantReadingCheck 로 연결 */
  const grantReadingChecks = new Map<string, ReadingCheck>();
  const assertReading = async (userId: string, product: Product, readingId: string | undefined) => {
    if (!requiresReading(product)) return;
    if (!readingId) throw badRequest('열어 볼 타로 리딩을 다시 선택해 주세요.');
    const byGrant = product.grants.map((g) => grantReadingChecks.get(g)).find(Boolean);
    await (byGrant ?? readingCheck)?.(userId, readingId, product.id);
  };

  const assertOwnedProfile = async (userId: string, profileId: string) => {
    const [p] = await db.select({ id: profiles.id }).from(profiles).where(and(eq(profiles.id, profileId), eq(profiles.userId, userId)));
    if (!p) throw badRequest('리포트를 받을 프로필을 다시 선택해 주세요.');
  };

  // ── 질문권 원장 ─────────────────────────────────────────────
  /**
   * 잔액 갱신(묶음에 넣기) — 누적은 SQL 로 해 동시 요청끼리 잔액을 덮어쓰지 않고,
   * 원장의 잔액은 같은 묶음 안에서 갱신 직후 사용자 행을 읽어 적는다
   */
  const addCredits = (u: Unit, userId: string, delta: number, opts: { reason: string; source: 'paid' | 'free'; channel: Channel; memo?: string; refType?: string; refId?: string }) => {
    u.write(
      db
        .update(users)
        .set({ credits: sql`${users.credits} + ${delta}`, ...(opts.source === 'paid' ? { paidCredits: sql`${users.paidCredits} + ${delta}` } : {}), updatedAt: Date.now() })
        .where(eq(users.id, userId)),
    );
    u.write(
      db.insert(creditLedger).values({
        id: newId(),
        userId,
        delta,
        reason: opts.reason,
        source: opts.source,
        channel: opts.channel,
        memo: opts.memo ?? null,
        refType: opts.refType ?? null,
        refId: opts.refId ?? null,
        balanceAfter: balanceNow(userId),
      }),
    );
  };

  const grantEntitlement = (u: Unit, userId: string, key: string, orderId: string | null, expiresAt: number | null = null) => {
    u.write(db.insert(entitlements).values({ id: newId(), userId, key, orderId, expiresAt }).onConflictDoNothing());
  };

  /** 주문이 실행 시점에도 이 상태들 중 하나여야 한다 */
  const expectOrderStatus = (u: Unit, orderId: string, statuses: string[]) =>
    u.expect(sql`exists (select 1 from ${orders} where ${orders.id} = ${orderId} and ${inArray(orders.status, statuses)})`);
  const orderStatus = async (orderId: string) => (await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)))[0]?.status;

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

  /**
   * 이 주문으로 지급(회수)할 질문권 수. 토스 미니앱 결제(iap_toss)는 리포트·타로에 딸린 질문권을 지급하지 않는다 —
   * 토스 첫 버전에는 AI 상담이 없어 쓸 곳이 없고, 상점 설명에도 질문권이 없다(설명과 지급 내용을 맞춘다). 질문권 팩은 그대로 지급한다
   */
  const creditsFor = (product: Pick<Product, 'type' | 'credits'>, toss: boolean) => (toss && product.type !== 'credit_pack' ? 0 : product.credits);

  /** 상품 지급(묶음에 넣기) — 질문권 / 권한 / 구독 기간 */
  const fulfill = async (u: Unit, order: Order, channel: Channel) => {
    const [product] = await db.select().from(products).where(eq(products.id, order.productId));
    if (!product) throw notFound('상품을 찾을 수 없어요.');
    const granted = entitlementKeys(product, order);
    for (const key of granted) grantEntitlement(u, order.userId, key, order.id);
    let premiumUntil: number | null = null;
    if (product.type === 'subscription' && product.periodDays) {
      const [w] = await db.select({ premiumUntil: users.premiumUntil }).from(users).where(eq(users.id, order.userId));
      premiumUntil = Math.max(Date.now(), w!.premiumUntil ?? 0) + product.periodDays * DAY;
      // 읽은 만료 시각에 기간을 더한다 — 그사이 다른 결제가 기간을 늘렸으면 다시 계산
      u.expect(sql`exists (select 1 from ${users} where ${users.id} = ${order.userId} and coalesce(${users.premiumUntil}, 0) = ${w!.premiumUntil ?? 0})`);
      u.write(db.update(users).set({ premiumUntil }).where(eq(users.id, order.userId)));
    }
    const credits = creditsFor(product, channel === 'toss');
    if (credits > 0) {
      addCredits(u, order.userId, credits, { reason: 'purchase', source: 'paid', channel, memo: product.name, refType: 'order', refId: order.id });
    }
    return { credits, entitlements: granted, premiumUntil: premiumUntil ? new Date(premiumUntil).toISOString() : null };
  };

  /**
   * 지급분 회수 — 권한 삭제 + 유상 질문권 차감(남은 만큼).
   * paid 주문일 때만 조건부로 바꾼다 → 관리자 환불·결제사 웹훅·스토어 알림이 겹쳐도 회수는 1회. 회수했으면 true
   */
  const revokeOrder = async (u: Unit, order: Order, status: 'refunded' | 'canceled', reason: string): Promise<boolean> => {
    if ((await orderStatus(order.id)) !== 'paid') return false;
    expectOrderStatus(u, order.id, ['paid']);
    u.write(
      db
        .update(orders)
        .set({ status, canceledAt: Date.now(), failureReason: reason, updatedAt: Date.now() })
        .where(and(eq(orders.id, order.id), eq(orders.status, 'paid'))),
    );
    u.write(db.delete(entitlements).where(eq(entitlements.orderId, order.id)));
    const [product] = await db.select().from(products).where(eq(products.id, order.productId));
    const credits = product ? creditsFor(product, order.provider === 'iap_toss') : 0;
    if (product && credits > 0) {
      const [w] = await db.select({ paidCredits: users.paidCredits }).from(users).where(eq(users.id, order.userId));
      const revoke = Math.min(credits, w!.paidCredits);
      // 남은 유상 질문권을 기준으로 회수량을 정했다 — 그사이 바뀌었으면 다시 계산
      u.expect(sql`exists (select 1 from ${users} where ${users.id} = ${order.userId} and ${users.paidCredits} = ${w!.paidCredits})`);
      if (revoke > 0) addCredits(u, order.userId, -revoke, { reason: 'refund', source: 'paid', channel: 'system', memo: `${product.name} ${status === 'refunded' ? '환불' : '결제 취소'}`, refType: 'order', refId: order.id });
    }
    return true;
  };

  /**
   * 환불 철회(App Store REFUND_REVERSED) — refunded 주문을 paid 로 되돌리고 권한·질문권을 다시 지급한다.
   * 질문권은 이 주문 원장(refType=order)의 순합계가 상품 질문권 수가 될 만큼만 채운다
   * (환불 때 이미 써 버려 회수하지 못한 몫은 다시 주지 않는다). 복구했으면 true
   */
  const restoreOrder = async (u: Unit, order: Order): Promise<boolean> => {
    if ((await orderStatus(order.id)) !== 'refunded') return false;
    expectOrderStatus(u, order.id, ['refunded']);
    u.write(
      db
        .update(orders)
        .set({ status: 'paid', canceledAt: null, failureReason: null, updatedAt: Date.now() })
        .where(and(eq(orders.id, order.id), eq(orders.status, 'refunded'))),
    );
    const [product] = await db.select().from(products).where(eq(products.id, order.productId));
    if (!product) return true;
    for (const key of entitlementKeys(product, order)) grantEntitlement(u, order.userId, key, order.id);
    if (product.credits > 0) {
      const net =
        (
          await db
            .select({ n: sql<number>`coalesce(sum(${creditLedger.delta}), 0)`.mapWith(Number) })
            .from(creditLedger)
            .where(and(eq(creditLedger.refType, 'order'), eq(creditLedger.refId, order.id)))
        )[0]?.n ?? 0;
      const give = product.credits - net;
      if (give > 0) addCredits(u, order.userId, give, { reason: 'purchase', source: 'paid', channel: 'system', memo: `${product.name} 환불 철회`, refType: 'order', refId: order.id });
    }
    return true;
  };

  type Granted = Awaited<ReturnType<typeof fulfill>>;

  /**
   * 지급 직후 알림(산 리포트 미리 만들기) — 리포트 서비스가 만들어진 뒤 setFulfilledListener 로 연결된다.
   * 결제 응답은 규칙 기반 본문 저장까지 기다린다(보관함에 바로 보이게). AI 다듬기는 뒤에서 이어진다
   */
  let fulfilledListener: FulfilledListener | null = null;
  const notifyFulfilled = async (order: Order, granted: Granted) => {
    if (!fulfilledListener || granted.entitlements.length === 0) return;
    const meta = (order.metadata ?? {}) as { profileId?: string; partnerProfileId?: string };
    try {
      await fulfilledListener({ userId: order.userId, entitlements: granted.entitlements, profileId: meta.profileId, partnerProfileId: meta.partnerProfileId });
    } catch (e) {
      // 결제·지급은 이미 끝났다 — 후처리 실패가 결제 응답을 깨지 않게 한다
      console.error('[commerce] 지급 후처리 실패', safeErrorText(e));
    }
  };

  /**
   * 결제 확정 + 지급을 한 묶음(atomic)으로 원자적으로 처리한다.
   * - pending/failed 주문만 paid 로 바꾼다(실행 시점 상태 확인) → 동시 승인·웹훅 경쟁에서도 지급은 정확히 1회
   * - 계정당 구매 한도를 묶음 실행 시점에 다시 확인한다(주문 생성 시점 확인만으로는 우회 가능)
   * - 묶음이 실행된 뒤에만 지급 알림을 보낸다(웹 승인·인앱결제·웹훅 모두 여기를 지난다)
   */
  type Payment = { paymentKey: string | null; method: string | null; paidAt: number };
  type Settled = { ok: true; granted: Granted } | { ok: false; reason: 'ALREADY_SETTLED' | 'PER_USER_LIMIT' };
  const settle = async (order: Order, pay: Payment, channel: Channel): Promise<Settled> => {
    const result = await settleTx(order, pay, channel);
    if (result.ok) await notifyFulfilled(order, result.granted);
    return result;
  };
  const settleTx = (order: Order, pay: Payment, channel: Channel): Promise<Settled> =>
    atomic(db, async (u): Promise<Settled> => {
      const [product] = await db.select().from(products).where(eq(products.id, order.productId));
      if (product && product.perUserLimit !== null) {
        const n = await paidCount(order.userId, order.productId);
        if (n >= product.perUserLimit) return { ok: false as const, reason: 'PER_USER_LIMIT' as const };
        // 같은 상품을 다른 주문으로 동시에 확정하는 경우 — 실행 시점에도 한도 안이어야 한다
        u.expect(
          sql`(select count(*) from ${orders} where ${orders.userId} = ${order.userId} and ${orders.productId} = ${order.productId} and ${orders.status} = 'paid') < ${product.perUserLimit}`,
        );
      }
      const current = await orderStatus(order.id);
      if (current !== 'pending' && current !== 'failed') return { ok: false as const, reason: 'ALREADY_SETTLED' as const };
      expectOrderStatus(u, order.id, ['pending', 'failed']);
      u.write(
        db
          .update(orders)
          .set({ status: 'paid', providerPaymentKey: pay.paymentKey ?? order.providerPaymentKey, method: pay.method ?? order.method, paidAt: pay.paidAt, failureReason: null, updatedAt: Date.now() })
          .where(and(eq(orders.id, order.id), inArray(orders.status, ['pending', 'failed']))),
      );
      return { ok: true as const, granted: await fulfill(u, order, channel) };
    });

  /** pending 일 때만 실패로 표시(이미 paid 된 주문을 덮어쓰지 않음) */
  const failIfPending = async (orderId: string, reason: string) => {
    await db.update(orders).set({ status: 'failed', failureReason: reason.slice(0, 300), updatedAt: Date.now() }).where(and(eq(orders.id, orderId), eq(orders.status, 'pending')));
  };

  const EMPTY_GRANT = { credits: 0, entitlements: [] as string[], premiumUntil: null };

  const balance = async (userId: string) => (await db.select({ credits: users.credits }).from(users).where(eq(users.id, userId)))[0]?.credits ?? 0;

  // ── 웹훅·스토어 알림 이벤트 기록 (webhook_events, 멱등) ─────────────
  /** 처리 완료된 이벤트면 true. 처음 보는 이벤트는 기록해 둔다 — 처리 중 오류로 끝나면 재전송 때 다시 처리 */
  const alreadyProcessed = async (key: string, provider: string, type: string, payload: unknown): Promise<boolean> => {
    const [seen] = await db.select({ processedAt: webhookEvents.processedAt }).from(webhookEvents).where(eq(webhookEvents.id, key));
    if (seen?.processedAt) return true;
    if (!seen) await db.insert(webhookEvents).values({ id: key, provider, eventType: type, payload: (payload ?? {}) as object }).onConflictDoNothing();
    return false;
  };
  const markProcessed = async (key: string) => {
    await db.update(webhookEvents).set({ processedAt: Date.now() }).where(eq(webhookEvents.id, key));
  };
  /**
   * 스토어·결제사가 무효화(환불·취소)한 거래 표시 — 앱이 검증하기 전에(또는 결제 완료 알림보다 먼저) 환불된 구매를 나중에 지급하지 않도록.
   * payload 를 뒤지지 않고 기본 키(provider:voided:거래 키)로 바로 찾는다
   */
  const voidedKey = (provider: string, transactionId: string) => `${provider}:voided:${transactionId}`;
  const isVoided = async (provider: string, transactionId: string) => (await db.select({ id: webhookEvents.id }).from(webhookEvents).where(eq(webhookEvents.id, voidedKey(provider, transactionId)))).length > 0;

  return {
    getProduct,
    productDto,
    orderDto,
    /** 토스 인앱 결제(tossIap.ts)가 같은 검증·지급·회수 흐름을 쓰도록 내어 주는 내부 도구 */
    internals: { getProduct, paidCount, assertOwnedProfile, assertReading, getOwnedOrder, settle, failIfPending, revokeOrder, balance, emptyGrant: EMPTY_GRANT },

    async listProducts(userId?: string): Promise<ProductDto[]> {
      const rows = await db.select().from(products).where(eq(products.active, true)).orderBy(asc(products.sortOrder));
      return Promise.all(rows.map((p) => productDto(p, userId)));
    },

    /** 주문 생성 → 결제창 파라미터 반환 */
    async createOrder(userId: string, dto: OrderCreateDto): Promise<CheckoutDto> {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) throw notFound('사용자를 찾을 수 없어요.');
      if (user.provider === 'guest') throw new AppError(403, ERROR_CODES.FORBIDDEN, '구매 내역을 안전하게 보관하려면 로그인이 필요해요.', { reason: 'LOGIN_REQUIRED' });
      const product = await getProduct(dto.productId);
      if (product.comingSoon) throw badRequest('곧 출시될 상품이에요.');
      if (product.perUserLimit !== null && (await paidCount(userId, product.id)) >= product.perUserLimit) throw conflict('이미 구매한 상품이에요. (계정당 1회)');
      if (requiresProfile(product)) {
        if (!dto.profileId) throw badRequest('리포트를 받을 프로필을 선택해 주세요.');
        await assertOwnedProfile(userId, dto.profileId);
      }
      if (dto.partnerProfileId) await assertOwnedProfile(userId, dto.partnerProfileId);
      await assertReading(userId, product, dto.readingId);

      const gateway = gateways.active;
      if (!gateway.isConfigured()) throw notConfigured('결제', gateway.envKeys);
      // 링크형 결제사(그로블)는 상품마다 결제창이 따로 있어야 한다 — 연결 안 된 상품은 주문을 만들기 전에 막는다
      if (gateway.checkoutUrl && !gateway.productRef?.(product.id)) throw notConfigured(`${product.name} 결제창`, gateway.envKeys);

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
      await db.insert(orders).values(order);
      const saved = await getOwnedOrder(userId, order.id);
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
          redirectUrl: gateway.checkoutUrl?.(product.id, saved.id) ?? undefined,
        },
      };
    },

    async listOrders(userId: string): Promise<OrderDto[]> {
      return (await db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.createdAt))).map(orderDto);
    },

    async getOrder(userId: string, orderId: string): Promise<OrderDto> {
      return orderDto(await getOwnedOrder(userId, orderId));
    },

    /** 결제 승인 — 금액 검증 → 결제사 승인 → 지급 (멱등) */
    async confirmPayment(userId: string, input: { orderId: string; amount: number; paymentKey?: string }): Promise<PaymentResultDto> {
      const order = await getOwnedOrder(userId, input.orderId);
      const already = async () => ({ order: orderDto(await getOwnedOrder(userId, order.id)), granted: EMPTY_GRANT, creditsBalance: await balance(userId) });
      if (order.status === 'paid') return already();
      if (order.status !== 'pending') throw conflict('이미 처리된 주문이에요.');
      if (input.amount !== order.amount) {
        await failIfPending(order.id, 'AMOUNT_MISMATCH');
        throw badRequest('결제 금액이 주문 금액과 달라요. 다시 시도해 주세요.');
      }
      const gateway = gateways.byId[order.provider as keyof Gateways['byId']];
      if (!gateway) throw badRequest('지원하지 않는 결제 수단이에요.');
      let confirmed;
      try {
        confirmed = await gateway.confirm({ orderId: order.id, amount: order.amount, paymentKey: input.paymentKey ?? '' });
      } catch (e) {
        if (e instanceof GatewayError) {
          await failIfPending(order.id, `${e.code}: ${e.message}`);
          // 동시 요청 중 다른 요청이 이미 확정했다면 실패가 아니라 완료로 응답
          if ((await getOwnedOrder(userId, order.id)).status === 'paid') return already();
          throw new AppError(402, ERROR_CODES.PAYMENT_FAILED, e.message, { code: e.code });
        }
        throw e;
      }
      if (confirmed.totalAmount !== order.amount) {
        await gateway.cancel({ paymentKey: confirmed.paymentKey, reason: '결제 금액 불일치' }).catch(() => undefined);
        await failIfPending(order.id, 'AMOUNT_MISMATCH_AFTER_CONFIRM');
        throw badRequest('결제 금액 검증에 실패해 결제를 취소했어요.');
      }
      const settled = await settle(order, { paymentKey: confirmed.paymentKey, method: confirmed.method, paidAt: confirmed.approvedAt }, 'web');
      if (!settled.ok) {
        if (settled.reason === 'PER_USER_LIMIT') {
          await gateway.cancel({ paymentKey: confirmed.paymentKey, reason: '계정당 구매 한도 초과' }).catch(() => undefined);
          await db.update(orders).set({ status: 'canceled', canceledAt: Date.now(), failureReason: 'PER_USER_LIMIT', updatedAt: Date.now() }).where(and(eq(orders.id, order.id), inArray(orders.status, ['pending', 'failed'])));
          throw conflict('이미 구매한 상품이라 결제를 취소했어요. (계정당 1회)');
        }
        return already();
      }
      return { order: orderDto(await getOwnedOrder(userId, order.id)), granted: settled.granted, creditsBalance: await balance(userId) };
    },

    /** 결제창에서 사용자가 취소/실패한 경우 */
    async markFailed(userId: string, orderId: string, reason: string) {
      const order = await getOwnedOrder(userId, orderId);
      if (order.status === 'pending') await failIfPending(order.id, reason);
      return orderDto(await getOwnedOrder(userId, orderId));
    },

    /** 앱 인앱결제 영수증 검증 → 주문 생성 + 지급 (거래 ID 로 멱등) */
    async verifyIap(userId: string, input: { platform: 'ios' | 'android'; productId: string; receipt: string; profileId?: string; readingId?: string }): Promise<PaymentResultDto> {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user || user.provider === 'guest') throw forbidden('구매 내역을 안전하게 보관하려면 로그인이 필요해요.');
      const verifier = gateways.iap[input.platform];
      if (!verifier.isConfigured()) throw notConfigured(input.platform === 'ios' ? 'App Store 결제' : 'Google Play 결제', verifier.envKeys);
      const [product] = await db
        .select()
        .from(products)
        .where(input.platform === 'ios' ? eq(products.iosProductId, input.productId) : eq(products.androidProductId, input.productId));
      if (!product) throw notFound('스토어 상품과 연결된 상품이 없어요.');
      if (requiresProfile(product)) {
        if (!input.profileId) throw badRequest('리포트를 받을 프로필을 선택해 주세요.');
        await assertOwnedProfile(userId, input.profileId);
      }
      await assertReading(userId, product, input.readingId);
      let v;
      try {
        v = await verifier.verify({ productId: input.productId, receipt: input.receipt });
      } catch (e) {
        if (e instanceof GatewayError) throw new AppError(402, ERROR_CODES.PAYMENT_FAILED, e.message);
        throw e;
      }
      const provider = input.platform === 'ios' ? 'iap_apple' : 'iap_google';
      const [existing] = await db.select().from(orders).where(and(eq(orders.provider, provider), eq(orders.providerPaymentKey, v.transactionId)));
      if (existing) {
        if (existing.userId !== userId) throw conflict('다른 계정에서 이미 사용된 구매예요.');
        return { order: orderDto(existing), granted: { credits: 0, entitlements: [], premiumUntil: null }, creditsBalance: await balance(userId) };
      }
      if (await isVoided(provider, v.transactionId)) throw new AppError(402, ERROR_CODES.PAYMENT_FAILED, '환불되었거나 취소된 구매예요.', { code: 'REVOKED' });
      const id = newOrderId();
      try {
        await db
          .insert(orders)
          .values({ id, userId, productId: product.id, orderName: product.name, amount: currentPrice(product), status: 'pending', provider, providerPaymentKey: v.transactionId, method: 'IAP', metadata: { profileId: input.profileId, readingId: input.readingId } });
      } catch {
        // 같은 거래가 동시에 검증되는 경우(유니크 인덱스) — 먼저 들어간 요청이 처리한다
        const [dup] = await db.select().from(orders).where(and(eq(orders.provider, provider), eq(orders.providerPaymentKey, v.transactionId)));
        if (dup && dup.userId === userId) return { order: orderDto(dup), granted: EMPTY_GRANT, creditsBalance: await balance(userId) };
        throw conflict('다른 계정에서 이미 사용된 구매예요.');
      }
      const [order] = await db.select().from(orders).where(eq(orders.id, id));
      const settled = await settle(order!, { paymentKey: v.transactionId, method: 'IAP', paidAt: v.purchasedAt }, input.platform);
      if (!settled.ok && settled.reason === 'PER_USER_LIMIT') {
        await failIfPending(id, 'PER_USER_LIMIT');
        throw conflict('이미 구매한 상품이에요. (계정당 1회) 스토어 결제는 완료 처리되지 않아 자동 환불돼요.');
      }
      const granted = settled.ok ? settled.granted : EMPTY_GRANT;
      return { order: orderDto(await getOwnedOrder(userId, id)), granted, creditsBalance: await balance(userId) };
    },

    /** 결제사 웹훅 처리 (가상계좌 입금, 결제 취소 등 비동기 상태 변경) */
    async handleWebhook(providerId: string, headers: Record<string, string | string[] | undefined>, rawBody: string) {
      const gateway = gateways.byId[providerId as keyof Gateways['byId']];
      if (!gateway || (providerId === 'mock' && config.isProd)) throw notFound('알 수 없는 결제사예요.');
      const event = await gateway.parseWebhook({ headers, rawBody });
      if (!event) throw badRequest('웹훅 검증에 실패했어요.');
      const eventKey = `${providerId}:${event.id}`;
      if (await alreadyProcessed(eventKey, providerId, event.type, event.raw)) return { duplicate: true };
      const found = event.orderId
        ? (await db.select().from(orders).where(eq(orders.id, event.orderId)))[0]
        : event.paymentKey
          ? // 우리 주문 ID 없이 결제사 결제 키만 오는 알림(그로블 payment.refunded) — 완료 때 저장한 키로 찾는다
            (await db.select().from(orders).where(and(eq(orders.provider, providerId), eq(orders.providerPaymentKey, event.paymentKey))))[0]
          : undefined;
      // 다른 결제사로 생성된 주문은 이 웹훅으로 상태를 바꿀 수 없다(목업·타 PG 웹훅 위조 방지)
      const order = found && found.provider === providerId ? found : undefined;
      if (!order && event.status === 'paid') {
        // ref 없이 결제 링크로 바로 산 경우 등 — 운영자가 결제사 화면에서 확인해 처리한다.
        // (우리 주문이 없는 환불 알림은 같은 계정을 쓰는 다른 서비스의 것일 수 있어 경고하지 않는다)
        console.warn(`[commerce] 주문을 찾지 못한 결제 웹훅 (${providerId} ${event.type} order=${event.orderId ?? '-'} key=${event.paymentKey ?? '-'})`);
      }
      const voids = event.status === 'canceled' || event.status === 'refunded';
      if (voids && !event.partial && event.paymentKey && order?.status !== 'paid') {
        // 결제 완료 알림보다 먼저 온 전액 환불·취소 — 주문을 찾지 못했거나 아직 지급 전이다.
        // 나중에 같은 결제(결제 키)의 완료 알림이 와도 지급하지 않도록 표시해 둔다(인앱결제 voidedKey 와 같은 장치)
        await db
          .insert(webhookEvents)
          .values({ id: voidedKey(providerId, event.paymentKey), provider: providerId, eventType: 'VOIDED', payload: { event: event.id, type: event.type }, processedAt: Date.now() })
          .onConflictDoNothing();
      }
      if (order && voids && order.status === 'paid') {
        if (event.partial) {
          // 부분 환불(질문권 팩 미사용분 등) — 얼마나 회수할지는 운영자가 정한다. 기록만 남긴다
          console.warn(`[commerce] 부분 환불 웹훅 — 자동 회수하지 않음 (${providerId} order=${order.id} amount=${event.amount ?? '-'})`);
        } else {
          // 결제사 관리자 화면 등에서 취소·환불된 경우에도 지급분을 회수한다
          await atomic(db, (u) => revokeOrder(u, order, event.status === 'refunded' ? 'refunded' : 'canceled', `웹훅(${event.type})`));
        }
      } else if (order && event.status === 'paid' && (order.status === 'pending' || order.status === 'failed')) {
        // 승인 응답 유실 등으로 지급되지 않은 결제를 복구(그로블은 이것이 유일한 확정 경로)
        // — 결제사가 확인한 금액과 상품(결제창)이 주문과 같고, 이 결제의 환불·취소 알림이 먼저 오지 않았을 때만
        if (event.paymentKey && (await isVoided(providerId, event.paymentKey))) {
          // 알림 순서가 뒤바뀐 경우(그로블은 순서를 보장하지 않는다) — 이미 환불된 결제라 지급하지 않고 환불로 닫는다
          await db
            .update(orders)
            .set({ status: 'refunded', canceledAt: Date.now(), failureReason: 'REFUNDED_BEFORE_PAID', providerPaymentKey: event.paymentKey, updatedAt: Date.now() })
            .where(and(eq(orders.id, order.id), inArray(orders.status, ['pending', 'failed'])));
          console.warn(`[commerce] 환불·취소 알림이 먼저 온 결제라 지급하지 않음 (${providerId} order=${order.id} key=${event.paymentKey})`);
          await markProcessed(eventKey);
          return { duplicate: false };
        }
        const expectedRef = gateway.productRef?.(order.productId);
        const mismatch =
          event.amount !== order.amount
            ? `WEBHOOK_AMOUNT_MISMATCH: ${event.amount ?? 'unknown'} != ${order.amount}`
            : expectedRef !== undefined && event.productRef !== expectedRef
              ? `WEBHOOK_PRODUCT_MISMATCH: ${event.productRef ?? 'unknown'} != ${expectedRef ?? 'unlinked'}`
              : null;
        if (mismatch) {
          if (event.paymentKey) await gateway.cancel({ paymentKey: event.paymentKey, reason: '결제 금액·상품 불일치' }).catch(() => undefined);
          // 결제사 결제 키를 남겨 둔다 — 자동 취소가 안 되는 결제사(그로블)는 운영자가 이 키로 찾아 환불한다
          await db
            .update(orders)
            .set({ status: 'failed', failureReason: mismatch, providerPaymentKey: event.paymentKey ?? order.providerPaymentKey, updatedAt: Date.now() })
            .where(eq(orders.id, order.id));
          console.warn(`[commerce] 결제 웹훅 불일치로 지급하지 않음 (${providerId} order=${order.id} ${mismatch})`);
          await markProcessed(eventKey);
          return { duplicate: false };
        }
        const settled = await settle(order, { paymentKey: event.paymentKey, method: null, paidAt: Date.now() }, 'web');
        if (!settled.ok && settled.reason === 'PER_USER_LIMIT') {
          if (event.paymentKey) await gateway.cancel({ paymentKey: event.paymentKey, reason: '계정당 구매 한도 초과' }).catch(() => undefined);
          // 자동 취소가 안 되는 결제사(그로블)도 있으니 결제 키와 사유를 남겨 운영자가 환불할 수 있게 한다
          await db
            .update(orders)
            .set({ status: 'failed', failureReason: 'PER_USER_LIMIT', providerPaymentKey: event.paymentKey ?? order.providerPaymentKey, updatedAt: Date.now() })
            .where(and(eq(orders.id, order.id), inArray(orders.status, ['pending', 'failed'])));
        }
      }
      await markProcessed(eventKey);
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
      if (await alreadyProcessed(eventKey, provider, n.type, n.raw)) return { duplicate: true, type: n.type, applied: false };

      let applied = false;
      if (n.action !== 'none' && n.transactionIds.length > 0) {
        const [order] = await db.select().from(orders).where(and(eq(orders.provider, provider), inArray(orders.providerPaymentKey, n.transactionIds)));
        applied = await atomic(db, async (u) => {
          let changed = false;
          if (n.action === 'revoke') {
            if (order) changed = await revokeOrder(u, order, n.revokeStatus ?? 'refunded', n.reason);
            // 앱이 아직 검증(/payments/iap/verify)하지 않은 구매도 있다 — 나중에 검증 요청이 와도 지급하지 않도록 표시
            for (const txId of n.transactionIds) {
              u.write(db.insert(webhookEvents).values({ id: voidedKey(provider, txId), provider, eventType: 'VOIDED', payload: { notification: n.id, reason: n.reason }, processedAt: Date.now() }).onConflictDoNothing());
            }
          } else {
            if (order) changed = await restoreOrder(u, order);
            for (const txId of n.transactionIds) u.write(db.delete(webhookEvents).where(eq(webhookEvents.id, voidedKey(provider, txId))));
          }
          return changed;
        });
      }
      await markProcessed(eventKey);
      return { duplicate: false, type: n.type, applied };
    },

    /** 환불 — 결제사 취소 후 지급분 회수 (관리자/CS 용) */
    async refund(orderId: string, reason: string) {
      const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
      if (!order) throw notFound('주문을 찾을 수 없어요.');
      if (order.status !== 'paid') throw conflict('결제 완료된 주문만 환불할 수 있어요.');
      // 스토어 환불은 스토어 서버 알림(handleStoreNotification)으로 같은 revokeOrder 가 적용된다
      if (order.provider.startsWith('iap_')) throw badRequest('인앱결제는 스토어(App Store/Google Play)에서 환불이 진행돼요.');
      // 그로블은 환불 API 가 없다 — 판매자 화면에서 환불하면 payment.refunded 웹훅으로 같은 revokeOrder 가 적용된다
      if (order.provider === 'groble') throw badRequest('그로블 결제는 그로블 판매자 화면에서 환불해 주세요. 환불되면 지급분이 자동으로 회수돼요.');
      const gateway = gateways.byId[order.provider as keyof Gateways['byId']];
      // 질문권 팩은 미사용 유상 질문권 비율만큼만 부분 환불 (PAYMENTS.md 환불 정책)
      const [product] = await db.select().from(products).where(eq(products.id, order.productId));
      let cancelAmount: number | undefined;
      if (product?.type === 'credit_pack' && product.credits > 0) {
        const paid = (await db.select({ paidCredits: users.paidCredits }).from(users).where(eq(users.id, order.userId)))[0]?.paidCredits ?? 0;
        const unused = Math.min(product.credits, paid);
        if (unused === 0) throw conflict('이미 모두 사용한 질문권은 환불할 수 없어요.');
        if (unused < product.credits) cancelAmount = Math.floor((order.amount * unused) / product.credits);
      }
      if (order.providerPaymentKey) await gateway.cancel({ paymentKey: order.providerPaymentKey, reason, amount: cancelAmount });
      await atomic(db, (u) => revokeOrder(u, order, 'refunded', reason));
      return orderDto((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!);
    },

    // ── 권한 ───────────────────────────────────────────────────
    setReadingCheck(fn: ReadingCheck) {
      readingCheck = fn;
    },
    setFulfilledListener(fn: FulfilledListener) {
      fulfilledListener = fn;
    },
    /** 특정 grant(예: taekil:reading)를 가진 상품의 결과 소유·상품 일치 확인 */
    setGrantReadingCheck(grant: string, fn: ReadingCheck) {
      grantReadingChecks.set(grant, fn);
    },

    async hasEntitlement(userId: string, key: string): Promise<boolean> {
      const now = Date.now();
      const [row] = await db.select().from(entitlements).where(and(eq(entitlements.userId, userId), eq(entitlements.key, key)));
      return Boolean(row && (row.expiresAt === null || row.expiresAt > now));
    },
    async isPremium(userId: string): Promise<boolean> {
      const [u] = await db.select({ premiumUntil: users.premiumUntil }).from(users).where(eq(users.id, userId));
      return Boolean(u?.premiumUntil && u.premiumUntil > Date.now());
    },
    /** 1회권(ticket) 사용 → 실제 권한으로 전환. 사용 가능한 티켓이 없으면 false */
    async redeemTicket(userId: string, kind: 'compatibility', newKey: string): Promise<boolean> {
      return atomic(db, async (u) => {
        const [ticket] = await db
          .select()
          .from(entitlements)
          .where(and(eq(entitlements.userId, userId), like(entitlements.key, `ticket:${kind}:%`)))
          .orderBy(asc(entitlements.createdAt))
          .limit(1);
        if (!ticket) return false;
        // 같은 1회권을 두 요청이 함께 쓰지 않게 — 실행 시점에도 남아 있어야 한다(먼저 쓴 요청이 있으면 다음 1회권으로 다시)
        u.expect(sql`exists (select 1 from ${entitlements} where ${entitlements.id} = ${ticket.id})`);
        u.write(db.delete(entitlements).where(eq(entitlements.id, ticket.id)));
        grantEntitlement(u, userId, newKey, ticket.orderId);
        return true;
      });
    },
    async ticketCount(userId: string, kind: 'compatibility'): Promise<number> {
      return (await db.select({ id: entitlements.id }).from(entitlements).where(and(eq(entitlements.userId, userId), like(entitlements.key, `ticket:${kind}:%`)))).length;
    },

    // ── 질문권 ─────────────────────────────────────────────────
    /** 무상분부터 차감(유상분은 환불 대상으로 최대한 보존) */
    async consumeCredits(userId: string, amount: number, memo: string, refId?: string): Promise<number> {
      await atomic(db, async (u) => {
        const [w] = await db.select({ credits: users.credits, paidCredits: users.paidCredits }).from(users).where(eq(users.id, userId));
        if (!w) throw notFound('사용자를 찾을 수 없어요.');
        if (w.credits < amount) throw insufficientCredits(amount, w.credits);
        const fromFree = Math.min(w.credits - w.paidCredits, amount);
        const fromPaid = amount - fromFree;
        // 나눈 몫이 실행 시점에도 그대로 남아 있어야 한다 — 동시 차감으로 줄었으면 다시 읽고 계산(모자라면 위에서 402)
        u.expect(
          sql`exists (select 1 from ${users} where ${users.id} = ${userId} and ${users.credits} - ${users.paidCredits} >= ${fromFree} and ${users.paidCredits} >= ${fromPaid})`,
        );
        if (fromFree > 0) addCredits(u, userId, -fromFree, { reason: 'consume', source: 'free', channel: 'system', memo, refType: 'chat', refId });
        if (fromPaid > 0) addCredits(u, userId, -fromPaid, { reason: 'consume', source: 'paid', channel: 'system', memo, refType: 'chat', refId });
      });
      return balance(userId);
    },
    /**
     * AI 장애로 답하지 못한 상담·꿈풀이의 질문권 환급(무상) — 사용자마다 하루(KST) AI_REFUND_DAILY_LIMIT 번까지.
     * 원장의 환급 기록(refType=ai_refund)으로 세고, 묶음 실행 시점에도 상한 안인지 다시 확인한다(동시 요청으로 넘지 않게).
     * 돌려줬으면 true, 상한에 걸리면 false(차감한 채로 둔다)
     */
    async refundAiFailure(userId: string, amount: number, memo: string, refId?: string): Promise<boolean> {
      const since = startOfSeoulDay();
      const todayRefunds = and(eq(creditLedger.userId, userId), eq(creditLedger.refType, AI_REFUND_REF), gte(creditLedger.createdAt, since));
      return atomic(db, async (u) => {
        const used = (await db.select({ n: count() }).from(creditLedger).where(todayRefunds))[0]?.n ?? 0;
        if (used >= AI_REFUND_DAILY_LIMIT) return false;
        u.expect(sql`(select count(*) from ${creditLedger} where ${todayRefunds}) < ${AI_REFUND_DAILY_LIMIT}`);
        addCredits(u, userId, amount, { reason: 'bonus', source: 'free', channel: 'system', memo, refType: AI_REFUND_REF, refId });
        return true;
      });
    },
    async grantFreeCredits(userId: string, amount: number, memo: string): Promise<number> {
      if (!(await db.select({ id: users.id }).from(users).where(eq(users.id, userId))).length) throw notFound('사용자를 찾을 수 없어요.');
      await atomic(db, async (u) => addCredits(u, userId, amount, { reason: 'bonus', source: 'free', channel: 'system', memo }));
      return balance(userId);
    },
    async wallet(userId: string): Promise<WalletDto> {
      const [u] = await db.select({ credits: users.credits, paidCredits: users.paidCredits }).from(users).where(eq(users.id, userId));
      if (!u) throw notFound('사용자를 찾을 수 없어요.');
      const ledger = await db.select().from(creditLedger).where(eq(creditLedger.userId, userId)).orderBy(desc(creditLedger.createdAt)).limit(100);
      const ents = await db.select().from(entitlements).where(eq(entitlements.userId, userId)).orderBy(desc(entitlements.createdAt));
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
