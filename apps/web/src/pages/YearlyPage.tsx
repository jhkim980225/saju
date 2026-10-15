import { useQuery } from '@tanstack/react-query';
import type { ProductDto } from '@saju/shared';
import { ArrowLeft, Lock } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Page } from '@/components/AppShell';
import { KeyPointsCard } from '@/components/KeyPointsCard';
import { OpenReportCard } from '@/components/OpenReportCard';
import { PaywallSheet } from '@/components/PaywallSheet';
import { ReadingSectionCard } from '@/components/ReadingSection';
import { Badge, Button, Card, ErrorState, IconButton, PageHeader, Spinner, cx } from '@/components/ui';
import { useProducts, useProfiles } from '@/hooks/queries';
import { usePurchase } from '@/hooks/usePurchase';
import { api } from '@/lib/api';
import { t } from '@/lib/copy';
import { targetFortuneYear, won } from '@/lib/format';

/** 신년운세 — 미구매 시 총운·첫 두 달 공개 */
export function YearlyPage() {
  const navigate = useNavigate();
  const { profileId } = useParams();
  const [params] = useSearchParams();
  const year = Number(params.get('year')) || targetFortuneYear();
  const profiles = useProfiles();
  const profile = profiles.data?.find((p) => p.id === profileId);
  const q = useQuery({ queryKey: ['yearly', profileId, year], queryFn: () => api.yearly(profileId!, year), enabled: Boolean(profileId) });
  const [paywall, setPaywall] = useState(false);
  const purchase = usePurchase();
  const { data: products } = useProducts();
  const productId = `report_newyear_${year}`;
  const product = products?.find((p) => p.id === productId);
  const d = q.data;
  // '나'·'본인' 같은 이름은 부르지 않는다(서버 displayName 과 같은 기준)
  const callName = profile && !['나', '본인', ''].includes(profile.name.trim()) ? profile.name.trim() : null;
  const firstLocked = d?.months.find((m) => m.locked);
  const onPurchase = async (p: ProductDto) => {
    await purchase({ product: p, profileId, returnTo: `/yearly/${profileId}?year=${year}`, profileName: profile?.name });
  };

  return (
    <div className="min-h-page">
      <PageHeader
        left={
          <IconButton label={t('common.back')} onClick={() => navigate(-1)}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
        title={`${year} 신년운세`}
        width="wide"
      />
      <Page width="wide" className="pb-12">
        {q.isLoading && <Spinner />}
        {q.error && <ErrorState title={t('error.server.title')} onRetry={() => q.refetch()} />}
        {d && (
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-12">
            <div>
              <section className="pt-4">
                <p className="text-sm text-ink-3">
                  {callName ? `${callName}님의 ` : ''}
                  {year}년 · {d.yearName ? `${d.yearName}(${d.yearPillar.hangul}년)` : `${d.yearPillar.hangul}년`}
                </p>
                <h1 className="mt-2 font-serif text-[26px] font-semibold leading-snug lg:text-[32px]">{d.headline}</h1>
                <div className="mt-3 flex gap-2">
                  <Badge tone="gold">총운 {d.evaluation.scores.total}점</Badge>
                  {d.gradeLabel && <Badge>{d.gradeLabel}</Badge>}
                </div>
                {d.keyPoints && <KeyPointsCard title={`한눈에 보는 ${year}년`} items={d.keyPoints} />}
              </section>
              {d.sections.map((s) => (
                <ReadingSectionCard key={s.key} section={s} onUnlock={() => setPaywall(true)} price={product?.purchasable ? won(product.price) : undefined} />
              ))}
            </div>
            <div className="lg:pt-4">
              <Card className="mt-2 lg:mt-0">
                <h2 className="font-semibold">열두 달의 흐름</h2>
                <p className="mt-1 text-sm text-ink-3">막대가 길수록 좋은 달이에요. 사주의 한 달은 매달 4~8일 무렵에 시작해요.</p>
                <ol className="mt-4 space-y-3">
                  {d.months.map((m, i) => (
                    <li key={m.order} className="grid grid-cols-[4.5rem_1fr] items-start gap-3">
                      <div>
                        <p className="text-sm font-semibold">{m.label.split(' ')[0]}</p>
                        {i === d.months.length - 1 && <p className="text-xs text-ink-3">다음 해</p>}
                      </div>
                      {m.locked ? (
                        // 잠긴 달은 자물쇠만 — 같은 안내문을 열 번 늘어놓지 않고 목록 아래 한 줄로
                        <p className="flex items-center gap-2 pt-0.5 text-sm text-ink-3">
                          <Lock className="size-3.5 shrink-0" aria-label="잠김" />
                          <span className="h-1.5 flex-1 rounded-full bg-subtle" aria-hidden />
                          {m.summary && <span>{m.summary}</span>}
                        </p>
                      ) : (
                        <div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
                            <div className={cx('h-full rounded-full bg-action')} style={{ width: `${m.score}%` }} />
                          </div>
                          <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{m.summary}</p>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
                {firstLocked && <p className="mt-4 text-sm text-ink-3">{firstLocked.label.split(' ')[0]}부터는 전체 보기에서 볼 수 있어요.</p>}
              </Card>
              {d.locked && (
                <Button block size="lg" className="mt-6" onClick={() => setPaywall(true)}>
                  {product ? `${year} 신년운세 전체 보기 · ${won(product.price)}` : '전체 보기'}
                </Button>
              )}
              {!d.locked && profileId && (
                <OpenReportCard
                  dto={{ type: 'yearly', profileId, year }}
                  title={`${year} 신년운세 리포트`}
                  body="총운과 재물·애정·직장·건강, 열두 달마다 영역별 흐름과 실천 한 가지까지 담은 A4 10쪽 분량의 리포트예요."
                />
              )}
              <p className="mt-6 text-xs text-ink-3">{t('disclaimer.standard')}</p>
            </div>
          </div>
        )}
      </Page>
      <PaywallSheet open={paywall} onClose={() => setPaywall(false)} productIds={[productId, `bundle_newyear_${year}`]} name={profile?.name} subtitle="총운 · 재물 · 애정 · 직장 · 건강 · 열두 달 흐름" onPurchase={onPurchase} />
    </div>
  );
}
