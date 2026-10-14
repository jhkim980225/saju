import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page } from '@/components/AppShell';
import { Button, Card, EmptyState, IconButton, PageHeader, Spinner, TextInput } from '@/components/ui';
import { api } from '@/lib/api';
import { t } from '@/lib/copy';
import { todayKst } from '@/lib/format';

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

/** 만세력 — 날짜별 년·월·일 간지와 그 해의 24절기 */
export function MansePage() {
  const [date, setDate] = useState(todayKst().iso);
  const q = useQuery({ queryKey: ['manse', date], queryFn: () => api.manse(date) });
  const d = q.data;
  return (
    <div className="min-h-page">
      <BackHeader title="만세력" />
      <Page width="medium" className="space-y-4 pb-12">
        <TextInput type="date" value={date} min="1900-01-01" max="2100-12-31" onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="날짜 선택" />
        {q.isLoading && <Spinner />}
        {d && (
          <>
            <Card>
              <p className="text-sm text-ink-3">
                양력 {d.date}
                {d.lunar && ` · 음력 ${d.lunar.year}.${d.lunar.month}.${d.lunar.day}${d.lunar.isLeapMonth ? '(윤)' : ''}`}
              </p>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[
                  ['년', d.yearPillar],
                  ['월', d.monthPillar],
                  ['일', d.dayPillar],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-subtle py-3">
                    <p className="text-xs text-ink-3">{k}주</p>
                    <p className="mt-1 font-serif text-2xl">{v}</p>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <h2 className="font-semibold">{d.date.slice(0, 4)}년 24절기</h2>
              <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm lg:grid-cols-3 lg:gap-x-8">
                {d.solarTerms.map((s) => (
                  <li key={s.at} className="flex justify-between">
                    <span>{s.name}</span>
                    <span className="tabular text-ink-3">{new Date(s.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-3">절기 시각은 한국 표준시(KST) 기준이에요.</p>
            </Card>
          </>
        )}
      </Page>
    </div>
  );
}

const LEGAL: Record<string, { title: string; body: string[] }> = {
  terms: {
    title: '이용약관',
    body: [
      '제1조(목적) 이 약관은 달빛사주(이하 "서비스")가 제공하는 사주·운세 콘텐츠 및 관련 제반 서비스의 이용 조건과 절차를 규정합니다.',
      '제2조(서비스의 성격) 서비스가 제공하는 사주·운세 콘텐츠는 엔터테인먼트와 자기 이해를 위한 참고 정보이며, 과학적으로 검증된 예측이나 의료·법률·투자 자문이 아닙니다.',
      '제3조(유료 콘텐츠) 유료 리포트와 AI 상담 질문권은 결제 즉시 제공되는 디지털 콘텐츠입니다. 열람(제공)이 시작된 콘텐츠는 전자상거래법 제17조 제2항에 따라 청약철회가 제한될 수 있으며, 미사용 질문권은 환불을 요청할 수 있습니다.',
      '제4조(인앱결제) 앱에서 결제한 상품의 환불은 각 앱스토어(Apple App Store, Google Play)의 정책을 따릅니다.',
      '제5조(회원 탈퇴) 회원은 언제든지 마이 > 탈퇴하기에서 탈퇴할 수 있으며, 탈퇴 시 저장된 사주 정보와 풀이 기록은 즉시 삭제됩니다.',
      '※ 본 약관은 출시 전 법무 검토를 거쳐 확정됩니다.',
    ],
  },
  privacy: {
    title: '개인정보 처리방침',
    body: [
      '수집 항목: 이메일(회원), 닉네임, 생년월일·태어난 시각·성별·출생지(사주 계산용), 결제 기록, 기기 식별자(게스트), 푸시 토큰(알림 동의 시).',
      '이용 목적: 사주 계산과 풀이 제공, 구매 내역 관리, 고객 문의 대응, (동의 시) 오늘의 운세 알림 발송.',
      '보관 기간: 회원 탈퇴 시 즉시 파기합니다. 단, 전자상거래법에 따라 결제 기록은 5년간 익명화하여 보관합니다.',
      'AI 상담: AI 상담 기능 이용 시 질문 내용과 사주 요약이 응답 생성을 위해 AI 모델 제공사(Anthropic)에 전송될 수 있습니다.',
      '행태정보의 수집·이용: 이용 통계 분석, 광고 성과 측정, 맞춤형 광고를 위해 방문 페이지·이용 이벤트·쿠키 및 광고 식별자·기기 정보를 자동 수집할 수 있습니다. 수집·처리 사업자: Google LLC(Google Analytics, AdSense), Meta Platforms, Inc.(Meta 픽셀), 주식회사 카카오(카카오 픽셀, 애드핏). 보유 기간은 최대 14개월(각 사업자 정책)이며, 사주 입력 정보와 계정 정보는 이들 사업자에게 제공하지 않습니다.',
      '거부 방법: 브라우저 설정에서 쿠키 저장을 거부·삭제할 수 있고, 맞춤형 광고는 Google 광고 설정·Meta 광고 기본 설정에서 끌 수 있습니다.',
      '개인정보의 국외 이전: Google LLC(미국), Meta Platforms, Inc.(미국)에 쿠키·온라인 식별자와 이용 기록이 이용 시점에 네트워크로 전송됩니다(목적: 이용 통계 분석·광고 성과 측정).',
      '카카오톡 공유: 공유 내용(결과 제목·요약·링크)이 주식회사 카카오를 통해 전달되며, 생년월일과 태어난 시간은 공유되지 않습니다.',
      '※ 본 방침은 출시 전 법무 검토를 거쳐 확정됩니다.',
    ],
  },
  disclaimer: { title: '면책 고지', body: [t('disclaimer.full'), t('disclaimer.health'), t('disclaimer.finance'), t('disclaimer.ai')] },
};

export function LegalPage() {
  const { doc } = useParams();
  const page = LEGAL[doc ?? ''] ?? LEGAL.terms!;
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
