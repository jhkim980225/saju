/**
 * 사주 기초 — 사주를 처음 보는 사람이 '전문가 보기' 표를 읽을 수 있게
 *  - 표의 줄 이름·값을 누르면 뜻이 뜬다
 *  - /basics 안내 화면: 마이·전체 운세·결과 화면에서 들어간다
 */
import { expect, goToResult, test } from './support/fixtures';

test('전문가 보기 표의 용어를 누르면 뜻이 뜨고, 사주 기초 화면으로 이어진다', async ({ page }) => {
  await goToResult(page, { name: '서윤', date: '19950314', time: '14:30', gender: 'female' });
  await expect(page.getByText(/^갑진일주 · /)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /전문가 보기/ }).click();

  // 줄 이름 — 12운성이 무엇인지
  await page.getByRole('button', { name: '12운성 설명 보기' }).click();
  const sheet = page.getByRole('dialog');
  await expect(page.getByRole('dialog', { name: '12운성' })).toBeVisible();
  await expect(sheet.getByText('그 자리에서 내 기운이 얼마나 힘이 있는지 — 12단계')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // 값 — 甲辰일주의 일지 십성은 편재
  await page.getByRole('button', { name: '편재 설명 보기' }).first().click();
  await expect(sheet.getByText('내가 다스리는 기운 · 음양 같음')).toBeVisible();
  await page.keyboard.press('Escape');

  // 신강약 — 득령·득지·득세까지 함께
  await page.getByRole('button', { name: '신강약 설명 보기' }).click();
  await expect(sheet.getByRole('term').filter({ hasText: /^득령 / })).toBeVisible();
  await sheet.getByRole('link', { name: '사주 기초 전체 보기' }).click();
  await expect(page).toHaveURL(/\/basics$/);
  await expect(page.getByRole('heading', { level: 1, name: '사주 기초' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '사주는 여덟 글자예요' })).toBeVisible();

  // 접힌 목록을 펼치면 열 가지 십성이 모두 있다
  await page.getByText('열 가지 하나씩 보기').click();
  for (const name of ['비견', '겁재', '식신', '상관', '편재', '정재', '편관', '정관', '편인', '정인']) {
    await expect(page.getByRole('term').filter({ hasText: new RegExp(`^${name} `) })).toBeVisible();
  }
});

test('전체 운세 화면과 첫 화면에서 사주 기초로 들어간다', async ({ page }) => {
  await page.goto('/menu');
  await page.getByRole('link', { name: /사주 기초/ }).click();
  await expect(page).toHaveURL(/\/basics$/);
  await page.goto('/');
  await expect(page.getByRole('link', { name: /사주 기초/ })).toBeVisible();
});
