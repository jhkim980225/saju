import { randomBytes, randomUUID } from 'node:crypto';

export const newId = () => randomUUID();

/** 결제사 orderId 규칙(영숫자, 6~64자)을 만족하는 주문번호: ORD-YYYYMMDD-XXXXXXXXXX */
export function newOrderId(now = new Date()): string {
  const ymd = now.toISOString().slice(0, 10).replaceAll('-', '');
  return `ORD-${ymd}-${randomBytes(6).toString('hex').toUpperCase()}`;
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
