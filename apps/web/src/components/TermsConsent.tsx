import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { t } from '@/lib/copy';

/**
 * 결제 직전 동의 문구 — "결제하면 이용약관(제5조 …)에 동의한 것으로 봐요." 의 약관 부분을 /legal/terms 링크로 건다.
 * 결제 시트(PaywallSheet)와 상점(StorePage)이 쓴다. children 은 문구 뒤에 이어 붙일 글(예: 부가세 안내)
 */
export function TermsConsent({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <p className={className}>
      {t('paywall.termsBefore')}
      <Link to="/legal/terms" className="underline underline-offset-2">
        {t('paywall.termsLink')}
      </Link>
      {t('paywall.termsAfter')}
      {children}
    </p>
  );
}
