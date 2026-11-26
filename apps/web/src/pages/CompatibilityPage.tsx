import { Share2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProductDto, ReadingSection } from '@saju/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Page } from '@/components/AppShell';
import { BottomSheet } from '@/components/BottomSheet';
import { PaywallSheet } from '@/components/PaywallSheet';
import { ReadingSectionCard } from '@/components/ReadingSection';
import { ShareSheet } from '@/components/ShareSheet';
import { OpenReportCard } from '@/components/OpenReportCard';
import { toast } from '@/components/Toast';
import { Button, Card, EmptyState, ErrorState, PageHeader, ScoreBar, Spinner, cx } from '@/components/ui';
import { qk, useProducts, useProfiles } from '@/hooks/queries';
import { SessionGateError, useSessionGate } from '@/hooks/useSessionGate';
import { usePurchase } from '@/hooks/usePurchase';
import { ApiError, api } from '@/lib/api';
import { track } from '@/lib/analytics';
import { t } from '@/lib/copy';
import { targetFortuneYear, won } from '@/lib/format';

const CAT_LABEL = { personality: '성격', romance: '끌림·애정', stability: '안정·생활', complement: '상호 보완' } as const;

export function CompatibilityPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const gate = useSessionGate();
  const profiles = useProfiles();
  const list = profiles.data ?? [];
  const a = params.get('a') ?? list.find((p) => p.isPrimary)?.id ?? list[0]?.id;
  const b = params.get('b') ?? undefined;
  const qc = useQueryClient();
  const [picking, setPicking] = useState<'a' | 'b' | null>(null);
  const [paywall, setPaywall] = useState(false);
  /** 가진 궁합 1회권 수 — 잠금을 눌렀을 때 1회권이 있으면 바로 쓰지 않고 이 수와 함께 먼저 묻는다 */
  const [ticketAsk, setTicketAsk] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const purchase = usePurchase();
  const { data: products } = useProducts();
  const compatProduct = products?.find((p) => p.id === 'report_compat');

  const result = useQuery({ queryKey: ['compat', a, b], queryFn: () => api.compatibility({ profileIdA: a, profileIdB: b }), enabled: Boolean(a && b && a !== b) });
  useEffect(() => {
    if (result.data) track('compatibility_viewed', { score: result.data.result.score });
  }, [result.data]);

  const unlock = useMutation({
    mutationFn: () => api.createReport({ type: 'compatibility', profileId: a!, partnerProfileId: b! }),
    onSuccess: () => {
      setTicketAsk(null);
      toast('궁합 1회권을 사용했어요');
      void qc.invalidateQueries({ queryKey: qk.wallet });
      void result.refetch();
    },
    onError: (e) => {
      setTicketAsk(null);
      if (e instanceof ApiError && (e.status === 402 || e.status === 403)) setPaywall(true);
      else toast(e instanceof Error ? e.message : t('error.server.title'));
    },
  });

  /** 잠금 누름 — 1회권이 있으면 어느 조합에 쓸지 확인을 받고, 없으면 결제 시트를 연다 */
  const onUnlock = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const wallet = await qc.fetchQuery({ queryKey: qk.wallet, queryFn: api.wallet, staleTime: 0 });
      const tickets = wallet.entitlements.filter((e) => e.key.startsWith('ticket:compatibility:')).length;
      if (tickets > 0) setTicketAsk(tickets);
      else setPaywall(true);
    } catch {
      setPaywall(true);
    } finally {
      setChecking(false);
    }
  };

  const setPerson = (slot: 'a' | 'b', id: string) => {
    const next = new URLSearchParams(params);
    if (a && !next.get('a')) next.set('a', a);
    next.set(slot, id);
    setParams(next, { replace: true });
    setPicking(null);
  };
  const nameOf = (id?: string) => list.find((p) => p.id === id)?.name;
  const r = result.data;

  const onPurchase = async (product: ProductDto) => {
    await purchase({ product, profileId: a, partnerProfileId: product.requiresPartner ? b : undefined, returnTo: `/compatibility?a=${a}&b=${b}`, profileName: nameOf(a) });
  };

  return (
    <div className="min-h-page">
      <PageHeader title={t('compatibility.title')} width="wide" />
      <Page width="wide" className="pb-10">
        {gate.failed && <SessionGateError onRetry={gate.retry} />}
        {profiles.isLoading && <Spinner />}
        {profiles.isFetched && list.length === 0 && (
          <EmptyState
            title={t('empty.compatibility.title')}
            body={t('empty.compatibility.body')}
            action={<Button onClick={() => navigate('/profiles/new?save=1&relation=self&next=/compatibility')}>{t('empty.compatibility.cta')}</Button>}
          />
        )}
        <div className="lg:grid lg:grid-cols-[380px_minmax(0,1fr)] lg:items-start lg:gap-12">
          {list.length > 0 && (
            <div className="lg:sticky lg:top-8">
              <h2 className="mt-2 font-serif text-[22px] font-semibold">{t('compatibility.pickTitle')}</h2>
              <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <button type="button" onClick={() => setPicking('a')} className="h-14 rounded-2xl border border-line-strong bg-surface px-3 font-semibold">
                  {nameOf(a) ?? t('compatibility.pickPerson')}
                </button>
                <span className="font-serif text-xl text-ink-3">×</span>
                <button type="button" onClick={() => setPicking('b')} className={cx('h-14 rounded-2xl border px-3 font-semibold', b ? 'border-line-strong bg-surface' : 'border-dashed border-line-strong text-ink-3')}>
                  {nameOf(b) ?? `+ ${t('compatibility.pickPerson')}`}
                </button>
              </div>
            </div>
          )}

          <div>
            {list.length > 0 && !b && (
              <div className="mt-10 rounded-2xl border border-dashed border-line-strong p-6 text-center lg:mt-2 lg:p-10">
                <p className="font-serif text-lg">두 사람이 얼마나 잘 맞는지 볼까요?</p>
                <p className="mt-2 text-sm text-ink-2">상대를 선택하면 두 사람의 사주를 비교해 궁합 점수와 잘 맞는 점을 보여 드려요. 목록에 없는 상대는 고르는 화면에서 새로 추가할 수 있어요.</p>
                <Button className="mt-4" onClick={() => setPicking('b')}>
                  {t('compatibility.pickPerson')}
                </Button>
              </div>
            )}
            {result.isLoading && <Spinner />}
            {result.error && <ErrorState title={t('error.server.title')} onRetry={() => result.refetch()} />}
            {r && (
              <div className="animate-fade mt-8 lg:mt-2">
                <Card className="text-center">
                  <p className="text-sm text-ink-3">
                    {r.a.name} × {r.b.name}
                  </p>
                  <p className="tabular mt-3 font-serif text-6xl font-semibold">{r.result.score}</p>
                  <p className="mt-1 text-sm font-semibold text-gold">{r.gradeLabel}</p>
                  <p className="mt-4 font-serif text-lg leading-snug">{r.headline}</p>
                  <p className="mt-2 text-xs text-ink-3">두 사람의 태어난 날 글자(일간·일지)와 띠의 관계, 오행의 보완 정도를 달달사주 기준으로 환산한 점수예요(100점 만점, 서비스 자체 지표).</p>
                  <p className="mt-6 text-left text-sm text-ink-3">항목별 점수예요. 막대가 길수록 잘 맞아요.</p>
                  <ul className="mt-3 space-y-3 text-left">
                    {(Object.keys(CAT_LABEL) as (keyof typeof CAT_LABEL)[]).map((k) => (
                      <li key={k}>
                        <p className="mb-1 text-sm font-semibold">{CAT_LABEL[k]}</p>
                        <ScoreBar score={r.result.categories[k]} label={CAT_LABEL[k]} />
                      </li>
                    ))}
                  </ul>
                </Card>
                <div className="mt-2">
                  {r.sections.map((s: ReadingSection, i: number) => (
                    <ReadingSectionCard
                      key={s.key}
                      section={s}
                      onUnlock={() => void onUnlock()}
                      price={compatProduct?.purchasable ? won(compatProduct.price) : undefined}
                      compactLock={r.sections.findIndex((x: ReadingSection) => x.locked) < i}
                    />
                  ))}
                </div>
                {a && b && !r.sections.some((s: ReadingSection) => s.locked) && (
                  <OpenReportCard
                    dto={{ type: 'compatibility', profileId: a, partnerProfileId: b }}
                    title="궁합 리포트 전체"
                    body="두 사람의 타고난 성향과 오행의 균형, 끌림과 주의할 점, 대화·갈등 방식, 서로를 대하는 방법, 올해·내년의 흐름까지 담은 리포트예요."
                  />
                )}
                <Button variant="secondary" block className="mt-2 lg:w-auto lg:px-8" onClick={() => setShareOpen(true)}>
                  <Share2 className="size-4" aria-hidden />
                  {t('common.share')}
                </Button>
                <ShareSheet
                  open={shareOpen}
                  onClose={() => setShareOpen(false)}
                  payload={{
                    title: t('share.kakaoCompatibility.title'),
                    text: t('share.kakaoCompatibility.description', { nameA: r.a.name, nameB: r.b.name }),
                    url: `${window.location.origin}/compatibility`,
                    buttons: [{ title: t('share.kakaoCompatibility.buttonPrimary'), url: `${window.location.origin}/compatibility` }],
                  }}
                />
                <p className="mt-6 text-xs text-ink-3">{t('disclaimer.short')}</p>
              </div>
            )}
          </div>
        </div>
      </Page>

      <BottomSheet open={picking !== null} onClose={() => setPicking(null)} title={t('compatibility.pickPerson')}>
        <ul className="divide-y divide-line">
          {list
            .filter((p) => p.id !== (picking === 'a' ? b : a))
            .map((p) => (
              <li key={p.id}>
                <button type="button" className="flex w-full items-center justify-between py-3.5 text-left" onClick={() => setPerson(picking!, p.id)}>
                  {p.name}
                  <span className="text-sm text-ink-3">
                    {p.zodiac}띠 · {p.birth.year}년생
                  </span>
                </button>
              </li>
            ))}
        </ul>
        <Button variant="secondary" block className="mt-3" onClick={() => navigate(`/profiles/new?save=1&relation=partner&next=${encodeURIComponent('/compatibility')}`)}>
          {t('empty.compatibility.cta')}
        </Button>
      </BottomSheet>
      <BottomSheet
        open={ticketAsk !== null}
        onClose={() => setTicketAsk(null)}
        title="궁합 1회권을 쓸까요?"
        footer={
          <div className="space-y-2">
            <Button block size="lg" loading={unlock.isPending} onClick={() => unlock.mutate()}>
              1회권 1장 쓰기
            </Button>
            <Button block variant="secondary" onClick={() => setTicketAsk(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        }
      >
        <p className="text-[15px] leading-relaxed text-ink-2">
          궁합 1회권 {ticketAsk ?? 0}장을 가지고 있어요. {nameOf(a)} × {nameOf(b)} 궁합에 1장을 쓰면 이 두 사람의 상세 풀이와 궁합 리포트가 열려요. 한 번 쓴 1회권은 다른 두 사람에게 옮길 수 없어요.
        </p>
      </BottomSheet>
      {/* 신년 패키지는 대상 연도의 것을 넣는다 — 그해 상품이 없으면 결제 시트가 목록에서 뺀다 */}
      <PaywallSheet open={paywall} onClose={() => setPaywall(false)} productIds={['report_compat', `bundle_newyear_${targetFortuneYear()}`]} subtitle="잘 맞는 점 · 부딪히는 점 · 함께 지내는 법" onPurchase={onPurchase} />
    </div>
  );
}
