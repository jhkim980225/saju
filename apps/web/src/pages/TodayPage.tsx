import { useQueries, useQuery } from '@tanstack/react-query';
import type { DailyFortuneDto, ProfileDto } from '@saju/shared';
import { Share2, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AdSlot } from '@/components/AdSlot';
import { Page } from '@/components/AppShell';
import { BottomSheet } from '@/components/BottomSheet';
import { ShareSheet } from '@/components/ShareSheet';
import { TodayTarotCard } from '@/components/TodayTarotCard';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, ScoreBar, Spinner, cx } from '@/components/ui';
import { useProfiles } from '@/hooks/queries';
import { SessionGateError, useSessionGate } from '@/hooks/useSessionGate';
import { api } from '@/lib/api';
import { track } from '@/lib/analytics';
import type { BirthDraft } from '@/lib/birth';
import { t } from '@/lib/copy';
import { isoDate, targetFortuneYear, todayKst, weekdayOf } from '@/lib/format';
import { useSession } from '@/lib/session';
import { STORAGE_KEYS, storage } from '@/lib/storage';

const WEEK = ['월', '화', '수', '목', '금', '토', '일'];

function weekDates(todayIso: string): string[] {
  const [y, m, d] = todayIso.split('-').map(Number) as [number, number, number];
  const base = new Date(y, m - 1, d);
  const dow = (base.getDay() + 6) % 7; // 월=0
  return Array.from({ length: 7 }, (_, i) => isoDate(new Date(y, m - 1, d - dow + i)));
}

export function TodayPage() {
  const navigate = useNavigate();
  const user = useSession((s) => s.user);
  const today = todayKst();
  const [date, setDate] = useState(today.iso);
  const [pickProfile, setPickProfile] = useState(false);
  const gate = useSessionGate();
  const profiles = useProfiles();
  const draft = storage.getJSON<BirthDraft>(STORAGE_KEYS.birthDraft);
  const list = profiles.data ?? [];
  const activeId = storage.get(STORAGE_KEYS.activeProfile);
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  const profile: ProfileDto | undefined = list.find((p) => p.id === (profileId ?? activeId)) ?? list.find((p) => p.isPrimary) ?? list[0];
  const useBirth = !profile && Boolean(draft) && profiles.isFetched;

  const fetchDay = (d: string): Promise<DailyFortuneDto> =>
    profile ? (api.dailyByProfile(profile.id, d) as Promise<DailyFortuneDto>) : api.dailyByBirth(draft!.dto, d);
  const enabled = Boolean(profile) || useBirth;
  const daily = useQuery({ queryKey: ['daily', profile?.id ?? 'draft', date, user?.id], queryFn: () => fetchDay(date), enabled });
  const dates = useMemo(() => weekDates(today.iso), [today.iso]);
  const week = useQueries({ queries: dates.map((d) => ({ queryKey: ['daily', profile?.id ?? 'draft', d, user?.id], queryFn: () => fetchDay(d), enabled, staleTime: 10 * 60_000 })) });

  useEffect(() => {
    if (daily.data) track('daily_viewed', { grade: daily.data.evaluation.grade });
  }, [daily.data]);

  const d = daily.data;
  const name = profile?.name ?? draft?.form.name ?? t('common.me');
  const [, mm, dd] = date.split('-').map(Number) as [number, number, number];

  const [shareOpen, setShareOpen] = useState(false);

  const top = d ? [...d.categories].sort((a, b) => b.score - a.score) : [];

  return (
    <div className="min-h-page">
      <PageHeader
        title={
          <span>
            {t('today.dateTitle', { month: mm, day: dd, weekday: weekdayOf(date) })}
            {d && <span className="ml-1 font-serif text-ink-3">· {t('today.dayPillar', { ganji: d.dayPillar.hanja })}</span>}
          </span>
        }
        right={
          list.length > 0 ? (
            <button type="button" onClick={() => setPickProfile(true)} className="rounded-full border border-line-strong px-3 py-1.5 text-sm">
              {profile?.name ?? '선택'} ▾
            </button>
          ) : undefined
        }
        width="wide"
      />
      <Page width="wide" className="pb-10">
        {gate.failed && <SessionGateError onRetry={gate.retry} />}
        {profiles.isLoading && <Spinner />}
        {profiles.isFetched && !profile && !draft && (
          <EmptyState title={t('today.noProfileTitle')} body={t('today.noProfileBody')} action={<Button onClick={() => navigate('/profiles/new?save=1&relation=self&next=/today')}>{t('today.noProfileCta')}</Button>} />
        )}
        {useBirth && (
          <p className="mt-2 rounded-xl bg-subtle p-3 text-sm text-ink-2">
            입력한 생년월일로 보고 있어요.{' '}
            <Link to="/result" className="font-semibold underline">
              결과에서 저장
            </Link>
            하면 매일 바로 볼 수 있어요.
          </p>
        )}
        {daily.error && <ErrorState title={t('error.server.title')} onRetry={() => daily.refetch()} />}
        {enabled && daily.isLoading && <Spinner />}

        {d && (
          <div className="animate-fade lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-10 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div>
              <section className="pt-4">
                <p className="text-sm font-semibold text-ink-3">{t('today.headlineLabel')}</p>
                <h2 className="mt-2 font-serif text-[26px] font-semibold leading-snug lg:text-[32px]">{d.headline}</h2>
                <div className="mt-3 flex items-center gap-2">
                  <Badge tone={d.evaluation.grade === 'great' || d.evaluation.grade === 'good' ? 'gold' : 'default'}>{d.gradeLabel}</Badge>
                  <span className="tabular text-sm text-ink-3">총운 {d.evaluation.scores.total}점</span>
                </div>
                <p className="prose-reading mt-4 text-[17px] leading-relaxed">{d.message}</p>
              </section>

              {top.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2 text-sm">
                  <span className="rounded-full bg-subtle px-3 py-1.5">
                    <b className="mr-1">{t('today.actions.boost')}</b>
                    {top[0]!.label}
                  </span>
                  <span className="rounded-full bg-subtle px-3 py-1.5">
                    <b className="mr-1">{t('today.actions.watch')}</b>
                    {top[top.length - 1]!.label}
                  </span>
                </div>
              )}

              <Card className="mt-6">
                <h3 className="font-semibold">{t('today.weekFlowTitle')}</h3>
                <ol className="mt-4 grid grid-cols-7 gap-1 text-center">
                  {dates.map((iso, i) => {
                    const w = week[i]?.data;
                    const score = w?.evaluation.scores.total ?? 0;
                    return (
                      <li key={iso}>
                        <button type="button" onClick={() => setDate(iso)} className={cx('flex w-full flex-col items-center gap-1.5 rounded-xl py-2', iso === date && 'bg-subtle')} aria-label={`${WEEK[i]}요일 ${score}점`}>
                          <span className={cx('text-xs', iso === today.iso ? 'font-bold text-ink' : 'text-ink-3')}>{WEEK[i]}</span>
                          <span className="relative grid size-7 place-items-center">
                            <span className="absolute inset-0 rounded-full border border-line-strong" />
                            <span className="rounded-full bg-action transition-all" style={{ width: `${Math.max(6, (score / 100) * 28)}px`, height: `${Math.max(6, (score / 100) * 28)}px`, opacity: w ? 1 : 0.15 }} />
                          </span>
                          <span className="tabular text-[11px] text-ink-3">{w ? score : ''}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </Card>

              <Card className="mt-4">
                <ul className="space-y-4">
                  {d.categories.map((c) => (
                    <li key={c.key}>
                      <div className="mb-1.5 flex items-center justify-between text-[15px] font-semibold">{c.label}</div>
                      <ScoreBar score={c.score} label={c.label} />
                      <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{c.message}</p>
                    </li>
                  ))}
                </ul>
              </Card>

              <TodayTarotCard />
            </div>

            <div className="lg:pt-4">
              <Card className="mt-4 lg:mt-0">
                <h3 className="flex items-center gap-2 font-semibold">
                  <Sparkles className="size-4 text-gold" aria-hidden />
                  오늘의 조언
                </h3>
                <p className="mt-2 text-[15px] leading-relaxed">{d.advice}</p>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  {[
                    ['행운의 색', d.lucky.color],
                    ['행운의 숫자', String(d.lucky.number)],
                    ['좋은 방향', d.lucky.direction],
                    ['좋은 시간', d.lucky.time],
                    ['행운 아이템', d.lucky.item],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-subtle p-3">
                      <dt className="text-xs text-ink-3">{k}</dt>
                      <dd className="mt-1 font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
              </Card>

              <Card className="mt-4">
                <h3 className="font-semibold">{t('today.whyCardTitle')}</h3>
                <p className="mt-2 text-sm text-ink-2">
                  {t('today.whyCardBody', { dayGanji: `${d.dayPillar.hangul}(${d.dayPillar.hanja})`, dayMaster: d.evaluation.pillar.stemTenGod })}
                </p>
                <p className="mt-2 text-sm text-ink-2">
                  오늘의 천간은 나에게 <b>{d.evaluation.pillar.stemTenGod}</b>, 지지는 <b>{d.evaluation.pillar.branchTenGod}</b>의 기운이고, 일간은 오늘 &lsquo;{d.evaluation.pillar.twelveStage}&rsquo;의 자리에 있어요.
                </p>
              </Card>

              <div className="mt-6">
                <AdSlot placement="home_infeed" />
              </div>

              <div className="mt-6 grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => setShareOpen(true)}>
                  <Share2 className="size-4" aria-hidden />
                  {t('common.share')}
                </Button>
                {profile ? (
                  <Link to={`/yearly/${profile.id}`} className="inline-flex h-12 items-center justify-center rounded-full bg-action-2 font-semibold">
                    {targetFortuneYear()} 신년운세
                  </Link>
                ) : (
                  <Link to="/input" className="inline-flex h-12 items-center justify-center rounded-full bg-action-2 font-semibold">
                    내 사주 보기
                  </Link>
                )}
              </div>
              <p className="mt-6 text-xs text-ink-3">{t('disclaimer.short')}</p>
            </div>
          </div>
        )}
      </Page>

      {d && (
        <ShareSheet
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          payload={{
            title: t('share.kakaoToday.title', { name, headline: d.headline }),
            text: `${d.shareText} — ${t('share.kakaoToday.description')}`,
            url: `${window.location.origin}/today`,
            buttons: [{ title: t('share.kakaoToday.buttonPrimary'), url: `${window.location.origin}/today` }],
          }}
        />
      )}
      <BottomSheet open={pickProfile} onClose={() => setPickProfile(false)} title={t('today.profileSwitch')}>
        <ul className="divide-y divide-line">
          {list.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={cx('flex w-full items-center justify-between py-3.5 text-left', p.id === profile?.id && 'font-semibold')}
                onClick={() => {
                  setProfileId(p.id);
                  storage.set(STORAGE_KEYS.activeProfile, p.id);
                  setPickProfile(false);
                }}
              >
                {p.name}
                <span className="font-serif text-sm text-ink-3">{p.dayPillar}일주</span>
              </button>
            </li>
          ))}
        </ul>
        <Button variant="secondary" block className="mt-3" onClick={() => navigate('/profiles/new?save=1&relation=family&next=/today')}>
          {t('my.addProfile')}
        </Button>
      </BottomSheet>
    </div>
  );
}
