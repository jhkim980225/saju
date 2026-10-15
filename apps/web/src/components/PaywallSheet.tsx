import type { ProductDto } from '@saju/shared';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useProducts } from '@/hooks/queries';
import { track } from '@/lib/analytics';
import { t } from '@/lib/copy';
import { won } from '@/lib/format';
import { isNativeApp } from '@/lib/platform';
import { BottomSheet } from './BottomSheet';
import { Badge, Button, cx } from './ui';

/**
 * 결제 바텀시트 — 후보 상품 중 구매 가능한 것을 보여 주고, 선택한 상품으로 onPurchase 를 호출한다.
 * 결제 진행(로그인 확인 → 프로필 확보 → 결제창)은 호출한 화면이 담당한다.
 */
export function PaywallSheet({
  open,
  onClose,
  productIds,
  name,
  subtitle,
  title,
  benefits,
  onPurchase,
}: {
  open: boolean;
  onClose: () => void;
  productIds: string[];
  name?: string;
  subtitle?: string;
  /** 시트 제목·혜택 목록을 화면에 맞게 바꿀 때 (타로 등) */
  title?: string;
  benefits?: string[];
  onPurchase: (p: ProductDto) => Promise<void>;
}) {
  const { data: products } = useProducts();
  const candidates = (products ?? []).filter((p) => productIds.includes(p.id) && p.purchasable && !p.comingSoon).sort((a, b) => productIds.indexOf(a.id) - productIds.indexOf(b.id));
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      track('paywall_viewed', { products: productIds.join(',') });
      setError(null);
    }
  }, [open, productIds]);
  useEffect(() => {
    if (candidates.length && (!selected || !candidates.some((c) => c.id === selected))) setSelected(candidates[0]!.id);
  }, [candidates, selected]);

  const product = candidates.find((c) => c.id === selected);
  const pay = async () => {
    if (!product) return;
    setBusy(true);
    setError(null);
    try {
      await onPurchase(product);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('payment.failBody'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={<span className="font-serif">{title ?? (name ? t('paywall.sheetTitle', { name }) : '전체 풀이 열기')}</span>}
      footer={
        <div className="space-y-2">
          <Button block size="lg" loading={busy} disabled={!product} onClick={pay}>
            {product ? t('paywall.payButton', { price: won(product.price) }) : t('paywall.ctaNoPrice')}
          </Button>
          <p className="text-center text-xs text-ink-3">{t('paywall.terms')}</p>
        </div>
      }
    >
      <p className="text-[15px] text-ink-2">{subtitle ?? t('paywall.sheetSubtitle')}</p>
      <ul className="mt-4 space-y-2 text-[15px]">
        {(benefits ?? [t('paywall.benefitContinue'), t('paywall.benefitRevisit'), t('paywall.benefitDepth')]).map((b) => (
          <li key={b} className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            {b}
          </li>
        ))}
      </ul>

      <div className="mt-5 space-y-2" role="radiogroup" aria-label="상품 선택">
        {candidates.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={selected === p.id}
            onClick={() => setSelected(p.id)}
            className={cx('w-full rounded-2xl border p-4 text-left transition-colors', selected === p.id ? 'border-focus bg-surface' : 'border-line bg-canvas')}
          >
            <div className="flex items-center gap-2">
              <span className="font-semibold">{p.name}</span>
              {p.badge && <Badge tone="gold">{p.badge}</Badge>}
            </div>
            <p className="mt-1 text-sm text-ink-2">{p.description}</p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="tabular text-lg font-bold">{won(p.price)}</span>
              {p.listPrice && <span className="tabular text-sm text-ink-3 line-through">{won(p.listPrice)}</span>}
            </p>
          </button>
        ))}
        {products && candidates.length === 0 && <p className="text-sm text-ink-3">지금 구매할 수 있는 상품이 없어요.</p>}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-subtle p-3 text-sm text-danger">
          {error}
        </p>
      )}
      <p className="mt-4 text-xs text-ink-3">{t('paywall.previewKept')}</p>
      {isNativeApp() && <p className="mt-1 text-xs text-ink-3">{t('paywall.restore')}은 마이 &gt; 결제 내역에서 할 수 있어요.</p>}
    </BottomSheet>
  );
}
