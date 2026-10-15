/**
 * 꿈해몽 — 무료 사전(검색·분류·키워드 페이지, SEO + 콘텐츠 광고)과 AI 꿈풀이.
 *
 * 사전 데이터는 @saju/shared/dream 을 이 화면 묶음(지연 로딩)에서만 불러온다 → 첫 화면 번들에 들어가지 않는다.
 * 광고: 사전 화면 본문 중간·하단(web_content_mid)만. AI 꿈풀이 입력 화면에는 넣지 않는다(상담 입력창 주변 금지 정책).
 */
import type { ProductDto } from '@saju/shared';
import {
  DREAM_CATEGORIES,
  DREAM_CATEGORY_META,
  DREAM_CRISIS_PATTERN,
  DREAM_DISCLAIMER,
  DREAM_ENTRIES,
  DREAM_SOURCE_NOTE,
  DREAM_TEXT_MAX,
  DREAM_TEXT_MIN,
  DREAM_TONE_HINT,
  DREAM_TONE_LABEL,
  dreamEntriesOf,
  dreamTitle,
  extractDreamSymbols,
  getDreamEntry,
  resolveDreamTerm,
  searchDreams,
  type DreamCategory,
  type DreamEntry,
  type DreamInterpretationDto,
  type DreamTone,
} from '@saju/shared/dream';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, MoonStar, Search } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { AdSlot } from '@/components/AdSlot';
import { Page } from '@/components/AppShell';
import { PaywallSheet } from '@/components/PaywallSheet';
import { RewardedAdCard } from '@/components/RewardedAdCard';
import { Badge, Button, Card, Chip, EmptyState, IconButton, PageHeader, cx, type PageWidth } from '@/components/ui';
import { qk, useConfig, useProfiles, useWallet } from '@/hooks/queries';
import { usePageMeta } from '@/hooks/usePageMeta';
import { SessionGateError, useSessionGate } from '@/hooks/useSessionGate';
import { usePurchase } from '@/hooks/usePurchase';
import { ApiError, api } from '@/lib/api';
import { t } from '@/lib/copy';

const SITE = '달빛사주';
const CRISIS_NOTE = t('ask.crisisNote');
/** 많이 찾는 꿈 — 사전에 없는 것은 건너뛴다 */
const POPULAR = ['뱀', '돼지', '이빨', '똥', '죽는-꿈', '호랑이', '물', '불', '전-애인', '쫓기는-꿈', '떨어지는-꿈', '시험', '아기', '돈', '조상', '귀신'];
const LAST_RESULT_KEY = 'yd.dreamLast';

export const dreamPath = (e: Pick<DreamEntry, 'slug'>) => `/dream/${e.slug}`;
const isCategory = (v: string | null): v is DreamCategory => Boolean(v) && (DREAM_CATEGORIES as readonly string[]).includes(v!);

// ---------------------------------------------------------------------------
// 공용 조각
// ---------------------------------------------------------------------------

function DreamHeader({ title, fallback, width = 'wide', right }: { title: ReactNode; fallback: string; width?: PageWidth; right?: ReactNode }) {
  const navigate = useNavigate();
  // 검색으로 바로 들어온 경우(앱 안 이력이 없음)에는 사이트 밖으로 나가지 않고 상위 화면으로
  const back = () => ((((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0 ? navigate(-1) : navigate(fallback)));
  return (
    <PageHeader
      width={width}
      left={
        <IconButton label={t('common.back')} onClick={back}>
          <ArrowLeft className="size-6" />
        </IconButton>
      }
      title={title}
      right={right}
    />
  );
}

export function ToneBadge({ tone }: { tone: DreamTone }) {
  return (
    <span
      title={DREAM_TONE_HINT[tone]}
      className={cx(
        'inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-semibold',
        tone === 'good' && 'border border-gold/40 text-gold',
        tone === 'bad' && 'border border-line-strong text-ink-2',
        tone === 'neutral' && 'bg-subtle text-ink-3',
      )}
    >
      {DREAM_TONE_LABEL[tone]}
    </span>
  );
}

function EntryLink({ entry, compact }: { entry: DreamEntry; compact?: boolean }) {
  return (
    <Link to={dreamPath(entry)} className="flex h-full items-start gap-3 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-line-strong">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="font-semibold">{dreamTitle(entry)}</span>
          <ToneBadge tone={entry.tone} />
        </span>
        {!compact && <span className="mt-1 block text-sm leading-relaxed text-ink-2">{entry.summary}</span>}
      </span>
      <ChevronRight className="mt-0.5 size-5 shrink-0 text-ink-3" aria-hidden />
    </Link>
  );
}

/** 사전 검색 — 별칭('구렁이')·'뱀꿈'·입력 중인 앞부분('호랑')·초성('ㅎㄹㅇ')까지 찾는다 */
function DreamSearch({ autoFocus }: { autoFocus?: boolean }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const deferred = useDeferredValue(q);
  const results = useMemo(() => searchDreams(deferred, 8), [deferred]);
  const typed = deferred.trim().length > 0;
  return (
    <div role="search">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const first = searchDreams(q, 1)[0];
          if (first) navigate(dreamPath(first));
        }}
        className="relative"
      >
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-3" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value.slice(0, 40))}
          aria-label="꿈 키워드 검색"
          placeholder="예) 뱀, 돼지꿈, 이가 빠지는 꿈"
          autoFocus={autoFocus}
          enterKeyHint="search"
          className="h-13 w-full rounded-xl border border-line-strong bg-surface pl-12 pr-4 text-base text-ink outline-none placeholder:text-ink-3 focus:border-ink"
        />
      </form>
      {typed && (
        <div className="mt-2" aria-live="polite">
          {results.length > 0 ? (
            <ul aria-label="검색 결과" className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {results.map((e) => (
                <li key={e.slug}>
                  <Link to={dreamPath(e)} className="flex items-center gap-3 px-4 py-3 hover:bg-subtle">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="font-semibold">{dreamTitle(e)}</span>
                        <ToneBadge tone={e.tone} />
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-ink-3">{e.summary}</span>
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-ink-3" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl bg-subtle p-4 text-sm leading-relaxed text-ink-2">
              사전에 꼭 맞는 꿈이 없어요. 꿈 이야기를 그대로 적으면{' '}
              <Link to={`/dream/ask?text=${encodeURIComponent(q.trim())}`} className="font-semibold text-info underline underline-offset-2">
                AI 꿈풀이
              </Link>
              가 풀어 드려요.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AiDreamCard({ keyword }: { keyword?: DreamEntry }) {
  const to = keyword ? `/dream/ask?k=${encodeURIComponent(keyword.slug)}` : '/dream/ask';
  return (
    <Card className="bg-subtle">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink-3">
        <MoonStar className="size-4" aria-hidden />
        AI 꿈풀이
      </p>
      <p className="mt-2 font-serif text-lg font-semibold leading-snug">{keyword ? '내 꿈에 맞춰 더 자세히 풀어 볼까요?' : '내 꿈 이야기로 풀어 보기'}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-2">꿈 내용을 적어 주시면 사전의 전통 해석을 바탕으로 AI가 풀어 드려요. 사주를 저장해 두었다면 함께 살펴봐요.</p>
      <Link to={to} className="mt-4 inline-flex h-11 items-center rounded-full bg-action px-5 text-sm font-semibold text-on-action">
        꿈 이야기 적기
      </Link>
    </Card>
  );
}

function DreamFooter() {
  return (
    <footer className="mt-10 space-y-1.5 border-t border-line pt-6 text-xs leading-relaxed text-ink-3">
      <p>{DREAM_DISCLAIMER}</p>
      <p>{DREAM_SOURCE_NOTE}</p>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// /dream — 사전 첫 화면 (검색 · 많이 찾는 꿈 · 분류별 목록)
// ---------------------------------------------------------------------------

export function DreamHomePage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('c');
  const category: DreamCategory = isCategory(raw) ? raw : 'animal';
  const meta = DREAM_CATEGORY_META[category];
  const list = useMemo(() => dreamEntriesOf(category), [category]);
  const popular = useMemo(() => POPULAR.map((s) => getDreamEntry(s)).filter((e): e is DreamEntry => Boolean(e)), []);
  const total = DREAM_ENTRIES.length;

  usePageMeta({
    title: isCategory(raw) ? `${meta.label} 꿈해몽 — ${meta.description} | ${SITE}` : `꿈해몽 사전 — 자주 꾸는 꿈 ${total}가지 풀이 | ${SITE}`,
    description: isCategory(raw)
      ? `${list
          .slice(0, 8)
          .map((e) => dreamTitle(e))
          .join(', ')} 등 ${meta.label}에 관한 꿈 ${list.length}가지의 전통 해석과 상황별 풀이를 무료로 볼 수 있어요.`
      : `뱀꿈, 돼지꿈, 이가 빠지는 꿈처럼 자주 꾸는 꿈 ${total}가지의 전통 해석을 차분하게 정리했어요. 꿈 이야기를 적으면 AI 꿈풀이도 받아 볼 수 있어요.`,
    canonicalPath: isCategory(raw) ? `/dream?c=${category}` : '/dream',
  });

  return (
    <div className="min-h-page pb-16">
      <DreamHeader title="꿈해몽" fallback="/" />
      <Page width="wide">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start lg:gap-12">
          <section className="pt-4 lg:pt-2">
            <p className="text-sm font-semibold text-ink-3">무료 꿈해몽 사전</p>
            <h2 className="mt-2 font-serif text-[26px] font-semibold leading-snug lg:text-[34px]">
              <span className="block">어젯밤 꿈,</span>
              <span className="block">무슨 뜻이었을까요?</span>
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">자주 꾸는 꿈 {total}가지를 전해 오는 해석으로 차분하게 정리했어요.</p>
            <div className="mt-6">
              <DreamSearch />
            </div>
            <section className="mt-8" aria-labelledby="dream-popular">
              <h2 id="dream-popular" className="text-lg font-semibold">
                많이 찾는 꿈
              </h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {popular.map((e) => (
                  <li key={e.slug}>
                    <Link to={dreamPath(e)} className="inline-flex h-10 items-center rounded-full border border-line-strong bg-surface px-4 text-sm font-medium text-ink-2 hover:text-ink">
                      {dreamTitle(e)}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </section>
          <aside className="mt-8 space-y-4 lg:mt-2">
            <AiDreamCard />
            <p className="rounded-2xl border border-line p-4 text-sm leading-relaxed text-ink-2">
              <b className="font-semibold text-ink">길몽·흉몽은 이렇게 읽어요.</b> 전해 오는 해석의 결을 표시한 것이에요. 흉몽도 겁낼 일이 아니라, 마음을 한 번 살펴보라는 신호로 읽어 주세요.
            </p>
          </aside>
        </div>

        <div className="mt-10">
          <AdSlot placement="web_content_mid" />
        </div>

        <section className="mt-10" aria-labelledby="dream-browse">
          <h2 id="dream-browse" className="text-lg font-semibold">
            분류로 찾아보기
          </h2>
          <nav aria-label="꿈 분류" className="no-scrollbar -mx-5 mt-3 flex gap-2 overflow-x-auto px-5 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
            {DREAM_CATEGORIES.map((c) => (
              <Link
                key={c}
                to={`/dream?c=${c}`}
                replace
                preventScrollReset
                aria-current={c === category ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  setParams({ c }, { replace: true, preventScrollReset: true });
                }}
                className={cx(
                  'inline-flex h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition-colors',
                  c === category ? 'border-ink bg-action text-on-action' : 'border-line-strong bg-surface text-ink-2',
                )}
              >
                {DREAM_CATEGORY_META[c].label}
              </Link>
            ))}
          </nav>
          <p className="mt-4 text-sm text-ink-3">
            {meta.description} · {list.length}가지
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 lg:gap-3">
            {list.map((e) => (
              <li key={e.slug}>
                <EntryLink entry={e} />
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-10">
          <AdSlot placement="web_content_mid" />
        </div>
        <DreamFooter />
      </Page>
    </div>
  );
}

// ---------------------------------------------------------------------------
// /dream/:slug — 키워드 페이지
// ---------------------------------------------------------------------------

export function DreamEntryPage() {
  const { slug = '' } = useParams();
  const entry = getDreamEntry(slug);
  if (entry) return <DreamEntryView key={entry.slug} entry={entry} />;
  // 별칭·'뱀꿈' 같은 주소는 대표 키워드 페이지로
  const alias = resolveDreamTerm(slug.replace(/-/g, ' '));
  if (alias) return <Navigate to={dreamPath(alias)} replace />;
  return <DreamNotFound slug={slug} />;
}

function DreamNotFound({ slug }: { slug: string }) {
  usePageMeta({ title: `꿈해몽 | ${SITE}` });
  return (
    <div className="min-h-page pb-16">
      <DreamHeader title="꿈해몽" fallback="/dream" width="medium" />
      <Page width="medium">
        <EmptyState title="사전에 없는 꿈이에요" body={`'${slug.replace(/-/g, ' ')}'에 꼭 맞는 항목을 찾지 못했어요. 다른 말로 찾아보거나, 꿈 이야기를 적어 AI 꿈풀이를 받아 보세요.`} />
        <DreamSearch autoFocus />
        <div className="mt-6">
          <AiDreamCard />
        </div>
      </Page>
    </div>
  );
}

function DreamEntryView({ entry }: { entry: DreamEntry }) {
  const title = dreamTitle(entry);
  const cat = DREAM_CATEGORY_META[entry.category];
  const related = useMemo(() => {
    const same = dreamEntriesOf(entry.category);
    const i = same.findIndex((e) => e.slug === entry.slug);
    return [...same.slice(i + 1), ...same.slice(0, i)].slice(0, 8);
  }, [entry]);

  usePageMeta({
    title: `${title} 해몽 — 뜻과 상황별 풀이 | ${SITE}`,
    description: `${entry.summary} ${entry.variations.map((v) => v.title).join(', ')} 등 상황별 풀이를 정리했어요.`.slice(0, 160),
    canonicalPath: dreamPath(entry),
  });

  return (
    <div className="min-h-page pb-16">
      <DreamHeader title={`${title} 해몽`} fallback="/dream" />
      <Page width="wide">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-12">
          <article>
            <nav aria-label="위치" className="pt-3 text-sm text-ink-3 lg:pt-1">
              <Link to="/dream" className="hover:text-ink">
                꿈해몽
              </Link>
              <span aria-hidden> › </span>
              <Link to={`/dream?c=${entry.category}`} className="hover:text-ink">
                {cat.label}
              </Link>
            </nav>
            <div className="mt-4 flex items-center gap-2">
              <ToneBadge tone={entry.tone} />
              <span className="text-sm text-ink-3">{DREAM_TONE_HINT[entry.tone]}</span>
            </div>
            <p className="mt-3 font-serif text-[22px] font-semibold leading-snug lg:text-[26px]">{entry.summary}</p>
            <p className="prose-reading mt-4 text-[17px] leading-relaxed">{entry.meaning}</p>

            <div className="mt-8">
              <AdSlot placement="web_content_mid" />
            </div>

            <section className="mt-8" aria-labelledby="dream-variations">
              <h2 id="dream-variations" className="text-lg font-semibold">
                상황별 풀이
              </h2>
              <ul className="mt-3 space-y-3">
                {entry.variations.map((v) => (
                  <li key={v.title}>
                    <Card as="article">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-semibold leading-snug">{v.title}</h3>
                        <ToneBadge tone={v.tone ?? entry.tone} />
                      </div>
                      <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{v.text}</p>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>

            {entry.aliases.length > 0 && (
              <p className="mt-6 text-sm leading-relaxed text-ink-3">
                <span className="font-semibold text-ink-2">이렇게도 찾아요 </span>
                {entry.aliases.join(' · ')}
              </p>
            )}

            <div className="mt-8">
              <AdSlot placement="web_content_mid" />
            </div>
          </article>

          <aside className="mt-10 space-y-6 lg:sticky lg:top-24 lg:mt-1">
            <AiDreamCard keyword={entry} />
            <section aria-labelledby="dream-related">
              <h2 id="dream-related" className="text-lg font-semibold">
                {cat.label}에 관한 다른 꿈
              </h2>
              <ul className="mt-3 grid gap-2">
                {related.map((e) => (
                  <li key={e.slug}>
                    <EntryLink entry={e} compact />
                  </li>
                ))}
              </ul>
              <Link to={`/dream?c=${entry.category}`} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-info">
                {cat.label} 전체 보기
                <ChevronRight className="size-4" aria-hidden />
              </Link>
            </section>
            <div>
              <p className="mb-2 text-sm font-semibold text-ink-2">다른 꿈 찾기</p>
              <DreamSearch />
            </div>
          </aside>
        </div>
        <DreamFooter />
      </Page>
    </div>
  );
}

// ---------------------------------------------------------------------------
// /dream/ask — AI 꿈풀이
// ---------------------------------------------------------------------------

function readLast(): { text: string; result: DreamInterpretationDto } | null {
  try {
    const raw = window.sessionStorage.getItem(LAST_RESULT_KEY);
    return raw ? (JSON.parse(raw) as { text: string; result: DreamInterpretationDto }) : null;
  } catch {
    return null;
  }
}
function saveLast(v: { text: string; result: DreamInterpretationDto }) {
  try {
    // 꿈 이야기는 민감할 수 있어 탭을 닫으면 사라지는 sessionStorage 에만 둔다
    window.sessionStorage.setItem(LAST_RESULT_KEY, JSON.stringify(v));
  } catch {
    /* 저장 못 해도 화면은 그대로 */
  }
}

export function DreamAskPage() {
  const gate = useSessionGate();
  const qc = useQueryClient();
  const config = useConfig();
  const wallet = useWallet();
  const profiles = useProfiles();
  const purchase = usePurchase();
  const [params, setParams] = useSearchParams();
  const last = useMemo(readLast, []);
  const [text, setText] = useState(() => {
    const k = params.get('k');
    const e = k ? (getDreamEntry(k) ?? resolveDreamTerm(k)) : undefined;
    if (e) return `${dreamTitle(e)}을 꿨어요. `;
    const prefill = params.get('text');
    if (prefill) return prefill.slice(0, DREAM_TEXT_MAX);
    return last?.text ?? '';
  });
  const [result, setResult] = useState<DreamInterpretationDto | null>(() => (params.get('k') || params.get('text') ? null : (last?.result ?? null)));
  const [choice, setChoice] = useState<string | null>(null); // null = 대표 프로필, 'none' = 사주 없이
  const [paywall, setPaywall] = useState(false);
  const resultRef = useRef<HTMLElement>(null);

  usePageMeta({
    title: `AI 꿈풀이 — 내 꿈 이야기로 풀어 보기 | ${SITE}`,
    description: '꿈 내용을 적으면 꿈해몽 사전의 전통 해석을 바탕으로 AI가 맞춤 풀이를 써 드려요.',
    canonicalPath: '/dream/ask',
  });

  const aiEnabled = config.data?.ai.enabled ?? false;
  const list = profiles.data ?? [];
  const primary = list.find((p) => p.isPrimary) ?? list[0];
  const selected = choice === 'none' ? null : (list.find((p) => p.id === choice) ?? primary ?? null);
  const deferred = useDeferredValue(text);
  const preview = useMemo(() => extractDreamSymbols(deferred, 6), [deferred]);
  const trimmed = text.trim();
  const crisisNow = DREAM_CRISIS_PATTERN.test(text) || Boolean(result?.crisis);

  const interpret = useMutation({
    mutationFn: () => api.dreamInterpret({ text: trimmed, ...(selected ? { profileId: selected.id } : {}), ...(choice === 'none' ? { withoutSaju: true } : {}) }),
    onSuccess: async (r) => {
      setResult(r);
      saveLast({ text: trimmed, result: r });
      // 미리 채운 주소(?k=·?text=)를 지워 두면, 상징 페이지에 갔다가 돌아와도 방금 풀이가 그대로 보인다
      if (params.has('k') || params.has('text')) setParams({}, { replace: true, preventScrollReset: true });
      await qc.invalidateQueries({ queryKey: qk.wallet });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_CREDITS') setPaywall(true);
    },
  });

  useEffect(() => {
    if (result && interpret.isSuccess) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [result, interpret.isSuccess]);

  const canSubmit = trimmed.length >= DREAM_TEXT_MIN && gate.ready && !interpret.isPending;
  const onPurchase = async (product: ProductDto) => {
    await purchase({ product, returnTo: '/dream/ask' });
  };

  return (
    <div className="min-h-page pb-16">
      <DreamHeader
        title="AI 꿈풀이"
        fallback="/dream"
        width="medium"
        right={
          wallet.data && aiEnabled ? (
            <button type="button" onClick={() => setPaywall(true)} className="tabular rounded-full border border-line-strong px-3 py-1.5 text-sm">
              질문권 {wallet.data.credits}
            </button>
          ) : undefined
        }
      />
      <Page width="medium">
        {gate.failed && <SessionGateError onRetry={gate.retry} />}
        <h2 className="mt-4 font-serif text-[22px] font-semibold leading-snug lg:text-[26px]">어떤 꿈을 꾸셨나요?</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">기억나는 장면과 그때의 느낌을 편하게 적어 주세요. 꿈에 나온 것들을 꿈해몽 사전에서 찾아, 전해 오는 풀이를 바탕으로 풀어 드려요.</p>
        <p className="mt-3 rounded-xl bg-subtle p-3 text-sm leading-relaxed text-ink-2">
          {aiEnabled ? 'AI가 꿈 이야기와 사전의 전통 해석을 바탕으로 풀이를 써요. 한 번 풀 때마다 질문권 1회를 써요.' : '지금은 AI 꿈풀이를 준비하고 있어서, 사전의 전통 해석을 엮은 기본 풀이를 드려요. 질문권은 쓰지 않아요.'}
        </p>

        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) interpret.mutate();
          }}
        >
          <label htmlFor="dream-text" className="flex items-center justify-between text-[15px] font-semibold">
            꿈 내용
            <span className="tabular text-sm font-normal text-ink-3">
              {text.length}/{DREAM_TEXT_MAX}
            </span>
          </label>
          <textarea
            id="dream-text"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, DREAM_TEXT_MAX))}
            rows={6}
            placeholder="예) 큰 뱀이 집 안으로 들어와 제 손을 물었어요. 무섭기보다는 신기한 느낌이었어요."
            className="mt-2 w-full resize-none rounded-xl border border-line-strong bg-surface px-4 py-3 text-base leading-relaxed outline-none placeholder:text-ink-3 focus:border-ink"
          />
          <div className="mt-2 min-h-6 text-sm text-ink-3" aria-live="polite">
            {preview.length > 0 ? (
              <span>
                사전에서 찾은 상징 <span className="font-medium text-ink-2">{preview.map((m) => m.entry.keyword).join(' · ')}</span>
              </span>
            ) : trimmed.length > 0 ? (
              <span>사람·동물·물건·장소를 적으면 사전에서 상징을 찾아요.</span>
            ) : null}
          </div>

          {aiEnabled && list.length > 0 && (
            <fieldset className="mt-5">
              <legend className="text-[15px] font-semibold">사주와 함께 보기</legend>
              <p className="mt-1 text-sm text-ink-3">고른 사람의 타고난 성향에 맞춰, 풀이 끝에 한두 문장을 더해요.</p>
              <div className="no-scrollbar -mx-5 mt-2 flex gap-2 overflow-x-auto px-5 lg:mx-0 lg:flex-wrap lg:px-0">
                {list.map((p) => (
                  <Chip key={p.id} active={selected?.id === p.id} onClick={() => setChoice(p.id)}>
                    {p.name}
                  </Chip>
                ))}
                <Chip active={choice === 'none'} onClick={() => setChoice('none')}>
                  사주 없이
                </Chip>
              </div>
            </fieldset>
          )}

          {crisisNow && (
            <p role="note" className="mt-4 rounded-xl bg-subtle p-3 text-sm leading-relaxed text-info">
              {CRISIS_NOTE}
            </p>
          )}

          <Button type="submit" block size="lg" className="mt-6" disabled={!canSubmit} loading={interpret.isPending}>
            {interpret.isPending ? '꿈을 읽고 있어요' : aiEnabled ? '꿈풀이 보기 · 질문권 1회' : '꿈풀이 보기'}
          </Button>
          {trimmed.length > 0 && trimmed.length < DREAM_TEXT_MIN && <p className="mt-2 text-sm text-ink-3">꿈 내용을 {DREAM_TEXT_MIN}자 이상 적어 주세요.</p>}
          {interpret.error && !(interpret.error instanceof ApiError && interpret.error.code === 'INSUFFICIENT_CREDITS') && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {interpret.error.message}
            </p>
          )}
          <p className="mt-3 text-xs leading-relaxed text-ink-3">꿈 이야기는 풀이를 만드는 데에만 쓰고 서버에 저장하지 않아요.</p>
        </form>

        {aiEnabled && wallet.data && wallet.data.credits < 1 && <RewardedAdCard />}

        {result && <DreamResult ref={resultRef} result={result} />}

        <p className="mt-10 text-sm">
          <Link to="/dream" className="inline-flex items-center gap-1 font-semibold text-info">
            꿈해몽 사전 둘러보기
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </p>
      </Page>
      <PaywallSheet open={paywall} onClose={() => setPaywall(false)} productIds={['chat_pack_30', 'chat_pack_10']} subtitle="AI 상담과 AI 꿈풀이에 함께 쓰는 질문권이에요. 질문권은 유효기간이 없어요." onPurchase={onPurchase} />
    </div>
  );
}

function DreamResult({ result, ref }: { result: DreamInterpretationDto; ref: React.Ref<HTMLElement> }) {
  return (
    <section ref={ref} aria-labelledby="dream-result-title" className="mt-10 scroll-mt-20 border-t border-line pt-8">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
        <Badge tone={result.generator === 'ai' ? 'gold' : 'default'}>{result.generator === 'ai' ? 'AI가 쓴 풀이' : '기본 풀이'}</Badge>
        {result.profileName && <span>{result.profileName}님의 사주와 함께 봤어요</span>}
      </div>
      <h2 id="dream-result-title" className="mt-3 font-serif text-[22px] font-semibold leading-snug lg:text-[26px]">
        {result.headline}
      </h2>
      <div className="prose-reading mt-4 space-y-4 text-[17px] leading-relaxed">
        {result.paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      {result.symbols.length > 0 && (
        <section className="mt-8" aria-labelledby="dream-symbols">
          <h3 id="dream-symbols" className="font-semibold">
            사전에서 찾은 상징
          </h3>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {result.symbols.map((s) => (
              <li key={s.slug}>
                <Link to={`/dream/${s.slug}`} className="flex h-full items-start gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-line-strong">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold">{s.keyword}</span>
                      <ToneBadge tone={s.variation?.tone ?? s.tone} />
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-ink-2">{s.variation ? s.variation.title : s.summary}</span>
                  </span>
                  <ChevronRight className="mt-0.5 size-5 shrink-0 text-ink-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.creditsCharged > 0 && (
        <p className="mt-6 text-sm text-ink-3">
          질문권 {result.creditsCharged}회를 썼어요 · 남은 질문권 {result.creditsLeft}회
        </p>
      )}
      <div className="mt-6 space-y-1.5 text-xs leading-relaxed text-ink-3">
        <p>{result.notice}</p>
        <p>{result.disclaimer}</p>
      </div>
    </section>
  );
}
