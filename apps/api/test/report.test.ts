/**
 * 유료 보고서(사주분석서 · 신년운세 · 궁합) 규칙 기반 초안 — 구성, 분량, 깨진 문장 없음
 */
import { calculateCompatibility, calculateSaju, type BirthInput } from '@saju/core';
import type { ReadingSection } from '@saju/shared';
import { describe, expect, it } from 'vitest';
import { buildCompatibilityReport, buildSajuAnalysis, buildYearlyReport, elementLevel } from '../src/modules/interpretation/report.js';

const NOW = new Date('2026-10-13T03:00:00Z');
/** 화면에 보이는 분량 — 요약·본문·목록(tips)·한눈에 보기(points) */
const chars = (secs: ReadingSection[]) =>
  secs.reduce((n, s) => n + [s.summary, ...s.paragraphs, ...(s.tips ?? []), ...(s.points ?? []).map((p) => p.text)].join('').replace(/\s/g, '').length, 0);
const text = (secs: ReadingSection[]) => secs.map((s) => [s.title, s.summary, ...(s.keywords ?? []), ...s.paragraphs].join('\n')).join('\n');

/** 결정적 의사난수로 다양한 출생 정보 */
function births(n: number): BirthInput[] {
  let x = 20261013;
  const r = (m: number) => ((x = (x * 1103515245 + 12345) % 2147483648), x % m);
  return Array.from({ length: n }, (_, i) => ({
    calendar: 'solar' as const,
    year: 1950 + r(60),
    month: 1 + r(12),
    day: 1 + r(28),
    hour: i % 5 === 0 ? null : r(24),
    minute: i % 5 === 0 ? null : r(60),
    gender: i % 2 ? ('male' as const) : ('female' as const),
  }));
}

const a = calculateSaju({ calendar: 'solar', year: 1995, month: 3, day: 14, hour: 14, minute: 30, gender: 'female' });
const b = calculateSaju({ calendar: 'solar', year: 1993, month: 9, day: 5, hour: null, minute: null, gender: 'male' });

describe('사주분석서', () => {
  const secs = buildSajuAnalysis(a, NOW);
  const keys = secs.map((s) => s.key);

  it('원국·오행 비율·대운 8개·올해/내년·열두 달·마무리를 순서대로 담는다', () => {
    for (const k of ['overview', 'chart', 'strength', 'elements', 'yongsin', 'tenGods', 'relations', 'stages', 'daeun', 'year2026', 'year2027', 'months', 'closing']) expect(keys).toContain(k);
    expect(keys.filter((k) => /^daeun-\d$/.test(k))).toHaveLength(8);
    expect(keys.filter((k) => /^month-\d+$/.test(k))).toHaveLength(12);
    expect(keys.indexOf('chart')).toBeLessThan(keys.indexOf('daeun'));
    expect(keys.at(-1)).toBe('closing');
    expect(new Set(keys).size).toBe(keys.length);
  });

  // 쉬운 말로 다시 쓰며 용어 풀이와 되풀이 문장을 걷어 내 1만 9천 자 → 1만 7천 자 안팎이 됐다
  it('A4 20쪽 안팎 — 공백 뺀 1만 6천 자 이상', () => {
    expect(chars(secs)).toBeGreaterThan(16_000);
  });

  it('오행 비율을 다섯 기운 모두 % 로 밝힌다', () => {
    const el = secs.find((s) => s.key === 'elements')!;
    expect(el.keywords).toHaveLength(5);
    const sum = el.keywords!.reduce((n, k) => n + Number(k.match(/(\d+)%/)![1]), 0);
    expect(sum).toBeGreaterThanOrEqual(98);
    expect(sum).toBeLessThanOrEqual(102);
  });

  it('열두 달은 절기 순서(2월 입춘 … 다음 해 1월 소한)로 이어진다', () => {
    const months = secs.filter((s) => /^month-\d+$/.test(s.key));
    expect(months[0]!.title).toMatch(/^2월 · /);
    expect(months[11]!.title).toMatch(/^2028년 1월 · /);
    for (const m of months) expect(m.score).toBeGreaterThan(0);
  });

  it('같은 용신·기신 안내 문장을 달마다 되풀이하지 않는다', () => {
    const counts = new Map<string, number>();
    for (const s of secs.filter((x) => /^month-/.test(x.key))) for (const p of s.paragraphs) counts.set(p, (counts.get(p) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBe(1);
  });
});

describe('신년운세 리포트', () => {
  const secs = buildYearlyReport(a, 2027);
  it('총운·10년 흐름·네 영역·열두 달', () => {
    const keys = secs.map((s) => s.key);
    expect(keys.slice(0, 6)).toEqual(['total', 'daeunContext', 'wealth', 'love', 'career', 'health']);
    expect(keys.filter((k) => /^month-\d+$/.test(k))).toHaveLength(12);
  });
  it('A4 10쪽 안팎 — 공백 뺀 6천 자 이상', () => {
    expect(chars(secs)).toBeGreaterThan(6_000);
  });
});

describe('궁합 리포트', () => {
  const secs = buildCompatibilityReport(a, b, calculateCompatibility(a, b), { a: '서윤', b: '도현' }, NOW);
  it('기질·본성·오행·끌림·조율·대화·갈등·서로를 대하는 방법·시기·조언', () => {
    expect(secs.map((s) => s.key)).toEqual(['summary', 'persons', 'stemRelation', 'balance', 'strengths', 'cautions', 'categories', 'communication', 'conflict', 'loveStyle', 'manual', 'together', 'timing', 'advice']);
  });
  it('공백 뺀 3천 3백 자 이상', () => {
    expect(chars(secs)).toBeGreaterThan(3_300);
  });
});

describe('여러 사주로 만들어도 깨진 문장이 없다', () => {
  const BROKEN = /undefined|NaN|\[object|null(?![가-힣])|\$\{|  +[.,]|\.\./;
  const charts = births(40).map((x) => calculateSaju(x));
  it('사주분석서 · 신년운세 · 궁합 (40명, 시간 모름 포함)', () => {
    charts.forEach((c, i) => {
      const other = charts[(i + 7) % charts.length]!;
      const all = [buildSajuAnalysis(c, NOW), buildYearlyReport(c, 2027), buildCompatibilityReport(c, other, calculateCompatibility(c, other), { a: '나', b: '상대' }, NOW)];
      for (const secs of all) {
        const tx = text(secs);
        expect(tx).not.toMatch(BROKEN);
        for (const s of secs) {
          expect(s.paragraphs.length).toBeGreaterThan(0);
          for (const p of s.paragraphs) expect(p.trim().length).toBeGreaterThan(5);
        }
      }
      expect(chars(all[0]!)).toBeGreaterThan(14_500);
    });
  });
});

describe('오행 비율 단계', () => {
  it('웹 ElementBars 와 같은 기준 — 글자 개수(글과 도넛이 같은 숫자)', () => {
    expect(elementLevel(0)).toBe('none');
    expect(elementLevel(1)).toBe('weak');
    expect(elementLevel(2)).toBe('balanced');
    expect(elementLevel(3)).toBe('developed');
    expect(elementLevel(4)).toBe('excess');
    expect(elementLevel(6)).toBe('excess');
  });
});
