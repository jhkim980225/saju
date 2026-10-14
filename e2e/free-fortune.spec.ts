/**
 * 띠별 운세 · 별자리 운세 (무료 공개 페이지)
 *  - 띠 고르기(태어난 해로 찾기) → 기간 탭 전환 → 다른 띠로 이동
 *  - 생일로 별자리 찾기 → 기간 탭 전환(달·태양·목성 근거) → 다른 별자리로 이동
 *  - 저장한 사주가 있으면 내 띠·내 별자리로 바로 이동
 */
import { createProfileViaApi, expect, guestViaApi, injectSession, test } from './support/fixtures';

const h1 = (page: import('@playwright/test').Page) => page.getByRole('heading', { level: 1 });
const periodTab = (page: import('@playwright/test').Page, name: string) => page.getByRole('navigation', { name: '기간' }).getByRole('link', { name, exact: true });

test('띠별 운세: 태어난 해로 띠 찾기 → 기간 전환 → 다른 띠', async ({ page }) => {
  await page.goto('/zodiac');
  await expect(h1(page)).toHaveText('띠별 운세');
  await expect(page).toHaveTitle(/띠별 운세 — 12띠 오늘의 운세/);
  // 12띠 오늘 요약
  await expect(page.locator('a[href$="/today"]').filter({ hasText: '띠' })).toHaveCount(12);

  // 찾기 도구는 모바일은 목록 위, 데스크톱은 오른쪽 칸 — 보이는 쪽을 쓴다
  await page.getByLabel('태어난 해(양력)').filter({ visible: true }).fill('1986');
  await expect(page.getByText(/1986년생은 호랑이띠\(寅\)예요/).filter({ visible: true })).toBeVisible();
  await page.getByRole('link', { name: '호랑이띠 운세 보기' }).filter({ visible: true }).click();

  await expect(page).toHaveURL(/\/zodiac\/tiger\/today$/);
  await expect(h1(page)).toHaveText('호랑이띠 오늘의 운세');
  await expect(page).toHaveTitle('호랑이띠 오늘의 운세 — 띠별 운세 | 달빛사주');
  await expect(periodTab(page, '오늘')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('왜 이런 풀이일까요?')).toBeVisible();
  await expect(page.getByText(/^오늘 일진 [甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥] · /).first()).toBeVisible();
  await expect(page.getByText('1986년생', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '내 사주 입력하기' })).toBeVisible();

  // 기간 탭: 이번 주 → 이번 달 → 올해 → 내일
  await periodTab(page, '이번 주').click();
  await expect(page).toHaveURL(/\/zodiac\/tiger\/week$/);
  await expect(h1(page)).toHaveText('호랑이띠 이번 주 운세');
  await expect(page.getByText(/일진 7일$/)).toBeVisible();
  await expect(page.getByText(/^이번 주에는 .요일\(..일\)이 가장 잘 맞아요\./).first()).toBeVisible();

  await periodTab(page, '이번 달').click();
  await expect(h1(page)).toHaveText('호랑이띠 이번 달 운세');
  await expect(page.getByText(/이번 달 월건 [甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]/).first()).toBeVisible();

  await periodTab(page, '올해').click();
  await expect(h1(page)).toHaveText('호랑이띠 올해 운세');
  await expect(page.getByText(/입춘 ~ .+입춘 전/).first()).toBeVisible();

  await periodTab(page, '내일').click();
  await expect(page).toHaveURL(/\/zodiac\/tiger\/tomorrow$/);
  await expect(page.getByText(/^내일 일진 /).first()).toBeVisible();

  // 다른 띠로 — 고른 기간은 유지
  await page.getByRole('navigation', { name: '띠 고르기' }).getByRole('link', { name: /용띠/ }).click();
  await expect(page).toHaveURL(/\/zodiac\/dragon\/tomorrow$/);
  await expect(h1(page)).toHaveText('용띠 내일의 운세');
  await expect(page.getByText(/^내일 일진 .+ · /).first()).toBeVisible();
});

test('별자리 운세: 생일로 별자리 찾기 → 기간 전환 → 다른 별자리', async ({ page }) => {
  await page.goto('/horoscope');
  await expect(h1(page)).toHaveText('별자리 운세');
  await page.getByLabel('태어난 달').filter({ visible: true }).selectOption('8');
  await page.getByLabel('태어난 날').filter({ visible: true }).selectOption('20');
  await expect(page.getByText(/8월 20일생은 사자자리예요/).filter({ visible: true })).toBeVisible();
  await page.getByRole('link', { name: '사자자리 운세 보기' }).filter({ visible: true }).click();

  await expect(page).toHaveURL(/\/horoscope\/leo\/today$/);
  await expect(h1(page)).toHaveText('사자자리 오늘의 운세');
  await expect(page).toHaveTitle('사자자리 오늘의 운세 — 별자리 운세 | 달빛사주');
  await expect(page.getByText('하늘의 근거')).toBeVisible();
  await expect(page.getByText(/^달 · .+자리/).first()).toBeVisible();
  await expect(page.getByText(/간이 천문 계산/).first()).toBeVisible();

  await periodTab(page, '이번 달').click();
  await expect(page).toHaveURL(/\/horoscope\/leo\/month$/);
  await expect(h1(page)).toHaveText('사자자리 이번 달 운세');
  await expect(page.getByText(/^태양 · .+자리/).first()).toBeVisible();

  await periodTab(page, '올해').click();
  await expect(h1(page)).toHaveText('사자자리 올해 운세');
  await expect(page.getByText(/^목성 · /)).toBeVisible();
  await expect(page.getByText(/^토성 · /)).toBeVisible();

  await periodTab(page, '이번 주').click();
  await expect(page.getByText(/^달 · /).first()).toBeVisible();

  await page.getByRole('navigation', { name: '별자리 고르기' }).getByRole('link', { name: /물고기/ }).click();
  await expect(page).toHaveURL(/\/horoscope\/pisces\/week$/);
  await expect(h1(page)).toHaveText('물고기자리 이번 주 운세');
});

test('접근성 스모크: 제목(h1)과 링크·입력 요소의 이름', async ({ page }) => {
  for (const path of ['/zodiac', '/zodiac/tiger/week', '/horoscope', '/horoscope/leo/month']) {
    await page.goto(path);
    await expect(h1(page)).toBeVisible();
    await expect(page.getByRole('main').getByRole('link').first()).toBeVisible();
    const unnamed: string[] = [];
    for (const role of ['link', 'button', 'textbox', 'combobox'] as const) {
      for (const el of await page.getByRole(role).all()) {
        const ok = await expect(el)
          .toHaveAccessibleName(/\S/, { timeout: 500 })
          .then(() => true)
          .catch(() => false);
        if (!ok) unnamed.push(`${path} [${role}] ${(await el.evaluate((e) => e.outerHTML)).slice(0, 120)}`);
      }
    }
    expect(unnamed).toEqual([]);
  }
});

test('저장한 사주가 있으면 내 띠·내 별자리로 바로 간다', async ({ page, api }) => {
  // 1995-03-14 (乙亥년) → 돼지띠, 물고기자리
  const tokens = await guestViaApi(api);
  await createProfileViaApi(api, tokens.accessToken, '서윤');
  await injectSession(page, tokens);

  await page.goto('/zodiac');
  await expect(page).toHaveURL(/\/zodiac\/pig\/today$/);
  await expect(h1(page)).toHaveText('돼지띠 오늘의 운세');
  await expect(page.getByRole('navigation', { name: '띠 고르기' }).getByRole('link', { name: /돼지띠/ })).toContainText('내 띠');
  await expect(page.getByRole('link', { name: '오늘의 운세 보기' })).toHaveAttribute('href', '/today');

  await page.goto('/horoscope');
  await expect(page).toHaveURL(/\/horoscope\/pisces\/today$/);
  await expect(page.getByRole('navigation', { name: '별자리 고르기' }).getByRole('link', { name: /물고기/ })).toContainText('내 별자리');
});
