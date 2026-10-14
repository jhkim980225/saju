/**
 * 스토어 서버 알림 수신 — 스토어에서 일어난 환불·취소를 우리 지급분에 반영한다.
 *
 * Apple: App Store Server Notifications V2 — POST { signedPayload } (Apple 이 서명한 JWS)
 *   x5c 체인을 Apple Root CA - G3 까지 검증하고(appleJws.ts) bundleId·환경을 대조한다. 안의 signedTransactionInfo /
 *   signedRenewalInfo 도 각각 서명 검증한다. 멱등 키: notificationUUID.
 * Google: 실시간 개발자 알림(RTDN) — Cloud Pub/Sub 푸시 { message: { data(base64), messageId }, subscription }
 *   푸시 요청의 Authorization: Bearer <OIDC 토큰>을 Google 공개키로 검증하고 audience·서비스 계정 이메일을 대조한다.
 *   멱등 키: Pub/Sub messageId (재전송돼도 같다).
 *
 * 알림을 어떻게 처리할지(회수/복구/기록)만 정하고, 주문 반영은 service.handleStoreNotification 이 한다.
 * 출처가 확인된 알림은 모르는 유형이어도 실패시키지 않는다(기록 후 200) — 실패 응답은 스토어 재전송만 부른다.
 */
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AppConfig } from '../../../config/env.js';
import { AppError, badRequest, unauthorized } from '../../../lib/errors.js';
import { AppleJwsError, verifyAppleJws, type AppleNotificationPayload, type AppleRenewalInfo, type AppleTransaction } from './appleJws.js';
import { APPLE_IAP_ENV_KEYS, GOOGLE_IAP_ENV_KEYS, googleTestTransactionId, type AppleVerifierDeps } from './iap.js';
import type { StoreNotification, StoreNotificationSource } from './types.js';

export const GOOGLE_RTDN_ENV_KEYS = [...GOOGLE_IAP_ENV_KEYS, 'GOOGLE_PLAY_RTDN_AUDIENCE', 'GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT'];
export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_OIDC_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const CLOCK_TOLERANCE_SEC = 60;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** 검증 실패 — 응답은 짧은 문장만, 자세한 사유는 cause(서버 로그용) */
const reject = (err: AppError, reason: string) => {
  err.cause = reason;
  return err;
};
const invalid = (reason: string) => reject(badRequest('스토어 알림 검증에 실패했어요.'), reason);

// ── Apple ────────────────────────────────────────────────────

/** 지급분에 영향을 주는 알림 — 나머지(구독·TEST·CONSUMPTION_REQUEST 등)는 기록만 */
const APPLE_EFFECTS: Record<string, Pick<StoreNotification, 'action' | 'revokeStatus' | 'reason'>> = {
  REFUND: { action: 'revoke', revokeStatus: 'refunded', reason: 'App Store 환불(REFUND)' },
  REVOKE: { action: 'revoke', revokeStatus: 'canceled', reason: 'App Store 가족 공유 해제(REVOKE)' },
  REFUND_REVERSED: { action: 'restore', reason: 'App Store 환불 철회(REFUND_REVERSED)' },
};

export function createAppleNotificationSource(config: AppConfig, deps: AppleVerifierDeps = {}): StoreNotificationSource {
  const verify = async <T>(jws: string, label: string): Promise<T> => {
    try {
      return await verifyAppleJws<T>(jws, { trustedRoots: deps.rootCertificates });
    } catch (e) {
      if (e instanceof AppleJwsError) throw invalid(`${label}: ${e.reason}`);
      throw e;
    }
  };

  return {
    platform: 'ios',
    envKeys: APPLE_IAP_ENV_KEYS,
    isConfigured: () => config.features.appleIap,

    async parse({ body }) {
      const signedPayload = isObject(body) ? str(body.signedPayload) : null;
      if (!signedPayload) throw invalid('signedPayload 없음');
      const n = await verify<AppleNotificationPayload>(signedPayload, 'signedPayload');
      const id = str(n.notificationUUID);
      const notificationType = str(n.notificationType);
      if (!id || !notificationType) throw invalid('notificationUUID / notificationType 없음');

      // 서명은 Apple 것이어도 다른 앱의 알림을 재전송한 것일 수 있다
      const bundleId = n.data?.bundleId ?? n.summary?.bundleId ?? n.externalPurchaseToken?.bundleId;
      if (bundleId !== config.APPLE_BUNDLE_ID) throw invalid(`다른 앱의 알림 (bundleId=${String(bundleId)})`);
      const externalId = n.externalPurchaseToken?.externalPurchaseId;
      const environment = n.data?.environment ?? n.summary?.environment ?? (externalId ? (externalId.startsWith('SANDBOX') ? 'Sandbox' : 'Production') : undefined);

      const type = n.subtype ? `${notificationType}:${n.subtype}` : notificationType;
      const meta = { notificationType, subtype: n.subtype ?? null, notificationUUID: id, signedDate: n.signedDate ?? null, environment: environment ?? null };
      if (!environment || !config.APPLE_IAP_ENVIRONMENTS.includes(environment)) {
        // 이 서버가 받지 않는 환경(예: 스테이징 서버에 운영 알림) — 재전송돼도 결과가 같으니 기록만 하고 200
        return { id, type, action: 'none', transactionIds: [], reason: '', raw: { ...meta, ignored: 'ENVIRONMENT_NOT_ALLOWED' } };
      }

      // 안에 든 JWS 도 각각 서명 검증한다(Apple 공식 라이브러리와 같은 방식)
      const signedTx = str(n.data?.signedTransactionInfo);
      const signedRenewal = str(n.data?.signedRenewalInfo);
      const tx = signedTx ? await verify<AppleTransaction>(signedTx, 'signedTransactionInfo') : null;
      const renewal = signedRenewal ? await verify<AppleRenewalInfo>(signedRenewal, 'signedRenewalInfo') : null;
      if (tx && (tx.bundleId !== config.APPLE_BUNDLE_ID || tx.environment !== environment)) throw invalid('거래의 bundleId / environment 가 알림과 달라요');
      if (renewal?.environment && renewal.environment !== environment) throw invalid('갱신 정보의 environment 가 알림과 달라요');

      const effect = APPLE_EFFECTS[notificationType];
      if (effect && !tx) throw invalid(`${notificationType} 알림에 signedTransactionInfo 가 없어요`);
      return {
        id,
        type,
        ...(effect ?? { action: 'none', reason: '' }),
        transactionIds: tx ? [String(tx.transactionId)] : [],
        raw: {
          ...meta,
          // CONSUMPTION_REQUEST: 고객 환불 요청 사유 (소비 정보 회신은 미구현 — docs/PAYMENTS.md 5.2)
          consumptionRequestReason: n.data?.consumptionRequestReason ?? null,
          transaction: tx && {
            transactionId: String(tx.transactionId),
            originalTransactionId: tx.originalTransactionId ?? null,
            productId: tx.productId,
            type: tx.type ?? null,
            purchaseDate: tx.purchaseDate ?? null,
            inAppOwnershipType: tx.inAppOwnershipType ?? null,
            revocationDate: tx.revocationDate ?? null,
            revocationReason: tx.revocationReason ?? null,
          },
          renewal: renewal && { originalTransactionId: renewal.originalTransactionId ?? null, autoRenewStatus: renewal.autoRenewStatus ?? null, autoRenewProductId: renewal.autoRenewProductId ?? null },
        },
      };
    },
  };
}

// ── Google ───────────────────────────────────────────────────

export interface GoogleRtdnDeps {
  /** OIDC 토큰 검증 키 (테스트 주입). 기본: Google 공개키 원격 JWKS — jose 가 키 회전·재조회 쿨다운을 처리 */
  oidcKeys?: JWTVerifyGetKey;
}

let googleKeys: JWTVerifyGetKey | undefined;
const getGoogleKeys = () => (googleKeys ??= createRemoteJWKSet(new URL(GOOGLE_CERTS_URL), { timeoutDuration: 10_000 }));

const ONE_TIME_TYPES: Record<number, string> = { 1: 'ONE_TIME_PRODUCT_PURCHASED', 2: 'ONE_TIME_PRODUCT_CANCELED' };

export function createGoogleRtdnSource(config: AppConfig, deps: GoogleRtdnDeps = {}): StoreNotificationSource {
  const keys = () => deps.oidcKeys ?? getGoogleKeys();
  const denied = (reason: string) => reject(unauthorized('Pub/Sub 푸시 인증에 실패했어요.'), reason);

  /** Pub/Sub 푸시 인증 — 서명(Google 공개키)·발급자·audience + 구독에 지정한 서비스 계정인지 */
  async function authenticate(headers: Record<string, string | string[] | undefined>) {
    const h = headers.authorization;
    const auth = Array.isArray(h) ? h[0] : h;
    if (!auth?.startsWith('Bearer ')) throw denied('Authorization: Bearer 토큰 없음');
    let claims: Record<string, unknown>;
    try {
      ({ payload: claims } = await jwtVerify(auth.slice(7), keys(), {
        issuer: GOOGLE_OIDC_ISSUERS,
        audience: config.GOOGLE_PLAY_RTDN_AUDIENCE!,
        algorithms: ['RS256'],
        clockTolerance: CLOCK_TOLERANCE_SEC,
      }));
    } catch (e) {
      // 토큰 문제는 401. Google 공개키 조회 실패(타임아웃·네트워크)는 그대로 던져 5xx → Pub/Sub 이 재전송
      if (e instanceof errors.JOSEError && !(e instanceof errors.JWKSTimeout)) throw denied(`OIDC 토큰 검증 실패: ${e.code}`);
      throw e;
    }
    // 누구나 자기 서비스 계정으로 임의 audience 의 Google ID 토큰을 만들 수 있으므로 이메일 대조가 필수다
    const verified = claims.email_verified === true || claims.email_verified === 'true';
    if (claims.email !== config.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT || !verified) throw denied(`서비스 계정 불일치: ${String(claims.email)}`);
  }

  return {
    platform: 'android',
    envKeys: GOOGLE_RTDN_ENV_KEYS,
    isConfigured: () => config.features.googleRtdn,

    async parse({ headers, body }) {
      await authenticate(headers);
      const msg = isObject(body) && isObject(body.message) ? body.message : null;
      const id = msg ? (str(msg.messageId) ?? str(msg.message_id)) : null;
      if (!msg || !id) throw invalid('Pub/Sub 푸시 메시지 형식이 아니에요');
      const envelope = { messageId: id, publishTime: str(msg.publishTime) ?? str(msg.publish_time), subscription: isObject(body) ? str(body.subscription) : null };
      const record = (type: string, raw: Record<string, unknown> = {}): StoreNotification => ({ id, type, action: 'none', transactionIds: [], reason: '', raw: { ...envelope, ...raw } });

      // 인증된 메시지는 내용이 이상해도 200 으로 확인(ack)한다 — 실패로 응답하면 Pub/Sub 이 같은 메시지를 계속 재전송한다
      let n: unknown = null;
      try {
        n = JSON.parse(Buffer.from(str(msg.data) ?? '', 'base64').toString('utf8'));
      } catch {
        // 아래에서 MALFORMED 로 기록
      }
      if (!isObject(n)) return record('MALFORMED');
      const meta = { packageName: str(n.packageName), eventTimeMillis: str(n.eventTimeMillis) ?? n.eventTimeMillis ?? null };
      if (n.packageName !== config.GOOGLE_PLAY_PACKAGE_NAME) return record('OTHER_PACKAGE', meta);

      const voided = isObject(n.voidedPurchaseNotification) ? n.voidedPurchaseNotification : null;
      if (voided) {
        // 환불·지불 거절·취소로 무효가 된 구매 — 주문은 orderId(테스트 구매는 토큰 해시)로 찾는다
        const orderId = str(voided.orderId);
        const token = str(voided.purchaseToken);
        const refundType = voided.refundType === 2 ? 2 : 1;
        return {
          id,
          type: 'VOIDED_PURCHASE',
          action: 'revoke',
          revokeStatus: 'refunded',
          transactionIds: [orderId, token && googleTestTransactionId(token)].filter((v): v is string => Boolean(v)),
          // refundType 2(수량 일부 환불)는 다수량 구매에서만 생긴다 — 다수량 판매를 켜지 않으므로 주문 전체를 회수한다
          reason: refundType === 2 ? 'Google Play 구매 무효화(수량 일부 환불)' : 'Google Play 구매 무효화(환불·지불 거절)',
          raw: { ...envelope, ...meta, voided: { orderId, productType: voided.productType ?? null, refundType } },
        };
      }
      const oneTime = isObject(n.oneTimeProductNotification) ? n.oneTimeProductNotification : null;
      if (oneTime) {
        // PURCHASED 는 앱의 /payments/iap/verify 로 지급하고, CANCELED 는 대기(Pending) 구매 취소라 지급된 적이 없다 — 기록만
        const kind = ONE_TIME_TYPES[Number(oneTime.notificationType)] ?? `ONE_TIME_PRODUCT_${String(oneTime.notificationType)}`;
        return record(kind, { ...meta, sku: str(oneTime.sku) });
      }
      const sub = isObject(n.subscriptionNotification) ? n.subscriptionNotification : null;
      if (sub) return record(`SUBSCRIPTION_${String(sub.notificationType)}`, { ...meta, subscriptionId: str(sub.subscriptionId) }); // 구독은 2차 출시
      if (isObject(n.testNotification)) return record('TEST', meta);
      return record('UNKNOWN', meta);
    },
  };
}
