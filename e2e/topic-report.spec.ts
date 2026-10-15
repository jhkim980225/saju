/**
 * 시나리오 13 — 주제별 리포트(연애·결혼운 · 재물·직업운, 각 4,900원).
 *  - 내 사주의 리포트 카드에서 목업 결제 → '이어서 읽기'로 카드 자리에 돌아옴 → '보고서 열기' → 12개 장 → 보관함
 *  - 상점에서 프로필을 골라 결제 → 이미 산 프로필은 상점에서도 다시 사지 않고 바로 열림 → 투자 안내 · PDF로 저장
 * E2E 는 AI 키가 없으므로 규칙 기반 최종본이다(다듬기 진행 표시 없음).
 */
import { BIRTH_PARTNER, apiCall, createProfileViaApi, expect, injectSession, signupViaApi, test } from './support/fixtures';

test('연애·결혼운 — 내 사주에서 결제하고 바로 열어 읽은 뒤 보관함에서 다시 찾는다', async ({ page, api }) => {
  const { tokens } = await signupViaApi(api, { nickname: '연애' });
  const profile = await createProfileViaApi(api, tokens.accessToken, '서윤');
  await injectSession(page, tokens);

  await page.goto(`/saju/${profile.id}`);
  await expect(page.getByText(/^갑진일주 · /)).toBeVisible();
  const love = page.getByRole('article', { name: '연애·결혼운 리포트' });
  await love.scrollIntoViewIfNeeded();
  await expect(love.getByText('4,900원')).toBeVisible();
  await love.getByRole('button', { name: '구매하기' }).click();

  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('서윤님의 연애·결혼운 리포트')).toBeVisible();
  await expect(sheet.getByRole('radio', { name: /연애·결혼운 리포트/ })).toHaveAttribute('aria-checked', 'true');
  await sheet.getByRole('button', { name: '4,900원 결제하기' }).click();
  await expect(page).toHaveURL(/\/payments\/success\?/);
  await expect(page.getByRole('heading', { name: '결제가 완료됐어요' })).toBeVisible();

  // 이어서 읽기 → 내 사주의 리포트 카드 자리로 돌아오고, 산 리포트는 '보고서 열기'
  await page.getByRole('button', { name: '이어서 읽기' }).click();
  await expect(page).toHaveURL(new RegExp(`/saju/${profile.id}#topic-reports$`));
  const open = page.getByRole('article', { name: '연애·결혼운 리포트' }).getByRole('button', { name: '보고서 열기' });
  await expect(open).toBeVisible();
  await expect(page.getByRole('article', { name: '재물·직업운 리포트' }).getByRole('button', { name: '구매하기' })).toBeVisible();
  await open.scrollIntoViewIfNeeded();
  await open.click();

  // 결제 확정 때 미리 만든 저장본이 바로 열린다
  await expect(page).toHaveURL(/\/reports\/[\w-]+$/);
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: '서윤님의 연애·결혼운 리포트' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '목차' })).toBeVisible();
  await expect.poll(() => page.locator('section[id^="sec-"]').count()).toBe(12);
  // 사주를 몰라도 읽히게 — 이름으로 부르고, 용어는 '사주로 보면'을 펼쳐야 보인다
  await expect(page.locator('#sec-summary .prose-reading p').first()).toHaveText(/^서윤님은 /);
  await expect(page.locator('#sec-spousePalace')).toContainText('가까운 사이');
  await expect(page.locator('#sec-spousePalace details')).not.toHaveAttribute('open', '');
  await expect(page.locator('#sec-decade')).toContainText('2036');
  await expect(page.getByText('AI가 문장을 다듬고 있어요')).toHaveCount(0);
  const reportUrl = page.url();

  // 보관함: 목록에 있고, 아래 카드에서도 다시 열린다
  await page.goto('/my/reports');
  const link = page.getByRole('link', { name: /서윤님의 연애·결혼운 리포트/ });
  await expect(link).toBeVisible();
  await expect(link.getByText('연애·결혼운', { exact: true })).toBeVisible();
  const libraryLove = page.getByRole('article', { name: '연애·결혼운 리포트' });
  await libraryLove.scrollIntoViewIfNeeded();
  await libraryLove.getByRole('button', { name: '보고서 열기' }).click();
  await expect(page).toHaveURL(reportUrl);

  const orders = await apiCall<{ productId: string; status: string }[]>(api, 'GET', '/orders', { token: tokens.accessToken });
  expect(orders).toEqual([expect.objectContaining({ productId: 'report_love', status: 'paid' })]);
});

test('재물·직업운 — 상점에서 프로필을 골라 결제하고, 산 프로필은 상점에서도 바로 열리며 PDF로 저장된다', async ({ page, api }) => {
  const { tokens } = await signupViaApi(api, { nickname: '재물' });
  const profile = await createProfileViaApi(api, tokens.accessToken, '도윤', BIRTH_PARTNER);
  await injectSession(page, tokens);
  await page.addInitScript(() => {
    const w = window as unknown as { __printed: number };
    w.__printed = 0;
    window.print = () => void (w.__printed += 1);
  });

  await page.goto('/store');
  await expect(page.getByRole('heading', { name: '주제별 리포트' })).toBeVisible();
  const item = page.getByRole('listitem').filter({ hasText: '재물·직업운 리포트' });
  await expect(item.getByText('4,900원')).toBeVisible();
  await item.getByRole('button', { name: '구매하기' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /도윤/ }).click();
  await expect(page.getByRole('heading', { name: '결제가 완료됐어요' })).toBeVisible();
  await page.getByRole('button', { name: '이어서 읽기' }).click();
  await expect(page).toHaveURL(new RegExp(`/saju/${profile.id}#topic-reports$`));

  // 상점에서 같은 프로필을 다시 고르면 결제하지 않고 바로 연다
  await page.goto('/store');
  await page.getByRole('listitem').filter({ hasText: '재물·직업운 리포트' }).getByRole('button', { name: '구매하기' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /도윤.*보고서 열기/ }).click();
  await expect(page).toHaveURL(/\/reports\/[\w-]+$/);
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: '도윤님의 재물·직업운 리포트' })).toBeVisible();
  await expect.poll(() => page.locator('section[id^="sec-"]').count()).toBe(12);
  await expect(page.getByText('재물운은 투자 조언이 아니에요. 투자 결정은 본인의 판단과 전문가의 조언에 따라 주세요.')).toBeVisible();

  await page.getByRole('button', { name: 'PDF로 저장' }).last().click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);

  const orders = await apiCall<{ productId: string; status: string }[]>(api, 'GET', '/orders', { token: tokens.accessToken });
  expect(orders).toEqual([expect.objectContaining({ productId: 'report_career_wealth', status: 'paid' })]);
});
