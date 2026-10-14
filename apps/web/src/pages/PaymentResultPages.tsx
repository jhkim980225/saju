import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { PaymentProvider, PaymentResultDto } from '@saju/shared';
import { Page } from '@/components/AppShell';
import { Button, Spinner } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { track } from '@/lib/analytics';
import { t } from '@/lib/copy';
import { clearPendingCheckout, pendingCheckout } from '@/lib/payments';

/**
 * 결제 성공 리다이렉트 — 쿼리(토스: paymentKey/orderId/amount, 포트원: paymentId) 를 서버에 넘겨 승인한다.
 * 금액은 쿼리값이 아닌, 주문 생성 시 저장한 금액과 교차 확인하고 서버가 다시 검증한다.
 */
export function PaymentSuccessPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // 승인 후 저장소에서 지우므로, 돌아갈 경로 등은 첫 렌더 시점 값을 고정해서 쓴다
  const [pending] = useState(pendingCheckout);
  const [state, setState] = useState<{ status: 'loading' | 'done' | 'error'; result?: PaymentResultDto; message?: string }>({ status: 'loading' });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const orderId = params.get('orderId') ?? params.get('paymentId') ?? pending?.orderId;
    const paymentKey = params.get('paymentKey') ?? params.get('paymentId') ?? undefined;
    const provider = (params.get('provider') as PaymentProvider | null) ?? pending?.provider ?? (params.get('paymentKey') ? 'toss' : 'portone');
    const amount = Number(params.get('amount') ?? pending?.amount);
    if (params.get('code') && !params.get('paymentKey') && provider === 'portone') {
      navigate(`/payments/fail?orderId=${orderId}&code=${params.get('code')}&message=${encodeURIComponent(params.get('message') ?? '')}`, { replace: true });
      return;
    }
    if (!orderId || !Number.isFinite(amount)) {
      setState({ status: 'error', message: '결제 정보를 찾을 수 없어요.' });
      return;
    }
    api
      .confirmPayment({ provider, orderId, amount, paymentKey })
      .then(async (result) => {
        track('purchase', { product: result.order.productId, price: result.order.amount, orderId: result.order.id, channel: 'web' });
        clearPendingCheckout();
        await qc.invalidateQueries();
        setState({ status: 'done', result });
      })
      .catch((e) => setState({ status: 'error', message: e instanceof ApiError ? e.message : t('payment.failBody') }));
  }, [navigate, params, pending, qc]);

  const goBack = () => navigate(pending?.returnTo ?? '/my/payments', { replace: true });

  return (
    <Page className="flex min-h-page flex-col items-center justify-center text-center">
      {state.status === 'loading' && (
        <>
          <Spinner label={t('payment.processingTitle')} />
          <p className="text-sm text-ink-3">{t('payment.processingBody')}</p>
        </>
      )}
      {state.status === 'done' && (
        <div className="animate-fade space-y-4">
          <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
          <h1 className="font-serif text-2xl font-semibold">{t('payment.successTitle')}</h1>
          <p className="text-ink-2">{pending?.profileName ? t('payment.successBody', { name: pending.profileName }) : '구매한 콘텐츠를 지금 바로 볼 수 있어요.'}</p>
          {state.result && state.result.granted.credits > 0 && <p className="text-sm text-ink-2">AI 상담 질문권 {state.result.granted.credits}회가 지급됐어요.</p>}
          <Button size="lg" block onClick={goBack}>
            {t('payment.successCta')}
          </Button>
          <p className="text-xs text-ink-3">{t('payment.receiptNote')}</p>
        </div>
      )}
      {state.status === 'error' && (
        <div className="space-y-4">
          <XCircle className="mx-auto size-12 text-danger" aria-hidden />
          <h1 className="font-serif text-2xl font-semibold">{t('payment.failTitle')}</h1>
          <p className="text-ink-2">{state.message}</p>
          <p className="text-sm text-ink-3">{t('payment.failDuplicateNote')}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => navigate('/my/payments', { replace: true })}>
              {t('my.payments')}
            </Button>
            <Button onClick={goBack}>{t('common.back')}</Button>
          </div>
        </div>
      )}
    </Page>
  );
}

export function PaymentFailPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [pending] = useState(pendingCheckout);
  const code = params.get('code') ?? '';
  const cancelled = /CANCEL/i.test(code);
  useEffect(() => {
    const orderId = params.get('orderId') ?? pending?.orderId;
    if (orderId) void api.failPayment(orderId, code, params.get('message') ?? undefined).catch(() => undefined);
    clearPendingCheckout();
  }, [code, params, pending?.orderId]);
  return (
    <Page className="flex min-h-page flex-col items-center justify-center space-y-4 text-center">
      <XCircle className="mx-auto size-12 text-ink-3" aria-hidden />
      <h1 className="font-serif text-2xl font-semibold">{cancelled ? t('payment.cancelTitle') : t('payment.failTitle')}</h1>
      <p className="text-ink-2">{cancelled ? t('payment.cancelBody') : (params.get('message') ?? t('payment.failBody'))}</p>
      <Button block size="lg" onClick={() => navigate(pending?.returnTo ?? '/today', { replace: true })}>
        {cancelled ? '돌아가기' : t('payment.failRetry')}
      </Button>
      <p className="text-xs text-ink-3">{t('payment.failHelp')}</p>
    </Page>
  );
}
