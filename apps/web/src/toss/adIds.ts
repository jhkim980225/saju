/**
 * 토스 광고 그룹 ID 고르기. 앱인토스 정책: 개발·테스트 중에 실제 광고 ID 를 쓰면 정책 위반이다.
 *  - 제출용 빌드(mode `toss`)에서만 환경 변수(.env.toss)의 실제 ID 를 쓴다. 값이 없으면 빈 문자열 → 광고를 부르지 않는다.
 *  - 그 밖(toss-qa, toss-dev, 테스트)에서는 환경 변수에 무엇이 있든 테스트 ID 를 쓴다.
 *  - 제출용 번들에 테스트 ID 글자가 들어 있으면 검토에서 반려된다(2026-11 한입상식 v1 반려 사유).
 *    그래서 제출용 빌드에서는 테스트 ID 상수를 빈 문자열로 만들어 번들에서 빠지게 한다(scripts/check-toss-bundle.mjs 가 확인).
 */
const RELEASE_BUILD = import.meta.env.MODE === 'toss';
export const TEST_REWARDED_ID = RELEASE_BUILD ? '' : 'ait-ad-test-rewarded-id';
export const TEST_BANNER_ID = RELEASE_BUILD ? '' : 'ait-ad-test-banner-id';

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** 보상형: 제출용이면 실제 ID(없으면 빈 문자열), 그 밖에는 테스트 ID */
export function rewardedId(mode: string, value: unknown): string {
  return mode === 'toss' ? clean(value) : TEST_REWARDED_ID;
}

/** 배너: 제출용이면 실제 ID(없으면 빈 문자열), 그 밖에는 테스트 ID */
export function bannerId(mode: string, value: unknown): string {
  return mode === 'toss' ? clean(value) : TEST_BANNER_ID;
}
