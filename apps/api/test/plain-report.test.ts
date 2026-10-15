/**
 * 유료 리포트(사주분석서 · 신년운세 · 궁합)와 기본 풀이의 유료 섹션 — 사주를 모르는 사람이 읽어도 막히지 않는 말인지 회귀 검사.
 * 여러 사주 × 이름 있음/없음. 화면에 보이는 글(제목·요약·본문·목록·칩·한눈에 보기)만 모은다 — basis("사주로 보면")는 용어를 위한 자리라 뺀다.
 * docs/PLAIN_KOREAN.md 의 '검사' 항목을 따른다.
 */
import { calculateCompatibility, calculateSaju, type BirthInput, type SajuChart } from '@saju/core';
import type { ReadingSection } from '@saju/shared';
import { describe, expect, it } from 'vitest';
import { introducesJargon, PLAIN_JARGON } from '../src/modules/interpretation/plainGuard.js';
import { buildBasicReading } from '../src/modules/interpretation/reading.js';
import { buildCompatibilityReport, buildSajuAnalysis, buildYearlyReport, fillNames } from '../src/modules/interpretation/report.js';

const NOW = new Date('2026-10-15T03:00:00Z');
const PAID = ['wealth', 'love', 'career', 'health', 'tenGods', 'daeun'];

/** 결정적 의사난수로 다양한 출생 정보 — 시간 모름, 남녀 섞어서 */
function births(n: number, seed: number): BirthInput[] {
  let x = seed;
  const r = (m: number) => ((x = (x * 1103515245 + 12345) % 2147483648), x % m);
  return Array.from({ length: n }, (_, i) => ({
    calendar: 'solar' as const,
    year: 1950 + r(70),
    month: 1 + r(12),
    day: 1 + r(28),
    hour: i % 4 === 0 ? null : r(24),
    minute: i % 4 === 0 ? null : r(60),
    gender: i % 2 ? ('male' as const) : ('female' as const),
  }));
}
const charts: SajuChart[] = births(36, 20261015).map((b) => calculateSaju(b));

/** 화면에 보이는 글 — basis 는 '사주로 보면'에 접혀 있으므로 뺀다 */
const visible = (secs: ReadingSection[]) =>
  secs.flatMap((s) => [s.title, s.summary, ...(s.keywords ?? []), ...(s.points ?? []).flatMap((p) => [p.label, p.text]), ...s.paragraphs, ...(s.tips ?? [])]).filter(Boolean);
/** 문단 끝 괄호 속 신살 이름 '(천을귀인)'은 용어를 원하는 사람을 위한 꼬리표라 허용 */
const stripTermTag = (t: string) => t.replace(/\s\([가-힣]+(귀인|살|망)\)$/, '');

const STEMS = ['갑목', '을목', '병화', '정화', '무토', '기토', '경금', '신금', '임수', '계수'];
const BROKEN = /undefined|NaN|null(?![가-힣])|\[object|\$\{|\{[AB][:}]|\s{2,}|\.\.|,,|\s[,.]|님님|이\(가\)|을\(를\)|은\(는\)|과\(와\)/;

/** 받침 있는 글자 뒤 '를'·'와'·'예요', 받침 없는 글자 뒤 '을'·'이에요' — 조사 붙임이 틀린 곳 */
const batchim = (ch: string) => (ch.charCodeAt(0) - 0xac00) % 28 > 0;
function josaErrors(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/([가-힣])(를|와|예요|을|이에요)(?=[\s.,!?'"·)]|$)/g)) {
    const [, prev, p] = m as unknown as [string, string, string];
    const wrong = (p === '를' || p === '와' || p === '예요') === batchim(prev);
    if (wrong && !/(가을|마을|고을|노을)$/.test(line.slice(0, m.index! + 2))) out.push(`${prev}${p}`);
  }
  return out;
}

/** 용어 목록은 AI 다듬기 지킴이와 같은 것을 쓴다(낱말 첫머리에서만 — 일상어는 걸리지 않게) */
const JARGON_RE = new RegExp(`(^|[^가-힣])(${PLAIN_JARGON.join('|')})`);

function check(secs: ReadingSection[], where: string, opts: { noNameHonorific?: boolean } = {}) {
  const lines = visible(secs).map(stripTermTag);
  const errors: string[] = [];
  for (const line of lines) {
    if (/[一-鿿]/.test(line)) errors.push(`한자 — ${line}`);
    const j = line.match(JARGON_RE);
    if (j) errors.push(`'${j[2]}' — ${line}`);
    for (const s of STEMS) if (line.includes(s)) errors.push(`${s} — ${line}`);
    if (BROKEN.test(line)) errors.push(`깨진 이음새 — ${line}`);
    const jo = josaErrors(line);
    if (jo.length) errors.push(`조사 ${jo.join(',')} — ${line}`);
    if (opts.noNameHonorific && /님(은|이|의|에게|도|을|과)/.test(line)) errors.push(`이름 없음인데 '님' — ${line}`);
  }
  // 같은 문장이 한 권 안에서 두 번 나오지 않는다(한눈에 보기·요약 포함)
  const sentences = lines.flatMap((l) => l.split(/(?<=[.!?…])\s+/)).map((x) => x.trim()).filter((x) => x.length > 12);
  const seen = new Set<string>();
  for (const s of sentences) {
    if (seen.has(s)) errors.push(`반복 — ${s}`);
    seen.add(s);
  }
  expect(errors, where).toEqual([]);
}

describe('유료 리포트 — 사람이 말하듯 쉬운 말', () => {
  for (const name of ['서윤', '']) {
    const tag = name ? '이름 있음' : '이름 없음';

    it(`사주분석서 · ${tag} — 용어·한자·"당신"·반복·깨진 이음새 없음`, () => {
      charts.forEach((c, i) => {
        const secs = buildSajuAnalysis(c, NOW, name);
        check(secs, `분석서 #${i} ${tag}`, { noNameHonorific: !name });
        expect(secs[0]!.points!.length, '맨 앞 한눈에 보기').toBeGreaterThanOrEqual(5);
        if (name) expect(secs.find((s) => s.key === 'personality')!.paragraphs[0]).toMatch(/^서윤님은 /);
        // 용어는 basis 로 — 사주를 아는 사람은 근거를 볼 수 있게
        for (const k of ['chart', 'elements', 'strength', 'yongsin', 'tenGods', 'relations', 'stages', 'daeun', 'daeun-1', 'months', 'month-1']) {
          expect(secs.find((s) => s.key === k)?.basis, `${k} basis`).toBeTruthy();
        }
      });
    });

    it(`신년운세 · ${tag}`, () => {
      charts.forEach((c, i) => {
        const secs = buildYearlyReport(c, 2027, name);
        check(secs, `신년운세 #${i} ${tag}`, { noNameHonorific: !name });
        expect(secs[0]!.points!.length).toBeGreaterThanOrEqual(5);
        // 한 해 리포트에 '오늘은 …' 같은 하루 운세 문구가 섞이지 않는다
        for (const s of secs) expect(s.summary, s.key).not.toMatch(/^오늘/);
      });
    });

    it(`궁합 · ${tag}`, () => {
      charts.forEach((c, i) => {
        const other = charts[(i + 5) % charts.length]!;
        const secs = buildCompatibilityReport(c, other, calculateCompatibility(c, other), { a: name || '나', b: '도현' }, NOW);
        check(secs, `궁합 #${i} ${tag}`);
        expect(secs[0]!.points!.length).toBeGreaterThanOrEqual(4);
      });
    });

    it(`기본 풀이 유료 섹션(미니 리포트·전체 공개) · ${tag}`, () => {
      charts.forEach((c, i) => {
        const r = buildBasicReading(c, { access: 'full', now: NOW, name });
        const paid = r.sections.filter((s) => PAID.includes(s.key) || /^year\d{4}$/.test(s.key));
        expect(paid.map((s) => s.key).slice(0, 6)).toEqual(PAID);
        check(paid, `기본 풀이 #${i} ${tag}`, { noNameHonorific: !name });
        // 무료 섹션과 합쳐도 같은 문장이 두 번 나오지 않는다(화면에서 총평은 '한눈에 보는 나' 카드가 대신)
        check(r.sections.filter((s) => s.key !== 'overview'), `기본 풀이 전체 #${i} ${tag}`, { noNameHonorific: !name });
        for (const s of paid) expect(s.basis, `${s.key} basis`).toBeTruthy();
      });
    });
  }

  it('같은 사람끼리(이름 없음 둘)도 궁합 문장이 깨지지 않는다', () => {
    const c = charts[3]!;
    check(buildCompatibilityReport(c, c, calculateCompatibility(c, c), { a: '나', b: '본인' }, NOW), '같은 사주 궁합');
  });

  it('AI 다듬기 지킴이 — 초안에 없던 용어·한자·"당신"을 들이면 알아챈다', () => {
    const draft = { summary: '배우는 힘이 강한 해예요', paragraphs: ["'배우는 힘'이 겉으로 드러나요. 공부가 잘 풀려요.", '막힌 일이 풀려요. (천을귀인)'] };
    expect(introducesJargon(draft, { summary: '배움이 빛나는 해예요', paragraphs: ['배우는 힘이 겉으로 드러나는 해라 공부가 술술 풀려요.', '막혔던 일이 누군가의 도움으로 풀려요. (천을귀인)'] })).toBe(false);
    expect(introducesJargon(draft, { summary: draft.summary, paragraphs: ['정인운이 들어와 공부가 잘 풀려요.', draft.paragraphs[1]!] })).toBe(true);
    expect(introducesJargon(draft, { summary: draft.summary, paragraphs: ['당신에게 배움의 기운이 들어와요.', draft.paragraphs[1]!] })).toBe(true);
    expect(introducesJargon(draft, { summary: draft.summary, paragraphs: ['화(火) 기운이 들어와요.', draft.paragraphs[1]!] })).toBe(true);
    // 초안에 이미 있던 용어(주제별 리포트 등)는 문제 삼지 않는다 — 새로 들인 것만
    const termDraft = { summary: '일지로 본 관계', paragraphs: ['일지 辰 이야기예요.'] };
    expect(introducesJargon(termDraft, { summary: '일지로 본 관계', paragraphs: ['일지 辰을 보면 이런 이야기예요.'] })).toBe(false);
  });

  it('궁합 이름 자리표시 — 이름이 없으면 "나"와 바른 조사', () => {
    expect(fillNames('{A:이/가} {B:을/를} 북돋아요. {A:은/는} {B:과/와}', '나', '도현님')).toBe('내가 도현님을 북돋아요. 나는 도현님과');
    expect(fillNames('{A:이/가} {B:에게는}', '서윤님', '도현님')).toBe('서윤님이 도현님에게는');
  });
});
