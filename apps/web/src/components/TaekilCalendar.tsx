import type { TaekilDayDto } from '@saju/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { t } from '@/lib/copy';
import { GRADE_STYLE, dateA11y, monthGrid, monthKey, monthOf, monthsBetween, shiftMonth, type MonthRef } from '@/lib/taekil';
import { cx } from './ui';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

function WeekdayRow() {
  return (
    <div className="grid grid-cols-7 text-center text-xs text-ink-3" aria-hidden>
      {WEEK.map((w, i) => (
        <span key={w} className={cx('py-1.5', i === 0 && 'text-seal/80')}>
          {w}
        </span>
      ))}
    </div>
  );
}

const monthTitle = (m: MonthRef) => t('taekil.calendar.monthTitle', { year: m.year, month: m.month });

/**
 * 날짜 고르기 달력 — 기간(시작·끝) 또는 후보 날짜 여러 개.
 * 모바일 한 달, 데스크톱(lg↑) 두 달을 나란히 보여 준다.
 */
export function DatePickerCalendar({
  month,
  onMonthChange,
  min,
  max,
  today,
  isSelected,
  isInRange,
  onTap,
}: {
  month: MonthRef;
  onMonthChange: (m: MonthRef) => void;
  min: string;
  max: string;
  today: string;
  isSelected: (iso: string) => boolean;
  isInRange?: (iso: string) => boolean;
  onTap: (iso: string) => void;
}) {
  const canPrev = monthKey(month) > monthKey(monthOf(min));
  const canNext = monthKey(shiftMonth(month, 1)) < monthKey(monthOf(max));
  const months = [month, shiftMonth(month, 1)];
  return (
    <div>
      <div className="flex items-center justify-between">
        <button type="button" aria-label={t('taekil.calendar.prev')} disabled={!canPrev} onClick={() => onMonthChange(shiftMonth(month, -1))} className="grid size-10 place-items-center rounded-full hover:bg-subtle disabled:opacity-30">
          <ChevronLeft className="size-5" />
        </button>
        <p className="font-semibold lg:hidden" aria-live="polite">
          {monthTitle(month)}
        </p>
        <p className="hidden flex-1 grid-cols-2 gap-8 px-4 text-center font-semibold lg:grid" aria-live="polite">
          {months.map((m) => (
            <span key={monthKey(m)}>{monthTitle(m)}</span>
          ))}
        </p>
        <button type="button" aria-label={t('taekil.calendar.next')} disabled={!canNext} onClick={() => onMonthChange(shiftMonth(month, 1))} className="grid size-10 place-items-center rounded-full hover:bg-subtle disabled:opacity-30">
          <ChevronRight className="size-5" />
        </button>
      </div>
      <div className="mt-2 grid gap-8 lg:grid-cols-2">
        {months.map((m, idx) => (
          <div key={monthKey(m)} className={cx(idx === 1 && 'hidden lg:block')}>
            <WeekdayRow />
            <div role="grid" aria-label={monthTitle(m)} className="space-y-1">
              {monthGrid(m).map((week, wi) => (
                <div key={wi} role="row" className="grid grid-cols-7 gap-1">
                  {week.map((iso, di) => {
                    if (!iso) return <span key={di} role="gridcell" />;
                    const disabled = iso < min || iso > max;
                    const selected = isSelected(iso);
                    const inRange = !selected && Boolean(isInRange?.(iso));
                    return (
                      <span key={iso} role="gridcell">
                        <button
                          type="button"
                          disabled={disabled}
                          aria-pressed={selected}
                          aria-label={`${dateA11y(iso)}${iso === today ? ` ${t('taekil.calendar.today')}` : ''}`}
                          onClick={() => onTap(iso)}
                          className={cx(
                            'relative grid h-11 w-full place-items-center rounded-xl text-[15px] tabular transition-colors disabled:text-ink-3/40',
                            selected ? 'bg-action font-semibold text-on-action' : inRange ? 'bg-subtle text-ink' : 'text-ink hover:bg-subtle',
                            di === 0 && !selected && !disabled && 'text-seal/90',
                          )}
                        >
                          {Number(iso.slice(8, 10))}
                          {iso === today && <span className={cx('absolute bottom-1.5 size-1 rounded-full', selected ? 'bg-on-action' : 'bg-ink-3')} aria-hidden />}
                        </button>
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 추천 순위 도장 */
export function RankSeal({ rank, className }: { rank: number; className?: string }) {
  return (
    <span className={cx('grid size-5 place-items-center rounded-full bg-seal font-serif text-[11px] font-bold leading-none text-white', className)} aria-hidden>
      {rank}
    </span>
  );
}

/** 결과 달력 — 후보 날짜에 등급 표시, Top 3 에 순위 도장 */
export function GradeCalendar({ days, selected, onSelect }: { days: TaekilDayDto[]; selected?: string | null; onSelect: (date: string) => void }) {
  if (days.length === 0) return null;
  const byDate = new Map(days.map((d) => [d.date, d]));
  const months = monthsBetween(days[0]!.date, days[days.length - 1]!.date);
  return (
    <div className="space-y-6">
      {months.map((m) => (
        <section key={monthKey(m)} aria-label={monthTitle(m)}>
          <h3 className="mb-1 font-semibold">{monthTitle(m)}</h3>
          <WeekdayRow />
          <div role="grid" aria-label={monthTitle(m)} className="space-y-1">
            {monthGrid(m).map((week, wi) => (
              <div key={wi} role="row" className="grid grid-cols-7 gap-1">
                {week.map((iso, di) => {
                  const d = iso ? byDate.get(iso) : undefined;
                  if (!iso || !d) {
                    return (
                      <span key={iso ?? di} role="gridcell" className="grid h-12 place-items-center text-sm tabular text-ink-3/40">
                        {iso ? Number(iso.slice(8, 10)) : ''}
                      </span>
                    );
                  }
                  const st = GRADE_STYLE[d.grade];
                  return (
                    <span key={iso} role="gridcell">
                      <button
                        type="button"
                        onClick={() => onSelect(iso)}
                        aria-label={`${dateA11y(iso)} ${d.gradeLabel}${d.rank ? ` 추천 ${d.rank}위` : ''}`}
                        aria-current={selected === iso ? 'date' : undefined}
                        className={cx('relative flex h-12 w-full flex-col items-center justify-center rounded-xl leading-none', st.cell, selected === iso && 'outline-2 outline-offset-1 outline-ink')}
                      >
                        <span className="text-[15px] font-semibold tabular">{Number(iso.slice(8, 10))}</span>
                        <span className="mt-1 text-[11px]" aria-hidden>
                          {st.mark}
                        </span>
                        {d.rank && <RankSeal rank={d.rank} className="absolute -right-1 -top-1" />}
                      </button>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
