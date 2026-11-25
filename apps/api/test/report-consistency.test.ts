/**
 * 보고서 사이·장 사이의 일관성 — 같은 사람에게 같은 판정을 보여 준다.
 * - 가장 큰 십성 무리: 사주분석서·재물·직업운·연애·결혼운이 같은 무리를 말한다(verdicts.ts dominantGroup).
 * - 월운: 제목의 등급이 '조심'·'쉬어 갈 때'면 본문도 주의 쪽 문구를 쓴다.
 * - 그해 한 줄 제목: 내 사주·신년운세·신년운세 리포트·사주분석서가 같은 제목을 쓴다.
 * - 대운 평가: 기본 풀이·사주분석서가 같은 등급을 쓰고, 지난 대운에는 앞으로 할 일을 권하지 않는다.
 * - 화면에 보이는 글에는 엠대시(—)와 비유·관용구('새요', '값을 해요', '일할 맛', '손발이 맞다')를 쓰지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { calculateSaju, evaluateFortune, yearPillarOf, type BirthInput } from '@saju/core';
import { GRADE_PLAIN_LABEL, type ReadingSection } from '@saju/shared';
import { describe, expect, it } from 'vitest';
import { buildCareerWealthReport } from '../src/modules/interpretation/careerWealthReport.js';
import { CAREER_WEALTH_REPORT } from '../src/modules/interpretation/content/careerWealthReport.js';
import { ELEMENT_CONTENT, SHINSAL_CONTENT } from '../src/modules/interpretation/content/index.js';
import { LOVE_REPORT } from '../src/modules/interpretation/content/loveReport.js';
import { LUCK_CONTENT } from '../src/modules/interpretation/content/luck.js';
import { LUCKY_COLOR_PLAIN } from '../src/modules/interpretation/content/plainFortune.js';
import { buildLoveReport } from '../src/modules/interpretation/loveReport.js';
import { buildBasicReading, buildYearlyFortune, targetFortuneYear } from '../src/modules/interpretation/reading.js';
import { buildSajuAnalysis, buildYearlyReport } from '../src/modules/interpretation/report.js';
import { seasonOf } from '../src/modules/interpretation/topicReportKit.js';
import { careerYearMode, daeunEval, dominantGroup, natalShinsal, topTenGods } from '../src/modules/interpretation/verdicts.js';

const NOW = new Date('2026-11-12T03:00:00Z');
function births(n: number, seed: number): BirthInput[] {
  let x = seed;
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
const SEOYUN: BirthInput = { calendar: 'solar', year: 1995, month: 3, day: 14, hour: 14, minute: 30, gender: 'female' };
const charts = [SEOYUN, ...births(24, 20261112)].map((b) => calculateSaju(b));
const visible = (secs: ReadingSection[]) =>
  secs.flatMap((s) => [s.title, s.summary, ...(s.keywords ?? []), ...(s.points ?? []).flatMap((p) => [p.label, p.text]), ...s.paragraphs, ...(s.tips ?? [])]).filter(Boolean);

describe('가장 큰 십성 무리 — 모든 보고서가 같은 판정', () => {
  it('재물·직업운 · 연애·결혼운 · 사주분석서가 같은 무리를 말한다', () => {
    charts.forEach((c, i) => {
      const g = dominantGroup(c);
      const career = buildCareerWealthReport(c, NOW, '서윤').find((s) => s.key === 'workStyle')!;
      expect(career.paragraphs[0], `#${i} 재물·직업운`).toContain(`가장 큰 십성 무리는 ${g}`);
      const love = buildLoveReport(c, NOW, '서윤').find((s) => s.key === 'tenGodBalance')!;
      expect(love.paragraphs[0], `#${i} 연애·결혼운`).toMatch(new RegExp(`가장 큰 무리는 ${g}(\\(|입니다)`));
      const tg = buildSajuAnalysis(c, NOW, '서윤').find((s) => s.key === 'tenGods')!;
      expect(tg.paragraphs.join(' '), `#${i} 사주분석서`).toMatch(new RegExp(`${g}[이가] \\d+%로 가장 커요`));
    });
  });

  it('서윤(1995-03-14 14:30) — 글자 수로는 재성, 세력으로는 비겁이 가장 크다고 밝힌다', () => {
    const tg = buildSajuAnalysis(charts[0]!, NOW, '서윤').find((s) => s.key === 'tenGods')!;
    expect(tg.paragraphs.join(' ')).toContain('글자 수로는 재성이 가장 많지만');
    expect(dominantGroup(charts[0]!)).toBe('비겁');
  });
});

describe('월운 — 등급과 본문이 엇갈리지 않는다', () => {
  it("'조심'·'쉬어 갈 때'인 달은 주의 쪽 문구, 그 밖의 달은 기본 문구를 쓴다", () => {
    for (const c of charts.slice(0, 10)) {
      const months = buildSajuAnalysis(c, NOW, '서윤').filter((s) => /^month-\d+$/.test(s.key));
      for (const m of months) {
        const tg = m.keywords![1]!.split(' · ')[0] as keyof typeof LUCK_CONTENT.month;
        const low = /· (조심|쉬어 갈 때)$/.test(m.title);
        const bank = low ? LUCK_CONTENT.month[tg].low.general : [LUCK_CONTENT.month[tg].general[0], LUCK_CONTENT.month[tg].general[1]];
        expect(bank.some((g) => m.paragraphs[0]!.endsWith(g)), `${m.title} ${m.paragraphs[0]}`).toBe(true);
      }
    }
  });
});

describe('대운 — 한 곳에서 평가하고, 지난 대운은 돌아보는 말로', () => {
  it('사주분석서의 대운 등급이 대운 평가(verdicts.ts)와 같다', () => {
    for (const c of charts.slice(0, 10)) {
      const secs = buildSajuAnalysis(c, NOW, '서윤').filter((s) => /^daeun-\d$/.test(s.key));
      secs.forEach((s, i) => expect(s.summary, s.title).toContain(GRADE_PLAIN_LABEL[daeunEval(c, c.daeun.periods[i]!).grade]));
    }
  });

  it('이미 지나간 대운에는 앞으로 할 일을 권하지 않는다', () => {
    const year = 2026;
    for (const c of charts) {
      const secs = buildSajuAnalysis(c, NOW, '서윤').filter((s) => /^daeun-\d$/.test(s.key));
      secs.forEach((s, i) => {
        if (c.daeun.periods[i]!.endYear >= year) return;
        for (const p of s.paragraphs) expect(p, s.title).not.toMatch(/(세요|두세요|마세요|하세요)\./);
      });
    }
  });

  it("천간의 십성 무리가 같은 대운이 이어져도 등급이 낮아지면 '밀고 가기 좋다'고 쓰지 않는다", () => {
    // 표본 사주마다 대운 등급이 달라 특정 줄을 고정하지 않고, 규칙을 모든 표본에 걸어 본다
    for (const c of charts) {
      const career = buildCareerWealthReport(c, NOW, '서윤').find((s) => s.key === 'decade')!;
      for (const line of career.paragraphs.filter((p) => /까지는 .*같은 .* 무리라/.test(p))) {
        if (line.includes('낮아져')) expect(line).not.toContain('밀고 가기 좋아요');
      }
    }
  });
});

describe('그해 한 줄 제목 — 화면마다 같다', () => {
  it('내 사주·신년운세·신년운세 리포트·사주분석서가 같은 제목을 쓴다', () => {
    for (const c of charts.slice(0, 10)) {
      const year = targetFortuneYear(NOW);
      const basic = buildBasicReading(c, { access: 'full', now: NOW, name: '서윤' }).sections.find((s) => s.key === `year${year}`)!.summary;
      const screen = buildYearlyFortune(c, year, true, '서윤').headline;
      const report = buildYearlyReport(c, year, '서윤')[0]!.summary;
      const overview = buildSajuAnalysis(c, NOW, '서윤')[0]!.points!.find((p) => p.label === `${year}년`)!.text;
      expect(screen).toBe(basic);
      expect(report).toBe(basic);
      expect(overview.endsWith(basic)).toBe(true);
    }
  });
});

describe('표현 — 엠대시·관용구 없이', () => {
  it('화면에 보이는 글에 엠대시(—)를 쓰지 않는다', () => {
    for (const c of charts.slice(0, 10)) {
      const all = [
        ...buildSajuAnalysis(c, NOW, '서윤'),
        ...buildYearlyReport(c, 2027, '서윤'),
        ...buildCareerWealthReport(c, NOW, '서윤'),
        ...buildLoveReport(c, NOW, '서윤'),
        ...buildBasicReading(c, { access: 'full', now: NOW, name: '서윤' }).sections,
      ];
      for (const line of visible(all)) expect(line).not.toContain('—');
    }
  });

  it("리포트 콘텐츠에 '새요'·'값을 해요'·'일할 맛'·'손발이 맞다' 같은 관용구가 없다", () => {
    const dir = path.resolve(__dirname, '../src/modules/interpretation');
    const files = [...fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => path.join(dir, f)), ...fs.readdirSync(path.join(dir, 'content')).map((f) => path.join(dir, 'content', f))];
    for (const f of files) {
      const code = fs
        .readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');
      expect(code, f).not.toMatch(/새요|새는 (곳|돈)|돈이 (잘 )?새|값을 해|일할 맛|손발이/);
    }
  });

  it('寅월(양력 2월)은 이른 봄, 丑월(1월)은 늦겨울', () => {
    expect(seasonOf(2)).toBe('이른 봄');
    expect(seasonOf(1)).toBe('늦겨울');
  });
});

describe('같은 해의 등급과 조언의 방향 — 한 번 판정해 함께 쓴다', () => {
  const C = CAREER_WEALTH_REPORT;
  const SIT = { expand: C.situation.high, steady: C.situation.mid, consolidate: C.situation.low } as const;
  const LINE = { expand: C.yearLine, steady: C.yearLineMid, consolidate: C.yearLineLow } as const;
  it('재물·직업운: 10년 목록의 한 줄, 넓히기·다지기 목록, 가까운 3년의 대상별 문단이 같은 판정을 따른다', () => {
    for (const c of charts) {
      const secs = buildCareerWealthReport(c, NOW, '서윤');
      const decade = secs.find((s) => s.key === 'decade')!;
      const three = secs.find((s) => s.key === 'threeYears')!;
      const rhythm = decade.paragraphs[1]!;
      for (const line of decade.paragraphs.filter((p) => /^20\d\d년 · 돈 /.test(p))) {
        const year = Number(line.slice(0, 4));
        const ev = evaluateFortune(c, yearPillarOf(year), `year-${year}`);
        const mode = careerYearMode(ev.scores.wealth, ev.scores.career);
        expect(line, `${year}`).toContain(LINE[mode][ev.pillar.stemTenGod]);
        const listed = (label: string) => new RegExp(`${label} 해는[^.]*${year}년`).test(rhythm);
        expect(listed('넓히기 좋은'), `${year} 넓히기`).toBe(mode === 'expand');
        expect(listed('다지기 좋은'), `${year} 다지기`).toBe(mode === 'consolidate');
        const employee = three.paragraphs.find((p) => p.startsWith('회사에 다니는 분:') && three.paragraphs.indexOf(p) > three.paragraphs.findIndex((q) => q.startsWith(`${year}년 · 돈`)));
        if (three.paragraphs.some((q) => q.startsWith(`${year}년 · 돈`))) expect(SIT[mode].some((x) => employee!.endsWith(x.employee)), `${year} ${employee}`).toBe(true);
      }
    }
  });

  it("연애·결혼운: 해마다 한 줄의 신호 말은 그해 등급과 맞는다(다지기 신호는 관계 다지기 '좋음' 이상에서만)", () => {
    for (const c of charts) {
      const decade = buildLoveReport(c, NOW, '서윤').find((s) => s.key === 'decade')!;
      for (const line of decade.paragraphs.filter((p) => /^20\d\d년 · 새 인연 /.test(p))) {
        const bondGood = /관계 다지기 (좋음|아주 좋음)/.test(line);
        if (line.endsWith(LOVE_REPORT.signal.steady.line) || line.endsWith(LOVE_REPORT.signal.proper.line)) expect(bondGood, line).toBe(true);
      }
    }
  });
});

describe('성향 판정 — 한 곳에서 정하고 모든 장이 같은 판정을 쓴다', () => {
  it('연애·결혼운: 가까워지는 속도(요약·첫 문단)는 일간의 주도성 판정을 따른다', () => {
    for (const c of charts) {
      const ini = LOVE_REPORT.stem[c.dayMaster.index]!.initiative;
      const pattern = buildLoveReport(c, NOW, '서윤').find((s) => s.key === 'pattern')!;
      expect(pattern.summary.startsWith(LOVE_REPORT.patternSpeed[ini])).toBe(true);
      expect(pattern.paragraphs[0]).toBe(LOVE_REPORT.patternLead[ini]);
    }
  });

  it('연애·결혼운: 먼저 다가가는 일간에게 "좋아하는 마음을 속으로 간직"한다고 쓰지 않는다', () => {
    for (const c of charts) {
      if (LOVE_REPORT.stem[c.dayMaster.index]!.initiative !== 'lead') continue;
      const all = buildLoveReport(c, NOW, '서윤').flatMap((s) => s.paragraphs).join(' ');
      expect(all).not.toContain('속으로 간직');
    }
  });

  it('연애·결혼운: 가까운 사이 장의 오행·12운성 문단은 일지 십성이 정한 결과 반대되지 않는다', () => {
    for (const c of charts) {
      const db = c.pillars.day.branch;
      const tone = LOVE_REPORT.palace.tone[db.tenGod];
      const paras = buildLoveReport(c, NOW, '서윤').find((s) => s.key === 'spousePalace')!.paragraphs;
      const opposite = (x: string) => tone !== 'neutral' && x !== 'neutral' && x !== tone;
      if (opposite(LOVE_REPORT.palace.elementTone[db.element])) expect(paras).not.toContain(LOVE_REPORT.palace.element[db.element]);
      if (opposite(LOVE_REPORT.palace.stageTone[db.twelveStage])) expect(paras).not.toContain(LOVE_REPORT.palace.stage[db.twelveStage]);
    }
  });

  it('가장 많은 십성 — 내 사주 화면과 사주분석서가 같은 목록(같은 수면 모두)을 쓴다', () => {
    for (const c of charts) {
      const tops = topTenGods(c);
      const basic = buildBasicReading(c, { access: 'full', now: NOW, name: '서윤' }).sections.find((s) => s.key === 'tenGods')!;
      const analysis = buildSajuAnalysis(c, NOW, '서윤').find((s) => s.key === 'tenGods')!;
      for (const tg of tops) {
        expect(basic.summary, `${tops}`).toContain(tg);
        expect(analysis.summary, `${tops}`).toContain(tg);
      }
    }
  });
});

describe('신살 목록 — 모든 화면이 같은 목록', () => {
  it('사주분석서 신살 장은 원국의 신살을 모두 담는다(연애·재물 리포트가 말하는 신살이 빠지지 않게)', () => {
    for (const c of charts) {
      const sec = buildSajuAnalysis(c, NOW, '서윤').find((s) => s.key === 'shinsal')!;
      const shown = new Set(sec.paragraphs.map((p) => p.match(/\(([가-힣]+)\)$/)?.[1]).filter(Boolean));
      for (const n of natalShinsal(c)) if (SHINSAL_CONTENT[n] && n !== '현침살') expect(shown.has(n), `${n} / ${[...shown]}`).toBe(true);
      const love = buildLoveReport(c, NOW, '서윤').flatMap((s) => s.paragraphs).join(' ');
      if (love.includes('귀문관살')) expect(shown.has('귀문관살')).toBe(true);
    }
  });
});

describe('월운과 그해 제목 — 본문과 같은 주제', () => {
  it('달 요약은 그달 십성·등급의 문구에서 고른다', () => {
    for (const c of charts.slice(0, 10)) {
      for (const m of buildSajuAnalysis(c, NOW, '서윤').filter((s) => /^month-\d+$/.test(s.key))) {
        const tg = m.keywords![1]!.split(' · ')[0] as keyof typeof LUCK_CONTENT.month;
        const low = /· (조심|쉬어 갈 때)$/.test(m.title);
        const titles = low ? LUCK_CONTENT.month[tg].low.title : LUCK_CONTENT.month[tg].title;
        expect(titles, m.title).toContain(m.summary);
      }
    }
  });

  it('보완 팁의 색 이름이 행운의 색과 같다', () => {
    for (const el of ['wood', 'fire', 'earth', 'metal', 'water'] as const) expect(ELEMENT_CONTENT[el].balanceTips[0]).toContain(LUCKY_COLOR_PLAIN[el]);
  });
});
