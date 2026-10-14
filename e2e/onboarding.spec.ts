/**
 * 시나리오 1 — 비회원 핵심 흐름: 랜딩 → 입력(양력/시간/성별) → 확인(음력 변환·경도 보정) → 결과(8글자·잠금 섹션)
 */
import { expect, fillBirthForm, fullReadingButton, goToResult, lockedSections, pillarTile, test } from './support/fixtures';

test('랜딩 → 입력 → 확인 → 결과: 甲辰 일주 8글자와 잠금 섹션', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('여덟 글자로 읽는');
  await expect(page.getByText('예시 사주팔자')).toBeVisible();

  // 랜딩 CTA → 입력
  await page.getByRole('button', { name: '내 사주 보기' }).click();
  await expect(page).toHaveURL(/\/input$/);
  await expect(page.getByRole('heading', { name: '사주 정보 입력' })).toBeVisible();
  await expect(page.getByText('필수 1/4')).toBeVisible(); // 출생지(서울)만 기본값
  await expect(page.getByRole('button', { name: '다음', exact: true })).toBeDisabled();

  await fillBirthForm(page, { name: '서윤', calendar: 'solar', date: '19950314', time: '14:30', gender: 'female' });
  await expect(page.getByPlaceholder('예) 19950314')).toHaveValue('1995.03.14');
  await expect(page.getByPlaceholder('예) 14:30')).toHaveValue('14:30');
  await expect(page.getByText('필수 4/4')).toBeVisible();
  await page.getByRole('button', { name: '다음', exact: true }).click();

  // 확인 화면: 양력·음력 변환·보정 내역
  await expect(page).toHaveURL(/\/confirm$/);
  await expect(page.getByRole('heading', { name: '이 정보로 풀어 볼까요?' })).toBeVisible();
  await expect(page.getByText('서윤님')).toBeVisible();
  await expect(page.getByText('양력 1995년 3월 14일 (화)')).toBeVisible();
  await expect(page.getByText('= 음력 1995년 2월 14일')).toBeVisible();
  await expect(page.getByText('14:30 · 서울특별시 · 여성')).toBeVisible();
  await expect(page.getByText('시간 보정 -32분 (지역 경도) → 13:58 기준')).toBeVisible();

  await page.getByRole('button', { name: '사주 풀이 보기' }).click();
  await expect(page).toHaveURL(/\/result$/);

  // 결과: 로딩 → 일주·8글자 표
  await expect(page.getByRole('heading', { name: '서윤님의 사주' })).toBeVisible();
  await expect(page.getByText(/^갑진일주 · /)).toBeVisible({ timeout: 15_000 });
  const pillars: [Parameters<typeof pillarTile>[1], string, string, string, string][] = [
    ['년', '을', '乙', '해', '亥'],
    ['월', '기', '己', '묘', '卯'],
    ['일', '갑', '甲', '진', '辰'],
    ['시', '신', '辛', '미', '未'],
  ];
  for (const [pos, sHangul, sHanja, bHangul, bHanja] of pillars) {
    await expect(pillarTile(page, pos, '천간', sHangul, sHanja)).toBeVisible();
    await expect(pillarTile(page, pos, '지지', bHangul, bHanja)).toBeVisible();
  }
  await expect(page.locator('[aria-label*=", 한자 "]')).toHaveCount(8);
  await expect(page.getByLabel('태어난 시간 모름')).toHaveCount(0);
  await expect(page.getByText('양력 1995.03.14 14:30')).toBeVisible();
  await expect(page.getByText('보정 -32분', { exact: true })).toBeVisible();

  // 무료 섹션은 열려 있고, 유료 섹션은 잠금 카드로 표시
  await expect(page.getByRole('heading', { name: '한눈에 보는 나' })).toBeVisible();
  expect(await lockedSections(page).count()).toBeGreaterThan(0);
  await expect(await fullReadingButton(page)).toBeVisible();
});

test('결과에서 보관함에 저장 → 내 사주·마이에 저장된다', async ({ page }) => {
  await page.goto('/input');
  await fillBirthForm(page, { name: '서윤', date: '19950314', time: '14:30', gender: 'female' });
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('button', { name: '사주 풀이 보기' }).click();
  await expect(page.getByText(/^갑진일주 · /)).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: '보관함에 저장' }).click();
  await expect(page.getByText('보관함에 저장했어요')).toBeVisible();
  await expect(page).toHaveURL(/\/saju\/[\w-]+$/);
  await expect(page.getByRole('heading', { name: '서윤님의 사주' })).toBeVisible();
  await expect(page.getByText(/^갑진일주 · /)).toBeVisible();

  // 하단 탭이 있는 내 사주 탭에서도 같은 사주
  await page.goto('/saju');
  await expect(page.getByText(/^갑진일주 · /)).toBeVisible();
  await page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('link', { name: '마이' }).click();
  await expect(page.getByRole('heading', { name: '저장한 사주 (1)' })).toBeVisible();
  await expect(page.getByRole('link', { name: /서윤\s*나/ })).toContainText('양 1995.3.14 · 甲辰일주');

  // 결과 화면에서 다시 저장해도 중복 저장되지 않는다
  await page.goto('/result');
  await expect(page.getByText(/^갑진일주 · /)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '보관함에 저장' }).click();
  await expect(page).toHaveURL(/\/saju\/[\w-]+$/);
  await page.goto('/my');
  await expect(page.getByRole('heading', { name: '저장한 사주 (1)' })).toBeVisible();
});

// BUG-03(낮음): 10월부터는 결과의 연간 운세 섹션이 '다음 해'(2026년 10월 기준 2027년)로 바뀌는데,
// 웹은 섹션 키 year2027 에도 라벨 '올해의 운세'를 붙인다(섹션 바로가기·섹션 머리글). 랜딩 미리보기는 올해(2026년)로 표시돼 서로 어긋난다.
// 관련: apps/web/src/components/ReadingSection.tsx sectionLabels(), apps/api/src/modules/interpretation/reading.ts yearBriefSection 호출부
test('결과의 연간 운세 섹션 라벨은 실제 연도와 맞는다', async ({ page }) => {
  await goToResult(page, { name: '서윤', date: '19950314', time: '14:30', gender: 'female' });
  await expect(page.getByText(/^갑진일주 · /)).toBeVisible({ timeout: 15_000 });
  const section = page.locator('section[id^="sec-year"]');
  const year = Number((await section.getAttribute('id'))!.slice('sec-year'.length));
  if (year !== new Date().getFullYear()) await expect(section).not.toContainText('올해의 운세');
});
