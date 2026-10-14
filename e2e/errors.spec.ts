/**
 * 시나리오 9 — 오류 처리: 존재하지 않는 경로 → 404 화면, 처음으로 복귀
 */
import { expect, guestViaApi, injectSession, test } from './support/fixtures';

test('존재하지 않는 경로는 404 화면을 보여 주고 처음으로 돌아갈 수 있다', async ({ page }) => {
  const res = await page.goto('/this-page/does-not-exist');
  expect(res?.status()).toBe(200); // SPA fallback — 화면에서 404 처리
  await expect(page.getByText('페이지를 찾을 수 없어요')).toBeVisible();
  await expect(page.getByText('주소가 바뀌었거나 사라진 페이지예요.')).toBeVisible();
  await expect(page).toHaveTitle(/달빛사주/);

  await page.getByRole('button', { name: '처음으로' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: '내 사주 보기' })).toBeVisible();
});

test('결과 화면에 입력 없이 들어오면 입력 화면으로 보낸다', async ({ page }) => {
  await page.goto('/result');
  await expect(page).toHaveURL(/\/input$/);
  await page.goto('/confirm');
  await expect(page).toHaveURL(/\/input$/);
});

test('없는 리포트·남의 프로필 주소는 오류 상태로 안내한다(빈 화면 금지)', async ({ page, api }) => {
  const guest = await guestViaApi(api);
  await injectSession(page, guest);
  await page.goto('/yearly/00000000-0000-0000-0000-000000000000');
  await expect(page.getByRole('alert')).toBeVisible();
  await page.goto('/reports/00000000-0000-0000-0000-000000000000');
  await expect(page.getByRole('alert')).toContainText('페이지를 찾을 수 없어요');
});
