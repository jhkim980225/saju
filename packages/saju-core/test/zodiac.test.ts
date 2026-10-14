import { describe, expect, it } from 'vitest';
import {
  birthYearsOfAnimal,
  branchBonds,
  dayPillarAt,
  evaluateZodiac,
  ganzhiHanja,
  lunarToSolar,
  monthPillarAt,
  moonElongation,
  moonLongitude,
  nextSignChange,
  signAspect,
  signOfBody,
  solarHouse,
  solarTermsOfYear,
  stemBond,
  sunLongitude,
  weekDatesOf,
  yearPillarAt,
} from '../src/index.js';

const kinds = (a: number, b: number) => branchBonds(a, b).map((x) => x.kind);
const hanja = (p: { stem: number; branch: number }) => ganzhiHanja(p.stem, p.branch);

describe('띠 지지 관계 (합충형파해·원진)', () => {
  it.each([
    [2, 8, ['충', '형']], // 寅申 — 충이면서 寅巳申 삼형
    [2, 11, ['육합', '파']], // 寅亥 — 합이면서 파
    [5, 8, ['육합', '형', '파']], // 巳申 — 합·형·파가 겹침
    [0, 7, ['해', '원진']], // 子未
    [0, 3, ['형']], // 子卯 무례지형
    [1, 10, ['형']], // 丑戌 (丑戌未 삼형)
    [9, 10, ['해']], // 酉戌
    [3, 10, ['육합']], // 卯戌
    [2, 6, ['삼합']], // 寅午 (寅午戌)
    [2, 10, ['삼합']], // 寅戌 — 왕지가 없어도 같은 삼합국으로 본다
    [4, 4, ['동일', '자형']], // 辰辰
    [2, 2, ['동일']], // 寅寅 (자형 아님)
    [0, 2, []], // 子寅 — 관계 없음
  ])('지지 %i ↔ %i = %j', (a, b, expected) => {
    expect(kinds(a, b)).toEqual(expected);
  });

  it('합이 만드는 오행', () => {
    expect(branchBonds(2, 11)[0]).toEqual({ kind: '육합', element: 'wood' });
    expect(branchBonds(2, 10)[0]).toEqual({ kind: '삼합', element: 'fire' });
    expect(branchBonds(8, 4)[0]).toEqual({ kind: '삼합', element: 'water' });
  });
});

describe('기간별 운 기둥 — 손으로 확인한 날짜', () => {
  it('2026-10-15 일진 壬戌 (2000-01-01 戊午 + 9,784일)', () => {
    expect(hanja(dayPillarAt({ year: 2026, month: 10, day: 15 }))).toBe('壬戌');
  });
  it('2026-10-15 월건 戊戌 (丙년 오호둔: 庚寅월부터 → 戌월은 戊), 세운 丙午', () => {
    const m = monthPillarAt({ year: 2026, month: 10, day: 15 });
    expect(hanja(m)).toBe('戊戌');
    expect(m.termName).toBe('한로');
    expect(m.nextTermName).toBe('입동');
    expect(hanja(yearPillarAt({ year: 2026, month: 10, day: 15 }))).toBe('丙午');
  });
  it('입춘 전날은 앞 해 세운 — 2026-02-03 乙巳, 2026-02-05 丙午', () => {
    expect(hanja(yearPillarAt({ year: 2026, month: 2, day: 3 }))).toBe('乙巳');
    expect(hanja(yearPillarAt({ year: 2026, month: 2, day: 5 }))).toBe('丙午');
  });
  it('절입일은 정오 기준 — 2024 경칩(3월 5일 11:22 KST) 당일 정오는 이미 丁卯월, 전날은 丙寅월', () => {
    expect(hanja(monthPillarAt({ year: 2024, month: 3, day: 5 }))).toBe('丁卯');
    expect(hanja(monthPillarAt({ year: 2024, month: 3, day: 4 }))).toBe('丙寅');
  });
  it('이번 주는 월요일부터 일요일까지', () => {
    const w = weekDatesOf({ year: 2026, month: 10, day: 15 });
    expect(w).toHaveLength(7);
    expect(w[0]).toEqual({ year: 2026, month: 10, day: 12 });
    expect(w[6]).toEqual({ year: 2026, month: 10, day: 18 });
    expect(weekDatesOf({ year: 2026, month: 10, day: 18 })[0]).toEqual({ year: 2026, month: 10, day: 12 });
  });
  it('범띠 출생 연도 (1936~2019)', () => {
    expect(birthYearsOfAnimal(2, 1936, 2019)).toEqual([1938, 1950, 1962, 1974, 1986, 1998, 2010]);
  });
});

describe('띠 운 평가', () => {
  const day = dayPillarAt({ year: 2026, month: 10, day: 15 }); // 壬戌
  it('寅띠 × 壬戌일 — 寅戌 삼합 + 壬水가 寅木을 생함 → 좋음', () => {
    const e = evaluateZodiac(2, day);
    expect(e.primary).toBe('삼합');
    expect(e.flow).toBe('support');
    expect(e.tone).toBe('good');
  });
  it('辰띠 × 壬戌일 — 辰戌충 → 살펴 가기', () => {
    const e = evaluateZodiac(4, day);
    expect(e.primary).toBe('충');
    expect(e.tone).toBe('caution');
  });
  it('巳띠 × 申 — 합과 형·파가 함께 → 섞임', () => {
    expect(evaluateZodiac(5, { stem: 6, branch: 8 }).tone).toBe('mixed');
  });
  it('결정적 — 같은 입력은 같은 결과', () => {
    expect(evaluateZodiac(7, day)).toEqual(evaluateZodiac(7, day));
  });
  it('태어난 해 천간 관계', () => {
    expect(stemBond(0, 5)).toMatchObject({ combine: 'earth', clash: false, tenGod: '정재' }); // 甲己합
    expect(stemBond(0, 6)).toMatchObject({ combine: null, clash: true, tenGod: '편관' }); // 甲庚충
    expect(stemBond(2, 8)).toMatchObject({ clash: true }); // 丙壬충
    expect(stemBond(8, 9).tenGod).toBe('겁재');
  });
});

describe('간이 천문 계산', () => {
  const jd = (v: number) => (v - 2_440_587.5) * 86_400_000;
  const kstNoon = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 3);

  it('달 황경 — Meeus 예제 47.a (1992-04-12 0h TD) 133.1627°', () => {
    expect(moonLongitude(jd(2_448_724.5))).toBeCloseTo(133.1627, 1);
  });
  it('태양 황경 — Meeus 예제 25.a (1992-10-13 0h TD) 겉보기 199.909°', () => {
    expect(sunLongitude(jd(2_448_908.5))).toBeCloseTo(199.909, 2);
  });
  it('태양 황경 — 1950~2049 중기(춘분 0°, 곡우 30° …) 시각과 0.05° 안에서 일치 (lunar-javascript·KASI 절기)', () => {
    const ZHONG = ['春分', '谷雨', '小满', '夏至', '大暑', '处暑', '秋分', '霜降', '小雪', '冬至', '大寒', '雨水'];
    let worst = 0;
    for (let y = 1950; y <= 2049; y++) {
      for (const t of solarTermsOfYear(y)) {
        const i = ZHONG.indexOf(t.key);
        if (i < 0) continue;
        const d = ((sunLongitude(t.utcMs) - i * 30 + 540) % 360) - 180;
        worst = Math.max(worst, Math.abs(d));
      }
    }
    expect(worst).toBeLessThan(0.05);
  });
  it('달 — 음력 초하루(KASI) 정오의 달·태양 이각은 ±8° 안 (2000~2049, 600개월)', () => {
    let worst = 0;
    for (let y = 2000; y <= 2049; y++) {
      for (let m = 1; m <= 12; m++) {
        const s = lunarToSolar({ year: y, month: m, day: 1, isLeapMonth: false });
        const e = moonElongation(kstNoon(s.year, s.month, s.day));
        worst = Math.max(worst, Math.min(e, 360 - e));
      }
    }
    expect(worst).toBeLessThan(8);
  });
  it('2026-10-15 정오 달은 사수자리 (10월 10일 천칭자리 삭에서 약 5일 — 이각 약 64°)', () => {
    const t = kstNoon(2026, 10, 15);
    expect(signOfBody('moon', t)).toBe(8);
    expect(signOfBody('sun', t)).toBe(6);
  });
  it('목성·토성 별자리 — 2025~2027 알려진 입궁과 일치', () => {
    expect(signOfBody('jupiter', kstNoon(2024, 1, 1))).toBe(1); // 황소자리
    expect(signOfBody('jupiter', kstNoon(2026, 3, 1))).toBe(3); // 게자리
    expect(signOfBody('jupiter', kstNoon(2026, 8, 1))).toBe(4); // 사자자리
    expect(signOfBody('saturn', kstNoon(2025, 1, 1))).toBe(11); // 물고기자리
    expect(signOfBody('saturn', kstNoon(2026, 6, 1))).toBe(0); // 양자리
    const leo = nextSignChange('jupiter', kstNoon(2026, 3, 1))!;
    expect(leo.to).toBe(4);
    // 목성 사자자리 입궁 2026-06-30 무렵
    expect(Math.abs(leo.utcMs - Date.UTC(2026, 5, 30, 0))).toBeLessThan(2 * 86_400_000);
  });
  it('태양 별자리 이동 — 2026 전갈자리 입궁 10월 23일 18시대(KST)', () => {
    const c = nextSignChange('sun', kstNoon(2026, 10, 15))!;
    expect(c.to).toBe(7);
    const kst = new Date(c.utcMs + 9 * 3_600_000);
    expect([kst.getUTCMonth() + 1, kst.getUTCDate(), kst.getUTCHours()]).toEqual([10, 23, 18]);
  });
  it('홀사인 하우스와 각', () => {
    expect(solarHouse(0, 8)).toBe(9); // 양자리에서 사수자리 = 9번째
    expect(solarHouse(8, 0)).toBe(5);
    expect(solarHouse(11, 11)).toBe(1);
    expect(signAspect(0, 8)).toBe('trine');
    expect(signAspect(0, 3)).toBe('square');
    expect(signAspect(0, 6)).toBe('opposition');
    expect(signAspect(0, 0)).toBe('conjunction');
    expect(signAspect(0, 5)).toBe('quincunx');
    expect(signAspect(0, 11)).toBe('semisextile');
    expect(signAspect(0, 10)).toBe('sextile');
  });
});
