/**
 * 띠별·별자리 운세 공용 조각 — 기간 탭, 본문, 근거, 이번 주 날짜, 내 운세 안내, 계산 방법.
 */
import { FREE_FORTUNE_PERIODS, FREE_FORTUNE_PERIOD_LABEL, type FreeFortuneKeyDayDto, type FreeFortunePeriod, type FreeFortuneReasonDto, type FreeFortuneTone } from '@saju/shared';
import { ChevronRight, Sparkles } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge, Card, cx } from './ui';

/** 기간 탭 — 검색 엔진이 따라갈 수 있게 버튼이 아닌 링크로 */
export function PeriodTabs({ current, hrefOf }: { current: FreeFortunePeriod; hrefOf: (p: FreeFortunePeriod) => string }) {
  return (
    <nav aria-label="기간" className="mt-4">
      <ul className="grid grid-cols-5 gap-1 rounded-xl bg-subtle p-1">
        {FREE_FORTUNE_PERIODS.map((p) => {
          const active = p === current;
          return (
            <li key={p}>
              <Link
                to={hrefOf(p)}
                replace
                preventScrollReset
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex h-10 items-center justify-center rounded-lg text-[14px] font-medium transition-colors lg:h-11 lg:text-[15px]',
                  active ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]' : 'text-ink-3 hover:text-ink-2',
                )}
              >
                {FREE_FORTUNE_PERIOD_LABEL[p]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** 12개 중 하나 고르기 — 모바일은 가로 스크롤, 데스크톱은 6칸 격자 */
export function PickerRow<T extends { slug: string }>({
  label,
  items,
  current,
  own,
  hrefOf,
  glyphOf,
  nameOf,
  ownLabel,
}: {
  label: string;
  items: readonly T[];
  current: string;
  own: string | null;
  hrefOf: (item: T) => string;
  glyphOf: (item: T) => string;
  nameOf: (item: T) => string;
  ownLabel: string;
}) {
  // 모바일 가로 스크롤에서 고른 항목이 화면 밖에 있으면 가운데로 (페이지 세로 스크롤은 건드리지 않는다)
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const ul = listRef.current;
    const li = ul?.querySelector<HTMLElement>('[aria-current="page"]')?.parentElement;
    if (ul && li && ul.scrollWidth > ul.clientWidth) ul.scrollLeft = li.offsetLeft - ul.clientWidth / 2 + li.clientWidth / 2;
  }, [current]);
  return (
    <nav aria-label={label} className="mt-4">
      <ul ref={listRef} className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 lg:mx-0 lg:grid lg:grid-cols-6 lg:overflow-visible lg:px-0 xl:grid-cols-12">
        {items.map((it) => {
          const active = it.slug === current;
          return (
            <li key={it.slug} className="shrink-0">
              <Link
                to={hrefOf(it)}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex w-16 flex-col items-center gap-1 rounded-2xl border py-2.5 transition-colors lg:w-full',
                  active ? 'border-ink bg-action text-on-action' : 'border-line bg-surface text-ink-2 hover:border-line-strong',
                )}
              >
                <span className="font-serif text-xl leading-none" aria-hidden>
                  {glyphOf(it)}
                </span>
                <span className="whitespace-nowrap text-[12px] font-medium">{nameOf(it)}</span>
                {own === it.slug && <span className={cx('text-[10px] font-semibold', active ? 'text-on-action' : 'text-gold')}>{ownLabel}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function ToneBadge({ tone, label }: { tone: FreeFortuneTone; label: string }) {
  return <Badge tone={tone === 'good' ? 'gold' : tone === 'calm' ? 'success' : 'default'}>{label}</Badge>;
}

export function FortuneMain({ eyebrow, tone, toneLabel, headline, paragraphs, tip }: { eyebrow: ReactNode; tone: FreeFortuneTone; toneLabel: string; headline: string; paragraphs: string[]; tip: string }) {
  return (
    <article className="pt-6" aria-label="풀이">
      <p className="text-sm font-semibold text-ink-3">{eyebrow}</p>
      <h2 className="mt-2 font-serif text-[26px] font-semibold leading-snug lg:text-[32px]">{headline}</h2>
      <div className="mt-3">
        <ToneBadge tone={tone} label={toneLabel} />
      </div>
      <div className="prose-reading mt-4 space-y-3 text-[17px] leading-relaxed">
        {paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
      <p className="mt-5 flex gap-2 rounded-xl bg-subtle p-3.5 text-[15px] leading-relaxed">
        <Sparkles className="mt-1 size-4 shrink-0 text-gold" aria-hidden />
        <span>
          <b className="mr-1">이렇게 해 보세요</b>
          {tip}
        </span>
      </p>
    </article>
  );
}

export function ReasonCard({ title = '왜 이런 풀이일까요?', reasons }: { title?: string; reasons: FreeFortuneReasonDto[] }) {
  return (
    <Card className="mt-6">
      <h3 className="font-semibold">{title}</h3>
      <ul className="mt-3 space-y-3">
        {reasons.map((r) => (
          <li key={r.title}>
            <p className="font-serif text-[15px] font-semibold">{r.title}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-ink-2">{r.body}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function KeyDays({ days }: { days: FreeFortuneKeyDayDto[] }) {
  if (days.length === 0) return null;
  return (
    <Card className="mt-6">
      <h3 className="font-semibold">이번 주 눈여겨볼 날</h3>
      <ul className="mt-3 space-y-3">
        {days.map((k) => (
          <li key={k.date} className="flex gap-3">
            <span className={cx('mt-0.5 inline-flex h-6 shrink-0 items-center rounded-md px-2 text-xs font-semibold', k.kind === 'good' ? 'border border-gold/40 text-gold' : 'bg-subtle text-ink-2')}>
              {k.kind === 'good' ? '좋은 날' : '살필 날'}
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">
                {Number(k.date.slice(5, 7))}월 {Number(k.date.slice(8, 10))}일 {k.weekday} <span className="font-serif font-normal text-ink-3">{k.marker}</span>
              </p>
              <p className="mt-0.5 text-sm leading-relaxed text-ink-2">{k.reason}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** 무료 개인 운세(오늘의 운세)로 이어지는 안내 */
export function PersonalUpsell({ body, hasProfile }: { body: string; hasProfile: boolean }) {
  return (
    <Card className="mt-6 lg:mt-0">
      <h3 className="font-semibold">내 사주로 본 오늘의 운세</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{body}</p>
      <Link to={hasProfile ? '/today' : '/input'} className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-full bg-action font-semibold text-on-action">
        {hasProfile ? '오늘의 운세 보기' : '내 사주 입력하기'}
      </Link>
      <p className="mt-2 text-center text-xs text-ink-3">무료예요. 회원가입 없이 볼 수 있어요.</p>
    </Card>
  );
}

export function CrossLink({ to, title, body }: { to: string; title: string; body: string }) {
  return (
    <Link to={to} className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-4 transition-colors hover:border-line-strong">
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="mt-0.5 block text-sm text-ink-3">{body}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}

export function MethodNote({ basis, disclaimer }: { basis: string; disclaimer: string }) {
  return (
    <section className="mt-6 space-y-2 text-xs leading-relaxed text-ink-3" aria-label="계산 방법과 안내">
      <p>
        <b className="font-semibold text-ink-2">이렇게 풀었어요 · </b>
        {basis}
      </p>
      <p>{disclaimer}</p>
    </section>
  );
}
