/**
 * 별자리 운세 (무료 · 공개 SEO 페이지)
 *  /horoscope                 12별자리 오늘 한눈에 + 생일로 별자리 찾기 (내 별자리를 알면 내 별자리 페이지로)
 *  /horoscope/:sign/:period   별자리 하나의 오늘·내일·이번 주·이번 달·올해
 */
import { useQuery } from '@tanstack/react-query';
import { STAR_SIGNS, starSignBySlug, starSignDates, starSignOfBirthday, type FreeFortunePeriod, type StarSign } from '@saju/shared';
import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { AdSlot } from '@/components/AdSlot';
import { Page } from '@/components/AppShell';
import { CrossLink, FortuneMain, KeyDays, MethodNote, PeriodTabs, PersonalUpsell, PickerRow, ToneBadge } from '@/components/FreeFortune';
import { Card, ErrorState, PageHeader, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { PERIOD_TITLE, horoscopePath, parsePeriod, useOwnSigns } from '@/lib/freeFortune';
import { todayKst } from '@/lib/format';
import { usePageMeta } from '@/lib/pageMeta';
import { NotFoundPage } from './NotFoundPage';

const UPSELL = '별자리 운세는 같은 별자리라면 모두에게 같아요. 사주로 보면 태어난 시간까지 담은 나만의 하루 흐름을 볼 수 있어요.';
const BASIS_SHORT = '하늘을 열두 칸으로 나눠 내 별자리를 첫째 칸으로 세고, 오늘 달이 몇 번째 칸을 지나는지로 풀었어요. 칸마다 맡은 주제(돈·연애·일 …)가 달라요.';
const DISCLAIMER = '별자리 운세는 서양 점성술을 바탕으로 한 재미와 참고용 콘텐츠예요.';

export function HoroscopeHubPage() {
  const own = useOwnSigns();
  const today = todayKst();
  const overview = useQuery({ queryKey: ['horoscope', 'overview', 'today', today.iso], queryFn: () => api.horoscopeOverview('today', today.iso), staleTime: 10 * 60_000 });
  usePageMeta({
    title: '별자리 운세 — 12별자리 오늘의 운세 | 달빛사주',
    description: '양자리부터 물고기자리까지 열두 별자리의 오늘·내일·이번 주·이번 달·올해 운세. 생일로 내 별자리를 찾고, 달과 행성의 자리로 푼 근거까지 무료로 보여 드려요.',
    path: '/horoscope',
  });

  if (own.sign) return <Navigate to={horoscopePath(own.sign.slug)} replace />;
  if (own.loading) return <Spinner />;

  return (
    <div className="min-h-page">
      <PageHeader title="별자리 운세" width="wide" />
      <Page width="wide" className="pb-12">
        <section className="pt-4 lg:pt-2">
          <p className="text-sm font-semibold text-ink-3">
            {today.month}월 {today.day}일 {today.weekday}
          </p>
          <h2 className="mt-2 font-serif text-[26px] font-semibold leading-snug lg:text-[32px]">열두 별자리, 오늘은 어떤 흐름일까요</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{BASIS_SHORT}</p>
        </section>

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-10">
          <div>
            {/* 모바일은 찾기 도구를 목록보다 먼저, 데스크톱은 오른쪽 칸에 */}
            <div className="mt-6 lg:hidden">
              <BirthdayFinder />
            </div>
            {overview.isLoading && <Spinner />}
            {overview.error && <ErrorState title="운세를 불러오지 못했어요" onRetry={() => overview.refetch()} />}
            {overview.data && (
              <ul className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:gap-3">
                {overview.data.items.map((it) => (
                  <li key={it.sign.slug}>
                    <Link to={horoscopePath(it.sign.slug)} className="flex h-full gap-3 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong">
                      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-subtle font-serif text-2xl" aria-hidden>
                        {it.sign.glyph}
                      </span>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-semibold">{it.sign.name}</span>
                          <ToneBadge tone={it.tone} label={it.toneLabel} />
                        </span>
                        <span className="block text-xs text-ink-3">{it.sign.dates}</span>
                        <span className="mt-1 block text-[15px] leading-snug">{it.headline}</span>
                        <span className="mt-1 block text-xs text-ink-3">{it.reason}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-6">
              <AdSlot placement="web_content_mid" />
            </div>
          </div>
          <aside className="mt-6">
            <div className="hidden lg:block">
              <BirthdayFinder />
            </div>
            <CrossLink to="/zodiac" title="띠별 운세" body="태어난 해의 띠로 보는 열두 띠의 오늘" />
            <MethodNote basis={BASIS_SHORT} disclaimer={DISCLAIMER} />
          </aside>
        </div>
      </Page>
    </div>
  );
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const selectCls = 'h-12 w-full rounded-xl border border-line-strong bg-surface px-3 text-base text-ink';

/** 양력 생일(월·일) → 별자리 */
export function BirthdayFinder({ compact = false }: { compact?: boolean }) {
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const found = month && day ? starSignOfBirthday(Number(month), Number(day)) : null;
  return (
    <Card className={compact ? 'mt-6' : undefined}>
      <h3 className="font-semibold">생일로 내 별자리 찾기</h3>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-sm text-ink-2">
          태어난 달(양력)
          <select aria-label="태어난 달" className={`${selectCls} mt-1.5`} value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">월</option>
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {m}월
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-ink-2">
          태어난 날
          <select aria-label="태어난 날" className={`${selectCls} mt-1.5`} value={day} onChange={(e) => setDay(e.target.value)}>
            <option value="">일</option>
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {d}일
              </option>
            ))}
          </select>
        </label>
      </div>
      <div aria-live="polite">
        {month && day && !found && <p className="mt-3 text-sm text-danger">없는 날짜예요. 다시 확인해 주세요.</p>}
        {found && (
          <div className="mt-3 text-[15px] leading-relaxed">
            <p>
              {month}월 {day}일생은 <b>{found.sign.name}</b>예요 <span className="text-sm text-ink-3">({starSignDates(found.sign)})</span>
            </p>
            {found.isCusp && <p className="mt-1 text-sm text-ink-3">별자리가 바뀌는 날 무렵이라, 태어난 해와 시각에 따라 옆 별자리일 수도 있어요.</p>}
            <Link to={horoscopePath(found.sign.slug)} className="mt-3 inline-flex h-10 items-center rounded-full bg-action-2 px-4 text-sm font-semibold">
              {found.sign.name} 운세 보기
            </Link>
          </div>
        )}
      </div>
    </Card>
  );
}

export function HoroscopeDetailPage() {
  const params = useParams();
  const sign = starSignBySlug(params.sign);
  const period = parsePeriod(params.period);
  if (sign && !params.period) return <Navigate to={horoscopePath(sign.slug)} replace />;
  if (!sign || !period) return <NotFoundPage />;
  return <HoroscopeDetail sign={sign} period={period} />;
}

function HoroscopeDetail({ sign, period }: { sign: StarSign; period: FreeFortunePeriod }) {
  const own = useOwnSigns();
  const today = todayKst();
  const q = useQuery({ queryKey: ['horoscope', sign.slug, period, today.iso], queryFn: () => api.horoscope(sign.slug, period, today.iso), staleTime: 10 * 60_000 });
  const title = `${sign.name} ${PERIOD_TITLE[period]}`;
  usePageMeta({
    title: `${title} — 별자리 운세 | 달빛사주`,
    description: `${sign.name}(${starSignDates(sign)}) ${PERIOD_TITLE[period]}. 달·태양·목성·토성이 지나는 별자리가 ${sign.name}에서 몇 번째 자리인지로 풀었어요. 재미로 보는 무료 별자리 운세예요.`,
    path: horoscopePath(sign.slug, period),
  });
  const d = q.data;

  return (
    <div className="min-h-page">
      <PageHeader title={title} width="wide" />
      <Page width="wide" className="pb-12">
        <PickerRow
          label="별자리 고르기"
          items={STAR_SIGNS}
          current={sign.slug}
          own={own.sign?.slug ?? null}
          hrefOf={(s) => horoscopePath(s.slug, period)}
          glyphOf={(s) => s.glyph}
          nameOf={(s) => s.name.replace('자리', '')}
          ownLabel="내 별자리"
        />
        <PeriodTabs current={period} hrefOf={(p) => horoscopePath(sign.slug, p)} />

        {q.isLoading && <Spinner />}
        {q.error && <ErrorState title="운세를 불러오지 못했어요" body="잠시 후 다시 시도해 주세요." onRetry={() => q.refetch()} />}
        {d && (
          <div className="animate-fade lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-10">
            <div>
              <FortuneMain eyebrow={d.range.label} tone={d.tone} toneLabel={d.toneLabel} headline={d.headline} paragraphs={d.paragraphs} tip={d.tip} />
              <KeyDays days={d.keyDays} />
              <Card className="mt-6">
                <h3 className="font-semibold">하늘의 근거</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-3">내 별자리를 첫 번째 자리로 세어, 달·태양·행성이 지금 몇 번째 자리를 지나는지 적었어요. 자리마다 맡은 주제가 괄호 속에 있어요.</p>
                <ul className="mt-3 space-y-3">
                  {d.sky.map((s, i) => (
                    <li key={`${s.body}-${s.signName}-${i}`}>
                      <p className="text-[15px] font-semibold">
                        {s.bodyLabel} · {s.signName} <span className="font-normal text-ink-3">· {s.houseLabel}({s.houseTheme}) · {s.aspect}</span>
                      </p>
                      <p className="mt-0.5 text-sm leading-relaxed text-ink-2">{s.note}</p>
                    </li>
                  ))}
                </ul>
              </Card>
              <div className="mt-6">
                <AdSlot placement="web_content_mid" />
              </div>
            </div>

            <aside className="mt-8 lg:mt-6">
              <Card>
                <div className="flex items-center gap-3">
                  <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-subtle font-serif text-2xl" aria-hidden>
                    {sign.glyph}
                  </span>
                  <div>
                    <p className="font-semibold">
                      {sign.name} <span className="text-sm font-normal text-ink-3">{sign.en}</span>
                    </p>
                    <p className="text-sm text-ink-3">
                      {d.sign.dates} · {d.sign.elementLabel}의 별자리
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{d.trait}</p>
              </Card>
              <div className="mt-4">
                <PersonalUpsell body={UPSELL} hasProfile={Boolean(own.name)} />
              </div>
              <BirthdayFinder compact />
              <CrossLink to="/zodiac" title="띠별 운세" body="태어난 해의 띠로 보는 오늘·이번 주·올해" />
              <div className="mt-6">
                <AdSlot placement="result_bottom" />
              </div>
              <MethodNote basis={d.basisNote} disclaimer={d.disclaimer} />
            </aside>
          </div>
        )}
      </Page>
    </div>
  );
}
