/**
 * 시나리오 4 — 오늘의 운세: 프로필 저장 후 오늘 탭, 주간 흐름 7개, 프로필 전환
 */
import { createProfileViaApi, expect, fillBirthForm, guestViaApi, injectSession, test } from './support/fixtures';

const WEEKDAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

/** 브라우저와 같은 기준(KST)의 오늘 제목 "10월 12일 월요일" */
function todayTitle() {
  const now = new Date(Date.now() + 9 * 3_600_000);
  return `${now.getUTCMonth() + 1}월 ${now.getUTCDate()}일 ${WEEKDAYS[now.getUTCDay()]}`;
}

test('오늘의 운세: 사주 저장 → 오늘 탭 → 주간 흐름 7일 → 다른 사람으로 전환', async ({ page }) => {
  // 사주가 없으면 안내
  await page.goto('/today');
  await expect(page.getByText('오늘의 운세를 보려면 사주가 필요해요')).toBeVisible();
  await page.getByRole('button', { name: '내 사주 입력하기' }).click();

  // 프로필 저장 (게스트 세션으로 저장)
  await expect(page).toHaveURL(/\/profiles\/new\?save=1&relation=self&next=\/today/);
  await expect(page.getByRole('heading', { name: '사주 추가하기' })).toBeVisible();
  await expect(page.getByRole('button', { name: '나', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await fillBirthForm(page, { name: '서윤', date: '19950314', time: '14:30', gender: 'female' });
  await page.getByRole('button', { name: '저장', exact: true }).click();

  // 오늘 탭
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(todayTitle());
  await expect(page.getByText('오늘의 한 줄')).toBeVisible();
  await expect(page.getByText(/^총운 \d+점$/)).toBeVisible();
  await expect(page.getByRole('button', { name: '서윤 ▾' })).toBeVisible();
  // 처음 보는 사람 기준: 이름으로 부르고, 맨 위 요약 카드, 용어는 '사주로 보면'에 접어 둔다
  await expect(page.getByText(/^서윤님, 오늘/)).toBeVisible();
  await expect(page.getByRole('heading', { name: '한눈에 보는 오늘' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '오늘이 이런 이유' })).toBeVisible();
  await expect(page.getByText('사주로 보면')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).not.toContainText(/[一-鿿]/);

  // 이번 주 흐름: 월~일 7칸, 모두 점수 로드
  const week = page.getByRole('heading', { name: '이번 주 흐름' }).locator('..').getByRole('listitem');
  await expect(week).toHaveCount(7);
  const dayButtons = page.getByRole('button', { name: /^[월화수목금토일]요일 \d+점$/ });
  await expect(dayButtons).toHaveCount(7);
  for (const [i, d] of ['월', '화', '수', '목', '금', '토', '일'].entries()) {
    await expect(dayButtons.nth(i)).toHaveAccessibleName(new RegExp(`^${d}요일 [1-9]\\d*점$`));
  }
  // 다른 요일을 누르면 그 날짜의 운세로 바뀐다
  const todayIdx = (new Date(Date.now() + 9 * 3_600_000).getUTCDay() + 6) % 7;
  const otherIdx = todayIdx === 0 ? 1 : 0;
  await dayButtons.nth(otherIdx).click();
  await expect(page.getByRole('heading', { level: 1 })).not.toContainText(todayTitle());
  await dayButtons.nth(todayIdx).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(todayTitle());

  // 다른 사람 추가 → 전환
  await page.getByRole('button', { name: '서윤 ▾' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('다른 사람 보기')).toBeVisible();
  await sheet.getByRole('button', { name: '사주 추가하기' }).click();
  await expect(page).toHaveURL(/\/profiles\/new\?save=1&relation=family&next=\/today/);
  await fillBirthForm(page, { name: '지훈', date: '19920820', time: '09:15', gender: 'male' });
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole('button', { name: '서윤 ▾' })).toBeVisible(); // 대표 프로필 유지

  await page.getByRole('button', { name: '서윤 ▾' }).click();
  await expect(page.getByRole('dialog').getByRole('button')).toContainText([/서윤.*돼지띠 · 1995년생/, /지훈.*원숭이띠 · 1992년생/, '사주 추가하기']);
  const dailyForJihun = page.waitForResponse((r) => r.url().includes('/fortune/daily?profileId=') && r.status() === 200);
  await page.getByRole('dialog').getByRole('button', { name: /지훈/ }).click();
  await dailyForJihun;
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: '지훈 ▾' })).toBeVisible();
  await expect(page.getByText(/^지훈님, 오늘/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^[월화수목금토일]요일 \d+점$/ })).toHaveCount(7);

  // 선택한 사람은 새로고침 후에도 유지
  await page.reload();
  await expect(page.getByRole('button', { name: '지훈 ▾' })).toBeVisible();
});

test.describe('해외(음수 UTC 오프셋) 시간대 사용자', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  // BUG-04: 오늘 화면 제목의 요일이 하루 밀린다(예: KST 2026-10-12 월요일 → "10월 12일 일요일").
  // 원인: TodayPage 의 `new Date(date).getDay()` — 'YYYY-MM-DD' 를 UTC 자정으로 해석한 뒤 브라우저 현지 시간으로 요일을 구함.
  // lib/format.ts 의 weekdayOf(iso) 를 쓰면 된다. (서울 등 UTC+ 시간대에서는 드러나지 않음)
  test('오늘 제목의 요일이 날짜와 맞는다', async ({ page, api }) => {
    const guest = await guestViaApi(api);
    await createProfileViaApi(api, guest.accessToken, '서윤');
    await injectSession(page, guest);
    await page.goto('/today');
    await expect(page.getByText('오늘의 한 줄')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(todayTitle());
  });
});
