/**
 * 사주 요약 — 풀이 화면의 '사주 요약 한 장으로 보기'에서 원국·분석·대운·분야별 한 줄 요약을 흰 바탕 한 장으로 보고, 텍스트로 복사한다.
 */
import { createProfileViaApi, expect, goToResult, injectSession, signupViaApi, test } from './support/fixtures';

test('사주 요약 — 내 사주에서 열고, 분야별 요약이 모두 있고, 텍스트로 복사된다', async ({ page, api, context }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { tokens } = await signupViaApi(api, { nickname: '요약' });
  const profile = await createProfileViaApi(api, tokens.accessToken, '서윤');
  await injectSession(page, tokens);

  await page.goto(`/saju/${profile.id}`);
  await page.getByRole('link', { name: /사주 요약 한 장으로 보기/ }).click();
  await expect(page).toHaveURL(new RegExp(`/saju/${profile.id}/summary$`));
  await expect(page.getByRole('heading', { name: '서윤님의 사주 요약' })).toBeVisible();
  for (const h of ['사주 원국', '사주 분석', '대운(10년 단위의 흐름)', '한눈에 보는 나', '분야별 한 줄 요약']) {
    await expect(page.getByRole('heading', { name: h, exact: true })).toBeVisible();
  }
  // 잠긴 항목도 한 줄 요약은 보인다
  for (const label of ['재물운', '연애·결혼운', '일과 적성', '건강']) {
    await expect(page.locator('dt', { hasText: new RegExp(`^${label}$`) })).toBeVisible();
  }
  // 앱 테마와 상관없이 흰 바탕
  const bg = await page.locator('.paper').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(255, 255, 255)');
  await page.screenshot({ path: info.outputPath('summary.png'), fullPage: true });

  await page.getByRole('button', { name: '텍스트로 복사' }).last().click();
  await expect(page.getByText('사주 요약을 복사했어요')).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('[서윤 사주 요약 · 달달사주]');
  expect(text).toContain('■ 사주 원국');
  expect(text).toMatch(/재물운: .+/);
  expect(text).toMatch(/연애·결혼운: .+/);
});

test('사주 요약 — 비회원 결과에서도 열린다', async ({ page }) => {
  await goToResult(page, { name: '하늘', date: '19950314', time: '14:30', gender: 'female' });
  await page.getByRole('link', { name: /사주 요약 한 장으로 보기/ }).click();
  await expect(page).toHaveURL(/\/result\/summary$/);
  await expect(page.getByRole('heading', { name: '하늘님의 사주 요약' })).toBeVisible();
  await expect(page.getByText('갑진(甲辰)일주', { exact: false })).toBeVisible();
});
