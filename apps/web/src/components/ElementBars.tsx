import type { Element, SajuChart } from '@saju/core';
import { t } from '@/lib/copy';
import { ELEMENT_META, ELEMENT_ORDER } from '@/lib/format';
import { cx } from './ui';

export function elementStatus(count: number, percent: number): 'none' | 'weak' | 'balanced' | 'developed' | 'excess' {
  if (count === 0) return 'none';
  if (percent >= 35) return 'excess';
  if (percent >= 25) return 'developed';
  if (percent >= 12) return 'balanced';
  return 'weak';
}

export function ElementBars({ chart, compact }: { chart: SajuChart; compact?: boolean }) {
  const { count, percent } = chart.elements;
  const max = Math.max(...ELEMENT_ORDER.map((e) => percent[e]), 40);
  return (
    <ul className={cx('space-y-2.5', compact && 'space-y-1.5')}>
      {ELEMENT_ORDER.map((e: Element) => {
        const m = ELEMENT_META[e];
        const status = elementStatus(count[e], percent[e]);
        const statusText = t(`result.ohaengChart.status.${status}`);
        return (
          <li key={e} className="grid grid-cols-[3.25rem_1fr_5rem] items-center gap-3" aria-label={t('a11y.ohaengBar', { element: `${m.name}(${m.hanja})`, count: count[e], percent: Math.round(percent[e]), status: statusText })}>
            <span className={cx('font-serif text-[15px] font-semibold', m.cls.solid)}>
              {m.hanja} <span className="text-xs text-ink-2">{m.name}</span>
            </span>
            <span className="h-2.5 overflow-hidden rounded-full bg-subtle">
              <span className={cx('block h-full rounded-full transition-[width] duration-700', m.cls.bg)} style={{ width: `${Math.max(2, (percent[e] / max) * 100)}%` }} />
            </span>
            <span className="tabular text-right text-sm text-ink-2">
              <span className="font-medium text-ink">{Math.round(percent[e])}%</span> <span className={cx('text-xs', status === 'none' || status === 'weak' ? 'text-danger' : status === 'excess' ? 'text-gold' : 'text-ink-3')}>{statusText}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
