import type { ProductDto } from '@saju/shared';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Page } from '@/components/AppShell';
import { BottomSheet } from '@/components/BottomSheet';
import { Badge, Button, Card, IconButton, PageHeader, Spinner, cx } from '@/components/ui';
import { useProducts, useProfiles } from '@/hooks/queries';
import { usePurchase } from '@/hooks/usePurchase';
import { t } from '@/lib/copy';
import { won } from '@/lib/format';

const GROUPS: { title: string; type: ProductDto['type'][] }[] = [
  { title: '사주 리포트', type: ['one_time'] },
  { title: 'AI 상담 질문권', type: ['credit_pack'] },
  { title: '플러스 구독', type: ['subscription'] },
];

export function StorePage() {
  const navigate = useNavigate();
  const { data, isLoading } = useProducts();
  const profiles = useProfiles();
  const purchase = usePurchase();
  const [target, setTarget] = useState<ProductDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buy = async (p: ProductDto, profileId?: string) => {
    setBusy(p.id);
    setError(null);
    try {
      await purchase({ product: p, profileId, returnTo: profileId ? `/saju/${profileId}` : '/my/payments' });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('payment.failBody'));
    } finally {
      setBusy(null);
      setTarget(null);
    }
  };
  const onClick = (p: ProductDto) => {
    if (p.requiresProfile) setTarget(p);
    else void buy(p);
  };

  return (
    <div className="min-h-page">
      <PageHeader
        left={
          <IconButton label={t('common.back')} onClick={() => navigate(-1)}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
        title="이용권 · 리포트"
        width="wide"
      />
      <Page width="wide" className="space-y-8 pb-10 lg:space-y-12 lg:pt-4">
        {isLoading && <Spinner />}
        {error && (
          <p role="alert" className="rounded-xl bg-subtle p-3 text-sm text-danger">
            {error}
          </p>
        )}
        {GROUPS.map((g) => {
          // 타로 깊은 풀이처럼 리딩 하나를 여는 상품은 그 결과 화면에서만 판다
          const items = (data ?? []).filter((p) => g.type.includes(p.type) && !p.requiresReading);
          if (items.length === 0) return null;
          return (
            <section key={g.title}>
              <h2 className="text-lg font-semibold">{g.title}</h2>
              <ul className="mt-3 space-y-3 lg:mt-4 lg:grid lg:grid-cols-3 lg:gap-4 lg:space-y-0">
                {items.map((p) => (
                  <li key={p.id}>
                    <Card className={cx('flex h-full flex-col', p.comingSoon && 'opacity-60')}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="flex flex-wrap items-center gap-2 font-semibold">
                            {p.name}
                            {p.badge && <Badge tone="gold">{p.badge}</Badge>}
                            {p.comingSoon && <Badge>출시 예정</Badge>}
                          </p>
                          <p className="mt-1 text-sm leading-relaxed text-ink-2">{p.description}</p>
                        </div>
                      </div>
                      <div className="mt-auto flex flex-col pt-4">
                        <div className="flex items-center justify-between">
                          <p className="flex items-baseline gap-2">
                            <span className="tabular text-lg font-bold">{won(p.price)}</span>
                            {p.listPrice && <span className="tabular text-sm text-ink-3 line-through">{won(p.listPrice)}</span>}
                            {p.periodDays && <span className="text-sm text-ink-3">/ {p.periodDays === 30 ? '월' : '년'}</span>}
                          </p>
                          <Button size="sm" disabled={!p.purchasable} loading={busy === p.id} onClick={() => onClick(p)}>
                            {p.comingSoon ? '준비 중' : !p.purchasable ? '구매 완료' : '구매하기'}
                          </Button>
                        </div>
                        {p.saleEndsAt && <p className="mt-2 text-xs text-gold lg:order-first lg:mb-2 lg:mt-0">할인 마감 {new Date(p.saleEndsAt).toLocaleDateString('ko-KR')}</p>}
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        <p className="text-xs leading-relaxed text-ink-3">{t('paywall.terms')} 결제 금액은 부가세 포함이에요.</p>
      </Page>

      <BottomSheet open={target !== null} onClose={() => setTarget(null)} title="누구의 리포트를 볼까요?">
        {profiles.data && profiles.data.length === 0 && (
          <Button block onClick={() => navigate('/profiles/new?save=1&relation=self&next=/store')}>
            {t('my.addProfile')}
          </Button>
        )}
        <ul className="divide-y divide-line">
          {profiles.data?.map((p) => (
            <li key={p.id}>
              <button type="button" className="flex w-full items-center justify-between py-3.5 text-left" onClick={() => target && buy(target, p.id)}>
                {p.name}
                <span className="font-serif text-sm text-ink-3">{p.dayPillar}일주</span>
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>
    </div>
  );
}
