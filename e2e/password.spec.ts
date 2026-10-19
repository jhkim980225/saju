/**
 * 비밀번호 찾기 · 재설정 · 변경
 * 로컬 E2E 서버는 메일 키가 없으므로(playwright.config.ts 에서 비움) /password/forgot 은 문의 안내 화면이다.
 * 재설정 메일 흐름(토큰 발급 → 새 비밀번호)은 API 단위 테스트(apps/api/test/password.test.ts)가 검증한다.
 */
import { apiCall, expect, guestViaApi, injectSession, signupViaApi, test } from './support/fixtures';

test('로그인 화면의 링크로 비밀번호 찾기에 가면 메일 연동이 없어 문의 안내가 보인다', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: '비밀번호를 잊으셨나요?' }).click();
  await expect(page).toHaveURL(/\/password\/forgot$/);
  await expect(page.getByRole('heading', { name: '비밀번호 찾기' })).toBeVisible();
  await expect(page.getByText('지금은 메일로 재설정할 수 없습니다.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'help@dalbitsaju.test' })).toHaveAttribute('href', /^mailto:help@dalbitsaju\.test\?subject=/);
  // 이메일 입력 폼은 없다
  await expect(page.getByRole('textbox')).toHaveCount(0);

  await page.getByRole('link', { name: '로그인으로 돌아가기' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('잘못된 재설정 링크는 안내와 다시 요청하기 링크를 보여 준다', async ({ page }) => {
  await page.goto('/password/reset?token=bad');
  await expect(page.getByRole('heading', { name: '비밀번호 재설정' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('재설정 링크가 올바르지 않습니다. 메일의 링크를 다시 확인하거나 새로 요청해 주세요.');
  await expect(page.getByLabel('새 비밀번호', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '다시 요청하기' }).click();
  await expect(page).toHaveURL(/\/password\/forgot$/);

  // 토큰이 아예 없어도 같은 안내
  await page.goto('/password/reset');
  await expect(page.getByRole('alert')).toHaveText(/재설정 링크가 올바르지 않습니다/);

  // 형식은 맞지만 발급된 적 없는 토큰 → 서버 400 → 안내로 전환
  await page.goto(`/password/reset?token=${'a'.repeat(43)}`);
  await page.getByLabel('새 비밀번호', { exact: true }).fill('brand-new-pass-1');
  await page.getByLabel('새 비밀번호 확인').fill('brand-new-pass-x');
  await page.getByRole('button', { name: '비밀번호 바꾸기' }).click();
  await expect(page.getByRole('alert')).toHaveText('두 비밀번호가 서로 다릅니다. 같은 비밀번호를 입력해 주세요.');
  await page.getByLabel('새 비밀번호 확인').fill('brand-new-pass-1');
  await page.getByRole('button', { name: '비밀번호 바꾸기' }).click();
  await expect(page.getByRole('alert')).toHaveText('링크가 만료됐거나 이미 사용됐습니다. 다시 요청해 주세요.');
  await expect(page.getByRole('link', { name: '다시 요청하기' })).toBeVisible();
});

test('마이에서 비밀번호를 바꾸면 새 비밀번호로만 로그인된다', async ({ page, api }) => {
  const { email, password, tokens } = await signupViaApi(api, { nickname: '비번변경' });
  await injectSession(page, tokens);
  const newPassword = 'changed-pass-22';

  await page.goto('/my');
  await expect(page.getByText('비번변경님')).toBeVisible();
  await page.getByRole('button', { name: '비밀번호 변경' }).click();
  const sheet = page.getByRole('dialog', { name: '비밀번호 변경' });
  await expect(sheet).toBeVisible();

  // 새 비밀번호 확인이 다르면 보내지 않고 안내
  await sheet.getByLabel('현재 비밀번호').fill(password);
  await sheet.getByLabel('새 비밀번호', { exact: true }).fill(newPassword);
  await sheet.getByLabel('새 비밀번호 확인').fill('changed-pass-2x');
  await sheet.getByRole('button', { name: '바꾸기' }).click();
  await expect(sheet.getByRole('alert')).toHaveText('새 비밀번호가 서로 다릅니다. 같은 비밀번호를 입력해 주세요.');

  // 현재 비밀번호가 틀리면 서버 안내
  await sheet.getByLabel('현재 비밀번호').fill('wrong-password');
  await sheet.getByLabel('새 비밀번호 확인').fill(newPassword);
  await sheet.getByRole('button', { name: '바꾸기' }).click();
  await expect(sheet.getByRole('alert')).toHaveText('현재 비밀번호가 일치하지 않아요.');

  // 맞게 입력하면 바뀌고 시트가 닫힌다
  await sheet.getByLabel('현재 비밀번호').fill(password);
  await sheet.getByRole('button', { name: '바꾸기' }).click();
  await expect(page.getByText('비밀번호를 바꿨어요.')).toBeVisible();
  await expect(sheet).toBeHidden();

  // 옛 비밀번호로는 로그인되지 않는다
  await expect(apiCall(api, 'POST', '/auth/login', { body: { email, password } })).rejects.toThrow(/401/);

  // 로그아웃한 뒤 새 비밀번호로 로그인
  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/login?next=/my');
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page).toHaveURL(/\/my$/);
  await expect(page.getByText('비번변경님')).toBeVisible();
});

test('게스트에게는 비밀번호 변경 항목이 보이지 않는다', async ({ page, api }) => {
  const guest = await guestViaApi(api);
  await injectSession(page, guest);
  await page.goto('/my');
  await expect(page.getByRole('radiogroup', { name: '화면 테마' })).toBeVisible();
  await expect(page.getByRole('button', { name: '비밀번호 변경' })).toHaveCount(0);
});
