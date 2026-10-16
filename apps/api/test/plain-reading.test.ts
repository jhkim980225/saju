/**
 * 무료 풀이 화면의 말투 — 사주를 모르는 사람이 읽어도 이해되는 사람 말투인지 회귀 검사.
 * 60일주 × (이름 있음/없음) × 시간 앎/모름. 사주 근거(basis)는 '사주로 보면'에 접어 두므로 검사에서 뺀다.
 */
import { calculateSaju, type BirthInput } from '@saju/core';
import type { ReadingSection } from '@saju/shared';
import { describe, expect, it } from 'vitest';
import { buildBasicReading } from '../src/modules/interpretation/reading.js';

const NOW = new Date('2026-10-15T03:00:00Z');
const FREE = ['overview', 'personality', 'elements', 'yongsin', 'shinsal'];

/** 1990-01-01 부터 60일 — 일주 60개를 한 번씩 */
const births: BirthInput[] = Array.from({ length: 60 }, (_, i) => {
  const d = new Date(Date.UTC(1990, 0, 1 + i));
  return { calendar: 'solar', year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: i % 3 === 0 ? null : 9 + (i % 12), minute: i % 3 === 0 ? null : 0, gender: i % 2 ? 'male' : 'female' };
});

/** 화면에 그대로 보이는 글(근거 접힘 제외) — 잠긴 섹션은 미리보기 문단·요약만 */
const visible = (s: ReadingSection) => [s.summary, ...s.paragraphs, ...(s.tips ?? [])].filter(Boolean);
/** 문단 끝 괄호 속 신살 이름 '(천을귀인)'은 용어를 원하는 사람을 위한 꼬리표라 허용 */
const stripTermTag = (t: string) => t.replace(/\s\([가-힣]+(귀인|살|망)\)$/, '');

/** 낱말 첫머리에서만 — '번지지'·'상관없이' 같은 일상어는 걸리지 않게('지지'는 일상어와 겹쳐 뺐다) */
// 2026-10-16 문체 기준 개정 — 정식 명리학 용어는 본문에 써도 된다(처음 나올 때 뜻을 붙인다). 여기서는 '당신'만 막는다.
const JARGON = ['당신'].map((j) => [j, new RegExp(`(^|[^가-힣])${j}`)] as const);

describe('무료 풀이 — 사람이 말하듯 쉬운 말', () => {
  for (const name of ['서윤', '']) {
    it(`60일주 · 이름 ${name ? '있음' : '없음'} — 용어·한자·'당신'·일간 이름·반복 문장 없음`, () => {
      for (const birth of births) {
        const r = buildBasicReading(calculateSaju(birth), { access: 'none', now: NOW, name });
        const secs = r.sections;
        const free = secs.filter((s) => FREE.includes(s.key));
        expect(free.map((s) => s.key)).toEqual(FREE);
        expect(r.keyPoints?.map((k) => k.label)).toEqual(['성격', '잘하는 것', '조심할 것', '필요한 것', '행운 포인트']);
        // 화면에서 총평 섹션은 '한눈에 보는 나' 카드가 대신한다 — 카드 문구도 같은 기준으로
        const lines = [r.headline, ...r.keyPoints!.map((k) => k.text), ...secs.filter((s) => s.key !== 'overview').flatMap(visible)].map(stripTermTag);
        const where = `${birth.year}-${birth.month}-${birth.day} ${name || '(이름 없음)'}`;
        for (const line of lines) {
          expect(line.replace(/\([一-鿿·]+\)/g, ''), where).not.toMatch(/[一-鿿]{2,}/); // 한자 단어(정의 자리의 괄호 한자는 허용)
          for (const [j, re] of JARGON) expect(re.test(line), `${where}: '${j}' — ${line}`).toBe(false);
          expect(line, where).not.toMatch(/undefined|null|\{|\}|\s{2,}|님님/);
          if (!name) expect(line, where).not.toContain('님');
        }
        // 같은 문장이 화면에 두 번 나오지 않는다(잠긴 섹션 미리보기 포함)
        const sentences = lines.flatMap((l) => l.split(/(?<=[.!?…])\s+/)).map((x) => x.trim()).filter((x) => x.length > 12);
        const seen = new Set<string>();
        for (const s of sentences) {
          expect(seen.has(s), `${where}: 반복 — ${s}`).toBe(false);
          seen.add(s);
        }
        if (name) expect(free[0]!.paragraphs[0]).toMatch(/^서윤님은 /);
      }
    });
  }

  it('근거는 basis 로 따로 — 일주·용신 같은 용어는 거기에만', () => {
    const r = buildBasicReading(calculateSaju(births[0]!), { access: 'none', now: NOW, name: '서윤' });
    const overview = r.sections.find((s) => s.key === 'overview')!;
    expect(overview.basis).toMatch(/일주 · 일간 .+ · 용신 /);
    expect(r.sections.find((s) => s.key === 'yongsin')!.tips!.length).toBeGreaterThan(0);
  });
});
