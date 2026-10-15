import { Link } from 'react-router';
import { Page } from '@/components/AppShell';
import { MoreMenu } from '@/components/MoreMenu';
import { MoonEmblem, Wordmark } from '@/components/Seal';
import { cx } from '@/components/ui';
import { t } from '@/lib/copy';
import { isMember, useSession } from '@/lib/session';
import { BirthForm } from './BirthFormPage';

/**
 * 첫 화면 — 다른 사주 서비스처럼 제목 한 줄 + 바로 입력하는 폼 + 다른 운세 버튼만 둔다.
 * 맨 위는 로고와 같은 밤하늘(초승달). 모바일은 위에서 아래로, PC 는 왼쪽 밤하늘·메뉴, 오른쪽 입력 폼의 2단.
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
      </div>

      <Page width="wide">
        <section className="lg:grid lg:grid-cols-[minmax(0,1fr)_440px] lg:grid-rows-[auto_1fr] lg:gap-x-12 lg:pt-12">
          <div className="night-sky hidden rounded-3xl px-10 pb-10 pt-6 lg:col-start-1 lg:row-start-1 lg:block">
            <Hero />
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
