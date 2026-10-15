/**
 * 시나리오 11 — 타로: 주제 → 질문 → 섞기 → 고르기 → 펼치기 → 결과(무료 범위·잠금) → 깊은 풀이 결제 / 같은 질문 다시 뽑기 방지 / 오늘의 카드 고정
 */
import { apiCall, createProfileViaApi, expect, injectSession, signupViaApi, test } from './support/fixtures';

test('질문 타로 3장: 고른 자리의 카드로 결과가 나오고, 깊은 풀이를 결제하면 같은 카드로 이어서 열린다', async ({ page, api }) => {
  const { tokens } = await signupViaApi(api, { nickname: '서윤' });
  await createProfileViaApi(api, tokens.accessToken, '서윤');
  await injectSession(page, tokens);

  await page.goto('/tarot');
  await expect(page.getByRole('heading', { name: /생각을 비춰 주는 카드/ })).toBeVisible();
  await page.getByRole('link', { name: /이 길로 가도 괜찮을까요/ }).click();
  await expect(page).toHaveURL(/\/tarot\/ask\?topic=career$/);
  await page.getByLabel(/나의 질문/).fill('이직을 준비해도 될까요?');
  await page.getByRole('button', { name: '카드 섞기' }).click();

  // 섞기 → 고르기
  await expect(page).toHaveURL(/\/tarot\/draw$/);
  await page.getByRole('button', { name: '카드 고르기' }).click();
  await expect(page.getByRole('heading', { name: '카드 3장을 골라 주세요' })).toBeVisible();
  for (const n of [5, 23, 61]) await page.getByRole('button', { name: `${n}번째 카드 고르기`, exact: true }).click();
  await expect(page.getByText('3장을 모두 골랐어요')).toBeVisible();

  // 펼치기 — 한 장씩 / 한 번에
  await page.getByRole('button', { name: '카드 펼치기', exact: true }).click();
  await page.getByRole('button', { name: '지금 상황 카드 펼치기' }).click();
  await expect(page.getByRole('button', { name: /^지금 상황: .+ (정방향|역방향)$/ })).toBeVisible();
  await page.getByRole('button', { name: '한 번에 펼치기' }).click();
  await page.getByRole('button', { name: '풀이 읽기' }).click();

  // 결과 — 카드·한 줄·총평은 무료, 자리별 풀이는 잠김
  await expect(page).toHaveURL(/\/tarot\/r\/[\w-]+$/);
  const readingId = page.url().split('/').pop()!;
  await expect(page.getByText('카드가 건네는 한 줄')).toBeVisible();
  await expect(page.getByText('“이직을 준비해도 될까요?”')).toBeVisible();
  await expect(page.getByRole('heading', { name: '카드를 이어서 읽으면' })).toBeVisible();
  await expect(page.getByText('여기서부터는 깊은 풀이예요').first()).toBeVisible();
  const cardsBefore = await apiCall<{ cards: { id: string }[] }>(api, 'GET', `/tarot/readings/${readingId}`, { token: tokens.accessToken });

  await page.getByRole('button', { name: '깊은 풀이 열기 · 990원' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '990원 결제하기' }).click();
  await expect(page.getByRole('heading', { name: '결제가 완료됐어요' })).toBeVisible();
  await page.getByRole('button', { name: '이어서 읽기' }).click();
  await expect(page).toHaveURL(new RegExp(`/tarot/r/${readingId}$`));
  await expect(page.getByRole('button', { name: /깊은 풀이 열기/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '사주로 본 근거' })).toBeVisible();
  // 본문은 쉬운 말, 일간·용신 같은 용어는 '사주로 보면'을 펼쳐야 보인다
  await expect(page.getByText(/카드예요$/).first()).toBeVisible();
  await expect(page.getByText(/일간 .+ · 용신 .+ · 카드 원소/)).toBeHidden();
  await page.locator('summary', { hasText: '사주로 보면' }).click();
  await expect(page.getByText(/일간 .+ · 용신 .+ · 카드 원소/)).toBeVisible();

  const cardsAfter = await apiCall<{ cards: { id: string }[]; locked: boolean }>(api, 'GET', `/tarot/readings/${readingId}`, { token: tokens.accessToken });
  expect(cardsAfter.locked).toBe(false);
  expect(cardsAfter.cards.map((c) => c.id)).toEqual(cardsBefore.cards.map((c) => c.id));
});

test('같은 날 같은 질문은 다시 뽑지 않고, 처음 뽑은 결과로 안내한다', async ({ page, api }) => {
  const { tokens } = await signupViaApi(api);
  const token = tokens.accessToken;
  const s = await apiCall<{ deckToken: string }>(api, 'POST', '/tarot/shuffle', { token, body: { spread: 'feelings5', topic: 'feelings', question: '그 사람 마음이 궁금해요' } });
  const first = await apiCall<{ id: string }>(api, 'POST', '/tarot/readings', { token, body: { deckToken: s.deckToken, spread: 'feelings5', topic: 'feelings', question: '그 사람 마음이 궁금해요', picks: [1, 2, 3, 4, 5] } });
  await injectSession(page, tokens);

  await page.goto('/tarot/ask?topic=feelings');
  await expect(page.getByText(/다른 사람의 마음은 카드로 확정할 수 없어요/).first()).toBeVisible();
  await page.getByLabel(/나의 질문/).fill('그 사람 마음이 궁금해요?');
  await page.getByRole('button', { name: '카드 섞기' }).click();
  await expect(page.getByText('오늘 같은 질문으로 이미 카드를 뽑았어요')).toBeVisible();
  await expect(page.getByRole('button', { name: '카드 고르기' })).toBeDisabled();
  await page.getByRole('link', { name: '그 결과 보기' }).click();
  await expect(page).toHaveURL(new RegExp(`/tarot/r/${first.id}$`));
  // 연애 5장 — 첫 자리는 무료로 열려 있다
  await expect(page.getByText('나의 마음 자리').first()).toBeVisible();
});

test('오늘의 카드: 뒷면을 펼치면 하루 한 장으로 고정되고, 오늘 탭에도 같은 카드가 보인다', async ({ page, api }) => {
  const { tokens } = await signupViaApi(api);
  await injectSession(page, tokens);

  await page.goto('/tarot/daily');
  await page.getByRole('button', { name: '오늘의 카드 뽑기' }).last().click();
  await expect(page.getByText('카드가 건네는 한 줄')).toBeVisible();
  const daily = await apiCall<{ cards: { nameKo: string }[] }>(api, 'GET', '/tarot/daily', { token: tokens.accessToken });
  const name = daily.cards[0]!.nameKo;

  await page.goto('/tarot');
  await page.getByRole('button', { name: '다시 읽기' }).click();
  await expect(page).toHaveURL(/\/tarot\/daily\?open=1$/);
  await expect(page.getByText(new RegExp(`^${name} · (정방향|역방향)$`)).first()).toBeVisible();

  await page.goto('/tarot/history');
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
});
