import { Link } from 'react-router';
import { Page } from '@/components/AppShell';
import { ChevronRight } from 'lucide-react';
import { MoreMenu } from '@/components/MoreMenu';
import { MoonEmblem, Wordmark } from '@/components/Seal';
import { cx } from '@/components/ui';
import { t } from '@/lib/copy';
import { isMember, useSession } from '@/lib/session';
import { BirthForm } from './BirthFormPage';

/**
 * 첫 화면 — 다른 사주 서비스처럼 제목 한 줄 + 바로 입력하는 폼 + 다른 운세 버튼만 둔다.
 * 맨 위는 로고와 같은 밤하늘(초승달). 모바일은 위에서 아래로, PC 는 왼쪽 밤하늘·메뉴, 오른쪽 입력 폼의 2단.
 * 밤하늘 패널에 '사주가 처음이라면' 짧은 안내를 둬서, 사주를 모르는 사람이 입력 전에 기본 개념을 보고 사주 기초로 넘어가게 한다.
 */
export function LandingPage() {
  return (
    <div className="min-h-page pb-12 lg:pb-20">
      <div className="night-sky pb-14 lg:hidden">
        <header className="safe-top">
          <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-5">
            <Wordmark night />
            <AuthButtons />
          </div>
        </header>
        <Hero className="mx-auto max-w-xl px-5 pt-2 text-center" />
        <div className="mt-4 flex justify-center px-5">
          <Link to="/basics" className="inline-flex items-center gap-1 rounded-full border border-[#e8c47c]/40 px-4 py-2 text-sm font-medium text-[#f4ecd9]">
            사주가 처음이라면 — 사주 기초 보기
            <ChevronRight className="size-4 text-[#e8c47c]" aria-hidden />
          </Link>
        </div>
      </div>

      <Page width="wide">
        <section className="lg:grid lg:grid-cols-[minmax(0,1fr)_440px] lg:grid-rows-[auto_1fr] lg:gap-x-12 lg:pt-12">
          <div className="night-sky hidden rounded-3xl px-10 pb-8 pt-6 lg:col-start-1 lg:row-start-1 lg:block">
            <Hero />
            <Primer />
          </div>

          <div className="relative -mt-8 rounded-3xl border border-line bg-surface p-5 shadow-[0_12px_40px_rgba(3,6,18,0.18)] lg:self-start lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:p-7">
            <BirthForm variant="embedded" />
          </div>

          <MoreMenu className="mt-10 lg:col-start-1 lg:row-start-2 lg:self-start" />
        </section>

        <footer className="mt-12 space-y-2 border-t border-line pt-6 text-xs leading-relaxed text-ink-3 lg:mt-20">
          <p>{t('disclaimer.standard')}</p>
          <p className="flex flex-wrap gap-x-3 gap-y-1">
            <Link to="/legal/terms" className="underline">
              {t('my.terms')}
            </Link>
            <Link to="/legal/privacy" className="underline">
              {t('my.privacy')}
            </Link>
          </p>
        </footer>
      </Page>
    </div>
  );
}

function Hero({ className }: { className?: string }) {
  return (
    <div className={className}>
      <MoonEmblem className="mx-auto w-[230px] lg:mx-0 lg:w-[300px]" />
      <p className="mt-1 text-sm font-semibold tracking-wide text-[#e8c47c]">{t('landing.heroEyebrow')}</p>
      <h1 className="mt-2 font-serif text-[28px] font-semibold leading-[1.3] lg:text-[42px] lg:leading-[1.25]">
        {t('landing.heroTitle')
          .split('\n')
          .map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
      </h1>
      <p className="sky-text-2 mt-3 text-[16px] leading-relaxed lg:mt-4 lg:text-lg">{t('landing.heroSubtitle')}</p>
    </div>
  );
}

/** 사주가 처음인 사람을 위한 기본 개념 세 가지 — PC 밤하늘 패널 아래쪽. 늘 남색 위라 색을 고정한다 */
const PRIMER: { term: string; desc: string }[] = [
  { term: '사주팔자', desc: '태어난 연·월·일·시를 네 기둥, 여덟 글자로 나타낸 것입니다.' },
  { term: '일간', desc: '태어난 날의 천간으로, 사주에서 나 자신을 뜻합니다.' },
  { term: '오행', desc: '목·화·토·금·수 다섯 기운의 균형으로 기질을 살펴봅니다.' },
];

function Primer() {
  return (
    <section aria-labelledby="primer-title" className="mt-8 border-t border-[#e8c47c]/20 pt-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="primer-title" className="text-sm font-semibold text-[#e8c47c]">
          사주가 처음이라면
        </h2>
        <Link to="/basics" className="inline-flex items-center gap-0.5 text-sm font-medium text-[#f4ecd9] underline-offset-4 hover:underline">
          사주 기초 자세히 보기
          <ChevronRight className="size-4 text-[#e8c47c]" aria-hidden />
        </Link>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3">
        {PRIMER.map((p) => (
          <div key={p.term} className="rounded-2xl border border-[#e8c47c]/20 bg-white/[0.04] px-4 py-3.5">
            <dt className="font-serif text-[17px] font-semibold text-[#f4ecd9]">{p.term}</dt>
            <dd className="sky-text-2 mt-1 text-[13px] leading-relaxed">{p.desc}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** 모바일 첫 화면 위쪽 버튼 — 회원이면 내 운세로, 아니면 로그인·회원가입. 늘 밤하늘 위라 색을 고정한다 */
function AuthButtons() {
  const user = useSession((s) => s.user);
  const pill = 'inline-flex h-9 items-center rounded-full px-4 text-sm font-semibold';
  if (isMember(user)) {
    return (
      <Link to="/today" className={cx(pill, 'border border-[#e8c47c]/60 text-[#f4ecd9]')}>
        내 운세
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <Link to="/login" className={cx(pill, 'px-3 text-[#c9c1ae]')}>
        로그인
      </Link>
      <Link to="/signup" className={cx(pill, 'bg-[#e8c47c] text-[#060b24]')}>
        회원가입
      </Link>
    </div>
  );
}
