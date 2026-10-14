/**
 * 꿈해몽 사전 — 한국어 검색과 꿈 이야기 속 상징 찾기.
 *
 * 검색(searchDreams): 사전 화면의 검색창. '뱀꿈'·'뱀 꿈 해몽' → 뱀, 별칭('구렁이') → 뱀, 입력 중인 앞부분('호랑') → 호랑이,
 *   초성('ㅎㄹㅇ') → 호랑이, 문장('뱀이 나오는 꿈') 속 키워드까지 점수로 줄 세운다.
 * 추출(extractDreamSymbols): AI 꿈풀이의 규칙 기반 근거. 낱말마다 조사를 떼어 보고 키워드·별칭과 맞춘다.
 *   한 글자 낱말(뱀·소·말…)은 정확히 같을 때만, 두 글자 이상은 낱말의 앞·뒤가 같을 때 잡는다('소나무' → 나무).
 *   동음이의어는 항목의 extract(대신 찾을 구절)·exclude(먼저 지울 구절)로 거른다.
 */
import type { DreamEntry, DreamVariation } from './types.js';

/** 낱말 끝에서 떼어 볼 조사·어미 (긴 것부터) */
const PARTICLES = [
  '에서부터', '으로부터', '이었는데', '에게서', '한테서', '이라는', '이랑은', '에서는', '에게는', '한테는', '으로는', '였는데',
  '처럼', '같이', '보다', '까지', '부터', '에서', '에게', '한테', '께서', '으로', '이랑', '이나', '이며', '이고', '라는', '하고', '이야',
  '랑', '와', '과', '이', '가', '을', '를', '은', '는', '에', '의', '로', '도', '만', '야', '꿈',
] as const;

/** 한 글자 낱말 앞에 붙어 한 덩어리로 쓰이는 꾸밈말 ('흰뱀', '큰불') */
const MODIFIERS = new Set(['흰', '큰', '작은', '검은', '붉은', '하얀', '까만', '빨간', '노란', '파란', '푸른', '누런', '황금', '늙은', '어린', '아기', '새끼', '거대한', '커다란', '시커먼', '새하얀', '검정']);

/** 검색어 끝에 붙는 군말 */
const QUERY_SUFFIXES = ['꿈해몽', '꿈풀이', '해몽', '풀이', '의미', '뜻', '꿈'] as const;

const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const isJamo = (ch: string) => /^[ㄱ-ㅎ]$/.test(ch);

/** 공백 정리 + 소문자 + 유니코드 정규화 */
export const tidy = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
/** 비교용 — 공백·문장부호 제거 */
export const squash = (s: string) => tidy(s).replace(/[\s.,!?~'"“”‘’`·…()[\]{}<>/\\|:;_-]+/g, '');

/** '쫓기는 꿈' → '쫓기는', '뱀꿈해몽' → '뱀' */
export function normalizeDreamQuery(q: string): string {
  let s = squash(q);
  let changed = true;
  while (changed && s) {
    changed = false;
    for (const suf of QUERY_SUFFIXES) {
      if (s.length > suf.length && s.endsWith(suf)) {
        s = s.slice(0, -suf.length);
        changed = true;
        break;
      }
    }
  }
  return s;
}

/** 한글 음절의 초성 문자열 ('호랑이' → 'ㅎㄹㅇ'). 한글이 아닌 글자는 그대로 */
export function choseong(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0) - 0xac00;
    out += code >= 0 && code <= 11171 ? CHOSEONG[Math.floor(code / 588)] : ch;
  }
  return out;
}

/** 낱말 → 조사를 떼어 본 후보들 (원형 포함, 두 번까지) */
function stems(token: string): Set<string> {
  const out = new Set([token]);
  for (let pass = 0; pass < 2; pass++) {
    for (const s of [...out]) {
      for (const p of PARTICLES) if (s.length > p.length && s.endsWith(p)) out.add(s.slice(0, -p.length));
    }
  }
  return out;
}

interface Token {
  text: string;
  index: number;
  stems: Set<string>;
}
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(/[0-9a-z가-힣]+/g)) tokens.push({ text: m[0], index: m.index ?? 0, stems: stems(m[0]) });
  return tokens;
}

/** 꿈 설명에서 찾을 말 — 꿈으로 끝나는 키워드는 '꿈'을 떼어 둔다 */
const termOf = (s: string) => tidy(s).replace(/\s*꿈$/, '');

function matchWord(term: string, tokens: Token[]): number {
  for (const t of tokens) {
    for (const st of t.stems) {
      if (term.length === 1) {
        if (st === term || (st.length > 1 && st.endsWith(term) && MODIFIERS.has(st.slice(0, -1)))) return t.index;
      } else if (st === term || st.startsWith(term) || st.endsWith(term)) {
        return t.index;
      }
    }
  }
  return -1;
}

/** 공백을 지운 문장에서의 위치를 원래 문장의 위치로 대략 옮긴다(순서 정렬용) */
function squashedIndexToOriginal(original: string, squashedIndex: number): number {
  let seen = 0;
  for (let i = 0; i < original.length; i++) {
    if (!/\s/.test(original[i]!)) {
      if (seen === squashedIndex) return i;
      seen++;
    }
  }
  return original.length;
}

export interface DreamMatch {
  entry: DreamEntry;
  /** 꿈 설명에 hints 가 들어 있는 상황 (없으면 null) */
  variation: DreamVariation | null;
  /** 꿈 설명에서 처음 나온 위치 */
  index: number;
}

/** 단독으로는 상징이 약한 분류 — 같은 위치면 뒤로 */
const WEAK_CATEGORIES = new Set(['colorNumber', 'kind']);

export function createDreamIndex(entries: readonly DreamEntry[]) {
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  /** 키워드·별칭(공백만 지운 그대로) → 항목 — '개꿈'처럼 '꿈'까지가 한 낱말인 항목을 먼저 찾는다 */
  const byExact = new Map<string, DreamEntry>();
  /** 키워드·별칭('꿈'·'해몽'을 뗀 꼴) → 항목 */
  const byTerm = new Map<string, DreamEntry>();
  for (const e of entries) {
    for (const term of [e.keyword, ...e.aliases]) {
      const x = squash(term);
      if (x && !byExact.has(x)) byExact.set(x, e);
      const k = normalizeDreamQuery(term);
      if (k && !byTerm.has(k)) byTerm.set(k, e);
    }
  }
  const searchable = entries.map((e, order) => {
    const terms = [e.keyword, ...e.aliases].map((s, i) => ({ s: normalizeDreamQuery(s), exact: squash(s), keyword: i === 0 }));
    return {
      e,
      order,
      terms: terms.filter((t) => t.s).map((t) => ({ ...t, cho: choseong(t.s) })),
      variations: e.variations.map((v) => normalizeDreamQuery(v.title)),
      body: squash(`${e.summary} ${e.meaning}`),
    };
  });

  /** 키워드·별칭으로 항목 찾기 ('구렁이' → 뱀, '뱀꿈' → 뱀) */
  const resolve = (term: string): DreamEntry | undefined => {
    const exact = byExact.get(squash(term));
    if (exact) return exact;
    const k = normalizeDreamQuery(term);
    if (!k) return undefined;
    const direct = byTerm.get(k);
    if (direct) return direct;
    for (const st of stems(k)) {
      const hit = byTerm.get(st);
      if (hit) return hit;
    }
    return undefined;
  };

  /** 검색창 — 점수순 (같으면 짧은 키워드, 사전 순서) */
  const search = (query: string, limit = 20): DreamEntry[] => {
    const qExact = squash(query);
    let q = normalizeDreamQuery(query);
    if (!q) return [];
    const choOnly = [...q].every(isJamo);
    // 입력 중인 마지막 자모('호랑ㅇ')는 떼고 앞부분으로 찾는다
    if (!choOnly && isJamo(q.at(-1)!)) q = q.replace(/[ㄱ-ㅎ]+$/, '');
    if (!q) return [];
    const qStems = stems(q);
    const scored: { e: DreamEntry; score: number; order: number }[] = [];
    for (const it of searchable) {
      let score = 0;
      for (const t of it.terms) {
        const bonus = t.keyword ? 5 : 0;
        if (choOnly) {
          if (t.cho.startsWith(q)) score = Math.max(score, 70 + bonus - (t.cho.length - q.length));
          else if (q.length >= 2 && t.cho.includes(q)) score = Math.max(score, 45 + bonus);
          continue;
        }
        if (t.exact === qExact) score = Math.max(score, 110 + bonus);
        else if (t.s === q || qStems.has(t.s)) score = Math.max(score, 95 + bonus);
        else if (t.s.startsWith(q)) score = Math.max(score, 80 + bonus - Math.min(10, t.s.length - q.length));
        else if (q.length >= 2 && t.s.includes(q)) score = Math.max(score, 60 + bonus);
        else if (t.s.length >= 2 && q.includes(t.s)) score = Math.max(score, 50 + bonus + t.s.length);
        else if (t.s.length === 1 && q.includes(t.s)) score = Math.max(score, 25 + bonus);
      }
      if (!choOnly && score < 40 && q.length >= 2 && it.variations.some((v) => v.includes(q))) score = Math.max(score, 40);
      if (!choOnly && score < 10 && q.length >= 2 && it.body.includes(q)) score = 10;
      if (score > 0) scored.push({ e: it.e, score, order: it.order });
    }
    scored.sort((a, b) => b.score - a.score || a.e.keyword.length - b.e.keyword.length || a.order - b.order);
    return scored.slice(0, limit).map((s) => s.e);
  };

  /** 꿈 이야기에서 사전 상징 찾기 — 나온 순서대로, 색·숫자·꿈의 종류는 뒤로 */
  const extract = (text: string, limit = 6): DreamMatch[] => {
    const base = tidy(text);
    if (!base) return [];
    const baseTokens = tokenize(base);
    const matches: DreamMatch[] = [];
    for (const e of entries) {
      let spaced = base;
      let tokens = baseTokens;
      if (e.exclude?.length) {
        for (const ex of e.exclude) spaced = spaced.split(tidy(ex)).join(' ');
        tokens = tokenize(spaced);
      }
      const flat = squash(spaced);
      let index = -1;
      const consider = (i: number) => {
        if (i >= 0 && (index < 0 || i < index)) index = i;
      };
      if (e.extract?.length) {
        for (const x of e.extract) {
          const t = tidy(x);
          consider(spaced.indexOf(t));
          if (t.includes(' ')) {
            const fi = flat.indexOf(squash(t));
            if (fi >= 0) consider(squashedIndexToOriginal(spaced, fi));
          }
        }
      } else {
        // '꿈의 종류'는 별칭이 '이상한 꿈'·'무서운 꿈'처럼 흔한 말이라, 이름(태몽·악몽…)이 직접 나올 때만 잡는다
        for (const raw of e.category === 'kind' ? [e.keyword] : [e.keyword, ...e.aliases]) {
          const term = termOf(raw);
          if (!term) continue;
          if (term.includes(' ')) {
            const fi = flat.indexOf(squash(term));
            if (fi >= 0) consider(squashedIndexToOriginal(spaced, fi));
          } else {
            consider(matchWord(term, tokens));
          }
        }
      }
      if (index < 0) continue;
      const variation = e.variations.find((v) => v.hints.some((h) => h.trim() && flat.includes(squash(h)))) ?? null;
      matches.push({ entry: e, variation, index });
    }
    matches.sort((a, b) => Number(WEAK_CATEGORIES.has(a.entry.category)) - Number(WEAK_CATEGORIES.has(b.entry.category)) || a.index - b.index);
    return matches.slice(0, limit);
  };

  return {
    entries,
    get: (slug: string) => bySlug.get(slug),
    resolve,
    search,
    extract,
  };
}

export type DreamIndex = ReturnType<typeof createDreamIndex>;
