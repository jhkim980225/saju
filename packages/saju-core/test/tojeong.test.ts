import { describe, expect, it } from 'vitest';
import {
  SajuInputError,
  TOJEONG_CODES,
  computeTojeong,
  lunarBirthOf,
  lunarMonthDays,
  lunarMonthGanzhi,
  tojeongMonthRanges,
} from '../src/index.js';

/**
 * 손으로 풀어 본 예시 — 계산 과정은 docs/SAJU_ENGINE.md「토정비결 작괘」 에 같은 순서로 적어 두었다.
 * 천간수 甲己9 乙庚8 丙辛7 丁壬6 戊癸5 / 태세 지지수 子11 丑13 寅10 卯10 辰13 巳9 午9 未13 申12 酉12 戌13 亥11
 * 월건 지지수 子9 丑8 寅7 卯6 辰5 巳4 午9 未8 申7 酉6 戌5 亥4 / 일진 지지수 子9 丑11 寅8 卯8 辰11 巳7 午7 未11 申10 酉10 戌11 亥9
 */
describe('토정비결 작괘 — 손으로 푼 예시', () => {
  it('출전 예시: 癸未년(2003) 32세 음력 7월 9일생 → 231괘', () => {
    // 상괘: 癸5 + 未13 + 32 = 50 → 50 ÷ 8 나머지 2
    // 중괘: 2003년 7월 庚申(8+7=15) + 큰달 30 = 45 → 45 ÷ 6 나머지 3
    // 하괘: 2003년 음력 7월 9일(양력 8월 6일) 辛亥(7+9=16) + 9 = 25 → 25 ÷ 3 나머지 1
    const r = computeTojeong({ calendar: 'lunar', year: 1972, month: 7, day: 9 }, 2003);
    expect(r.age).toBe(32);
    expect(r.taese).toMatchObject({ value: 18, sum: 50 });
    expect(r.taese.ganzhi.hanja).toBe('癸未');
    expect(r.wolgeon).toMatchObject({ value: 15, monthDays: 30, sum: 45 });
    expect(r.wolgeon.ganzhi.hanja).toBe('庚申');
    expect(r.iljin.solarDate).toEqual({ year: 2003, month: 8, day: 6 });
    expect(r.iljin.ganzhi.hanja).toBe('辛亥');
    expect(r.iljin).toMatchObject({ value: 16, sum: 25 });
    expect([r.upper, r.middle, r.lower, r.code]).toEqual([2, 3, 1, 231]);
    expect(r.notes).toEqual([]);
  });

  it('출전 예시(상괘만): 甲申년 40세 → 9 + 12 + 40 = 61 → 5', () => {
    // 2004 甲申년에 40세 = 음력 1965년생
    expect(computeTojeong({ calendar: 'lunar', year: 1965, month: 1, day: 1 }, 2004).upper).toBe(5);
  });

  it('2027 丁未년, 양력 1990-05-15(음력 4월 21일)생 → 163괘 (중괘·하괘 나머지 0)', () => {
    // 상괘: 세는나이 38 + 丁6 + 未13 = 57 → 1
    // 중괘: 2027년 4월 乙巳(8+4=12) + 큰달 30 = 42 → 나머지 0 → 6
    // 하괘: 2027년 음력 4월 21일(양력 5월 26일) 乙巳(8+7=15) + 21 = 36 → 나머지 0 → 3
    const r = computeTojeong({ calendar: 'solar', year: 1990, month: 5, day: 15 }, 2027);
    expect(r.lunarBirth).toEqual({ year: 1990, month: 4, day: 21, isLeapMonth: false });
    expect(r.age).toBe(38);
    expect(r.taese).toMatchObject({ value: 19, sum: 57 });
    expect(r.wolgeon.ganzhi.hanja).toBe('乙巳');
    expect(r.wolgeon).toMatchObject({ value: 12, monthDays: 30, sum: 42 });
    expect(r.iljin.solarDate).toEqual({ year: 2027, month: 5, day: 26 });
    expect(r.iljin.ganzhi.hanja).toBe('乙巳');
    expect(r.iljin).toMatchObject({ value: 15, sum: 36 });
    expect(r.code).toBe(163);
  });

  it('상괘 나머지 0 → 8: 2027년 37세(음력 1991년 3월 15일생) → 813괘', () => {
    // 상괘: 37 + 19 = 56 → 0 → 8 / 중괘: 3월 甲辰(9+5=14) + 작은달 29 = 43 → 1
    // 하괘: 2027년 음력 3월 15일(양력 4월 21일) 庚午(8+7=15) + 15 = 30 → 0 → 3
    const r = computeTojeong({ calendar: 'lunar', year: 1991, month: 3, day: 15 }, 2027);
    expect(r.taese.sum).toBe(56);
    expect(r.wolgeon).toMatchObject({ value: 14, monthDays: 29, sum: 43 });
    expect(r.iljin.ganzhi.hanja).toBe('庚午');
    expect(r.code).toBe(813);
  });

  it('윤달 출생은 평달로 본다: 음력 1987년 윤6월 10일생 → 2027년 411괘', () => {
    // 상괘: 41 + 19 = 60 → 4 / 중괘: 6월 丁未(6+8=14) + 작은달 29 = 43 → 1
    // 하괘: 2027년 음력 6월 10일(양력 7월 13일) 癸巳(5+7=12) + 10 = 22 → 1
    const r = computeTojeong({ calendar: 'lunar', year: 1987, month: 6, day: 10, isLeapMonth: true }, 2027);
    expect(r.lunarBirth.isLeapMonth).toBe(true);
    expect(r.wolgeon.ganzhi.hanja).toBe('丁未');
    expect(r.iljin.solarDate).toEqual({ year: 2027, month: 7, day: 13 });
    expect(r.iljin.ganzhi.hanja).toBe('癸巳');
    expect(r.code).toBe(411);
    expect(r.notes[0]).toContain('평달');
    // 같은 날의 평달 출생과 결과가 같다
    expect(computeTojeong({ calendar: 'lunar', year: 1987, month: 6, day: 10 }, 2027).code).toBe(411);
  });

  it('30일생인데 그해 생월이 작은달이면 그믐(29일) 일진: 음력 2003년 1월 30일생 → 2027년 463괘', () => {
    // 상괘: 25 + 19 = 44 → 4 / 중괘: 정월 壬寅(6+7=13) + 작은달 29 = 42 → 6
    // 하괘: 2027년 음력 1월 29일(양력 3월 7일) 乙酉(8+10=18) + 생일수 30 = 48 → 3
    const r = computeTojeong({ calendar: 'lunar', year: 2003, month: 1, day: 30 }, 2027);
    expect(r.wolgeon.monthDays).toBe(29);
    expect(r.iljin).toMatchObject({ birthDay: 30, lunarDay: 29, value: 18, sum: 48 });
    expect(r.iljin.solarDate).toEqual({ year: 2027, month: 3, day: 7 });
    expect(r.code).toBe(463);
    expect(r.notes.some((n) => n.includes('그믐'))).toBe(true);
  });

  it('대상 연도에 생월 윤달이 있으면 평달 기준: 2028년(윤5월) 음력 1980년 5월 5일생 → 223괘', () => {
    // 상괘: 49 + 戊5 + 申12 = 66 → 2 / 중괘: 5월 戊午(5+9=14) + 평달 큰달 30 = 44 → 2
    // 하괘: 2028년 음력 5월 5일(양력 5월 28일) 癸丑(5+11=16) + 5 = 21 → 3
    const r = computeTojeong({ calendar: 'lunar', year: 1980, month: 5, day: 5 }, 2028);
    expect(r.taese.ganzhi.hanja).toBe('戊申');
    expect(r.wolgeon).toMatchObject({ monthDays: 30, value: 14 });
    expect(r.iljin.solarDate).toEqual({ year: 2028, month: 5, day: 28 });
    expect(r.iljin.ganzhi.hanja).toBe('癸丑');
    expect(r.code).toBe(223);
    expect(r.months[4]!.includesLeapMonth).toBe(true);
    expect(r.notes.some((n) => n.includes('윤5월'))).toBe(true);
  });
});

describe('토정비결 보조 계산', () => {
  it('2027년 음력 달의 크기(한국천문연구원 음력)', () => {
    expect(Array.from({ length: 12 }, (_, i) => lunarMonthDays(2027, i + 1))).toEqual([29, 30, 29, 30, 29, 29, 30, 29, 29, 30, 30, 30]);
  });

  it('월건은 음력 달 번호와 년상기월법으로 정한다 (丁壬년 정월 = 壬寅)', () => {
    expect(lunarMonthGanzhi(2027, 1).hanja).toBe('壬寅');
    expect(lunarMonthGanzhi(2027, 12).hanja).toBe('癸丑');
    expect(lunarMonthGanzhi(2024, 1).hanja).toBe('丙寅'); // 甲辰년
  });

  it('2027년 음력 열두 달의 양력 기간', () => {
    const m = tojeongMonthRanges(2027);
    expect(m[0]).toEqual({ month: 1, start: { year: 2027, month: 2, day: 7 }, end: { year: 2027, month: 3, day: 7 }, includesLeapMonth: false });
    expect(m[11]!.start).toEqual({ year: 2027, month: 12, day: 28 });
    expect(m[11]!.end).toEqual({ year: 2028, month: 1, day: 26 });
  });

  it('양력 생일은 그날의 음력으로 바꾼다', () => {
    expect(lunarBirthOf({ calendar: 'solar', year: 1990, month: 5, day: 15 })).toEqual({ year: 1990, month: 4, day: 21, isLeapMonth: false });
    // 양력 1월생은 음력으로 전년도 — 세는나이도 음력 연도로 센다
    expect(computeTojeong({ calendar: 'solar', year: 1990, month: 1, day: 20 }, 2027).age).toBe(39);
  });

  it('잘못된 입력은 SajuInputError', () => {
    expect(() => computeTojeong({ calendar: 'lunar', year: 1995, month: 1, day: 30 }, 2027)).toThrow(SajuInputError); // 1995년 정월은 작은달
    expect(() => computeTojeong({ calendar: 'lunar', year: 1990, month: 3, day: 1, isLeapMonth: true }, 2027)).toThrow(SajuInputError); // 1990년 윤3월 없음
    expect(() => computeTojeong({ calendar: 'solar', year: 2030, month: 1, day: 1 }, 2027)).toThrow(SajuInputError);
    expect(() => computeTojeong({ calendar: 'solar', year: 1990, month: 1, day: 1 }, 2050)).toThrow(SajuInputError);
  });

  it('괘 번호는 언제나 144괘 안에 있다', () => {
    const codes = new Set(TOJEONG_CODES);
    expect(codes.size).toBe(144);
    for (let y = 1940; y <= 2015; y += 7) {
      for (let m = 1; m <= 12; m++) {
        for (const d of [1, 14, 29]) {
          const r = computeTojeong({ calendar: 'lunar', year: y, month: m, day: d }, 2027);
          expect(codes.has(r.code)).toBe(true);
        }
      }
    }
  });
});
