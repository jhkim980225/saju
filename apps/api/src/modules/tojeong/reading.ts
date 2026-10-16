/**
 * 토정비결 결과 조립 — 엔진의 작괘 결과(@saju/core computeTojeong) + 144괘 원고(content/).
 * AI 를 쓰지 않는 규칙 기반 무료 콘텐츠라 외부 키 없이 그대로 동작한다.
 *
 * 화면 글은 토정비결을 처음 접하는 성인 기준(docs/PLAIN_KOREAN.md):
 * 총평 원고의 '…괘예요'는 총평 첫머리에서 '괘'가 설명 없이 나오지 않도록 plainOverview 로 '모습·뜻'으로 바꿔 보여 준다.
 * 괘 번호·한문 원문·계산 근거는 화면에서 '옛 글귀'·'괘를 뽑은 방법(접힘)'으로 따로 두고, 거기서 '괘'의 뜻을 설명한다.
 */
import { computeTojeong, type TojeongResult } from '@saju/core';
import type { TojeongDto, TojeongMonthFlow } from '@saju/shared';
import { gwaeOf } from './content/index.js';

export const TOJEONG_DISCLAIMER =
  '토정비결은 조선 후기부터 새해마다 한 해의 운수를 살펴보던 세시 풍속입니다. 이 풀이는 옛 글귀를 바탕으로 달빛사주가 현대어로 풀어 쓴 참고용 해석이에요. 중요한 결정은 본인의 판단과 전문가의 조언을 함께 고려해 주세요.';

/** 그달의 흐름 — 신년운세 등급('좋은 해·무난한 해·조심할 해')과 같은 말로 맞춘다. 웹 apps/web/src/lib/tojeong.ts FLOW_LABEL 과 같아야 한다 */
export const TOJEONG_FLOW_LABEL: Record<TojeongMonthFlow, string> = { rise: '좋은 달', even: '무난한 달', care: '조심할 달' };

/**
 * 총평 문단의 '괘'를 쉬운 말로 — 원고 144개를 손대지 않고 같은 규칙으로 바꾼다.
 * '…다는 괘예요' → '…다는 뜻이에요', '…모습의 괘예요' → '…모습이에요', 그 밖의 '…괘예요' → '…모습이에요'.
 */
export function plainOverview(text: string): string {
  return text
    .replace(/(다는|라는|냐는) 괘예요/g, '$1 뜻이에요')
    .replace(/(다는|라는|냐는) 괘로,/g, '$1 뜻으로,')
    .replace(/(모습|그림)의 괘예요/g, '$1이에요')
    .replace(/의 괘예요/g, '의 모습이에요')
    .replace(/ 괘예요/g, ' 모습이에요')
    .replace(/ 괘로,/g, ' 모습으로,')
    .replace(/이 괘의 /g, '올해의 ')
    // 한 문장에 '모습'이 두 번 겹치면('본모습이 보이는 모습') 뒤쪽을 '때'로
    .replace(/(모습[^.]*?) 모습이에요/g, '$1 때예요');
}

const md = (d: { month: number; day: number }) => `${d.month}.${d.day}`;
const iso = (d: { year: number; month: number; day: number }) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

export function buildTojeong(r: TojeongResult, profileId: string | null): TojeongDto {
  const g = gwaeOf(r.code);
  return {
    year: r.targetYear,
    yearPillar: { hanja: r.taese.ganzhi.hanja, hangul: r.taese.ganzhi.hangul },
    profileId,
    gwae: { code: r.code, upper: r.upper, middle: r.middle, lower: r.lower, verse: g.verse, reading: g.reading, title: g.title, summary: g.summary, keywords: [...g.keywords] },
    overview: g.overview.map(plainOverview),
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
