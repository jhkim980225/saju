import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReportDto, ReportType } from '@saju/shared';
import { ArrowLeft, ChevronRight, Loader2, Printer } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page } from '@/components/AppShell';
import { DaeunTimeline } from '@/components/DaeunTimeline';
import { ElementBars } from '@/components/ElementBars';
import { PillarTable } from '@/components/PillarTable';
import { ReadingSectionCard } from '@/components/ReadingSection';
import { toast } from '@/components/Toast';
import { TopicReportCards } from '@/components/TopicReportCards';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, IconButton, PageHeader, Spinner } from '@/components/ui';
import { qk, useProfiles } from '@/hooks/queries';
import { api } from '@/lib/api';
import { t } from '@/lib/copy';
import { formatDateKo } from '@/lib/format';
import { isNativeApp, nativePlatform } from '@/lib/platform';
import { STORAGE_KEYS, storage } from '@/lib/storage';
import { printCurrentPage } from '@/native';

const TYPE_LABEL: Record<ReportType, string> = { lifetime: '사주분석서', yearly: '신년운세', compatibility: '궁합', love: '연애·결혼운', career_wealth: '재물·직업운' };

export function ReportsPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: qk.reports, queryFn: api.reports });
  const profiles = useProfiles();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const profileList = profiles.data ?? [];
  const target = profileList.find((p) => p.id === (pickedId ?? storage.get(STORAGE_KEYS.activeProfile))) ?? profileList[0];
  // 결제로 연 택일 결과도 보관함에 함께 보여 준다 (잠긴 미리보기는 택일 화면의 '최근에 본 택일'에)
  const taekil = useQuery({ queryKey: ['taekil', 'list'], queryFn: api.taekilList });
  const items = [
    ...(q.data ?? []).map((r) => ({ id: r.id, to: `/reports/${r.id}`, label: TYPE_LABEL[r.type] as string, title: r.title, createdAt: r.createdAt })),
    ...(taekil.data ?? []).filter((r) => !r.locked).map((r) => ({ id: r.id, to: `/taekil/r/${r.id}`, label: t('taekil.result.libraryBadge'), title: r.title, createdAt: r.createdAt })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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
        {q.data && !taekil.isLoading && items.length === 0 && <EmptyState title={t('empty.history.title')} body="구매한 리포트는 여기에 보관돼요." action={<Button onClick={() => navigate('/saju')}>{t('empty.history.cta')}</Button>} />}
        <ul className="mt-2 space-y-2">
          {items.map((r) => (
            <li key={r.id}>
              <Link to={r.to} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
                <div className="flex-1">
                  <Badge>{r.label}</Badge>
                  <p className="mt-1.5 font-semibold">{r.title}</p>
                  <p className="text-xs text-ink-3">{formatDateKo(r.createdAt)}</p>
                </div>
                <ChevronRight className="size-5 text-ink-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>

        {target && (
          <div className="mt-10 border-t border-line pt-2">
            {profileList.length > 1 && (
              <div className="no-scrollbar -mx-5 mt-6 flex gap-2 overflow-x-auto px-5 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0" role="group" aria-label="리포트를 볼 사람">
                {profileList.map((p) => (
                  <Chip key={p.id} active={p.id === target.id} onClick={() => setPickedId(p.id)}>
                    {p.name} · {p.dayPillar}
                  </Chip>
                ))}
              </div>
            )}
            <TopicReportCards profileId={target.id} name={target.name} returnTo="/my/reports" heading={`${target.name}님의 주제별 리포트`} className={profileList.length > 1 ? 'mt-4' : 'mt-6'} />
          </div>
        )}
      </Page>
    </div>
  );
}

/**
 * PDF로 저장 — 웹은 브라우저 인쇄 → 'PDF로 저장', 앱은 시스템 인쇄 화면(native/print.ts).
 * 다크 테마여도 종이에는 밝은 테마로 찍는다.
 */
async function printAsPdf(name: string) {
  const root = document.documentElement;
  const prev = root.dataset.theme;
  root.dataset.theme = 'light';
  const restore = () => {
    if (prev) root.dataset.theme = prev;
    else delete root.dataset.theme;
  };
  if (isNativeApp()) {
    // 인쇄 화면이 닫힐 때까지 웹뷰가 인쇄 원본이므로 그 뒤에 테마를 되돌린다
    try {
      await printCurrentPage(name);
    } catch {
      toast('PDF 저장 화면을 열지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      restore();
    }
    return;
  }
  const afterPrint = () => {
    restore();
    window.removeEventListener('afterprint', afterPrint);
  };
  window.addEventListener('afterprint', afterPrint);
  window.print();
}

/** 앱의 인쇄 화면에서 PDF 파일로 남기는 방법 */
const APP_PDF_HINT = {
  android: "인쇄 화면에서 프린터를 'PDF로 저장'으로 고르면 파일로 남아요.",
  ios: "인쇄 화면 위쪽 공유 버튼에서 '파일에 저장'을 고르면 PDF로 남아요.",
} as const;

/** 다듬기 진행 확인 주기 */
const POLL_MS = 2000;
/** 이만큼 내려 읽고 있으면 본문을 바로 바꾸지 않고 '바꿔 보기'를 띄운다 */
const READING_SCROLL_Y = 240;

/** 화면 위쪽 1/3 안에서 읽고 있는 섹션 — 본문을 바꾼 뒤에도 그 섹션이 같은 자리에 오게 한다 */
function sectionInView(): { key: string; top: number } | null {
  let found: { key: string; top: number } | null = null;
  for (const el of document.querySelectorAll<HTMLElement>('section[id^="sec-"]')) {
    const top = el.getBoundingClientRect().top;
    if (top > window.innerHeight / 3) break;
    found = { key: el.id.slice('sec-'.length), top };
  }
  return found;
}

function PolishingNotice({ progress }: { progress: ReportDto['progress'] }) {
  const known = progress !== null && progress.total > 0;
  return (
    <div className="mt-4 rounded-2xl border border-line bg-surface p-4 print:hidden">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Loader2 className="size-4 animate-spin text-ink-3" aria-hidden />
        AI가 문장을 다듬고 있어요
        {known && (
          <span className="tabular ml-auto text-ink-3">
            {progress.done}/{progress.total}
          </span>
        )}
      </p>
      <div
        role="progressbar"
        aria-label="AI 문장 다듬기 진행"
        aria-valuemin={0}
        aria-valuemax={known ? progress.total : undefined}
        aria-valuenow={known ? progress.done : undefined}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-subtle"
      >
        <div className="h-full rounded-full bg-action transition-[width] duration-500" style={{ width: known ? `${Math.round((progress.done / progress.total) * 100)}%` : '0%' }} />
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">먼저 기본 풀이로 읽어 보세요. 다 다듬어지면 바로 바꿔 드려요.</p>
    </div>
  );
}

export function ReportViewPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['report', id], queryFn: () => api.report(id!), enabled: Boolean(id) });
  const report = q.data;
  // 한 사람의 사주로 쓴 리포트(사주분석서·연애·결혼운·재물·직업운)는 근거가 되는 여덟 글자 표·다섯 기운 도넛·10년 흐름 타임라인을 함께 보여 준다
  const chart = useQuery({
    queryKey: ['chart', report?.profileId],
    queryFn: () => api.chart({ profileId: report!.profileId }),
    enabled: report?.type === 'lifetime' || report?.type === 'love' || report?.type === 'career_wealth',
  });

  // 규칙 기반 본문을 먼저 보여 주고, AI 가 다듬는 동안 본문 없이 진행만 폴링한다
  const polishing = report?.status === 'polishing';
  const progress = useQuery({
    queryKey: ['report-progress', id],
    queryFn: () => api.reportProgress(id!),
    enabled: polishing,
    refetchInterval: (query) => (query.state.data?.status === 'ready' ? false : POLL_MS),
  });
  const polishedReady = polishing && progress.data?.status === 'ready';
  /** 읽는 중이라 아직 바꾸지 않은 최종본 */
  const [polished, setPolished] = useState<ReportDto | null>(null);
  const anchor = useRef<{ key: string; top: number } | null>(null);

  useEffect(() => {
    if (!polishedReady || !id) return;
    let cancelled = false;
    api
      .report(id)
      .then((next) => {
        if (cancelled) return;
        // 아직 읽기 전이면 바로 바꾸고, 읽는 중이면 글이 갑자기 바뀌지 않게 '바꿔 보기'를 띄운다
        if (window.scrollY < READING_SCROLL_Y) {
          qc.setQueryData(['report', id], next);
          toast('AI가 다듬은 문장으로 바꿨어요');
        } else setPolished(next);
      })
      .catch(() => undefined); // 실패해도 지금 본문(규칙 기반)으로 계속 읽을 수 있다 — 다음에 열면 최종본
    return () => {
      cancelled = true;
    };
  }, [polishedReady, id, qc]);

  const swapToPolished = () => {
    if (!polished) return;
    anchor.current = sectionInView();
    qc.setQueryData(['report', id], polished);
    setPolished(null);
  };
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    anchor.current = null;
    const el = document.getElementById(`sec-${a.key}`);
    if (el) window.scrollBy(0, el.getBoundingClientRect().top - a.top);
  }, [report]);

  const printing = useRef(false);
  const savePdf = () => {
    if (!report || printing.current) return;
    printing.current = true;
    void printAsPdf(report.title).finally(() => {
      printing.current = false;
    });
  };
  const platform = nativePlatform();
  const appHint = platform === 'web' ? null : APP_PDF_HINT[platform];
  // 첫 섹션에 '한눈에 보기'(points)가 있으면 표와 차트보다 먼저 보여 준다(옛 저장본은 그대로 순서대로)
  const lead = report?.sections[0]?.points?.length ? report.sections[0] : null;
  const rest = report ? (lead ? report.sections.slice(1) : report.sections) : [];

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
          report ? (
            <IconButton label="PDF로 저장" onClick={savePdf}>
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
            <div className="print:hidden">
              <Button variant="secondary" size="sm" className="mt-4" onClick={savePdf}>
                <Printer className="size-4" aria-hidden />
                PDF로 저장
              </Button>
              {appHint && <p className="mt-2 text-xs text-ink-3">{appHint}</p>}
            </div>
            {polishing && !polishedReady && <PolishingNotice progress={progress.data?.progress ?? report.progress} />}

            {/* 사주를 몰라도 10초 안에 — 표·용어보다 '한눈에 보기'를 먼저 */}
            {lead && <ReadingSectionCard section={lead} />}

            {chart.data && (
              <div className="mt-2 space-y-4">
                <Card className="break-inside-avoid">
                  <h2 className="mb-3 font-semibold">타고난 여덟 글자</h2>
                  <PillarTable chart={chart.data} />
                </Card>
                <Card className="break-inside-avoid">
                  <h2 className="font-semibold">{t('result.ohaengChart.title')}</h2>
                  <p className="mb-4 mt-1 text-sm text-ink-3">여덟 글자를 나무·불·흙·쇠·물, 다섯 가지 성질로 나눠 센 거예요.</p>
                  <ElementBars chart={chart.data} />
                </Card>
                <Card className="break-inside-avoid">
                  <h2 className="mb-1 font-semibold">10년마다 바뀌는 흐름</h2>
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

            {rest.map((s) => (
              <ReadingSectionCard key={s.key} section={s} />
            ))}
            <p className="mt-6 text-xs text-ink-3">{t('disclaimer.standard')}</p>
            {report.type === 'career_wealth' && <p className="mt-1 text-xs text-ink-3">{t('disclaimer.finance')}</p>}
            {report.generator === 'ai' && <p className="mt-1 text-xs text-ink-3">{t('disclaimer.ai')}</p>}
          </>
        )}
      </Page>
      {polished && (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-4 print:hidden">
          <div role="status" className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-surface py-2 pl-5 pr-2 shadow-lg">
            <span className="text-sm font-medium">AI가 다듬은 문장이 준비됐어요</span>
            <Button size="sm" onClick={swapToPolished}>
              바꿔 보기
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
