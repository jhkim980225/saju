/**
 * 타로 덱 — 셔플·선택·오늘의 카드.
 *
 * 카드는 사용자가 고른 "자리"로 정해진다:
 *   1) /tarot/shuffle 이 임의 시드로 덱 토큰(HMAC 서명)을 발급한다. 카드 순서는 클라이언트에 보내지 않는다.
 *   2) 사용자가 뒤집힌 78장 중 N장의 자리를 고르면, 서버가 시드로 같은 순서를 재현해 그 자리의 카드를 꺼낸다.
 * 같은 토큰·같은 자리는 언제나 같은 카드 → 재시도로 카드를 바꿀 수 없고, 토큰은 짧게 만료된다.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { TarotOrientation } from './content/types.js';

export const DECK_SIZE = 78;
/** 역방향이 나올 확률 */
const REVERSED_RATE = 0.35;
const TOKEN_TTL_MS = 30 * 60_000;

export interface DrawnCard {
  /** 0~77 — 덱 인덱스(DECK 배열 순서) */
  index: number;
  orientation: TarotOrientation;
}

/** 시드 기반 의사난수 (SHA-256 카운터 모드) — 0 이상 1 미만 */
function prng(seed: Buffer) {
  let counter = 0;
  let pool: number[] = [];
  return () => {
    if (pool.length === 0) {
      const h = createHash('sha256').update(seed).update(String(counter++)).digest();
      pool = Array.from({ length: 8 }, (_, i) => h.readUInt32BE(i * 4) / 0x1_0000_0000);
    }
    return pool.shift()!;
  };
}

/** 시드로 셔플한 덱 — 자리(0~77)마다 카드와 방향 */
export function shuffledDeck(seed: Buffer): DrawnCard[] {
  const rand = prng(seed);
  const order = Array.from({ length: DECK_SIZE }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order.map((index) => ({ index, orientation: rand() < REVERSED_RATE ? 'reversed' : 'upright' }));
}

/** 고른 자리들의 카드 */
export function drawAt(seed: Buffer, positions: number[]): DrawnCard[] {
  const deck = shuffledDeck(seed);
  return positions.map((p) => deck[p]!);
}

/** 오늘의 카드 — 같은 사람·같은 날은 하루 종일 같은 카드 */
export function dailyCard(userId: string, isoDate: string): DrawnCard {
  return shuffledDeck(createHash('sha256').update(`daily|${userId}|${isoDate}`).digest())[0]!;
}

// ── 덱 토큰 ────────────────────────────────────────────────

const b64 = (b: Buffer) => b.toString('base64url');

/** 덱 토큰 발급: base64url(seed).exp.sig — sig 는 사용자 ID 까지 묶어 다른 계정에서 재사용할 수 없다 */
export function issueDeckToken(secret: string, userId: string, now = Date.now()): { token: string; expiresAt: number } {
  const seed = randomBytes(16);
  const exp = now + TOKEN_TTL_MS;
  const body = `${b64(seed)}.${exp}`;
  const sig = createHmac('sha256', secret).update(`${userId}|${body}`).digest();
  return { token: `${body}.${b64(sig)}`, expiresAt: exp };
}

/** 덱 토큰 검증 → 시드. 위조·만료·다른 계정이면 null */
export function readDeckToken(secret: string, userId: string, token: string, now = Date.now()): Buffer | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [seedPart, expPart, sigPart] = parts as [string, string, string];
  const expected = createHmac('sha256', secret).update(`${userId}|${seedPart}.${expPart}`).digest();
  const given = Buffer.from(sigPart, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (!(Number(expPart) > now)) return null;
  const seed = Buffer.from(seedPart, 'base64url');
  return seed.length === 16 ? seed : null;
}

/** 토큰 지문 — 같은 덱 토큰으로 리딩을 두 번 만들지 못하게 저장해 둔다 */
export const deckTokenFingerprint = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 32);
