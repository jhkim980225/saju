/**
 * 토정비결 결과 조립 — 엔진의 작괘 결과(@saju/core computeTojeong) + 144괘 원고(content/).
 * AI 를 쓰지 않는 규칙 기반 무료 콘텐츠라 외부 키 없이 그대로 동작한다.
 */
import { computeTojeong, type TojeongResult } from '@saju/core';
import type { TojeongDto, TojeongMonthFlow } from '@saju/shared';
import { gwaeOf } from './content/index.js';

export const TOJEONG_DISCLAIMER =
  '토정비결은 조선 후기부터 전해 오는 세시 풍속의 한 해 신수 보기예요. 괘의 원문을 바탕으로 달빛사주가 요즘 말로 풀어 쓴 참고용 콘텐츠이니, 중요한 결정은 스스로의 판단과 전문가의 조언을 함께 고려해 주세요.';

export const TOJEONG_FLOW_LABEL: Record<TojeongMonthFlow, string> = { rise: '힘이 붙는 달', even: '고른 달', care: '살피는 달' };

const md = (d: { month: number; day: number }) => `${d.month}.${d.day}`;
const iso = (d: { year: number; month: number; day: number }) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

export function buildTojeong(r: TojeongResult, profileId: string | null): TojeongDto {
  const g = gwaeOf(r.code);
  return {
    year: r.targetYear,
    yearPillar: { hanja: r.taese.ganzhi.hanja, hangul: r.taese.ganzhi.hangul },
    profileId,
    gwae: { code: r.code, upper: r.upper, middle: r.middle, lower: r.lower, verse: g.verse, reading: g.reading, title: g.title, summary: g.summary, keywords: [...g.keywords] },
    overview: [...g.overview],
    months: g.months.map((m, i) => {
      const range = r.months[i]!;
      return {
        month: i + 1,
        label: `음력 ${i + 1}월`,
        period: `${md(range.start)} ~ ${md(range.end)}`,
        flow: m.flow,
        flowLabel: TOJEONG_FLOW_LABEL[m.flow],
        text: m.text,
      };
    }),
    basis: {
      lunarBirth: { ...r.lunarBirth },
      age: r.age,
      upper: { ganzhi: r.taese.ganzhi.hanja, value: r.taese.value, sum: r.taese.sum },
      middle: { ganzhi: r.wolgeon.ganzhi.hanja, value: r.wolgeon.value, monthDays: r.wolgeon.monthDays, sum: r.wolgeon.sum },
      lower: { ganzhi: r.iljin.ganzhi.hanja, value: r.iljin.value, birthDay: r.iljin.birthDay, solarDate: iso(r.iljin.solarDate), sum: r.iljin.sum },
      notes: [...r.notes],
    },
    shareText: `${r.targetYear} 토정비결 ${r.code}괘 「${g.title}」 — ${g.summary}`,
    disclaimer: TOJEONG_DISCLAIMER,
  };
}

/** 출생 정보와 대상 연도로 바로 결과 만들기 */
export function tojeongFor(birth: Parameters<typeof computeTojeong>[0], year: number, profileId: string | null = null): TojeongDto {
  return buildTojeong(computeTojeong(birth, year), profileId);
}
