/**
 * 토정비결 144괘 콘텐츠 타입 계약.
 *
 * - 괘사(verse)는 조선 후기부터 전해 오는 한문 원문(공유 저작물) 첫 구절을 그대로 옮긴다.
 * - 제목·요약·총평·열두 달 문장은 한문 원문의 뜻을 바탕으로 달빛사주 콘텐츠팀이 새로 쓴 현대 한국어다.
 *   시중의 현대어 번역·해설서 문장은 옮기지 않는다(저작권).
 * - 문체: 해요체, 단정 대신 경향, 행동 제안으로 마무리. 공포 조장(재앙·횡액·상복), 결혼·출산 전제,
 *   성별 고정관념, 성씨·특정인 경계, 의료·투자·법률 단정은 쓰지 않는다(docs/research/04 §5.4~5.6).
 * - 말투: 차분하게 설명한다 — 어떤 해·달인지 → 무엇을 조심할지 → 어떻게 하면 좋은지(docs/PLAIN_KOREAN.md '말투').
 *   비유·관용구·속담·감성 문구는 쓰지 않는다. 옛 글귀의 그림은 총평 첫 문장("…괘예요.") 한 곳에서만 옮긴다.
 * - 상괘(1~8)마다 파일 하나(gwae1.ts ~ gwae8.ts), 파일 안은 중괘·하괘 순서(111, 112, 113, 121 … 163).
 */

/** 그달의 기운 — 원문이 대체로 길하면 rise, 길흉이 섞이면 even, 조심을 당부하면 care */
export type TojeongMonthFlow = 'rise' | 'even' | 'care';

export interface TojeongMonthContent {
  flow: TojeongMonthFlow;
  /** 1~2문장(드물게 3문장), 50~110자. 그달에 생기기 쉬운 일 + 해 볼 행동 */
  text: string;
}

export interface TojeongGwaeContent {
  /** 괘 번호 — 상괘·중괘·하괘를 이은 세 자리 수(111 ~ 863) */
  code: number;
  /** 괘사 한문 원문(첫 구절 8자) — '東風解凍 枯木逢春' */
  verse: string;
  /** 괘사 한글 독음 — '동풍해동 고목봉춘' */
  reading: string;
  /** 우리가 지은 짧은 제목(8~20자) — 그해의 뜻을 바로 말한다. '애쓴 만큼 늦게 풀리는 해' */
  title: string;
  /** 한 줄 요약(25~50자) — 결과 첫 줄·공유 문구 */
  summary: string;
  /** 키워드 3개(각 2~6자) */
  keywords: [string, string, string];
  /** 총평 2문단(각 2~3문장, 합계 220~420자). 둘째 문단은 행동 제안으로 끝낸다 */
  overview: [string, string];
  /** 음력 1월 ~ 12월 (12개) */
  months: TojeongMonthContent[];
}
