/**
 * 앱 인앱결제(IAP) 영수증 검증 — Apple App Store Server API / Google Play Developer API.
 *
 * Apple: receipt = StoreKit 2 transactionId (또는 클라이언트가 받은 signedTransaction JWS — transactionId 만 꺼내 쓴다).
 *   GET /inApps/v1/transactions/{transactionId} 를 운영 → (404 면) 샌드박스 순으로 조회한다(APPLE_IAP_ENVIRONMENTS 에 있는 환경만).
 *   App Review 는 샌드박스 결제로 운영 서버를 테스트하므로 운영에서도 샌드박스 재시도가 필요하다.
 *   응답의 signedTransactionInfo 는 x5c 체인을 Apple Root CA - G3 까지 검증한 뒤에만 쓴다(appleJws.ts).
 * Google: receipt = purchaseToken. purchases.products.get 으로 purchaseState 를 확인한다(소모성 상품 기준).
 *   TODO(결제팀): 구독 상품은 purchases.subscriptionsv2.get 으로 별도 검증 필요(구독은 2차 출시).
 * 스토어 환불·취소는 서버 알림으로 받는다(storeNotifications.ts).
 */
import { createHash, type X509Certificate } from 'node:crypto';
import { SignJWT, decodeJwt, importPKCS8 } from 'jose';
import type { AppConfig } from '../../../config/env.js';
import { notConfigured } from '../../../lib/errors.js';
import { AppleJwsError, verifyAppleJws, type AppleEnvironment, type AppleTransaction } from './appleJws.js';
import { GatewayError, type IapVerifier } from './types.js';

export type { AppleTransaction } from './appleJws.js';

export const APPLE_IAP_ENV_KEYS = ['APPLE_IAP_ISSUER_ID', 'APPLE_IAP_KEY_ID', 'APPLE_IAP_PRIVATE_KEY', 'APPLE_BUNDLE_ID'];
export const GOOGLE_IAP_ENV_KEYS = ['GOOGLE_PLAY_PACKAGE_NAME', 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'];

export const APPLE_API_BASE = {
  production: 'https://api.storekit.itunes.apple.com',
  sandbox: 'https://api.storekit-sandbox.itunes.apple.com',
} as const;
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
export const GOOGLE_PLAY_API_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3';

const TIMEOUT_MS = 10_000;
/** Apple 은 exp 가 발급 후 60분을 넘으면 거절한다 — 여유 있게 30분 */
const APPLE_TOKEN_TTL_SEC = 30 * 60;
const STORE_NETWORK_ERROR = '스토어 서버와 통신에 실패했어요. 잠시 후 다시 시도해 주세요.';

type PrivateKey = Awaited<ReturnType<typeof importPKCS8>>;

/** env 에 "\n" 이스케이프로 들어온 PEM 줄바꿈 복원 */
const pem = (v: string) => v.replace(/\\n/g, '\n');
const parseJson = (text: string): unknown => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

async function httpJson(url: string, init: RequestInit): Promise<{ status: number; ok: boolean; body: unknown }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    return { status: res.status, ok: res.ok, body: parseJson(text) };
  } catch {
    throw new GatewayError(STORE_NETWORK_ERROR, 'NETWORK_ERROR');
  }
}

/** 키 import 는 비싸므로 1회만. 실패하면 캐시를 비워 env 수정 후 재시도할 수 있게 한다(설정 오류 → 일반 Error → 500) */
function lazyKey(load: () => string, alg: 'ES256' | 'RS256', envName: string): () => Promise<PrivateKey> {
  let key: Promise<PrivateKey> | null = null;
  return () =>
    (key ??= importPKCS8(load(), alg).catch((e: unknown) => {
      key = null;
      throw new Error(`${envName} 키 형식이 올바르지 않아요(PKCS#8 PEM 필요): ${e instanceof Error ? e.message : String(e)}`);
    }));
}

// ── Apple ────────────────────────────────────────────────────

/** Apple 서명 검증 의존성 — 테스트에서 가짜 루트 인증서를 주입한다 */
export interface AppleVerifierDeps {
  rootCertificates?: readonly X509Certificate[];
}

/**
 * 클라이언트가 보낸 signedTransaction(JWS)에서 transactionId 만 꺼낸다 — 서명 검증 없음.
 * 이 값은 "어떤 거래를 서버 API 로 조회할지"에만 쓰고, 내용은 서버 API 응답을 서명 검증해서 다시 받는다.
 */
function unverifiedTransactionId(jws: string): string {
  try {
    return String(decodeJwt(jws).transactionId ?? '');
  } catch {
    throw new GatewayError('App Store 거래 정보를 해석하지 못했어요.', 'INVALID_TRANSACTION');
  }
}

/** receipt → transactionId. StoreKit 2 의 숫자형 transactionId 또는 signedTransaction(JWS) 을 받는다 */
function appleTransactionId(receipt: string): string {
  const r = receipt.trim();
  const id = r.split('.').length === 3 ? unverifiedTransactionId(r) : r;
  if (!/^\d{1,32}$/.test(id)) throw new GatewayError('유효하지 않은 영수증이에요. (StoreKit 2 transactionId 가 필요해요)', 'INVALID_RECEIPT');
  return id;
}

export function createAppleIapVerifier(config: AppConfig, deps: AppleVerifierDeps = {}): IapVerifier {
  const signingKey = lazyKey(() => pem(config.APPLE_IAP_PRIVATE_KEY ?? ''), 'ES256', 'APPLE_IAP_PRIVATE_KEY');
  let cached: { token: string; exp: number } | null = null;

  /** App Store Server API 인증 JWT (ES256, kid=키 ID, iss=발급자 ID, aud=appstoreconnect-v1, bid=번들 ID) */
  async function bearer(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.exp - 300 > now) return cached.token;
    const exp = now + APPLE_TOKEN_TTL_SEC;
    const token = await new SignJWT({ bid: config.APPLE_BUNDLE_ID })
      .setProtectedHeader({ alg: 'ES256', kid: config.APPLE_IAP_KEY_ID!, typ: 'JWT' })
      .setIssuer(config.APPLE_IAP_ISSUER_ID!)
      .setIssuedAt(now)
      .setExpirationTime(exp)
      .setAudience('appstoreconnect-v1')
      .sign(await signingKey());
    cached = { token, exp };
    return token;
  }

  /** 허용된 환경(APPLE_IAP_ENVIRONMENTS)을 운영 → 샌드박스 순으로 조회. 앞 환경이 404 일 때만 다음 환경으로 넘어간다 */
  async function getTransaction(transactionId: string): Promise<{ signed: string; environment: AppleEnvironment }> {
    const init = { method: 'GET', headers: { Authorization: `Bearer ${await bearer()}` } };
    const path = `/inApps/v1/transactions/${encodeURIComponent(transactionId)}`;
    const environments = (['Production', 'Sandbox'] as const).filter((e) => config.APPLE_IAP_ENVIRONMENTS.includes(e));
    let res: Awaited<ReturnType<typeof httpJson>> = { status: 404, ok: false, body: null };
    for (const environment of environments) {
      res = await httpJson(`${environment === 'Production' ? APPLE_API_BASE.production : APPLE_API_BASE.sandbox}${path}`, init);
      const body = isObject(res.body) ? res.body : {};
      if (res.ok && str(body.signedTransactionInfo)) return { signed: body.signedTransactionInfo as string, environment };
      if (res.status !== 404) break;
    }

    const body = isObject(res.body) ? res.body : {};
    if (res.status === 401) cached = null; // 키 교체 등 — 다음 요청에서 새로 서명
    if (res.status === 404) throw new GatewayError('App Store 에서 구매 내역을 찾을 수 없어요.', 'TRANSACTION_NOT_FOUND');
    // Apple 오류 형식: { errorCode: 4000006, errorMessage: 'Invalid transaction id.' }
    const code = body.errorCode ?? res.status;
    throw new GatewayError(str(body.errorMessage) ?? `App Store 응답 오류 (HTTP ${res.status})`, `APPLE_${String(code)}`);
  }

  return {
    platform: 'ios',
    envKeys: APPLE_IAP_ENV_KEYS,
    isConfigured: () => config.features.appleIap,
    async verify({ productId, receipt }) {
      if (!config.features.appleIap) throw notConfigured('App Store 인앱결제 검증', APPLE_IAP_ENV_KEYS);
      const { signed, environment } = await getTransaction(appleTransactionId(receipt));
      let tx: AppleTransaction;
      try {
        // TLS 로 받은 응답이라도 서명 체인까지 확인한다(프록시·중간자 변조 방어 — Apple 공식 라이브러리와 같은 규칙)
        tx = await verifyAppleJws<AppleTransaction>(signed, { trustedRoots: deps.rootCertificates });
      } catch (e) {
        if (e instanceof AppleJwsError) throw new GatewayError('App Store 거래 정보의 서명을 확인하지 못했어요.', 'INVALID_SIGNATURE');
        throw e;
      }
      if (tx.bundleId !== config.APPLE_BUNDLE_ID) throw new GatewayError('다른 앱의 구매 내역이에요.', 'BUNDLE_MISMATCH');
      if (tx.environment !== environment) throw new GatewayError('App Store 거래 환경(운영/샌드박스)이 맞지 않아요.', 'ENVIRONMENT_MISMATCH');
      if (tx.productId !== productId) throw new GatewayError('구매한 상품이 요청한 상품과 달라요.', 'PRODUCT_MISMATCH');
      if (tx.revocationDate) throw new GatewayError('환불되었거나 취소된 구매예요.', 'REVOKED');
      return {
        transactionId: String(tx.transactionId),
        productId: tx.productId,
        purchasedAt: Number(tx.purchaseDate) || Date.now(),
        raw: {
          environment: tx.environment,
          originalTransactionId: tx.originalTransactionId ?? null,
          type: tx.type ?? null,
          quantity: tx.quantity ?? 1,
          appAccountToken: tx.appAccountToken ?? null,
        },
      };
    },
  };
}

// ── Google ───────────────────────────────────────────────────

interface ServiceAccount {
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

/** purchases.products.get 응답(ProductPurchase) 중 사용하는 필드 */
interface ProductPurchase {
  orderId?: string;
  productId?: string;
  purchaseTimeMillis?: string;
  /** 0 구매 완료 / 1 취소 / 2 대기(Pending) */
  purchaseState?: number;
  /** 0 미소비 / 1 소비 */
  consumptionState?: number;
  /** 0 미확인 / 1 확인(acknowledged) */
  acknowledgementState?: number;
  /** 0 테스트 / 1 프로모션 / 2 보상형 (일반 결제는 필드 없음) */
  purchaseType?: number;
  quantity?: number;
  regionCode?: string;
}

/** 라이선스 테스터의 테스트 구매에는 orderId 가 없다 → 구매 토큰 해시를 거래 ID(멱등 키)로 쓴다. RTDN 주문 매칭도 같은 규칙 */
export const googleTestTransactionId = (purchaseToken: string) => `TEST-${createHash('sha256').update(purchaseToken).digest('hex').slice(0, 40)}`;

function parseServiceAccount(json: string): ServiceAccount {
  const parsed = parseJson(json);
  if (!isObject(parsed) || !str(parsed.client_email) || !str(parsed.private_key)) {
    throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON 이 올바른 서비스 계정 JSON 이 아니에요(client_email, private_key 필요).');
  }
  return {
    client_email: parsed.client_email as string,
    private_key: pem(parsed.private_key as string),
    private_key_id: str(parsed.private_key_id) ?? undefined,
  };
}

export function createGoogleIapVerifier(config: AppConfig): IapVerifier {
  let account: ServiceAccount | null = null;
  const serviceAccount = () => (account ??= parseServiceAccount(config.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON ?? ''));
  const signingKey = lazyKey(() => serviceAccount().private_key, 'RS256', 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON.private_key');
  let token: { value: string; expiresAt: number } | null = null;
  let inflight: Promise<string> | null = null;

  /** OAuth2 JWT bearer 그랜트로 액세스 토큰 발급 (RFC 7523) */
  async function issueToken(): Promise<string> {
    const sa = serviceAccount();
    const now = Math.floor(Date.now() / 1000);
    const assertion = await new SignJWT({ scope: GOOGLE_PLAY_SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', ...(sa.private_key_id ? { kid: sa.private_key_id } : {}) })
      .setIssuer(sa.client_email)
      .setAudience(GOOGLE_TOKEN_URL)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(await signingKey());
    const res = await httpJson(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    const body = isObject(res.body) ? res.body : {};
    const accessToken = str(body.access_token);
    if (!res.ok || !accessToken) {
      throw new GatewayError(`Google Play 인증에 실패했어요. (${str(body.error_description) ?? str(body.error) ?? `HTTP ${res.status}`})`, 'GOOGLE_AUTH_FAILED');
    }
    const ttlSec = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    token = { value: accessToken, expiresAt: Date.now() + ttlSec * 1000 };
    return accessToken;
  }

  /** 만료 1분 전까지 메모리 캐시. 동시 요청은 발급 1회를 공유한다 */
  function accessToken(): Promise<string> {
    if (token && token.expiresAt - 60_000 > Date.now()) return Promise.resolve(token.value);
    return (inflight ??= issueToken().finally(() => {
      inflight = null;
    }));
  }

  return {
    platform: 'android',
    envKeys: GOOGLE_IAP_ENV_KEYS,
    isConfigured: () => config.features.googleIap,
    async verify({ productId, receipt }) {
      if (!config.features.googleIap) throw notConfigured('Google Play 인앱결제 검증', GOOGLE_IAP_ENV_KEYS);
      const purchaseToken = receipt.trim();
      if (!purchaseToken) throw new GatewayError('유효하지 않은 구매 토큰이에요.', 'INVALID_RECEIPT');
      const url =
        `${GOOGLE_PLAY_API_BASE}/applications/${encodeURIComponent(config.GOOGLE_PLAY_PACKAGE_NAME!)}` +
        `/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
      const get = async () => httpJson(url, { method: 'GET', headers: { Authorization: `Bearer ${await accessToken()}` } });

      let res = await get();
      if (res.status === 401) {
        token = null; // 폐기·만료된 토큰 — 1회 재발급 후 재시도
        res = await get();
      }
      if (!res.ok) {
        // Google 오류 형식: { error: { code, message, status } }
        const err = isObject(res.body) && isObject(res.body.error) ? res.body.error : {};
        if (res.status === 400 || res.status === 404 || res.status === 410) {
          throw new GatewayError('Google Play 에서 구매 내역을 찾을 수 없어요.', 'PURCHASE_NOT_FOUND');
        }
        throw new GatewayError(str(err.message) ?? `Google Play 응답 오류 (HTTP ${res.status})`, `GOOGLE_${str(err.status) ?? res.status}`);
      }

      const p = (isObject(res.body) ? res.body : {}) as ProductPurchase;
      if (p.productId && p.productId !== productId) throw new GatewayError('구매한 상품이 요청한 상품과 달라요.', 'PRODUCT_MISMATCH');
      if (p.purchaseState !== 0) {
        if (p.purchaseState === 2) throw new GatewayError('결제가 아직 완료되지 않았어요. 완료 후 다시 시도해 주세요.', 'PURCHASE_PENDING');
        throw new GatewayError('취소된 구매예요.', 'PURCHASE_CANCELED');
      }
      return {
        transactionId: p.orderId ?? googleTestTransactionId(purchaseToken),
        productId,
        purchasedAt: Number(p.purchaseTimeMillis) || Date.now(),
        raw: {
          orderId: p.orderId ?? null,
          purchaseType: p.purchaseType ?? null,
          acknowledgementState: p.acknowledgementState ?? null,
          consumptionState: p.consumptionState ?? null,
          quantity: p.quantity ?? 1,
          regionCode: p.regionCode ?? null,
        },
      };
    },
  };
}
