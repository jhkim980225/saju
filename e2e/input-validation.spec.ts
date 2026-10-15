/**
 * 시나리오 2 — 입력 검증: 없는 날짜, 시간 모름(6글자), 음력+윤달, 해외 도시
 */
import { expect, fillBirthForm, goToResult, pillarTile, test } from './support/fixtures';

test.describe('입력 검증', () => {
  test('없는 날짜·범위 밖 연도는 다음 단계로 넘어가지 않는다', async ({ page }) => {
    await page.goto('/input');
    await fillBirthForm(page, { date: '20230230', time: '10:00', gender: 'male' });
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('없는 날짜예요. 다시 확인해 주세요.');
    await expect(page.getByPlaceholder('예) 19950314')).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(/\/input$/);

    // 13월
    await page.getByPlaceholder('예) 19950314').fill('19951301');
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('없는 날짜예요. 다시 확인해 주세요.');

    // 지원 범위(1900~2050) 밖
    await page.getByPlaceholder('예) 19950314').fill('18991231');
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('1900년부터 2050년 사이 출생만 볼 수 있어요.');

    // 잘못된 시각
    await page.getByPlaceholder('예) 19950314').fill('19950314');
    await page.getByPlaceholder('예) 14:30').fill('25:00');
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('시간은 00:00부터 23:59 사이로 입력해 주세요.');
    await expect(page).toHaveURL(/\/input$/);
  });

  test('시간 모름 → 시주 없이 6글자(시주 ?)로 풀이', async ({ page }) => {
    await page.goto('/input');
    await fillBirthForm(page, { name: '서윤', date: '19950314', time: null, gender: 'female' });
    await expect(page.getByRole('button', { name: '시간을 몰라요' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByPlaceholder('예) 14:30')).toHaveCount(0);
    await expect(page.getByText('괜찮아요. 태어난 시간을 빼고 연·월·일 여섯 글자로 풀이해요')).toBeVisible();
    await expect(page.getByText('필수 4/4')).toBeVisible();
    await page.getByRole('button', { name: '다음', exact: true }).click();

    await expect(page).toHaveURL(/\/confirm$/);
    await expect(page.getByText('태어난 시간 모름 · 서울특별시 · 여성')).toBeVisible();
    await expect(page.getByText(/실제 해 시각/)).toHaveCount(0);
    await page.getByRole('button', { name: '사주 풀이 보기' }).click();

    await expect(page.getByText(/^갑진일주 · /)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[aria-label*=", 한자 "]')).toHaveCount(6);
    const unknown = page.getByLabel('태어난 시간 모름', { exact: true });
    await expect(unknown).toHaveCount(2);
    await expect(unknown.first()).toHaveText('?');
    await expect(page.getByText('태어난 시간을 알면 더 정확해져요')).toBeVisible();
    await expect(page.getByRole('link', { name: '시간 입력하기' })).toBeVisible();
    await expect(page.getByText('양력 1995.03.14 시간 모름')).toBeVisible();
    await expect(page.getByText(/^실제 해 시각/)).toHaveCount(0);
  });

  test('음력 + 윤달: 양력으로 변환해 확인, 없는 윤달은 오류', async ({ page }) => {
    await page.goto('/input');
    // 윤달 체크박스는 음력일 때만 보인다
    await expect(page.getByRole('checkbox', { name: /윤달이에요/ })).toHaveCount(0);
    await fillBirthForm(page, { name: '윤달', calendar: 'lunar', leapMonth: true, date: '20200415', time: '09:00', gender: 'male' });
    await expect(page.getByRole('checkbox', { name: /윤달이에요/ })).toBeChecked();
    await page.getByRole('button', { name: '다음', exact: true }).click();

    await expect(page).toHaveURL(/\/confirm$/);
    await expect(page.getByText('양력 2020년 6월 6일 (토)')).toBeVisible();
    await expect(page.getByText(/= 음력 2020년 4월 15일\s*\(윤달\)/)).toBeVisible();
    await page.getByRole('button', { name: '사주 풀이 보기' }).click();
    await expect(page.getByText(/^경진일주 · /)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('음력 2020.04.15 09:00')).toBeVisible();

    // 2021년에는 윤4월이 없다 → 서버 검증 오류를 확인 화면에서 보여 준다
    await page.goto('/input');
    await fillBirthForm(page, { calendar: 'lunar', leapMonth: true, date: '20210415', time: '09:00', gender: 'male' });
    await page.getByRole('button', { name: '다음', exact: true }).click();
    await expect(page).toHaveURL(/\/confirm$/);
    await expect(page.getByRole('alert')).toContainText('2021년 음력 윤4월 15일은 존재하지 않는 날짜입니다.');
    await expect(page.getByRole('button', { name: '사주 풀이 보기' })).toBeDisabled();
  });

  test('해외 도시(뉴욕): 현지 시간대·경도로 보정', async ({ page }) => {
    await page.goto('/input');
    // 검색 결과가 없을 때 안내
    await page.getByRole('button', { name: '서울특별시', exact: true }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('해외에서 태어났어요')).toBeVisible();
    await sheet.getByPlaceholder('도시 이름을 검색하세요').fill('아틀란티스');
    await expect(sheet.getByText('찾는 지역이 없어요. 가까운 도시를 골라 주세요.')).toBeVisible();
    await sheet.getByRole('button', { name: '시트 닫기' }).last().click();
    await expect(sheet).toBeHidden();

    await fillBirthForm(page, { name: '서윤', date: '19950314', time: '14:30', gender: 'female', city: '뉴욕' });
    await expect(page.getByRole('button', { name: '뉴욕 (미국)', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '다음', exact: true }).click();

    await expect(page).toHaveURL(/\/confirm$/);
    await expect(page.getByText('14:30 · 뉴욕 (미국) · 여성')).toBeVisible();
    // 뉴욕(서경 74.0°, EST 기준 자오선 75°) → +4분
    await expect(page.getByText('태어난 시간을 실제 해 시각 14:34 기준으로 계산해요')).toBeVisible();
    await page.getByRole('button', { name: '사주 풀이 보기' }).click();
    await expect(page.getByText(/^갑진일주 · /)).toBeVisible({ timeout: 15_000 });
    await expect(pillarTile(page, '시', '지지', '미', '未')).toBeVisible();
    await expect(page.getByText('실제 해 시각 14:34', { exact: true })).toBeVisible();
  });
});

test('입력값 기억: "다음에도 이 정보로 볼게요" 체크 여부에 따라 다시 열 때 채워진다', async ({ page }) => {
  // 체크하지 않으면 다시 열 때 빈 폼
  await goToResult(page, { name: '기억', date: '19950314', time: '14:30', gender: 'female' });
  await page.goto('/input');
  await expect(page.locator('#name')).toHaveValue('');

  await fillBirthForm(page, { name: '기억', date: '19950314', time: '14:30', gender: 'female' });
  await page.getByRole('checkbox', { name: '다음에도 이 정보로 볼게요' }).check();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page).toHaveURL(/\/confirm$/);
  await page.goto('/input');
  await expect(page.locator('#name')).toHaveValue('기억');
  await expect(page.getByPlaceholder('예) 19950314')).toHaveValue('1995.03.14');
});
