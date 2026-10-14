import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Page } from '@/components/AppShell';
import { Badge, Card, EmptyState, IconButton, PageHeader, Spinner } from '@/components/ui';
import { qk, useWallet } from '@/hooks/queries';
import { api } from '@/lib/api';
import { t } from '@/lib/copy';
import { formatDateKo, won } from '@/lib/format';

const STATUS_LABEL = { pending: '결제 대기', paid: '결제 완료', failed: '실패', canceled: '취소', refunded: '환불' } as const;
const REASON_LABEL: Record<string, string> = { purchase: '구매', consume: '사용', refund: '환불', bonus: '지급', admin: '운영' };

export function PaymentsPage() {
  const navigate = useNavigate();
  const orders = useQuery({ queryKey: qk.orders, queryFn: api.orders });
  const wallet = useWallet();
  const visible = (orders.data ?? []).filter((o) => o.status !== 'pending');
  return (
    <div className="min-h-page">
      <PageHeader
        left={
          <IconButton label={t('common.back')} onClick={() => navigate(-1)}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
        title={t('my.payments')}
        width="medium"
      />
      <Page width="medium" className="space-y-4 pb-10">
        {wallet.data && (
          <Card>
            <p className="text-sm text-ink-3">AI 상담 질문권</p>
            <p className="tabular mt-1 text-3xl font-bold">{wallet.data.credits}회</p>
            <p className="mt-1 text-xs text-ink-3">
              유상 {wallet.data.paidCredits} · 무상 {wallet.data.freeCredits} — 무상분부터 먼저 사용돼요. 유효기간은 없어요.
            </p>
            {wallet.data.ledger.length > 0 && (
              <ul className="mt-4 divide-y divide-line text-sm">
                {wallet.data.ledger.slice(0, 20).map((l) => (
                  <li key={l.id} className="flex justify-between py-2.5">
                    <span>
                      {REASON_LABEL[l.reason] ?? l.reason} · {l.memo}
                    </span>
                    <span className={`tabular font-semibold ${l.delta > 0 ? 'text-success' : 'text-ink-2'}`}>{l.delta > 0 ? `+${l.delta}` : l.delta}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {orders.isLoading && <Spinner />}
        {orders.data && visible.length === 0 && <EmptyState title={t('empty.payments.title')} body={t('empty.payments.body')} />}
        {visible.length > 0 && (
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {visible.map((o) => (
                <li key={o.id} className="px-5 py-4">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{o.orderName}</p>
                    <Badge tone={o.status === 'paid' ? 'success' : 'default'}>{STATUS_LABEL[o.status]}</Badge>
                  </div>
                  <p className="tabular mt-1 text-sm text-ink-3">
                    {formatDateKo(o.paidAt ?? o.createdAt)} · {won(o.amount)} · {o.provider.startsWith('iap') ? '인앱결제' : o.provider}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-3">주문번호 {o.id}</p>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <p className="text-xs leading-relaxed text-ink-3">
          {t('payment.receiptNote')} 디지털 콘텐츠 특성상 열람한 리포트는 청약철회가 제한될 수 있어요. 환불 문의는 고객센터로 연락해 주세요.
        </p>
      </Page>
    </div>
  );
}
