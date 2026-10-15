/**
 * 띠별 운세 (무료 · 공개 SEO 페이지)
 *  /zodiac                    12띠 오늘 한눈에 + 태어난 해로 띠 찾기 (내 띠를 알면 내 띠 페이지로)
 *  /zodiac/:animal/:period    띠 하나의 오늘·내일·이번 주·이번 달·올해
 */
import { useQuery } from '@tanstack/react-query';
import { ZODIAC_ANIMALS, zodiacAnimalBySlug, type FreeFortunePeriod, type ZodiacAnimal } from '@saju/shared';
import { useId, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { AdSlot } from '@/components/AdSlot';
import { Page } from '@/components/AppShell';
import { CrossLink, FortuneMain, KeyDays, MethodNote, PeriodTabs, PersonalUpsell, PickerRow, ReasonCard, ToneBadge } from '@/components/FreeFortune';
import { Card, ErrorState, PageHeader, Spinner, TextInput } from '@/components/ui';
import { api } from '@/lib/api';
import { PERIOD_TITLE, animalOfYear, birthYearsOf, parsePeriod, useOwnSigns, zodiacPath } from '@/lib/freeFortune';
import { todayKst } from '@/lib/format';
import { usePageMeta } from '@/lib/pageMeta';
import { NotFoundPage } from './NotFoundPage';

const UPSELL = '띠별 운세는 같은 해에 태어난 모두에게 같아요. 태어난 날과 시간까지 넣으면 나에게만 맞춘 오늘의 운세를 매일 볼 수 있어요.';
const BASIS_SHORT = '옛 달력에서는 날마다 열두 띠 가운데 하나가 돌아가며 붙어요. 오늘 날의 띠가 내 띠와 손을 잡는지, 부딪치는지를 보고 풀었어요.';

export function ZodiacHubPage() {
  const own = useOwnSigns();
  const today = todayKst();
  const overview = useQuery({ queryKey: ['zodiac', 'overview', 'today', today.iso], queryFn: () => api.zodiacOverview('today', today.iso), staleTime: 10 * 60_000 });
  usePageMeta({
    title: '띠별 운세 — 12띠 오늘의 운세 | 달빛사주',
    description: '쥐띠부터 돼지띠까지 열두 띠의 오늘·내일·이번 주·이번 달·올해 운세. 그날의 띠와 내 띠가 잘 맞는지 푼 이유와 년생별 한 줄까지 무료로 보여 드려요.',
    path: '/zodiac',
  });

  // 내 띠를 알면 바로 내 띠 페이지로
  if (own.animal) return <Navigate to={zodiacPath(own.animal.slug)} replace />;
  if (own.loading) return <Spinner />;

  return (
    <div className="min-h-page">
      <PageHeader title="띠별 운세" width="wide" />
      <Page width="wide" className="pb-12">
        <section className="pt-4 lg:pt-2">
          <p className="text-sm font-semibold text-ink-3">
            {today.month}월 {today.day}일 {today.weekday}
          </p>
          <h2 className="mt-2 font-serif text-[26px] font-semibold leading-snug lg:text-[32px]">열두 띠, 오늘은 어떤 흐름일까요</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{BASIS_SHORT}</p>
        </section>

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-10">
          <div>
            {/* 모바일은 찾기 도구를 목록보다 먼저, 데스크톱은 오른쪽 칸에 */}
            <div className="mt-6 lg:hidden">
              <YearFinder />
            </div>
            {overview.isLoading && <Spinner />}
            {overview.error && <ErrorState title="운세를 불러오지 못했어요" onRetry={() => overview.refetch()} />}
            {overview.data && (
              <ul className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:gap-3">
                {overview.data.items.map((it) => (
                  <li key={it.animal.slug}>
                    <Link to={zodiacPath(it.animal.slug)} className="flex h-full gap-3 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong">
                      <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-subtle font-serif text-2xl" aria-hidden>
                        {it.animal.hanja}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="font-semibold">{it.animal.name}띠</span>
                          <ToneBadge tone={it.tone} label={it.toneLabel} />
                        </span>
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
              <YearFinder />
            </div>
            <CrossLink to="/horoscope" title="별자리 운세" body="생일로 찾는 열두 별자리의 오늘" />
            <MethodNote basis={BASIS_SHORT} disclaimer="띠별 운세는 같은 띠라면 모두에게 같은 풀이예요. 재미와 참고로 읽어 주세요." />
          </aside>
        </div>
      </Page>
    </div>
  );
}

/** 태어난 해 → 띠 (입춘 기준 안내) */
function YearFinder() {
  const [value, setValue] = useState('');
  const inputId = useId();
  const year = Number(value);
  const valid = /^\d{4}$/.test(value) && year >= 1900 && year <= 2100;
  const animal = valid ? animalOfYear(year) : null;
  const prev = valid ? animalOfYear(year - 1) : null;
  return (
    <Card>
      <h3 className="font-semibold">태어난 해로 내 띠 찾기</h3>
      <label htmlFor={inputId} className="mt-3 block text-sm text-ink-2">
        태어난 해(양력)
      </label>
      <TextInput id={inputId} inputMode="numeric" maxLength={4} placeholder="예) 1990" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} className="mt-1.5" />
      {animal && prev && (
        <div className="mt-3 text-[15px] leading-relaxed" aria-live="polite">
          <p>
            {year}년생은 <b>{animal.name}띠</b>({animal.hanja})예요.
          </p>
          <p className="mt-1 text-sm text-ink-3">
            입춘(2월 4일 무렵) 전에 태어났다면 앞 해의 {prev.name}띠예요.
          </p>
          <Link to={zodiacPath(animal.slug)} className="mt-3 inline-flex h-10 items-center rounded-full bg-action-2 px-4 text-sm font-semibold">
            {animal.name}띠 운세 보기
          </Link>
        </div>
      )}
    </Card>
  );
}

export function ZodiacDetailPage() {
  const params = useParams();
  const animal = zodiacAnimalBySlug(params.animal);
  const period = parsePeriod(params.period);
  if (animal && !params.period) return <Navigate to={zodiacPath(animal.slug)} replace />;
  if (!animal || !period) return <NotFoundPage />;
  return <ZodiacDetail animal={animal} period={period} />;
}

function ZodiacDetail({ animal, period }: { animal: ZodiacAnimal; period: FreeFortunePeriod }) {
  const own = useOwnSigns();
  const today = todayKst();
  const q = useQuery({ queryKey: ['zodiac', animal.slug, period, today.iso], queryFn: () => api.zodiac(animal.slug, period, today.iso), staleTime: 10 * 60_000 });
  const title = `${animal.name}띠 ${PERIOD_TITLE[period]}`;
  const years = birthYearsOf(animal, today.year);
  usePageMeta({
    title: `${title} — 띠별 운세 | 달빛사주`,
    description: `${animal.name}띠 ${PERIOD_TITLE[period]}. 그 기간의 띠와 ${animal.name}띠가 잘 맞는지로 풀고, ${years.slice(-5).join('·')}년생 등 년생별 한 줄까지 무료로 보여 드려요.`,
    path: zodiacPath(animal.slug, period),
  });
  const d = q.data;

  return (
    <div className="min-h-page">
      <PageHeader title={title} width="wide" />
      <Page width="wide" className="pb-12">
        <PickerRow
          label="띠 고르기"
          items={ZODIAC_ANIMALS}
          current={animal.slug}
          own={own.animal?.slug ?? null}
          hrefOf={(a) => zodiacPath(a.slug, period)}
          glyphOf={(a) => a.hanja}
          nameOf={(a) => `${a.name}띠`}
          ownLabel="내 띠"
        />
        <PeriodTabs current={period} hrefOf={(p) => zodiacPath(animal.slug, p)} />

        {q.isLoading && <Spinner />}
        {q.error && <ErrorState title="운세를 불러오지 못했어요" body="잠시 후 다시 시도해 주세요." onRetry={() => q.refetch()} />}
        {d && (
          <div className="animate-fade lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-10">
            <div>
              <FortuneMain eyebrow={d.range.label} tone={d.tone} toneLabel={d.toneLabel} headline={d.headline} paragraphs={d.paragraphs} tip={d.tip} />
              <KeyDays days={d.keyDays} note={`옛 달력에서는 날마다 열두 띠 동물이 돌아가며 붙어요. ${animal.name}띠와 잘 맞는 날과 부딪치는 날을 골랐어요.`} />
              <ReasonCard reasons={d.reasons} intro={`옛 달력에서 그 기간에 붙는 두 글자(간지)와 ${animal.name}띠 글자(${animal.hanja})가 어떤 관계인지 적었어요.`} />
              <div className="mt-6">
                <AdSlot placement="web_content_mid" />
              </div>
              <section className="mt-8" aria-labelledby="years-title">
                <h3 id="years-title" className="text-lg font-semibold">
                  년생별 {animal.name}띠 운세
                </h3>
                <p className="mt-1 text-sm text-ink-3">
                  {d.pillar ? `같은 ${animal.name}띠라도 태어난 해마다 기운이 조금씩 달라서, 해마다 한 줄씩 따로 풀었어요.` : `같은 ${animal.name}띠라도 태어난 해마다 이번 주에 잘 맞는 요일이 달라요.`}
                </p>
                <ul className="mt-3 divide-y divide-line border-y border-line">
                  {d.years.map((y) => (
                    <li key={y.year} className="py-4">
                      <p className="font-semibold">{y.year}년생</p>
                      <p className="mt-1 text-[15px] leading-relaxed">{y.text}</p>
                    </li>
                  ))}
                </ul>
                {/* 용어(천간·십신)가 든 근거는 궁금한 사람만 펼쳐 보게 */}
                <details className="group mt-3 text-sm text-ink-3">
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full border border-line px-3 py-1 hover:text-ink-2 [&::-webkit-details-marker]:hidden">
                    년생별 풀이 근거 <span className="transition-transform group-open:rotate-180" aria-hidden>▾</span>
                  </summary>
                  <ul className="mt-2 space-y-1 font-serif text-xs leading-relaxed">
                    {d.years.map((y) => (
                      <li key={y.year}>{`${y.year}년생(${y.ganzhi}) · ${y.reason}`}</li>
                    ))}
                  </ul>
                </details>
              </section>
            </div>

            <aside className="mt-8 lg:mt-6">
              <Card>
                <div className="flex items-center gap-3">
                  <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-subtle font-serif text-2xl" aria-hidden>
                    {animal.hanja}
                  </span>
                  <p className="font-semibold">
                    {animal.name}띠 <span className="font-serif font-normal text-ink-3">{animal.hanja}</span>
                  </p>
                </div>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{d.trait}</p>
              </Card>
              <Card className="mt-4">
                <h3 className="font-semibold">행운 포인트</h3>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  {[
                    ['색', d.lucky.color],
                    ['방향', d.lucky.direction],
                    ['숫자', String(d.lucky.number)],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-subtle p-3">
                      <dt className="text-xs text-ink-3">{k}</dt>
                      <dd className="mt-1 font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-xs text-ink-3">{d.lucky.basis}에서 골랐어요.</p>
              </Card>
              <div className="mt-4">
                <PersonalUpsell body={UPSELL} hasProfile={Boolean(own.name)} />
              </div>
              <CrossLink to="/horoscope" title="별자리 운세" body="생일로 찾는 열두 별자리의 흐름" />
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
