/**
 * 주제별 리포트(연애·결혼운 · 재물·직업운) 규칙 기반 초안 — 구성, 분량, 사주 근거, 금지 표현, 성별 중립
 */
import { calculateSaju, luckPillar, yearPillarOf, type BirthInput, type SajuChart } from '@saju/core';
import type { ReadingSection } from '@saju/shared';
import { describe, expect, it } from 'vitest';
import { buildCareerWealthReport } from '../src/modules/interpretation/careerWealthReport.js';
import { buildLoveReport } from '../src/modules/interpretation/loveReport.js';
import { EL_NAME, dayMasterContent } from '../src/modules/interpretation/reading.js';

/** 2026-10-15(KST) — 신년운세와 같은 규칙으로 '앞으로'는 2027년부터 */
const NOW = new Date('2026-10-15T03:00:00Z');
const FROM = 2027;
const chars = (secs: ReadingSection[]) => secs.reduce((n, s) => n + [s.summary, ...s.paragraphs].join('').replace(/\s/g, '').length, 0);
const text = (secs: ReadingSection[]) => secs.map((s) => [s.title, s.summary, ...(s.keywords ?? []), ...s.paragraphs].join('\n')).join('\n');
const sectionText = (secs: ReadingSection[], key: string) => text(secs.filter((s) => s.key === key));
const yearHanja = (y: number) => {
  const p = yearPillarOf(y);
  return luckPillar(p.stem, p.branch, 0).ganzhi.hanja;
};

const LOVE_KEYS = ['summary', 'loveNature', 'spousePalace', 'tenGodBalance', 'attraction', 'idealPartner', 'pattern', 'friction', 'decade', 'threeYears', 'advice', 'closing'];
const CAREER_KEYS = ['summary', 'moneyFlow', 'strength', 'earnKeep', 'workStyle', 'fields', 'employment', 'decade', 'threeYears', 'risks', 'habits', 'closing'];

const at = (year: number, month: number, day: number, hour: number | null = 10): BirthInput => ({ calendar: 'solar', year, month, day, hour, minute: hour === null ? null : 0, gender: 'female' });
/** 일간·신강도가 서로 다른 사주 — 합충·신살이 없는 사주와 시간 모름도 포함 */
const SAMPLES: { label: string; birth: BirthInput; level?: string }[] = [
  { label: '丁火 극신강', birth: at(1984, 4, 3), level: '극신강' },
  { label: '己土 극신강 (원국 합충·신살 없음)', birth: at(1977, 7, 11), level: '극신강' },
  { label: '甲木 극신약 (일지 충·자형)', birth: at(1976, 10, 19), level: '극신약' },
  { label: '壬水 극신약 (일지 육합·원진)', birth: at(1976, 1, 11), level: '극신약' },
  { label: '庚金 신강', birth: at(1978, 7, 27), level: '신강' },
  { label: '癸水 신약', birth: at(1975, 1, 27), level: '신약' },
  { label: '辛金 중화', birth: at(1976, 4, 19), level: '중화' },
  { label: '丙火 시간 모름', birth: at(1997, 7, 3, null) },
];
const charts = SAMPLES.map((s) => ({ ...s, chart: calculateSaju(s.birth) }));

/** 결정적 의사난수로 다양한 출생 정보 */
function births(n: number): BirthInput[] {
  let x = 20261015;
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

const BROKEN = /undefined|NaN|\[object|null(?![가-힣])|\$\{|  +[.,]|\.\.|\(\)|,,/;
/** 단정적 예언·공포 조장 (docs/research/04-copywriting-guide.md §5.4·§5.6) */
const DETERMINISTIC = /반드시 (이혼|헤어|결혼|성공|실패|부자|가난|망)|무조건|틀림없이|100%|평생 (가난|외롭|외로|혼자)|이혼(하게|할 수밖에|수)|파혼|결혼(을)? 못|결혼하지 못|가난하게|망한다|망하게|망해|파산|최악|불행해진|큰일 (나|납)|팔자가 세|과부|홀아비|상부|극부|극처|단명|사고를 당|운명의 상대|대박|흉하|흉살|흉운|나쁜 운|살이 (꼈|끼)/;
/**
 * 성별·이성애·출산을 전제하는 말.
 * '아내'는 낱말 첫머리일 때만(찾아내다·알아내다 제외), '임신'은 간지 이름 임신(壬申)·임신년·임신일주는 제외한다.
 */
const GENDERED = /남편|(?<![가-힣])아내|부인|와이프|신랑|신부|남자|여자|남성|여성|남친|여친|그녀|이성(의|에게|과|을|친구|운|관계)|현모양처|내조|며느리|사위|자식|자녀|출산|임신(?![(년일월시대])/;
/** 투자 권유로 읽힐 수 있는 말 */
const INVESTMENT = /코인|가상화폐|종목|매수|매도|로또|복권|도박|대출을 받아/;

const reports = [
  { name: '연애·결혼운', build: buildLoveReport, keys: LOVE_KEYS },
  { name: '재물·직업운', build: buildCareerWealthReport, keys: CAREER_KEYS },
] as const;

describe('표본 사주', () => {
  it('신강·신약과 서로 다른 일간을 고루 담는다', () => {
    for (const s of charts) if (s.level) expect(s.chart.strength.level, s.label).toBe(s.level);
    expect(new Set(charts.map((s) => s.chart.dayMaster.index)).size).toBeGreaterThanOrEqual(8);
  });
});

for (const r of reports) {
  describe(`${r.name} 리포트`, () => {
    it('10~15개 장을 정해진 순서로 담는다', () => {
      for (const { chart, label } of charts) {
        const secs = r.build(chart, NOW);
        expect(secs.map((s) => s.key), label).toEqual(r.keys);
        expect(secs.length).toBeGreaterThanOrEqual(10);
        expect(secs.length).toBeLessThanOrEqual(15);
        for (const s of secs) {
          expect(s.title.length, `${label} ${s.key}`).toBeGreaterThan(2);
          expect(s.summary.length, `${label} ${s.key}`).toBeGreaterThan(5);
          expect(s.paragraphs.length, `${label} ${s.key}`).toBeGreaterThan(0);
        }
      }
    });

    it('공백 뺀 8천~1만 자 안팎 (사주마다 7천 5백~1만 1천 자)', () => {
      const sizes = charts.map(({ chart }) => chars(r.build(chart, NOW)));
      for (const [i, n] of sizes.entries()) {
        expect(n, charts[i]!.label).toBeGreaterThanOrEqual(7_500);
        expect(n, charts[i]!.label).toBeLessThanOrEqual(11_000);
      }
      const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      expect(mean).toBeGreaterThanOrEqual(8_000);
      expect(mean).toBeLessThanOrEqual(10_000);
    });

    it('앞으로 10년을 한 해씩 짚고, 가까운 3년은 간지와 함께 따로 푼다', () => {
      for (const { chart, label } of charts) {
        const secs = r.build(chart, NOW);
        const decade = sectionText(secs, 'decade');
        for (let y = FROM; y < FROM + 10; y++) expect(decade, `${label} ${y}`).toContain(String(y));
        const three = sectionText(secs, 'threeYears');
        for (let y = FROM; y < FROM + 3; y++) {
          expect(three, `${label} ${y}`).toContain(String(y));
          expect(three, `${label} ${y}`).toContain(yearHanja(y));
        }
      }
    });

    it('같은 사주는 언제 만들어도 같은 본문', () => {
      const c = charts[0]!.chart;
      expect(r.build(c, NOW)).toEqual(r.build(c, NOW));
    });

    it('성별을 바꿔도 대운이 들어가는 장(요약·10년 흐름) 말고는 본문이 같다', () => {
      for (const { birth, label } of charts) {
        const f = r.build(calculateSaju({ ...birth, gender: 'female' }), NOW);
        const m = r.build(calculateSaju({ ...birth, gender: 'male' }), NOW);
        const strip = (secs: ReadingSection[]) => secs.filter((s) => s.key !== 'summary' && s.key !== 'decade');
        expect(strip(m), label).toEqual(strip(f));
      }
    });
  });
}

describe('여러 사주로 만들어도 깨진 문장·금지 표현이 없다', () => {
  const many = births(40).map((b) => calculateSaju(b));
  it('40명 (시간 모름 포함) × 두 리포트', () => {
    for (const c of [...many, ...charts.map((s) => s.chart)]) {
      for (const r of reports) {
        const secs = r.build(c, NOW);
        const tx = text(secs);
        expect(tx).not.toMatch(BROKEN);
        expect(tx.match(DETERMINISTIC)?.[0] ?? null).toBeNull();
        expect(tx.match(GENDERED)?.[0] ?? null).toBeNull();
        expect(tx.match(INVESTMENT)?.[0] ?? null).toBeNull();
        for (const s of secs) for (const p of s.paragraphs) expect(p.trim().length).toBeGreaterThan(5);
        const n = chars(secs);
        expect(n).toBeGreaterThanOrEqual(7_000);
        expect(n).toBeLessThanOrEqual(11_500);
      }
    }
  });
});

describe('연애·결혼운 — 근거를 풀어서 보여 준다', () => {
  it('일간·일지(배우자 자리)·도화/홍염·일지 합충을 본문에 밝힌다', () => {
    for (const { chart, label } of charts) {
      const secs = buildLoveReport(chart, NOW);
      expect(sectionText(secs, 'loveNature'), label).toContain(dayMasterContent(chart).name);
      const palace = sectionText(secs, 'spousePalace');
      expect(palace, label).toContain(chart.pillars.day.branch.hanja);
      expect(palace, label).toContain('배우자 자리');
      const names = new Set(chart.shinsal.map((s) => s.name));
      const attraction = sectionText(secs, 'attraction');
      if (names.has('도화살')) expect(attraction, label).toContain('도화');
      if (names.has('홍염살')) expect(attraction, label).toContain('홍염');
      const friction = sectionText(secs, 'friction');
      for (const rel of chart.relations.filter((x) => x.target === 'branch' && x.positions.includes('day'))) expect(friction, label).toContain(rel.type);
      // 맞는 사람은 성별이 아니라 기질과 오행으로 — 용신 오행이 근거로 나온다
      expect(sectionText(secs, 'idealPartner'), label).toContain(EL_NAME[chart.yongsin.yongsin]);
    }
  });

  it('참고용이라는 안내로 끝맺는다', () => {
    const tx = sectionText(buildLoveReport(charts[0]!.chart, NOW), 'closing');
    expect(tx).toMatch(/참고/);
  });
});

describe('재물·직업운 — 근거를 풀어서 보여 준다', () => {
  it('재성·식상·비겁 구조, 신강도, 용신 오행을 본문에 밝힌다', () => {
    for (const { chart, label } of charts) {
      const secs = buildCareerWealthReport(chart, NOW);
      const flow = sectionText(secs, 'moneyFlow');
      for (const g of ['재성', '식상', '비겁']) expect(flow, `${label} ${g}`).toContain(g);
      expect(sectionText(secs, 'strength'), label).toContain(chart.strength.level);
      expect(sectionText(secs, 'fields'), label).toContain(EL_NAME[chart.yongsin.yongsin]);
      expect(sectionText(secs, 'employment'), label).toMatch(/관성|인성/);
    }
  });

  it('투자 조언이 아니라는 안내와 참고용 안내를 담는다', () => {
    for (const { chart, label } of charts) {
      const tx = text(buildCareerWealthReport(chart, NOW));
      expect(tx, label).toMatch(/투자 조언이 아니/);
      expect(sectionText(buildCareerWealthReport(chart, NOW), 'closing'), label).toMatch(/참고/);
    }
  });
});

/** 시간 모름 사주는 시주가 없다 — 시주를 근거로 쓰지 않는다 */
describe('시간 모름', () => {
  it('시주 없이도 만들어진다', () => {
    const c: SajuChart = charts.find((s) => s.birth.hour === null)!.chart;
    expect(c.pillars.hour).toBeNull();
    for (const r of reports) expect(r.build(c, NOW).map((s) => s.key)).toEqual(r.keys);
  });
});
