import { randomBytes } from 'node:crypto';

let lastMs = 0;
let seq = 0;

/**
 * UUIDv7 — 앞 48비트가 생성 시각(ms)이라 문자열 정렬이 곧 생성 순서다.
 * 같은 ms 안에서는 12비트 순번을 올려 이 프로세스 안의 생성 순서를 지킨다.
 * created_at 이 같은 행(같은 트랜잭션·같은 ms)의 정렬 보조 기준으로 쓴다.
 */
export function newId(): string {
  let ms = Date.now();
  if (ms <= lastMs) {
    seq += 1;
    if (seq > 0xfff) {
      // 같은 ms 에 4096개를 넘으면 다음 ms 로 넘긴다
      lastMs += 1;
      seq = 0;
    }
    ms = lastMs;
  } else {
    lastMs = ms;
    seq = 0;
  }
  const b = randomBytes(16);
  b.writeUIntBE(ms, 0, 6);
  b[6] = 0x70 | (seq >> 8);
  b[7] = seq & 0xff;
  b[8] = 0x80 | (b[8]! & 0x3f);
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 결제사 orderId 규칙(영숫자, 6~64자)을 만족하는 주문번호: ORD-YYYYMMDD-XXXXXXXXXX */
export function newOrderId(now = new Date()): string {
  const ymd = now.toISOString().slice(0, 10).replaceAll('-', '');
  return `ORD-${ymd}-${randomBytes(6).toString('hex').toUpperCase()}`;
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
