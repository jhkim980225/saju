import type { Element, SajuChart } from '@saju/core';
import { useState } from 'react';
import { t } from '@/lib/copy';
import { ELEMENT_META, ELEMENT_ORDER } from '@/lib/format';
import { cx } from './ui';

/** 글자 개수 기준 상태 — 풀이 글('나무 3개, 불 0개')과 같은 기준 */
export function elementStatus(count: number): 'none' | 'weak' | 'balanced' | 'developed' | 'excess' {
  if (count === 0) return 'none';
  if (count >= 4) return 'excess';
  if (count === 3) return 'developed';
  if (count === 2) return 'balanced';
  return 'weak';
}

/** 풀이 글과 같은 쉬운 이름 */
const PLAIN_NAME: Record<Element, string> = { wood: '나무', fire: '불', earth: '흙', metal: '쇠', water: '물' };

/** 도넛 전용 색(styles/index.css --chart-*) — 원형으로 맞닿는 이웃끼리도 구분되게 조정한 단계 */
const CHART_COLOR: Record<Element, string> = {
  wood: 'var(--chart-wood)',
  fire: 'var(--chart-fire)',
  earth: 'var(--chart-earth)',
  metal: 'var(--chart-metal)',
  water: 'var(--chart-water)',
};

// 도넛 크기(viewBox 단위) — 고리 두께 18, 조각 사이 2px 여백(테두리 대신 각도로 띄운다)
const SIZE = 160;
const C = SIZE / 2;
const R_OUT = 76;
const R_IN = 58;
const GAP = 2;

const polar = (r: number, a: number) => [C + r * Math.sin(a), C - r * Math.cos(a)] as const;

/** 12시 방향에서 시계 방향으로 a0 → a1(라디안) 고리 조각. 양 끝을 GAP 만큼 깎는다 */
function arcPath(a0: number, a1: number) {
  const gapOut = GAP / 2 / R_OUT;
  const gapIn = GAP / 2 / R_IN;
  const [x0, y0] = polar(R_OUT, a0 + gapOut);
  const [x1, y1] = polar(R_OUT, a1 - gapOut);
  const [x2, y2] = polar(R_IN, a1 - gapIn);
  const [x3, y3] = polar(R_IN, a0 + gapIn);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const f = (n: number) => n.toFixed(2);
  return `M${f(x0)} ${f(y0)}A${R_OUT} ${R_OUT} 0 ${large} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${R_IN} ${R_IN} 0 ${large} 0 ${f(x3)} ${f(y3)}Z`;
}

/**
 * 오행 분포 — 도넛(상생 순서 목→화→토→금→수, 12시에서 시계 방향) + 범례(글자 수·상태).
 * 사주 여덟(시간 모르면 여섯) 글자의 오행 개수 기준이라 풀이 글과 같은 숫자를 보여 준다. 정확한 비교는 범례의 숫자가 맡는다.
 * 조각·범례에 마우스를 올리거나(터치는 탭) 포커스하면 가운데에 그 오행이 나온다. 기본은 가장 많은 오행.
 */
export function ElementBars({ chart, compact }: { chart: SajuChart; compact?: boolean }) {
  const { count } = chart.elements;
  const [active, setActive] = useState<Element | null>(null);

  const total = ELEMENT_ORDER.reduce((s, e) => s + count[e], 0) || 1;
  const strongest = ELEMENT_ORDER.reduce((a, b) => (count[b] > count[a] ? b : a));
  const shown = active ?? strongest;
  const present = ELEMENT_ORDER.filter((e) => count[e] > 0);

  let start = 0;
  const segments = present.map((e) => {
    const sweep = (count[e] / total) * Math.PI * 2;
    const seg = { e, a0: start, a1: start + sweep };
    start += sweep;
    return seg;
  });

  const label = (e: Element) => {
    const m = ELEMENT_META[e];
    return t('a11y.ohaengBar', { element: `${m.name}(${m.hanja})`, count: count[e], status: t(`result.ohaengChart.status.${elementStatus(count[e])}`) });
  };
  const toggle = (e: Element) => setActive((cur) => (cur === e ? null : e));

  return (
    <div className={cx('flex items-center gap-4 sm:gap-8', compact && 'gap-3')}>
      <div className={cx('relative shrink-0', compact ? 'size-28' : 'size-32 sm:size-40')}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-full [print-color-adjust:exact]" role="img" aria-label={`${t('result.ohaengChart.title')}: ${ELEMENT_ORDER.map(label).join(', ')}`}>
          {segments.length === 1 ? (
            <circle cx={C} cy={C} r={(R_OUT + R_IN) / 2} fill="none" stroke={CHART_COLOR[segments[0]!.e]} strokeWidth={R_OUT - R_IN} />
          ) : (
            segments.map(({ e, a0, a1 }) => (
              <path
                key={e}
                d={arcPath(a0, a1)}
                fill={CHART_COLOR[e]}
                className={cx('cursor-pointer transition-opacity duration-200', active && active !== e && 'opacity-35')}
                onPointerEnter={(ev) => ev.pointerType === 'mouse' && setActive(e)}
                onPointerLeave={(ev) => ev.pointerType === 'mouse' && setActive(null)}
                onClick={() => toggle(e)}
              />
            ))
          )}
        </svg>
        {/* 가운데 — 고른(기본: 가장 강한) 오행 */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center" aria-hidden>
          <span className={cx('font-serif font-semibold leading-none text-ink', compact ? 'text-2xl' : 'text-3xl sm:text-4xl')}>{ELEMENT_META[shown].hanja}</span>
          <span className="tabular mt-1.5 text-xs text-ink-2">
            {PLAIN_NAME[shown]} {count[shown]}개
          </span>
          {!active && !compact && <span className="mt-0.5 text-[11px] text-ink-3">가장 많은 기운</span>}
        </div>
      </div>

      <ul className={cx('min-w-0 flex-1', compact ? 'space-y-1' : 'space-y-1.5')}>
        {ELEMENT_ORDER.map((e) => {
          const m = ELEMENT_META[e];
          const status = elementStatus(count[e]);
          return (
            <li key={e}>
              <button
                type="button"
                aria-label={label(e)}
                onPointerEnter={(ev) => ev.pointerType === 'mouse' && setActive(e)}
                onPointerLeave={(ev) => ev.pointerType === 'mouse' && setActive(null)}
                onFocus={() => setActive(e)}
                onBlur={() => setActive(null)}
                onClick={() => toggle(e)}
                className={cx(
                  'grid w-full grid-cols-[0.625rem_auto_1fr_auto] items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors sm:gap-2.5 sm:px-2',
                  active === e ? 'bg-subtle' : 'hover:bg-subtle/60',
                )}
              >
                <span className="size-2.5 rounded-[3px] [print-color-adjust:exact]" style={{ background: CHART_COLOR[e] }} aria-hidden />
                <span className="whitespace-nowrap text-[15px] text-ink">
                  <span className="font-serif font-semibold">{m.hanja}</span> <span className="text-xs text-ink-2">{PLAIN_NAME[e]}</span>
                </span>
                <span className="tabular text-right text-sm font-medium text-ink">{count[e]}개</span>
                <span className={cx('min-w-7 text-right text-xs', status === 'none' || status === 'weak' ? 'text-danger' : status === 'excess' ? 'text-gold' : 'text-ink-3')}>
                  {t(`result.ohaengChart.status.${status}`)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
