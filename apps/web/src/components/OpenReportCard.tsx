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
 * 구매한 보고서 열기 — 결제 직후 서버가 미리 만들어 두므로 보통은 저장본을 바로 돌려준다.
 * 처음 만드는 경우에도 규칙 기반 본문을 바로 돌려주고, AI 다듬기는 보고서 화면에서 진행률과 함께 이어진다.
 * 사주분석서(내 사주) · 신년운세 · 궁합 화면 아래에 둔다.
 */
export function OpenReportCard({ dto, title, body }: { dto: ReportCreateDto; title: string; body: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const open = useMutation({
    mutationFn: () => api.createReport(dto),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.reports });
      // 받은 본문을 그대로 넘겨 보고서 화면이 다시 받지 않게 한다
      qc.setQueryData(['report', r.id], r);
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
        {open.isPending ? '보고서를 여는 중이에요' : '보고서 열기'}
      </Button>
    </Card>
  );
}
