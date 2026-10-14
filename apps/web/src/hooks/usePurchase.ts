import type { ProductDto } from '@saju/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from '@/components/Toast';
import { ApiError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { t } from '@/lib/copy';
import { startCheckout } from '@/lib/payments';
import { isMember, useSession } from '@/lib/session';

/**
 * 구매 흐름: 회원 확인(아니면 로그인으로) → 대상 프로필 확보 → 결제창(웹) 또는 인앱결제(앱).
 * 웹 결제는 /payments/success 로 돌아와 서버 승인 후 returnTo 로 복귀한다.
 */
export function usePurchase() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useSession((s) => s.user);

  return async (input: { product: ProductDto; profileId?: string; partnerProfileId?: string; readingId?: string; ensureProfile?: () => Promise<string>; returnTo: string; profileName?: string }) => {
    if (!isMember(user)) {
      navigate(`/login?next=${encodeURIComponent(input.returnTo)}&reason=purchase`);
      return;
    }
    const profileId = input.product.requiresProfile ? (input.profileId ?? (await input.ensureProfile?.())) : undefined;
    if (input.product.requiresProfile && !profileId) throw new Error('리포트를 받을 사주를 먼저 저장해 주세요.');
    track('checkout_started', { product: input.product.id, price: input.product.price });
    try {
      const result = await startCheckout({ product: input.product, profileId, partnerProfileId: input.partnerProfileId, readingId: input.readingId, returnTo: input.returnTo, profileName: input.profileName });
      if (result !== 'redirected') {
        track('purchase', { product: input.product.id, price: input.product.price, channel: 'iap' });
        await qc.invalidateQueries();
        toast(t('payment.successTitle'));
        navigate(input.returnTo);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        navigate(`/login?next=${encodeURIComponent(input.returnTo)}&reason=purchase`);
        return;
      }
      throw e;
    }
  };
}
