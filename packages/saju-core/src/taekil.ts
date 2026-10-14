/**
 * 택일(擇日) — 목적(이사·계약·면접/시험·결혼·개업·여행)에 맞는 좋은 날 고르기.
 *
 * 하루의 점수는 두 축을 더해 만든다(근거·가중치는 docs/SAJU_ENGINE.md §8).
 *  1) 통서(通書) 축 — 누구에게나 같은 그날의 성질
 *     건제12신(十二直), 황도·흑도(12천신), 천덕·월덕·천사일, 사리·사절일(절기 경계),
 *     월기일, 손 없는 날, 귀기일, 윤달, 팽조백기
 *  2) 본명(本命) 축 — 그날 일진이 내 사주와 맞는가
 *     일진 ↔ 일주·년지의 합·충·형·파·해·원진, 천을귀인, 공망, 용신, 목적별 십신·신살
 *
 * 결과는 점수·등급·근거 코드(라벨)만 제공하고, 문장은 API 콘텐츠 계층이 만든다.
 * 같은 입력은 항상 같은 결과(난수 없음).
 */
import { BRANCHES, MONTH_JIE, STEMS, mainHiddenStem, mod } from './constants.js';
import type { Element } from './constants.js';
import type { TenGod } from './basics.js';
import { tenGodOf } from './basics.js';
import type { LunarDate } from './calendar.js';
import { addDays, dayGanzhiIndex, isValidSolarDate, monthBoundaries, solarTermsOfYear, solarToLunar } from './calendar.js';
import type { SajuChart } from './chart.js';
import { branchBreak, branchClash, branchHarm, branchPunish, branchWonjin, halfCombine, sixCombine, stemClash, stemCombine, threeCombineGroupOf } from './relations.js';
import { gongmangOf } from './shinsal.js';

// ---------------------------------------------------------------------------
// 목적
// ---------------------------------------------------------------------------

export type TaekilPurpose = 'move' | 'contract' | 'exam' | 'wedding' | 'opening' | 'travel';
export const TAEKIL_PURPOSE_KEYS: readonly TaekilPurpose[] = ['move', 'contract', 'exam', 'wedding', 'opening', 'travel'];

/** 목적 — almanac 은 통서(通書)의 용사(用事) 이름 */
export const TAEKIL_PURPOSES: Record<TaekilPurpose, { label: string; almanac: string }> = {
  move: { label: '이사', almanac: '移徙·入宅' },
  contract: { label: '계약', almanac: '立券·交易' },
  exam: { label: '면접·시험', almanac: '上官·入學' },
  wedding: { label: '결혼', almanac: '嫁娶' },
  opening: { label: '개업', almanac: '開市' },
  travel: { label: '여행·출발', almanac: '出行' },
};

/** 한 번에 볼 수 있는 기간(일)과 후보 날짜 수 */
export const TAEKIL_MAX_RANGE_DAYS = 92;
export const TAEKIL_MIN_CANDIDATES = 2;
export const TAEKIL_MAX_CANDIDATES = 10;
/** 지원 날짜 — 음력 변환(KASI 데이터)이 2050년까지 */
export const TAEKIL_MIN_DATE = '1901-01-01';
export const TAEKIL_MAX_DATE = '2050-12-31';

// ---------------------------------------------------------------------------
// 등급
// ---------------------------------------------------------------------------

export type TaekilGrade = 'best' | 'good' | 'normal' | 'caution' | 'avoid';
export const TAEKIL_GRADE_LABEL: Record<TaekilGrade, string> = { best: '대길', good: '길', normal: '보통', caution: '주의', avoid: '피함' };
export const TAEKIL_GRADES: readonly TaekilGrade[] = ['best', 'good', 'normal', 'caution', 'avoid'];

/** 기준점 50 에서 출발한 점수 → 등급. 탈락 사유가 있으면 점수와 무관하게 '피함' */
export function taekilGradeOf(score: number, excluded = false): TaekilGrade {
  if (excluded) return 'avoid';
  return score >= 68 ? 'best' : score >= 58 ? 'good' : score >= 44 ? 'normal' : score >= 34 ? 'caution' : 'avoid';
}

// ---------------------------------------------------------------------------
// 통서(通書) 요소
// ---------------------------------------------------------------------------

export type DayOfficer = '건' | '제' | '만' | '평' | '정' | '집' | '파' | '위' | '성' | '수' | '개' | '폐';

/** 건제12신(建除十二神, 十二直) — 월건(月建)과 같은 지지의 날이 建, 이후 순서대로 */
export const DAY_OFFICERS: readonly { name: DayOfficer; hanja: string; meaning: string }[] = [
  { name: '건', hanja: '建', meaning: '세우고 시작하는 날' },
  { name: '제', hanja: '除', meaning: '묵은 것을 덜어 내는 날' },
  { name: '만', hanja: '滿', meaning: '가득 차는 날' },
  { name: '평', hanja: '平', meaning: '고르고 평평한 날' },
  { name: '정', hanja: '定', meaning: '자리를 정하는 날' },
  { name: '집', hanja: '執', meaning: '붙잡아 지키는 날' },
  { name: '파', hanja: '破', meaning: '깨지는 날(월파)' },
  { name: '위', hanja: '危', meaning: '높은 곳에 선 듯 조심하는 날' },
  { name: '성', hanja: '成', meaning: '이루어지는 날' },
  { name: '수', hanja: '收', meaning: '거두어들이는 날' },
  { name: '개', hanja: '開', meaning: '열리는 날' },
  { name: '폐', hanja: '閉', meaning: '닫히는 날' },
];

/** 일진 지지와 월건(절기 기준 월지)으로 건제12신 순번(0=建) */
export function dayOfficerIndex(dayBranch: number, monthBranch: number): number {
  return mod(dayBranch - monthBranch, 12);
}

/** 12천신(天神) — 황도(黃道) 6, 흑도(黑道) 6 */
export const TIAN_SHEN: readonly { name: string; hanja: string; yellow: boolean }[] = [
  { name: '청룡', hanja: '青龍', yellow: true },
  { name: '명당', hanja: '明堂', yellow: true },
  { name: '천형', hanja: '天刑', yellow: false },
  { name: '주작', hanja: '朱雀', yellow: false },
  { name: '금궤', hanja: '金匱', yellow: true },
  { name: '천덕', hanja: '天德', yellow: true },
  { name: '백호', hanja: '白虎', yellow: false },
  { name: '옥당', hanja: '玉堂', yellow: true },
  { name: '천뢰', hanja: '天牢', yellow: false },
  { name: '현무', hanja: '玄武', yellow: false },
  { name: '사명', hanja: '司命', yellow: true },
  { name: '구진', hanja: '勾陳', yellow: false },
];

/**
 * 청룡(青龍)이 드는 지지 — "寅申需加子, 卯酉却在寅, 辰戌龍位上, 巳亥午中尋, 子午臨申地, 丑未戌上行"
 * 寅申월 子, 卯酉월 寅, 辰戌월 辰, 巳亥월 午, 子午월 申, 丑未월 戌 = (월지 − 寅) × 2
 */
export function tianShenIndex(dayBranch: number, monthBranch: number): number {
  const qinglong = mod((monthBranch - 2) * 2, 12);
  return mod(dayBranch - qinglong, 12);
}

/** 황도시(黃道時) — 같은 12천신을 일진 지지 기준으로 시(時)에 돌린다. 길한 시지 6개 */
export function yellowHoursOf(dayBranch: number): number[] {
  return Array.from({ length: 12 }, (_, h) => h).filter((h) => TIAN_SHEN[tianShenIndex(h, dayBranch)]!.yellow);
}

/** 월덕(月德) — 월지 삼합의 양간: 寅午戌→丙, 申子辰→壬, 亥卯未→甲, 巳酉丑→庚 */
function woldeokStem(monthBranch: number): number {
  const wang = threeCombineGroupOf(monthBranch)[1];
  return ({ 6: 2, 0: 8, 3: 0, 9: 6 } as Record<number, number>)[wang]!;
}
/**
 * 천덕(天德) — 協紀辨方書: 正丁 二坤 三壬 四辛 五乾 六甲 七癸 八艮 九丙 十乙 十一巽 十二庚.
 * 卯·午·酉·子월은 괘(坤乾艮巽, 방위)라 날짜에는 붙지 않는다 → null
 */
const CHEONDEOK_STEM: (number | null)[] = [
  /* 子 */ null, /* 丑 */ 6, /* 寅 */ 3, /* 卯 */ null, /* 辰 */ 8, /* 巳 */ 7,
  /* 午 */ null, /* 未 */ 0, /* 申 */ 9, /* 酉 */ null, /* 戌 */ 2, /* 亥 */ 1,
];
/** 천사일(天赦日) — 봄(寅卯辰월) 戊寅, 여름(巳午未) 甲午, 가을(申酉戌) 戊申, 겨울(亥子丑) 甲子 */
function isCheonsa(monthBranch: number, stem: number, branch: number): boolean {
  const season = Math.floor(mod(monthBranch - 2, 12) / 3); // 0 봄 1 여름 2 가을 3 겨울
  const [s, b] = ([[4, 2], [0, 6], [4, 8], [0, 0]] as const)[season]!;
  return stem === s && branch === b;
}
/** 귀기일(歸忌日) — 맹월(寅申巳亥) 丑, 중월(子午卯酉) 寅, 계월(辰戌丑未) 子 */
function isGwigi(monthBranch: number, branch: number): boolean {
  const kind = mod(monthBranch - 2, 3); // 0 맹 1 중 2 계
  return branch === [1, 2, 0][kind];
}

/** 팽조백기(彭祖百忌) — 천간·지지별 금기 한 줄 */
export const PENGZU_STEM = ['甲不開倉', '乙不栽植', '丙不修竈', '丁不剃頭', '戊不受田', '己不破券', '庚不經絡', '辛不合醬', '壬不泱水', '癸不詞訟'] as const;
export const PENGZU_BRANCH = ['子不問卜', '丑不冠帶', '寅不祭祀', '卯不穿井', '辰不哭泣', '巳不遠行', '午不苫蓋', '未不服藥', '申不安床', '酉不會客', '戌不吃犬', '亥不嫁娶'] as const;

export type SonDirection = '동' | '남' | '서' | '북';
/** 손(損) — 음력 날짜 끝자리 1·2 동, 3·4 남, 5·6 서, 7·8 북, 9·0 은 손 없는 날 */
export function sonDirectionOf(lunarDay: number): SonDirection | null {
  const d = lunarDay % 10;
  if (d === 9 || d === 0) return null;
  return (['동', '남', '서', '북'] as const)[Math.floor((d - 1) / 2)]!;
}

/** 월기일(月忌日) — 음력 5·14·23일 */
export const WOLGI_DAYS: readonly number[] = [5, 14, 23];

// ---------------------------------------------------------------------------
// 날짜 유틸 (KST 기준)
// ---------------------------------------------------------------------------

export interface Ymd {
  year: number;
  month: number;
  day: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const ymdKey = (d: Ymd) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;
const KST_MS = 9 * 3_600_000;
const kstKeyOf = (utcMs: number) => {
  const d = new Date(utcMs + KST_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

export class TaekilInputError extends Error {}

/** 'YYYY-MM-DD' → Ymd (형식·실재 날짜·지원 범위 검사) */
export function parseYmd(s: string): Ymd {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new TaekilInputError(`날짜 형식이 올바르지 않아요: ${s}`);
  const d = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  if (!isValidSolarDate(d.year, d.month, d.day)) throw new TaekilInputError(`없는 날짜예요: ${s}`);
  if (s < TAEKIL_MIN_DATE || s > TAEKIL_MAX_DATE) throw new TaekilInputError(`${TAEKIL_MIN_DATE.slice(0, 4)}~${TAEKIL_MAX_DATE.slice(0, 4)}년 사이 날짜만 볼 수 있어요.`);
  return d;
}

/** 시작~끝(포함) 날짜 목록 — 최대 TAEKIL_MAX_RANGE_DAYS 일 */
export function taekilDateRange(from: string, to: string): Ymd[] {
  const a = parseYmd(from);
  parseYmd(to);
  if (to < from) throw new TaekilInputError('끝 날짜가 시작 날짜보다 빨라요.');
  const out: Ymd[] = [];
  for (let d = a; ymdKey(d) <= to; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > TAEKIL_MAX_RANGE_DAYS) throw new TaekilInputError(`기간은 최대 ${TAEKIL_MAX_RANGE_DAYS}일(약 3개월)까지 볼 수 있어요.`);
  }
  return out;
}

/** 해마다 절기 표를 한 번만 만든다: KST 날짜 → 그날 드는 절기 이름 */
const termCache = new Map<number, Map<string, string>>();
function termsByDate(year: number): Map<string, string> {
  let m = termCache.get(year);
  if (!m) {
    m = new Map(solarTermsOfYear(year).map((t) => [kstKeyOf(t.utcMs), t.name]));
    termCache.set(year, m);
  }
  return m;
}
function termOn(d: Ymd): string | null {
  return termsByDate(d.year).get(ymdKey(d)) ?? null;
}

/**
 * 그날의 월건(月建) — 12절(입춘·경칩…)이 드는 날(KST 날짜)부터 새 달로 본다.
 * 그래서 절입일에는 건제12신이 전날과 같은 직(直)으로 한 번 겹친다(통서의 규칙과 같다).
 */
export function monthBranchOfDate(d: Ymd): number {
  const key = ymdKey(d);
  for (const sy of [d.year, d.year - 1]) {
    const b = monthBoundaries(sy);
    for (let i = 11; i >= 0; i--) {
      if (kstKeyOf(b[i]!.utcMs) <= key && key < kstKeyOf(b[i + 1]!.utcMs)) return MONTH_JIE[i]!.branch;
    }
  }
  throw new TaekilInputError(`월건을 찾지 못했어요: ${key}`);
}

// ---------------------------------------------------------------------------
// 그날의 통서 정보
// ---------------------------------------------------------------------------

export interface TaekilAlmanac {
  date: string;
  /** 0=일요일 */
  weekday: number;
  ganzhi: { index: number; stem: number; branch: number; hanja: string; hangul: string };
  /** 한국 음력(KASI) */
  lunar: LunarDate | null;
  /** 월건(절기 기준 월지) */
  monthBranch: number;
  officer: { index: number; name: DayOfficer; hanja: string };
  tianShen: { index: number; name: string; hanja: string; yellow: boolean };
  /** 손 없는 날(음력 9·10·19·20·29·30) */
  sonFree: boolean;
  /** 손이 머무는 방향 (손 없는 날은 null) */
  sonDirection: SonDirection | null;
  cheondeok: boolean;
  woldeok: boolean;
  cheonsa: boolean;
  /** 사리일(四離, 춘분·하지·추분·동지 전날) — 다음 날 드는 절기 이름 */
  sari: string | null;
  /** 사절일(四絶, 입춘·입하·입추·입동 전날) */
  sajeol: string | null;
  wolgi: boolean;
  gwigi: boolean;
  leapMonth: boolean;
  /** 이날 드는 24절기 */
  term: string | null;
  /** 이날 12절이 들어 월건이 바뀌는가 */
  monthStarts: boolean;
  pengzu: { stem: string; branch: string };
}

const SARI_TERMS = new Set(['춘분', '하지', '추분', '동지']);
const SAJEOL_TERMS = new Set(['입춘', '입하', '입추', '입동']);
const JIE_NAMES = new Set(MONTH_JIE.map((j) => j.hangul));

export function taekilAlmanac(d: Ymd): TaekilAlmanac {
  const date = ymdKey(d);
  const gz = dayGanzhiIndex(d.year, d.month, d.day);
  const stem = gz % 10;
  const branch = gz % 12;
  const monthBranch = monthBranchOfDate(d);
  const lunar = solarToLunar(d);
  const oi = dayOfficerIndex(branch, monthBranch);
  const ti = tianShenIndex(branch, monthBranch);
  const term = termOn(d);
  const nextTerm = termOn(addDays(d, 1));
  const cd = CHEONDEOK_STEM[monthBranch];
  const sonDirection = lunar ? sonDirectionOf(lunar.day) : null;
  return {
    date,
    weekday: new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay(),
    ganzhi: { index: gz, stem, branch, hanja: STEMS[stem]!.hanja + BRANCHES[branch]!.hanja, hangul: STEMS[stem]!.hangul + BRANCHES[branch]!.hangul },
    lunar,
    monthBranch,
    officer: { index: oi, name: DAY_OFFICERS[oi]!.name, hanja: DAY_OFFICERS[oi]!.hanja },
    tianShen: { index: ti, ...TIAN_SHEN[ti]! },
    sonFree: lunar !== null && sonDirection === null,
    sonDirection,
    cheondeok: cd !== null && cd === stem,
    woldeok: woldeokStem(monthBranch) === stem,
    cheonsa: isCheonsa(monthBranch, stem, branch),
    sari: nextTerm && SARI_TERMS.has(nextTerm) ? nextTerm : null,
    sajeol: nextTerm && SAJEOL_TERMS.has(nextTerm) ? nextTerm : null,
    wolgi: lunar !== null && WOLGI_DAYS.includes(lunar.day),
    gwigi: isGwigi(monthBranch, branch),
    leapMonth: lunar?.isLeapMonth ?? false,
    term,
    monthStarts: term !== null && JIE_NAMES.has(term),
    pengzu: { stem: PENGZU_STEM[stem]!, branch: PENGZU_BRANCH[branch]! },
  };
}

// ---------------------------------------------------------------------------
// 가중치 표
// ---------------------------------------------------------------------------

/**
 * 건제12신의 목적별 가중치.
 *
 * 직(直)마다 무엇에 좋고 나쁜지는 문헌마다 다르다 — 통속 구결("建滿平收黑, 除危定執黃, 成開皆可用, 閉破不相當"),
 * 協紀辨方書가 인용한 選擇宗鏡("平成開危最吉, 定除次吉, 破大凶"), 協紀의 신살별 宜忌가 서로 어긋난다.
 * 그래서 한 구결을 고르지 않고, 協紀辨方書의 일별 宜忌 체계를 구현한 lunar-javascript 에서
 * 2000-01-01~2029-12-31(10,958일)의 宜·忌 표기를 직별로 집계해
 *   가중치 = round((그 직에서 용사가 宜로 적힌 비율 − 忌로 적힌 비율)% ÷ 6), −10~+7
 * 로 정했다(용사: 이사 移徙·入宅, 계약 立券·交易, 면접·시험 入學·赴任, 결혼 嫁娶, 개업 開市, 여행 出行).
 * 집계 원자료(net%)는 OFFICER_NET, 재현 스크립트·검증은 docs/SAJU_ENGINE.md §8 과 test/taekil.test.ts.
 * 破(월파)는 모든 용사에서 宜가 0% 라 별도로 탈락 사유로 처리한다.
 */
export const OFFICER_NET: Record<TaekilPurpose, Record<DayOfficer, number>> = {
  move: { 건: -30, 제: 26, 만: -28, 평: -33, 정: 37, 집: -4, 파: -62, 위: 27, 성: -9, 수: -22, 개: -20, 폐: -19 },
  contract: { 건: 11, 제: 21, 만: 39, 평: -7, 정: 32, 집: -27, 파: -43, 위: 31, 성: 38, 수: -6, 개: 24, 폐: 18 },
  exam: { 건: -10, 제: 5, 만: 2, 평: -16, 정: 4, 집: -2, 파: -41, 위: 6, 성: -6, 수: -13, 개: 2, 폐: -3 },
  wedding: { 건: -20, 제: 11, 만: -4, 평: -31, 정: 18, 집: -4, 파: -75, 위: 26, 성: -34, 수: -19, 개: 33, 폐: -21 },
  opening: { 건: -12, 제: 2, 만: 30, 평: -20, 정: 1, 집: -73, 파: -60, 위: 13, 성: 39, 수: -57, 개: 14, 폐: -31 },
  travel: { 건: 30, 제: 26, 만: 20, 평: -14, 정: 33, 집: 17, 파: -48, 위: 44, 성: 8, 수: -15, 개: 37, 폐: 7 },
};
export const OFFICER_WEIGHT: Record<TaekilPurpose, Record<DayOfficer, number>> = Object.fromEntries(
  Object.entries(OFFICER_NET).map(([p, row]) => [p, Object.fromEntries(Object.entries(row).map(([k, net]) => [k, Math.max(-10, Math.min(7, Math.round(net / 6)))]))]),
) as Record<TaekilPurpose, Record<DayOfficer, number>>;

export const W = {
  yellowRoad: 5,
  blackRoad: -3,
  cheondeok: 5,
  woldeok: 5,
  cheonsa: 8,
  sariSajeol: -12,
  wolgi: -4,
  sonFreeMove: 10,
  gwigiMove: -6,
  /** 요즘 풍습 기준(『동국세시기』는 오히려 윤달 혼인을 좋다고 적었다) */
  leapWedding: -3,
  leapMove: 2,
  pengzu: -5,
  // 본명(本命) — 일지는 나 자신·배우자 자리, 년지는 본명(띠)
  day: { clash: -16, punish: -6, selfPunish: -3, wonjin: -5, break: -3, harm: -3, six: 7, half: 4 },
  year: { clash: -10, punish: -4, selfPunish: -2, wonjin: -3, break: -2, harm: -2, six: 4, half: 3 },
  partnerDay: { clash: -12, punish: -4, wonjin: -3, six: 4 },
  partnerYear: { clash: -6, six: 2 },
  stemCombine: 4,
  stemClash: -5,
  /** 천간충 + 일지충 = 천극지충(반음) 추가 감점 */
  fullClash: -6,
  cheoneul: 7,
  partnerCheoneul: 3,
  gongmang: -4,
  fitStem: { yongsin: 4, heesin: 2, gisin: -4, neutral: 0 },
  fitBranch: { yongsin: 3, heesin: 1, gisin: -3, neutral: 0 },
} as const;

// ---------------------------------------------------------------------------
// 평가
// ---------------------------------------------------------------------------

export type TaekilFactorGroup = 'almanac' | 'personal' | 'purpose';
export type TaekilFactorCode =
  | 'officer' | 'yellow_road' | 'black_road' | 'cheondeok' | 'woldeok' | 'cheonsa'
  | 'sari' | 'sajeol' | 'wolgi' | 'son_free' | 'son_direction' | 'gwigi' | 'leap_month' | 'pengzu' | 'month_start'
  | 'day_clash' | 'day_punish' | 'day_wonjin' | 'day_break' | 'day_harm' | 'day_six' | 'day_half'
  | 'year_clash' | 'year_punish' | 'year_wonjin' | 'year_break' | 'year_harm' | 'year_six' | 'year_half'
  | 'stem_combine' | 'stem_clash' | 'full_clash' | 'cheoneul' | 'gongmang' | 'yongsin' | 'gisin'
  | 'ten_god' | 'munchang' | 'yeokma'
  | 'partner_clash' | 'partner_punish' | 'partner_wonjin' | 'partner_six' | 'partner_year_clash' | 'partner_year_six' | 'partner_cheoneul';

export interface TaekilFactor {
  code: TaekilFactorCode;
  group: TaekilFactorGroup;
  tone: 'good' | 'bad' | 'info';
  /** 점수 가감 (info 는 0) */
  weight: number;
  /** 짧은 이름 — 예: "성(成)일", "황도일 · 청룡", "일지 충" */
  label: string;
  /** 근거 글자 — 예: "일진 午 ↔ 일지 子" */
  detail?: string;
  /** 점수와 무관하게 이 날을 빼는 사유(월파·사리사절·일지충) */
  excludes?: boolean;
}

export interface TaekilDay {
  almanac: TaekilAlmanac;
  /** 0~100 */
  score: number;
  grade: TaekilGrade;
  excluded: boolean;
  /** 영향이 큰 순 (탈락 사유 → |가중치|) */
  factors: TaekilFactor[];
  /** 일간 기준 그날 천간의 십신 */
  tenGod: TenGod;
}

export interface TaekilOptions {
  /** 결혼 택일에서 함께 볼 상대 사주 */
  partner?: SajuChart | null;
}

const CHEONEUL: number[][] = [[1, 7], [0, 8], [11, 9], [11, 9], [1, 7], [0, 8], [1, 7], [2, 6], [5, 3], [5, 3]];
const MUNCHANG = [5, 6, 8, 9, 8, 9, 11, 0, 2, 3];

const hz = (b: number) => BRANCHES[mod(b, 12)]!.hanja;
const sz = (s: number) => STEMS[mod(s, 10)]!.hanja;
const EL_KO: Record<Element, string> = { wood: '목', fire: '화', earth: '토', metal: '금', water: '수' };

type Fit = 'yongsin' | 'heesin' | 'gisin' | 'neutral';
function fitOf(chart: SajuChart, el: Element): Fit {
  if (el === chart.yongsin.yongsin) return 'yongsin';
  if (el === chart.yongsin.heesin) return 'heesin';
  if (el === chart.yongsin.gisin) return 'gisin';
  return 'neutral';
}

/** 그날 일진 지지와 기준 지지(일지·년지)의 관계 → 요인 목록 */
function branchFactors(dayBranch: number, base: number, who: 'day' | 'year', baseLabel: string): TaekilFactor[] {
  const w = W[who];
  const out: TaekilFactor[] = [];
  const detail = `일진 ${hz(dayBranch)} ↔ ${baseLabel} ${hz(base)}`;
  const push = (code: TaekilFactorCode, weight: number, label: string, excludes = false) =>
    out.push({ code, group: 'personal', tone: weight > 0 ? 'good' : 'bad', weight, label, detail, ...(excludes ? { excludes } : {}) });
  if (branchClash(dayBranch, base)) push(`${who}_clash`, w.clash, `${baseLabel} 충(沖)`, who === 'day');
  if (branchPunish(dayBranch, base)) push(`${who}_punish`, mod(dayBranch, 12) === mod(base, 12) ? w.selfPunish : w.punish, mod(dayBranch, 12) === mod(base, 12) ? `${baseLabel} 자형(自刑)` : `${baseLabel} 형(刑)`);
  if (branchWonjin(dayBranch, base)) push(`${who}_wonjin`, w.wonjin, `${baseLabel} 원진(怨嗔)`);
  if (branchBreak(dayBranch, base)) push(`${who}_break`, w.break, `${baseLabel} 파(破)`);
  if (branchHarm(dayBranch, base)) push(`${who}_harm`, w.harm, `${baseLabel} 해(害)`);
  const six = sixCombine(dayBranch, base);
  if (six) push(`${who}_six`, w.six, `${baseLabel} 육합(六合)`);
  else if (halfCombine(dayBranch, base)) push(`${who}_half`, w.half, `${baseLabel} 삼합(三合)`);
  return out;
}

/** 목적별 십신 요인 — 일간 기준 그날 천간의 십신 */
function tenGodFactor(purpose: TaekilPurpose, tg: TenGod, male: boolean): TaekilFactor | null {
  /** detail 은 '…기운'으로 끝나는 명사구 — 문장 계층이 이어 붙인다 */
  const mk = (weight: number, why: string): TaekilFactor => ({ code: 'ten_god', group: 'purpose', tone: weight > 0 ? 'good' : 'bad', weight, label: `${tg}일`, detail: why });
  switch (purpose) {
    case 'exam':
      if (tg === '정관' || tg === '편관') return mk(3, '평가·조직과 닿는 관성의 기운');
      if (tg === '정인' || tg === '편인') return mk(3, '공부·문서를 돕는 인성의 기운');
      if (tg === '상관') return mk(-3, '말이 앞서기 쉬운 상관의 기운');
      return null;
    case 'contract':
      if (tg === '정재') return mk(3, '정당한 거래를 뜻하는 정재의 기운');
      if (tg === '정인') return mk(3, '문서·도장을 뜻하는 정인의 기운');
      if (tg === '겁재') return mk(-4, '재물이 나뉘거나 다투기 쉬운 겁재의 기운');
      return null;
    case 'opening':
      if (tg === '식신' || tg === '정재' || tg === '편재') return mk(3, tg === '식신' ? '손님과 일거리가 생기는 식신의 기운' : '돈이 들어오는 재성의 기운');
      if (tg === '겁재') return mk(-4, '재물이 나뉘거나 다투기 쉬운 겁재의 기운');
      return null;
    case 'wedding':
      if (male) {
        if (tg === '정재') return mk(4, '남성에게 배우자를 뜻하는 정재의 기운');
        if (tg === '편재') return mk(2, '남성에게 인연을 뜻하는 편재의 기운');
        if (tg === '겁재') return mk(-3, '배우자 자리(재성)를 누르는 겁재의 기운');
      } else {
        if (tg === '정관') return mk(4, '여성에게 배우자를 뜻하는 정관의 기운');
        if (tg === '편관') return mk(2, '여성에게 인연을 뜻하는 편관의 기운');
        if (tg === '상관') return mk(-3, '배우자 자리(관성)를 누르는 상관의 기운');
      }
      return null;
    case 'move':
      if (tg === '정인') return mk(2, '집과 문서를 뜻하는 정인의 기운');
      return null;
    default:
      return null;
  }
}

const IMPORTANCE = (f: TaekilFactor) => (f.excludes ? 1000 : 0) + Math.abs(f.weight) + (f.tone === 'info' ? -1 : 0);

/** 하루 평가 */
export function evaluateTaekilDay(chart: SajuChart, date: Ymd, purpose: TaekilPurpose, opts: TaekilOptions = {}): TaekilDay {
  const a = taekilAlmanac(date);
  const { stem, branch } = a.ganzhi;
  const f: TaekilFactor[] = [];
  const add = (x: Omit<TaekilFactor, 'tone'> & { tone?: TaekilFactor['tone'] }) => f.push({ tone: x.weight > 0 ? 'good' : x.weight < 0 ? 'bad' : 'info', ...x });

  // ── 통서 ──
  const off = DAY_OFFICERS[a.officer.index]!;
  const offW = OFFICER_WEIGHT[purpose][off.name];
  add({ code: 'officer', group: 'almanac', weight: offW, label: `${off.name}(${off.hanja})일`, detail: off.meaning, ...(off.name === '파' ? { excludes: true } : {}) });
  add({ code: a.tianShen.yellow ? 'yellow_road' : 'black_road', group: 'almanac', weight: a.tianShen.yellow ? W.yellowRoad : W.blackRoad, label: `${a.tianShen.yellow ? '황도' : '흑도'}일(${a.tianShen.name})`, detail: a.tianShen.hanja });
  if (a.cheonsa) add({ code: 'cheonsa', group: 'almanac', weight: W.cheonsa, label: '천사일(天赦日)', detail: `${a.ganzhi.hanja}일` });
  if (a.cheondeok) add({ code: 'cheondeok', group: 'almanac', weight: W.cheondeok, label: '천덕(天德)', detail: `${hz(a.monthBranch)}월의 ${sz(stem)}` });
  if (a.woldeok) add({ code: 'woldeok', group: 'almanac', weight: W.woldeok, label: '월덕(月德)', detail: `${hz(a.monthBranch)}월의 ${sz(stem)}` });
  if (a.sari) add({ code: 'sari', group: 'almanac', weight: W.sariSajeol, label: '사리일(四離日)', detail: `${a.sari} 전날`, excludes: true });
  if (a.sajeol) add({ code: 'sajeol', group: 'almanac', weight: W.sariSajeol, label: '사절일(四絶日)', detail: `${a.sajeol} 전날`, excludes: true });
  if (a.monthStarts && a.term) add({ code: 'month_start', group: 'almanac', weight: 0, label: `${a.term} 절입일`, detail: `이날부터 ${hz(a.monthBranch)}월` });
  if (a.wolgi && purpose !== 'exam') add({ code: 'wolgi', group: 'almanac', weight: W.wolgi, label: '월기일(月忌日)', detail: `음력 ${a.lunar!.day}일` });

  // ── 목적별 통서 ──
  if (purpose === 'move') {
    if (a.sonFree) add({ code: 'son_free', group: 'purpose', weight: W.sonFreeMove, label: '손 없는 날', detail: `음력 ${a.lunar!.day}일` });
    else if (a.sonDirection) add({ code: 'son_direction', group: 'purpose', weight: 0, label: `손 ${a.sonDirection}쪽`, detail: `음력 ${a.lunar!.day}일` });
    if (a.gwigi) add({ code: 'gwigi', group: 'purpose', weight: W.gwigiMove, label: '귀기일(歸忌日)', detail: `${hz(a.monthBranch)}월의 ${hz(branch)}일` });
    if (a.leapMonth) add({ code: 'leap_month', group: 'purpose', weight: W.leapMove, label: '윤달', detail: '탈이 없다는 달' });
  }
  if (purpose === 'wedding') {
    // 귀기일은 協紀辨方書 주석("應止忌般移遠迴，不忌嫁娶")에 따라 혼례에는 적용하지 않는다
    if (a.leapMonth) add({ code: 'leap_month', group: 'purpose', weight: W.leapWedding, label: '윤달', detail: '요즘 혼례를 꺼리는 달' });
    if (branch === 11) add({ code: 'pengzu', group: 'purpose', weight: W.pengzu, label: '해일(亥日)', detail: '彭祖百忌 亥不嫁娶' });
  }
  if (purpose === 'travel') {
    if (branch === 5) add({ code: 'pengzu', group: 'purpose', weight: W.pengzu, label: '사일(巳日)', detail: '彭祖百忌 巳不遠行' });
    // 손은 출행·이사·혼인 등 '그 방향으로' 가는 일을 꺼린다 — 방향을 모르므로 정보로만 알린다
    if (a.sonDirection) add({ code: 'son_direction', group: 'purpose', weight: 0, label: `손 ${a.sonDirection}쪽`, detail: `음력 ${a.lunar!.day}일` });
  }

  // ── 본명 ──
  const ds = chart.dayMaster.index;
  const db = chart.pillars.day.branch.index;
  const yb = chart.pillars.year.branch.index;
  const dayRel = branchFactors(branch, db, 'day', '일지');
  f.push(...dayRel);
  f.push(...branchFactors(branch, yb, 'year', '띠(년지)'));
  if (stemCombine(stem, ds)) add({ code: 'stem_combine', group: 'personal', weight: W.stemCombine, label: '일간 천간합', detail: `일진 ${sz(stem)} ↔ 일간 ${sz(ds)}` });
  if (stemClash(stem, ds)) {
    add({ code: 'stem_clash', group: 'personal', weight: W.stemClash, label: '일간 천간충', detail: `일진 ${sz(stem)} ↔ 일간 ${sz(ds)}` });
    if (dayRel.some((r) => r.code === 'day_clash')) add({ code: 'full_clash', group: 'personal', weight: W.fullClash, label: '천극지충(天剋地沖)', detail: `일진 ${a.ganzhi.hanja} ↔ 일주 ${chart.pillars.day.ganzhi.hanja}` });
  }
  if (CHEONEUL[ds]!.includes(branch)) add({ code: 'cheoneul', group: 'personal', weight: W.cheoneul, label: '천을귀인일', detail: `일간 ${sz(ds)}의 귀인 ${hz(branch)}` });
  if (gongmangOf(ds, db).includes(branch)) add({ code: 'gongmang', group: 'personal', weight: W.gongmang, label: '공망일', detail: `일주 ${chart.pillars.day.ganzhi.hanja}의 공망 ${hz(branch)}` });
  const stemFit = fitOf(chart, STEMS[stem]!.element);
  const branchFit = fitOf(chart, STEMS[mainHiddenStem(branch)]!.element);
  const fitW = W.fitStem[stemFit] + W.fitBranch[branchFit];
  if (fitW > 0) add({ code: 'yongsin', group: 'personal', weight: fitW, label: '용신의 기운', detail: `용신 ${EL_KO[chart.yongsin.yongsin]} · 일진 ${a.ganzhi.hanja}` });
  else if (fitW < 0) add({ code: 'gisin', group: 'personal', weight: fitW, label: '기신의 기운', detail: `기신 ${EL_KO[chart.yongsin.gisin]} · 일진 ${a.ganzhi.hanja}` });

  // ── 목적별 본명 ──
  const tg = tenGodOf(ds, stem);
  const tf = tenGodFactor(purpose, tg, chart.input.gender === 'male');
  if (tf) f.push(tf);
  if (purpose === 'exam' && MUNCHANG[ds] === branch) add({ code: 'munchang', group: 'purpose', weight: 5, label: '문창귀인일', detail: `일간 ${sz(ds)}의 문창 ${hz(branch)}` });
  if (purpose === 'move' || purpose === 'travel') {
    const yeokma = [yb, db].some((b) => mod(threeCombineGroupOf(b)[0] + 6, 12) === branch);
    if (yeokma) add({ code: 'yeokma', group: 'purpose', weight: purpose === 'travel' ? 5 : 3, label: '역마일', detail: `${hz(branch)} — 움직임의 기운` });
  }

  // ── 결혼: 상대 사주 ──
  const partner = purpose === 'wedding' ? opts.partner : null;
  if (partner) {
    const pdb = partner.pillars.day.branch.index;
    const pyb = partner.pillars.year.branch.index;
    const pd = `일진 ${hz(branch)} ↔ 상대 일지 ${hz(pdb)}`;
    if (branchClash(branch, pdb)) add({ code: 'partner_clash', group: 'personal', weight: W.partnerDay.clash, label: '상대 일지 충', detail: pd });
    if (branchPunish(branch, pdb) && mod(branch, 12) !== mod(pdb, 12)) add({ code: 'partner_punish', group: 'personal', weight: W.partnerDay.punish, label: '상대 일지 형', detail: pd });
    if (branchWonjin(branch, pdb)) add({ code: 'partner_wonjin', group: 'personal', weight: W.partnerDay.wonjin, label: '상대 일지 원진', detail: pd });
    if (sixCombine(branch, pdb)) add({ code: 'partner_six', group: 'personal', weight: W.partnerDay.six, label: '상대 일지 육합', detail: pd });
    if (branchClash(branch, pyb)) add({ code: 'partner_year_clash', group: 'personal', weight: W.partnerYear.clash, label: '상대 띠 충', detail: `일진 ${hz(branch)} ↔ 상대 년지 ${hz(pyb)}` });
    else if (sixCombine(branch, pyb)) add({ code: 'partner_year_six', group: 'personal', weight: W.partnerYear.six, label: '상대 띠 육합', detail: `일진 ${hz(branch)} ↔ 상대 년지 ${hz(pyb)}` });
    if (CHEONEUL[partner.dayMaster.index]!.includes(branch)) add({ code: 'partner_cheoneul', group: 'personal', weight: W.partnerCheoneul, label: '상대의 천을귀인일', detail: `상대 일간 ${sz(partner.dayMaster.index)}의 귀인 ${hz(branch)}` });
  }

  const excluded = f.some((x) => x.excludes);
  const raw = 50 + f.reduce((s, x) => s + x.weight, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  f.sort((x, y) => IMPORTANCE(y) - IMPORTANCE(x));
  return { almanac: a, score, grade: taekilGradeOf(score, excluded), excluded, factors: f, tenGod: tg };
}

// ---------------------------------------------------------------------------
// 고르기
// ---------------------------------------------------------------------------

export interface TaekilSelection {
  purpose: TaekilPurpose;
  /** 날짜순 */
  days: TaekilDay[];
  /** 추천 순서(날짜 키) — 탈락일은 맨 뒤 */
  ranking: string[];
  /** 추천 Top 3 (탈락·'피함'은 제외. 좋은 날이 없으면 비어 있을 수 있다) */
  top: string[];
  counts: Record<TaekilGrade, number>;
}

const negatives = (d: TaekilDay) => d.factors.filter((x) => x.weight < 0).reduce((s, x) => s + x.weight, 0);

/** 추천 순서 비교 — 탈락 여부 → 점수 → 흉한 요인이 적은 날 → 이른 날 */
export function compareTaekilDays(x: TaekilDay, y: TaekilDay): number {
  if (x.excluded !== y.excluded) return x.excluded ? 1 : -1;
  if (y.score !== x.score) return y.score - x.score;
  const n = negatives(y) - negatives(x);
  if (n !== 0) return n;
  return x.almanac.date < y.almanac.date ? -1 : 1;
}

/** 날짜 목록(중복 제거·정렬)을 평가하고 Top 3 를 고른다 */
export function selectTaekilDays(chart: SajuChart, purpose: TaekilPurpose, dates: Ymd[], opts: TaekilOptions = {}): TaekilSelection {
  if (!TAEKIL_PURPOSE_KEYS.includes(purpose)) throw new TaekilInputError(`알 수 없는 목적이에요: ${purpose}`);
  const unique = [...new Map(dates.map((d) => [ymdKey(d), d])).values()].sort((a, b) => (ymdKey(a) < ymdKey(b) ? -1 : 1));
  if (unique.length === 0) throw new TaekilInputError('날짜를 골라 주세요.');
  if (unique.length > TAEKIL_MAX_RANGE_DAYS) throw new TaekilInputError(`한 번에 ${TAEKIL_MAX_RANGE_DAYS}일까지 볼 수 있어요.`);
  for (const d of unique) parseYmd(ymdKey(d));
  const days = unique.map((d) => evaluateTaekilDay(chart, d, purpose, opts));
  const ranked = [...days].sort(compareTaekilDays);
  const counts = { best: 0, good: 0, normal: 0, caution: 0, avoid: 0 } as Record<TaekilGrade, number>;
  for (const d of days) counts[d.grade] += 1;
  return {
    purpose,
    days,
    ranking: ranked.map((d) => d.almanac.date),
    top: ranked.filter((d) => d.grade !== 'avoid').slice(0, 3).map((d) => d.almanac.date),
    counts,
  };
}

