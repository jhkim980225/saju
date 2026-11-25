import { describe, expect, it } from 'vitest';
import {
  calculateCompatibility,
  calculateSaju,
  dayPillarOf,
  evaluateFortune,
  findRelations,
  findShinsal,
  gongmangOf,
  seun,
  tenGodOf,
  twelveStageOf,
  wolun,
} from '../src/index.js';

const sample = calculateSaju({ calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' });

describe('십신', () => {
  it.each([
    [0, 0, '비견'], [0, 1, '겁재'], [0, 2, '식신'], [0, 3, '상관'], [0, 4, '편재'],
    [0, 5, '정재'], [0, 6, '편관'], [0, 7, '정관'], [0, 8, '편인'], [0, 9, '정인'],
    [9, 4, '정관'], [6, 3, '정관'], [2, 9, '정관'],
  ])('일간 %i 기준 %i = %s', (d, t, expected) => {
    expect(tenGodOf(d, t)).toBe(expected);
  });
});

describe('12운성', () => {
  it.each([
    [0, 11, '장생'], [0, 2, '건록'], [0, 3, '제왕'], [0, 6, '사'],
    [1, 6, '장생'], [1, 3, '건록'], [1, 2, '제왕'],
    [6, 5, '장생'], [6, 8, '건록'], [9, 3, '장생'], [9, 0, '건록'],
  ])('천간 %i 지지 %i = %s', (s, b, expected) => {
    expect(twelveStageOf(s, b)).toBe(expected);
  });
});

describe('원국 분석 (1990-05-15 14:30 남)', () => {
  it('사주팔자', () => {
    const p = sample.pillars;
    expect([p.year.ganzhi.hanja, p.month.ganzhi.hanja, p.day.ganzhi.hanja, p.hour?.ganzhi.hanja]).toEqual(['庚午', '辛巳', '庚辰', '癸未']);
    expect(sample.dayMaster.hanja).toBe('庚');
    expect(sample.zodiac.animal).toBe('말');
  });
  it('십신 배치', () => {
    expect(sample.pillars.year.stem.tenGod).toBe('비견');
    expect(sample.pillars.month.stem.tenGod).toBe('겁재');
    expect(sample.pillars.hour?.stem.tenGod).toBe('상관');
    expect(sample.pillars.year.branch.tenGod).toBe('정관'); // 午 본기 丁
    expect(sample.pillars.day.branch.tenGod).toBe('편인'); // 辰 본기 戊
  });
  it('오행 합계와 백분율', () => {
    const total = Object.values(sample.elements.count).reduce((a, b) => a + b, 0);
    expect(total).toBe(8);
    const pct = Object.values(sample.elements.percent).reduce((a, b) => a + b, 0);
    expect(pct).toBe(100);
  });
  it('신강약 점수 범위와 용신 일관성', () => {
    expect(sample.strength.score).toBeGreaterThanOrEqual(0);
    expect(sample.strength.score).toBeLessThanOrEqual(100);
    expect(sample.yongsin.heesin).not.toBe(sample.yongsin.yongsin);
    expect(sample.yongsin.reason.length).toBeGreaterThan(10);
  });
  it('납음', () => {
    expect(sample.pillars.year.napeum.name).toBe('노방토'); // 庚午
  });
});

describe('대운', () => {
  it('양년(庚) 남성은 순행, 대운수 7', () => {
    expect(sample.daeun.direction).toBe('forward');
    expect(sample.daeun.startAge).toBe(7);
    expect(sample.daeun.periods[0]!.ganzhi.hanja).toBe('壬午');
    expect(sample.daeun.periods[1]!.ganzhi.hanja).toBe('癸未');
    expect(sample.daeun.periods).toHaveLength(10);
  });
  it('양년(庚) 여성은 역행', () => {
    const f = calculateSaju({ calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'female' });
    expect(f.daeun.direction).toBe('backward');
    expect(f.daeun.periods[0]!.ganzhi.hanja).toBe('庚辰');
    expect(f.daeun.startAge).toBe(3);
  });
});

describe('합충', () => {
  it('子午충, 子丑합, 申子辰 삼합 탐지', () => {
    const rel = findRelations([
      { position: 'year', stem: 0, branch: 0 },
      { position: 'month', stem: 6, branch: 6 },
      { position: 'day', stem: 1, branch: 1 },
      { position: 'hour', stem: 2, branch: 8 },
    ]);
    const types = rel.map((r) => r.type);
    expect(types).toContain('충');
    expect(types).toContain('육합');
    expect(types).toContain('천간충'); // 甲庚
    expect(types).toContain('천간합'); // 乙庚
  });
  it('공망 — 甲子일은 戌亥', () => {
    expect(gongmangOf(0, 0)).toEqual([10, 11]);
    expect(gongmangOf(0, 10)).toEqual([8, 9]); // 甲戌 → 申酉
  });
});

describe('세운·월운·일진', () => {
  it('2026 丙午, 2027 丁未', () => {
    const list = seun(sample.dayMaster.index, 2026, 2027);
    expect(list.map((x) => x.ganzhi.hanja)).toEqual(['丙午', '丁未']);
  });
  it('2027 월운은 壬寅월부터', () => {
    const months = wolun(sample.dayMaster.index, 2027);
    expect(months).toHaveLength(12);
    expect(months[0]!.ganzhi.hanja).toBe('壬寅');
    expect(months[0]!.termName).toBe('입춘');
  });
  it('일진 2026-10-12', () => {
    const p = dayPillarOf({ year: 2026, month: 10, day: 12 });
    expect(p.stem).toBeGreaterThanOrEqual(0);
  });
});

describe('운세 평가', () => {
  it('점수는 10~98, 결정적', () => {
    const today = dayPillarOf({ year: 2026, month: 10, day: 12 });
    const a = evaluateFortune(sample, today, '2026-10-12');
    const b = evaluateFortune(sample, today, '2026-10-12');
    expect(a).toEqual(b);
    for (const v of Object.values(a.scores)) {
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(98);
    }
    expect(['great', 'good', 'normal', 'caution', 'bad']).toContain(a.grade);
  });
  it('일지를 충하는 날은 branch_clash_day 하이라이트', () => {
    // 일지 辰(4) ↔ 戌(10)
    const e = evaluateFortune(sample, { stem: 0, branch: 10 });
    expect(e.highlights).toContain('branch_clash_day');
  });
});

describe('궁합', () => {
  it('점수 범위와 근거', () => {
    const b = calculateSaju({ calendar: 'solar', year: 1992, month: 8, day: 21, hour: 9, minute: 0, gender: 'female' });
    const r = calculateCompatibility(sample, b);
    expect(r.score).toBeGreaterThanOrEqual(20);
    expect(r.score).toBeLessThanOrEqual(99);
    expect(r.factors.length).toBeGreaterThan(0);
    expect(Object.keys(r.categories)).toEqual(['personality', 'romance', 'stability', 'complement']);
  });
  it('乙庚합 일간이면 stem_combine 요인', () => {
    // 일간 乙 인 사람 찾기: 1990-05-16 은 辛巳일 → 직접 날짜 탐색
    let other = null;
    for (let d = 1; d <= 28 && !other; d++) {
      const c = calculateSaju({ calendar: 'solar', year: 1991, month: 3, day: d, gender: 'female' });
      if (c.dayMaster.hanja === '乙') other = c;
    }
    expect(other).not.toBeNull();
    const r = calculateCompatibility(sample, other!);
    expect(r.factors.some((f) => f.key === 'stem_combine')).toBe(true);
  });
});

describe('신강·신약: 삼합·방합 반영', () => {
  // 1995-03-14 14:30 여성 = 乙亥 己卯 甲辰 辛未 — 亥卯未 삼합 목국, 일간 甲木
  const chart = calculateSaju({ calendar: 'solar', year: 1995, month: 3, day: 14, hour: 14, minute: 30, gender: 'female' });
  it('亥卯未 목국이 일간(목)을 돕는 쪽으로 강약에 반영된다', () => {
    expect(chart.relations.some((r) => r.type === '삼합')).toBe(true);
    // 합을 보지 않던 때는 55(중화)였다. 목국이 일간을 도우므로 신강 쪽으로 올라간다
    expect(chart.strength.score).toBeGreaterThan(58);
  });
});

describe('신살', () => {
  // 전통 표: 천을귀인(甲戊庚 丑未 · 乙己 子申 · 丙丁 亥酉 · 辛 寅午 · 壬癸 巳卯)
  const CHEONEUL_TABLE: [number, number[]][] = [
    [0, [1, 7]], [1, [0, 8]], [2, [11, 9]], [3, [11, 9]], [4, [1, 7]],
    [5, [0, 8]], [6, [1, 7]], [7, [2, 6]], [8, [5, 3]], [9, [5, 3]],
  ];
  it.each(CHEONEUL_TABLE)('일간 %i의 천을귀인 지지는 %j', (dayStem, branches) => {
    for (let b = 0; b < 12; b++) {
      // 시주 지지만 바꿔 가며 천을귀인이 시주에 잡히는지 본다
      const found = findShinsal([
        { position: 'year', stem: 0, branch: 2 },
        { position: 'month', stem: 2, branch: 2 },
        { position: 'day', stem: dayStem, branch: 2 },
        { position: 'hour', stem: 0, branch: b },
      ]).some((s) => s.name === '천을귀인' && s.positions.includes('hour'));
      expect(found, `branch ${b}`).toBe(branches.includes(b));
    }
  });

  it('乙亥 己卯 甲辰 辛未 — 귀인·살이 전통 기준대로 잡힌다', () => {
    const c = calculateSaju({ calendar: 'solar', year: 1995, month: 3, day: 14, hour: 14, minute: 30, gender: 'female' });
    expect([c.pillars.year, c.pillars.month, c.pillars.day, c.pillars.hour].map((p) => p!.ganzhi.hanja)).toEqual(['乙亥', '己卯', '甲辰', '辛未']);
    const at = (name: string) => c.shinsal.filter((s) => s.name === name).flatMap((s) => s.positions).sort();
    expect(at('천을귀인')).toEqual(['hour']); // 甲 → 未
    expect(at('학당귀인')).toEqual(['year']); // 甲의 장생지 亥
    expect(at('월덕귀인')).toEqual(['day']); // 卯월(亥卯未) → 甲
    expect(at('천덕귀인')).toEqual([]); // 卯월 → 申, 원국에 없음
    expect(at('문창귀인')).toEqual([]); // 甲 → 巳, 원국에 없음
    expect(at('양인살')).toEqual(['month']); // 甲 → 卯
    expect(at('백호살')).toEqual(['day']); // 甲辰
    expect(at('화개살')).toEqual(['hour']); // 년지 亥(亥卯未) → 未
    expect(at('공망')).toEqual(['month']); // 甲辰일 → 寅卯 공망
    expect(at('원진살')).toEqual(['year']); // 辰亥
    expect(at('귀문관살')).toEqual(['year']); // 辰亥
  });
});
