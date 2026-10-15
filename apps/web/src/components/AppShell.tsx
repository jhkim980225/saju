import { CalendarDays, CircleUserRound, HeartHandshake, MessageCircleQuestion, ScrollText } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { t } from '@/lib/copy';
import { isMember, useSession } from '@/lib/session';
import { Wordmark } from './Seal';
import { PAGE_WIDTH, cx, type PageWidth } from './ui';

const TABS = [
  { to: '/today', label: t('tabs.today'), icon: CalendarDays },
  { to: '/saju', label: t('tabs.mySaju'), icon: ScrollText },
  { to: '/compatibility', label: t('tabs.compatibility'), icon: HeartHandshake },
  { to: '/ask', label: t('tabs.ask'), icon: MessageCircleQuestion },
  { to: '/my', label: t('tabs.my'), icon: CircleUserRound },
];

/** 데스크톱(lg↑) 상단 내비 — 모바일의 하단 탭을 대신한다. 나머지 운세는 '전체 운세' 한곳에 모은다 */
const DESKTOP_LINKS: { to: string; label: string }[] = [
  ...TABS.slice(0, 4).map(({ to, label }) => ({ to, label })),
  { to: '/tarot', label: t('tarot.meta.navLabel') },
  { to: '/menu', label: '전체 운세' },
];

const desktopLink = ({ isActive }: { isActive: boolean }) =>
  cx('inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[15px] font-medium transition-colors', isActive ? 'bg-subtle text-ink' : 'text-ink-2 hover:text-ink');

export function DesktopNav() {
  const user = useSession((s) => s.user);
  return (
    <header className="safe-top sticky top-0 z-40 hidden border-b border-line bg-canvas/95 backdrop-blur lg:block print:hidden">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-8">
        <Link to="/" aria-label="달빛사주 처음으로" className="shrink-0">
          <Wordmark />
        </Link>
        <nav className="flex flex-1 items-center justify-between" aria-label="주요 메뉴">
          <ul className="flex items-center gap-1">
            {DESKTOP_LINKS.map(({ to, label }) => (
              <li key={to}>
                <NavLink to={to} className={desktopLink}>
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
          <ul className="flex items-center gap-1">
            <li>
              <NavLink to="/store" className={desktopLink}>
                이용권
              </NavLink>
            </li>
            <li>
              <NavLink to="/my" className={desktopLink}>
                <CircleUserRound className="size-5" strokeWidth={1.5} aria-hidden />
                {t('tabs.my')}
              </NavLink>
            </li>
          </ul>
        </nav>
        {!isMember(user) && (
          <div className="flex shrink-0 items-center gap-2">
            <Link to="/login" className="inline-flex h-10 items-center rounded-full border border-line-strong px-4 text-sm font-semibold">
              로그인
            </Link>
            <Link to="/signup" className="inline-flex h-10 items-center rounded-full bg-action px-4 text-sm font-semibold text-on-action">
              회원가입
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}

/** 하단 탭 레이아웃 (탭바 49pt + safe-area) — 데스크톱은 상단 내비를 쓰므로 숨긴다 */
export function TabLayout() {
  // 타로는 물어보기 탭 안의 '타로로 묻기'
  const { pathname } = useLocation();
  const askActive = pathname.startsWith('/tarot');
  return (
    <div className="min-h-page pb-[calc(64px+env(safe-area-inset-bottom))] lg:pb-0">
      <Outlet />
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas/95 backdrop-blur lg:hidden print:hidden" aria-label="주요 메뉴">
        <ul className="mx-auto grid h-16 max-w-xl grid-cols-5">
          {TABS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) => cx('flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium', isActive || (to === '/ask' && askActive) ? 'text-ink' : 'text-ink-3')}
              >
                {({ isActive }) => (
                  <>
                    <Icon className="size-6" strokeWidth={isActive || (to === '/ask' && askActive) ? 2 : 1.5} aria-hidden />
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/** 페이지 본문 컨테이너 (모바일 기준 좌우 20px, 데스크톱 폭은 width 로) */
export function Page({ children, className, width = 'narrow' }: { children: React.ReactNode; className?: string; width?: PageWidth }) {
  return <main className={cx('mx-auto w-full px-5', PAGE_WIDTH[width], className)}>{children}</main>;
}
