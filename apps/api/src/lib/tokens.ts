import { createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export interface AccessClaims {
  sub: string;
  role: 'user' | 'admin';
  provider: string;
}

const enc = (s: string) => new TextEncoder().encode(s);

export async function signAccessToken(claims: AccessClaims, secret: string, ttlSec: number): Promise<string> {
  return new SignJWT({ role: claims.role, provider: claims.provider })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .setIssuer('saju-api')
    .sign(enc(secret));
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, enc(secret), { issuer: 'saju-api' });
  return { sub: String(payload.sub), role: payload.role === 'admin' ? 'admin' : 'user', provider: String(payload.provider ?? '') };
}

/** refresh token 은 DB 에 해시로만 저장 */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
