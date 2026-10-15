/**
 * 프로필 관계 상수 — zod 없이 가볍게 둔다.
 * 첫 화면에 들어간 입력 폼이 '@saju/shared/profile' 로 가져가도 스키마 묶음(zod)이 첫 번들에 끌려오지 않게 한다.
 */
export const PROFILE_RELATIONS = ['self', 'partner', 'family', 'friend', 'colleague', 'other'] as const;
export type ProfileRelation = (typeof PROFILE_RELATIONS)[number];

export const RELATION_LABEL: Record<ProfileRelation, string> = { self: '나', partner: '연인·배우자', family: '가족', friend: '친구', colleague: '동료', other: '기타' };
