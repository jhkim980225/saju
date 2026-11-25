import type { PillarDetail } from '@saju/core';
import type { ReadingDto } from '@saju/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Copy } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { Page } from '@/components/AppShell';
import { toast } from '@/components/Toast';
import { Button, ErrorState, IconButton, PageHeader, Spinner, cx } from '@/components/ui';
import { useProfiles } from '@/hooks/queries';
import { SessionGateError, useSessionGate } from '@/hooks/useSessionGate';
import { api } from '@/lib/api';
import type { BirthDraft } from '@/lib/birth';
import { honorOf, t } from '@/lib/copy';
import { ELEMENT_META } from '@/lib/format';
import { buildSajuSummary, summaryToText, type SajuSummary, type SummaryRow } from '@/lib/sajuSummary';
import { copyText } from '@/lib/share';
import { useSession } from '@/lib/session';
import { STORAGE_KEYS, storage } from '@/lib/storage';

/**
 * 사주 요약 — 원국·분석·대운·분야별 한 줄 요약을 흰 종이 한 장에 모은다.
 * /saju/:profileId/summary(저장한 프로필)와 /result/summary(비회원 결과) 두 곳에서 쓴다.
 * 풀이 화면과 같은 query key 를 써서, 풀이를 보고 넘어오면 다시 계산하지 않는다.
 */
export function SummaryPage() {
  const { profileId } = useParams();
  return profileId ? <ProfileSummary profileId={profileId} /> : <DraftSummary />;
}

function ProfileSummary({ profileId }: { profileId: string }) {
  const token = useSession((s) => s.accessToken);
  const user = useSession((s) => s.user);
  const gate = useSessionGate();
  const profiles = useProfiles();
  const profile = profiles.data?.find((p) => p.id === profileId);
  const q = useQuery({
    queryKey: ['reading', 'profile', profileId, user?.id],
    queryFn: () => api.reading({ profileId }),
    enabled: Boolean(token),
  });
  return <SummaryShell back={`/saju/${profileId}`} name={profile?.name} q={q} gateError={gate.failed ? <SessionGateError onRetry={gate.retry} /> : null} />;
}

function DraftSummary() {
  const draft = storage.getJSON<BirthDraft>(STORAGE_KEYS.birthDraft);
  const q = useQuery({
    queryKey: ['reading', 'draft', draft?.dto, draft?.form.name],
    queryFn: () => api.reading({ birth: draft!.dto, name: draft!.form.name.trim() || undefined }),
    enabled: Boolean(draft),
  });
  if (!draft) return <Navigate to="/input" replace />;
  return <SummaryShell back="/result" name={draft.form.name.trim() || undefined} q={q} />;
}

function SummaryShell({ back, name, q, gateError }: { back: string; name?: string; q: { data?: ReadingDto; isLoading: boolean; error: unknown; refetch: () => unknown }; gateError?: ReactNode }) {
  const navigate = useNavigate();
  const display = name || t('common.me');
  const summary = useMemo(() => (q.data ? buildSajuSummary(q.data, display) : null), [q.data, display]);

  const copy = async () => {
    if (!summary) return;
    const ok = await copyText(summaryToText(summary));
    toast(ok ? '사주 요약을 복사했어요' : '복사하지 못했어요. 화면을 길게 눌러 직접 복사해 주세요');
  };

  return (
    <div className="paper min-h-dvh pb-16">
      <PageHeader
        left={
          <IconButton label={t('common.back')} onClick={() => navigate(back)}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
        title="사주 요약"
        right={
          summary ? (
            <IconButton label="텍스트로 복사" onClick={copy}>
              <Copy className="size-5" />
            </IconButton>
          ) : undefined
        }
      />
      <Page>
        {gateError}
        {q.isLoading && <Spinner />}
        {Boolean(q.error) && <ErrorState title={t('error.server.title')} onRetry={() => q.refetch()} />}
        {summary && <SummaryBody s={summary} onCopy={copy} />}
      </Page>
    </div>
  );
}

function Rows({ rows, labelWidth = '6.5rem' }: { rows: SummaryRow[]; labelWidth?: string }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map((r) => (
        <div key={r.label} className="grid gap-3 py-2.5 text-[15px] leading-relaxed" style={{ gridTemplateColumns: `${labelWidth} 1fr` }}>
          <dt className="text-ink-3">{r.label}</dt>
          <dd className="text-ink">{r.text}</dd>
        </div>
      ))}
    </dl>
  );
}

function Block({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="mt-8">
      <h2 className="border-b-2 border-ink pb-2 text-[15px] font-bold">{title}</h2>
      {children}
      {note && <p className="mt-2 text-xs leading-relaxed text-ink-3">{note}</p>}
    </section>
  );
}

function Glyph({ hanja, hangul, element }: { hanja: string; hangul: string; element: keyof typeof ELEMENT_META }) {
  const m = ELEMENT_META[element];
  return (
    <div className={cx('flex flex-col items-center rounded-lg py-2', m.cls.soft, m.cls.ink)}>
      <span className="font-serif text-2xl font-medium leading-none">{hanja}</span>
      <span className="mt-1 text-[11px] font-semibold">
        {hangul}·{m.name}
      </span>
    </div>
  );
}

function PillarGrid({ s }: { s: SajuSummary }) {
  const rows: { label: string; render: (p: PillarDetail) => ReactNode }[] = [
    { label: '천간', render: (p) => <Glyph hanja={p.stem.hanja} hangul={p.stem.hangul} element={p.stem.element} /> },
    { label: '지지', render: (p) => <Glyph hanja={p.branch.hanja} hangul={p.branch.hangul} element={p.branch.element} /> },
    { label: '천간 십성', render: (p) => p.stem.tenGod },
    { label: '지지 십성', render: (p) => p.branch.tenGod },
    { label: '지장간', render: (p) => p.branch.hiddenStems.map((h) => h.hanja).join(' ') },
    { label: '12운성', render: (p) => p.branch.twelveStage },
    { label: '납음', render: (p) => p.napeum.name },
  ];
  return (
    <div className="mt-3 grid grid-cols-[3.75rem_repeat(4,minmax(0,1fr))] gap-x-1.5 gap-y-1.5 text-center text-[13px]">
      <div />
      {s.pillars.map((c) => (
        <div key={c.label} className="pb-1 text-xs font-semibold text-ink-3">
          {c.label}
        </div>
      ))}
      {rows.map((r) => (
        <Row key={r.label} label={r.label}>
          {s.pillars.map((c) => (
            <div key={c.label} className="flex min-h-7 items-center justify-center">
              {c.pillar ? r.render(c.pillar) : <span className="text-ink-3">{r.label === '천간' || r.label === '지지' ? '?' : ''}</span>}
            </div>
          ))}
        </Row>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="flex items-center text-left text-xs text-ink-3">{label}</div>
      {children}
    </>
  );
}

function SummaryBody({ s, onCopy }: { s: SajuSummary; onCopy: () => void }) {
  return (
    <article className="pt-4">
      <h1 className="font-serif text-2xl font-semibold">{honorOf(s.name)} 사주 요약</h1>
      <div className="mt-3">
        <Rows rows={s.profile} />
      </div>

      <Block title="사주 원국" note="오른쪽부터 년주·월주·일주·시주 순서로 읽어요. 일주의 천간이 나 자신(일간)이에요.">
        <PillarGrid s={s} />
      </Block>

      <Block title="사주 분석" note="강약 점수와 용신은 달달사주의 억부 중심 간이 계산이며, 학파에 따라 다르게 볼 수 있어요.">
        <Rows rows={s.analysis} />
      </Block>

      <Block title="대운(10년 단위의 흐름)">
        <p className="mt-2.5 text-[15px] text-ink-2">{s.daeun.headline}</p>
        <ol className="mt-3 grid grid-cols-5 gap-1.5 text-center">
          {s.daeun.periods.map((p) => (
            <li key={p.startAge} className={cx('rounded-lg border py-2', p.current ? 'border-ink bg-subtle font-semibold' : 'border-line')} aria-current={p.current ? 'true' : undefined}>
              <p className="text-[11px] text-ink-3">{p.startAge}세</p>
              <p className="font-serif text-lg leading-tight">{p.hanja}</p>
              <p className="text-[11px] text-ink-3">{p.current ? '지금' : p.startYear}</p>
            </li>
          ))}
        </ol>
      </Block>

      {s.keyPoints.length > 0 && (
        <Block title="한눈에 보는 나">
          <Rows rows={s.keyPoints} />
        </Block>
      )}

      {s.topics.length > 0 && (
        <Block title="분야별 한 줄 요약" note="자세한 풀이는 내 사주 화면과 사주분석서에서 볼 수 있어요.">
          <Rows rows={s.topics} />
        </Block>
      )}

      <Button block size="lg" className="mt-10" onClick={onCopy}>
        텍스트로 복사
      </Button>
      <p className="mt-2 text-center text-xs text-ink-3">메모장이나 다른 AI 대화창에 붙여 넣어 볼 수 있어요.</p>
    </article>
  );
}
