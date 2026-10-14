import type { SajuChart } from '@saju/core';
import { useEffect, useRef } from 'react';
import { t } from '@/lib/copy';
import { ELEMENT_META } from '@/lib/format';
import { cx } from './ui';

export function DaeunTimeline({ chart }: { chart: SajuChart }) {
  const year = new Date().getFullYear();
  const current = chart.daeun.periods.find((p) => year >= p.startYear && year <= p.endYear);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, []);
  const stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  const stemElement = ['wood', 'wood', 'fire', 'fire', 'earth', 'earth', 'metal', 'metal', 'water', 'water'] as const;
  const branchElement = ['water', 'earth', 'wood', 'wood', 'earth', 'fire', 'fire', 'earth', 'metal', 'metal', 'earth', 'water'] as const;
  return (
    <div>
      <ol className="no-scrollbar -mx-5 flex snap-x gap-2 overflow-x-auto px-5 pb-2 print:mx-0 print:flex-wrap print:overflow-visible print:px-0" aria-label={t('result.sections.daeun.title')}>
        {chart.daeun.periods.map((p) => {
          const isNow = p === current;
          const se = ELEMENT_META[stemElement[p.stem]!];
          const be = ELEMENT_META[branchElement[p.branch]!];
          return (
            <li key={p.startAge} ref={isNow ? ref : undefined} className={cx('w-[4.5rem] shrink-0 snap-center rounded-2xl border p-2 text-center', isNow ? 'border-ink bg-surface' : 'border-line')}>
              <p className="tabular text-xs font-semibold text-ink-2">{t('result.daeunTimeline.age', { age: p.startAge })}</p>
              <div className={cx('mx-auto mt-1.5 grid size-10 place-items-center rounded-lg font-serif text-xl', se.cls.soft, se.cls.ink)}>{stems[p.stem]}</div>
              <div className={cx('mx-auto mt-1 grid size-10 place-items-center rounded-lg font-serif text-xl', be.cls.soft, be.cls.ink)}>{p.ganzhi.hanja.slice(1)}</div>
              <p className="mt-1.5 text-[11px] text-ink-3">{p.stemTenGod}</p>
              {isNow && <p className="mt-1 text-[11px] font-bold text-ink">{t('result.daeunTimeline.current')}</p>}
            </li>
          );
        })}
      </ol>
      {current && (
        <p className="mt-2 text-sm text-ink-2">
          {t('result.daeunTimeline.current')} {current.ganzhi.hangul}({current.ganzhi.hanja}) · {t('result.daeunTimeline.remaining', { years: Math.max(0, current.endYear - year + 1) })}
        </p>
      )}
    </div>
  );
}
