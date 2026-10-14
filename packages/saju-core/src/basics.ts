/**
 * 십신(十神)과 12운성(十二運星) 판정.
 */
import { BRANCHES, ELEMENTS, STEMS, mainHiddenStem, mod } from './constants.js';

export type TenGod = '비견' | '겁재' | '식신' | '상관' | '편재' | '정재' | '편관' | '정관' | '편인' | '정인';
export type TenGodGroup = '비겁' | '식상' | '재성' | '관성' | '인성';

export const TEN_GOD_HANJA: Record<TenGod, string> = {
  비견: '比肩', 겁재: '劫財', 식신: '食神', 상관: '傷官', 편재: '偏財',
  정재: '正財', 편관: '偏官', 정관: '正官', 편인: '偏印', 정인: '正印',
};

export const TEN_GOD_GROUP: Record<TenGod, TenGodGroup> = {
  비견: '비겁', 겁재: '비겁', 식신: '식상', 상관: '식상', 편재: '재성',
  정재: '재성', 편관: '관성', 정관: '관성', 편인: '인성', 정인: '인성',
};

export const TEN_GODS: readonly TenGod[] = ['비견', '겁재', '식신', '상관', '편재', '정재', '편관', '정관', '편인', '정인'];
export const TEN_GOD_GROUPS: readonly TenGodGroup[] = ['비겁', '식상', '재성', '관성', '인성'];

/** 일간(dayStem) 기준 대상 천간(targetStem)의 십신 */
export function tenGodOf(dayStem: number, targetStem: number): TenGod {
  const d = STEMS[mod(dayStem, 10)]!;
  const t = STEMS[mod(targetStem, 10)]!;
  const rel = mod(ELEMENTS.indexOf(t.element) - ELEMENTS.indexOf(d.element), 5);
  const same = d.yinYang === t.yinYang;
  switch (rel) {
    case 0: return same ? '비견' : '겁재';
    case 1: return same ? '식신' : '상관'; // 일간이 생하는 오행
    case 2: return same ? '편재' : '정재'; // 일간이 극하는 오행
    case 3: return same ? '편관' : '정관'; // 일간을 극하는 오행
    default: return same ? '편인' : '정인'; // 일간을 생하는 오행
  }
}

/** 지지의 십신 — 본기(정기) 지장간 기준 */
export function tenGodOfBranch(dayStem: number, branch: number): TenGod {
  return tenGodOf(dayStem, mainHiddenStem(branch));
}

/** 십신 그룹이 가리키는 오행 */
export function elementOfGroup(dayStem: number, group: TenGodGroup) {
  const base = ELEMENTS.indexOf(STEMS[mod(dayStem, 10)]!.element);
  const offset = { 비겁: 0, 식상: 1, 재성: 2, 관성: 3, 인성: 4 }[group];
  return ELEMENTS[(base + offset) % 5]!;
}

export type TwelveStage = '장생' | '목욕' | '관대' | '건록' | '제왕' | '쇠' | '병' | '사' | '묘' | '절' | '태' | '양';
export const TWELVE_STAGES: readonly TwelveStage[] = ['장생', '목욕', '관대', '건록', '제왕', '쇠', '병', '사', '묘', '절', '태', '양'];

/** 천간별 장생 지지 (양간 순행, 음간 역행) */
const CHANGSAENG: readonly number[] = [11, 6, 2, 9, 2, 9, 5, 0, 8, 3];

/** 천간이 지지에서 맞는 12운성 */
export function twelveStageOf(stem: number, branch: number): TwelveStage {
  const s = mod(stem, 10);
  const start = CHANGSAENG[s]!;
  const idx = STEMS[s]!.yinYang === 'yang' ? mod(branch - start, 12) : mod(start - branch, 12);
  return TWELVE_STAGES[idx]!;
}

/** 12운성 에너지 점수(0~10) — 운세 점수 산정에 사용 */
export const STAGE_ENERGY: Record<TwelveStage, number> = {
  장생: 8, 목욕: 5, 관대: 7, 건록: 9, 제왕: 10, 쇠: 6, 병: 4, 사: 3, 묘: 4, 절: 2, 태: 5, 양: 6,
};

export function branchLabel(branch: number) {
  return BRANCHES[mod(branch, 12)]!;
}
