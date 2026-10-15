import type { SajuChart } from '@saju/core';
import { TEN_GOD_PLAIN_LABEL } from '@saju/shared';
import { useEffect, useRef } from 'react';
import { t } from '@/lib/copy';
import { ELEMENT_META } from '@/lib/format';
import { cx } from './ui';

/**
 * 10년마다 바뀌는 흐름(대운) 타임라인 — 처음 보는 사람용.
 * 칸마다 시작 나이, 두 글자(색 = 나무·불·흙·쇠·물), 그 10년의 분위기를 한 단어로. 십성 이름(정관 등)은 쓰지 않는다.
 */
export function DaeunTimeline({ chart }: { chart: SajuChart }) {
  const year = new Date().getFullYear();
  const current = chart.daeun.periods.find((p) => year >= p.startYear && year <= p.endYear);
  const ref = useRef<HTMLLIElement>(null);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    // 지금 칸을 가로로만 가운데로 — scrollIntoView 는 페이지까지 세로로 내려 버려 리포트 맨 위 요약을 건너뛰게 한다
    const ol = list.current;
    const li = ref.current;
    if (ol && li) ol.scrollLeft = li.offsetLeft - ol.offsetLeft - (ol.clientWidth - li.clientWidth) / 2;
  }, []);
  const stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  const stemElement = ['wood', 'wood', 'fire', 'fire', 'earth', 'earth', 'metal', 'metal', 'water', 'water'] as const;
  const branchElement = ['water', 'earth', 'wood', 'wood', 'earth', 'fire', 'fire', 'earth', 'metal', 'metal', 'earth', 'water'] as const;
  const mood = (tg: string) => TEN_GOD_PLAIN_LABEL[tg] ?? tg;
  return (
    <div>
      <p className="mb-3 text-sm text-ink-3">칸마다 그 10년이 시작하는 나이와 분위기를 한 단어로 적었어요. 글자 색은 나무·불·흙·쇠·물 기운이에요.</p>
      <ol ref={list} className="no-scrollbar -mx-5 flex snap-x gap-2 overflow-x-auto px-5 pb-2 print:mx-0 print:flex-wrap print:overflow-visible print:px-0" aria-label={t('result.sections.daeun.title')}>
        {chart.daeun.periods.map((p) => {
          const isNow = p === current;
          const se = ELEMENT_META[stemElement[p.stem]!];
          const be = ELEMENT_META[branchElement[p.branch]!];
          return (
            <li
              key={p.startAge}
              ref={isNow ? ref : undefined}
              aria-label={`${p.startAge}세부터 10년, ${mood(p.stemTenGod)}${isNow ? `, ${t('result.daeunTimeline.current')}` : ''}`}
              className={cx('w-[4.75rem] shrink-0 snap-center rounded-2xl border p-2 text-center', isNow ? 'border-focus bg-surface' : 'border-line')}
            >
              <p className="tabular text-xs font-semibold text-ink-2">{t('result.daeunTimeline.age', { age: p.startAge })}</p>
              <div className={cx('mx-auto mt-1.5 grid size-10 place-items-center rounded-lg font-serif text-xl', se.cls.soft, se.cls.ink)} aria-hidden>
                {stems[p.stem]}
              </div>
              <div className={cx('mx-auto mt-1 grid size-10 place-items-center rounded-lg font-serif text-xl', be.cls.soft, be.cls.ink)} aria-hidden>
                {p.ganzhi.hanja.slice(1)}
              </div>
              <p className="mt-1.5 text-[11px] leading-tight text-ink-2">{mood(p.stemTenGod)}</p>
              {isNow && <p className="mt-1 text-[11px] font-bold text-ink">{t('result.daeunTimeline.current')}</p>}
            </li>
          );
        })}
      </ol>
      {current && (
        <p className="mt-2 text-sm text-ink-2">
          지금은 {current.startAge}~{current.endAge}세, '{mood(current.stemTenGod)}'의 10년이에요 · {t('result.daeunTimeline.remaining', { years: Math.max(0, current.endYear - year + 1) })}
        </p>
      )}
    </div>
  );
}
