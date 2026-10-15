/**
 * 택일 이유·타로의 사주 결합 문장 — 사주를 모르는 사람이 읽어도 이해되는 쉬운 말인지 회귀 검사(docs/PLAIN_KOREAN.md).
 * 화면에 그대로 보이는 글만 모은다. 용어·한자는 basis·term('사주로 보면'·'옛 달력·사주 용어로 보면' 접힘)에만 있어야 한다.
 */
import { calculateSaju, parseYmd, selectTaekilDays, taekilDateRange, ymdKey, type BirthInput, type TaekilPurpose } from '@saju/core';
import { describe, expect, it } from 'vitest';
import { ruleBasedAnswer } from '../src/modules/chat/service.js';
import { buildSections, dayDtos, headlineOf, lockedSections, type TaekilTextContext } from '../src/modules/taekil/content.js';
import { buildTarotReading } from '../src/modules/tarot/reading.js';

/** 12가지 사주 — 일간·띠·용신이 골고루 섞이게 */
const births: BirthInput[] = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Date.UTC(1984 + i * 3, i, 3 + i * 2));
  return { calendar: 'solar', year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: i % 4 === 0 ? null : 6 + i, minute: i % 4 === 0 ? null : 10, gender: i % 2 ? 'male' : 'female' };
});

/** 낱말 첫머리에서만 — '상관없이' 같은 일상어는 걸리지 않게 */
const word = (j: string) => new RegExp(`(^|[^가-힣])${j}`);
const SAJU_JARGON = ['당신', '일간', '일지', '일주', '일진', '용신', '희신', '기신', '십신', '천간', '간지', '신강', '신약', '겁재', '비견', '식신', '상관(?!없)', '편재', '정재', '편관', '정관', '편인', '정인', '오행', '원소'];
const TAEKIL_JARGON = ['황도', '흑도', '건제', '천을', '귀인', '천덕', '월덕', '천사일', '사리', '사절', '월파', '월기', '귀기', '팽조', '역마', '문창', '공망', '원진', '육합', '삼합', '천간합', '통서', '역법', '길일', '대길', '절입', '년지', '본명', '혼례'];
/** 한 글자 용어는 낱말 하나로 떨어져 있을 때만 — '충분', '형편'은 통과 */
const SINGLE = ['충', '형', '파', '직', '흉'].map((j) => [j, new RegExp(`(^|[\\s(·])${j}(\\)|[\\s,·.]|일|$)`)] as const);

function expectPlain(lines: string[], where: string, extra: string[] = []) {
  for (const line of lines) {
    expect(line, where).not.toMatch(/[一-鿿]/); // 한자는 한 글자도 보이지 않게
    for (const j of [...SAJU_JARGON, ...extra]) expect(word(j).test(line), `${where}: '${j}' — ${line}`).toBe(false);
    expect(line, where).not.toMatch(/undefined|null|NaN|\{|\}|\s{2,}|님님|이\(가\)|을\(를\)|은\(는\)/);
    expect(line.trim(), where).toBe(line);
  }
}

/** 문장 단위로 쪼개 같은 문장이 되풀이되지 않는지 */
function expectNoRepeat(lines: string[], where: string) {
  const seen = new Set<string>();
  for (const s of lines.flatMap((l) => l.split(/(?<=[.!?])\s+/)).map((x) => x.trim()).filter((x) => x.length > 14)) {
    expect(seen.has(s), `${where}: 반복 — ${s}`).toBe(false);
    seen.add(s);
  }
}

const PURPOSES: TaekilPurpose[] = ['move', 'contract', 'exam', 'wedding', 'opening', 'travel'];

describe('택일 — 날짜 이유와 풀이는 쉬운 말로, 용어는 접힌 근거에만', () => {
  for (const purpose of PURPOSES) {
    it(`${purpose} — 8가지 사주 × 2달`, { timeout: 60_000 }, () => {
      const dates = taekilDateRange('2026-11-01', '2026-12-30').map(ymdKey);
      births.slice(0, 8).forEach((birth, bi) => {
        const chart = calculateSaju(birth);
        const partner = purpose === 'wedding' ? calculateSaju(births[(bi + 5) % births.length]!) : null;
        const sel = selectTaekilDays(chart, purpose, dates.map(parseYmd), { partner });
        const ctx: TaekilTextContext = { purpose, mode: 'range', profileName: '서윤', partnerName: partner ? '민준' : null, chart, sel };
        const where = `${purpose} ${birth.year}-${birth.month}-${birth.day}`;
        const days = dayDtos(ctx, false);
        const lines: string[] = [headlineOf(sel, purpose)];
        for (const d of days) {
          expect(d.gradeLabel).toMatch(/^(아주 좋은 날|좋은 날|평범한 날|조심할 날|피할 날)$/);
          lines.push(d.summary!, ...(d.dropReason ? [d.dropReason] : []), ...(d.goodHours ?? []));
          for (const r of d.reasons!) {
            lines.push(r.label, r.text);
            // 용어는 term 에만 — 비어 있지 않게
            expect(r.term, where).toBeTruthy();
            expect(r.text, `${where}: ${r.label}`).toMatch(/[요다]\.$/);
          }
          // 같은 날 안에서 같은 문장을 두 번 쓰지 않는다
          expectNoRepeat([d.summary!, ...d.reasons!.map((r) => r.text)], `${where} ${d.date}`);
          expect(d.basis, where).toMatch(/^일진 .+ · 건제12신 .+ · (황도|흑도) /);
          if (d.goodHours) for (const h of d.goodHours) expect(h).toMatch(/^(오전|오후|낮) \d+(시)?~((오전|오후|낮) )?\d+시$/);
        }
        const sections = buildSections(ctx);
        for (const s of sections) lines.push(s.title, s.summary, ...s.paragraphs);
        for (const s of lockedSections(ctx, 'report_taekil')) lines.push(s.summary, ...s.paragraphs);
        expectPlain(lines, where, TAEKIL_JARGON);
        for (const l of lines) for (const [j, re] of SINGLE) expect(re.test(l), `${where}: '${j}' — ${l}`).toBe(false);
        // 섹션 본문은 섹션끼리도 같은 문장을 되풀이하지 않는다
        expectNoRepeat(sections.flatMap((s) => s.paragraphs), where);
        // 근거(basis)에는 용어가 남아 있다 — 궁금한 사람은 펼쳐 본다
        expect(sections[0]!.basis).toMatch(/일주 .+ · 일지 .+ · 일지 충/);
      });
    });
  }
});

describe('타로 — 사주로 본 카드는 쉬운 말로, 일간·용신은 basis 에만', () => {
  const SPREADS = [
    { spread: 'daily', topic: null, n: 1 },
    { spread: 'yesno', topic: 'yesno', n: 1 },
    { spread: 'three', topic: 'career', n: 3 },
    { spread: 'feelings5', topic: 'feelings', n: 5 },
    { spread: 'reunion5', topic: 'reunion', n: 5 },
    { spread: 'choice', topic: 'choice', n: 3 },
    { spread: 'celtic', topic: 'celtic', n: 10 },
  ] as const;

  for (const name of ['서윤', null]) {
    it(`펼침 7가지 × 12가지 사주 · 이름 ${name ? '있음' : '없음'}`, { timeout: 60_000 }, () => {
      births.forEach((birth, bi) => {
        const chart = calculateSaju(birth);
        for (const sp of SPREADS) {
          for (let k = 0; k < 4; k++) {
            const drawn = Array.from({ length: sp.n }, (_, i) => ({ index: (bi * 7 + k * 19 + i * 11) % 78, orientation: (i + k) % 3 === 0 ? ('reversed' as const) : ('upright' as const) }));
            const r = buildTarotReading({ id: `p${bi}${k}`, spread: sp.spread, topic: sp.topic, drawn, chart, unlocked: true, options: sp.spread === 'choice' ? { a: '지금 회사', b: '새 회사' } : null, name });
            const saju = r.sections.find((s) => s.key === 'saju')!;
            const where = `${sp.spread} ${birth.year}-${birth.month}-${birth.day} ${name ?? '(이름 없음)'}`;
            const visible = [saju.title, saju.summary, ...saju.paragraphs];
            expectPlain(visible, where);
            expectNoRepeat(saju.paragraphs, where);
            if (name) expect(visible.join(' '), where).toContain(`${name}님`);
            else expect(visible.join(' '), where).not.toContain('님');
            // 첫 문단은 결론이 아니라 '무엇을 견줬는지' — 요약(결론)과 같지 않게
            expect(saju.paragraphs[0]).not.toContain(saju.summary);
            expect(saju.basis, where).toMatch(/^일간 .+ · 용신 .+ · 카드 원소 .+달빛사주 방식/);
            // 같은 카드를 주어로 두 문장 연달아 쓰지 않는다
            const subjects = saju.paragraphs.map((p) => p.match(/^(.+?)(은|는) /)?.[1] ?? '');
            subjects.forEach((s, i) => i > 0 && s && expect(s, `${where}: ${saju.paragraphs[i]}`).not.toBe(subjects[i - 1]));
            // 총평에도 타로·사주 용어 없이
            const overview = r.sections.find((s) => s.key === 'overview');
            if (overview) expectPlain(overview.paragraphs, where, ['메이저 아르카나', '마이너 아르카나']);
          }
        }
      });
    });
  }

  it('궁합 타로 — 두 사람 모두 이름으로, 용어 없이', () => {
    births.slice(0, 6).forEach((birth, bi) => {
      const me = { name: '서윤', chart: calculateSaju(birth) };
      const partner = { name: '민준', chart: calculateSaju(births[bi + 6]!) };
      const drawn = [0, 1, 2, 3, 4].map((i) => ({ index: (bi * 13 + i * 17) % 78, orientation: 'upright' as const }));
      const r = buildTarotReading({ id: `c${bi}`, spread: 'compat', topic: 'compat', drawn, chart: me.chart, unlocked: true, people: { me, partner } });
      const saju = r.sections.find((s) => s.key === 'saju')!;
      const visible = [saju.summary, ...saju.paragraphs];
      expectPlain(visible, `compat ${bi}`);
      expectNoRepeat(saju.paragraphs, `compat ${bi}`);
      expect(visible.join(' ')).toContain('서윤님');
      expect(visible.join(' ')).toContain('민준님');
      expect(saju.basis).toMatch(/서윤 일간 .+·용신 .+ · 민준 일간/);
    });
  });

  it('잠긴 사주 섹션은 쉬운 말 미리보기만, 용어 근거는 보내지 않는다', () => {
    const r = buildTarotReading({ id: 'L', spread: 'three', topic: 'love', drawn: [{ index: 3, orientation: 'upright' }, { index: 40, orientation: 'reversed' }, { index: 70, orientation: 'upright' }], chart: calculateSaju(births[1]!), unlocked: false, name: '서윤' });
    const saju = r.sections.find((s) => s.key === 'saju')!;
    expect(saju.locked).toBe(true);
    expect(saju.basis).toBeUndefined();
    expectPlain([saju.summary, ...saju.paragraphs.map((p) => p.replace(/…$/, '').trim())], 'locked');
  });
});

describe('AI 상담 규칙 기반 답변 — 결론 먼저, 이름으로, 용어 없이', () => {
  const MESSAGES = ['올해 이직해도 될까요?', '제 성격은 어떤가요?', '연애운이 궁금해요', '요즘 어떻게 지내면 좋을까요?', '돈 관리는 어떻게 할까요?'];
  for (const name of ['서윤', '나']) {
    it(`12가지 사주 × 질문 5개 · 이름 '${name}'`, { timeout: 60_000 }, () => {
      for (const birth of births) {
        const chart = calculateSaju(birth);
        for (const m of MESSAGES) {
          const text = ruleBasedAnswer(chart, m, 'none', name);
          const paras = text.split('\n\n');
          const where = `${birth.year}-${birth.month}-${birth.day} ${m}`;
          expectPlain(paras, where);
          expect(text).not.toMatch(/관점에서 말씀드릴게요|\.\./);
          expect(paras.at(-1)).toMatch(/^오늘 하나만 해 본다면, .+요\.$/);
          if (name === '나') expect(text).not.toContain('님');
        }
      }
    });
  }
});
