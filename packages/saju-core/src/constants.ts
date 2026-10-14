/**
 * 사주 기초 상수 테이블 — 천간(天干), 지지(地支), 오행(五行), 지장간(支藏干), 납음(納音).
 * 인덱스 기반으로 다루며, 표시용 한자/한글은 테이블에서 조회한다.
 */

export type Element = 'wood' | 'fire' | 'earth' | 'metal' | 'water';
export type YinYang = 'yang' | 'yin';

/** 오행 순서: 목 → 화 → 토 → 금 → 수 (상생 순서) */
export const ELEMENTS: readonly Element[] = ['wood', 'fire', 'earth', 'metal', 'water'] as const;

export const ELEMENT_INFO: Record<Element, { hanja: string; hangul: string; color: string; direction: string; season: string; numbers: [number, number] }> = {
  wood: { hanja: '木', hangul: '목', color: '청색·초록', direction: '동쪽', season: '봄', numbers: [3, 8] },
  fire: { hanja: '火', hangul: '화', color: '적색·분홍', direction: '남쪽', season: '여름', numbers: [2, 7] },
  earth: { hanja: '土', hangul: '토', color: '황색·베이지', direction: '중앙', season: '환절기', numbers: [5, 10] },
  metal: { hanja: '金', hangul: '금', color: '백색·은색', direction: '서쪽', season: '가을', numbers: [4, 9] },
  water: { hanja: '水', hangul: '수', color: '흑색·남색', direction: '북쪽', season: '겨울', numbers: [1, 6] },
};

export interface StemInfo {
  index: number;
  hanja: string;
  hangul: string;
  element: Element;
  yinYang: YinYang;
}

export interface BranchInfo {
  index: number;
  hanja: string;
  hangul: string;
  element: Element;
  /** 체(體) 기준 음양 — 표시용 */
  yinYang: YinYang;
  animal: string;
  animalHanja: string;
  /** 시진(時辰) 시작 시각(정시 기준, 보정 전) */
  hourStart: number;
}

export const STEMS: readonly StemInfo[] = [
  { index: 0, hanja: '甲', hangul: '갑', element: 'wood', yinYang: 'yang' },
  { index: 1, hanja: '乙', hangul: '을', element: 'wood', yinYang: 'yin' },
  { index: 2, hanja: '丙', hangul: '병', element: 'fire', yinYang: 'yang' },
  { index: 3, hanja: '丁', hangul: '정', element: 'fire', yinYang: 'yin' },
  { index: 4, hanja: '戊', hangul: '무', element: 'earth', yinYang: 'yang' },
  { index: 5, hanja: '己', hangul: '기', element: 'earth', yinYang: 'yin' },
  { index: 6, hanja: '庚', hangul: '경', element: 'metal', yinYang: 'yang' },
  { index: 7, hanja: '辛', hangul: '신', element: 'metal', yinYang: 'yin' },
  { index: 8, hanja: '壬', hangul: '임', element: 'water', yinYang: 'yang' },
  { index: 9, hanja: '癸', hangul: '계', element: 'water', yinYang: 'yin' },
] as const;

export const BRANCHES: readonly BranchInfo[] = [
  { index: 0, hanja: '子', hangul: '자', element: 'water', yinYang: 'yang', animal: '쥐', animalHanja: '鼠', hourStart: 23 },
  { index: 1, hanja: '丑', hangul: '축', element: 'earth', yinYang: 'yin', animal: '소', animalHanja: '牛', hourStart: 1 },
  { index: 2, hanja: '寅', hangul: '인', element: 'wood', yinYang: 'yang', animal: '호랑이', animalHanja: '虎', hourStart: 3 },
  { index: 3, hanja: '卯', hangul: '묘', element: 'wood', yinYang: 'yin', animal: '토끼', animalHanja: '兎', hourStart: 5 },
  { index: 4, hanja: '辰', hangul: '진', element: 'earth', yinYang: 'yang', animal: '용', animalHanja: '龍', hourStart: 7 },
  { index: 5, hanja: '巳', hangul: '사', element: 'fire', yinYang: 'yin', animal: '뱀', animalHanja: '蛇', hourStart: 9 },
  { index: 6, hanja: '午', hangul: '오', element: 'fire', yinYang: 'yang', animal: '말', animalHanja: '馬', hourStart: 11 },
  { index: 7, hanja: '未', hangul: '미', element: 'earth', yinYang: 'yin', animal: '양', animalHanja: '羊', hourStart: 13 },
  { index: 8, hanja: '申', hangul: '신', element: 'metal', yinYang: 'yang', animal: '원숭이', animalHanja: '猴', hourStart: 15 },
  { index: 9, hanja: '酉', hangul: '유', element: 'metal', yinYang: 'yin', animal: '닭', animalHanja: '鷄', hourStart: 17 },
  { index: 10, hanja: '戌', hangul: '술', element: 'earth', yinYang: 'yang', animal: '개', animalHanja: '狗', hourStart: 19 },
  { index: 11, hanja: '亥', hangul: '해', element: 'water', yinYang: 'yin', animal: '돼지', animalHanja: '豬', hourStart: 21 },
] as const;

/**
 * 지장간(支藏干) — [여기, 중기, 정기] 순. days 는 월률분야 일수(합 30).
 * 정기(마지막 항목)가 지지의 본기이며 십신 판정의 기준이 된다.
 */
export const HIDDEN_STEMS: readonly (readonly { stem: number; days: number }[])[] = [
  /* 子 */ [{ stem: 8, days: 10 }, { stem: 9, days: 20 }],
  /* 丑 */ [{ stem: 9, days: 9 }, { stem: 7, days: 3 }, { stem: 5, days: 18 }],
  /* 寅 */ [{ stem: 4, days: 7 }, { stem: 2, days: 7 }, { stem: 0, days: 16 }],
  /* 卯 */ [{ stem: 0, days: 10 }, { stem: 1, days: 20 }],
  /* 辰 */ [{ stem: 1, days: 9 }, { stem: 9, days: 3 }, { stem: 4, days: 18 }],
  /* 巳 */ [{ stem: 4, days: 7 }, { stem: 6, days: 7 }, { stem: 2, days: 16 }],
  /* 午 */ [{ stem: 2, days: 10 }, { stem: 5, days: 9 }, { stem: 3, days: 11 }],
  /* 未 */ [{ stem: 3, days: 9 }, { stem: 1, days: 3 }, { stem: 5, days: 18 }],
  /* 申 */ [{ stem: 4, days: 7 }, { stem: 8, days: 7 }, { stem: 6, days: 16 }],
  /* 酉 */ [{ stem: 6, days: 10 }, { stem: 7, days: 20 }],
  /* 戌 */ [{ stem: 7, days: 9 }, { stem: 3, days: 3 }, { stem: 4, days: 18 }],
  /* 亥 */ [{ stem: 4, days: 7 }, { stem: 0, days: 7 }, { stem: 8, days: 16 }],
];

/** 지지 본기(정기) 천간 인덱스 */
export function mainHiddenStem(branch: number): number {
  const list = HIDDEN_STEMS[mod(branch, 12)]!;
  return list[list.length - 1]!.stem;
}

/** 납음오행 — 60갑자를 2개씩 묶은 30개 */
export const NAPEUM: readonly { name: string; hanja: string; element: Element }[] = [
  { name: '해중금', hanja: '海中金', element: 'metal' },
  { name: '노중화', hanja: '爐中火', element: 'fire' },
  { name: '대림목', hanja: '大林木', element: 'wood' },
  { name: '노방토', hanja: '路傍土', element: 'earth' },
  { name: '검봉금', hanja: '劍鋒金', element: 'metal' },
  { name: '산두화', hanja: '山頭火', element: 'fire' },
  { name: '간하수', hanja: '澗下水', element: 'water' },
  { name: '성두토', hanja: '城頭土', element: 'earth' },
  { name: '백랍금', hanja: '白蠟金', element: 'metal' },
  { name: '양류목', hanja: '楊柳木', element: 'wood' },
  { name: '천중수', hanja: '泉中水', element: 'water' },
  { name: '옥상토', hanja: '屋上土', element: 'earth' },
  { name: '벽력화', hanja: '霹靂火', element: 'fire' },
  { name: '송백목', hanja: '松柏木', element: 'wood' },
  { name: '장류수', hanja: '長流水', element: 'water' },
  { name: '사중금', hanja: '沙中金', element: 'metal' },
  { name: '산하화', hanja: '山下火', element: 'fire' },
  { name: '평지목', hanja: '平地木', element: 'wood' },
  { name: '벽상토', hanja: '壁上土', element: 'earth' },
  { name: '금박금', hanja: '金箔金', element: 'metal' },
  { name: '복등화', hanja: '覆燈火', element: 'fire' },
  { name: '천하수', hanja: '天河水', element: 'water' },
  { name: '대역토', hanja: '大驛土', element: 'earth' },
  { name: '차천금', hanja: '釵釧金', element: 'metal' },
  { name: '상자목', hanja: '桑柘木', element: 'wood' },
  { name: '대계수', hanja: '大溪水', element: 'water' },
  { name: '사중토', hanja: '沙中土', element: 'earth' },
  { name: '천상화', hanja: '天上火', element: 'fire' },
  { name: '석류목', hanja: '石榴木', element: 'wood' },
  { name: '대해수', hanja: '大海水', element: 'water' },
];

/** 12절(節) — 월주 경계. 순서대로 寅월(입춘)부터 丑월(소한)까지. key 는 lunar-javascript 절기명 */
export const MONTH_JIE: readonly { key: string; hangul: string; branch: number }[] = [
  { key: '立春', hangul: '입춘', branch: 2 },
  { key: '惊蛰', hangul: '경칩', branch: 3 },
  { key: '清明', hangul: '청명', branch: 4 },
  { key: '立夏', hangul: '입하', branch: 5 },
  { key: '芒种', hangul: '망종', branch: 6 },
  { key: '小暑', hangul: '소서', branch: 7 },
  { key: '立秋', hangul: '입추', branch: 8 },
  { key: '白露', hangul: '백로', branch: 9 },
  { key: '寒露', hangul: '한로', branch: 10 },
  { key: '立冬', hangul: '입동', branch: 11 },
  { key: '大雪', hangul: '대설', branch: 0 },
  { key: '小寒', hangul: '소한', branch: 1 },
];

/** 24절기 한글명 (lunar-javascript 키 → 한글) */
export const SOLAR_TERM_KO: Record<string, string> = {
  '冬至': '동지', '小寒': '소한', '大寒': '대한', '立春': '입춘', '雨水': '우수', '惊蛰': '경칩',
  '春分': '춘분', '清明': '청명', '谷雨': '곡우', '立夏': '입하', '小满': '소만', '芒种': '망종',
  '夏至': '하지', '小暑': '소서', '大暑': '대서', '立秋': '입추', '处暑': '처서', '白露': '백로',
  '秋分': '추분', '寒露': '한로', '霜降': '상강', '立冬': '입동', '小雪': '소설', '大雪': '대설',
};

export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** 60갑자 인덱스 → [천간, 지지] */
export function ganzhiFromIndex(i: number): { stem: number; branch: number } {
  const n = mod(i, 60);
  return { stem: n % 10, branch: n % 12 };
}

/** [천간, 지지] → 60갑자 인덱스 (천간·지지 음양이 맞지 않으면 -1) */
export function ganzhiIndex(stem: number, branch: number): number {
  if (mod(stem, 2) !== mod(branch, 2)) return -1;
  // 6 * stem - 5 * branch ≡ index (mod 60)
  return mod(6 * stem - 5 * branch, 60);
}

export function ganzhiHanja(stem: number, branch: number): string {
  return STEMS[mod(stem, 10)]!.hanja + BRANCHES[mod(branch, 12)]!.hanja;
}

export function ganzhiHangul(stem: number, branch: number): string {
  return STEMS[mod(stem, 10)]!.hangul + BRANCHES[mod(branch, 12)]!.hangul;
}

/** 오행 상생: a 가 생하는 오행 */
export function generates(e: Element): Element {
  return ELEMENTS[(ELEMENTS.indexOf(e) + 1) % 5]!;
}

/** 오행 상극: a 가 극하는 오행 */
export function controls(e: Element): Element {
  return ELEMENTS[(ELEMENTS.indexOf(e) + 2) % 5]!;
}

/** b 를 생해주는 오행 */
export function generatedBy(e: Element): Element {
  return ELEMENTS[(ELEMENTS.indexOf(e) + 4) % 5]!;
}

/** b 를 극하는 오행 */
export function controlledBy(e: Element): Element {
  return ELEMENTS[(ELEMENTS.indexOf(e) + 3) % 5]!;
}
