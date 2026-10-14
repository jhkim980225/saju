import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router';
import { Page } from '@/components/AppShell';
import { Button, Card, ErrorState, IconButton, PageHeader, Spinner } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { cityById, type BirthDraft } from '@/lib/birth';
import { t } from '@/lib/copy';
import { weekdayOf } from '@/lib/format';
import { STORAGE_KEYS, storage } from '@/lib/storage';

const pad = (n: number) => String(n).padStart(2, '0');

export function ConfirmPage() {
  const navigate = useNavigate();
  const draft = storage.getJSON<BirthDraft>(STORAGE_KEYS.birthDraft);
  const q = useQuery({ queryKey: ['chart', draft?.dto], queryFn: () => api.chart({ birth: draft!.dto }), enabled: Boolean(draft), retry: false });
  if (!draft) return <Navigate to="/input" replace />;
  const { form, dto } = draft;
  const name = form.name.trim() || t('common.me');
  const city = cityById(form.cityId);
  const gender = dto.gender === 'female' ? t('form.gender.female') : t('form.gender.male');
  const c = q.data;

  return (
    <div className="min-h-page pb-32 lg:pb-16">
      <PageHeader
        left={
          <IconButton label={t('common.back')} onClick={() => navigate(-1)}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
        title={t('confirm.title')}
      />
      <Page>
        {q.isLoading && <Spinner />}
        {q.error && (
          <ErrorState
            title={q.error instanceof ApiError && q.error.status === 400 ? q.error.message : t('error.server.title')}
            body={q.error instanceof ApiError && q.error.status === 400 ? undefined : t('error.server.body')}
            onRetry={() => (q.error instanceof ApiError && q.error.status === 400 ? navigate('/input') : q.refetch())}
          />
        )}
        {c && (
          <Card className="mt-4 space-y-2">
            <p className="font-serif text-2xl font-semibold">{t('common.honorific', { name })}</p>
            <p className="text-[17px]">
              {t('confirm.solarLine', { date: `${c.solarDate.year}년 ${c.solarDate.month}월 ${c.solarDate.day}일 (${weekdayOf(`${c.solarDate.year}-${pad(c.solarDate.month)}-${pad(c.solarDate.day)}`).slice(0, 1)})` })}
            </p>
            {c.lunarDate && (
              <p className="text-[15px] text-ink-2">
                = {t('confirm.lunarLine', { date: `${c.lunarDate.year}년 ${c.lunarDate.month}월 ${c.lunarDate.day}일` })} {c.lunarDate.isLeapMonth ? t('confirm.leapSuffix') : ''}
              </p>
            )}
            <p className="text-[15px] text-ink-2">
              {dto.hour === null || dto.hour === undefined
                ? t('confirm.timeUnknownLine', { place: city.name, gender })
                : t('confirm.detailLine', { time: `${pad(dto.hour)}:${pad(dto.minute ?? 0)}`, place: city.name, gender })}
            </p>
            {c.hourKnown && c.correctionMinutes !== 0 && (
              <p className="text-sm text-info">
                {t('confirm.correction', {
                  minutes: c.correctionMinutes > 0 ? `+${c.correctionMinutes}` : c.correctionMinutes,
                  reason: t('confirm.correctionReasonLongitude') + (c.correctionMinutes < -50 ? ` · ${t('confirm.correctionReasonDst')}` : ''),
                })}
                {c.correctedTime && ` → ${pad(c.correctedTime.hour)}:${pad(c.correctedTime.minute)} 기준`}
              </p>
            )}
            {c.warnings.map((w) => (
              <p key={w} className="rounded-lg bg-subtle p-2 text-sm text-ink-2">
                {w}
              </p>
            ))}
            <div className="pt-2">
              <Button variant="secondary" size="sm" onClick={() => navigate('/input')}>
                {t('confirm.edit')}
              </Button>
            </div>
          </Card>
        )}
      </Page>
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas lg:static lg:border-0 lg:bg-transparent">
        <div className="mx-auto max-w-xl px-5 py-3 lg:pt-8">
          <Button block size="lg" disabled={!c} onClick={() => navigate('/result')}>
            {t('confirm.submit')}
          </Button>
        </div>
      </div>
    </div>
  );
}
