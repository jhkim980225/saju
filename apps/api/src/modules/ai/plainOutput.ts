/**
 * 상담·꿈풀이·타로 이야기 AI 출력의 문체 검사(docs/PLAIN_KOREAN.md).
 *
 * 리포트 다듬기는 초안과 비교해 새로 들어온 용어·비유가 있으면 그 섹션을 초안으로 되돌린다(ai/service.ts polishSections).
 * 상담·꿈풀이·타로 이야기에는 비교할 초안이 없으므로, 지시문(PLAIN_VOICE)이 금지한 것만 문장 단위로 걸러 낸다.
 * - 한자(甲·庚金 같은 글자): 괄호 안의 한자 표기('경금(庚金)')는 괄호째 지우고, 그 밖의 한자가 든 문장은 뺀다
 * - 읽는 사람을 '당신'·'그대'·'귀하'로 부른 문장
 * - 비유·관용구·유아적인 표현(plainGuard 의 FIGURATIVE·CHILDISH)이 든 문장
 * 사용자가 직접 쓴 말(질문·꿈 이야기)이나 근거 자료(사전 해석·카드 뜻)에 이미 있는 표현은 허용한다 — 꿈에 나온 '보물'처럼.
 * 명리학 용어(일간·용신 등)는 처음 나올 때 뜻을 붙여 쓸 수 있으므로 막지 않는다.
 * 빼야 할 문장이 많으면(3분의 1 초과) 답 전체를 쓰지 않는다(null) — 호출부가 규칙 기반 결과로 대신한다.
 */
import { toneProblems } from '../interpretation/plainGuard.js';

const HANJA_RE = /[一-鿿]/g;
/** '경금(庚金)', '용신 목(木)'처럼 한글 뒤 괄호 안 한자 표기 — 괄호째 지운다 */
const HANJA_PAREN_RE = /\s?[(（][一-鿿·,\s]+[)）]/g;
const YOU_RE = /(?:^|[^가-힣])(당신|그대|귀하)/g;
/** 문장 끝 — 마침표·물음표·느낌표 뒤 공백 */
const SENTENCE_SPLIT = /(?<=[.!?])\s+/;
/** 빼도 되는 문장 비율의 상한 — 넘으면 답 전체를 버린다 */
const MAX_DROP_RATIO = 1 / 3;

export interface PlainAllowance {
  /** 비유·관용구·'당신'을 허용할 근거 글(사용자 입력, 사전 해석, 카드 뜻 등) */
  tone: string;
  /** 한자를 허용할 근거 글(사용자가 직접 쓴 글만 — 사주 요약·basis 의 한자는 옮기지 말라고 지시했다) */
  hanja: string;
}

const hanjaOf = (text: string) => new Set(text.match(HANJA_RE) ?? []);
const youOf = (text: string) => new Set([...text.matchAll(YOU_RE)].map((m) => m[1]!));

/** 문장 하나가 문체 기준을 어겼는가 */
function violates(sentence: string, allowedHanja: Set<string>, allowedTone: Set<string>, allowedYou: Set<string>): boolean {
  if ((sentence.match(HANJA_RE) ?? []).some((c) => !allowedHanja.has(c))) return true;
  if ([...sentence.matchAll(YOU_RE)].some((m) => !allowedYou.has(m[1]!))) return true;
  return toneProblems(sentence).some((p) => !allowedTone.has(p));
}

/**
 * 문단 목록에서 기준을 어긴 문장을 빼고 돌려준다. 빈 문단은 없앤다.
 * 남는 문장이 없거나 뺀 문장이 많으면 null.
 */
export function cleanAiParagraphs(paragraphs: string[], allow: PlainAllowance): string[] | null {
  const allowedHanja = hanjaOf(allow.hanja);
  const allowedTone = new Set(toneProblems(allow.tone));
  const allowedYou = youOf(allow.tone);
  let total = 0;
  let dropped = 0;
  const out: string[] = [];
  for (const raw of paragraphs) {
    const para = raw.replace(HANJA_PAREN_RE, (m) => ([...m.matchAll(HANJA_RE)].every((x) => allowedHanja.has(x[0])) ? m : '')).trim();
    if (!para) continue;
    const sentences = para.split(SENTENCE_SPLIT).filter((s) => s.trim());
    const kept = sentences.filter((s) => !violates(s, allowedHanja, allowedTone, allowedYou));
    total += sentences.length;
    dropped += sentences.length - kept.length;
    if (kept.length) out.push(kept.join(' '));
  }
  if (total === 0 || out.length === 0 || dropped > total * MAX_DROP_RATIO) return null;
  return out;
}

/** 줄바꿈으로 문단을 나눈 글(상담 답변)에 같은 검사 — 문단 사이는 원래 글의 줄바꿈 방식(빈 줄 또는 한 줄)으로 다시 잇는다 */
export function cleanAiText(text: string, allow: PlainAllowance): string | null {
  const cleaned = cleanAiParagraphs(text.split(/\n+/), allow);
  return cleaned ? cleaned.join(text.includes('\n\n') ? '\n\n' : '\n') : null;
}

/** 한 줄 머리말 — 어긴 곳이 있으면 null(호출부가 첫 문단에서 대신 만든다) */
export function cleanAiLine(line: string, allow: PlainAllowance): string | null {
  const t = line.replace(HANJA_PAREN_RE, '').trim();
  return t && !violates(t, hanjaOf(allow.hanja), new Set(toneProblems(allow.tone)), youOf(allow.tone)) ? t : null;
}
