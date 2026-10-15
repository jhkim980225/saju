/**
 * 주제별 리포트(연애·결혼운 · 재물·직업운) 규칙 기반 초안 — 구성, 분량, 사주 근거(basis), 금지 표현, 성별 중립,
 * 그리고 쉬운 말(docs/PLAIN_KOREAN.md): 화면에 보이는 글에는 용어·한자·"당신"·반복 문장·깨진 이음새가 없다.
 */
import { calculateSaju, luckPillar, yearPillarOf, type BirthInput, type SajuChart } from '@saju/core';
import type { ReadingSection } from '@saju/shared';
import { describe, expect, it } from 'vitest';
import { buildCareerWealthReport } from '../src/modules/interpretation/careerWealthReport.js';
import { buildLoveReport } from '../src/modules/interpretation/loveReport.js';
import { EL_TERM, stemTerm } from '../src/modules/interpretation/topicReportKit.js';

/** 2026-10-15(KST) — 신년운세와 같은 규칙으로 '앞으로'는 2027년부터 */
const NOW = new Date('2026-10-15T03:00:00Z');
const FROM = 2027;
/** 화면에 보이는 글(근거 '사주로 보면'은 접혀 있어 뺀다) */
const visible = (s: ReadingSection) => [s.title, s.summary, ...(s.keywords ?? []), ...s.paragraphs, ...(s.tips ?? [])].filter(Boolean);
/** 분량 — 요약·본문·실천 목록(공백 제외) */
const chars = (secs: ReadingSection[]) => secs.reduce((n, s) => n + [s.summary, ...s.paragraphs, ...(s.tips ?? [])].join('').replace(/\s/g, '').length, 0);
const text = (secs: ReadingSection[]) => secs.map((s) => visible(s).join('\n')).join('\n');
const allText = (secs: ReadingSection[]) => secs.map((s) => [...visible(s), s.basis ?? ''].join('\n')).join('\n');
const sectionText = (secs: ReadingSection[], key: string) => text(secs.filter((s) => s.key === key));
const basisOf = (secs: ReadingSection[], key: string) => secs.find((s) => s.key === key)?.basis ?? '';
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

/**
 * 화면에 보이면 안 되는 용어 — 낱말 첫머리에서만 걸러 '상관없이'·'충분히' 같은 일상어는 걸리지 않게.
 * 근거(basis, '사주로 보면' 접힘)에는 써도 된다.
 */
const JARGON = [
  '당신', '일간', '일지', '용신', '희신', '기신', '십신', '십성', '12운성', '지장간', '신강', '신약', '중화', '천간', '간지', '원국', '명리', '오행',
  '겁재', '비견', '식신', '상관(?!없)', '편재', '정재', '편관', '정관', '편인', '정인', '재성', '관성', '식상', '비겁', '인성',
  '대운', '세운(?![ 다])', '월운', '순행', '역행', '절기', '월지', '일주(?!일)', '년주', '월주', '시주',
  '육합', '반합', '삼합', '방합', '천간합', '천간충', '합충', '원진',
  '도화', '홍염', '역마', '화개', '귀문', '괴강', '양인', '백호', '현침', '공망', '천을', '문창', '학당', '천덕', '월덕', '귀인', '신살',
  '득령', '득지', '득세', '건록', '제왕', '장생', '관대', '양간', '음간', '배우자',
  '갑목', '을목', '병화', '정화', '무토', '기토', '경금', '신금', '임수', '계수',
];
/** 한 번에 검사하고, 걸리면 어느 용어인지 알려 준다 */
const JARGON_RE = new RegExp(`(?:^|[^가-힣])(${JARGON.join('|')})`);
/** 한 글자 용어(충·형·합)는 홀로 쓰일 때만 */
const LONE = /(^|[^가-힣])(충|형|합)($|[^가-힣])/;

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
    it('12개 장을 정해진 순서로 담고, 장마다 근거(basis)를 따로 둔다', () => {
      for (const { chart, label } of charts) {
        const secs = r.build(chart, NOW, '서윤');
        expect(secs.map((s) => s.key), label).toEqual(r.keys);
        for (const s of secs) {
          expect(s.title.length, `${label} ${s.key}`).toBeGreaterThan(2);
          expect(s.summary.length, `${label} ${s.key}`).toBeGreaterThan(5);
          expect(s.paragraphs.length, `${label} ${s.key}`).toBeGreaterThan(0);
          // 마무리 말고는 모두 '사주로 보면'(용어·간지·점수)이 있다
          if (s.key !== 'closing') expect(s.basis?.length ?? 0, `${label} ${s.key}`).toBeGreaterThan(5);
        }
      }
    });

    it('공백 뺀 분량 — 사주마다 7천~1만 1천 자, 평균 7천 3백~1만 자', () => {
      const sizes = charts.map(({ chart }) => chars(r.build(chart, NOW, '서윤')));
      for (const [i, n] of sizes.entries()) {
        expect(n, charts[i]!.label).toBeGreaterThanOrEqual(7_000);
        expect(n, charts[i]!.label).toBeLessThanOrEqual(11_000);
      }
      const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      expect(mean).toBeGreaterThanOrEqual(7_300);
      expect(mean).toBeLessThanOrEqual(10_000);
    });

    it('앞으로 10년을 한 해씩 짚고, 가까운 3년은 따로 푼다 — 간지는 근거에만', () => {
      for (const { chart, label } of charts) {
        const secs = r.build(chart, NOW);
        const decade = sectionText(secs, 'decade');
        for (let y = FROM; y < FROM + 10; y++) expect(decade, `${label} ${y}`).toContain(`${y}년`);
        const three = sectionText(secs, 'threeYears');
        for (let y = FROM; y < FROM + 3; y++) {
          expect(three, `${label} ${y}`).toContain(`${y}년`);
          expect(three, `${label} ${y}`).not.toContain(yearHanja(y));
          expect(basisOf(secs, 'threeYears'), `${label} ${y}`).toContain(yearHanja(y));
          expect(basisOf(secs, 'decade'), `${label} ${y}`).toContain(yearHanja(y));
        }
      }
    });

    it('같은 사주는 언제 만들어도 같은 본문', () => {
      const c = charts[0]!.chart;
      expect(r.build(c, NOW, '서윤')).toEqual(r.build(c, NOW, '서윤'));
    });

    it('성별을 바꿔도 대운이 들어가는 장(요약·10년 흐름) 말고는 본문이 같다', () => {
      for (const { birth, label } of charts) {
        const f = r.build(calculateSaju({ ...birth, gender: 'female' }), NOW, '서윤');
        const m = r.build(calculateSaju({ ...birth, gender: 'male' }), NOW, '서윤');
        const strip = (secs: ReadingSection[]) => secs.filter((s) => s.key !== 'summary' && s.key !== 'decade');
        expect(strip(m), label).toEqual(strip(f));
      }
    });
  });
}

describe('여러 사주로 만들어도 깨진 문장·금지 표현이 없다', () => {
  const many = births(40).map((b) => calculateSaju(b));
  it('40명 (시간 모름 포함) × 두 리포트 — 근거까지 포함해 검사', () => {
    for (const c of [...many, ...charts.map((s) => s.chart)]) {
      for (const r of reports) {
        const secs = r.build(c, NOW, '서윤');
        const tx = allText(secs);
        expect(tx).not.toMatch(BROKEN);
        expect(tx.match(DETERMINISTIC)?.[0] ?? null).toBeNull();
        expect(tx.match(GENDERED)?.[0] ?? null).toBeNull();
        expect(tx.match(INVESTMENT)?.[0] ?? null).toBeNull();
        for (const s of secs) for (const p of s.paragraphs) expect(p.trim().length).toBeGreaterThan(5);
        const n = chars(secs);
        expect(n).toBeGreaterThanOrEqual(6_800);
        expect(n).toBeLessThanOrEqual(11_500);
      }
    }
  }, 60_000);
});

describe('사람이 말하듯 쉬운 말 — 화면에 보이는 글', () => {
  const many = [...births(40).map((b) => calculateSaju(b)), ...charts.map((s) => s.chart)];
  for (const r of reports) {
    for (const name of ['서윤', '']) {
      it(`${r.name} · ${many.length}명 · 이름 ${name ? '있음' : '없음'} — 용어·한자·'당신'·반복 문장·깨진 이음새 없음`, () => {
        for (const [ci, c] of many.entries()) {
          const secs = r.build(c, NOW, name);
          const where = `#${ci} ${c.solarDate.year}-${c.solarDate.month}-${c.solarDate.day} ${name || '(이름 없음)'}`;
          const lines = secs.flatMap(visible);
          for (const line of lines) {
            expect(line, `${where}: 한자 — ${line}`).not.toMatch(/[一-鿿]/);
            expect(line.match(JARGON_RE)?.[1] ?? null, `${where}: 용어 — ${line}`).toBeNull();
            expect(LONE.test(line), `${where}: 한 글자 용어 — ${line}`).toBe(false);
            expect(line, where).not.toMatch(/undefined|null|\{|\}|\s{2,}|님님|\((이|가|을|를|은|는|과|와|으)\)|이\(가\)|을\(를\)|\.\s*\./);
            if (!name) expect(line, `${where}: ${line}`).not.toContain('님');
          }
          // 같은 문장이 한 리포트에 두 번 나오지 않는다(요약 한 줄도 문장으로 본다)
          const sentences = lines
            .flatMap((l) => l.split(/(?<=[.!?])\s+/))
            .map((x) => x.trim().replace(/[.!?]+$/, ''))
            .filter((x) => x.length > 12);
          const seen = new Set<string>();
          for (const s of sentences) {
            expect(seen.has(s), `${where}: 반복 — ${s}`).toBe(false);
            seen.add(s);
          }
          // 이름으로 부른다 — 첫 장 첫 문장
          if (name) expect(secs[0]!.paragraphs[0], where).toMatch(/^서윤님은 /);
          else expect(secs[0]!.paragraphs[0], where).not.toMatch(/^\S+님/);
        }
      }, 60_000);
    }
  }
});

describe('연애·결혼운 — 근거는 basis 에, 본문은 쉬운 말로', () => {
  it('일간·일지(배우자 자리)·도화/홍염·일지 합충·용신을 근거에 밝힌다', () => {
    for (const { chart, label } of charts) {
      const secs = buildLoveReport(chart, NOW, '서윤');
      expect(basisOf(secs, 'loveNature'), label).toContain(stemTerm(chart));
      const palace = basisOf(secs, 'spousePalace');
      expect(palace, label).toContain(chart.pillars.day.branch.hanja);
      expect(palace, label).toContain('배우자 자리');
      expect(sectionText(secs, 'spousePalace'), label).toContain('가까운 사이');
      const names = new Set(chart.shinsal.map((s) => s.name));
      const attraction = basisOf(secs, 'attraction');
      expect(attraction, label).toContain(names.has('도화살') ? '도화살(' : '도화살 없음');
      expect(attraction, label).toContain(names.has('홍염살') ? '홍염살 있음' : '홍염살 없음');
      const friction = basisOf(secs, 'friction');
      for (const rel of chart.relations.filter((x) => x.target === 'branch' && x.positions.includes('day'))) expect(friction, label).toContain(rel.type);
      // 맞는 사람은 성별이 아니라 기질과 오행으로 — 용신 오행이 근거로 나온다
      expect(basisOf(secs, 'idealPartner'), label).toContain(EL_TERM[chart.yongsin.yongsin]);
    }
  });

  it('시기는 생활어로 — "○○년 ○○쯤 새 인연"', () => {
    for (const { chart, label } of charts) {
      const s = buildLoveReport(chart, NOW, '서윤')[0]!;
      expect(s.summary, label).toMatch(/^20\d\d년 (늦겨울|봄|늦봄|여름|늦여름|가을|늦가을|겨울)쯤 새 인연이 들어오기 좋아요$/);
    }
  });

  it('연애·결혼을 하지 않는 선택을 존중하고, 참고용이라는 안내로 끝맺는다', () => {
    const secs = buildLoveReport(charts[0]!.chart, NOW, '서윤');
    expect(sectionText(secs, 'closing')).toMatch(/참고/);
    expect(sectionText(secs, 'closing')).toMatch(/하지 않는 선택도 똑같이 존중/);
    expect(sectionText(secs, 'threeYears')).toContain('혼자의 삶이 편한 분');
  });
});

describe('재물·직업운 — 근거는 basis 에, 본문은 쉬운 말로', () => {
  it('재성·식상·비겁 구조, 신강도, 용신 오행, 직장형·독립형 근거를 basis 에 밝힌다', () => {
    for (const { chart, label } of charts) {
      const secs = buildCareerWealthReport(chart, NOW, '서윤');
      const flow = basisOf(secs, 'moneyFlow');
      for (const g of ['재성', '식상', '비겁']) expect(flow, `${label} ${g}`).toContain(g);
      expect(basisOf(secs, 'strength'), label).toContain(chart.strength.level);
      expect(basisOf(secs, 'fields'), label).toContain(EL_TERM[chart.yongsin.yongsin]);
      expect(basisOf(secs, 'employment'), label).toMatch(/관성.*인성/);
    }
  });

  it('투자 조언이 아니라는 안내와 참고용 안내를 담는다', () => {
    for (const { chart, label } of charts) {
      const secs = buildCareerWealthReport(chart, NOW, '서윤');
      expect(text(secs), label).toMatch(/투자 조언이 아니/);
      expect(sectionText(secs, 'closing'), label).toMatch(/참고/);
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
