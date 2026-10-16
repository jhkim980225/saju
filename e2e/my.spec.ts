/**
 * 시나리오 8 — 마이: 화면 테마(밤하늘·밝은 화면·기기 설정, data-theme), 글자 크기, 로그아웃, 회원 탈퇴 후 재로그인 불가
 */
import { apiCall, createProfileViaApi, expect, injectSession, signupViaApi, test } from './support/fixtures';

test('화면 테마·글자 크기 설정이 적용되고 새로고침 후에도 유지된다', async ({ page }) => {
  await page.goto('/my');
  const html = page.locator('html');
  const themeGroup = page.getByRole('radiogroup', { name: '화면 테마' });
  // 기본은 로고와 같은 밤하늘(남색)
  await expect(themeGroup.getByRole('radio', { name: '밤하늘' })).toHaveAttribute('aria-checked', 'true');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', '#060B24');
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await themeGroup.getByRole('radio', { name: '밝은 화면' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', '#F5F1E8');
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(lightBg).not.toBe(darkBg);

  const fontGroup = page.getByRole('radiogroup', { name: '글자 크기' });
  await expect(fontGroup.getByRole('radio', { name: '보통' })).toHaveAttribute('aria-checked', 'true');
  const baseSize = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  await fontGroup.getByRole('radio', { name: '크게', exact: true }).click();
  await expect(fontGroup.getByRole('radio', { name: '크게', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--font-scale'))).toBe('1.125');
  const largeSize = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  expect(largeSize).toBeGreaterThan(baseSize);

  // 새로고침 후 유지
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('radiogroup', { name: '화면 테마' }).getByRole('radio', { name: '밝은 화면' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--font-scale'))).toBe('1.125');

  // 기기 설정을 따르면 브라우저(colorScheme=light)대로, 밤하늘로 돌아가면 남색
  await page.getByRole('radiogroup', { name: '화면 테마' }).getByRole('radio', { name: '기기 설정' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.getByRole('radiogroup', { name: '화면 테마' }).getByRole('radio', { name: '밤하늘' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(darkBg);
});

test('로그아웃하면 세션이 지워지고 랜딩으로 돌아간다', async ({ page, api }) => {
  const { tokens } = await signupViaApi(api, { nickname: '로그아웃' });
  await createProfileViaApi(api, tokens.accessToken, '서윤');
  await injectSession(page, tokens);

  await page.goto('/my');
  await expect(page.getByText('로그아웃님')).toBeVisible();
  await expect(page.getByRole('heading', { name: '저장한 사주 (1)' })).toBeVisible();
  await page.getByRole('button', { name: '로그아웃' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: '로그인' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('yd.session'))).toBeNull();

  // 폐기된 refresh token 은 더 이상 쓸 수 없다
  await expect(apiCall(api, 'POST', '/auth/refresh', { body: { refreshToken: tokens.refreshToken } })).rejects.toThrow(/401/);

  // 마이로 다시 가면 비회원(로그인 유도) 상태
  await page.goto('/my');
  await expect(page.getByText('로그인하면 저장한 사주와 구매 내역을 안전하게 보관해요')).toBeVisible();
  await expect(page.getByRole('button', { name: '로그아웃' })).toHaveCount(0);
});

test('회원 탈퇴 후에는 같은 계정으로 다시 로그인할 수 없다', async ({ page, api }) => {
  const { email, password, tokens } = await signupViaApi(api, { nickname: '탈퇴' });
  await createProfileViaApi(api, tokens.accessToken, '서윤');
  await injectSession(page, tokens);

  // 탈퇴 전에는 로그인 가능
  await apiCall(api, 'POST', '/auth/login', { body: { email, password } });

  await page.goto('/my');
  await expect(page.getByText('탈퇴님')).toBeVisible();
  await page.getByRole('button', { name: '탈퇴하기' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('탈퇴할까요?')).toBeVisible();
  await expect(sheet.getByText('탈퇴하면 저장한 사주와 풀이 기록이 삭제되고 되돌릴 수 없어요.')).toBeVisible();
  // 취소하면 그대로
  await sheet.getByRole('button', { name: '취소' }).click();
  await expect(sheet).toBeHidden();
  await page.getByRole('button', { name: '탈퇴하기' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '탈퇴하기' }).click();

  await expect(page.getByText('탈퇴가 완료되었습니다. 그동안 이용해 주셔서 감사합니다.')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => localStorage.getItem('yd.session'))).toBeNull();

  // 같은 이메일·비밀번호로 로그인 시도 → 실패
  await page.goto('/login');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('이메일 또는 비밀번호가 일치하지 않아요.');
  await expect(page).toHaveURL(/\/login/);

  // 탈퇴 전 발급된 토큰도 무효
  await expect(apiCall(api, 'GET', '/profiles', { token: tokens.accessToken })).rejects.toThrow(/401/);
});

test('액세스 토큰이 만료돼도 refresh token 으로 자동 갱신해 화면이 이어진다', async ({ page, api }) => {
  const { tokens } = await signupViaApi(api, { nickname: '갱신' });
  await createProfileViaApi(api, tokens.accessToken, '서윤');
  await injectSession(page, { ...tokens, accessToken: 'expired.invalid.token' });

  const refreshed = page.waitForResponse((r) => r.url().endsWith('/auth/refresh') && r.status() === 200);
  await page.goto('/my');
  await refreshed;
  await expect(page.getByText('갱신님')).toBeVisible();
  await expect(page.getByRole('heading', { name: '저장한 사주 (1)' })).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('yd.session')!) as { accessToken: string; refreshToken: string });
  expect(stored.accessToken).not.toBe('expired.invalid.token');
  expect(stored.refreshToken).not.toBe(tokens.refreshToken); // 회전
});
