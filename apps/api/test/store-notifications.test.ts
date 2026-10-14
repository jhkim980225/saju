/**
 * 스토어 서버 알림 — Apple JWS 인증서 체인 검증, App Store Server Notifications V2, Google Play RTDN(Pub/Sub 푸시).
 * Apple 은 가짜 루트/중간/리프 체인(test/helpers/appleChain.ts)을, Google 은 로컬 JWKS 를 주입한다. 외부 호출 없음.
 */
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { orders, webhookEvents } from '../src/db/schema.js';
import { seedProducts } from '../src/db/seed.js';
import { AppError } from '../src/lib/errors.js';
import {
  APPLE_ROOT_CA_G3_SHA256,
  AppleJwsError,
  appleRootCertificates,
  certificateExtensionOids,
  verifyAppleJws,
} from '../src/modules/commerce/providers/appleJws.js';
import { createMockIapVerifier } from '../src/modules/commerce/providers/mock.js';
import { createAppleNotificationSource } from '../src/modules/commerce/providers/storeNotifications.js';
import { createAppleTestChain, type AppleTestChain } from './helpers/appleChain.js';

const BUNDLE = 'kr.example.saju';
const PACKAGE = 'kr.example.saju';
const RTDN_AUDIENCE = 'https://api.example.com/api/v1/payments/iap/notifications/google';
const RTDN_SA = 'rtdn-push@saju-test.iam.gserviceaccount.com';

const storeEnv = {
  APPLE_IAP_ISSUER_ID: '57246542-96fe-1a63-e053-0824d011072a',
  APPLE_IAP_KEY_ID: 'ABC123DEFG',
  // 알림 처리는 App Store Server API 를 호출하지 않으므로 키 내용은 쓰이지 않는다
  APPLE_IAP_PRIVATE_KEY: 'unused-in-notification-tests',
  APPLE_BUNDLE_ID: BUNDLE,
  GOOGLE_PLAY_PACKAGE_NAME: PACKAGE,
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: '{"unused":true}',
  GOOGLE_PLAY_RTDN_AUDIENCE: RTDN_AUDIENCE,
  GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT: RTDN_SA,
};
const cfg = (env: Record<string, string> = {}) =>
  loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: '', SIGNUP_BONUS_CREDITS: '0', ...env });

const caught = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('예외가 발생하지 않았어요');
};
const rejectReason = async (p: Promise<unknown>) => {
  const e = await caught(p);
  expect(e).toBeInstanceOf(AppleJwsError);
  return (e as AppleJwsError).reason;
};

const chain = createAppleTestChain();

// ── Apple JWS 체인 검증 ───────────────────────────────────────

describe('Apple JWS 인증서 체인 검증 (verifyAppleJws)', () => {
  const roots = [chain.root];

  it('내장 Apple Root CA - G3 — 지문·주체·CA·유효기간 확인', () => {
    const [root] = appleRootCertificates();
    expect(root!.fingerprint256).toBe(APPLE_ROOT_CA_G3_SHA256);
    expect(root!.subject).toContain('CN=Apple Root CA - G3');
    expect(root!.ca).toBe(true);
    expect(root!.validToDate.getUTCFullYear()).toBe(2039);
    expect(root!.publicKey.asymmetricKeyDetails?.namedCurve).toBe('secp384r1');
    // DER 파서가 실제 Apple 인증서의 확장도 읽는다 (basicConstraints · keyUsage · SKI)
    expect(certificateExtensionOids(root!.raw)).toEqual(expect.arrayContaining(['2.5.29.19', '2.5.29.15', '2.5.29.14']));
  });

  it('정상 체인(루트 → 중간 → 리프) + 리프 키 ES256 서명이면 페이로드를 돌려준다', async () => {
    const jws = await chain.sign({ transactionId: '1', bundleId: BUNDLE });
    await expect(verifyAppleJws(jws, { trustedRoots: roots })).resolves.toEqual({ transactionId: '1', bundleId: BUNDLE });
  });

  it('신뢰 루트가 다르면 거절 — 기본값(실제 Apple 루트)에서도 가짜 체인은 거절', async () => {
    const jws = await chain.sign({ a: 1 });
    expect(await rejectReason(verifyAppleJws(jws, { trustedRoots: [createAppleTestChain().root] }))).toMatch(/신뢰 루트/);
    expect(await rejectReason(verifyAppleJws(jws))).toMatch(/신뢰 루트/);
  });

  it('x5c 의 세 번째(루트) 인증서는 믿지 않는다 — 공격자 체인을 통째로 넣어도 거절', async () => {
    const attacker = createAppleTestChain();
    const jws = await attacker.sign({ a: 1 }, { x5c: [attacker.x5c[0]!, attacker.x5c[1]!, chain.x5c[2]!] });
    expect(await rejectReason(verifyAppleJws(jws, { trustedRoots: roots }))).toMatch(/신뢰 루트/);
  });

  it('만료된 리프 인증서는 거절, 판정 시각(now)을 바꾸면 중간·루트 유효기간도 본다', async () => {
    const expired = createAppleTestChain({ leafNotBefore: new Date(Date.now() - 30 * 86_400_000), leafNotAfter: new Date(Date.now() - 86_400_000) });
    const jws = await expired.sign({ a: 1 });
    expect(await rejectReason(verifyAppleJws(jws, { trustedRoots: [expired.root] }))).toMatch(/리프 인증서 유효기간/);
    const ok = await chain.sign({ a: 1 });
    expect(await rejectReason(verifyAppleJws(ok, { trustedRoots: roots, now: new Date(Date.now() + 20 * 365 * 86_400_000) }))).toMatch(/유효기간/);
  });

  it('서명이 리프 키와 맞지 않으면 거절 (다른 키로 서명 / 페이로드 변조)', async () => {
    const otherKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    expect(await rejectReason(verifyAppleJws(await chain.sign({ a: 1 }, { key: otherKey }), { trustedRoots: roots }))).toMatch(/서명/);

    const [h, , s] = (await chain.sign({ productId: 'cheap' })).split('.');
    const tampered = `${h}.${Buffer.from(JSON.stringify({ productId: 'expensive' })).toString('base64url')}.${s}`;
    expect(await rejectReason(verifyAppleJws(tampered, { trustedRoots: roots }))).toMatch(/서명/);
  });

  it('Apple 표식 OID 가 없는 리프·중간 인증서는 거절', async () => {
    const noLeafOid = createAppleTestChain({ omitLeafOid: true });
    expect(await rejectReason(verifyAppleJws(await noLeafOid.sign({ a: 1 }), { trustedRoots: [noLeafOid.root] }))).toMatch(/리프 인증서에 App Store 서명 표식/);
    const noInterOid = createAppleTestChain({ omitIntermediateOid: true });
    expect(await rejectReason(verifyAppleJws(await noInterOid.sign({ a: 1 }), { trustedRoots: [noInterOid.root] }))).toMatch(/중간 인증서에 Apple WWDR 표식/);
  });

  it('x5c 가 3장이 아니거나 형식이 다르면 거절', async () => {
    expect(await rejectReason(verifyAppleJws(await chain.sign({ a: 1 }, { x5c: chain.x5c.slice(0, 2) }), { trustedRoots: roots }))).toMatch(/3장/);
    expect(await rejectReason(verifyAppleJws('not-a-jws', { trustedRoots: roots }))).toMatch(/형식/);
    const hs = await new SignJWT({ a: 1 }).setProtectedHeader({ alg: 'HS256', x5c: chain.x5c }).sign(new Uint8Array(32));
    expect(await rejectReason(verifyAppleJws(hs, { trustedRoots: roots }))).toMatch(/alg/);
  });
});

// ── Apple 알림 파서 ───────────────────────────────────────────

/** Apple 이 보낸 것처럼 서명한 알림 signedPayload */
async function appleNotification(
  type: string,
  opts: { uuid?: string; subtype?: string; txId?: string; tx?: Record<string, unknown> | null; bundleId?: string; environment?: string; signer?: AppleTestChain; data?: Record<string, unknown> } = {},
) {
  const signer = opts.signer ?? chain;
  const environment = opts.environment ?? 'Production';
  const signedTransactionInfo =
    opts.tx === null
      ? undefined
      : await signer.sign({
          transactionId: opts.txId ?? '2000000000000001',
          originalTransactionId: opts.txId ?? '2000000000000001',
          bundleId: BUNDLE,
          productId: 'kr.dalbitsaju.report.lifetime',
          purchaseDate: Date.now() - 3_600_000,
          type: 'Consumable',
          inAppOwnershipType: 'PURCHASED',
          environment,
          ...(type === 'REFUND' ? { revocationDate: Date.now(), revocationReason: 0 } : {}),
          ...opts.tx,
        });
  return signer.sign({
    notificationType: type,
    ...(opts.subtype ? { subtype: opts.subtype } : {}),
    notificationUUID: opts.uuid ?? randomUUID(),
    version: '2.0',
    signedDate: Date.now(),
    data: { appAppleId: 1234567890, bundleId: opts.bundleId ?? BUNDLE, bundleVersion: '1', environment, signedTransactionInfo, ...opts.data },
  });
}

describe('App Store Server Notifications V2 파서', () => {
  const source = (env: Record<string, string> = {}) => createAppleNotificationSource(cfg({ ...storeEnv, ...env }), { rootCertificates: [chain.root] });
  const statusOf = async (p: Promise<unknown>) => ((await caught(p)) as AppError).statusCode;

  it('REFUND → 회수(refunded), REVOKE → 회수(canceled), REFUND_REVERSED → 복구, 그 밖은 기록만', async () => {
    const parse = async (type: string) => source().parse({ headers: {}, body: { signedPayload: await appleNotification(type, { txId: '2000000000000777' }) } });
    expect(await parse('REFUND')).toMatchObject({ type: 'REFUND', action: 'revoke', revokeStatus: 'refunded', transactionIds: ['2000000000000777'] });
    expect(await parse('REVOKE')).toMatchObject({ action: 'revoke', revokeStatus: 'canceled' });
    expect(await parse('REFUND_REVERSED')).toMatchObject({ action: 'restore' });
    expect(await parse('REFUND_DECLINED')).toMatchObject({ action: 'none' });
    expect(await parse('CONSUMPTION_REQUEST')).toMatchObject({ action: 'none' });
  });

  it('다른 앱(bundleId)·위조 서명·내부 거래 위조는 400', async () => {
    expect(await statusOf(source().parse({ headers: {}, body: { signedPayload: await appleNotification('REFUND', { bundleId: 'com.other.app' }) } }))).toBe(400);
    expect(await statusOf(source().parse({ headers: {}, body: { signedPayload: await appleNotification('REFUND', { signer: createAppleTestChain() }) } }))).toBe(400);
    // 바깥 알림은 정상 서명이지만 안의 signedTransactionInfo 가 다른 체인으로 서명된 경우
    const forgedTx = await createAppleTestChain().sign({ transactionId: '1', bundleId: BUNDLE, environment: 'Production' });
    const outer = await chain.sign({ notificationType: 'REFUND', notificationUUID: randomUUID(), data: { bundleId: BUNDLE, environment: 'Production', signedTransactionInfo: forgedTx } });
    expect(await statusOf(source().parse({ headers: {}, body: { signedPayload: outer } }))).toBe(400);
    // 거래의 bundleId 가 다른 경우
    expect(await statusOf(source().parse({ headers: {}, body: { signedPayload: await appleNotification('REFUND', { tx: { bundleId: 'com.other.app' } }) } }))).toBe(400);
    expect(await statusOf(source().parse({ headers: {}, body: {} }))).toBe(400);
  });

  it('거래 environment 가 알림과 다르면 400, 이 서버가 받지 않는 환경의 알림은 기록만', async () => {
    expect(await statusOf(source().parse({ headers: {}, body: { signedPayload: await appleNotification('REFUND', { tx: { environment: 'Sandbox' } }) } }))).toBe(400);
    const staging = source({ APPLE_IAP_ENVIRONMENTS: 'Sandbox' });
    const n = await staging.parse({ headers: {}, body: { signedPayload: await appleNotification('REFUND') } });
    expect(n).toMatchObject({ action: 'none', raw: { ignored: 'ENVIRONMENT_NOT_ALLOWED' } });
  });
});

// ── 엔드포인트 (Apple + Google) ────────────────────────────────

describe('스토어 알림 엔드포인트', () => {
  let app: FastifyInstance;
  let token: string;
  let profileId: string;

  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherRsa = generateKeyPairSync('rsa', { modulusLength: 2048 });

  beforeAll(async () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    seedProducts(db);
    const jwk = { ...(await exportJWK(rsa.publicKey)), kid: 'google-test-kid', alg: 'RS256', use: 'sig' };
    app = await buildApp({
      config: cfg(storeEnv),
      db,
      logger: false,
      deps: {
        gateways: {
          appleRootCertificates: [chain.root],
          googleOidcKeys: createLocalJWKSet({ keys: [jwk] }),
          // 주문은 목업 영수증으로 만든다(스토어 API 호출 없이 iap_apple / iap_google 주문 생성)
          iap: { ios: createMockIapVerifier('ios'), android: createMockIapVerifier('android') },
        },
      },
    });
    const s = await api('POST', '/auth/signup', { body: { email: 'store@example.com', password: 'password123' } });
    token = s.body.accessToken;
    const p = await api('POST', '/profiles', { token, body: { name: '본인', relation: 'self', birth: { calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' } } });
    profileId = p.body.id;
  });
  afterAll(() => app.close());

  async function api(method: 'GET' | 'POST', url: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) },
      ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
    });
    return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null };
  }
  const wallet = async () => (await api('GET', '/wallet', { token })).body;
  const orderOf = (txId: string) => app.ctx.db.select().from(orders).where(eq(orders.providerPaymentKey, txId)).get()!;
  const event = (id: string) => app.ctx.db.select().from(webhookEvents).where(eq(webhookEvents.id, id)).get();
  const apple = async (signedPayload: string) => api('POST', '/payments/iap/notifications/apple', { body: { signedPayload } });

  it('키가 없으면 두 엔드포인트 모두 501 NOT_CONFIGURED', async () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const bare = await buildApp({ config: cfg(), db, logger: false });
    const a = await bare.inject({ method: 'POST', url: '/api/v1/payments/iap/notifications/apple', payload: { signedPayload: 'x.y.z' } });
    const g = await bare.inject({ method: 'POST', url: '/api/v1/payments/iap/notifications/google', payload: { message: { data: '', messageId: '1' } } });
    expect(a.statusCode).toBe(501);
    expect(g.statusCode).toBe(501);
    expect(JSON.parse(a.body).error.code).toBe('NOT_CONFIGURED');
    expect(JSON.parse(g.body).error.details.envKeys).toEqual(expect.arrayContaining(['GOOGLE_PLAY_RTDN_AUDIENCE', 'GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT']));
    await bare.close();
  });

  describe('Apple', () => {
    const TX = '2000000000000001';

    it('REFUND → 권한·질문권 회수, 주문 refunded (관리자 환불과 같은 경로)', async () => {
      const v = await api('POST', '/payments/iap/verify', { token, body: { platform: 'ios', productId: 'kr.dalbitsaju.report.lifetime', receipt: `mock:${TX}`, profileId } });
      expect(v.status).toBe(200);
      expect((await wallet()).entitlements.map((e: any) => e.key)).toContain(`report:lifetime:${profileId}`);
      expect((await wallet()).credits).toBe(3);

      const uuid = randomUUID();
      const r = await apple(await appleNotification('REFUND', { uuid, txId: TX }));
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ ok: true, duplicate: false, type: 'REFUND', applied: true });
      const w = await wallet();
      expect(w.entitlements.map((e: any) => e.key)).not.toContain(`report:lifetime:${profileId}`);
      expect(w.credits).toBe(0);
      expect(orderOf(TX).status).toBe('refunded');
      expect(orderOf(TX).failureReason).toContain('REFUND');

      // 같은 notificationUUID 재전송 → 중복, 두 번 회수하지 않는다
      const again = await apple(await appleNotification('REFUND', { uuid, txId: TX }));
      expect(again.body).toMatchObject({ duplicate: true, applied: false });
      expect((await wallet()).ledger.filter((l: any) => l.reason === 'refund')).toHaveLength(1);
      expect(event(`iap_apple:${uuid}`)?.processedAt).toBeTruthy();
    });

    it('UUID 가 다른 같은 환불 알림이 와도 회수는 1회 (주문 상태 조건부 회수)', async () => {
      const r = await apple(await appleNotification('REFUND', { txId: TX }));
      expect(r.body).toMatchObject({ duplicate: false, applied: false });
      expect((await wallet()).ledger.filter((l: any) => l.reason === 'refund')).toHaveLength(1);
    });

    it('REFUND_REVERSED → 권한과 회수한 질문권을 되돌린다', async () => {
      const r = await apple(await appleNotification('REFUND_REVERSED', { txId: TX }));
      expect(r.body).toMatchObject({ type: 'REFUND_REVERSED', applied: true });
      const w = await wallet();
      expect(w.entitlements.map((e: any) => e.key)).toContain(`report:lifetime:${profileId}`);
      expect(w.credits).toBe(3);
      expect(orderOf(TX).status).toBe('paid');
    });

    it('REVOKE(가족 공유 해제) → 회수, 주문 canceled', async () => {
      const tx = '2000000000000002';
      await api('POST', '/payments/iap/verify', { token, body: { platform: 'ios', productId: 'kr.dalbitsaju.chat.10', receipt: `mock:${tx}` } });
      const before = (await wallet()).credits;
      const r = await apple(await appleNotification('REVOKE', { txId: tx, tx: { productId: 'kr.dalbitsaju.chat.10', inAppOwnershipType: 'FAMILY_SHARED' } }));
      expect(r.body).toMatchObject({ type: 'REVOKE', applied: true });
      expect((await wallet()).credits).toBe(before - 10);
      expect(orderOf(tx).status).toBe('canceled');
    });

    it('앱이 검증하기 전에 환불된 구매는 나중에 검증을 요청해도 지급하지 않는다', async () => {
      const tx = '2000000000000099';
      const r = await apple(await appleNotification('REFUND', { txId: tx }));
      expect(r.body).toMatchObject({ applied: false });
      const v = await api('POST', '/payments/iap/verify', { token, body: { platform: 'ios', productId: 'kr.dalbitsaju.chat.10', receipt: `mock:${tx}` } });
      expect(v.status).toBe(402);
      expect(v.body.error.details.code).toBe('REVOKED');
    });

    it('모르는 유형·CONSUMPTION_REQUEST·TEST 는 기록만 하고 200', async () => {
      for (const [type, extra] of [['SOME_FUTURE_TYPE', {}], ['CONSUMPTION_REQUEST', { data: { consumptionRequestReason: 'UNINTENDED_PURCHASE' } }], ['TEST', { tx: null }]] as const) {
        const uuid = randomUUID();
        const r = await apple(await appleNotification(type, { uuid, txId: TX, ...extra }));
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ type, applied: false });
        const row = event(`iap_apple:${uuid}`)!;
        expect(row.eventType).toBe(type);
        expect(row.processedAt).toBeTruthy();
        if (type === 'CONSUMPTION_REQUEST') expect(row.payload).toMatchObject({ consumptionRequestReason: 'UNINTENDED_PURCHASE' });
      }
      expect(orderOf(TX).status).toBe('paid');
    });

    it('위조 서명·다른 앱 알림은 400 이고 아무것도 바꾸지 않는다', async () => {
      const forged = await apple(await appleNotification('REFUND', { txId: TX, signer: createAppleTestChain() }));
      expect(forged.status).toBe(400);
      expect(forged.body.error.message).toBe('스토어 알림 검증에 실패했어요.');
      expect((await apple(await appleNotification('REFUND', { txId: TX, bundleId: 'com.other.app' }))).status).toBe(400);
      expect(orderOf(TX).status).toBe('paid');
    });
  });

  describe('Google Play RTDN (Pub/Sub 푸시)', () => {
    const ORDER = 'GPA.1111-2222-3333-44444';
    const oidc = (claims: Record<string, unknown> = {}, opts: { aud?: string; key?: typeof rsa.privateKey; iss?: string } = {}) =>
      new SignJWT({ email: RTDN_SA, email_verified: true, ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'google-test-kid', typ: 'JWT' })
        .setIssuer(opts.iss ?? 'https://accounts.google.com')
        .setAudience(opts.aud ?? RTDN_AUDIENCE)
        .setSubject('109876543210987654321')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(opts.key ?? rsa.privateKey);
    const push = (notification: unknown, messageId = randomUUID()) => ({
      message: { data: Buffer.from(typeof notification === 'string' ? notification : JSON.stringify(notification)).toString('base64'), messageId, publishTime: new Date().toISOString() },
      subscription: 'projects/saju-test/subscriptions/play-rtdn',
    });
    const voided = (orderId = ORDER) => ({
      version: '1.0',
      packageName: PACKAGE,
      eventTimeMillis: String(Date.now()),
      voidedPurchaseNotification: { purchaseToken: 'tok_voided', orderId, productType: 2, refundType: 1 },
    });
    const google = async (body: unknown, bearer?: string) =>
      api('POST', '/payments/iap/notifications/google', { body, headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` } });

    beforeAll(async () => {
      const v = await api('POST', '/payments/iap/verify', { token, body: { platform: 'android', productId: 'chat_pack_10', receipt: `mock:${ORDER}` } });
      expect(v.status).toBe(200);
    });

    it('푸시 인증 실패는 모두 401 이고 지급분을 건드리지 않는다', async () => {
      const before = (await wallet()).credits;
      const body = push(voided());
      expect((await google(body)).status).toBe(401); // Authorization 없음
      expect((await google(body, 'garbage')).status).toBe(401);
      expect((await google(body, await oidc({}, { key: otherRsa.privateKey }))).status).toBe(401); // 다른 키로 서명
      expect((await google(body, await oidc({}, { aud: 'https://evil.example.com/hook' }))).status).toBe(401); // audience 불일치
      expect((await google(body, await oidc({}, { iss: 'https://evil.example.com' }))).status).toBe(401); // 발급자 불일치
      // 누구나 자기 서비스 계정으로 같은 audience 의 Google ID 토큰을 만들 수 있다 → 이메일 대조
      expect((await google(body, await oidc({ email: 'attacker@evil-project.iam.gserviceaccount.com' }))).status).toBe(401);
      expect((await google(body, await oidc({ email_verified: false }))).status).toBe(401);
      expect((await wallet()).credits).toBe(before);
      expect(orderOf(ORDER).status).toBe('paid');
      expect(event(`iap_google:${body.message.messageId}`)).toBeUndefined();
    });

    it('voidedPurchaseNotification(환불·지불 거절) → 회수, 같은 messageId 재전송은 중복', async () => {
      const before = (await wallet()).credits;
      const body = push(voided());
      const r = await google(body, await oidc());
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ ok: true, duplicate: false, type: 'VOIDED_PURCHASE', applied: true });
      expect((await wallet()).credits).toBe(before - 10);
      expect(orderOf(ORDER).status).toBe('refunded');

      const again = await google(body, await oidc());
      expect(again.body).toMatchObject({ duplicate: true });
      expect((await wallet()).credits).toBe(before - 10);
    });

    it('다른 패키지·깨진 데이터·테스트·일회성 상품 알림은 기록만 하고 200(ack)', async () => {
      const cases: [unknown, string][] = [
        [{ ...voided('GPA.9999'), packageName: 'com.other.app' }, 'OTHER_PACKAGE'],
        ['not json at all', 'MALFORMED'],
        [{ version: '1.0', packageName: PACKAGE, eventTimeMillis: '1', testNotification: { version: '1.0' } }, 'TEST'],
        [{ version: '1.0', packageName: PACKAGE, eventTimeMillis: '1', oneTimeProductNotification: { version: '1.0', notificationType: 1, purchaseToken: 't', sku: 'chat_pack_10' } }, 'ONE_TIME_PRODUCT_PURCHASED'],
        [{ version: '1.0', packageName: PACKAGE, eventTimeMillis: '1', subscriptionNotification: { version: '1.0', notificationType: 4, purchaseToken: 't', subscriptionId: 'plus' } }, 'SUBSCRIPTION_4'],
      ];
      for (const [n, type] of cases) {
        const body = push(n);
        const r = await google(body, await oidc());
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ type, applied: false });
        expect(event(`iap_google:${body.message.messageId}`)?.processedAt).toBeTruthy();
      }
    });

    it('검증 전에 무효화된 구매는 나중에 검증 요청이 와도 지급하지 않는다', async () => {
      await google(push(voided('GPA.5555-0000')), await oidc());
      const v = await api('POST', '/payments/iap/verify', { token, body: { platform: 'android', productId: 'chat_pack_10', receipt: 'mock:GPA.5555-0000' } });
      expect(v.status).toBe(402);
      expect(app.ctx.db.select().from(webhookEvents).where(like(webhookEvents.id, 'iap_google:voided:%')).all().length).toBeGreaterThanOrEqual(2);
    });

    it('Pub/Sub 메시지 형식이 아니면 400', async () => {
      expect((await google({ hello: 'world' }, await oidc())).status).toBe(400);
    });
  });
});
