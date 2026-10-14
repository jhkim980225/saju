/**
 * 테스트용 가짜 Apple 인증서 체인 — 루트 / 중간(WWDR 표식 OID) / 리프(App Store 서명 표식 OID).
 * 실제 Apple 과 같은 모양: 루트·중간은 EC P-384 + ecdsa-with-SHA384, 리프 키는 P-256(ES256).
 * 외부 라이브러리 없이 최소 DER 인코더로 X.509 v3 인증서를 만든다.
 */
import { generateKeyPairSync, randomBytes, sign, X509Certificate, type KeyObject } from 'node:crypto';
import { CompactSign } from 'jose';
import { APPLE_RECEIPT_SIGNING_OID, APPLE_WWDR_INTERMEDIATE_OID } from '../../src/modules/commerce/providers/appleJws.js';

// ── DER 인코더 ──────────────────────────────────────────────
const len = (n: number) => (n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]));
const tlv = (tag: number, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), len(body.length), body]);
};
const seq = (...p: Buffer[]) => tlv(0x30, ...p);
const set = (...p: Buffer[]) => tlv(0x31, ...p);
const explicit = (n: number, ...p: Buffer[]) => tlv(0xa0 + n, ...p);
const integer = (b: Buffer) => tlv(0x02, b[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
const bool = (v: boolean) => tlv(0x01, Buffer.from([v ? 0xff : 0]));
const octet = (b: Buffer) => tlv(0x04, b);
const bitString = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));
const NULL = Buffer.from([0x05, 0x00]);
function oid(dotted: string) {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const bytes = [40 * a! + b!];
  for (const n of rest) {
    const enc = [n & 0x7f];
    for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128)) enc.unshift((v & 0x7f) | 0x80);
    bytes.push(...enc);
  }
  return tlv(0x06, Buffer.from(bytes));
}
const time = (d: Date) => {
  const iso = d.toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDhhmmss
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${iso}Z`));
};
const name = (cn: string) => seq(set(seq(oid('2.5.4.3'), utf8(cn))), set(seq(oid('2.5.4.10'), utf8('Apple Inc. (TEST)'))));
const extension = (id: string, value: Buffer, critical = false) => seq(oid(id), ...(critical ? [bool(true)] : []), octet(value));

const ECDSA_SHA256 = '1.2.840.10045.4.3.2';
const ECDSA_SHA384 = '1.2.840.10045.4.3.3';

interface CertSpec {
  subject: string;
  issuer: string;
  publicKey: KeyObject;
  issuerKey: KeyObject;
  ca: boolean;
  notBefore: Date;
  notAfter: Date;
  markerOids?: string[];
}

function buildCert(spec: CertSpec): X509Certificate {
  const curve = spec.issuerKey.asymmetricKeyDetails?.namedCurve;
  const [hash, sigOid] = curve === 'secp384r1' ? ['sha384', ECDSA_SHA384] : ['sha256', ECDSA_SHA256];
  const sigAlg = seq(oid(sigOid));
  const serial = randomBytes(8);
  serial[0]! &= 0x7f;
  const extensions = [
    extension('2.5.29.19', spec.ca ? seq(bool(true)) : seq(), true), // basicConstraints
    extension('2.5.29.15', spec.ca ? tlv(0x03, Buffer.from([0x01, 0x06])) : tlv(0x03, Buffer.from([0x07, 0x80])), true), // keyUsage: keyCertSign+cRLSign / digitalSignature
    ...(spec.markerOids ?? []).map((o) => extension(o, NULL)),
  ];
  const tbs = seq(
    explicit(0, integer(Buffer.from([2]))),
    integer(serial),
    sigAlg,
    name(spec.issuer),
    seq(time(spec.notBefore), time(spec.notAfter)),
    name(spec.subject),
    spec.publicKey.export({ type: 'spki', format: 'der' }),
    explicit(3, seq(...extensions)),
  );
  return new X509Certificate(seq(tbs, sigAlg, bitString(sign(hash, tbs, spec.issuerKey))));
}

const ec = (namedCurve: 'P-256' | 'P-384') => generateKeyPairSync('ec', { namedCurve });
const DAY = 86_400_000;

export interface AppleChainOptions {
  /** 리프 유효기간 (기본: 어제 ~ 1년 뒤) */
  leafNotBefore?: Date;
  leafNotAfter?: Date;
  /** 표식 OID 빼기 (거절 케이스) */
  omitLeafOid?: boolean;
  omitIntermediateOid?: boolean;
}

export interface AppleTestChain {
  root: X509Certificate;
  intermediate: X509Certificate;
  leaf: X509Certificate;
  /** JWS 헤더 x5c (base64 DER — base64url 아님) */
  x5c: string[];
  /** Apple 처럼 리프 키로 ES256 서명한 JWS. key 를 주면 그 키로 서명(서명 불일치 케이스) */
  sign(payload: object, opts?: { key?: KeyObject; x5c?: string[] }): Promise<string>;
}

export function createAppleTestChain(opts: AppleChainOptions = {}): AppleTestChain {
  const now = Date.now();
  const rootKeys = ec('P-384');
  const interKeys = ec('P-384');
  const leafKeys = ec('P-256');
  const caValidity = { notBefore: new Date(now - 365 * DAY), notAfter: new Date(now + 10 * 365 * DAY) };
  const root = buildCert({ subject: 'Test Apple Root CA - G3', issuer: 'Test Apple Root CA - G3', publicKey: rootKeys.publicKey, issuerKey: rootKeys.privateKey, ca: true, ...caValidity });
  const intermediate = buildCert({
    subject: 'Test Apple Worldwide Developer Relations Certification Authority',
    issuer: 'Test Apple Root CA - G3',
    publicKey: interKeys.publicKey,
    issuerKey: rootKeys.privateKey,
    ca: true,
    markerOids: opts.omitIntermediateOid ? [] : [APPLE_WWDR_INTERMEDIATE_OID],
    ...caValidity,
  });
  const leaf = buildCert({
    subject: 'Test Prod ECC Mac App Store and iTunes Store Receipt Signing',
    issuer: 'Test Apple Worldwide Developer Relations Certification Authority',
    publicKey: leafKeys.publicKey,
    issuerKey: interKeys.privateKey,
    ca: false,
    markerOids: opts.omitLeafOid ? [] : [APPLE_RECEIPT_SIGNING_OID],
    notBefore: opts.leafNotBefore ?? new Date(now - DAY),
    notAfter: opts.leafNotAfter ?? new Date(now + 365 * DAY),
  });
  const x5c = [leaf, intermediate, root].map((c) => c.raw.toString('base64'));
  return {
    root,
    intermediate,
    leaf,
    x5c,
    sign: (payload, o = {}) =>
      new CompactSign(new TextEncoder().encode(JSON.stringify(payload))).setProtectedHeader({ alg: 'ES256', x5c: o.x5c ?? x5c }).sign(o.key ?? leafKeys.privateKey),
  };
}
