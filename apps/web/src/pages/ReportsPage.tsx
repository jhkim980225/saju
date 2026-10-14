import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Printer } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page } from '@/components/AppShell';
import { DaeunTimeline } from '@/components/DaeunTimeline';
import { ElementBars } from '@/components/ElementBars';
import { PillarTable } from '@/components/PillarTable';
import { ReadingSectionCard } from '@/components/ReadingSection';
import { Badge, Button, Card, EmptyState, ErrorState, IconButton, PageHeader, Spinner } from '@/components/ui';
import { qk } from '@/hooks/queries';
import { api } from '@/lib/api';
import { t } from '@/lib/copy';
import { formatDateKo } from '@/lib/format';
import { isNativeApp } from '@/lib/platform';

const TYPE_LABEL = { lifetime: '사주분석서', yearly: '신년운세', compatibility: '궁합', love: '연애·결혼', wealth: '재물', career: '직업' } as const;

export function ReportsPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: qk.reports, queryFn: api.reports });
  return (
    <div className="min-h-page">
      <PageHeader
        left={
          <IconButton label={t('common.back')} onClick={() => navigate(-1)}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
        title="내 리포트 보관함"
        width="medium"
      />
      <Page width="medium" className="pb-10">
        {q.isLoading && <Spinner />}
        {q.data && q.data.length === 0 && <EmptyState title={t('empty.history.title')} body="구매한 리포트는 여기에 보관돼요." action={<Button onClick={() => navigate('/saju')}>{t('empty.history.cta')}</Button>} />}
        <ul className="mt-2 space-y-2">
          {q.data?.map((r) => (
            <li key={r.id}>
              <Link to={`/reports/${r.id}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
                <div className="flex-1">
                  <Badge>{TYPE_LABEL[r.type]}</Badge>
                  <p className="mt-1.5 font-semibold">{r.title}</p>
                  <p className="text-xs text-ink-3">{formatDateKo(r.createdAt)}</p>
                </div>
                <ChevronRight className="size-5 text-ink-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </Page>
    </div>
  );
}

/** 브라우저 인쇄 → 'PDF로 저장'. 다크 테마여도 종이에는 밝은 테마로 찍는다 */
function printAsPdf() {
  const root = document.documentElement;
  const prev = root.dataset.theme;
  root.dataset.theme = 'light';
  const restore = () => {
    if (prev) root.dataset.theme = prev;
    else delete root.dataset.theme;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
}

export function ReportViewPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const q = useQuery({ queryKey: ['report', id], queryFn: () => api.report(id!), enabled: Boolean(id) });
  const report = q.data;
  // 사주분석서는 원국표·오행 비율·대운 타임라인을 함께 보여 준다
  const chart = useQuery({
    queryKey: ['chart', report?.profileId],
    queryFn: () => api.chart({ profileId: report!.profileId }),
    enabled: report?.type === 'lifetime',
  });
  const canPrint = !isNativeApp();
  return (
    <div className="min-h-page">
      <PageHeader
        left={
          <IconButton label={t('common.back')} onClick={() => navigate(-1)}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
        title={report?.title ?? '리포트'}
        right={
          canPrint && report ? (
            <IconButton label="PDF로 저장" onClick={printAsPdf}>
              <Printer className="size-5" />
            </IconButton>
          ) : undefined
        }
        width="medium"
      />
      <Page width="medium" className="pb-10 print:px-0">
        {q.isLoading && <Spinner />}
        {q.error && <ErrorState title={t('error.notFound.title')} />}
        {report && (
          <>
            <h1 className="mt-2 font-serif text-2xl font-semibold leading-snug">{report.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge>{TYPE_LABEL[report.type]}</Badge>
              {report.generator === 'ai' && <Badge tone="gold">{t('result.aiBadge')}</Badge>}
              <span className="text-xs text-ink-3">{formatDateKo(report.createdAt)} 작성</span>
            </div>
            {canPrint && (
              <Button variant="secondary" size="sm" className="mt-4 print:hidden" onClick={printAsPdf}>
                <Printer className="size-4" aria-hidden />
                PDF로 저장
              </Button>
            )}

            {chart.data && (
              <div className="mt-6 space-y-4">
                <Card className="break-inside-avoid">
                  <h2 className="mb-3 font-semibold">사주 원국표</h2>
                  <PillarTable chart={chart.data} />
                </Card>
                <Card className="break-inside-avoid">
                  <h2 className="mb-4 font-semibold">{t('result.ohaengChart.title')}</h2>
                  <ElementBars chart={chart.data} />
                </Card>
                <Card className="break-inside-avoid">
                  <h2 className="mb-3 font-semibold">대운 흐름</h2>
                  <DaeunTimeline chart={chart.data} />
                </Card>
              </div>
            )}

            {report.sections.length > 8 && (
              <nav className="mt-6 rounded-2xl border border-line bg-surface p-5 print:break-after-page" aria-label="목차">
                <h2 className="font-semibold">목차</h2>
                <ol className="mt-3 grid gap-x-6 gap-y-1.5 text-[15px] sm:grid-cols-2">
                  {report.sections.map((s, i) => (
                    <li key={s.key} className="flex gap-2">
                      <span className="tabular w-6 shrink-0 text-right text-ink-3">{i + 1}</span>
                      <a href={`#sec-${s.key}`} className="text-ink-2 hover:text-ink hover:underline">
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            )}

            {report.sections.map((s) => (
              <ReadingSectionCard key={s.key} section={s} />
            ))}
            <p className="mt-6 text-xs text-ink-3">{t('disclaimer.standard')}</p>
            {report.generator === 'ai' && <p className="mt-1 text-xs text-ink-3">{t('disclaimer.ai')}</p>}
          </>
        )}
      </Page>
    </div>
  );
}
