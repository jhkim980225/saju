/**
 * 주제별 리포트(연애·결혼운 · 재물·직업운) 문장 도우미.
 * 문체 기준(docs/PLAIN_KOREAN.md): 정식 명리학 용어를 쓰되, 한 리포트에서 처음 나올 때 뜻을 붙인다(termTracker).
 * 한자·간지·점수는 근거(basis)에 둔다. 다른 리포트 모듈(report.ts)의 도우미에 기대지 않도록 여기서 따로 둔다.
 */
import type { Element, SajuChart, TenGod, TenGodGroup } from '@saju/core';
import { TEN_GOD_GROUP } from '@saju/core';

export const GROUPS: TenGodGroup[] = ['비겁', '식상', '재성', '관성', '인성'];

/** 마지막 한글 글자의 받침 유무 — 따옴표·괄호는 건너뛴다 */
function batchimOf(word: string): number | null {
  for (let i = word.length - 1; i >= 0; i--) {
    const c = word.charCodeAt(i);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28;
    if (!/['"’”)\]\s]/.test(word[i]!)) return null;
  }
  return null;
}

/** 조사만 — 받침이 있으면 a, 없으면 b */
export const prt = (word: string, a: string, b: string) => {
  const t = batchimOf(word);
  return t === null || t > 0 ? a : b;
};
/** 낱말 + 조사 */
export const pp = (word: string, a: string, b: string) => word + prt(word, a, b);
/** '(으)로' — 받침이 없거나 ㄹ 받침이면 '로' */
export const ro = (word: string) => {
  const t = batchimOf(word);
  return word + (t === null || t === 0 || t === 8 ? '로' : '으로');
};
/** 목록 + 마지막 낱말에 맞춘 조사 */
export const listPp = (items: string[], a: string, b: string, sep = ', ') => pp(items.join(sep), a, b);
/** 연도 목록 '2027년, 2029년' */
export const yearsText = (ys: number[]) => ys.map((y) => `${y}년`).join(', ');

/** 본문용 오행 이름 — 정식 이름(처음 나올 때는 termTracker 가 '목(나무)'처럼 쉬운 이름을 붙인다) */
export const EL_NAME: Record<Element, string> = { wood: '목', fire: '화', earth: '토', metal: '금', water: '수' };
/** 근거(basis)용 오행 이름 */
export const EL_TERM: Record<Element, string> = { wood: '목(木)', fire: '화(火)', earth: '토(土)', metal: '금(金)', water: '수(水)' };
const EL_HANJA: Record<Element, string> = { wood: '木', fire: '火', earth: '土', metal: '金', water: '水' };

/** 근거용 일간 이름 — '경금(庚金)' */
export const stemTerm = (chart: SajuChart) => {
  const d = chart.dayMaster;
  return `${stemName(chart)}(${d.hanja}${EL_HANJA[d.element]})`;
};
/** 본문용 일간 이름 — '경금' */
export const stemName = (chart: SajuChart) => `${chart.dayMaster.hangul}${EL_NAME[chart.dayMaster.element]}`;

/**
 * 처음 나올 때 붙이는 뜻 — 사주 기초 화면(apps/web/src/lib/sajuBasics.ts)과 같은 내용을 짧게.
 * 전통 개념만 담는다. 달빛사주 자체 계산(점수·등급·용신 계산법·대운 시작 나이)은 본문에서 따로 밝힌다.
 */
export const TERM_DEF: Record<string, string> = {
  일간: '태어난 날의 천간으로, 사주에서 나 자신을 나타내는 글자',
  일지: '태어난 날의 지지',
  월지: '태어난 달의 지지',
  십성: '일간을 기준으로 다른 글자와의 관계를 열 가지로 나눈 것',
  비겁: '일간과 같은 오행으로, 자립심과 경쟁, 동료를 뜻해요',
  식상: '일간이 생하는 오행으로, 재능과 표현을 뜻해요',
  재성: '일간이 극하는 오행으로, 재물과 관리 능력을 뜻해요',
  관성: '일간을 극하는 오행으로, 규범과 책임, 직장을 뜻해요',
  인성: '일간을 생하는 오행으로, 학문과 자격, 도움을 뜻해요',
  비견: '일간과 오행도 음양도 같은 글자로, 대등한 관계와 자립심을 뜻해요',
  겁재: '일간과 오행은 같고 음양이 다른 글자로, 경쟁과 승부욕을 뜻해요',
  식신: '일간이 생하는 오행 가운데 음양이 같은 글자로, 재능과 여유를 뜻해요',
  상관: '일간이 생하는 오행 가운데 음양이 다른 글자로, 언변과 재치, 기존 질서를 바꾸려는 힘을 뜻해요',
  편재: '일간이 극하는 오행 가운데 음양이 같은 글자로, 유동적인 재물과 넓은 활동 범위를 뜻해요',
  정재: '일간이 극하는 오행 가운데 음양이 다른 글자로, 고정적인 수입과 성실한 관리를 뜻해요',
  편관: '일간을 극하는 오행 가운데 음양이 같은 글자로, 압박과 도전, 강한 통제를 뜻해요',
  정관: '일간을 극하는 오행 가운데 음양이 다른 글자로, 규범과 책임, 명예를 뜻해요',
  편인: '일간을 생하는 오행 가운데 음양이 같은 글자로, 독창적인 사고와 전문 기술을 뜻해요',
  정인: '일간을 생하는 오행 가운데 음양이 다른 글자로, 학문과 자격, 보살핌을 뜻해요',
  용신: '사주의 균형을 맞추는 데 가장 필요한 오행',
  희신: '용신을 생하는 오행',
  기신: '용신을 극하는 오행',
  '신강·신약': '일간의 기운이 강한 편인지 약한 편인지를 나누는 기준',
  신살: '글자 조합에 따라 붙는 보조적인 해석 요소',
  도화: '사람의 관심을 끄는 매력과 인기를 뜻하는 신살',
  홍염: '감수성과 분위기에서 드러나는 매력을 뜻하는 신살',
  귀문관살: '예민한 감각과 직관을 뜻하는 신살',
  천간합: '두 천간이 결합하는 관계',
  천간충: '두 천간이 대립하는 관계',
  육합: '두 지지가 짝을 이뤄 결합하는 관계',
  반합: '삼합을 이루는 세 지지 가운데 두 지지가 만난 관계',
  삼합: '세 지지가 모여 한 오행의 기운을 이루는 관계',
  방합: '같은 계절의 지지가 모여 결합하는 관계',
  충: '정반대 방향의 지지가 대립하는 관계',
  형: '서로 마찰을 일으키는 관계',
  자형: '같은 지지가 겹쳐 생기는 형',
  파: '결합을 깨뜨리는 관계',
  해: '서로 방해하는 관계',
  원진: '서로 꺼리는 관계',
  목: '나무',
  화: '불',
  토: '흙',
  금: '쇠',
  수: '물',
};

/** 용어 + 조사. 처음 부르면 뜻을 괄호로 붙인다 */
export interface Terms {
  (term: string, a?: string, b?: string): string;
  /** 지금까지 설명한 용어를 이어받는 새 기록 — 성별에 따라 달라지는 장(대운)에서 써서 다른 장의 글이 바뀌지 않게 한다 */
  fork(): Terms;
  /** 콘텐츠 문장이 직접 설명한 용어를 설명한 것으로 표시 */
  mark(...terms: string[]): void;
}

/**
 * 한 리포트 안에서 용어를 처음 부를 때만 뜻을 붙인다 — "재성(일간이 극하는 오행으로, 재물과 관리 능력을 뜻해요)이".
 * 조사는 괄호 속 말이 아니라 용어에 맞춘다. a 가 '으로'면 ㄹ 받침도 '로'로.
 */
export function termTracker(seen = new Set<string>()): Terms {
  const t = ((term: string, a = '', b = a) => {
    const def = TERM_DEF[term];
    const head = def && !seen.has(term) ? `${term}(${def})` : term;
    seen.add(term);
    if (!a) return head;
    return head + (a === '으로' ? ro(term).slice(term.length) : prt(term, a, b));
  }) as Terms;
  t.fork = () => termTracker(new Set(seen));
  t.mark = (...terms) => terms.forEach((x) => seen.add(x));
  return t;
}

/** 십성 무리별 글자 수 */
export function groupCount(chart: SajuChart): Record<TenGodGroup, number> {
  const r: Record<TenGodGroup, number> = { 비겁: 0, 식상: 0, 재성: 0, 관성: 0, 인성: 0 };
  for (const [tg, n] of Object.entries(chart.tenGodCount) as [TenGod, number][]) r[TEN_GOD_GROUP[tg]] += n;
  return r;
}

/** 점수대 — gradeWord 와 같은 기준이라 목록 줄의 등급과 풀이 문장이 어긋나지 않는다 */
export const scoreBand = (n: number): 'high' | 'mid' | 'low' => (n >= 65 ? 'high' : n >= 50 ? 'mid' : 'low');
/** 점수(0~100) → 등급(달빛사주 기준). low 는 주제마다 다르게(연애: 잔잔함, 재물: 낮음) */
export const gradeWord = (score: number, low: string) => (score >= 80 ? '아주 좋음' : score >= 65 ? '좋음' : score >= 50 ? '보통' : low);

/** 양력 달 → 계절 */
const SEASON: Record<number, string> = { 1: '겨울', 2: '늦겨울', 3: '봄', 4: '봄', 5: '늦봄', 6: '여름', 7: '여름', 8: '늦여름', 9: '가을', 10: '가을', 11: '늦가을', 12: '겨울' };
export const seasonOf = (month: number) => SEASON[month]!;

/** 좋은 달 목록 — 같은 해면 '3월', 다음 해 1월이면 '2029년 1월' */
export const monthsText = (year: number, ms: { year: number; month: number }[]) => ms.map((m) => (m.year === year ? `${m.month}월` : `${m.year}년 ${m.month}월`)).join('과 ');
