/**
 * Apple 이 서명한 JWS 검증 — signedTransactionInfo / signedRenewalInfo / App Store Server Notifications V2 signedPayload.
 *
 * Apple 의 JWS 는 헤더 x5c 에 [리프, 중간(WWDR G6), 루트] 인증서를 싣고 리프 키로 ES256 서명한다.
 * 검증 순서 (Apple 공식 app-store-server-library 의 SignedDataVerifier 와 같은 규칙):
 *   1. alg = ES256, x5c 는 정확히 3장
 *   2. 중간 인증서가 "우리가 내장한" Apple Root CA - G3 로 서명됐는지 (x5c 의 세 번째 인증서는 믿지 않는다)
 *   3. 리프가 중간 인증서로 서명됐는지, 중간·루트가 CA 인지
 *   4. 세 인증서의 유효기간
 *   5. Apple 전용 확장 OID — 중간 1.2.840.113635.100.6.2.1 / 리프 1.2.840.113635.100.6.11.1
 *      (다른 Apple 인증서(예: 개발자 인증서)로 서명한 JWS 를 거르는 표식)
 *   6. 리프 공개키로 ES256 서명 검증
 * 온라인 폐기 확인(OCSP)은 하지 않는다 — docs/SECURITY_REVIEW.md 참고.
 */
import { X509Certificate, type KeyObject } from 'node:crypto';
import { compactVerify, decodeProtectedHeader } from 'jose';

export type AppleEnvironment = 'Production' | 'Sandbox';

/**
 * Apple Root CA - G3 (DER, base64) — https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
 * SHA-256 지문: 63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79
 * 유효기간: 2014-04-30 ~ 2039-04-30, 키: EC P-384. 공개 인증서라 비밀이 아니다.
 */
const APPLE_ROOT_CA_G3_BASE64 =
  'MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==';
export const APPLE_ROOT_CA_G3_SHA256 = '63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79';

/** Apple Worldwide Developer Relations 중간 인증서 표식 */
export const APPLE_WWDR_INTERMEDIATE_OID = '1.2.840.113635.100.6.2.1';
/** App Store 영수증·거래 서명용 리프 인증서 표식 */
export const APPLE_RECEIPT_SIGNING_OID = '1.2.840.113635.100.6.11.1';

let defaultRoots: readonly X509Certificate[] | undefined;
/** 내장 루트 — 지문이 다르면(복사 실수·변조) 기동 후 첫 검증에서 바로 실패시킨다 */
export function appleRootCertificates(): readonly X509Certificate[] {
  if (!defaultRoots) {
    const root = new X509Certificate(Buffer.from(APPLE_ROOT_CA_G3_BASE64, 'base64'));
    if (root.fingerprint256 !== APPLE_ROOT_CA_G3_SHA256) throw new Error('내장된 Apple Root CA - G3 인증서의 SHA-256 지문이 맞지 않아요.');
    defaultRoots = [root];
  }
  return defaultRoots;
}

/** 검증 실패 — reason 은 서버 로그용(클라이언트 응답에는 넣지 않는다) */
export class AppleJwsError extends Error {
  constructor(public readonly reason: string) {
    super(`Apple JWS 검증 실패: ${reason}`);
  }
}

export interface AppleJwsOptions {
  /** 신뢰 루트. 기본은 내장 Apple Root CA - G3 — 테스트에서만 가짜 루트를 주입한다 */
  trustedRoots?: readonly X509Certificate[];
  /** 인증서 유효기간을 판정할 시각 (기본: 현재) */
  now?: Date;
}

// ── 최소 DER 파서 — 인증서 확장(extensions)의 OID 목록만 읽는다 ─────────────
// Node 의 X509Certificate 는 임의 확장을 노출하지 않아서 직접 읽는다(무거운 ASN.1 라이브러리 대신).

interface Tlv {
  tag: number;
  start: number;
  end: number;
}

function readTlv(der: Uint8Array, pos: number, limit: number): Tlv {
  if (pos + 2 > limit) throw new Error('DER 길이 부족');
  const tag = der[pos]!;
  if ((tag & 0x1f) === 0x1f) throw new Error('DER 다중 바이트 태그');
  let len = der[pos + 1]!;
  let start = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || start + n > limit) throw new Error('DER 길이 형식 오류');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + der[start + i]!;
    start += n;
  }
  if (start + len > limit) throw new Error('DER 범위 초과');
  return { tag, start, end: start + len };
}

function children(der: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let p = parent.start; p < parent.end; ) {
    const t = readTlv(der, p, parent.end);
    out.push(t);
    p = t.end;
  }
  return out;
}

function decodeOid(bytes: Uint8Array): string {
  const arcs: number[] = [];
  let v = 0;
  for (const b of bytes) {
    v = v * 128 + (b & 0x7f);
    if (!(b & 0x80)) {
      arcs.push(v);
      v = 0;
    }
  }
  const first = arcs.shift() ?? 0;
  const head = first < 40 ? [0, first] : first < 80 ? [1, first - 40] : [2, first - 80];
  return [...head, ...arcs].join('.');
}

/** Certificate → tbsCertificate → [3] extensions → Extension.extnID 목록 */
export function certificateExtensionOids(der: Uint8Array): string[] {
  const cert = readTlv(der, 0, der.length);
  const tbs = children(der, cert)[0];
  if (cert.tag !== 0x30 || tbs?.tag !== 0x30) throw new Error('인증서 구조 오류');
  const extWrapper = children(der, tbs).find((t) => t.tag === 0xa3);
  if (!extWrapper) return [];
  const list = children(der, extWrapper)[0];
  if (list?.tag !== 0x30) throw new Error('확장 목록 구조 오류');
  return children(der, list).map((ext) => {
    const id = children(der, ext)[0];
    if (id?.tag !== 0x06) throw new Error('확장 OID 구조 오류');
    return decodeOid(der.subarray(id.start, id.end));
  });
}

const hasOid = (cert: X509Certificate, oid: string) => {
  try {
    return certificateExtensionOids(cert.raw).includes(oid);
  } catch {
    return false;
  }
};

// ── 체인·서명 검증 ─────────────────────────────────────────────

function verifyChain(leaf: X509Certificate, intermediate: X509Certificate, roots: readonly X509Certificate[], at: Date): KeyObject {
  const root = roots.find((r) => intermediate.checkIssued(r) && intermediate.verify(r.publicKey));
  if (!root) throw new AppleJwsError('중간 인증서가 신뢰 루트(Apple Root CA - G3)로 서명되지 않았어요');
  if (!root.ca || !intermediate.ca) throw new AppleJwsError('루트·중간 인증서가 CA 가 아니에요');
  if (leaf.ca) throw new AppleJwsError('리프 인증서가 CA 예요');
  if (!leaf.checkIssued(intermediate) || !leaf.verify(intermediate.publicKey)) throw new AppleJwsError('리프 인증서가 중간 인증서로 서명되지 않았어요');
  for (const [label, c] of [['리프', leaf], ['중간', intermediate], ['루트', root]] as const) {
    if (at < c.validFromDate || at > c.validToDate) throw new AppleJwsError(`${label} 인증서 유효기간 밖 (${c.validFrom} ~ ${c.validTo})`);
  }
  if (!hasOid(intermediate, APPLE_WWDR_INTERMEDIATE_OID)) throw new AppleJwsError('중간 인증서에 Apple WWDR 표식 OID 가 없어요');
  if (!hasOid(leaf, APPLE_RECEIPT_SIGNING_OID)) throw new AppleJwsError('리프 인증서에 App Store 서명 표식 OID 가 없어요');
  return leaf.publicKey;
}

/** Apple JWS 의 x5c 체인과 ES256 서명을 검증하고 페이로드(JSON)를 돌려준다. 실패하면 AppleJwsError */
export async function verifyAppleJws<T = Record<string, unknown>>(jws: string, opts: AppleJwsOptions = {}): Promise<T> {
  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(jws);
  } catch {
    throw new AppleJwsError('JWS 형식이 아니에요');
  }
  if (header.alg !== 'ES256') throw new AppleJwsError(`지원하지 않는 alg: ${String(header.alg)}`);
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length !== 3 || !x5c.every((c) => typeof c === 'string')) throw new AppleJwsError('x5c 인증서 체인은 3장이어야 해요');

  let leaf: X509Certificate;
  let intermediate: X509Certificate;
  try {
    leaf = new X509Certificate(Buffer.from(x5c[0]!, 'base64'));
    intermediate = new X509Certificate(Buffer.from(x5c[1]!, 'base64'));
  } catch {
    throw new AppleJwsError('x5c 인증서를 해석하지 못했어요');
  }
  const key = verifyChain(leaf, intermediate, opts.trustedRoots ?? appleRootCertificates(), opts.now ?? new Date());

  let payload: Uint8Array;
  try {
    ({ payload } = await compactVerify(jws, key, { algorithms: ['ES256'] }));
  } catch {
    throw new AppleJwsError('서명이 리프 인증서 키와 맞지 않아요');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    throw new AppleJwsError('페이로드가 JSON 이 아니에요');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new AppleJwsError('페이로드가 객체가 아니에요');
  return parsed as T;
}

// ── 페이로드 타입 (사용하는 필드만) ───────────────────────────────

/** signedTransactionInfo(JWSTransactionDecodedPayload) */
export interface AppleTransaction {
  transactionId: string;
  originalTransactionId?: string;
  bundleId: string;
  productId: string;
  /** ms */
  purchaseDate: number;
  environment?: AppleEnvironment;
  /** Consumable | Non-Consumable | Auto-Renewable Subscription | Non-Renewing Subscription */
  type?: string;
  quantity?: number;
  appAccountToken?: string;
  /** PURCHASED | FAMILY_SHARED */
  inAppOwnershipType?: string;
  signedDate?: number;
  revocationDate?: number;
  /** 0 기타 / 1 앱 문제로 환불 */
  revocationReason?: number;
}

/** signedRenewalInfo(JWSRenewalInfoDecodedPayload) — 구독 전용, 지금은 기록만 */
export interface AppleRenewalInfo {
  originalTransactionId?: string;
  productId?: string;
  autoRenewProductId?: string;
  autoRenewStatus?: number;
  environment?: AppleEnvironment;
  signedDate?: number;
}

/** App Store Server Notifications V2 — responseBodyV2DecodedPayload */
export interface AppleNotificationPayload {
  notificationType: string;
  subtype?: string;
  notificationUUID: string;
  version?: string;
  signedDate?: number;
  data?: {
    appAppleId?: number;
    bundleId?: string;
    bundleVersion?: string;
    environment?: AppleEnvironment;
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
    status?: number;
    consumptionRequestReason?: string;
  };
  /** RENEWAL_EXTENSION 요약 알림 */
  summary?: { bundleId?: string; environment?: AppleEnvironment };
  /** EXTERNAL_PURCHASE_TOKEN 알림 */
  externalPurchaseToken?: { bundleId?: string; externalPurchaseId?: string };
}
