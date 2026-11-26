/**
 * 신년운세·"올해 운세"의 대상 연도 규칙 — 웹과 서버가 이 파일 하나를 함께 쓴다.
 * zod 없이 가볍게 둔다(첫 화면 번들이 '@saju/shared/fortune-year' 로 가져가도 스키마 묶음이 끌려오지 않게).
 */

const KST_OFFSET_MS = 9 * 3_600_000;

/** KST 기준 연도 */
export function kstYear(now = new Date()): number {
  return new Date(now.getTime() + KST_OFFSET_MS).getUTCFullYear();
}

/** 신년운세·"올해 운세" 대상 연도 — KST 기준 10월 1일부터는 다음 해 */
export function targetFortuneYear(now = new Date()): number {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  return kst.getUTCFullYear() + (kst.getUTCMonth() >= 9 ? 1 : 0);
}
