import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TAEKIL_PURPOSE_IDS, type TaekilPurposeId } from '@saju/shared';
import { ArrowLeft, ChevronRight, Lock } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Page } from '@/components/AppShell';
import { DatePickerCalendar } from '@/components/TaekilCalendar';
import { Badge, Button, Card, Chip, EmptyState, IconButton, PageHeader, Segmented, Spinner, cx } from '@/components/ui';
import { useProfiles } from '@/hooks/queries';
import { SessionGateError, useSessionGate } from '@/hooks/useSessionGate';
import { ApiError, api } from '@/lib/api';
import { t } from '@/lib/copy';
import { todayKst } from '@/lib/format';
import { useSession } from '@/lib/session';
import { addDaysIso, dateKo, dateShort, diffDays, monthOf, monthsLater, nextRange, selectableRange, selectionError, toggleDate, type MonthRef } from '@/lib/taekil';

const isPurpose = (v: string | null): v is TaekilPurposeId => Boolean(v && (TAEKIL_PURPOSE_IDS as readonly string[]).includes(v));

/** 택일 — 목적·사주·날짜를 고르면 무료 미리보기 결과로 이동 (/taekil) */
export function TaekilPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const gate = useSessionGate();
  const token = useSession((s) => s.accessToken);
  const profiles = useProfiles();
  const [params] = useSearchParams();
  const today = todayKst().iso;
  const { min, max } = selectableRange(today);
  // 만세력 등에서 ?date= 로 들어오면 그날부터 한 달
  const start = (() => {
    const d = params.get('date');
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today && d <= max ? d : addDaysIso(today, 1);
  })();

  const [purpose, setPurpose] = useState<TaekilPurposeId>(isPurpose(params.get('purpose')) ? (params.get('purpose') as TaekilPurposeId) : 'move');
  const [profileId, setProfileId] = useState<string | null>(null);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [mode, setMode] = useState<'range' | 'dates'>('range');
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: start, to: monthsLater(start, 1) });
  const [dates, setDates] = useState<string[]>([]);
  const [month, setMonth] = useState<MonthRef>(monthOf(start));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = profiles.data ?? [];
  const profile = list.find((p) => p.id === profileId) ?? list.find((p) => p.isPrimary) ?? list[0];
  const partners = list.filter((p) => p.id !== profile?.id);
  const recent = useQuery({ queryKey: ['taekil', 'list'], queryFn: api.taekilList, enabled: Boolean(token) });

  const selection = mode === 'range' ? { mode, ...range } : { mode, dates };
  const invalid = selectionError(selection, today);

  const quick = (months: number) => {
    const from = addDaysIso(today, 1);
    setMode('range');
    setRange({ from, to: monthsLater(from, months) });
    setMonth(monthOf(from));
  };

  const submit = async () => {
    if (!profile || invalid) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.taekilCreate({
        profileId: profile.id,
        purpose,
        ...(purpose === 'wedding' && partnerId ? { partnerProfileId: partnerId } : {}),
        ...(mode === 'range' ? { from: range.from!, to: range.to! } : { dates }),
      });
      qc.setQueryData(['taekil', r.id], r);
      void qc.invalidateQueries({ queryKey: ['taekil', 'list'] });
      navigate(`/taekil/r/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('error.server.title'));
    } finally {
      setBusy(false);
    }
  };

  const summary =
    mode === 'range'
      ? range.from && range.to
        ? t('taekil.home.rangeSummary', { from: dateKo(range.from), to: dateKo(range.to), count: diffDays(range.from, range.to) + 1 })
        : range.from
          ? t('taekil.home.rangeStartOnly', { from: dateKo(range.from) })
          : ''
      : t('taekil.home.datesSummary', { count: dates.length });

  return (
    <div className="min-h-page">
      <PageHeader
        left={
          <IconButton label={t('common.back')} onClick={() => navigate(-1)}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
        title={t('taekil.meta.title')}
        width="wide"
      />
      <Page width="wide" className="pb-16">
        {gate.failed && <SessionGateError onRetry={gate.retry} />}
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2 lg:text-base">{t('taekil.home.intro')}</p>
        {profiles.isLoading && <Spinner />}
        {profiles.isFetched && list.length === 0 && (
          <EmptyState
            title={t('taekil.home.noProfileTitle')}
            body={t('taekil.home.noProfileBody')}
            action={<Button onClick={() => navigate(`/profiles/new?save=1&relation=self&next=${encodeURIComponent('/taekil')}`)}>{t('taekil.home.noProfileCta')}</Button>}
          />
        )}

        {profile && (
          <div className="mt-6 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-10">
            <div className="space-y-8">
              <section aria-labelledby="tk-purpose">
                <h2 id="tk-purpose" className="text-lg font-semibold">
                  {t('taekil.home.purposeTitle')}
                </h2>
                <div role="radiogroup" aria-labelledby="tk-purpose" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {TAEKIL_PURPOSE_IDS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={purpose === p}
                      onClick={() => setPurpose(p)}
                      className={cx('rounded-2xl border p-3.5 text-left transition-colors', purpose === p ? 'border-ink bg-surface' : 'border-line bg-canvas')}
                    >
                      <span className="block font-semibold">{t(`taekil.purposes.${p}.label`)}</span>
                      <span className="mt-0.5 block text-xs text-ink-3">{t(`taekil.purposes.${p}.hint`)}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section aria-labelledby="tk-profile">
                <h2 id="tk-profile" className="text-lg font-semibold">
                  {t('taekil.home.profileTitle')}
                </h2>
                <div className="no-scrollbar -mx-5 mt-3 flex gap-2 overflow-x-auto px-5 lg:mx-0 lg:flex-wrap lg:px-0">
                  {list.map((p) => (
                    <Chip key={p.id} active={p.id === profile.id} onClick={() => setProfileId(p.id)}>
                      {p.name}
                      <span className="ml-1 font-serif text-xs opacity-70">{p.dayPillar}</span>
                    </Chip>
                  ))}
                </div>
                {purpose === 'wedding' && (
                  <div className="mt-5">
                    <h3 className="text-[15px] font-semibold">{t('taekil.home.partnerTitle')}</h3>
                    <p className="mt-1 text-sm text-ink-3">{t('taekil.home.partnerHint')}</p>
                    <div className="no-scrollbar -mx-5 mt-3 flex gap-2 overflow-x-auto px-5 lg:mx-0 lg:flex-wrap lg:px-0">
                      <Chip active={!partnerId || !partners.some((p) => p.id === partnerId)} onClick={() => setPartnerId(null)}>
                        {t('taekil.home.partnerNone')}
                      </Chip>
                      {partners.map((p) => (
                        <Chip key={p.id} active={p.id === partnerId} onClick={() => setPartnerId(p.id)}>
                          {p.name}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </div>

            <section aria-labelledby="tk-date" className="mt-8 lg:mt-0">
              <Card className="lg:p-6">
                <h2 id="tk-date" className="text-lg font-semibold">
                  {t('taekil.home.dateTitle')}
                </h2>
                <div className="mt-3">
                  <Segmented<'range' | 'dates'>
                    name={t('taekil.home.dateTitle')}
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: 'range', label: t('taekil.home.modeRange') },
                      { value: 'dates', label: t('taekil.home.modeDates') },
                    ]}
                  />
                </div>
                <p className="mt-3 text-sm text-ink-3">{mode === 'range' ? t('taekil.home.rangeHint') : t('taekil.home.datesHint')}</p>
                {mode === 'range' && (
                  <div className="no-scrollbar -mx-5 mt-3 flex gap-2 overflow-x-auto px-5 lg:mx-0 lg:px-0">
                    {[1, 2, 3].map((n) => (
                      <Chip key={n} onClick={() => quick(n)}>
                        {t(`taekil.home.quick${n}`)}
                      </Chip>
                    ))}
                  </div>
                )}
                <div className="mt-4">
                  <DatePickerCalendar
                    month={month}
                    onMonthChange={setMonth}
                    min={min}
                    max={max}
                    today={today}
                    isSelected={(iso) => (mode === 'range' ? iso === range.from || iso === range.to : dates.includes(iso))}
                    isInRange={mode === 'range' ? (iso) => Boolean(range.from && range.to && iso > range.from && iso < range.to) : undefined}
                    onTap={(iso) => (mode === 'range' ? setRange((r) => nextRange(r, iso)) : setDates((ds) => toggleDate(ds, iso)))}
                  />
                </div>
                <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                  <p className="font-medium" aria-live="polite">
                    {summary}
                  </p>
                  {(mode === 'dates' ? dates.length > 0 : Boolean(range.from)) && (
                    <button type="button" className="shrink-0 text-ink-3 underline" onClick={() => (mode === 'dates' ? setDates([]) : setRange({ from: null, to: null }))}>
                      {t('taekil.home.clear')}
                    </button>
                  )}
                </div>
                {mode === 'dates' && dates.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5 text-xs text-ink-2" aria-label={t('taekil.home.datesSummary', { count: dates.length })}>
                    {dates.map((d) => (
                      <li key={d} className="rounded-full bg-subtle px-2.5 py-1 tabular">
                        {dateShort(d)}
                      </li>
                    ))}
                  </ul>
                )}
                {error && (
                  <p role="alert" className="mt-4 rounded-xl bg-subtle p-3 text-sm text-danger">
                    {error}
                  </p>
                )}
                <Button block size="lg" className="mt-5" disabled={Boolean(invalid)} loading={busy} onClick={submit}>
                  {busy ? t('taekil.home.submitting') : t('taekil.home.submit')}
                </Button>
                <p className="mt-2 text-center text-xs text-ink-3">{invalid && (mode === 'dates' ? dates.length > 0 : true) ? invalid : t('taekil.home.freeNote')}</p>
              </Card>
            </section>
          </div>
        )}

        {recent.data && recent.data.length > 0 && (
          <section className="mt-12" aria-labelledby="tk-recent">
            <h2 id="tk-recent" className="text-lg font-semibold">
              {t('taekil.home.recentTitle')}
            </h2>
            <ul className="mt-3 space-y-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0">
              {recent.data.slice(0, 6).map((r) => (
                <li key={r.id}>
                  <Link to={`/taekil/r/${r.id}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge>{r.purposeLabel}</Badge>
                        {r.locked && <Lock className="size-3.5 text-ink-3" aria-label={t('taekil.paywall.ctaNoPrice')} />}
                      </div>
                      <p className="mt-1.5 truncate font-semibold">{r.title}</p>
                      <p className="text-xs text-ink-3">{r.top[0] ? `1위 ${dateKo(r.top[0])}` : `${dateShort(r.from)} ~ ${dateShort(r.to)}`}</p>
                    </div>
                    <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="mt-10 text-xs text-ink-3">{t('disclaimer.standard')}</p>
      </Page>
    </div>
  );
}
