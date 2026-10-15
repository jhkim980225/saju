/**
 * 오늘의 운세 · 신년운세 · 궁합 — 사주를 모르는 사람이 읽어도 막히지 않는 말인지 회귀 검사 (docs/PLAIN_KOREAN.md).
 * 화면에 그대로 보이는 글만 모은다. 근거(basis)는 '사주로 보면'에 접어 두므로 검사에서 뺀다.
 * - 오늘: 60일주 × 날짜 36개 × 이름 있음/없음
 * - 신년: 60일주 × 3년 × 잠김/풀림 × 이름 있음/없음
 * - 궁합: 60쌍 × 잠김/풀림 × 이름 있음/없음('나'·'상대')
 */
import { calculateCompatibility, calculateSaju, type BirthInput, type SajuChart } from '@saju/core';
import type { DailyFortuneDto, ReadingSection, YearlyFortuneDto } from '@saju/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createDb, runMigrations } from '../src/db/client.js';
import { seedProducts } from '../src/db/seed.js';
import { buildCompatibilitySections, buildDailyFortune, buildYearlyFortune, yearList } from '../src/modules/interpretation/reading.js';

/** 1990-01-01 부터 60일 — 일주 60개를 한 번씩, 시간 모름·성별도 섞는다 */
const births: BirthInput[] = Array.from({ length: 60 }, (_, i) => {
  const d = new Date(Date.UTC(1990, 0, 1 + i));
  return { calendar: 'solar', year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: i % 3 === 0 ? null : 9 + (i % 12), minute: i % 3 === 0 ? null : 0, gender: i % 2 ? 'male' : 'female' };
});
const charts: SajuChart[] = births.map((b) => calculateSaju(b));

/** 2026-10-01 부터 11일 간격 36개 — 일진 60개를 고루 지나가게 */
const dates = Array.from({ length: 36 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 1 + i * 11));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
});

/** 낱말 첫머리에서만 — '상관없이' 같은 일상어는 걸리지 않게 */
const JARGON = [
  '당신', '일간', '일지', '월지', '일진', '세운', '대운', '용신', '희신', '기신', '십신', '12운성', '지장간', '신강', '신약', '천간',
  '겁재', '비견', '식신', '상관(?!없)', '편재', '정재', '편관', '정관', '편인', '정인', '순행', '역행', '오행',
  '천을귀인', '문창귀인', '도화', '역마', '화개', '공망', '양인', '육합', '삼합', '반합', '원진', '상생', '상극', '배우자성', '칠살', '효신',
  '대길', '개운법', '일주(?!일)', '간지', '만세력',
].map((j) => [j, new RegExp(`(^|[^가-힣])${j}`)] as const);
const STEMS = ['갑목', '을목', '병화', '정화', '무토', '기토', '경금', '신금', '임수', '계수'];

/** 받침 있는 글자 */
const hasBatchim = (ch: string) => {
  const c = ch.charCodeAt(0);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 > 0;
};

/** 화면 글에서 문제를 모은다 — 항목마다 expect 를 부르면 수백만 번이라 느려서, 문제 문자열만 모아 한 번에 본다 */
function problemsIn(lines: string[], where: string, opts: { named: boolean }): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (/[一-鿿]/.test(line)) out.push(`${where}: 한자 — ${line}`);
    for (const [j, re] of JARGON) if (re.test(line)) out.push(`${where}: 용어 '${j}' — ${line}`);
    for (const s of STEMS) if (new RegExp(`${s}(은|는|의|에게|이|가) `).test(line)) out.push(`${where}: ${s} — ${line}`);
    if (/undefined|null|NaN|\{|\}|\s{2,}|님님|나님|상대님|\(이\)|\(가\)|\(을\)|\(를\)|\(은\)|\(는\)/.test(line)) out.push(`${where}: 이음새 — ${line}`);
    if (line.trim() !== line) out.push(`${where}: 앞뒤 공백 — '${line}'`);
    // 이어 붙인 티 — '날예요'(받침 뒤 예요)·'해이에요'(받침 없는데 이에요)
    for (const m of line.matchAll(/([가-힣])예요/g)) if (hasBatchim(m[1]!)) out.push(`${where}: '${m[0]}' — ${line}`);
    for (const m of line.matchAll(/([가-힣])이에요/g)) if (!hasBatchim(m[1]!)) out.push(`${where}: '${m[0]}' — ${line}`);
    if (!opts.named && line.includes('님')) out.push(`${where}: 이름이 없는데 '님' — ${line}`);
  }
  // 한 화면에 같은 문장이 두 번 나오지 않는다
  const seen = new Set<string>();
  for (const sentence of lines.flatMap((l) => l.split(/(?<=[.!?…])\s+/)).map((x) => x.trim()).filter((x) => x.length > 12)) {
    if (seen.has(sentence)) out.push(`${where}: 반복 — ${sentence}`);
    seen.add(sentence);
  }
  return out;
}

/** 오늘 화면에 보이는 글 — 한 줄·등급·본문·한눈에 보는 오늘·분야별·행운·오늘이 이런 이유·공유 문구 */
const dailyLines = (d: DailyFortuneDto) => [
  d.headline,
  d.gradeLabel,
  d.message,
  ...(d.keyPoints ?? []).flatMap((k) => [k.label, k.text]),
  ...d.categories.flatMap((c) => [c.label, c.message]),
  d.lucky.color,
  d.lucky.direction,
  d.lucky.item,
  d.lucky.time,
  ...(d.why ?? []),
  d.shareText,
];

/** 섹션에서 보이는 글 — 잠긴 섹션은 요약·미리보기 문단·목차 */
const sectionLines = (s: ReadingSection) => [s.title, s.summary, ...s.paragraphs, ...(s.tips ?? []), ...(s.locked ? (s.toc ?? []) : [])].filter(Boolean);

const yearlyLines = (y: YearlyFortuneDto) => [
  y.yearName ?? '',
  y.gradeLabel ?? '',
  y.headline,
  ...(y.keyPoints ?? []).flatMap((k) => [k.label, k.text]),
  ...y.sections.flatMap(sectionLines),
  ...y.months.flatMap((m) => [m.label, m.summary].filter(Boolean)),
];

describe('오늘의 운세 — 사람이 말하듯 쉬운 말', () => {
  for (const name of ['서윤', '']) {
    it(`60일주 × 36일 · 이름 ${name ? '있음' : '없음'} — 용어·한자·'당신'·반복 문장·어색한 이음새 없음`, () => {
      const problems: string[] = [];
      for (const [ci, chart] of charts.entries()) {
        for (const date of dates) {
          const d = buildDailyFortune(chart, date, null, name);
          const where = `${births[ci]!.year}-${births[ci]!.month}-${births[ci]!.day} @ ${d.date} ${name || '(이름 없음)'}`;
          expect(d.keyPoints?.map((k) => k.label), where).toEqual(['잘 풀리는 일', '조심할 일', '오늘 해 볼 일']);
          expect(['아주 좋은 날', '좋은 날', '무난한 날', '조심할 날', '쉬어 가는 날'], where).toContain(d.gradeLabel);
          expect(d.categories.map((c) => c.label), where).toEqual(['돈', '연애', '일', '건강', '공부']);
          expect(d.why?.length, where).toBeGreaterThan(0);
          expect(d.basis, where).toMatch(/^오늘 일진 .+\(.+\) · 천간 /); // 용어는 근거에만
          // "오늘은 …" 이 화면에 일곱 번씩 나오지 않게 — 분야별 줄은 '오늘은'으로 시작하지 않는다
          for (const c of d.categories) expect(c.message, where).not.toMatch(/^오늘/);
          expect(d.keyPoints![2]!.text, where).not.toMatch(/^오늘/);
          if (name) expect(d.message, where).toMatch(/^서윤님, 오늘/);
          problems.push(...problemsIn(dailyLines(d), where, { named: Boolean(name) }));
        }
      }
      expect(problems.slice(0, 20)).toEqual([]);
    }, 120_000);
  }

  it("이름이 '나'·'본인'이면 이름 없이 부른다", () => {
    for (const n of ['나', '본인', '  ']) {
      const d = buildDailyFortune(charts[0]!, dates[0]!, null, n);
      expect(problemsIn(dailyLines(d), `이름 '${n}'`, { named: false })).toEqual([]);
    }
  });
});

describe('신년운세 — 사람이 말하듯 쉬운 말', () => {
  for (const name of ['서윤', '']) {
    it(`60일주 × 3년 × 잠김/풀림 · 이름 ${name ? '있음' : '없음'}`, () => {
      const problems: string[] = [];
      for (const [ci, chart] of charts.entries()) {
        for (const year of [2026, 2027, 2028]) {
          for (const unlocked of [false, true]) {
            const y = buildYearlyFortune(chart, year, unlocked, name);
            const where = `${births[ci]!.year}-${births[ci]!.month}-${births[ci]!.day} · ${year} ${unlocked ? '풀림' : '잠김'} ${name || '(이름 없음)'}`;
            expect(y.yearName, where).toMatch(/^(푸른|붉은|누런|흰|검은) [가-힣]+의 해$/);
            expect(['아주 좋은 해', '좋은 해', '무난한 해', '조심할 해', '쉬어 가는 해'], where).toContain(y.gradeLabel);
            expect(y.keyPoints?.map((k) => k.label), where).toEqual(['올해의 기운', '잘 풀리는 일', '조심할 것', '해 볼 일']);
            expect(y.months, where).toHaveLength(12);
            expect(y.months.filter((m) => m.locked), where).toHaveLength(unlocked ? 0 : 10);
            // 잠긴 달은 같은 안내문을 열 번 늘어놓지 않는다(화면은 자물쇠만, 안내는 목록 아래 한 줄)
            for (const m of y.months.filter((x) => x.locked)) expect(m.summary, where).toBe('');
            // 한 해 이야기에 '오늘'이 섞이지 않는다(예전에는 분야별 요약에 오늘의 운세 문구를 썼다)
            for (const s of y.sections) expect(s.summary, where).not.toMatch(/오늘/);
            // 머리말(한 줄 평)이 총운 요약으로 또 나오지 않는다
            expect(y.sections.map((s) => s.summary), where).not.toContain(y.headline);
            expect(y.sections[0]!.basis, where).toMatch(/천간 .+ · 지지 /);
            if (name) expect(y.sections[0]!.paragraphs[0], where).toMatch(new RegExp(`^${year}년은 (서윤님에게 )?`));
            problems.push(...problemsIn(yearlyLines(y), where, { named: Boolean(name) }));
          }
        }
      }
      expect(problems.slice(0, 20)).toEqual([]);
    }, 60_000);
  }

  it('세운 목록에 쉬운 이름이 함께 온다', () => {
    const list = yearList(charts[0]!, 2026, 2030);
    expect(list).toHaveLength(5);
    for (const y of list) {
      expect(y.yearName).toMatch(/^(푸른|붉은|누런|흰|검은) [가-힣]+의 해$/);
      expect(['아주 좋은 해', '좋은 해', '무난한 해', '조심할 해', '쉬어 가는 해']).toContain(y.gradeLabel);
      expect(y.theme).toMatch(/^[가-힣]+과 [가-힣]+$|^[가-힣]+와 [가-힣]+$/);
    }
    expect(list.find((y) => y.year === 2026)!.yearName).toBe('붉은 말의 해');
    expect(list.find((y) => y.year === 2027)!.yearName).toBe('붉은 양의 해');
  });
});

describe('궁합 — 사람이 말하듯 쉬운 말', () => {
  const pairs = charts.map((c, i) => [c, charts[(i * 7 + 3) % 60]!] as const);
  for (const [na, nb] of [['서윤', '지훈'], ['나', '상대']] as const) {
    it(`60쌍 × 잠김/풀림 · 이름 ${na === '나' ? '없음(나·상대)' : '있음'}`, () => {
      const problems: string[] = [];
      for (const [pi, [a, b]] of pairs.entries()) {
        for (const unlocked of [false, true]) {
          const r = calculateCompatibility(a, b);
          const built = buildCompatibilitySections(a, b, r, { a: na, b: nb }, unlocked);
          const where = `쌍 ${pi} ${unlocked ? '풀림' : '잠김'} ${na}×${nb}`;
          expect(built.sections.map((s) => s.key), where).toEqual(['summary', 'strengths', 'cautions', 'advice']);
          const summary = built.sections[0]!;
          expect(summary.locked, where).toBeUndefined();
          expect(summary.basis, where).toMatch(/일간 /);
          expect(summary.paragraphs[0], where).toMatch(na === '나' ? /^(나는 |두 사람 모두 )/ : /^(서윤님은 |두 사람 모두 )/);
          // 점수 카드의 한 줄 평·등급이 섹션 요약으로 또 나오지 않는다
          for (const s of built.sections) expect([built.headline, built.gradeLabel], where).not.toContain(s.summary);
          for (const s of built.sections.slice(1)) expect(s.locked ?? false, where).toBe(!unlocked);
          const lines = [built.headline, built.gradeLabel, ...built.sections.flatMap(sectionLines)];
          problems.push(...problemsIn(lines, where, { named: na !== '나' }));
        }
      }
      expect(problems.slice(0, 20)).toEqual([]);
    }, 60_000);
  }
});

describe('이름이 API 까지 이어진다', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const config = loadConfig({ __SKIP_ENV_FILE: '1', NODE_ENV: 'test', PAYMENT_PROVIDER: 'mock', ANTHROPIC_API_KEY: '', SIGNUP_BONUS_CREDITS: '0' });
    const { db } = createDb(':memory:');
    runMigrations(db);
    seedProducts(db);
    app = await buildApp({ config, db, logger: false });
  });
  afterAll(async () => {
    await app.close();
  });
  const BIRTH = { calendar: 'solar', year: 1995, month: 3, day: 14, hour: 14, minute: 30, gender: 'female' } as const;
  const call = async (method: 'GET' | 'POST', url: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await app.inject({ method, url: `/api/v1${url}`, headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {}, ...(opts.body !== undefined ? { payload: opts.body as object } : {}) });
    return JSON.parse(res.body) as any;
  };

  it('비회원 오늘의 운세 — 입력한 이름으로 부른다', async () => {
    const named = await call('POST', '/fortune/daily', { body: { birth: BIRTH, date: '2026-10-15', name: '서윤' } });
    expect(named.message).toMatch(/^서윤님, 오늘/);
    expect(named.keyPoints).toHaveLength(3);
    const anon = await call('POST', '/fortune/daily', { body: { birth: BIRTH, date: '2026-10-15' } });
    expect(anon.message).toMatch(/^오늘/);
  });

  it('프로필로 보는 오늘·신년운세 — 프로필 이름으로 부른다', async () => {
    const guest = await call('POST', '/auth/guest', { body: { deviceId: 'plain-fortune-test-device' } });
    const token = guest.tokens?.accessToken ?? guest.accessToken;
    const profile = await call('POST', '/profiles', { token, body: { name: '서윤', relation: 'self', birth: BIRTH } });
    const daily = await call('GET', `/fortune/daily?profileId=${profile.id}&date=2026-10-15`, { token });
    expect(daily.message).toMatch(/^서윤님, 오늘/);
    const yearly = await call('GET', `/fortune/yearly?profileId=${profile.id}&year=2027`, { token });
    expect(yearly.yearName).toBe('붉은 양의 해');
    expect(yearly.sections[0].paragraphs[0]).toMatch(/^2027년은 /);
    expect(JSON.stringify(yearly.sections.map((s: ReadingSection) => s.paragraphs))).toContain('서윤님');
  });
});
