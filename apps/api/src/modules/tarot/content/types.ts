/**
 * 타로 카드 콘텐츠 타입 계약 (라이더-웨이트-스미스 78장 체계).
 * 카드 파일(major.ts · wands.ts · cups.ts · swords.ts · pentacles.ts)은 이 타입을 만족해야 하며,
 * 규칙 기반 리딩 생성기와 AI 프롬프트가 이를 참조한다.
 * 문체: docs/PLAIN_KOREAN.md — 차분한 설명체 존댓말, 단정 대신 경향, 구체적인 행동 제안. 뜻은 1909년 라이더-웨이트-스미스 덱의 전통 해석을 따른다.
 * 공포 조장(죽음·탑·악마 등), 의료·투자·법률 단정 금지.
 */

export type TarotArcana = 'major' | 'minor';
export type TarotSuit = 'wands' | 'cups' | 'swords' | 'pentacles';
export type TarotOrientation = 'upright' | 'reversed';
export type TarotYesNo = 'yes' | 'no' | 'maybe';

/** 정방향/역방향 각각의 해석 */
export interface TarotOrientationContent {
  /** 핵심 키워드 3~5개 (각 2~6자) */
  keywords: string[];
  /** 한 줄 요약 — 카드 이름 아래 큰 글씨 (25~45자, 해요체) */
  summary: string;
  /** 일반 해석 — 지금의 흐름 (2~3문장, 80~160자) */
  general: string;
  /** 연애·관계 (2~3문장) */
  love: string;
  /** 상대의 속마음 — "그 사람은 나를 어떻게 생각할까" 관점 (2문장) */
  feelings: string;
  /** 일·학업·커리어 (2~3문장) */
  career: string;
  /** 돈·재물 (2문장, 투자 단정 금지) */
  money: string;
  /** 행동 조언 — 오늘 해 볼 수 있는 구체적인 행동 (1~2문장) */
  advice: string;
  /** 예/아니오 질문에 대한 경향 */
  yesNo: TarotYesNo;
}

export interface TarotCardContent {
  /** 'major-00' ~ 'major-21', 'wands-01' ~ 'wands-14' (01 에이스, 11 페이지, 12 나이트, 13 퀸, 14 킹) */
  id: string;
  arcana: TarotArcana;
  /** 마이너 아르카나 수트 (메이저는 null) */
  suit: TarotSuit | null;
  /** 메이저 0~21(웨이트 순서: 8 힘, 11 정의), 마이너 1~14 */
  number: number;
  /** '바보', '완드 에이스', '컵 퀸' */
  nameKo: string;
  /** 'The Fool', 'Ace of Wands', 'Queen of Cups' */
  nameEn: string;
  /** 카드 그림 묘사 1문장 — 카드 일러스트 설명·접근성 대체 텍스트 (40~80자) */
  imagery: string;
  upright: TarotOrientationContent;
  reversed: TarotOrientationContent;
}
