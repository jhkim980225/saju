/**
 * 시나리오 12 — 유료 사주분석서: 결제 직후 보관함에 이미 있고, '리포트 열기'를 누르면 기다림 없이 열리며, PDF로 저장(브라우저 인쇄)이 된다.
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
  const open = page.getByRole('button', { name: '리포트 열기' });
  await open.scrollIntoViewIfNeeded();
  await open.click();
  await expect(page).toHaveURL(/\/reports\/[\w-]+$/);
  // 40개 가까운 섹션을 주제별 탭으로 나눠 보여 준다. 화면에서는 탭이 목차 역할을 하고, 목차는 인쇄할 때만 나온다
  const tabs = page.getByRole('tablist', { name: '사주분석서 주제' });
  await expect(tabs.getByRole('tab')).toHaveText(['타고난 사주', '분야별 운', '대운', '연도별 운세']);
  await expect(page.getByRole('navigation', { name: '목차' })).toBeHidden();
  await expect(page.getByRole('heading', { name: '타고난 성격' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^대운: 10년 단위/ }).first()).toBeHidden();
  await tabs.getByRole('tab', { name: '대운' }).click();
  await expect(tabs.getByRole('tab', { name: '대운' })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/[?&]tab=daeun/);
  await expect(page.getByRole('heading', { name: '타고난 성격' })).toBeHidden();
  await expect(page.getByRole('heading', { name: /^대운: 10년 단위/ }).first()).toBeVisible();
  // 탭 끝의 '다음' 버튼으로 이어 읽는다
  await page.getByRole('button', { name: '다음: 연도별 운세' }).click();
  await expect(tabs.getByRole('tab', { name: '연도별 운세' })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => page.locator('section[id^="sec-"]').count()).toBeGreaterThan(30);
  await expect(page.getByText('AI가 문장을 다듬고 있어요')).toHaveCount(0);

  // 다크 테마여도 인쇄할 때는 밝은 테마, 인쇄가 끝나면 되돌린다
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await page.getByRole('button', { name: 'PDF로 저장' }).last().click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printThemes: string[] }).__printThemes)).toEqual(['light']);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
