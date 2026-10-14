import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, lazy, useEffect, type ComponentType } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider, ScrollRestoration, useLocation } from 'react-router';
import { DesktopNav, TabLayout } from './components/AppShell';
import { ToastHost } from './components/Toast';
import { Spinner } from './components/ui';
import { ApiError } from './lib/api';
import { track } from './lib/analytics';
import { isNativeApp } from './lib/platform';
import { recoverInAppPurchases } from './lib/payments';
import { isMember, useSession } from './lib/session';
import { LandingPage } from './pages/LandingPage';
import { NotFoundPage } from './pages/NotFoundPage';

const lazyPage = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })));
const AskPage = lazyPage(() => import('./pages/AskPage'), 'AskPage');
const LoginPage = lazyPage(() => import('./pages/AuthPages'), 'LoginPage');
const SignupPage = lazyPage(() => import('./pages/AuthPages'), 'SignupPage');
const OAuthCallbackPage = lazyPage(() => import('./pages/AuthPages'), 'OAuthCallbackPage');
const BirthFormPage = lazyPage(() => import('./pages/BirthFormPage'), 'BirthFormPage');
const CompatibilityPage = lazyPage(() => import('./pages/CompatibilityPage'), 'CompatibilityPage');
const ConfirmPage = lazyPage(() => import('./pages/ConfirmPage'), 'ConfirmPage');
const LegalPage = lazyPage(() => import('./pages/MiscPages'), 'LegalPage');
const MansePage = lazyPage(() => import('./pages/MiscPages'), 'MansePage');
const MyPage = lazyPage(() => import('./pages/MyPage'), 'MyPage');
const MySajuPage = lazyPage(() => import('./pages/MySajuPage'), 'MySajuPage');
const PaymentSuccessPage = lazyPage(() => import('./pages/PaymentResultPages'), 'PaymentSuccessPage');
const PaymentFailPage = lazyPage(() => import('./pages/PaymentResultPages'), 'PaymentFailPage');
const PaymentsPage = lazyPage(() => import('./pages/PaymentsPage'), 'PaymentsPage');
const ReportsPage = lazyPage(() => import('./pages/ReportsPage'), 'ReportsPage');
const ReportViewPage = lazyPage(() => import('./pages/ReportsPage'), 'ReportViewPage');
const ResultPage = lazyPage(() => import('./pages/ResultPage'), 'ResultPage');
const StorePage = lazyPage(() => import('./pages/StorePage'), 'StorePage');
const TodayPage = lazyPage(() => import('./pages/TodayPage'), 'TodayPage');
const YearlyPage = lazyPage(() => import('./pages/YearlyPage'), 'YearlyPage');
const TarotHomePage = lazyPage(() => import('./pages/TarotHomePage'), 'TarotHomePage');
const TarotAskPage = lazyPage(() => import('./pages/TarotAskPage'), 'TarotAskPage');
const TarotDrawPage = lazyPage(() => import('./pages/TarotDrawPage'), 'TarotDrawPage');
const TarotResultPage = lazyPage(() => import('./pages/TarotResultPage'), 'TarotResultPage');
const TarotDailyPage = lazyPage(() => import('./pages/TarotResultPage'), 'TarotDailyPage');
const TarotHistoryPage = lazyPage(() => import('./pages/TarotHistoryPage'), 'TarotHistoryPage');

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

function RootLayout() {
  const location = useLocation();
  useEffect(() => {
    track('page_view', { path: location.pathname });
  }, [location.pathname]);
  // 앱: 끊긴 인앱결제 복구 (회원 로그인 상태에서 시작·복귀 시)
  const member = useSession((s) => isMember(s.user));
  useEffect(() => {
    if (!isNativeApp() || !member) return;
    const run = () =>
      void recoverInAppPurchases()
        .then(async (n) => {
          if (n > 0) await queryClient.invalidateQueries();
        })
        .catch(() => undefined);
    run();
    const onVisible = () => document.visibilityState === 'visible' && run();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [member]);
  return (
    <>
      <ScrollRestoration />
      <DesktopNav />
      <Suspense fallback={<Spinner />}>
        <Outlet />
      </Suspense>
      <ToastHost />
    </>
  );
}

export const routes = [
  {
    element: <RootLayout />,
    children: [
      // 앱(Capacitor)은 랜딩 대신 오늘 탭으로 시작
      { path: '/', element: isNativeApp() ? <Navigate to="/today" replace /> : <LandingPage /> },
      { path: '/input', element: <BirthFormPage /> },
      { path: '/confirm', element: <ConfirmPage /> },
      { path: '/result', element: <ResultPage /> },
      { path: '/profiles/new', element: <BirthFormPage /> },
      { path: '/profiles/:id/edit', element: <BirthFormPage /> },
      { path: '/saju/:profileId', element: <MySajuPage /> },
      { path: '/yearly/:profileId', element: <YearlyPage /> },
      { path: '/my/payments', element: <PaymentsPage /> },
      { path: '/my/reports', element: <ReportsPage /> },
      { path: '/reports/:id', element: <ReportViewPage /> },
      { path: '/store', element: <StorePage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignupPage /> },
      { path: '/auth/callback/:provider', element: <OAuthCallbackPage /> },
      { path: '/payments/success', element: <PaymentSuccessPage /> },
      { path: '/payments/fail', element: <PaymentFailPage /> },
      { path: '/manse', element: <MansePage /> },
      { path: '/legal/:doc', element: <LegalPage /> },
      { path: '/tarot/ask', element: <TarotAskPage /> },
      { path: '/tarot/draw', element: <TarotDrawPage /> },
      { path: '/tarot/daily', element: <TarotDailyPage /> },
      { path: '/tarot/r/:id', element: <TarotResultPage /> },
      { path: '/tarot/history', element: <TarotHistoryPage /> },
      {
        element: <TabLayout />,
        children: [
          { path: '/today', element: <TodayPage /> },
          { path: '/saju', element: <MySajuPage /> },
          { path: '/compatibility', element: <CompatibilityPage /> },
          { path: '/ask', element: <AskPage /> },
          { path: '/tarot', element: <TarotHomePage /> },
          { path: '/my', element: <MyPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

const router = createBrowserRouter(routes);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
