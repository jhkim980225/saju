/**
 * 시나리오 — 2027 토정비결(무료): 생년월일 입력 → 괘·총평·열두 달·작괘 근거 → 신년운세 추천·공유,
 * 다시 입력(음력 윤달), 저장한 사주로 보기(오늘 탭 바로가기 → 신년운세로 이어짐)
 */
import { createProfileViaApi, expect, guestViaApi, injectSession, test } from './support/fixtures';

test('비회원: 양력 생년월일 입력 → 163괘 결과 → 새로고침해도 유지 → 음력 윤달로 다시 보기', async ({ page }) => {
  await page.goto('/tojeong');
  await expect(page).toHaveTitle(/2027 토정비결/);
  await expect(page.getByRole('heading', { name: /2027년, 나의 한 해를 괘 하나로 읽어요/ })).toBeVisible();

  // 형식 오류
  await page.getByRole('textbox', { name: '생년월일' }).fill('199005');
  await page.getByRole('button', { name: '토정비결 보기' }).click();
  await expect(page.getByRole('alert')).toBeVisible();

  // 1990-05-15(양력) = 음력 1990-04-21 → 2027 丁未년 163괘
  await page.getByRole('textbox', { name: '생년월일' }).fill('19900515');
  await page.getByRole('button', { name: '토정비결 보기' }).click();
  await expect(page.getByText('163괘', { exact: true })).toBeVisible();
  await expect(page.getByText('2027 정미(丁未)년 토정비결')).toBeVisible();
  await expect(page.getByRole('heading', { name: '총평' })).toBeVisible();
  await expect(page.locator('[data-flow]')).toHaveCount(12);
  await expect(page.getByText(/^음력 1월/)).toBeVisible();
  await expect(page.getByText('(2.7 ~ 3.7)')).toBeVisible();

  // 작괘 근거(접힘 → 펼침)
  await page.getByText('괘를 뽑은 방법').click();
  await expect(page.getByText('음력 1990년 4월 21일 · 2027년 세는나이 38세')).toBeVisible();
  await expect(page.getByText('38 + 19(丁未) = 57 → 8로 나눈 나머지 1')).toBeVisible();
  await expect(page.getByText('30 + 12(乙巳월) = 42 → 6으로 나눈 나머지 6')).toBeVisible();
  await expect(page.getByText('21 + 15(乙巳일) = 36 → 3으로 나눈 나머지 3')).toBeVisible();

  // 신년운세 추천 — 저장한 사주가 없으면 사주 입력으로
  await expect(page.getByRole('link', { name: '내 사주로 신년운세 보기' })).toHaveAttribute('href', '/input');

  // 공유 시트
  await page.getByRole('button', { name: '공유', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: /링크 복사/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  // 데스크톱(1024px↑)은 2단 — 근거·추천 열이 본문 오른쪽에 놓인다
  if (test.info().project.name.startsWith('desktop')) {
    const main = await page.getByRole('heading', { name: '총평' }).boundingBox();
    const side = await page.getByText('괘를 뽑은 방법').boundingBox();
    expect(side!.x).toBeGreaterThan(main!.x + 300);
  }

  // 새로고침해도 마지막 입력으로 바로 결과
  await page.reload();
  await expect(page.getByText('163괘', { exact: true })).toBeVisible();

  // 음력 윤달로 다시 보기: 음력 1987년 윤6월 10일 → 평달 6월로 계산 → 411괘
  await page.getByRole('button', { name: '다른 생년월일', exact: true }).click();
  await page.getByRole('radio', { name: '음력' }).click();
  await page.getByRole('textbox', { name: '생년월일' }).fill('19870610');
  await page.getByLabel(/윤달이에요/).check();
  await page.getByRole('button', { name: '토정비결 보기' }).click();
  await expect(page.getByText('411괘', { exact: true })).toBeVisible();
  await page.getByText('괘를 뽑은 방법').click();
  await expect(page.getByText('음력 1987년 윤6월 10일 · 2027년 세는나이 41세')).toBeVisible();
  await expect(page.getByText('윤6월 출생이라 평달 6월로 계산했어요.')).toBeVisible();
});

test('없는 음력 날짜는 안내 후 다시 입력할 수 있다', async ({ page }) => {
  await page.goto('/tojeong');
  await page.getByRole('radio', { name: '음력' }).click();
  await page.getByRole('textbox', { name: '생년월일' }).fill('19950130'); // 1995년 음력 정월은 29일까지
  await page.getByRole('button', { name: '토정비결 보기' }).click();
  await expect(page.getByText('이 생년월일로는 괘를 뽑을 수 없어요')).toBeVisible();
  await expect(page.getByText(/존재하지 않는 날짜/)).toBeVisible();
  await page.getByRole('button', { name: '생년월일 다시 입력' }).click();
  await page.getByRole('textbox', { name: '생년월일' }).fill('19950129');
  await page.getByRole('button', { name: '토정비결 보기' }).click();
  await expect(page.locator('[data-flow]')).toHaveCount(12);
});

test('저장한 사주: 오늘 탭 바로가기 → 프로필로 본 452괘 → 신년운세로 이어진다', async ({ page, api }) => {
  // BIRTH_ME 양력 1995-03-14 = 음력 2월 14일 → 2027년 33세, 2월 癸卯·큰달, 3월 21일 己亥 → 452괘
  const guest = await guestViaApi(api);
  const profile = await createProfileViaApi(api, guest.accessToken, '서윤');
  await injectSession(page, guest);

  await page.goto('/today');
  await page.getByRole('link', { name: /2027 토정비결/ }).click();
  await expect(page).toHaveURL(/\/tojeong$/);
  await expect(page.getByRole('button', { name: '서윤', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('452괘', { exact: true })).toBeVisible();
  await expect(page.getByText('서윤님의 2027 정미(丁未)년 토정비결')).toBeVisible();

  const upsell = page.getByRole('link', { name: '신년운세 보기', exact: true });
  await expect(upsell).toHaveAttribute('href', `/yearly/${profile.id}?year=2027`);
  await upsell.click();
  await expect(page).toHaveURL(new RegExp(`/yearly/${profile.id}\\?year=2027$`));
  await expect(page.getByRole('heading', { name: '2027 신년운세' })).toBeVisible();
});
