import { Link } from 'react-router';
import { Page } from '@/components/AppShell';
import { MoreMenu } from '@/components/MoreMenu';
import { Wordmark } from '@/components/Seal';
import { t } from '@/lib/copy';
import { isMember, useSession } from '@/lib/session';
import { BirthForm } from './BirthFormPage';

/**
 * 첫 화면 — 다른 사주 서비스처럼 제목 한 줄 + 바로 입력하는 폼 + 다른 운세 버튼만 둔다.
 * PC 는 왼쪽 소개·메뉴, 오른쪽 입력 폼의 2단.
 */
export function LandingPage() {
  return (
    <div className="min-h-page pb-12 lg:pb-20">
      <header className="safe-top lg:hidden">
        <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-5">
          <Wordmark />
          <AuthButtons />
        </div>
      </header>
      <Page width="wide">
        <section className="pt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_440px] lg:grid-rows-[auto_1fr] lg:gap-x-16 lg:pt-16">
          <div className="lg:col-start-1 lg:row-start-1">
            <p className="text-sm font-semibold text-ink-3">{t('landing.heroEyebrow')}</p>
            <h1 className="mt-2 font-serif text-[28px] font-semibold leading-[1.3] lg:text-[44px] lg:leading-[1.25]">
              {t('landing.heroTitle')
                .split('\n')
                .map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
            </h1>
            <p className="mt-3 text-[16px] leading-relaxed text-ink-2 lg:mt-5 lg:text-lg">{t('landing.heroSubtitle')}</p>
          </div>

          <div className="mt-6 rounded-3xl border border-line bg-surface p-5 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:p-7">
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

/** 모바일 첫 화면 위쪽 버튼 — 회원이면 내 운세로, 아니면 로그인·회원가입 */
function AuthButtons() {
  const user = useSession((s) => s.user);
  if (isMember(user)) {
    return (
      <Link to="/today" className="inline-flex h-9 items-center rounded-full border border-line-strong px-4 text-sm font-semibold">
        내 운세
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <Link to="/login" className="inline-flex h-9 items-center rounded-full px-3 text-sm font-semibold text-ink-2">
        로그인
      </Link>
      <Link to="/signup" className="inline-flex h-9 items-center rounded-full bg-action px-4 text-sm font-semibold text-on-action">
        회원가입
      </Link>
    </div>
  );
}
