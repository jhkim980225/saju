/**
 * 시나리오 12 — 택일: 목적·기간 고르기 → 무료 미리보기(등급·Top 3, 근거 잠김) → 목업 결제 → 상세(날짜별 근거·조언) → 보관함
 */
import { apiCall, createProfileViaApi, expect, injectSession, signupViaApi, test } from './support/fixtures';

interface TaekilApiResult {
  id: string;
  locked: boolean;
  top: string[];
  days: { date: string; grade: string; reasons: unknown[] | null }[];
}

test('택일: 무료 미리보기 → 목업 결제 → 같은 결과의 상세가 열리고 보관함에 담긴다', async ({ page, api }) => {
  const { tokens } = await signupViaApi(api, { nickname: '서윤' });
  await createProfileViaApi(api, tokens.accessToken, '서윤');
  await injectSession(page, tokens);

  // 오늘 탭 → 택일 진입
  await page.goto('/today');
  await page.getByRole('link', { name: '좋은 날 고르기' }).click();
  await expect(page).toHaveURL(/\/taekil$/);

  await expect(page.getByRole('heading', { name: '무엇을 위한 날인가요?' })).toBeVisible();
  await page.getByRole('radio', { name: /^이사/ }).click();
  await expect(page.getByRole('radio', { name: /^이사/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: '다음 2개월' }).click();
  await expect(page.getByText(/^\d+월 \d+일\(.\) ~ \d+월 \d+일\(.\) · \d+일$/)).toBeVisible();
  await page.getByRole('button', { name: '좋은 날 찾기' }).click();

  // 무료 미리보기 — 등급·Top 3 날짜는 보이고, 근거는 잠겨 있다
  await expect(page).toHaveURL(/\/taekil\/r\/[\w-]+$/);
  const id = page.url().split('/').pop()!;
  await expect(page.getByRole('heading', { name: /^가장 좋은 날은 / })).toBeVisible();
  await expect(page.getByRole('heading', { name: '추천 Top 3' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^1위 / })).toBeVisible();
  await expect(page.getByText('서윤님의 이사 택일')).toBeVisible();
  const before = await apiCall<TaekilApiResult>(api, 'GET', `/taekil/${id}`, { token: tokens.accessToken });
  expect(before.locked).toBe(true);
  expect(before.top.length).toBe(3);

  // 날짜를 눌러도 잠금 안내만
  await page.getByRole('button', { name: /^1위 / }).click();
  const daySheet = page.getByRole('dialog');
  await expect(daySheet.getByText('이 날의 근거와 빠진 이유는 상세 풀이에서 볼 수 있어요.')).toBeVisible();
  await expect(daySheet.getByRole('heading', { name: '좋은 점' })).toHaveCount(0);
  await daySheet.getByRole('button', { name: '상세 풀이 열기 · 990원' }).click();

  // 목업 결제
  const paywall = page.getByRole('dialog');
  await expect(paywall.getByText('이사 택일 상세 풀이')).toBeVisible();
  await paywall.getByRole('button', { name: '990원 결제하기' }).click();
  await expect(page.getByRole('heading', { name: '결제가 완료됐어요' })).toBeVisible();
  await page.getByRole('button', { name: '이어서 읽기' }).click();

  // 같은 결과가 열린다
  await expect(page).toHaveURL(new RegExp(`/taekil/r/${id}$`));
  await expect(page.getByRole('heading', { name: '이사 맞춤 조언' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '날짜를 바꿀 수 없을 때' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '빠진 날짜와 이유' })).toBeVisible();
  await expect(page.getByRole('button', { name: /상세 풀이 열기/ })).toHaveCount(0);

  await page.getByRole('button', { name: /^1위 / }).click();
  const detail = page.getByRole('dialog');
  await expect(detail.getByRole('heading', { name: '좋은 점' })).toBeVisible();
  await expect(detail.getByText('시작하기 좋은 시간')).toBeVisible();
  // 용어(건제12신·황도)는 접혀 있다가 펼치면 보인다
  await expect(detail.getByText(/건제12신/).first()).toBeHidden();
  await detail.locator('summary', { hasText: '택일·사주 용어로 보면' }).click();
  await expect(detail.getByText(/건제12신/).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();

  const after = await apiCall<TaekilApiResult>(api, 'GET', `/taekil/${id}`, { token: tokens.accessToken });
  expect(after.locked).toBe(false);
  expect(after.top).toEqual(before.top);
  expect(after.days.map((d) => d.grade)).toEqual(before.days.map((d) => d.grade));
  expect(after.days.every((d) => Array.isArray(d.reasons))).toBe(true);

  // 보관함 → 같은 결과
  await page.goto('/my/reports');
  await page.getByRole('link', { name: /서윤님의 이사 택일/ }).click();
  await expect(page).toHaveURL(new RegExp(`/taekil/r/${id}$`));
});

test('택일: 후보 날짜 비교 — 고른 날짜만 등급이 매겨진다', async ({ page, api }) => {
  const { tokens } = await signupViaApi(api);
  await createProfileViaApi(api, tokens.accessToken, '민준');
  await injectSession(page, tokens);

  await page.goto('/taekil?purpose=contract');
  await expect(page.getByRole('radio', { name: /^계약/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: '후보 날짜 비교' }).click();
  await expect(page.getByRole('button', { name: '좋은 날 찾기' })).toBeDisabled();
  // 다음 달 10·17·24일
  await page.getByRole('button', { name: '다음 달' }).click();
  for (const day of [10, 17, 24]) await page.getByRole('button', { name: new RegExp(`^\\d{4}년 \\d+월 ${day}일 `) }).first().click();
  await expect(page.getByText('3개 골랐어요')).toBeVisible();
  await page.getByRole('button', { name: '좋은 날 찾기' }).click();

  await expect(page).toHaveURL(/\/taekil\/r\/[\w-]+$/);
  await expect(page.getByText('후보 3일', { exact: true })).toBeVisible();
  const id = page.url().split('/').pop()!;
  const r = await apiCall<TaekilApiResult>(api, 'GET', `/taekil/${id}`, { token: tokens.accessToken });
  expect(r.days.map((d) => Number(d.date.slice(8)))).toEqual([10, 17, 24]);
});
