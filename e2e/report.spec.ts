/**
 * 시나리오 12 — 유료 사주분석서: 결제 직후 보관함에 이미 있고, '보고서 열기'를 누르면 기다림 없이 열리며, PDF로 저장(브라우저 인쇄)이 된다.
 * E2E 는 AI 키가 없으므로 규칙 기반 최종본이다(다듬기 진행 표시 없음).
 */
import { buyViaApi, createProfileViaApi, expect, injectSession, signupViaApi, test } from './support/fixtures';

test('사주분석서 — 결제 직후 보관함에 있고, 바로 열리며, 인쇄(PDF로 저장)는 밝은 테마로 찍는다', async ({ page, api }) => {
  const { tokens } = await signupViaApi(api, { nickname: '리포트' });
  const profile = await createProfileViaApi(api, tokens.accessToken, '서윤');
  await buyViaApi(api, tokens.accessToken, 'report_saju_lifetime', profile.id);
  await injectSession(page, tokens);
  // 인쇄 대화상자 대신 호출 시점의 테마를 기록한다
  await page.addInitScript(() => {
    const w = window as unknown as { __printThemes: (string | undefined)[] };
    w.__printThemes = [];
    window.print = () => void w.__printThemes.push(document.documentElement.dataset.theme);
  });

  // 결제가 확정되면 서버가 바로 만들어 보관함에 둔다
  await page.goto('/my/reports');
  await expect(page.getByRole('link', { name: /서윤님의 사주분석서/ })).toBeVisible();

  // 내 사주 화면의 '보고서 열기' → 저장본이 바로 열린다
  await page.goto(`/saju/${profile.id}`);
  const open = page.getByRole('button', { name: '보고서 열기' });
  await open.scrollIntoViewIfNeeded();
  await open.click();
  await expect(page).toHaveURL(/\/reports\/[\w-]+$/);
  await expect(page.getByRole('navigation', { name: '목차' })).toBeVisible();
  await expect.poll(() => page.locator('section[id^="sec-"]').count()).toBeGreaterThan(30);
  await expect(page.getByText('AI가 문장을 다듬고 있어요')).toHaveCount(0);

  // 다크 테마여도 인쇄할 때는 밝은 테마, 인쇄가 끝나면 되돌린다
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await page.getByRole('button', { name: 'PDF로 저장' }).last().click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printThemes: string[] }).__printThemes)).toEqual(['light']);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
