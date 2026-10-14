/**
 * 추가 시나리오 — 저장한 사주 수정·삭제
 */
import { buyViaApi, createProfileViaApi, expect, guestViaApi, injectSession, signupViaApi, test } from './support/fixtures';

test('저장한 사주 수정: 기존 값이 채워지고, 저장 후 새 일주로 계산된다', async ({ page, api }) => {
  const guest = await guestViaApi(api);
  const me = await createProfileViaApi(api, guest.accessToken, '서윤');
  await injectSession(page, guest);

  await page.goto(`/profiles/${me.id}/edit`);
  await expect(page.getByRole('heading', { name: '사주 정보 수정' })).toBeVisible();
  await expect(page.locator('#name')).toHaveValue('서윤');
  await expect(page.getByPlaceholder('예) 19950314')).toHaveValue('1995.03.14');
  await expect(page.getByPlaceholder('예) 14:30')).toHaveValue('14:30');
  await expect(page.getByRole('radio', { name: '여성', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: '서울특별시', exact: true })).toBeVisible();

  // 하루 뒤로 수정 → 을사(乙巳)일주
  await page.getByPlaceholder('예) 19950314').fill('19950315');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/saju/${me.id}$`));
  await page.reload(); // 캐시와 무관하게 서버 계산 결과 확인 (캐시 문제는 아래 fixme 참고)
  await expect(page.getByText(/^을사일주 · /)).toBeVisible();
  await expect(page.getByText('양력 1995.03.15 14:30')).toBeVisible();
});

// BUG-02: 사주 정보를 수정해 저장하면 /saju/:id 로 돌아오지만, 직전에 본 풀이가 캐시(staleTime 30초)에 남아
// 수정 전 일주·생년월일(갑진일주, 1995.03.14)이 그대로 보인다. 새로고침해야 반영됨.
// 원인: BirthFormPage 저장 시 profiles 쿼리만 무효화하고 ['reading','profile',id,…]·daily·yearly·compat 쿼리는 그대로 둠.
test('사주 정보를 수정하면 돌아온 화면에 바로 새 풀이가 보인다', async ({ page, api }) => {
  const guest = await guestViaApi(api);
  const me = await createProfileViaApi(api, guest.accessToken, '서윤');
  await injectSession(page, guest);

  await page.goto(`/saju/${me.id}`);
  await expect(page.getByText(/^갑진일주 · /)).toBeVisible();
  await page.getByRole('link', { name: '입력 정보 수정' }).click();
  await expect(page.locator('#name')).toHaveValue('서윤');
  await page.getByPlaceholder('예) 19950314').fill('19950315');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/saju/${me.id}$`));
  await expect(page.getByText(/^을사일주 · /)).toBeVisible();
  await expect(page.getByText('양력 1995.03.15 14:30')).toBeVisible();
});

test('저장한 사주 삭제: 확인 후 목록에서 사라지고 오늘 탭은 다른 사주로 바뀐다', async ({ page, api }) => {
  const guest = await guestViaApi(api);
  await createProfileViaApi(api, guest.accessToken, '서윤');
  await createProfileViaApi(api, guest.accessToken, '엄마', { calendar: 'solar', year: 1965, month: 5, day: 5, hour: 7, minute: 0, gender: 'female', timeZone: 'Asia/Seoul', longitude: 126.978, timeCorrection: 'lmt', ziHourRule: 'nextDay' }, 'family');
  await injectSession(page, guest);

  await page.goto('/my');
  await expect(page.getByRole('heading', { name: '저장한 사주 (2)' })).toBeVisible();

  // 확인 창에서 취소하면 그대로
  page.once('dialog', (d) => void d.dismiss());
  await page.getByRole('button', { name: '서윤 삭제' }).click();
  await expect(page.getByRole('heading', { name: '저장한 사주 (2)' })).toBeVisible();

  let message = '';
  page.once('dialog', (d) => {
    message = d.message();
    void d.accept();
  });
  await page.getByRole('button', { name: '서윤 삭제' }).click();
  await expect(page.getByRole('heading', { name: '저장한 사주 (1)' })).toBeVisible();
  expect(message).toBe('서윤님의 사주를 삭제할까요?');
  await expect(page.getByRole('button', { name: '서윤 삭제' })).toHaveCount(0);

  await page.goto('/today');
  await expect(page.getByRole('button', { name: '엄마 ▾' })).toBeVisible();
  await expect(page.getByText('오늘의 한 줄')).toBeVisible();
});

test('구매한 풀이가 있는 사주는 출생 정보를 바꿀 수 없고, 이름은 바꿀 수 있다', async ({ page, api }) => {
  const { tokens } = await signupViaApi(api);
  const me = await createProfileViaApi(api, tokens.accessToken, '서윤');
  await buyViaApi(api, tokens.accessToken, 'report_saju_mini', me.id);
  await injectSession(page, tokens);

  await page.goto(`/profiles/${me.id}/edit`);
  await expect(page.locator('#name')).toHaveValue('서윤');
  await page.getByPlaceholder('예) 19950314').fill('19950315');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('구매한 풀이가 있는 사주는 출생 정보를 바꿀 수 없어요');
  await expect(page).toHaveURL(new RegExp(`/profiles/${me.id}/edit$`));

  // 출생 정보는 그대로 두고 이름만 바꾸면 저장된다
  await page.getByPlaceholder('예) 19950314').fill('19950314');
  await page.locator('#name').fill('서윤이');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/saju/${me.id}$`));
  await expect(page.getByRole('heading', { name: '서윤이님의 사주' })).toBeVisible();
  await expect(page.getByText(/^갑진일주 · /)).toBeVisible();
});
