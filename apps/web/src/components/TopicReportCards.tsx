import type { ProductDto, ReportType } from '@saju/shared';
import { Coins, Heart, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { useProducts, useWallet } from '@/hooks/queries';
import { usePurchase } from '@/hooks/usePurchase';
import { won } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useOpenReport } from './OpenReportCard';
import { PaywallSheet } from './PaywallSheet';
import { Button, cx } from './ui';

export type TopicReportType = Extract<ReportType, 'love' | 'career_wealth'>;

interface TopicReport {
  type: TopicReportType;
  productId: string;
  title: string;
  icon: LucideIcon;
  body: (name: string) => string;
  benefits: string[];
}

/** 프로필 하나에 대한 주제별 리포트 — 서버 TOPIC_REPORTS(reports/service.ts)·카탈로그와 같은 ID */
export const TOPIC_REPORTS: TopicReport[] = [
  {
    type: 'love',
    productId: 'report_love',
    title: '연애·결혼운 리포트',
    icon: Heart,
    body: (name) => `${name}님이 사랑할 때 어떤 사람인지, 누구와 잘 맞는지 읽고, 앞으로 10년 가운데 새 인연이 들어오기 좋은 때를 짚어 드려요.`,
    benefits: ['사랑할 때의 나, 끌리는 매력, 부딪히기 쉬운 지점', '성별이 아닌 기질로 본 나와 잘 맞는 사람', '앞으로 10년의 인연 흐름과 가까운 3년, 좋은 달까지'],
  },
  {
    type: 'career_wealth',
    productId: 'report_career_wealth',
    title: '재물·직업운 리포트',
    icon: Coins,
    body: (name) => `${name}님이 돈을 버는 방식과 잘 맞는 일을 읽고, 앞으로 10년 가운데 돈과 일이 잘 풀리는 해, 일이 바뀌기 쉬운 해를 짚어 드려요.`,
    benefits: ['돈이 들어오는 방식, 버는 법과 지키는 법', '어울리는 일과 분야, 직장형·독립형 성향', '앞으로 10년의 흐름과 가까운 3년, 상황별 조언'],
  },
];

export const isTopicReportProduct = (p: Pick<ProductDto, 'id'>) => TOPIC_REPORTS.some((r) => r.productId === p.id);

/** 결제 후 돌아왔을 때 이 묶음으로 바로 내려오게 하는 위치 표시 */
export const TOPIC_REPORTS_ANCHOR = 'topic-reports';

/**
 * 이 프로필의 주제별 리포트를 이미 샀는가 — 서버 권한 키 report:<type>:<profileId>.
 * ready 가 false 면 아직 지갑을 불러오는 중이라 판단을 미룬다(산 사람에게 '구매하기'가 잠깐 보이지 않게).
 */
export function useOwnedTopicReports() {
  const isPremium = useSession((s) => s.user?.isPremium ?? false);
  const wallet = useWallet();
  const keys = useMemo(() => new Set((wallet.data?.entitlements ?? []).map((e) => e.key)), [wallet.data]);
  return {
    ready: !wallet.isLoading,
    owns: (type: TopicReportType, profileId: string | undefined) => Boolean(profileId) && (isPremium || keys.has(`report:${type}:${profileId}`)),
  };
}

/**
 * 주제별 리포트 카드(연애·결혼운 · 재물·직업운) — 산 프로필이면 '보고서 열기', 아니면 가격과 '구매하기'(결제 시트).
 * 내 사주(결과 화면)와 보관함에 둔다. 비회원 결과는 ensureProfile 로 먼저 저장한 뒤 결제한다.
 * 모바일은 위아래로, 640px 이상(데스크톱 2단 화면의 오른쪽 칸 포함)은 두 카드를 나란히 둔다.
 */
export function TopicReportCards({
  profileId,
  ensureProfile,
  name,
  returnTo,
  className,
  heading = '주제별 리포트',
}: {
  profileId?: string;
  ensureProfile?: () => Promise<string>;
  name: string;
  /** 결제 뒤 돌아올 화면 — 프로필이 새로 저장되면 그 프로필 화면으로 */
  returnTo: string;
  className?: string;
  heading?: string;
}) {
  const { data: products } = useProducts();
  const owned = useOwnedTopicReports();
  const open = useOpenReport();
  const purchase = usePurchase();
  const location = useLocation();
  const [paywall, setPaywall] = useState<TopicReport | null>(null);
  const paywallIds = useMemo(() => (paywall ? [paywall.productId] : []), [paywall]);
  const headingId = useId();
  const ref = useRef<HTMLElement>(null);

  const items = TOPIC_REPORTS.flatMap((r) => {
    const product = products?.find((p) => p.id === r.productId);
    return product && !product.comingSoon ? [{ ...r, product }] : [];
  });
  const shown = items.length > 0;

  // 결제를 마치고 '이어서 읽기'로 돌아오면 이 묶음이 보이게 내려 준다
  useEffect(() => {
    if (shown && location.hash === `#${TOPIC_REPORTS_ANCHOR}`) ref.current?.scrollIntoView({ block: 'start' });
  }, [shown, location.hash]);

  if (!shown) return null;

  const onPurchase = async (product: ProductDto) => {
    const pid = profileId ?? (ensureProfile ? await ensureProfile() : undefined);
    const back = pid && !profileId ? `/saju/${pid}` : returnTo;
    await purchase({ product, profileId: pid, returnTo: `${back.split('#')[0]}#${TOPIC_REPORTS_ANCHOR}` });
  };

  return (
    <section ref={ref} id={TOPIC_REPORTS_ANCHOR} aria-labelledby={headingId} className={cx('mt-8 scroll-mt-28', className)}>
      <h2 id={headingId} className="font-semibold">
        {heading}
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-3">궁금한 주제 하나를 {name}님의 사주로 깊게 풀어요. 한 번 사면 보관함에서 다시 보고 PDF로 저장할 수 있어요.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {items.map((r) => {
          const Icon = r.icon;
          const titleId = `${headingId}-${r.type}`;
          const opening = open.isPending && open.variables?.type === r.type;
          return (
            <article key={r.type} aria-labelledby={titleId} className="flex flex-col rounded-2xl border border-line-strong bg-surface p-5">
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 size-6 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
                <div>
                  <h3 id={titleId} className="font-serif text-lg font-semibold">
                    {r.title}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-2">{r.body(name)}</p>
                </div>
              </div>
              <div className="mt-auto min-h-12 pt-4">
                {!owned.ready ? null : owned.owns(r.type, profileId) && profileId ? (
                  <Button block loading={opening} disabled={open.isPending} onClick={() => open.mutate({ type: r.type, profileId })}>
                    {opening ? '보고서를 여는 중이에요' : '보고서 열기'}
                  </Button>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <span className="tabular text-lg font-bold">{won(r.product.price)}</span>
                    <Button size="sm" disabled={!r.product.purchasable} onClick={() => setPaywall(r)}>
                      구매하기
                    </Button>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <PaywallSheet
        open={paywall !== null}
        onClose={() => setPaywall(null)}
        productIds={paywallIds}
        title={paywall ? `${name}님의 ${paywall.title}` : undefined}
        subtitle="사주를 몰라도 읽히게, 결론부터 쉬운 말로 쓴 리포트예요. 결제하면 바로 만들어 보관함에 넣어 드려요."
        benefits={paywall?.benefits}
        onPurchase={onPurchase}
      />
    </section>
  );
}
