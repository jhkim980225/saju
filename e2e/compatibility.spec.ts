/**
 * 시나리오 5 — 궁합: 두 번째 사람 추가 → 점수·잠금 → 번들(신년 패키지) 결제 → 궁합 1회권 사용으로 잠금 해제
 */
import { apiCall, createProfileViaApi, expect, fillBirthForm, injectSession, lockedSections, signupViaApi, test } from './support/fixtures';

test('궁합: 상대 추가 → 점수와 잠금 → 번들 결제 → 1회권으로 잠금 해제', async ({ page, api }) => {
  const { tokens } = await signupViaApi(api, { nickname: '서윤' });
  await createProfileViaApi(api, tokens.accessToken, '서윤');
  await injectSession(page, tokens);

  await page.goto('/compatibility');
  await expect(page.getByRole('heading', { name: '누구와의 궁합이 궁금하세요?' })).toBeVisible();
  await expect(page.getByRole('button', { name: '서윤', exact: true })).toBeVisible();
  await expect(page.getByText('두 사람이 얼마나 잘 맞는지 볼까요?')).toBeVisible();

  // 상대 추가
  await page.getByRole('button', { name: '사람 고르기', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '사람 추가하기' }).click();
  await expect(page).toHaveURL(/\/profiles\/new\?save=1&relation=partner&next=%2Fcompatibility/);
  await expect(page.getByRole('button', { name: '연인·배우자' })).toHaveAttribute('aria-pressed', 'true');
  await fillBirthForm(page, { name: '지훈', date: '19920820', time: '09:15', gender: 'male' });
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page).toHaveURL(/\/compatibility$/);

  // 상대 고르기 → 점수·근거
  await page.getByRole('button', { name: '+ 사람 고르기' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /지훈.*원숭이띠/ }).click();
  await expect(page).toHaveURL(/\/compatibility\?a=[\w-]+&b=[\w-]+/);
  await expect(page.getByText('서윤 × 지훈', { exact: true })).toBeVisible();
  // 무료 요약은 두 사람을 이름으로, 쉬운 말로
  await expect(page.getByText(/^서윤님은 .+ 사람이고, 지훈님은 .+ 사람이에요\.$/)).toBeVisible();
  const score = page.locator('p.tabular.font-serif');
  await expect(score).toHaveText(/^\d{1,3}$/);
  for (const label of ['성격', '끌림·애정', '안정·생활', '서로 채워줌']) await expect(page.getByLabel(new RegExp(`^${label} \\d+점$`))).toBeVisible();
  const lockedCount = await lockedSections(page).count();
  expect(lockedCount).toBeGreaterThan(0);

  // 잠금 해제 시도 → 권한 없음(402) → 결제 시트 → 번들 선택 → 목업 결제
  await lockedSections(page).first().getByRole('button', { name: /전체 풀이 열기/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('잘 맞는 점 · 부딪히는 점 · 함께 지내는 법')).toBeVisible();
  await expect(sheet.getByRole('radio')).toHaveCount(2);
  await sheet.getByRole('radio', { name: /2027 신년 패키지/ }).click();
  await sheet.getByRole('button', { name: '16,900원 결제하기' }).click();

  await expect(page).toHaveURL(/\/payments\/success\?/);
  await expect(page.getByRole('heading', { name: '결제가 완료됐어요' })).toBeVisible();
  await expect(page.getByText('AI 상담 질문권 10회가 지급됐어요.')).toBeVisible();
  const wallet = await apiCall<{ entitlements: { key: string }[] }>(api, 'GET', '/wallet', { token: tokens.accessToken });
  expect(wallet.entitlements.map((e) => e.key)).toEqual(expect.arrayContaining([expect.stringMatching(/^ticket:compatibility:/)]));

  // 원래 궁합 화면으로 복귀 — 아직 1회권은 쓰지 않은 상태
  await page.getByRole('button', { name: '이어서 읽기' }).click();
  await expect(page).toHaveURL(/\/compatibility\?a=[\w-]+&b=[\w-]+/);
  await expect(page.getByText('서윤 × 지훈', { exact: true })).toBeVisible();
  await expect(lockedSections(page)).toHaveCount(lockedCount);

  // 잠금 해제 → 1회권 사용
  await lockedSections(page).first().getByRole('button', { name: /전체 풀이 열기/ }).click();
  await expect(page.getByText('궁합 1회권을 사용했어요')).toBeVisible();
  await expect(lockedSections(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /전체 풀이 열기/ })).toHaveCount(0);

  const after = await apiCall<{ entitlements: { key: string }[] }>(api, 'GET', '/wallet', { token: tokens.accessToken });
  const keys = after.entitlements.map((e) => e.key);
  expect(keys.some((k) => k.startsWith('ticket:compatibility:'))).toBe(false);
  expect(keys.some((k) => k.startsWith('report:compatibility:'))).toBe(true);
});
