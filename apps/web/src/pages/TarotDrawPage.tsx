import { useQueryClient } from '@tanstack/react-query';
import { TAROT_SPREADS, TAROT_TOPICS, type TarotReadingDto, type TarotShuffleResultDto } from '@saju/shared';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { Page } from '@/components/AppShell';
import { FlipCard, TarotCardBack, orientationLabel } from '@/components/TarotCard';
import { TarotSpreadSlots } from '@/components/TarotSpread';
import { Button, Card, ErrorState, IconButton, PageHeader, cx } from '@/components/ui';
import { SessionGateError, useSessionGate } from '@/hooks/useSessionGate';
import { ApiError, api } from '@/lib/api';
import { track } from '@/lib/analytics';
import { t } from '@/lib/copy';
import { useSession } from '@/lib/session';
import { storage } from '@/lib/storage';
import { TAROT_DRAFT_KEY, draftExtras, type TarotDraft } from '@/lib/tarot';

type Step = 'shuffle' | 'pick' | 'reveal';
const STEPS: { key: Step; label: string }[] = [
  { key: 'shuffle', label: '섞기' },
  { key: 'pick', label: '고르기' },
  { key: 'reveal', label: '펼치기' },
];
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 남은 자리 중 무작위 n개 (알아서 골라 주세요) */
function randomPicks(taken: number[], n: number, size: number): number[] {
  const free = Array.from({ length: size }, (_, i) => i).filter((i) => !taken.includes(i));
  const out: number[] = [];
  const buf = new Uint32Array(1);
  while (out.length < n && free.length > 0) {
    crypto.getRandomValues(buf);
    out.push(free.splice(buf[0]! % free.length, 1)[0]!);
  }
  return out;
}

/** 섞기 → 고르기 → 펼치기 */
export function TarotDrawPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const gate = useSessionGate();
  const token = useSession((s) => s.accessToken);
  const [draft] = useState(() => storage.getJSON<TarotDraft>(TAROT_DRAFT_KEY));
  const spreadKey = draft ? TAROT_TOPICS[draft.topic]?.spread : undefined;
  const spread = spreadKey ? TAROT_SPREADS[spreadKey] : undefined;

  const [step, setStep] = useState<Step>('shuffle');
  const [deck, setDeck] = useState<TarotShuffleResultDto | null>(null);
  const [shuffling, setShuffling] = useState(false);
  const [picks, setPicks] = useState<number[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [reading, setReading] = useState<TarotReadingDto | null>(null);
  const [flipped, setFlipped] = useState<boolean[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** 예·아니오 하루 무료 횟수를 다 쓴 경우 — 오늘 본 리딩 */
  const [limitReadingId, setLimitReadingId] = useState<string | null>(null);
  const started = useRef(false);

  const shuffle = useCallback(async () => {
    if (!draft || !spreadKey) return;
    setShuffling(true);
    setError(null);
    setPicks([]);
    const t0 = Date.now();
    try {
      const d = await api.tarotShuffle({ spread: spreadKey, topic: draft.topic, question: draft.question || undefined, ...draftExtras(draft) });
      // 섞는 연출(1.2초)은 서버에서 섞기가 끝난 뒤 남은 시간만큼만 보여 준다 — 모션 감소 시 생략
      const wait = reducedMotion() ? 0 : Math.max(0, 1200 - (Date.now() - t0));
      window.setTimeout(() => {
        setDeck(d);
        setShuffling(false);
      }, wait);
    } catch (e) {
      const limited = e instanceof ApiError && e.status === 429 ? (e.details as { readingId?: string } | undefined)?.readingId : undefined;
      if (limited) setLimitReadingId(limited);
      else setError(e instanceof ApiError ? e.message : t('tarot.error.draw.body'));
      setShuffling(false);
    }
  }, [draft, spreadKey]);

  useEffect(() => {
    if (token && !started.current) {
      started.current = true;
      void shuffle();
    }
  }, [token, shuffle]);

  if (!draft || !spread || !spreadKey) return <Navigate to="/tarot" replace />;
  const need = spread.cards;
  const nextSlot = picks.length;

  const pick = (pos: number) => {
    if (picks.includes(pos) || picks.length >= need) return;
    setPicks((p) => [...p, pos]);
  };

  const draw = async () => {
    if (!deck) return;
    setDrawing(true);
    setError(null);
    try {
      const r = await api.tarotDraw({ deckToken: deck.deckToken, picks, spread: spreadKey, topic: draft.topic, question: draft.question || undefined, profileId: draft.profileId, ...draftExtras(draft) });
      qc.setQueryData(['tarot', 'reading', r.id], r);
      void qc.invalidateQueries({ queryKey: ['tarot', 'history'] });
      track('tarot_drawn', { spread: spreadKey, topic: draft.topic });
      setReading(r);
      setFlipped(r.cards.map(() => false));
      setStep('reveal');
    } catch (e) {
      const readingId = e instanceof ApiError && (e.status === 409 || e.status === 429) ? (e.details as { readingId?: string } | undefined)?.readingId : undefined;
      if (readingId) navigate(`/tarot/r/${readingId}`, { replace: true });
      else setError(e instanceof ApiError ? e.message : t('tarot.error.draw.body'));
    } finally {
      setDrawing(false);
    }
  };

  const flipAll = () => {
    if (!reading) return;
    const gap = reducedMotion() ? 0 : 320;
    reading.cards.forEach((_, i) => window.setTimeout(() => setFlipped((f) => f.map((v, j) => (j === i ? true : v))), i * gap));
  };
  const allFlipped = flipped.length > 0 && flipped.every(Boolean);
  const toResult = () => {
    storage.remove(TAROT_DRAFT_KEY);
    navigate(`/tarot/r/${reading!.id}`, { replace: true });
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const pos = spread.positions[Math.min(nextSlot, need - 1)]!;

  return (
    <div className="min-h-page pb-44 lg:pb-16">
      <PageHeader
        left={
          <IconButton label={t('common.back')} onClick={() => navigate(-1)}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
        title={t(`tarot.topics.${draft.topic}.label`)}
        width="medium"
      />
      <Page width="medium">
        {gate.failed && <SessionGateError onRetry={gate.retry} />}
        <ol className="mt-2 flex items-center gap-2 text-sm" aria-label="진행 단계">
          {STEPS.map((s, i) => (
            <li key={s.key} aria-current={i === stepIndex ? 'step' : undefined} className={cx('flex items-center gap-1.5', i === stepIndex ? 'font-semibold text-ink' : i < stepIndex ? 'text-ink-2' : 'text-ink-3')}>
              <span className={cx('grid size-5 place-items-center rounded-full text-[11px]', i <= stepIndex ? 'bg-action text-on-action' : 'bg-subtle')}>{i < stepIndex ? '✓' : i + 1}</span>
              {s.label}
              {i < STEPS.length - 1 && <span className="mx-1 text-ink-3" aria-hidden>·</span>}
            </li>
          ))}
        </ol>

        {error && (
          <div className="mt-6">
            <ErrorState title={t('tarot.error.draw.title')} body={error} onRetry={() => void shuffle()} />
          </div>
        )}

        {/* 예·아니오 하루 무료 횟수를 다 쓴 경우 — 오늘 본 카드로 안내 */}
        {limitReadingId && (
          <Card className="mt-8">
            <p className="font-semibold">{t('tarot.error.yesnoLimit.title')}</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">{t('tarot.error.yesnoLimit.body')}</p>
            <Link to={`/tarot/r/${limitReadingId}`} replace className="mt-3 inline-flex h-10 items-center rounded-full bg-action px-4 text-sm font-semibold text-on-action">
              {t('tarot.error.yesnoLimit.cta')}
            </Link>
          </Card>
        )}

        {/* 1. 섞기 */}
        {step === 'shuffle' && !error && !limitReadingId && (
          <section className="mt-8 text-center" aria-live="polite">
            <h2 className="font-serif text-[22px] font-semibold">{shuffling ? t('tarot.shuffle.title') : t('tarot.shuffle.done')}</h2>
            <p className="mt-2 text-[15px] text-ink-2">{t('tarot.shuffle.hint')}</p>
            {draft.question && <p className="mt-4 font-serif text-lg">“{draft.question}”</p>}
            <div className="relative mx-auto mt-10 h-56 w-36" aria-label={shuffling ? t('tarot.a11y.shuffling') : t('tarot.a11y.shuffled')} role="img">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={`${i}-${shuffling}`}
                  className={cx('absolute inset-0', shuffling && 'animate-shuffle')}
                  style={{ ['--shuffle-x' as string]: `${(i % 2 ? 1 : -1) * (24 + i * 10)}px`, ['--shuffle-r' as string]: `${(i % 2 ? 1 : -1) * (3 + i)}deg`, animationDelay: `${i * 60}ms`, transform: `translate(${i * 1.5}px, ${-i * 1.5}px)` }}
                >
                  <TarotCardBack className="h-full w-full" />
                </div>
              ))}
            </div>
            <p className="mt-8 text-xs text-ink-3">{t('tarot.shuffle.randomNote')}</p>
            {deck?.existingReadingId && (
              <Card className="mt-6 text-left">
                <p className="font-semibold">{t('tarot.existing.title')}</p>
                <p className="mt-1 text-sm text-ink-2">{t('tarot.existing.body')}</p>
                <Link to={`/tarot/r/${deck.existingReadingId}`} replace className="mt-3 inline-flex h-10 items-center rounded-full bg-action px-4 text-sm font-semibold text-on-action">
                  {t('tarot.existing.cta')}
                </Link>
              </Card>
            )}
          </section>
        )}

        {/* 2. 고르기 · 3. 펼치기 — 자리 슬롯 */}
        {step !== 'shuffle' && (
          <section className="mt-6">
            {step === 'pick' ? (
              <>
                <h2 className="font-serif text-[22px] font-semibold">{need === 1 ? t('tarot.pick.titleOne') : t('tarot.pick.title', { count: need })}</h2>
                <p className="mt-1 text-[15px] text-ink-2" aria-live="polite">
                  {picks.length < need ? (
                    <>
                      {t('tarot.pick.positionPrompt', { position: pos.label })} <span className="text-ink-3">— {pos.hint}</span>
                    </>
                  ) : (
                    t('tarot.pick.allPicked', { count: need })
                  )}
                </p>
              </>
            ) : (
              <>
                <h2 className="font-serif text-[22px] font-semibold">{t('tarot.reveal.tapToFlip')}</h2>
                <p className="mt-1 text-[15px] text-ink-2">{t('tarot.paywall.sameCards')}</p>
              </>
            )}
            <TarotSpreadSlots
              className="mt-5"
              spread={spreadKey}
              label={t('tarot.result.cardsTitle')}
              renderCard={(i) => {
                const p = spread.positions[i]!;
                const card = reading?.cards[i] ?? null;
                if (step === 'reveal' && card) {
                  return (
                    <button
                      type="button"
                      className="block w-full"
                      onClick={() => setFlipped((f) => f.map((v, j) => (j === i ? true : v)))}
                      aria-label={flipped[i] ? `${p.label}: ${card.nameKo} ${orientationLabel(card.orientation)}` : `${p.label} 카드 펼치기`}
                    >
                      <FlipCard card={card} flipped={Boolean(flipped[i])} />
                    </button>
                  );
                }
                if (i < picks.length) return <TarotCardBack />;
                return (
                  <div
                    className={cx('aspect-[2/3] rounded-xl border-2 border-dashed bg-canvas', i === nextSlot && step === 'pick' ? 'border-ink' : 'border-line-strong')}
                    aria-label={t('tarot.a11y.slotEmpty', { position: p.label })}
                  />
                );
              }}
              caption={(i) => {
                const card = reading?.cards[i];
                return step === 'reveal' && card && flipped[i] ? (
                  <span className="mt-0.5 block text-xs text-ink-3">
                    {card.nameKo} · {orientationLabel(card.orientation)}
                  </span>
                ) : null;
              }}
            />
          </section>
        )}

        {/* 고르기 띠 — 78장 뒷면, 순서는 서버만 안다 */}
        {step === 'pick' && (
          <section className="mt-6">
            <p className="text-xs text-ink-3 lg:hidden">{t('tarot.pick.scrollHint')}</p>
            <ul className={cx('no-scrollbar -mx-5 mt-2 flex overflow-x-auto px-5 pb-4 pt-3 lg:mx-0 lg:grid lg:grid-cols-13 lg:gap-2 lg:overflow-visible lg:px-0', picks.length >= need && 'opacity-40')} aria-label={t('tarot.a11y.ribbon')}>
              {Array.from({ length: deck?.deckSize ?? 78 }, (_, i) => {
                const taken = picks.includes(i);
                return (
                  <li key={i} className="-ml-7 shrink-0 first:ml-0 lg:ml-0">
                    <button
                      type="button"
                      disabled={taken || picks.length >= need}
                      onClick={() => pick(i)}
                      aria-label={`${i + 1}번째 카드 고르기`}
                      className={cx('block w-[72px] transition-transform duration-200 hover:-translate-y-2 focus-visible:-translate-y-2 disabled:hover:translate-y-0 lg:w-full', taken && 'invisible')}
                    >
                      <TarotCardBack />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </Page>

      {/* 하단 버튼 */}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas lg:static lg:border-0 lg:bg-transparent">
        <div className="mx-auto max-w-xl space-y-1 px-5 py-3 lg:max-w-3xl lg:px-8 lg:pt-8">
          {step === 'shuffle' && !limitReadingId && (
            <>
              <Button block size="lg" disabled={shuffling || !deck || Boolean(deck.existingReadingId)} onClick={() => setStep('pick')}>
                {t('tarot.shuffle.next')}
              </Button>
              <Button block variant="ghost" size="sm" disabled={shuffling} onClick={() => void shuffle()}>
                {t('tarot.shuffle.again')}
              </Button>
            </>
          )}
          {step === 'pick' && (
            <>
              <Button block size="lg" disabled={picks.length < need} loading={drawing} onClick={() => void draw()}>
                {picks.length < need ? `${t('tarot.pick.submit')} · ${t('tarot.pick.progress', { picked: picks.length, count: need })}` : t('tarot.pick.submit')}
              </Button>
              <div className="flex justify-center gap-4">
                {picks.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setPicks((p) => p.slice(0, -1))}>
                    {t('tarot.pick.undo')}
                  </Button>
                )}
                {picks.length < need && (
                  <Button variant="ghost" size="sm" onClick={() => setPicks((p) => [...p, ...randomPicks(p, need - p.length, deck?.deckSize ?? 78)])}>
                    {t('tarot.pick.autoPick')}
                  </Button>
                )}
              </div>
            </>
          )}
          {step === 'reveal' && (
            <>
              <Button block size="lg" disabled={!allFlipped} onClick={toResult}>
                {t('tarot.reveal.toResult')}
              </Button>
              {!allFlipped && (
                <Button block variant="ghost" size="sm" onClick={flipAll}>
                  {t('tarot.reveal.flipAll')}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
