import type { ProductDto, ReadingDto, ReadingSection } from '@saju/shared';
import { Lock, Share2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useProducts } from '@/hooks/queries';
import { usePurchase } from '@/hooks/usePurchase';
import { track } from '@/lib/analytics';
import { t } from '@/lib/copy';
import { won } from '@/lib/format';
import { AdSlot } from './AdSlot';
import { DaeunTimeline } from './DaeunTimeline';
import { ElementBars } from './ElementBars';
import { OpenReportCard } from './OpenReportCard';
import { PaywallSheet } from './PaywallSheet';
import { PillarTable } from './PillarTable';
import { ReadingSectionCard, navLabel } from './ReadingSection';
import { ShareSheet } from './ShareSheet';
import { Badge, Button, Card, cx } from './ui';

/**
 * 결과 화면 본문 (W4) — 비회원 결과/저장된 프로필 결과 공용.
 * ensureProfile: 결제 전에 프로필이 없으면(비회원 결과) 저장해서 ID 를 돌려준다.
 */
export function ReadingView({
  reading,
  name,
  profileId,
  ensureProfile,
  editHref,
  returnTo,
  isPremiumUser,
}: {
  reading: ReadingDto;
  name: string;
  profileId?: string;
  ensureProfile?: () => Promise<string>;
  editHref?: string;
  returnTo: string;
  isPremiumUser?: boolean;
}) {
  const chart = reading.chart;
  const [paywall, setPaywall] = useState<{ open: boolean; productIds: string[] }>({ open: false, productIds: [] });
  const purchase = usePurchase();
  const { data: products } = useProducts();
  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);
  const anyLocked = reading.sections.some((s) => s.locked);

  useEffect(() => {
    track('reading_viewed', { locked: anyLocked });
  }, [anyLocked]);

  const openPaywall = (s?: ReadingSection) => {
    const ids = s?.unlockProductId === 'report_saju_mini' ? ['report_saju_lifetime', 'report_saju_mini', 'bundle_newyear_2027'] : ['report_saju_lifetime', 'bundle_newyear_2027'];
    setPaywall({ open: true, productIds: ids });
  };
  const priceOf = (s: ReadingSection) => {
    const p = productById.get(s.unlockProductId === 'report_saju_mini' ? 'report_saju_mini' : 'report_saju_lifetime');
    return p && p.purchasable ? won(p.price) : undefined;
  };

  const onPurchase = async (product: ProductDto) => {
    // 비회원 결과에서 구매하면 먼저 프로필로 저장하고, 결제 후에는 저장된 프로필 화면으로 돌아간다
    const pid = profileId ?? (product.requiresProfile && ensureProfile ? await ensureProfile() : undefined);
    await purchase({ product, profileId: pid, returnTo: pid && !profileId ? `/saju/${pid}` : returnTo, profileName: name });
  };

  const [shareOpen, setShareOpen] = useState(false);
  const sharePayload = {
    title: t('share.kakaoResult.title', { name, ilju: chart.pillars.day.ganzhi.hangul, alias: reading.dayPillarTitle }),
    text: `${reading.headline} — ${t('share.kakaoResult.description')}`,
    url: `${window.location.origin}/`,
    buttons: [{ title: t('share.kakaoResult.buttonPrimary'), url: `${window.location.origin}/input` }],
  };

  const corr = chart.correctionMinutes;
  const pad = (n: number) => String(n).padStart(2, '0');
  const timeText = chart.hourKnown ? `${pad(chart.input.hour!)}:${pad(chart.input.minute ?? 0)}` : '시간 모름';

  // 데스크톱(lg↑): 왼쪽에 사주표·섹션 목차를 고정하고 오른쪽에 풀이를 둔다. 모바일은 위에서 아래로 같은 순서.
  return (
    <div className="lg:grid lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-x-12 lg:pt-6 xl:grid-cols-[380px_minmax(0,1fr)] xl:gap-x-16">
      <section className="pt-4 lg:col-start-2 lg:row-start-1 lg:pt-0">
        <p className="text-sm text-ink-3">{t('result.iljuLabel', { ilju: chart.pillars.day.ganzhi.hangul, alias: reading.dayPillarTitle })}</p>
        <h1 className="mt-2 font-serif text-[26px] font-semibold leading-[1.35] lg:text-[32px]">{reading.headline}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-3">
          <span>
            {chart.input.calendar === 'lunar' ? '음력' : '양력'} {chart.input.year}.{pad(chart.input.month)}.{pad(chart.input.day)} {timeText}
          </span>
          {chart.hourKnown && corr !== 0 && <Badge>{t('result.correctionBadge', { minutes: corr > 0 ? `+${corr}` : corr })}</Badge>}
          {reading.generator === 'ai' && <Badge tone="gold">{t('result.aiBadge')}</Badge>}
          {isPremiumUser && <Badge tone="gold">전체 풀이</Badge>}
        </div>
        {editHref && (
          <Link to={editHref} className="mt-2 inline-block text-sm text-info underline underline-offset-2">
            {t('result.editInput')}
          </Link>
        )}
      </section>

      <aside className="lg:sticky lg:top-24 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto lg:[scrollbar-width:thin]">
        <Card className="mt-6 lg:mt-0">
          <PillarTable chart={chart} editHref={editHref} />
        </Card>
        <nav className="mt-6 hidden lg:block" aria-label="섹션 바로가기">
          <p className="px-3 text-xs font-semibold text-ink-3">섹션 바로가기</p>
          <ul className="mt-2 space-y-0.5">
            {reading.sections.map((s) => (
              <li key={s.key}>
                <a href={`#sec-${s.key}`} className={cx('flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-[15px] hover:bg-subtle', s.locked ? 'text-ink-3' : 'text-ink-2')}>
                  {navLabel(s)}
                  {s.locked && <Lock className="size-3.5 shrink-0" aria-label="잠김" />}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="lg:col-start-2 lg:row-start-2">
        <Card className="mt-4 lg:mt-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">{t('result.ohaengChart.title')}</h2>
            <span className="text-xs text-ink-3">
              용신 {chart.yongsin.yongsin === 'wood' ? '木' : chart.yongsin.yongsin === 'fire' ? '火' : chart.yongsin.yongsin === 'earth' ? '土' : chart.yongsin.yongsin === 'metal' ? '金' : '水'} · {chart.strength.level}
            </span>
          </div>
          <ElementBars chart={chart} />
        </Card>

        <nav className="no-scrollbar sticky top-[calc(56px+env(safe-area-inset-top))] z-20 -mx-5 mt-6 flex gap-2 overflow-x-auto bg-canvas/95 px-5 py-2 backdrop-blur lg:hidden" aria-label="섹션 바로가기">
          {reading.sections.map((s) => (
            <a key={s.key} href={`#sec-${s.key}`} className={cx('shrink-0 rounded-full border px-3 py-1.5 text-sm', s.locked ? 'border-line text-ink-3' : 'border-line-strong text-ink-2')}>
              {navLabel(s)}
            </a>
          ))}
        </nav>

        <div className="mt-2">
          {reading.sections.map((s) => (
            <div key={s.key}>
              <ReadingSectionCard section={s} onUnlock={openPaywall} price={s.locked ? priceOf(s) : undefined} />
              {s.key === 'daeun' && !s.locked && (
                <div className="-mt-2 mb-6">
                  <DaeunTimeline chart={chart} />
                </div>
              )}
            </div>
          ))}
        </div>

        {profileId && !anyLocked && (
          <OpenReportCard
            dto={{ type: 'lifetime', profileId }}
            title={`${name}님의 사주분석서`}
            body="원국표, 오행 비율, 대운 80년, 올해·내년 운세, 열두 달 월운까지 한 권으로 묶었어요. A4 20쪽이 넘는 분량이고 PDF로 저장할 수 있어요."
          />
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setShareOpen(true)}>
            <Share2 className="size-4" aria-hidden />
            {t('result.actions.share')}
          </Button>
          <Link to="/compatibility" className="inline-flex h-12 items-center justify-center rounded-full bg-action-2 font-semibold">
            {t('result.actions.seeCompatibility')}
          </Link>
        </div>
        {anyLocked && (
          <Button block size="lg" className="mt-3" onClick={() => openPaywall()}>
            {t('paywall.ctaNoPrice')}
          </Button>
        )}

        {anyLocked && !isPremiumUser && (
          <div className="mt-8">
            <AdSlot placement="result_bottom" />
          </div>
        )}

        <p className="mt-8 border-t border-line pt-4 text-xs leading-relaxed text-ink-3">{reading.disclaimer}</p>
        {reading.generator === 'ai' && <p className="mt-1 text-xs text-ink-3">{t('disclaimer.ai')}</p>}
      </div>

      <ShareSheet open={shareOpen} onClose={() => setShareOpen(false)} payload={sharePayload} />
      <PaywallSheet open={paywall.open} onClose={() => setPaywall((p) => ({ ...p, open: false }))} productIds={paywall.productIds} name={name} onPurchase={onPurchase} />
    </div>
  );
}
