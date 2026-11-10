/**
 * Playwright E2E 설정 — `npm run test:e2e`
 *
 * - API(:4100)와 Web(:5180)을 개발 서버(:4000/:5173)와 겹치지 않는 포트로 새로 띄운다.
 * - API 는 운영과 같은 Worker(wrangler dev — workerd·로컬 D1)로 띄우고, 매 실행마다 지우는 임시 D1 을 쓴다 → e2e/support/start-api.mjs
 * - 결제는 mock, AI 키 없음(규칙 기반 답변), 외부 네트워크(폰트 CDN 등)는 테스트 픽스처에서 차단한다.
 */
import { defineConfig } from '@playwright/test';
import { API_ORIGIN, API_PORT, WEB_ORIGIN, WEB_PORT } from './e2e/support/env';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // 한 API(로컬 Worker)·D1 을 공유하므로 동시 실행 수를 적당히 제한 (테스트마다 사용자는 따로 만든다)
  workers: process.env.CI ? 2 : 3,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: WEB_ORIGIN,
    browserName: 'chromium',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    colorScheme: 'light',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'mobile-chromium' },
    // 데스크톱 레이아웃(상단 내비·2단 화면·가운데 대화상자)에서도 같은 시나리오가 통과하는지 확인
    { name: 'desktop-chromium', use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false } },
  ],
  webServer: [
    {
      name: 'api',
      command: 'node e2e/support/start-api.mjs',
      url: `${API_ORIGIN}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        CORS_ORIGINS: `${WEB_ORIGIN},http://127.0.0.1:${WEB_PORT}`,
        PUBLIC_WEB_URL: WEB_ORIGIN,
        PAYMENT_PROVIDER: 'mock',
        ANTHROPIC_API_KEY: '',
        // 메일 연동 없음 → 비밀번호 찾기는 문의 안내 화면 (재설정 메일 흐름은 API 단위 테스트가 검증)
        RESEND_API_KEY: '',
        MAIL_FROM: '',
        SUPPORT_EMAIL: 'help@dalbitsaju.test',
        // 요청 수 제한은 운영(NODE_ENV=production)에서만 켜진다 — 테스트마다 게스트·회원을 새로 만들어도 막히지 않는다
        DAILY_PUSH_ENABLED: 'false',
        ADS_ENABLED: 'false',
      },
    },
    {
      name: 'web',
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: 'apps/web',
      url: WEB_ORIGIN,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        VITE_API_BASE_URL: `${API_ORIGIN}/api/v1`,
      },
    },
  ],
});
