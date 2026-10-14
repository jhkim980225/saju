import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProductDto, TarotReadingDto } from '@saju/shared';
import { ArrowLeft, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Page } from '@/components/AppShell';
import { BottomSheet } from '@/components/BottomSheet';
import { PaywallSheet } from '@/components/PaywallSheet';
import { ShareSheet } from '@/components/ShareSheet';
import { FlipCard } from '@/components/TarotCard';
import { TarotReadingView } from '@/components/TarotReadingView';
import { toast } from '@/components/Toast';
import { Button, ErrorState, IconButton, PageHeader, Spinner } from '@/components/ui';
import { usePurchase } from '@/hooks/usePurchase';
import { SessionGateError, useSessionGate } from '@/hooks/useSessionGate';
import { ApiError, api } from '@/lib/api';
import { track } from '@/lib/analytics';
import { t } from '@/lib/copy';
import { useSession } from '@/lib/session';

function shareOf(r: TarotReadingDto) {
  const origin = window.location.origin;
  // 질문은 공유하지 않는다 (06 §8.6)
  if (r.spread === 'daily') {
    const c = r.cards[0]!;
    return { title: t('tarot.share.kakaoDaily.title', { card: c.nameKo }), text: t('tarot.share.kakaoDaily.description', { headline: r.headline }), url: `${origin}/tarot`, buttons: [{ title: t('tarot.share.kakaoDaily.buttonPrimary'), url: `${origin}/tarot/daily` }] };
  }
  const topic = r.topic ? t(`tarot.topics.${r.topic}.label`) : r.spreadName;
  return {
    title: t('tarot.share.kakaoSpread.title', { topic }),
    text: t('tarot.share.kakaoSpread.description', { cards: r.cards.map((c) => c.nameKo).join(' · ') }),
    url: `${origin}/tarot`,
    buttons: [{ title: t('tarot.share.kakaoSpread.buttonPrimary'), url: `${origin}/tarot` }],
  };
}

function ResultShell({ reading, title, children }: { reading: TarotReadingDto | undefined; title: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  const [share, setShare] = useState(false);
  return (
    <div className="min-h-page pb-16">
      <PageHeader
        left={
          <IconButton label={t('common.back')} onClick={() => navigate('/tarot')}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
        title={title}
        width="wide"
        right={
          reading ? (
            <IconButton label={t('tarot.result.actions.share')} onClick={() => setShare(true)}>
              <Share2 className="size-5" />
            </IconButton>
          ) : undefined
        }
      />
      <Page width="wide">{children}</Page>
      {reading && <ShareSheet open={share} onClose={() => setShare(false)} payload={shareOf(reading)} />}
    </div>
  );
}

function ResultActions({ reading }: { reading: TarotReadingDto }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const remove = async () => {
    await api.tarotDelete(reading.id);
    await qc.invalidateQueries({ queryKey: ['tarot', 'history'] });
    toast(t('tarot.history.deleted'));
    navigate('/tarot/history', { replace: true });
  };
  return (
    <div className="mt-8 lg:ml-[calc(340px+3rem)] xl:ml-[calc(380px+4rem)]">
      <div className="grid grid-cols-2 gap-2">
        <Link to="/tarot" className="inline-flex h-12 items-center justify-center rounded-full bg-action-2 font-semibold">
          {t('tarot.result.actions.askAnother')}
        </Link>
        <Link to="/tarot/history" className="inline-flex h-12 items-center justify-center rounded-full bg-action-2 font-semibold">
          {t('tarot.history.title')}
        </Link>
      </div>
      {reading.spread !== 'daily' && <p className="mt-3 text-center text-xs text-ink-3">{t('tarot.result.sameQuestionNote')}</p>}
      <div className="mt-8 rounded-2xl border border-line p-5">
        <p className="font-semibold">{t('tarot.result.crossSaju.title')}</p>
        <p className="mt-1 text-sm text-ink-2">{t('tarot.result.crossSaju.body')}</p>
        <div className="mt-3 flex gap-4 text-sm font-semibold text-info">
          <Link to="/saju">{t('tarot.result.crossSaju.cta')}</Link>
          <Link to="/today">{t('tarot.result.crossSaju.ctaToday')}</Link>
        </div>
      </div>
      {reading.spread !== 'daily' && (
        <button type="button" onClick={() => setConfirm(true)} className="mt-6 text-sm text-ink-3 underline">
          {t('tarot.history.delete')}
        </button>
      )}
      <BottomSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t('tarot.history.deleteConfirm.title')}
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void remove()}>{t('tarot.history.deleteConfirm.confirm')}</Button>
          </div>
        }
      >
        <p className="text-[15px] leading-relaxed text-ink-2">{t('tarot.history.deleteConfirm.body')}</p>
      </BottomSheet>
    </div>
  );
}

/** 타로 결과 (/tarot/r/:id) */
export function TarotResultPage() {
  const { id } = useParams();
  const gate = useSessionGate();
  const token = useSession((s) => s.accessToken);
  const purchase = usePurchase();
  const [paywall, setPaywall] = useState(false);
  const q = useQuery({ queryKey: ['tarot', 'reading', id], queryFn: () => api.tarotReading(id!), enabled: Boolean(id && token) });
  const r = q.data;
  useEffect(() => {
    if (r) track('tarot_result_viewed', { spread: r.spread, locked: r.locked });
  }, [r]);

  const onPurchase = async (product: ProductDto) => {
    await purchase({ product, readingId: r!.id, returnTo: `/tarot/r/${r!.id}` });
  };
  const title = r ? (r.spread === 'daily' ? t('tarot.result.dailyTitle') : t('tarot.result.title', { topic: r.topic ? t(`tarot.topics.${r.topic}.label`) : r.spreadName })) : t('tarot.meta.navLabel');

  return (
    <ResultShell reading={r} title={title}>
      {gate.failed && <SessionGateError onRetry={gate.retry} />}
      {(q.isLoading || (!token && !q.error)) && <Spinner label={t('tarot.reveal.preparing')} />}
      {q.error && (
        <ErrorState
          title={q.error instanceof ApiError && q.error.status === 404 ? t('tarot.error.notFound.title') : t('tarot.error.reading.title')}
          body={q.error instanceof ApiError && q.error.status === 404 ? t('tarot.error.notFound.body') : t('tarot.error.reading.body')}
          onRetry={q.error instanceof ApiError && q.error.status === 404 ? undefined : () => q.refetch()}
        />
      )}
      {r && (
        <div className="animate-fade">
          <TarotReadingView reading={r} onUnlock={r.locked ? () => setPaywall(true) : undefined} />
          <ResultActions reading={r} />
        </div>
      )}
      {r?.productId && (
        <PaywallSheet
          open={paywall}
          onClose={() => setPaywall(false)}
          productIds={[r.productId]}
          title={t('tarot.paywall.sheetTitle', { topic: r.topic ? t(`tarot.topics.${r.topic}.label`) : r.spreadName })}
          subtitle={t('tarot.paywall.lockBody', { count: r.cards.length })}
          benefits={[t('tarot.paywall.benefitContinue'), t('tarot.paywall.benefitRevisit'), t('tarot.paywall.benefitDepth'), t('tarot.paywall.sameCards')]}
          onPurchase={onPurchase}
        />
      )}
    </ResultShell>
  );
}

/** 오늘의 카드 (/tarot/daily) — 뒷면을 눌러 펼치면 하루 한 장으로 고정 */
export function TarotDailyPage() {
  const gate = useSessionGate();
  const qc = useQueryClient();
  const token = useSession((s) => s.accessToken);
  const userId = useSession((s) => s.user?.id);
  const cached = qc.getQueryData<TarotReadingDto>(['tarot', 'daily', userId]);
  const [reading, setReading] = useState<TarotReadingDto | null>(cached ?? null);
  const [flipped, setFlipped] = useState(Boolean(cached));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [params] = useSearchParams();

  const reveal = async () => {
    if (busy || reading) return setFlipped(true);
    setBusy(true);
    setError(null);
    try {
      const r = await api.tarotDaily();
      qc.setQueryData(['tarot', 'daily', userId], r);
      void qc.invalidateQueries({ queryKey: ['tarot', 'history'] });
      track('tarot_daily_drawn');
      setReading(r);
      window.setTimeout(() => setFlipped(true), 30);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('tarot.error.draw.body'));
    } finally {
      setBusy(false);
    }
  };

  // 이미 뽑은 날 '다시 읽기'로 들어오면 바로 펼친다
  const autoOpen = params.get('open') === '1';
  useEffect(() => {
    if (autoOpen && token && !reading) void reveal();
  }, [autoOpen, token]);

  return (
    <ResultShell reading={flipped ? (reading ?? undefined) : undefined} title={t('tarot.result.dailyTitle')}>
      {gate.failed && <SessionGateError onRetry={gate.retry} />}
      {!flipped && (
        <section className="mx-auto max-w-sm pt-6 text-center">
          <h2 className="font-serif text-[22px] font-semibold">{t('tarot.home.dailyCard.title')}</h2>
          <p className="mt-2 text-[15px] text-ink-2">{t('tarot.home.dailyCard.desc')}</p>
          <button type="button" onClick={() => void reveal()} disabled={!token || busy} className="mx-auto mt-8 block w-48 transition-transform hover:-translate-y-1" aria-label={t('tarot.home.dailyCard.cta')}>
            <FlipCard card={reading?.cards[0] ?? null} flipped={flipped} />
          </button>
          <Button className="mt-8" loading={busy} disabled={!token} onClick={() => void reveal()}>
            {t('tarot.home.dailyCard.cta')}
          </Button>
          <p className="mt-3 text-xs text-ink-3">{t('tarot.home.dailyCard.oncePerDay')}</p>
          {error && <p className="mt-4 text-sm text-danger">{error}</p>}
        </section>
      )}
      {flipped && reading && (
        <div className="animate-fade">
          <TarotReadingView reading={reading} />
          <p className="mt-6 text-center text-sm text-ink-3 lg:ml-[calc(340px+3rem)] lg:text-left xl:ml-[calc(380px+4rem)]">{t('tarot.home.dailyCard.tomorrow')}</p>
          <ResultActions reading={reading} />
        </div>
      )}
    </ResultShell>
  );
}
