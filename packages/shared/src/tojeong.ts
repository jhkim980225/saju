/**
 * 토정비결 공용 상수 — zod 없이 가볍게 둔다.
 * 랜딩처럼 처음 내려받는 화면이 '@saju/shared/tojeong' 으로 가져가도 스키마 묶음(zod)이 첫 번들에 끌려오지 않게 한다.
 */

/** 토정비결을 볼 수 있는 대상 연도 범위 — 엔진(@saju/core TOJEONG_MIN_YEAR·TOJEONG_MAX_YEAR)과 같다 */
export const TOJEONG_YEAR_MIN = 1900;
export const TOJEONG_YEAR_MAX = 2049;

/**
 * 토정비결 기본 대상 연도 — 신년운세와 같은 규칙으로 KST 10월부터는 다음 해를 본다.
 * 해가 바뀔 때마다 상수를 고치지 않아도 되게 날짜로 정한다. 범위를 벗어나면 끝 연도로 맞춘다.
 */
export function tojeongDefaultYear(now: Date = new Date()): number {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  const year = kst.getUTCFullYear() + (kst.getUTCMonth() >= 9 ? 1 : 0);
  return Math.min(TOJEONG_YEAR_MAX, Math.max(TOJEONG_YEAR_MIN, year));
}

/** 주소의 ?year= 값 — 범위 안의 정수만 받고, 아니면 null(기본 연도를 쓴다) */
export function parseTojeongYear(raw: string | null | undefined): number | null {
  if (!raw || !/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return year >= TOJEONG_YEAR_MIN && year <= TOJEONG_YEAR_MAX ? year : null;
}
