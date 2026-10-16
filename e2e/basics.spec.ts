/**
 * 사주 기초 — 사주를 처음 보는 사람이 '전문가 보기' 표를 읽을 수 있게
 *  - 표의 줄 이름·값을 누르면 뜻이 뜬다
 *  - 사주 기초는 첫 화면·결과 화면에서 팝업으로 열린다(보던 화면을 떠나지 않게). 마이·전체 운세에서는 /basics 화면으로 간다
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
  await expect(sheet.getByText('각 지지에서 일간의 기운이 어떤 상태인지')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // 값 — 甲辰일주의 일지 십성은 편재
  await page.getByRole('button', { name: '편재 설명 보기' }).first().click();
  await expect(sheet.getByText('일간이 극하는 오행 · 음양이 같음')).toBeVisible();
  await page.keyboard.press('Escape');

  // 신강약 — 득령·득지·득세까지 함께
  await page.getByRole('button', { name: '신강약 설명 보기' }).click();
  await expect(sheet.getByRole('term').filter({ hasText: /^득령 / })).toBeVisible();
  // 용어 시트의 '사주 기초 전체 보기' → 결과 화면 위에 사주 기초 팝업
  await sheet.getByRole('button', { name: '사주 기초 전체 보기' }).click();
  const basics = page.getByRole('dialog', { name: '사주 기초' });
  await expect(basics.getByRole('heading', { name: '사주는 여덟 글자로 이루어져 있어요' })).toBeVisible();
  await expect(page).toHaveURL(/\/result$/);

  // 접힌 목록을 펼치면 열 가지 십성이 모두 있다
  await basics.getByText('십성 열 가지 보기').click();
  for (const name of ['비견', '겁재', '식신', '상관', '편재', '정재', '편관', '정관', '편인', '정인']) {
    await expect(basics.getByRole('term').filter({ hasText: new RegExp(`^${name} `) })).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(basics).toBeHidden();

  // 표 아래 '사주가 처음이라면'도 같은 팝업
  await page.getByRole('button', { name: '사주가 처음이라면 — 사주 기초 보기' }).click();
  await expect(page.getByRole('dialog', { name: '사주 기초' })).toBeVisible();
});

test('첫 화면에서는 사주 기초가 팝업으로 열리고, 전체 운세에서는 화면으로 간다', async ({ page }) => {
  await page.goto('/');
  // 입력하던 값이 그대로 남아 있어야 한다
  await page.locator('#name').fill('서윤');
  await page.getByRole('button', { name: /사주 기초 (자세히 )?보기/ }).click();
  const basics = page.getByRole('dialog', { name: '사주 기초' });
  await expect(basics.getByRole('heading', { name: "사주를 해석하는 기준은 일간이에요" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await basics.getByRole('button', { name: '시트 닫기' }).last().click();
  await expect(basics).toBeHidden();
  await expect(page.locator('#name')).toHaveValue('서윤');

  await page.goto('/menu');
  await page.getByRole('link', { name: /사주 기초/ }).click();
  await expect(page).toHaveURL(/\/basics$/);
});

test('달빛사주 자체 계산 기준은 전통 개념과 따로 표시한다', async ({ page }) => {
  await page.goto('/basics');
  // 신강·신약 점수, 대운 시작 나이, 용신 계산 방식
  await expect(page.getByText(/일간의 강약을 0~100점으로 환산해/)).toBeVisible();
  await expect(page.getByText(/서비스 자체 지표입니다/)).toBeVisible();
  await expect(page.getByText(/3으로 나누어 대운 시작 나이/)).toBeVisible();
  await expect(page.getByText(/조후와 격국은 반영하지 않은 참고용 판단/)).toBeVisible();
});
