import type { ReportCreateDto } from '@saju/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useNavigate } from 'react-router';
import { qk } from '@/hooks/queries';
import { api } from '@/lib/api';
import { t } from '@/lib/copy';
import { toast } from './Toast';
import { Button, Card } from './ui';

/**
 * 구매한 보고서 열기 — 처음이면 서버가 만들고(AI 다듬기 포함, 최대 1분), 이미 있으면 저장본을 돌려준다.
 * 사주분석서(내 사주) · 신년운세 · 궁합 화면 아래에 둔다.
 */
export function OpenReportCard({ dto, title, body }: { dto: ReportCreateDto; title: string; body: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const open = useMutation({
    mutationFn: () => api.createReport(dto),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.reports });
      navigate(`/reports/${r.id}`);
    },
    onError: (e) => toast(e instanceof Error ? e.message : t('error.server.title')),
  });
  return (
    <Card className="mt-6 border-line-strong">
      <div className="flex items-start gap-3">
        <FileText className="mt-0.5 size-6 shrink-0 text-ink-2" strokeWidth={1.5} aria-hidden />
        <div>
          <p className="font-serif text-lg font-semibold">{title}</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">{body}</p>
        </div>
      </div>
      <Button block className="mt-4" loading={open.isPending} onClick={() => open.mutate()}>
        {open.isPending ? '보고서를 만들고 있어요 · 처음엔 1분쯤 걸려요' : '보고서 열기'}
      </Button>
    </Card>
  );
}
