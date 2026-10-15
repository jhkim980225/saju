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

/** 그 시각 그 지역의 UTC 오프셋(분) — 브라우저가 모르면 null */
function utcOffset(timeZone: string, utcMs: number): number | null {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date(utcMs)).find((p) => p.type === 'timeZoneName')?.value ?? '';
    if (name === 'GMT') return 0;
    const m = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(name);
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : null;
  } catch {
    return null;
  }
}

/** 태어난 시각이 서머타임이었나 — 그해 1월·7월 중 작은 오프셋(표준시)보다 앞서 있으면 서머타임 */
function bornInDst(timeZone: string, birthUtc: string, correctionMinutes: number): boolean {
  const ms = Date.parse(birthUtc);
  const y = new Date(ms).getUTCFullYear();
  const [at, jan, jul] = [utcOffset(timeZone, ms), utcOffset(timeZone, Date.UTC(y, 0, 15)), utcOffset(timeZone, Date.UTC(y, 6, 15))];
  // 오프셋을 못 읽으면 예전처럼 보정량으로만 짐작한다(경도 차이만으로는 50분을 넘기 어렵다)
  if (at === null || jan === null || jul === null) return correctionMinutes < -50;
  return at > Math.min(jan, jul) && correctionMinutes < -50;
}

/** 왜 시간이 바뀌는지 — 해의 위치 차이(경도)와 서머타임을 나눠서 말한다 */
function correctionWhy(c: { input: { timeZone: string }; birthUtc: string; correctionMinutes: number }, place: string): string {
  const dst = bornInDst(c.input.timeZone, c.birthUtc, c.correctionMinutes);
  // 서머타임 1시간을 뺀 나머지가 해의 위치 차이
  const sun = dst ? c.correctionMinutes + 60 : c.correctionMinutes;
  const parts = [t('confirm.correctionWhy')];
  if (sun < 0) parts.push(t('confirm.correctionEarlier', { place, minutes: -sun }));
  if (sun > 0) parts.push(t('confirm.correctionLater', { place, minutes: sun }));
  if (dst) parts.push(t('confirm.correctionWhyDst'));
  return parts.join(' ');
}

/** 계산 엔진의 경계 경고(용어·습니다체)를 처음 보는 사람도 알아듣게 */
function plainWarning(w: string): string {
  const jieToday = /^생일에 절기\((.+?)\)가 바뀌어/.exec(w);
  if (jieToday) {
    const name = jieToday[1]!;
    return name === '입춘'
      ? '태어난 날에 입춘이 있어요. 사주에서는 입춘부터 새해로 보기 때문에, 태어난 시간에 따라 띠와 태어난 달의 글자가 달라질 수 있어요. 시간을 알면 넣어 주세요.'
      : `태어난 날에 계절이 바뀌는 절기(${name})가 있어요. 태어난 시간에 따라 태어난 달의 글자가 달라질 수 있으니, 시간을 알면 넣어 주세요.`;
  }
  const near = /^절입 시각\((.+?)\) 전후 1시간/.exec(w);
  if (near) return `계절이 바뀌는 절기(${near[1]})와 1시간도 차이 나지 않는 때에 태어났어요. 몇 분 차이로 태어난 달의 글자가 바뀔 수 있으니, 태어난 시간을 한 번 더 확인해 주세요.`;
  if (w.startsWith('야자시')) return '밤 11시~자정 사이에 태어났어요. 고급 설정에서 고른 대로 태어난 날을 그날로 보고 계산했어요.';
  return w;
}

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
            {c.hourKnown && c.correctionMinutes !== 0 && c.correctedTime && (
              // 왜 시간이 바뀌는지 먼저 말한다 — '경도 보정' 같은 용어 대신
              <div className="rounded-lg bg-subtle p-3 text-sm leading-relaxed">
                <p className="font-semibold text-info">{t('confirm.correctionPlain', { time: `${pad(c.correctedTime.hour)}:${pad(c.correctedTime.minute)}` })}</p>
                <p className="mt-1 text-ink-2">{correctionWhy(c, city.name)}</p>
              </div>
            )}
            {c.warnings.map((w) => (
              <p key={w} className="rounded-lg bg-subtle p-2 text-sm text-ink-2">
                {plainWarning(w)}
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
