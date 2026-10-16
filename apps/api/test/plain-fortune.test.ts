/**
 * 토정비결 · 띠별 · 별자리 · 꿈해몽(기본 풀이) — 처음 보는 사람이 읽는 화면 글에 용어·한자·기계적 이음새가 없는지 회귀 검사.
 * 근거 카드('왜 이런 풀이일까요?'·년생별 근거·괘를 뽑은 방법)는 접혀 있어 용어를 허용하므로 검사에서 뺀다.
 * docs/PLAIN_KOREAN.md 의 '검사' 기준과 같은 방식(plain-reading.test.ts).
 */
import { FREE_FORTUNE_PERIODS, STAR_SIGNS, ZODIAC_ANIMALS } from '@saju/shared';
import { extractDreamSymbols } from '@saju/shared/dream';
import { describe, expect, it, vi } from 'vitest';
import { GWAE_LIST } from '../src/modules/tojeong/content/index.js';
import { plainOverview, tojeongFor } from '../src/modules/tojeong/reading.js';
import { buildHoroscope, buildHoroscopeOverview } from '../src/modules/zodiac/horoscope.js';
import { buildZodiacFortune, buildZodiacOverview } from '../src/modules/zodiac/zodiacFortune.js';

// 꿈 기본 풀이는 사주 요약을 쓰지 않는다 — 상담 모듈을 끌어오지 않게 막아 둔다
vi.mock('../src/modules/chat/service.js', () => ({ chartSummary: () => '' }));
const { composeRuleBased } = await import('../src/modules/dream/service.js');

/** 낱말 첫머리에서만 — '상관없이'·'충분' 같은 일상어는 걸리지 않게 */
// 2026-10-16 문체 기준 개정 — 정식 명리학 용어는 본문에 써도 된다. 서양 점성술의 '하우스'처럼 설명 없는 외래 용어와 '당신'만 막는다.
const JARGON = ['당신', '하우스'].map(
  (j) => [j, new RegExp(`(^|[^가-힣])${j}`)] as const,
);

function assertPlain(lines: string[], where: string) {
  for (const line of lines) {
    expect(line.replace(/\([一-鿿·]+\)/g, ''), where).not.toMatch(/[一-鿿]{2,}/); // 한자 단어(정의 자리의 괄호 한자는 허용)
    expect(line, `${where}: 각도 — ${line}`).not.toMatch(/\d+°/);
    for (const [j, re] of JARGON) expect(re.test(line), `${where}: '${j}' — ${line}`).toBe(false);
    expect(line, where).not.toMatch(/undefined|null|NaN|\{|\}|\s{2,}|이\(가\)|을\(를\)/);
  }
}

/** 같은 문장이 한 화면에 두 번 나오지 않는다 */
function assertNoRepeat(lines: string[], where: string) {
  const seen = new Set<string>();
  for (const s of lines.flatMap((l) => l.split(/(?<=[.!?])\s+/)).map((x) => x.trim()).filter((x) => x.length > 12)) {
    expect(seen.has(s), `${where}: 반복 — ${s}`).toBe(false);
    seen.add(s);
  }
}

const SAMPLE_DATES = Array.from({ length: 6 }, (_, i) => {
  const d = new Date(Date.UTC(2026, i * 2, 3 + i * 4));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
});

describe('토정비결 — 쉬운 말', () => {
  it('144괘 총평에서 \'괘\'를 쉬운 말로 바꾸고, 문장이 자연스럽게 끝난다', () => {
    for (const g of GWAE_LIST) {
      for (const p of g.overview.map(plainOverview)) {
        expect(p, `${g.code}`).not.toContain('괘');
        expect(p, `${g.code}`).not.toMatch(/모습[^.]* 모습이에요/); // '본모습이 보이는 모습' 같은 겹침
        expect(p, `${g.code}`).not.toMatch(/(다는|라는|냐는) 모습/);
      }
    }
  });

  it('결과 화면 본문(제목·요약·총평·열두 달·안내)에 용어·한자가 없다', () => {
    for (const [birth, year] of [
      [{ calendar: 'solar', year: 1990, month: 5, day: 15, isLeapMonth: false }, 2027],
      [{ calendar: 'lunar', year: 1987, month: 6, day: 10, isLeapMonth: true }, 2027],
      [{ calendar: 'solar', year: 1975, month: 12, day: 2, isLeapMonth: false }, 2028],
    ] as const) {
      const d = tojeongFor(birth, year);
      const lines = [d.gwae.title, d.gwae.summary, ...d.gwae.keywords, ...d.overview, ...d.months.map((m) => `${m.label} ${m.flowLabel} ${m.text}`), d.disclaimer];
      assertPlain(lines, `${d.gwae.code}`);
      assertNoRepeat(lines, `${d.gwae.code}`);
    }
  });
});

describe('띠별 운세 — 쉬운 말', () => {
  it('12띠 × 5기간 × 6날 — 본문·눈여겨볼 날·년생별 한 줄·행운 근거에 용어·한자가 없다', { timeout: 30_000 }, () => {
    for (const base of SAMPLE_DATES) {
      for (const period of FREE_FORTUNE_PERIODS) {
        for (const a of ZODIAC_ANIMALS) {
          const f = buildZodiacFortune(a, period, base);
          const where = `${a.name}띠 ${period} ${base.month}/${base.day}`;
          const main = [f.headline, ...f.paragraphs, f.tip, ...f.keyDays.map((k) => `${k.marker} ${k.reason}`)];
          assertPlain([...main, f.trait, `${f.lucky.basis}에서 골랐어요.`, f.range.label, ...f.years.map((y) => y.text), f.basisNote.replace(/\([^)]*\)/g, '')], where);
          assertNoRepeat(main, where);
          expect(f.trait.startsWith(`${a.name}띠는`), where).toBe(false); // 성향을 먼저
        }
        if (period !== 'week') assertPlain(buildZodiacOverview(period, base).items.map((i) => `${i.headline} ${i.reason}`), `한눈에 ${period}`);
      }
    }
  });

  it('근거 카드에는 용어를 그대로 둔다(접어서 보여 줌)', () => {
    const f = buildZodiacFortune(ZODIAC_ANIMALS[2]!, 'today', { year: 2026, month: 10, day: 15 });
    expect(f.reasons[0]!.title).toMatch(/^오늘 일진 壬戌 · /);
    expect(f.years[0]!.reason).toMatch(/천간/);
  });
});

describe('별자리 운세 — 쉬운 말', () => {
  it('12별자리 × 5기간 — 본문·하늘의 근거·눈여겨볼 날에 각도·하우스 같은 말이 없다', { timeout: 30_000 }, () => {
    for (const base of SAMPLE_DATES.slice(0, 4)) {
      for (const period of FREE_FORTUNE_PERIODS) {
        for (const s of STAR_SIGNS) {
          const h = buildHoroscope(s, period, base);
          const where = `${s.name} ${period} ${base.month}/${base.day}`;
          const main = [h.headline, ...h.paragraphs, h.tip, ...h.keyDays.map((k) => k.reason)];
          assertPlain([...main, h.trait, ...h.sky.map((x) => `${x.bodyLabel} ${x.signName} ${x.houseLabel} ${x.houseTheme} ${x.aspect} ${x.note}`)], where);
          assertNoRepeat(main, where);
        }
        if (period !== 'week') assertPlain(buildHoroscopeOverview(period, base).items.map((i) => i.reason), `별자리 한눈에 ${period}`);
      }
    }
  });
});

describe('꿈해몽 기본 풀이 — 사람이 말하듯', () => {
  const DREAMS = [
    '큰 뱀이 집 안으로 들어와 제 손을 물었어요. 무섭기보다는 신기했어요.',
    '돌아가신 할머니가 웃으면서 돈을 주셨어요. 맑은 물이 흘렀어요.',
    '이가 빠지는 꿈을 꿨어요. 피가 났어요.',
    '하늘을 날다가 떨어졌는데 다치지 않았어요.',
    '숫자 3이 계속 보였어요.',
    '아무 기억이 안 나요 그냥 이상했어요',
  ];
  it('사전 항목을 \'A — B\'로 붙이지 않고, 상징 목록을 말하듯 소개한다', () => {
    for (const dream of DREAMS) {
      const r = composeRuleBased(extractDreamSymbols(dream, 6), false);
      const lines = [r.headline, ...r.paragraphs];
      assertPlain(lines, dream);
      assertNoRepeat(lines, dream);
      for (const p of r.paragraphs) {
        expect(p, dream).not.toMatch(/^\S[^.]* — /); // '뱀 — 우리 민속에서…'
        expect(p, dream).not.toContain('사전의 상징');
      }
    }
    const snake = composeRuleBased(extractDreamSymbols(DREAMS[0]!, 6), false);
    expect(snake.paragraphs[0]).toMatch(/^꿈 이야기에서 .*뱀.* 눈에 띄어요\./);
    expect(snake.paragraphs.some((p) => /^뱀에게 물리는 꿈이라면, /.test(p))).toBe(true);
    const three = composeRuleBased(extractDreamSymbols(DREAMS[4]!, 6), false);
    if (three.paragraphs[0]!.includes('숫자 3')) expect(three.paragraphs[0]).toContain('숫자 3이 눈에 띄어요');
  });
});
