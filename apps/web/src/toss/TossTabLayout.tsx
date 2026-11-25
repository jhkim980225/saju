/**
 * 토스 미니앱의 탭 화면 틀 — components/AppShell 의 TabLayout 을 대신한다(src/toss/routes.tsx 가 바꿔 끼운다).
 *  - 앱인토스 UX: 탭바는 화면 아래에 떠 있는 형태, 2~5개. 여기서는 오늘 · 내 사주 · 궁합 · 마이 4개다.
 *  - 탭 이동은 히스토리를 쌓지 않는다(replace). 그래서 탭 화면에서 토스 뒤로가기를 누르면 미니앱이 종료된다.
 */
import { CalendarDays, CircleUserRound, HeartHandshake, ScrollText } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { cx } from '@/components/ui';
import { t } from '@/lib/copy';

export const TOSS_TABS = [
  { to: '/today', label: t('tabs.today'), icon: CalendarDays },
  { to: '/saju', label: t('tabs.mySaju'), icon: ScrollText },
  { to: '/compatibility', label: t('tabs.compatibility'), icon: HeartHandshake },
  { to: '/my', label: t('tabs.my'), icon: CircleUserRound },
];

export function TossTabLayout() {
  return (
    <div className="min-h-page pb-[calc(96px+env(safe-area-inset-bottom))]">
      <Outlet />
      <nav className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(12px+env(safe-area-inset-bottom))] print:hidden" aria-label="주요 메뉴">
        <ul className="mx-auto grid h-16 max-w-md grid-cols-4 rounded-full border border-line bg-surface/95 px-2 shadow-[0_6px_24px_rgba(20,24,48,0.14)] backdrop-blur">
          {TOSS_TABS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink to={to} replace className={({ isActive }) => cx('flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium', isActive ? 'text-gold' : 'text-ink-3')}>
                {({ isActive }) => (
                  <>
                    <Icon className="size-6" strokeWidth={isActive ? 2 : 1.5} aria-hidden />
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
