/**
 * 시나리오 12 — 꿈해몽: 무료 사전(검색 → 키워드 페이지 · 분류 · 별칭 주소 · 메뉴 입구) / AI 꿈풀이(키 없음 → 사전 기반 기본 풀이, 질문권 그대로)
 */
import { buyViaApi, createProfileViaApi, expect, injectSession, signupViaApi, test, walletViaApi } from './support/fixtures';

const SNAKE = /\/dream\/%EB%B1%80$/; // /dream/뱀

test('꿈해몽 사전: 메뉴 → 검색 → 키워드 페이지(제목·상황별 풀이) → 분류 → 별칭 주소', async ({ page }) => {
  // 입구 — 데스크톱은 상단 내비, 모바일 웹은 첫 화면 아래 링크
  await page.goto('/');
  await page.getByRole('link', { name: '꿈해몽', exact: true }).first().click();
  await expect(page).toHaveURL(/\/dream$/);
  await expect(page.getByRole('heading', { level: 1, name: '꿈해몽' })).toBeVisible();
  await expect(page).toHaveTitle(/꿈해몽 사전/);

  // 검색 — '뱀꿈'은 뱀으로
  await page.getByRole('searchbox', { name: '꿈 키워드 검색' }).fill('뱀꿈');
  const results = page.getByRole('list', { name: '검색 결과' });
  await expect(results.getByRole('link').first()).toContainText('뱀 꿈');
  await results.getByRole('link').first().click();

  // 키워드 페이지 — 화면별 제목, 상황별 풀이, 같은 분류의 다른 꿈
  await expect(page).toHaveURL(SNAKE);
  await expect(page.getByRole('heading', { level: 1, name: '뱀 꿈 해몽' })).toBeVisible();
  await expect(page).toHaveTitle('뱀 꿈 해몽 — 뜻과 상황별 풀이 | 달빛사주');
  await expect(page.getByRole('heading', { name: '상황별 풀이' })).toBeVisible();
  expect(await page.getByRole('article').getByRole('heading', { level: 3 }).count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByText('꿈은 앞날을 알려 주는 예언이 아니에요', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: '동물 전체 보기' }).click();
  await expect(page).toHaveURL(/\/dream\?c=animal$/);

  // 분류 바꾸기 → 다른 키워드 페이지
  await page.getByRole('navigation', { name: '꿈 분류' }).getByRole('link', { name: '사람' }).click();
  await expect(page).toHaveURL(/\/dream\?c=person$/);
  await page.getByRole('link', { name: /^엄마 꿈/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: '엄마 꿈 해몽' })).toBeVisible();

  // 별칭 주소는 대표 키워드 페이지로
  await page.goto('/dream/구렁이');
  await expect(page).toHaveURL(SNAKE);
  await expect(page.getByRole('heading', { level: 1, name: '뱀 꿈 해몽' })).toBeVisible();
});

test('AI 꿈풀이(AI 키 없음): 사전 상징을 엮은 기본 풀이, 질문권은 차감되지 않는다', async ({ page, api }) => {
  const { tokens } = await signupViaApi(api);
  await createProfileViaApi(api, tokens.accessToken, '서윤');
  await buyViaApi(api, tokens.accessToken, 'chat_pack_10');
  expect((await walletViaApi(api, tokens.accessToken)).credits).toBe(10);
  await injectSession(page, tokens);

  // 키워드 페이지에서 '꿈 이야기 적기' → 키워드가 미리 채워진다
  await page.goto('/dream/뱀');
  await page.getByRole('link', { name: '꿈 이야기 적기' }).click();
  await expect(page).toHaveURL(/\/dream\/ask\?k=/);
  await expect(page.getByRole('heading', { level: 1, name: 'AI 꿈풀이' })).toBeVisible();
  const box = page.getByRole('textbox', { name: /꿈 내용/ });
  await expect(box).toHaveValue('뱀 꿈을 꿨어요. ');
  await expect(page.getByText(/AI 꿈풀이 연동 전이라.*질문권이 차감되지 않아요/)).toBeVisible();
  // AI 미설정이면 질문권 배지(결제 유도)·사주 선택은 숨긴다
  await expect(page.getByRole('button', { name: /^질문권 \d+/ })).toHaveCount(0);

  await box.fill('큰 뱀이 집 안으로 들어와 제 손을 물었어요. 무섭기보다는 신기했어요.');
  await expect(page.getByText(/사전에서 찾은 상징\s*뱀/)).toBeVisible();

  const sent = page.waitForResponse((r) => r.url().endsWith('/api/v1/dream/interpret') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '꿈풀이 보기' }).click();
  const res = await sent;
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { generator: string; creditsCharged: number; creditsLeft: number; headline: string; symbols: { slug: string }[] };
  expect(body.generator).toBe('rule');
  expect(body.creditsCharged).toBe(0);
  expect(body.creditsLeft).toBe(10);
  expect(body.symbols.map((s) => s.slug)).toContain('뱀');

  const result = page.getByRole('region', { name: body.headline });
  await expect(result).toBeVisible();
  await expect(result.getByText('기본 풀이', { exact: true })).toBeVisible();
  await expect(result.getByText(/예언이 아니에요/)).toBeVisible();
  await expect(result.getByText(/규칙으로 엮은 기본 풀이/)).toBeVisible();
  expect((await walletViaApi(api, tokens.accessToken)).credits).toBe(10);

  // 상징 → 사전 키워드 페이지, 돌아오면 방금 풀이가 남아 있다
  await result.getByRole('link', { name: /^뱀/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: '뱀 꿈 해몽' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('region', { name: body.headline })).toBeVisible();

  // 위기 신호가 담긴 꿈 이야기에는 전문 상담 안내를 함께 보여 준다
  await page.getByRole('textbox', { name: /꿈 내용/ }).fill('꿈에서도 너무 힘들어서 죽고 싶었어요');
  await expect(page.getByText(/자살예방상담전화 109는 24시간 열려 있어요/)).toBeVisible();
});
