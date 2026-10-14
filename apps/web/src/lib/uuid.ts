/**
 * UUID v4 — crypto.randomUUID 는 보안 컨텍스트(https)에서만 존재하므로, http 로 열린 경우
 * (앱 라이브 리로드, 사내 http 스테이징 등)에도 동작하도록 getRandomValues 로 대체한다.
 */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
