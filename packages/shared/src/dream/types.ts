/**
 * 꿈해몽 사전 — 타입 계약.
 *
 * 항목 파일(entries/*.ts)은 이 타입을 만족해야 하며, 웹(무료 사전·검색·키워드 페이지)과
 * API(AI 꿈풀이의 규칙 기반 근거 추출)가 함께 쓴다.
 *
 * 문안 원칙 (docs/PLAIN_KOREAN.md 문체 기준, docs/research/04-copywriting-guide.md):
 *  - 모두 달빛사주가 직접 쓴 문장이에요. 해몽 사이트·책의 문장을 옮기지 않고, 전통 민속 해석(태몽·재물몽 등)은 우리 말로 풀어 씁니다.
 *  - 성인 독자를 위한 차분한 설명체 — '~해요'와 '~입니다/~합니다'를 문맥에 따라 섞는다. 단정 대신 해석("~로 풀이합니다", "~로 해석해 왔어요").
 *  - 상황별 풀이는 해석이 중심이다. 조언은 구체적일 때만 덧붙이고, 항목마다 '~해 보세요'로 끝내지 않는다. 응원·감성 문구, 유아적 표현 금지.
 *  - 공포 조장·흉사(죽음·사고·질병) 예언·의료/심리 진단 금지. 흉몽도 '관리 포인트'로 바꿔 말합니다.
 *  - 성별 고정관념(아들/딸 태몽 단정), 결혼·출산 전제, 도박 권유 금지.
 *  - 규칙 기반 꿈풀이가 여러 항목을 한 화면에 엮으므로, 같은 문장을 두 항목에 쓰지 않는다.
 */

export const DREAM_CATEGORIES = ['animal', 'person', 'nature', 'object', 'action', 'body', 'place', 'colorNumber', 'food', 'event', 'kind'] as const;
export type DreamCategory = (typeof DREAM_CATEGORIES)[number];

/** 길몽 / 흉몽 / 중립 */
export type DreamTone = 'good' | 'bad' | 'neutral';

export interface DreamVariation {
  /** '뱀에게 물리는 꿈' — '…꿈'으로 끝나는 짧은 제목 */
  title: string;
  /** 이 상황의 결 (없으면 항목의 tone) */
  tone?: DreamTone;
  /** 1~2문장 풀이 (40~120자) — 규칙 기반 꿈풀이에서는 '<제목>이라면, <text>'로 이어 붙는다 */
  text: string;
  /** 꿈 설명에 이 글자가 들어 있으면 이 상황으로 본다 — 동사 어간 등 짧은 부분 문자열 1~4개 (예: ['물리', '물렸', '물었']) */
  hints: string[];
}

/** 항목 파일에 쓰는 형태 (분류는 파일 단위로 붙는다) */
export interface DreamEntryInput {
  /** 대표 키워드 — 사전 안에서 유일. 명사('뱀') 또는 '…꿈'으로 끝나는 짧은 구('쫓기는 꿈') */
  keyword: string;
  /** 검색용 동의어·다른 표기 (키워드 자신은 넣지 않는다). 사전 전체에서 유일해야 한다 */
  aliases: string[];
  tone: DreamTone;
  /** 한 줄 요약 (45자 이내) */
  summary: string;
  /** 기본 풀이 2~3문장 (80~200자) */
  meaning: string;
  /** 자주 꾸는 상황 2~4개 */
  variations: DreamVariation[];
  /**
   * 꿈 설명에서 이 항목을 찾을 때 쓸 말 — 지정하면 [keyword, ...aliases] 대신 이것만 쓴다.
   * 한 글자 동음이의어('해'·'달'·'말'·'배' 등)처럼 그냥 찾으면 엉뚱하게 걸리는 항목에만 쓴다.
   */
  extract?: string[];
  /** 꿈 설명에서 먼저 지우고 찾을 구절 — 다른 뜻으로 쓰인 경우(예: 쥐 → '쥐가 났') */
  exclude?: string[];
}

export interface DreamEntry extends DreamEntryInput {
  /** URL 조각 — 키워드의 공백을 '-'로 바꾼 것 (/dream/뱀, /dream/쫓기는-꿈) */
  slug: string;
  category: DreamCategory;
}
