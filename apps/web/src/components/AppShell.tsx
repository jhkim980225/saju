import { CalendarDays, CircleUserRound, HeartHandshake, Layers, LayoutGrid, MessageCircleQuestion, ScrollText, Ticket, type LucideIcon } from 'lucide-react';
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

/**
 * 데스크톱(lg↑) 왼쪽 사이드바 — 모바일의 하단 탭을 대신한다. 나머지 운세는 '전체 운세' 한곳에 모은다.
 * lg(1024~1279px)는 아이콘과 짧은 이름만 세로로 놓는 좁은 줄(5rem), xl(1280px↑)은 이름까지 펼친 사이드바(15rem)다.
 * 폭은 styles/index.css 의 --side-w 와 같고, 본문은 App.tsx 에서 그만큼 오른쪽으로 민다.
 */
const SIDE_LINKS: { to: string; label: string; icon: LucideIcon }[] = [
  ...TABS.slice(0, 4),
  { to: '/tarot', label: t('tarot.meta.navLabel'), icon: Layers },
  { to: '/menu', label: '전체 운세', icon: LayoutGrid },
];
const SIDE_LINKS_BOTTOM: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/store', label: '이용권', icon: Ticket },
  { to: '/my', label: t('tabs.my'), icon: CircleUserRound },
];

const sideLink = (active: boolean) =>
  cx(
    'flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium transition-colors xl:h-11 xl:flex-row xl:gap-3 xl:px-3 xl:py-0 xl:text-[15px]',
    active ? 'bg-subtle font-semibold text-ink' : 'text-ink-2 hover:bg-subtle hover:text-ink',
  );

/** '전체 운세'에서 들어가는 화면. 이 화면에 있으면 사이드바의 '전체 운세'를 선택 상태로 보인다 */
const MENU_SECTIONS = ['/menu', '/yearly', '/tojeong', '/dream', '/zodiac', '/horoscope', '/taekil', '/manse', '/basics'];
const inMenuSection = (path: string) => MENU_SECTIONS.some((p) => path === p || path.startsWith(`${p}/`));

function SideItem({ to, label, icon: Icon, active }: { to: string; label: string; icon: LucideIcon; active?: boolean }) {
  return (
    <li>
      <NavLink to={to} className={({ isActive }) => sideLink(active ?? isActive)}>
        {({ isActive }) => (
          <>
            <Icon className={cx('size-6 shrink-0 xl:size-5', (active ?? isActive) && 'text-gold')} strokeWidth={(active ?? isActive) ? 2 : 1.5} aria-hidden />
            <span className="max-w-full truncate">{label}</span>
          </>
        )}
      </NavLink>
    </li>
  );
}

export function SideNav() {
  const user = useSession((s) => s.user);
  const { pathname } = useLocation();
  return (
    <aside className="safe-top fixed inset-y-0 left-0 z-40 hidden w-20 flex-col border-r border-line bg-canvas lg:flex xl:w-60 print:hidden">
      <Link to="/" aria-label="달달사주 처음으로" className="flex h-20 shrink-0 items-center justify-center xl:justify-start xl:px-6">
        <img src="/icon-192.png" alt="" width={36} height={36} className="size-9 rounded-xl xl:hidden" />
        <span className="hidden xl:inline-flex">
          <Wordmark />
        </span>
      </Link>
      {/* 메뉴 목록만 '주요 메뉴'로 묶는다(로그인·회원가입 버튼은 메뉴가 아니라 바깥에 둔다) */}
      <nav className="flex flex-1 flex-col justify-between overflow-y-auto px-2 pb-3 xl:px-4" aria-label="주요 메뉴">
        <ul className="space-y-1">
          {SIDE_LINKS.map((l) => (
            <SideItem key={l.to} {...l} active={l.to === '/menu' ? inMenuSection(pathname) : undefined} />
          ))}
        </ul>
        <ul className="space-y-1 border-t border-line pt-3">
          {SIDE_LINKS_BOTTOM.map((l) => (
            <SideItem key={l.to} {...l} />
          ))}
        </ul>
      </nav>
      {!isMember(user) && (
        <div className="flex flex-col gap-2 px-2 pb-5 xl:px-4">
          <Link to="/login" className="inline-flex h-10 items-center justify-center rounded-full border border-line-strong px-2 text-sm font-semibold">
            로그인
          </Link>
          <Link to="/signup" className="inline-flex h-10 items-center justify-center rounded-full bg-action px-2 text-sm font-semibold text-on-action">
            <span className="xl:hidden">가입</span>
            <span className="hidden xl:inline">회원가입</span>
          </Link>
        </div>
      )}
    </aside>
  );
}

/** 하단 탭 레이아웃 (탭바 49pt + safe-area) — 데스크톱은 왼쪽 사이드바를 쓰므로 숨긴다 */
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
                className={({ isActive }) => cx('flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium', isActive || (to === '/ask' && askActive) ? 'text-gold' : 'text-ink-3')}
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
