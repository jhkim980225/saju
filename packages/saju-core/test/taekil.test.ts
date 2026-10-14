import { Solar } from 'lunar-javascript';
import { describe, expect, it } from 'vitest';
import {
  DAY_OFFICERS,
  OFFICER_NET,
  OFFICER_WEIGHT,
  TAEKIL_PURPOSE_KEYS,
  TIAN_SHEN,
  addDays,
  calculateSaju,
  evaluateTaekilDay,
  monthBranchOfDate,
  selectTaekilDays,
  sonDirectionOf,
  taekilAlmanac,
  taekilDateRange,
  yellowHoursOf,
  ymdKey,
  type DayOfficer,
  type Ymd,
} from '../src/index.js';

const ymd = (s: string): Ymd => {
  const [year, month, day] = s.split('-').map(Number) as [number, number, number];
  return { year, month, day };
};
const almanac = (s: string) => taekilAlmanac(ymd(s));

/** 1990-05-15 14:30 남 — 庚午년 辛巳월 庚辰일 癸未시 (analysis.test.ts 와 같은 사주) */
const chart = calculateSaju({ calendar: 'solar', year: 1990, month: 5, day: 15, hour: 14, minute: 30, gender: 'male' });

describe('건제12신(十二直) — 손으로 확인한 날', () => {
  it.each([
    // [날짜, 일진, 월건, 직] — 월건은 절입일(KST 날짜)부터 바뀐다
    ['2026-10-15', '壬戌', 10, '건'], // 한로(10/8) 뒤 戌월, 戌일 = 建
    ['2026-11-06', '甲申', 10, '개'], // 戌월 申일 = 開
    ['2026-11-07', '乙酉', 11, '개'], // 입동 절입일 — 亥월로 바뀌며 전날의 開가 한 번 겹친다
    ['2026-12-20', '戊辰', 0, '정'], // 대설(12/7) 뒤 子월 辰일 = 定
    ['2026-12-22', '庚午', 0, '파'], // 子월 午일 = 破(월파)
  ] as const)('%s %s → %s월 %s', (date, gz, monthBranch, officer) => {
    const a = almanac(date);
    expect(a.ganzhi.hanja).toBe(gz);
    expect(a.monthBranch).toBe(monthBranch);
    expect(a.officer.name).toBe(officer);
  });

  it('절입 시각이 KST 자정 직후면 한국 날짜 기준으로 월건이 바뀐다 (2026 망종 06-06 00:48 KST)', () => {
    expect(monthBranchOfDate(ymd('2026-06-05'))).toBe(5); // 巳월
    expect(monthBranchOfDate(ymd('2026-06-06'))).toBe(6); // 午월
    expect(almanac('2026-06-06').officer.name).toBe(almanac('2026-06-05').officer.name);
    expect(almanac('2026-06-06').monthStarts).toBe(true);
  });
});

describe('황도·흑도(12천신) — 손으로 확인한 날', () => {
  it.each([
    ['2026-10-15', '백호', false], // 戌월 청룡 辰 → 戌 = 백호
    ['2026-11-06', '금궤', true],
    ['2026-11-07', '주작', false], // 亥월 청룡 午 → 酉 = 주작
    ['2026-12-20', '천뢰', false], // 子월 청룡 申 → 辰 = 천뢰
  ] as const)('%s → %s', (date, name, yellow) => {
    const a = almanac(date);
    expect(a.tianShen.name).toBe(name);
    expect(a.tianShen.yellow).toBe(yellow);
  });
  it('황도 6개는 청룡·명당·금궤·천덕·옥당·사명', () => {
    expect(TIAN_SHEN.filter((t) => t.yellow).map((t) => t.name)).toEqual(['청룡', '명당', '금궤', '천덕', '옥당', '사명']);
  });
});

describe('손 없는 날 — 한국 음력(KASI)', () => {
  it('2026 설날(02-17)=음력 1/1 기준: 02-25(1/9)·02-26(1/10)은 손 없는 날, 02-27(1/11)은 동쪽', () => {
    expect(almanac('2026-02-17').lunar).toMatchObject({ month: 1, day: 1, isLeapMonth: false });
    expect(almanac('2026-02-25').sonFree).toBe(true);
    expect(almanac('2026-02-26').sonFree).toBe(true);
    expect(almanac('2026-02-27')).toMatchObject({ sonFree: false, sonDirection: '동' });
  });
  it('2024 설날(02-10) 뒤 02-18(1/9)은 손 없는 날', () => {
    expect(almanac('2024-02-18')).toMatchObject({ sonFree: true, sonDirection: null });
  });
  it('2026 추석 전후 — 09-25(8/15)는 서쪽, 09-19(8/9)는 손 없는 날', () => {
    expect(almanac('2026-09-25').lunar).toMatchObject({ month: 8, day: 15 });
    expect(almanac('2026-09-25').sonDirection).toBe('서');
    expect(almanac('2026-09-19').sonFree).toBe(true);
  });
  it.each([
    [1, '동'], [2, '동'], [3, '남'], [4, '남'], [5, '서'], [6, '서'], [7, '북'], [8, '북'], [9, null], [10, null],
    [11, '동'], [19, null], [20, null], [23, '남'], [28, '북'], [29, null], [30, null],
  ] as const)('음력 %i일 → %s', (day, dir) => {
    expect(sonDirectionOf(day)).toBe(dir);
  });
  it('한국과 중국 음력이 하루 다른 달도 한국 기준 (2026-11-08 = 음력 9/29)', () => {
    expect(almanac('2026-11-08').lunar).toMatchObject({ month: 9, day: 29 });
    expect(almanac('2026-11-08').sonFree).toBe(true);
    expect(almanac('2026-11-02')).toMatchObject({ wolgi: true }); // 음력 9/23 월기일
  });
});

describe('그 밖의 통서 요소', () => {
  it('사리일(동지 전날)·사절일(입동 전날) — KST 절기 날짜 기준', () => {
    expect(almanac('2026-12-21').sari).toBe('동지'); // 동지 2026-12-22 05:50 KST
    expect(almanac('2026-11-06').sajeol).toBe('입동'); // 입동 2026-11-07 18:52 KST
    expect(almanac('2027-11-07').sajeol).toBe('입동'); // 입동 2027-11-08 00:38 KST (북경 기준이면 11-06)
    expect(almanac('2026-12-20').sari).toBeNull();
  });
  it('천사일 — 子월 甲子(2026-12-16)', () => {
    expect(almanac('2026-12-16')).toMatchObject({ cheonsa: true, ganzhi: { hanja: '甲子' } });
  });
  it('천덕 — 亥월 乙(2026-11-07 乙酉) / 월덕 — 亥월 甲(2026-11-16 甲午) / 卯·午·酉·子월엔 천덕일이 없다', () => {
    expect(almanac('2026-11-07').cheondeok).toBe(true);
    expect(almanac('2026-11-16').woldeok).toBe(true);
    const ziMonth = taekilDateRange('2026-12-08', '2027-01-04').map(taekilAlmanac);
    expect(ziMonth.every((a) => a.monthBranch === 0 && !a.cheondeok)).toBe(true);
  });
  it('귀기일 — 맹월(亥월) 丑일(2026-11-11 己丑)', () => {
    expect(almanac('2026-11-11')).toMatchObject({ gwigi: true, ganzhi: { hanja: '己丑' } });
  });
  it('팽조백기 — 亥不嫁娶 · 巳不遠行', () => {
    expect(almanac('2026-11-21').pengzu.branch).toBe('亥不嫁娶'); // 己亥
    expect(almanac('2026-12-21').pengzu.branch).toBe('巳不遠行'); // 己巳
  });
});

describe('lunar-javascript(寿星万年历) 교차 검증 2025~2028', () => {
  const ZX: Record<string, DayOfficer> = { 建: '건', 除: '제', 满: '만', 平: '평', 定: '정', 执: '집', 破: '파', 危: '위', 成: '성', 收: '수', 开: '개', 闭: '폐' };
  const TS: Record<string, string> = { 青龙: '청룡', 明堂: '명당', 天刑: '천형', 朱雀: '주작', 金匮: '금궤', 天德: '천덕', 白虎: '백호', 玉堂: '옥당', 天牢: '천뢰', 玄武: '현무', 司命: '사명', 勾陈: '구진' };
  it('건제12신·12천신·천사·귀기가 매일 일치 (북경/한국 절입 날짜가 다른 날은 제외)', () => {
    let checked = 0;
    for (let d = ymd('2025-01-01'); ymdKey(d) <= '2028-12-31'; d = addDays(d, 1)) {
      const l = Solar.fromYmd(d.year, d.month, d.day).getLunar();
      const a = taekilAlmanac(d);
      // 한국(KST)과 중국(UTC+8)의 월건이 다른 날 — 절입이 KST 0시대인 경우
      if ('子丑寅卯辰巳午未申酉戌亥'.indexOf(l.getMonthZhi()) !== a.monthBranch) continue;
      checked++;
      expect(a.officer.name, ymdKey(d)).toBe(ZX[l.getZhiXing()]);
      expect(a.tianShen.name, ymdKey(d)).toBe(TS[l.getDayTianShen()]);
      expect(a.tianShen.yellow, ymdKey(d)).toBe(l.getDayTianShenType() === '黄道');
      const xs = [...l.getDayJiShen(), ...l.getDayXiongSha()];
      expect(a.cheonsa, ymdKey(d)).toBe(xs.includes('天赦'));
      // lunar-javascript 의 귀기 표는 亥월 己丑이 빠져 있다(자료 오류) → 그 경우만 건너뛴다
      if (!(a.monthBranch === 11 && a.ganzhi.hanja === '己丑')) expect(a.gwigi, ymdKey(d)).toBe(xs.includes('归忌'));
    }
    expect(checked).toBeGreaterThan(1450);
  }, 60_000);

  it('황도시 — 일진 지지 기준 12천신이 lunar-javascript 의 시(時) 천신과 같다', () => {
    for (const date of ['2026-10-15', '2026-11-06', '2026-12-20', '2027-03-01']) {
      const d = ymd(date);
      const yellow = yellowHoursOf(taekilAlmanac(d).ganzhi.branch);
      const expected = Array.from({ length: 12 }, (_, h) => h).filter((h) => {
        const hour = h === 0 ? 0 : h * 2 - 1;
        return Solar.fromYmdHms(d.year, d.month, d.day, hour, 30, 0).getLunar().getTimeTianShenType() === '黄道';
      });
      expect(yellow, date).toEqual(expected);
      expect(yellow).toHaveLength(6);
    }
  });

  it('목적별 건제12신 가중치의 부호가 協紀辨方書 宜忌 집계(2024~2027)와 같다', () => {
    const ACTS: Record<string, string[]> = { move: ['移徙', '入宅'], contract: ['立券', '交易'], exam: ['入学', '赴任'], wedding: ['嫁娶'], opening: ['开市'], travel: ['出行'] };
    const stat = new Map<string, { n: number; yi: number; ji: number }>();
    for (let d = ymd('2024-01-01'); ymdKey(d) <= '2027-12-31'; d = addDays(d, 1)) {
      const l = Solar.fromYmd(d.year, d.month, d.day).getLunar();
      const zx = ZX[l.getZhiXing()]!;
      const yi = l.getDayYi();
      const ji = l.getDayJi();
      for (const [p, acts] of Object.entries(ACTS)) {
        const k = `${p}|${zx}`;
        const o = stat.get(k) ?? { n: 0, yi: 0, ji: 0 };
        o.n++;
        if (acts.some((x) => yi.includes(x))) o.yi++;
        if (acts.some((x) => ji.includes(x)) || ji.includes('诸事不宜')) o.ji++;
        stat.set(k, o);
      }
    }
    for (const p of TAEKIL_PURPOSE_KEYS) {
      for (const { name } of DAY_OFFICERS) {
        const net = OFFICER_NET[p][name];
        expect(OFFICER_WEIGHT[p][name]).toBe(Math.max(-10, Math.min(7, Math.round(net / 6))));
        if (Math.abs(net) < 20) continue;
        const o = stat.get(`${p}|${name}`)!;
        const recent = (o.yi - o.ji) / o.n;
        expect(Math.sign(recent), `${p} ${name}`).toBe(Math.sign(net));
      }
    }
  }, 60_000);
});

describe('하루 평가 (1990-05-15 남, 庚辰일주·午띠)', () => {
  it('월파(破)일은 점수와 무관하게 피함', () => {
    const d = evaluateTaekilDay(chart, ymd('2026-12-22'), 'move');
    expect(d.excluded).toBe(true);
    expect(d.grade).toBe('avoid');
    expect(d.factors[0]).toMatchObject({ code: 'officer', excludes: true, label: '파(破)일' });
  });
  it('일지(辰)를 충하는 戌일은 탈락, 일지와 육합하는 酉일은 가점', () => {
    const xu = evaluateTaekilDay(chart, ymd('2026-10-15'), 'contract'); // 壬戌
    expect(xu.excluded).toBe(true);
    expect(xu.factors.some((f) => f.code === 'day_clash' && f.excludes)).toBe(true);
    const you = evaluateTaekilDay(chart, ymd('2026-11-07'), 'contract'); // 乙酉 — 辰酉 육합, 乙庚 천간합
    expect(you.factors.map((f) => f.code)).toEqual(expect.arrayContaining(['day_six', 'stem_combine']));
  });
  it('띠(午)를 충하는 子일은 감점', () => {
    const d = evaluateTaekilDay(chart, ymd('2026-12-16'), 'travel'); // 甲子
    expect(d.factors.find((f) => f.code === 'year_clash')?.weight).toBeLessThan(0);
  });
  it('손 없는 날은 이사에서만 가점, 여행에선 손 방향만 알린다', () => {
    const move = evaluateTaekilDay(chart, ymd('2026-11-08'), 'move');
    const travel = evaluateTaekilDay(chart, ymd('2026-11-08'), 'travel');
    expect(move.factors.some((f) => f.code === 'son_free' && f.weight > 0)).toBe(true);
    expect(travel.factors.some((f) => f.code === 'son_free')).toBe(false);
    const east = evaluateTaekilDay(chart, ymd('2026-02-27'), 'travel');
    expect(east.factors.find((f) => f.code === 'son_direction')).toMatchObject({ weight: 0, tone: 'info', label: '손 동쪽' });
  });
  it('결혼: 亥일 팽조 감점, 귀기일은 혼례에 적용하지 않는다(協紀 주석)', () => {
    expect(evaluateTaekilDay(chart, ymd('2026-11-21'), 'wedding').factors.some((f) => f.code === 'pengzu')).toBe(true);
    expect(evaluateTaekilDay(chart, ymd('2026-11-11'), 'wedding').factors.some((f) => f.code === 'gwigi')).toBe(false);
    expect(evaluateTaekilDay(chart, ymd('2026-11-11'), 'move').factors.some((f) => f.code === 'gwigi')).toBe(true);
  });
  it('결혼: 상대 사주를 넣으면 상대 일지 충도 본다', () => {
    const partner = calculateSaju({ calendar: 'solar', year: 1992, month: 8, day: 20, hour: 9, minute: 15, gender: 'female' }); // 戊辰일주
    const pdb = partner.pillars.day.branch.index;
    const clashDate = taekilDateRange('2026-11-01', '2026-11-30').find((d) => (taekilAlmanac(d).ganzhi.branch + 6) % 12 === pdb)!;
    const withP = evaluateTaekilDay(chart, clashDate, 'wedding', { partner });
    const withoutP = evaluateTaekilDay(chart, clashDate, 'wedding');
    expect(withP.factors.some((f) => f.code === 'partner_clash')).toBe(true);
    expect(withP.score).toBeLessThan(withoutP.score);
    // 다른 목적에는 상대를 넣어도 쓰지 않는다
    expect(evaluateTaekilDay(chart, clashDate, 'move', { partner }).factors.some((f) => f.code.startsWith('partner'))).toBe(false);
  });
  it('면접·시험은 문창귀인(庚 → 亥)을 본다', () => {
    expect(evaluateTaekilDay(chart, ymd('2026-11-21'), 'exam').factors.some((f) => f.code === 'munchang')).toBe(true);
  });
  it('요인은 탈락 사유 → 영향 큰 순, 점수는 0~100', () => {
    for (const p of TAEKIL_PURPOSE_KEYS) {
      for (const d of taekilDateRange('2026-11-01', '2026-11-30')) {
        const r = evaluateTaekilDay(chart, d, p);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
        if (r.excluded) expect(r.factors[0]!.excludes).toBe(true);
        const nonEx = r.factors.filter((f) => !f.excludes).map((f) => Math.abs(f.weight));
        for (let i = 1; i < nonEx.length; i++) expect(nonEx[i - 1]!).toBeGreaterThanOrEqual(nonEx[i]!);
      }
    }
  });
});

describe('고르기', () => {
  const dates = taekilDateRange('2026-11-01', '2027-01-31');
  it('기간 92일까지, 93일부터는 오류', () => {
    expect(dates).toHaveLength(92);
    expect(() => taekilDateRange('2026-11-01', '2027-02-01')).toThrow(/92일/);
    expect(() => taekilDateRange('2026-11-10', '2026-11-01')).toThrow();
    expect(() => taekilDateRange('2026-02-30', '2026-03-01')).toThrow(/없는 날짜/);
  });
  it.each(TAEKIL_PURPOSE_KEYS)('%s — Top 3 는 탈락·피함이 아니고 순위가 점수순, 등급 합계 = 날짜 수', (purpose) => {
    const r = selectTaekilDays(chart, purpose, dates);
    expect(r.days).toHaveLength(92);
    expect(r.top).toHaveLength(3);
    const byDate = new Map(r.days.map((d) => [d.almanac.date, d]));
    const tops = r.top.map((t) => byDate.get(t)!);
    expect(tops.every((d) => !d.excluded && d.grade !== 'avoid')).toBe(true);
    expect(tops[0]!.score).toBeGreaterThanOrEqual(tops[2]!.score);
    expect(r.ranking.slice(0, 3)).toEqual(r.top);
    const best = Math.max(...r.days.filter((d) => !d.excluded).map((d) => d.score));
    expect(tops[0]!.score).toBe(best);
    expect(Object.values(r.counts).reduce((a, b) => a + b, 0)).toBe(92);
    // 탈락일은 순위 맨 뒤
    const firstExcluded = r.ranking.findIndex((k) => byDate.get(k)!.excluded);
    expect(r.ranking.slice(firstExcluded).every((k) => byDate.get(k)!.excluded)).toBe(true);
  });
  it('같은 입력은 같은 결과, 후보 날짜는 중복 제거·정렬', () => {
    const a = selectTaekilDays(chart, 'move', [ymd('2026-11-20'), ymd('2026-11-08'), ymd('2026-11-08')]);
    const b = selectTaekilDays(chart, 'move', [ymd('2026-11-08'), ymd('2026-11-20')]);
    expect(a.days.map((d) => d.almanac.date)).toEqual(['2026-11-08', '2026-11-20']);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('후보가 모두 피할 날이면 Top 3 가 비어 있다', () => {
    const r = selectTaekilDays(chart, 'move', [ymd('2026-12-22'), ymd('2026-10-15')]); // 월파 · 일지충
    expect(r.top).toEqual([]);
    expect(r.counts.avoid).toBe(2);
  });
});
