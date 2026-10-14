import { useQuery } from '@tanstack/react-query';
import type { ProductDto, ReadingSection, TaekilDayDto, TaekilResultDto } from '@saju/shared';
import { ArrowLeft, Clock, Lock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page } from '@/components/AppShell';
import { BottomSheet } from '@/components/BottomSheet';
import { PaywallSheet } from '@/components/PaywallSheet';
import { GradeCalendar, RankSeal } from '@/components/TaekilCalendar';
import { Badge, Button, Card, Chip, ErrorState, IconButton, PageHeader, Segmented, Spinner, cx } from '@/components/ui';
import { useProducts } from '@/hooks/queries';
import { usePurchase } from '@/hooks/usePurchase';
import { SessionGateError, useSessionGate } from '@/hooks/useSessionGate';
import { ApiError, api } from '@/lib/api';
import { t } from '@/lib/copy';
import { won } from '@/lib/format';
import { useSession } from '@/lib/session';
import { GRADE_ORDER, GRADE_STYLE, dateKo, dateShort } from '@/lib/taekil';

function GradeBadge({ day }: { day: Pick<TaekilDayDto, 'grade' | 'gradeLabel'> }) {
  const st = GRADE_STYLE[day.grade];
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold', st.badge)}>
      <span aria-hidden>{st.mark}</span>
      {day.gradeLabel}
    </span>
  );
}

const lunarText = (d: TaekilDayDto) => (d.lunar ? `음력 ${d.lunar.isLeapMonth ? '윤' : ''}${d.lunar.month}.${d.lunar.day}` : '');

/** 날짜 하나의 자세한 풀이 — 잠겨 있으면 등급만 */
function DaySheet({ day, locked, onClose, onUnlock, price }: { day: TaekilDayDto | null; locked: boolean; onClose: () => void; onUnlock: () => void; price?: string }) {
  const groups = day?.reasons
    ? ([
        ['good', t('taekil.result.reasonsGood')],
        ['bad', t('taekil.result.reasonsBad')],
        ['info', t('taekil.result.reasonsInfo')],
      ] as const).map(([tone, title]) => ({ tone, title, items: day.reasons!.filter((r) => r.tone === tone) }))
    : [];
  return (
    <BottomSheet
      open={day !== null}
      onClose={onClose}
      title={
        day && (
          <span className="flex items-center gap-2">
            {day.rank && <RankSeal rank={day.rank} />}
            {dateKo(day.date)}
            <span className="font-serif text-ink-3">{day.ganzhi.hanja}일</span>
          </span>
        )
      }
    >
      {day && (
        <div className="pb-4">
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <GradeBadge day={day} />
            {day.score !== null && <span className="tabular">{t('taekil.result.score', { score: day.score })}</span>}
            {day.officer && <span>· {t('taekil.result.officer', { name: day.officer.name, hanja: day.officer.hanja })}</span>}
            {day.tianShen && <span>· {day.tianShen.yellow ? '황도' : '흑도'}({day.tianShen.name})</span>}
            <span className="text-ink-3">· {lunarText(day)}</span>
          </div>
          {locked ? (
            <div className="mt-5 rounded-2xl border border-gold/40 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-gold">
                <Lock className="size-4" aria-hidden />
                {t('taekil.paywall.lockTitle')}
              </p>
              <p className="mt-2 text-sm text-ink-2">{t('taekil.result.lockedDay')}</p>
              <Button block className="mt-4" onClick={onUnlock}>
                {price ? t('taekil.paywall.cta', { price }) : t('taekil.paywall.ctaNoPrice')}
              </Button>
            </div>
          ) : (
            <>
              {day.summary && <p className="mt-4 text-[15px] font-medium leading-relaxed">{day.summary}</p>}
              {day.goodHours && day.goodHours.length > 0 && (
                <div className="mt-4 rounded-xl bg-subtle p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-3">
                    <Clock className="size-3.5" aria-hidden />
                    {t('taekil.result.goodHours')}
                  </p>
                  <p className="mt-1 text-sm">{day.goodHours.join(' · ')}</p>
                </div>
              )}
              {day.dropReason && (
                <div className="mt-4 rounded-xl bg-subtle p-3">
                  <p className="text-xs font-semibold text-ink-3">{t('taekil.result.dropReason')}</p>
                  <p className="mt-1 text-sm leading-relaxed">{day.dropReason}</p>
                </div>
              )}
              {groups
                .filter((g) => g.items.length > 0)
                .map((g) => (
                  <section key={g.tone} className="mt-5">
                    <h3 className={cx('text-sm font-semibold', g.tone === 'good' ? 'text-success' : g.tone === 'bad' ? 'text-danger' : 'text-ink-3')}>{g.title}</h3>
                    <ul className="mt-2 space-y-3">
                      {g.items.map((r) => (
                        <li key={r.label} className="text-sm leading-relaxed">
                          <p className="flex items-center gap-2 font-semibold">
                            {r.label}
                            {r.weight !== 0 && <span className="tabular text-xs font-normal text-ink-3">{r.weight > 0 ? `+${r.weight}` : r.weight}</span>}
                            {r.excludes && <Badge>피하는 날</Badge>}
                          </p>
                          <p className="mt-0.5 text-ink-2">{r.text}</p>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
            </>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

function TopCards({ r, onOpen }: { r: TaekilResultDto; onOpen: (date: string) => void }) {
  const byDate = new Map(r.days.map((d) => [d.date, d]));
  if (r.top.length === 0) return <p className="mt-3 rounded-2xl bg-subtle p-4 text-[15px] text-ink-2">{t('taekil.result.topEmpty')}</p>;
  return (
    <ol className="mt-3 grid gap-3 lg:grid-cols-3">
      {r.top.map((date) => {
        const d = byDate.get(date)!;
        return (
          <li key={date}>
            <button type="button" onClick={() => onOpen(date)} className="flex h-full w-full flex-col rounded-2xl border border-line bg-surface p-4 text-left" aria-label={`${t('taekil.result.rank', { rank: d.rank! })} ${dateKo(date)} ${d.gradeLabel}`}>
              <span className="flex items-center gap-2">
                <RankSeal rank={d.rank!} className="size-6 text-xs" />
                <span className="text-xs font-semibold text-ink-3">{t('taekil.result.rank', { rank: d.rank! })}</span>
              </span>
              <span className="mt-2 font-serif text-xl font-semibold">{dateKo(date)}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-3">
                <span className="font-serif">{d.ganzhi.hanja}일</span>
                <span>{lunarText(d)}</span>
                <GradeBadge day={d} />
              </span>
              {r.locked ? (
                <span className="mt-3 flex items-center gap-1.5 text-xs text-ink-3">
                  <Lock className="size-3.5" aria-hidden />
                  {t('taekil.result.lockedDay')}
                </span>
              ) : (
                <>
                  <span className="mt-3 text-sm leading-relaxed text-ink-2">{d.summary}</span>
                  {d.goodHours && d.goodHours.length > 0 && (
                    <span className="mt-2 flex items-center gap-1.5 text-xs text-ink-3">
                      <Clock className="size-3.5" aria-hidden />
                      {d.goodHours.join(' · ')}
                    </span>
                  )}
                </>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function DayList({ r, onOpen }: { r: TaekilResultDto; onOpen: (date: string) => void }) {
  const [sort, setSort] = useState<'rank' | 'date'>('rank');
  const [limit, setLimit] = useState(20);
  const days = useMemo(() => {
    if (sort === 'date') return r.days;
    const rankOf = (d: TaekilDayDto) => d.rank ?? 99;
    return [...r.days].sort((a, b) => rankOf(a) - rankOf(b) || GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade) || (b.score ?? 0) - (a.score ?? 0) || (a.date < b.date ? -1 : 1));
  }, [r.days, sort]);
  return (
    <div>
      <div className="flex gap-2">
        <Chip active={sort === 'rank'} onClick={() => setSort('rank')}>
          {t('taekil.result.sortRank')}
        </Chip>
        <Chip active={sort === 'date'} onClick={() => setSort('date')}>
          {t('taekil.result.sortDate')}
        </Chip>
      </div>
      <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface" aria-label={t('taekil.result.allDays')}>
        {days.slice(0, limit).map((d) => (
          <li key={d.date}>
            <button type="button" onClick={() => onOpen(d.date)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
              <span className="w-28 shrink-0">
                <span className="block font-semibold tabular">{dateKo(d.date)}</span>
                <span className="block text-xs text-ink-3">
                  <span className="font-serif">{d.ganzhi.hanja}</span> · {lunarText(d)}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <GradeBadge day={d} />
                  {d.rank && <RankSeal rank={d.rank} />}
                  {d.score !== null && <span className="tabular text-xs text-ink-3">{d.score}점</span>}
                </span>
                {(d.summary || d.dropReason) && <span className="mt-1 block text-sm leading-snug text-ink-2">{d.rank ? d.summary : (d.dropReason ?? d.summary)}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {days.length > limit && (
        <Button variant="secondary" block className="mt-3" onClick={() => setLimit(days.length)}>
          {t('taekil.result.more', { count: days.length - limit })}
        </Button>
      )}
    </div>
  );
}

function SectionCard({ s, onUnlock, price }: { s: ReadingSection; onUnlock: () => void; price?: string }) {
  return (
    <section id={`sec-${s.key}`} className="border-t border-line py-8 first:border-t-0">
      <h2 className="font-serif text-[22px] font-semibold leading-snug">{s.title}</h2>
      {s.summary && <p className="mt-2 text-[15px] font-medium leading-relaxed text-ink-2">{s.summary}</p>}
      {s.paragraphs.length > 0 && (
        <div className={cx('prose-reading mt-4', s.locked && 'fade-out-bottom max-h-32 overflow-hidden')}>
          {s.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}
      {s.locked && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold/40 bg-surface p-4" aria-label={t('a11y.lockedSection')}>
          <p className="flex items-center gap-2 text-sm font-semibold text-gold">
            <Lock className="size-4" aria-hidden />
            {t('taekil.paywall.lockTitle')}
          </p>
          <Button size="sm" onClick={onUnlock}>
            {price ? t('taekil.paywall.cta', { price }) : t('taekil.paywall.ctaNoPrice')}
          </Button>
        </div>
      )}
    </section>
  );
}

/** 택일 결과 (/taekil/r/:id) — 무료: 등급·Top 3 날짜 / 상세: 근거·빠진 이유·조언 */
export function TaekilResultPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const gate = useSessionGate();
  const token = useSession((s) => s.accessToken);
  const purchase = usePurchase();
  const { data: products } = useProducts();
  const [paywall, setPaywall] = useState(false);
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [openDate, setOpenDate] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['taekil', id], queryFn: () => api.taekilGet(id!), enabled: Boolean(id && token) });
  const r = q.data;
  const product = products?.find((p) => p.id === r?.productId);
  const price = product ? won(product.price) : undefined;
  const openDay = r?.days.find((d) => d.date === openDate) ?? null;

  const unlock = () => {
    setOpenDate(null);
    setPaywall(true);
  };
  const onPurchase = async (p: ProductDto) => {
    await purchase({ product: p, readingId: r!.id, returnTo: `/taekil/r/${r!.id}` });
  };

  return (
    <div className="min-h-page pb-16">
      <PageHeader
        left={
          <IconButton label={t('common.back')} onClick={() => navigate('/taekil')}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
        title={r ? `${r.purposeLabel} 택일` : t('taekil.meta.navLabel')}
        width="wide"
      />
      <Page width="wide">
        {gate.failed && <SessionGateError onRetry={gate.retry} />}
        {(q.isLoading || (!token && !q.error)) && <Spinner />}
        {q.error && (
          <ErrorState
            title={q.error instanceof ApiError && q.error.status === 404 ? t('taekil.error.notFound') : t('taekil.error.load')}
            onRetry={q.error instanceof ApiError && q.error.status === 404 ? undefined : () => q.refetch()}
          />
        )}
        {r && (
          <div className="animate-fade">
            <section className="pt-4">
              <p className="text-sm font-semibold text-ink-3">{t('taekil.result.eyebrow', { name: r.partnerName ? `${r.profileName}·${r.partnerName}` : r.profileName, purpose: r.purposeLabel })}</p>
              <h1 className="mt-2 font-serif text-[26px] font-semibold leading-snug lg:text-[32px]">{r.headline}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-3">
                <span>{r.mode === 'range' ? t('taekil.result.period', { from: dateShort(r.from), to: dateShort(r.to), count: r.days.length }) : t('taekil.result.periodDates', { count: r.days.length })}</span>
                <span aria-hidden>·</span>
                <span>
                  {t('taekil.result.basisLabel')} <span className="font-serif">{r.basis}</span>
                </span>
                {r.generator === 'ai' && <Badge tone="gold">{t('result.aiBadge')}</Badge>}
              </div>
            </section>

            <section className="mt-8" aria-labelledby="tk-top">
              <h2 id="tk-top" className="text-lg font-semibold">
                {t('taekil.result.topTitle')}
              </h2>
              <TopCards r={r} onOpen={setOpenDate} />
            </section>

            {r.locked && (
              <Card className="mt-6 border-gold/40">
                <p className="flex items-center gap-2 font-semibold text-gold">
                  <Lock className="size-4" aria-hidden />
                  {t('taekil.paywall.lockTitle')}
                </p>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{t('taekil.paywall.lockBody')}</p>
                <p className="mt-2 text-xs text-ink-3">{t('taekil.paywall.freeIncluded')}</p>
                <Button block className="mt-4 lg:w-auto lg:px-10" onClick={unlock}>
                  {price ? t('taekil.paywall.cta', { price }) : t('taekil.paywall.ctaNoPrice')}
                </Button>
              </Card>
            )}

            <ul className="mt-8 flex flex-wrap gap-2 text-sm" aria-label="등급별 날짜 수">
              {GRADE_ORDER.map((g) => (
                <li key={g} className="inline-flex items-center gap-1.5 rounded-full bg-subtle px-3 py-1.5">
                  <span aria-hidden>{GRADE_STYLE[g].mark}</span>
                  {GRADE_STYLE[g].label} <b className="tabular">{r.counts[g]}일</b>
                </li>
              ))}
            </ul>

            <div className="mt-4 lg:hidden">
              <Segmented<'calendar' | 'list'>
                name={t('taekil.result.viewLabel')}
                value={view}
                onChange={setView}
                options={[
                  { value: 'calendar', label: t('taekil.result.viewCalendar') },
                  { value: 'list', label: t('taekil.result.viewList') },
                ]}
              />
            </div>
            <div className="mt-5 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start lg:gap-10">
              <div className={cx(view !== 'calendar' && 'hidden lg:block', 'lg:sticky lg:top-[calc(var(--nav-h)+1.5rem)]')}>
                <GradeCalendar days={r.days} selected={openDate} onSelect={setOpenDate} />
              </div>
              <div className={cx(view !== 'list' && 'hidden lg:block')}>
                <DayList r={r} onOpen={setOpenDate} />
              </div>
            </div>

            <div className="mt-10 lg:max-w-3xl">
              {r.sections.map((s) => (
                <SectionCard key={s.key} s={s} onUnlock={unlock} price={price} />
              ))}
            </div>

            <div className="mt-6 grid grid-cols-1 gap-2 lg:max-w-sm">
              <Link to="/taekil" className="inline-flex h-12 items-center justify-center rounded-full bg-action-2 font-semibold">
                {t('taekil.result.again')}
              </Link>
            </div>
            <p className="mt-8 text-xs leading-relaxed text-ink-3">{r.disclaimer}</p>
            {r.generator === 'ai' && <p className="mt-1 text-xs leading-relaxed text-ink-3">{t('taekil.result.aiNotice')}</p>}
          </div>
        )}
      </Page>

      <DaySheet day={openDay} locked={Boolean(r?.locked)} onClose={() => setOpenDate(null)} onUnlock={unlock} price={price} />
      {r && (
        <PaywallSheet
          open={paywall}
          onClose={() => setPaywall(false)}
          productIds={[r.productId]}
          title={t('taekil.paywall.sheetTitle', { purpose: r.purposeLabel })}
          subtitle={t('taekil.paywall.sheetSubtitle')}
          benefits={[t('taekil.paywall.benefitTop'), t('taekil.paywall.benefitDays'), t('taekil.paywall.benefitAdvice'), t('taekil.paywall.benefitRevisit')]}
          onPurchase={onPurchase}
        />
      )}
    </div>
  );
}
