/**
 * 쉬운 말 지킴이 — 사주를 모르는 사람이 읽는 글에 사주 용어·한자·"당신"이 들어갔는지 찾는다(docs/PLAIN_KOREAN.md).
 * - AI 가 리포트를 다듬다가 초안에 없던 용어를 다시 끌어오면 그 섹션은 규칙 기반 초안을 쓴다(ai/service.ts).
 * - 회귀 테스트(test/plain-report.test.ts)도 같은 목록을 쓴다.
 * 낱말 첫머리에서만 찾는다 — '번지지'·'상관없이'·'일주일'·'앞서 세운 계획'·'지지 않으려는' 같은 일상어는 걸리지 않게.
 */
import type { ReadingSection } from '@saju/shared';

export const PLAIN_JARGON = [
  '당신', '일간', '일지', '일주(?!일)', '용신', '희신', '기신', '십신', '십성', '12운성', '운성', '지장간', '신강', '신약', '극신', '중화',
  '천간', '지지(?![하해를받]| 않)', '대운', '세운(?! (계획|목표))', '월운', '원국', '비견', '겁재', '식신', '상관(?!없)', '편재', '정재', '편관', '정관', '편인', '정인',
  '비겁', '식상', '재성', '관성', '인성', '순행', '역행', '오행', '합충', '육합', '삼합', '반합', '방합', '천간합', '천간충', '원진', '공망', '양인', '백호', '괴강', '현침', '귀문',
  '도화', '역마', '화개', '신살', '길신', '흉살', '간지', '대길', '상생', '상극', '비화', '명리', '득령', '득지', '득세', '절기',
] as const;

const JARGON_RE = new RegExp(`(^|[^가-힣])(${PLAIN_JARGON.join('|')})`, 'g');
/** 문단 끝 '(천을귀인)' 같은 신살 꼬리표는 용어를 원하는 사람을 위한 자리라 뺀다 */
const stripTermTag = (t: string) => t.replace(/\s\([가-힣]+(귀인|살|망)\)$/, '');

/** 글에 들어 있는 용어·한자·"당신" — 중복 없이 */
export function plainProblems(text: string): string[] {
  const t = stripTermTag(text);
  const out = new Set<string>();
  for (const m of t.matchAll(JARGON_RE)) out.add(m[2]!);
  for (const m of t.matchAll(/[一-鿿]+/g)) out.add(m[0]);
  return [...out];
}

/**
 * 비유·관용구·감성 문구 — 차분하게 설명하는 말투를 깨는 표현(docs/PLAIN_KOREAN.md '말투').
 * 대표적인 것만 담았다. 목록에 없는 상투어는 사람 눈 검사로 고친다.
 * 사람을 자연물에 빗대는 말("큰 나무 같은", "태양처럼")도 여기서 잡는다.
 */
export const FIGURATIVE = [
  '순풍', '돛', '톱니바퀴', '씨앗', '첫 단추', '돌다리', '비 온 뒤', '땅이 굳', '문을 두드', '문이 열리', '주인공', '빛을 (보|발하|봐)', '빛나', '빛이 나',
  '꽃[을이]? ?피', '꽃길', '활짝', '날개', '술술', '물 만난', '단비', '등불', '나침반', '디딤돌', '징검다리', '마중물', '보물', '무지개', '먹구름', '폭풍',
  '햇살', '봄바람', '물 흐르듯', '불꽃', '불씨', '열매', '결실', '새싹', '싹이 트', '기지개', '충전', '스포트라이트', '미소가 미소', '행운의 여신', '운이 내 편',
  '마법(?!사)', '(?<![가-힣])기적', '하늘이 돕', '탄탄대로', '승승장구', '일사천리', '금상첨화', '전화위복', '호사다마', '새옹지마', '고진감래', '대기만성', '청신호', '빨간불', '물꼬',
  '뿌리(내|를 내)', '(나무|태양|촛불|불꽃|바위|보석|바다|이슬|호수|강물|등불|들판|대지|칼|도끼|화초|넝쿨|용광로|모닥불|등대)( ?같은|처럼)', '같은 사람(이에요|예요)',
] as const;
const FIGURATIVE_RE = new RegExp(FIGURATIVE.join('|'), 'g');

/** 글에 들어 있는 비유·관용구 — 중복 없이 */
export function figurativeProblems(text: string): string[] {
  return [...new Set([...text.matchAll(FIGURATIVE_RE)].map((m) => m[0]))];
}

/** AI 가 다듬은 섹션이 초안에 없던 비유·관용구를 새로 들였는가 */
export function introducesFigurative(draft: Pick<ReadingSection, 'summary' | 'paragraphs'>, polished: Pick<ReadingSection, 'summary' | 'paragraphs'>): boolean {
  const had = new Set([draft.summary, ...draft.paragraphs].flatMap(figurativeProblems));
  return [polished.summary, ...polished.paragraphs].flatMap(figurativeProblems).some((p) => !had.has(p));
}

/** AI 가 다듬은 섹션이 초안에 없던 용어·한자를 새로 들였는가 */
export function introducesJargon(draft: Pick<ReadingSection, 'summary' | 'paragraphs'>, polished: Pick<ReadingSection, 'summary' | 'paragraphs'>): boolean {
  const had = new Set([draft.summary, ...draft.paragraphs].flatMap(plainProblems));
  return [polished.summary, ...polished.paragraphs].flatMap(plainProblems).some((p) => !had.has(p));
}
