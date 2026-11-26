import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page } from '@/components/AppShell';
import { BasicsLink, MoreMenu } from '@/components/MoreMenu';
import { TaekilEntryCard } from '@/components/TaekilEntryCard';
import { Button, Card, EmptyState, IconButton, PageHeader, Spinner, TextInput } from '@/components/ui';
import { useConfig } from '@/hooks/queries';
import { api } from '@/lib/api';
import { t } from '@/lib/copy';
import { formatDateKo, todayKst } from '@/lib/format';
import { ganzhiKo, yearNickname } from '@/lib/ganzhi';
import { webLegalDocs } from '@/lib/legal';
import { IS_TOSS } from '@/lib/platform';
import { legalDocOverride } from '@/lib/tossBridge';

function BackHeader({ title }: { title: string }) {
  const navigate = useNavigate();
  return (
    <PageHeader
      left={
        <IconButton label={t('common.back')} onClick={() => navigate(-1)}>
          <ArrowLeft className="size-6" />
        </IconButton>
      }
      title={title}
      width="medium"
    />
  );
}

/** 전체 운세 — PC 상단 메뉴의 '전체 운세'. 첫 화면·오늘 탭 아래의 버튼 묶음과 같다 */
export function MenuPage() {
  return (
    <div className="min-h-page pb-10">
      <PageHeader title="전체 운세" width="medium" />
      <Page width="medium">
        <MoreMenu title="무엇을 볼까요?" className="mt-4" />
        <BasicsLink className="mt-6" />
      </Page>
    </div>
  );
}

/**
 * 만세력 — 날짜별 년·월·일 간지와 그 해의 24절기.
 * 처음 보는 사람 기준: 맨 위에 "이게 뭔지" 한 줄, 고른 날을 문장으로 먼저, 한자 아래에는 읽는 법.
 */
export function MansePage() {
  const [date, setDate] = useState(todayKst().iso);
  const q = useQuery({ queryKey: ['manse', date], queryFn: () => api.manse(date) });
  const d = q.data;
  // 사주의 새해는 1월 1일이 아니라 입춘 — 그 전이면 아직 지난해로 센다는 걸 알려 준다
  const ipchun = d?.solarTerms.find((s) => s.name === '입춘');
  const beforeIpchun = Boolean(d && ipchun && new Date(`${d.date}T12:00:00+09:00`) < new Date(ipchun.at));
  return (
    <div className="min-h-page">
      <BackHeader title="만세력" />
      <Page width="medium" className="space-y-4 pb-12">
        <p className="pt-2 text-[15px] leading-relaxed text-ink-2">만세력은 날짜마다 연·월·일의 간지(干支)를 적어 둔 달력이에요. 날짜를 선택하면 그날의 간지와 음력 날짜, 그해 24절기를 볼 수 있어요.</p>
        <TextInput type="date" value={date} min="1900-01-01" max="2100-12-31" onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="날짜 선택" />
        {q.isLoading && <Spinner />}
        {d && (
          <>
            <Card>
              <p className="text-sm text-ink-3">
                양력 {formatDateKo(d.date)}
                {d.lunar && ` · 음력 ${d.lunar.year}.${d.lunar.month}.${d.lunar.day}${d.lunar.isLeapMonth ? '(윤)' : ''}`}
              </p>
              <p className="mt-2 text-[17px] font-medium leading-relaxed">
                간지로는 {ganzhiKo(d.yearPillar)}년{yearNickname(d.yearPillar) && `(${yearNickname(d.yearPillar)})`} {ganzhiKo(d.monthPillar)}월 {ganzhiKo(d.dayPillar)}일이에요.
              </p>
              {beforeIpchun && <p className="mt-1 text-sm text-ink-3">사주에서는 입춘(2월 4일 무렵)을 한 해의 시작으로 보므로, 이날은 아직 지난해의 간지를 써요.</p>}
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[
                  ['연주', d.yearPillar],
                  ['월주', d.monthPillar],
                  ['일주', d.dayPillar],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-subtle py-3">
                    <p className="text-xs text-ink-3">{k}</p>
                    <p className="mt-1 font-serif text-2xl">{v}</p>
                    <p className="mt-0.5 text-sm text-ink-2">{ganzhiKo(v!)}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-ink-3">연주·월주·일주는 각각 그해·그달·그날의 간지예요. 위는 한자, 아래는 한글 독음이에요.</p>
            </Card>
            <Card>
              <h2 className="font-semibold">{d.date.slice(0, 4)}년 24절기</h2>
              <p className="mt-1 text-sm text-ink-3">태양의 움직임에 따라 한 해를 스물넷으로 나눈 날이에요. 사주의 달(월주)은 이 가운데 입춘·경칩·청명처럼 달의 시작이 되는 열두 절기에서 바뀌어요.</p>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm lg:grid-cols-3 lg:gap-x-8">
                {d.solarTerms.map((s) => (
                  <li key={s.at} className="flex justify-between">
                    <span>{s.name}</span>
                    <span className="tabular text-ink-3">{new Date(s.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-3">시각은 한국 표준시 기준이에요.</p>
            </Card>
            <TaekilEntryCard date={date > todayKst().iso ? date : undefined} className="" />
          </>
        )}
      </Page>
    </div>
  );
}

// 이용약관·처리방침 본문은 lib/legal.ts(사업자 정보는 apps/web/.env 의 VITE_BIZ_*, 문의처는 서버 SUPPORT_EMAIL 이 먼저). 면책 고지는 공용 문구
const legalDocs = (supportEmail?: string | null): Record<string, { title: string; body: string[] }> => ({
  // 토스 빌드는 toss/legal.ts(해요체)를 쓰므로 웹 약관 본문이 번들에 들어가지 않게 뺀다
  ...(IS_TOSS ? {} : webLegalDocs(supportEmail)),
  disclaimer: { title: '면책 고지', body: [t('disclaimer.full'), t('disclaimer.health'), t('disclaimer.finance'), t('disclaimer.ai')] },
});

export function LegalPage() {
  const { doc } = useParams();
  const supportEmail = useConfig().data?.supportEmail;
  const LEGAL = legalDocs(supportEmail);
  // 토스 미니앱은 토스용 약관·처리방침을 등록해 둔다(src/toss/legal.ts). 웹·앱은 위 legalDocs 를 쓴다
  const page = legalDocOverride(doc ?? '') ?? LEGAL[doc ?? ''] ?? legalDocOverride('terms') ?? LEGAL.terms!;
  return (
    <div className="min-h-page">
      <BackHeader title={page.title} />
      <Page width="medium" className="space-y-4 pb-12 pt-4 text-[15px] leading-relaxed text-ink-2">
        {page.body.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </Page>
    </div>
  );
}

export { NotFoundPage } from './NotFoundPage';
