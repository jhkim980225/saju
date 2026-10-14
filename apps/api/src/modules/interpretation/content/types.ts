/**
 * 해석 콘텐츠 타입 계약.
 * 콘텐츠(문구) 파일들은 이 타입을 만족해야 하며, 해석 생성기(rule-based)와 AI 프롬프트가 이를 참조한다.
 * 문체: 친근한 존댓말(~해요). 단정적·공포 조장 표현, 의료·투자 단정 금지.
 */
import type { CompatibilityCategory, Element, ElementFit, FortuneGrade, FortuneHighlight, ShinsalName, StrengthLevel, TenGod, TwelveStage } from '@saju/core';

/** 일간(日干) 10종 — 성격의 핵심 */
export interface DayMasterContent {
  /** 천간 한자: '甲' */
  stem: string;
  /** '갑목(甲木)' */
  name: string;
  /** 상징 별칭: '곧게 뻗은 큰 나무' */
  title: string;
  /** 한 줄 요약 (40자 내외) */
  summary: string;
  keywords: string[];
  /** 성격 본문 2~3문단 */
  personality: string[];
  strengths: string[];
  weaknesses: string[];
  love: string;
  career: string;
  /** 어울리는 직업군 5~8개 */
  jobs: string[];
  wealth: string;
  health: string;
  /** 한 줄 조언 */
  advice: string;
}

/** 60갑자 일주론 */
export interface DayPillarContent {
  /** '甲子' */
  ganzhi: string;
  /** '갑자' */
  hangul: string;
  /** 이미지 별칭: '겨울 강가의 큰 나무' */
  title: string;
  /** 한 줄 요약 */
  summary: string;
  /** 성격·기질 1문단 */
  personality: string;
  /** 연애·배우자 1문단 */
  love: string;
  /** 직업·적성 1문단 */
  career: string;
}

export interface ElementContent {
  element: Element;
  /** '목(木)' */
  name: string;
  /** 오행의 성질 1문단 */
  nature: string;
  /** 과다할 때 */
  excess: string;
  /** 부족(없을 때) */
  lacking: string;
  /** 보완 방법: 색·음식·활동·장소 등 4~6개 */
  balanceTips: string[];
  /** 관련 신체(한의학적 상징, 단정 금지) */
  organs: string;
  /** 행운 아이템 후보 4~6개 */
  luckyItems: string[];
}

export interface TenGodContent {
  name: TenGod;
  /** 한 단어 키워드 */
  keyword: string;
  /** 의미 1문단 */
  meaning: string;
  /** 사주에 많을 때 */
  strong: string;
  /** 사주에 없을 때 */
  absent: string;
  /** 이 기운이 운(대운·세운·일진)으로 들어올 때 */
  inLuck: {
    general: string;
    wealth: string;
    love: string;
    career: string;
    health: string;
  };
  /** 오늘의 조언 후보 3개 이상 (일진의 천간 십신 기준) */
  dailyAdvice: string[];
}

export interface TwelveStageContent {
  name: TwelveStage;
  keyword: string;
  meaning: string;
}

export interface ShinsalContent {
  name: ShinsalName;
  hanja: string;
  /** 한 줄 요약 */
  summary: string;
  /** 설명 1문단 (흉살도 긍정적 활용법 포함) */
  detail: string;
}

export interface StrengthContent {
  level: StrengthLevel;
  title: string;
  description: string;
  advice: string;
}

export type ScoreBand = 'high' | 'mid' | 'low';
export type DailyCategory = 'wealth' | 'love' | 'career' | 'health' | 'study';

export interface FortuneTemplates {
  /** 등급별 오늘의 운세 헤드라인 후보 (각 4개 이상) */
  dailyHeadline: Record<FortuneGrade, string[]>;
  /** 등급별 오늘의 운세 본문 후보 (각 3개 이상, 2~3문장) */
  dailyMessage: Record<FortuneGrade, string[]>;
  /** 카테고리 × 점수대별 한 줄 (각 3개 이상). high ≥ 70, mid 50~69, low < 50 */
  dailyCategory: Record<DailyCategory, Record<ScoreBand, string[]>>;
  /** 하이라이트(신살·합충)별 한 줄 설명 */
  highlights: Record<FortuneHighlight, string>;
  /** 등급별 신년(세운) 헤드라인 후보 (각 3개 이상) */
  yearlyHeadline: Record<FortuneGrade, string[]>;
  /** 등급별 월운 요약 후보 (각 3개 이상, 1문장) */
  monthlySummary: Record<FortuneGrade, string[]>;
  /** 대운 십신 그룹별 10년 흐름 해설 */
  daeunTheme: Record<'비겁' | '식상' | '재성' | '관성' | '인성', string>;
  /** 궁합 등급별 헤드라인 후보 (각 3개 이상) */
  compatibilityHeadline: Record<'excellent' | 'good' | 'normal' | 'effort', string[]>;
  /** 궁합 등급별 조언 1문단 */
  compatibilityAdvice: Record<'excellent' | 'good' | 'normal' | 'effort', string>;
  /** 공유 카드용 오늘의 한마디 (10개 이상, 20자 내외) */
  shareQuotes: string[];
}

export interface YongsinContent {
  element: Element;
  /** 용신이 이 오행일 때 생활 속 개운법 1문단 */
  description: string;
  tips: string[];
}

// ---------------------------------------------------------------------------
// 보고서 확장 콘텐츠 — 사주분석서 · 신년운세 · 궁합 리포트 (docs: 보고서 분량 확대, 2026-10-13)
// ---------------------------------------------------------------------------

/** 십신이 10년 대운으로 들어올 때 — 하루·한 해보다 긴 호흡(인생의 계절)으로 쓴다 */
export interface DaeunTenGodContent {
  /** 이 10년의 큰 흐름 3~4문장 (120~220자) */
  general: string;
  /** 각 2문장 (60~130자) */
  wealth: string;
  love: string;
  career: string;
  health: string;
}

/** 한 해에 같은 십신 달이 두 번 올 수 있어 영역마다 후보 2개(앞 → 처음 오는 달, 뒤 → 두 번째 달). 각 1~2문장 (40~100자) */
export interface MonthTenGodContent {
  general: [string, string];
  wealth: [string, string];
  love: [string, string];
  career: [string, string];
  health: [string, string];
  /** 이달 해 볼 구체적인 행동 하나 */
  advice: [string, string];
}

export interface LuckContent {
  daeun: Record<TenGod, DaeunTenGodContent>;
  month: Record<TenGod, MonthTenGodContent>;
  /** 운의 천간(stem)·지지(branch) 오행이 내 용신/희신/기신/중립일 때 — 대운·세운·월운 공통 1문장 (40~90자) */
  fit: Record<ElementFit, { stem: string; branch: string }>;
}

/** 원국 오행 비율 단계 — 웹 ElementBars 의 elementStatus 와 같은 기준 */
export type ElementLevel = 'none' | 'weak' | 'balanced' | 'developed' | 'excess';

/** 궁합 요인 키 — 엔진 factor.key 에서 complement_a_wood → complement, spouse_star_a → spouse_star 처럼 접두어로 묶는다 */
export type CompatFactorKey =
  | 'stem_combine' | 'stem_clash' | 'stem_same' | 'stem_generate' | 'stem_control'
  | 'day_branch_combine' | 'day_branch_half' | 'day_branch_clash' | 'day_branch_punish' | 'day_branch_harm' | 'day_branch_wonjin'
  | 'zodiac_combine' | 'zodiac_trine' | 'zodiac_clash' | 'zodiac_wonjin'
  | 'complement' | 'yongsin' | 'gisin' | 'spouse_star';

export interface ReportMiscContent {
  /** 오행 × 비율 단계 해설 1~2문장 (50~120자) — "내 사주에서 이 오행이 이 정도일 때" */
  elementLevel: Record<Element, Record<ElementLevel, string>>;
  /** 궁합 요인별 — detail: 왜 그런지 2~3문장(90~180자), tip: 관계에서 해 볼 행동 1문장 */
  compatFactor: Record<CompatFactorKey, { detail: string; tip: string }>;
  /** 궁합 영역 점수대별 해설 2문장 (60~130자). high ≥ 70, mid 50~69, low < 50 */
  compatCategory: Record<CompatibilityCategory, Record<ScoreBand, string>>;
  /** 두 사람 일간 오행 관계별 해설 2~3문장 (90~180자) */
  compatStemRelation: Record<'same' | 'iGenerate' | 'theyGenerate' | 'iControl' | 'theyControl', string>;
  /** 분석서 마지막 장 — 신강도별 삶의 조언 3~4문장 (120~220자) */
  closingByStrength: Record<StrengthLevel, string>;
  /** 궁합 — 가장 강한 십성 그룹으로 본 대화·표현 방식 2문장 */
  compatCommunication: Record<'비겁' | '식상' | '재성' | '관성' | '인성', string>;
  /** 궁합 — 신강도로 본 갈등 대응 방식 2문장 */
  compatConflict: Record<StrengthLevel, string>;
}
