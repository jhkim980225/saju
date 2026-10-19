/**
 * 시나리오 10 — 접근성 스모크 (axe 미사용, 의존성 최소화)
 * 주요 화면에서 이미지·버튼·링크·폼 컨트롤에 접근 가능한 이름(accessible name)이 있는지 Playwright 의 접근성 트리 기준으로 확인한다.
 */
import type { Page } from '@playwright/test';
import { BIRTH_PARTNER, createProfileViaApi, expect, fullReadingButton, goToResult, guestViaApi, injectSession, test } from './support/fixtures';

const ROLES = ['img', 'button', 'link', 'radio', 'checkbox', 'switch', 'textbox'] as const;

/**
 * 알려진 제품 버그(docs/QA.md BUG-01) — 결과 화면 "섹션 바로가기"의 오행·용신·신살·십신 칩이 빈 링크로 렌더링된다.
 * 아래 test.fixme 로 따로 추적하고, 화면별 스모크에서는 제외한다. 수정되면 이 목록을 비우고 fixme 를 해제할 것.
 */
const KNOWN_UNNAMED: string[] = [];

/** 이름 없는 요소를 모아 돌려준다 (실패 메시지에 요소 HTML 일부를 남긴다) */
async function unnamedElements(page: Page, { includeKnown = false } = {}): Promise<string[]> {
  const problems: string[] = [];
  for (const role of ROLES) {
    for (const el of await page.getByRole(role).all()) {
      if (!includeKnown && (await el.evaluate((e, sels) => sels.some((s) => e.matches(s)), KNOWN_UNNAMED))) continue;
      const named = await expect(el)
        .toHaveAccessibleName(/\S/, { timeout: 500 })
        .then(() => true)
        .catch(() => false);
      if (!named) problems.push(`[${role}] ${(await el.evaluate((e) => e.outerHTML.replace(/\s+/g, ' '))).slice(0, 180)}`);
    }
  }
  // alt 속성 없는 <img> 는 역할과 무관하게 문제
  for (const img of await page.locator('img:not([alt])').all()) problems.push(`[img alt 없음] ${(await img.evaluate((e) => e.outerHTML)).slice(0, 180)}`);
  return problems;
}

async function checkScreen(page: Page, screen: string) {
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect.soft(page.getByRole('heading', { level: 1 }).first(), `${screen}: 화면 제목(h1)`).toBeVisible();
  const problems = await unnamedElements(page);
  expect.soft(problems, `${screen}: 접근 가능한 이름이 없는 요소`).toEqual([]);
}

test('비회원 화면: 랜딩·입력(시트 포함)·확인·결과·로그인·가입·만세력·상점·404', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '무료 사주 보기' })).toBeVisible();
  await checkScreen(page, '랜딩');

  await page.goto('/input');
  await expect(page.getByRole('heading', { name: '사주 정보 입력' })).toBeVisible();
  await checkScreen(page, '입력');
  await page.getByRole('button', { name: '서울특별시', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await checkScreen(page, '입력 - 출생지 시트');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '시간대로 고르기' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await checkScreen(page, '입력 - 시간대 시트');
  await page.keyboard.press('Escape');

  await goToResult(page, { name: '서윤', date: '19950314', time: '14:30', gender: 'female' });
  await expect(page.getByText(/^갑진일주 · /)).toBeVisible({ timeout: 15_000 });
  await checkScreen(page, '결과');
  await (await fullReadingButton(page)).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await checkScreen(page, '결과 - 결제 시트');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '결과 공유' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await checkScreen(page, '결과 - 공유 시트');
  await page.keyboard.press('Escape');

  for (const [path, screen] of [
    ['/login', '로그인'],
    ['/signup', '가입'],
    ['/password/forgot', '비밀번호 찾기'],
    ['/password/reset?token=bad', '비밀번호 재설정'],
    ['/manse', '만세력'],
    ['/store', '상점'],
    ['/legal/terms', '이용약관'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).not.toBeEmpty();
    await page.waitForLoadState('networkidle');
    await checkScreen(page, screen);
  }

  await page.goto('/no-such-page');
  await expect(page.getByText('페이지를 찾을 수 없어요')).toBeVisible();
  // 404 화면은 h1 이 없을 수 있어 이름 검사만
  expect.soft(await unnamedElements(page), '404: 접근 가능한 이름이 없는 요소').toEqual([]);
});

test('탭 화면: 오늘·내 사주·궁합·물어보기·마이·신년운세', async ({ page, api }) => {
  const guest = await guestViaApi(api);
  const me = await createProfileViaApi(api, guest.accessToken, '서윤');
  await createProfileViaApi(api, guest.accessToken, '지훈', BIRTH_PARTNER, 'partner');
  await injectSession(page, guest);

  const screens: [string, string, () => Promise<void>][] = [
    ['/today', '오늘', () => expect(page.getByText('오늘의 한 줄')).toBeVisible()],
    ['/saju', '내 사주', () => expect(page.getByText(/^갑진일주 · /)).toBeVisible()],
    ['/compatibility', '궁합', () => expect(page.getByRole('heading', { name: '누구와의 궁합이 궁금하세요?' })).toBeVisible()],
    ['/ask', '물어보기', () => expect(page.getByText('서윤님의 사주를 바탕으로 답해요')).toBeVisible()],
    ['/my', '마이', () => expect(page.getByRole('heading', { name: '저장한 사주 (2)' })).toBeVisible()],
    [`/yearly/${me.id}`, '신년운세', () => expect(page.getByText(/2027년 · 붉은 양의 해\(정미년\)/)).toBeVisible()],
  ];
  for (const [path, screen, ready] of screens) {
    await page.goto(path);
    await ready();
    await page.waitForLoadState('networkidle');
    await checkScreen(page, screen);
  }

  // 주요 메뉴: 모바일은 하단 탭 5개, 데스크톱은 상단 내비(타로·전체 운세·이용권 추가). 모두 이름이 있고 현재 탭 표시
  await page.goto('/today');
  const nav = page.getByRole('navigation', { name: '주요 메뉴' });
  const desktop = test.info().project.name.startsWith('desktop');
  await expect(nav.getByRole('link')).toHaveText(desktop ? ['오늘', '내 사주', '궁합', '물어보기', '타로', '전체 운세', '이용권', '마이'] : ['오늘', '내 사주', '궁합', '물어보기', '마이']);
  await expect(nav.getByRole('link', { name: '오늘' })).toHaveAttribute('aria-current', 'page');
});

// BUG-01: ReadingSection.sectionLabels() 가 SECTION_COPY 에 없는 키(elements·yongsin·shinsal·tenGods)에 빈 라벨을 돌려줘
// ReadingView 의 섹션 바로가기 칩이 글자 없는 빈 링크로 보인다(시각적으로도 빈 알약 4개). 제품 수정 후 fixme 해제.
test('결과 화면 섹션 바로가기 칩은 모두 이름(글자)이 있다', async ({ page }) => {
  await goToResult(page, { name: '서윤', date: '19950314', time: '14:30', gender: 'female' });
  await expect(page.getByText(/^갑진일주 · /)).toBeVisible({ timeout: 15_000 });
  const chips = page.getByRole('navigation', { name: '섹션 바로가기' }).getByRole('link');
  for (const chip of await chips.all()) await expect(chip).toHaveText(/\S/);
  expect(await unnamedElements(page, { includeKnown: true })).toEqual([]);
});
