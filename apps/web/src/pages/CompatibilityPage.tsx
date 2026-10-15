import { useMutation, useQuery } from '@tanstack/react-query';
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
import { Button, Card, Chip, EmptyState, ErrorState, PageHeader, ScoreBar, Spinner, cx } from '@/components/ui';
import { useProducts, useProfiles } from '@/hooks/queries';
import { SessionGateError, useSessionGate } from '@/hooks/useSessionGate';
import { usePurchase } from '@/hooks/usePurchase';
import { ApiError, api } from '@/lib/api';
import { track } from '@/lib/analytics';
import { t } from '@/lib/copy';
import { won } from '@/lib/format';

const RELATIONS = ['lover', 'crush', 'friend', 'family', 'coworker'] as const;
const CAT_LABEL = { personality: '성격', romance: '끌림·애정', stability: '안정·생활', complement: '서로 채워줌' } as const;

export function CompatibilityPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const gate = useSessionGate();
  const profiles = useProfiles();
  const list = profiles.data ?? [];
  const a = params.get('a') ?? list.find((p) => p.isPrimary)?.id ?? list[0]?.id;
  const b = params.get('b') ?? undefined;
  const [picking, setPicking] = useState<'a' | 'b' | null>(null);
  const [relation, setRelation] = useState<(typeof RELATIONS)[number]>('lover');
  const [paywall, setPaywall] = useState(false);
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
      toast('궁합 1회권을 사용했어요');
      void result.refetch();
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.status === 402 || e.status === 403)) setPaywall(true);
      else toast(e instanceof Error ? e.message : t('error.server.title'));
    },
  });

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
            <div className="lg:sticky lg:top-24">
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
              <p className="mt-5 text-sm font-semibold text-ink-2">{t('compatibility.relationLabel')}</p>
              <div className="no-scrollbar -mx-5 mt-2 flex gap-2 overflow-x-auto px-5 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
                {RELATIONS.map((rel) => (
                  <Chip key={rel} active={relation === rel} onClick={() => setRelation(rel)}>
                    {t(`compatibility.relations.${rel}`)}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          <div>
            {list.length > 0 && !b && (
              <div className="mt-10 rounded-2xl border border-dashed border-line-strong p-6 text-center lg:mt-2 lg:p-10">
                <p className="font-serif text-lg">두 사람이 얼마나 잘 맞는지 볼까요?</p>
                <p className="mt-2 text-sm text-ink-2">상대를 고르면 태어난 날과 시간으로 궁합 점수와 잘 맞는 점을 바로 보여 드려요. 상대는 마이에서 추가할 수 있어요.</p>
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
                  <p className="mt-2 text-xs text-ink-3">두 사람이 태어난 날과 시간으로 본 점수예요(100점 만점).</p>
                  <p className="mt-6 text-left text-sm text-ink-3">나눠서 보면 이래요. 막대가 길수록 잘 맞아요.</p>
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
                  {r.sections.map((s: ReadingSection) => (
                    <ReadingSectionCard key={s.key} section={s} onUnlock={() => unlock.mutate()} price={compatProduct?.purchasable ? won(compatProduct.price) : undefined} />
                  ))}
                </div>
                {a && b && !r.sections.some((s: ReadingSection) => s.locked) && (
                  <OpenReportCard
                    dto={{ type: 'compatibility', profileId: a, partnerProfileId: b }}
                    title="궁합 리포트 전체"
                    body="타고난 성향과 다섯 가지 기운의 균형, 끌림과 조심할 점, 대화·다툼 방식, 서로를 위한 사용설명서, 올해·내년 흐름까지 담은 리포트예요."
                  />
                )}
                <Button variant="secondary" block className="mt-2" onClick={() => setShareOpen(true)}>
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
      <PaywallSheet open={paywall} onClose={() => setPaywall(false)} productIds={['report_compat', 'bundle_newyear_2027']} subtitle="잘 맞는 점 · 부딪히는 점 · 함께 지내는 법" onPurchase={onPurchase} />
    </div>
  );
}
