/**
 * 시나리오 12 — 타로 2차 펼침 방식
 *  - 예·아니오(무료): 질문 필수 → 한 장 → 기울기 막대(잠금 없음) → 하루 무료 횟수를 넘으면 오늘 본 카드로 안내
 *  - 양자택일(990원): 선택지 A·B → 두 갈래 나란히(정답 표시 없음) → 목업 결제로 깊은 풀이
 *  - 궁합 타로(2,900원): 저장한 두 사람 → 두 사람 이름·결제 시트 가격
 *  - 켈틱 크로스(4,900원): 10자리 · 가로지르는 2번 카드 → 목업 결제 → 질문권 3회
 */
import { BIRTH_PARTNER, apiCall, createProfileViaApi, expect, injectSession, signupViaApi, test } from './support/fixtures';

test('예·아니오: 무료 한 장으로 기울기를 보여 주고, 하루 무료 횟수를 넘으면 오늘 본 카드로 안내한다', async ({ page, api }) => {
  const { tokens } = await signupViaApi(api, { nickname: '서윤' });
  await createProfileViaApi(api, tokens.accessToken, '서윤');
  await injectSession(page, tokens);

  await page.goto('/tarot');
  await expect(page.getByRole('heading', { name: '펼침 방식으로 고르기' })).toBeVisible();
  await expect(page.getByRole('link', { name: /예·아니오.*하루 한 번 무료/ })).toBeVisible();
  await page.getByRole('link', { name: /예·아니오/ }).click();
  await expect(page).toHaveURL(/\/tarot\/ask\?topic=yesno$/);

  // 질문이 있어야 섞을 수 있고, '질문 없이 뽑기'는 없다
  await expect(page.getByRole('button', { name: '질문 없이 뽑을게요' })).toHaveCount(0);
  await page.getByRole('button', { name: '카드 섞기' }).click();
  await expect(page.getByRole('alert')).toHaveText('예·아니오로 답할 수 있는 질문을 적어 주세요.');
  await page.getByLabel(/나의 질문/).fill('이번 주말에 먼저 연락해 볼까요?');
  await page.getByRole('button', { name: '카드 섞기' }).click();

  await expect(page).toHaveURL(/\/tarot\/draw$/);
  await page.getByRole('button', { name: '카드 고르기' }).click();
  await expect(page.getByRole('heading', { name: '카드 한 장을 골라 주세요' })).toBeVisible();
  await page.getByRole('button', { name: '30번째 카드 고르기', exact: true }).click();
  await page.getByRole('button', { name: '카드 펼치기', exact: true }).click();
  await page.getByRole('button', { name: '기울기 카드 펼치기' }).click();
  await page.getByRole('button', { name: '풀이 읽기' }).click();

  // 결과 — 기울기 막대, 잠금·결제 없음
  await expect(page).toHaveURL(/\/tarot\/r\/[\w-]+$/);
  const readingId = page.url().split('/').pop()!;
  await expect(page.getByRole('heading', { name: '예·아니오 타로' })).toBeVisible();
  await expect(page.getByRole('img', { name: /^카드의 기울기: (예 쪽|조건부|아니오 쪽)$/ })).toBeVisible();
  await expect(page.getByText(/^('예' 쪽으로 기울어 있어요|아직 어느 쪽으로도 열려 있어요|'아니오' 쪽으로 기울어 있어요)$/)).toBeVisible();
  await expect(page.getByText('마지막 선택은 서윤님의 몫이에요', { exact: false })).toBeVisible();
  await expect(page.getByText('여기서부터는 깊은 풀이예요')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /깊은 풀이 열기/ })).toHaveCount(0);
  const reading = await apiCall<{ lean: string; locked: boolean; cards: { yesNo: string }[] }>(api, 'GET', `/tarot/readings/${readingId}`, { token: tokens.accessToken });
  expect(reading.locked).toBe(false);
  expect(reading.lean).toBe(reading.cards[0]!.yesNo);

  // 새 질문 → 오늘 무료 횟수를 다 써서 오늘 본 카드로 안내
  await page.goto('/tarot/ask?topic=yesno');
  await page.getByLabel(/나의 질문/).fill('모임에 나가 볼까요?');
  await page.getByRole('button', { name: '카드 섞기' }).click();
  await expect(page.getByText('오늘의 무료 예·아니오를 모두 봤어요')).toBeVisible();
  await expect(page.getByRole('button', { name: '카드 고르기' })).toHaveCount(0);
  await page.getByRole('link', { name: '오늘 본 카드 보기' }).click();
  await expect(page).toHaveURL(new RegExp(`/tarot/r/${readingId}$`));

  // 홈에서도 오늘 본 카드로 바로 이어진다
  await page.goto('/tarot');
  await page.getByRole('link', { name: /오늘 본 카드 다시 읽기/ }).click();
  await expect(page).toHaveURL(new RegExp(`/tarot/r/${readingId}$`));
});

test('양자택일: 두 선택지를 나란히 놓고(정답 표시 없음), 990원 목업 결제로 깊은 풀이를 연다', async ({ page, api }) => {
  const { tokens } = await signupViaApi(api, { nickname: '서윤' });
  await createProfileViaApi(api, tokens.accessToken, '서윤');
  await injectSession(page, tokens);

  await page.goto('/tarot');
  await page.getByRole('link', { name: /양자택일/ }).click();
  await expect(page).toHaveURL(/\/tarot\/ask\?topic=choice$/);
  await page.getByRole('button', { name: '카드 섞기' }).click();
  await expect(page.getByRole('alert')).toHaveText('두 선택지를 모두 적어 주세요.');
  await page.getByLabel(/선택지 A/).fill('지금 회사에 남기');
  await page.getByLabel(/선택지 B/).fill('새 회사로 옮기기');
  await page.getByLabel(/나의 질문/).fill('어느 쪽으로 가 볼까요?');
  await page.getByRole('button', { name: '카드 섞기' }).click();

  await page.getByRole('button', { name: '카드 고르기' }).click();
  await page.getByRole('button', { name: '알아서 골라 주세요' }).click();
  await page.getByRole('button', { name: '카드 펼치기', exact: true }).click();
  await page.getByRole('button', { name: '한 번에 펼치기' }).click();
  await page.getByRole('button', { name: '풀이 읽기' }).click();

  await expect(page).toHaveURL(/\/tarot\/r\/[\w-]+$/);
  const readingId = page.url().split('/').pop()!;
  await expect(page.getByRole('heading', { name: '양자택일 타로' })).toBeVisible();
  const compare = page.getByRole('region', { name: '두 갈래 나란히 보기' });
  await expect(compare.getByRole('listitem')).toHaveCount(2);
  await expect(compare.getByRole('listitem').nth(0)).toContainText('A · 지금 회사에 남기 쪽');
  await expect(compare.getByRole('listitem').nth(1)).toContainText('B · 새 회사로 옮기기 쪽');
  await expect(compare).toContainText('어느 쪽이 정답인지 정해 주는 카드가 아니에요');
  // 지금의 나 자리는 무료, 두 선택지 자리는 똑같이 잠김
  await expect(page.getByText('지금의 나 자리').first()).toBeVisible();

  await page.getByRole('button', { name: '깊은 풀이 열기 · 990원' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('radio', { name: /양자택일 타로 3장 깊은 풀이/ })).toHaveAttribute('aria-checked', 'true');
  await sheet.getByRole('button', { name: '990원 결제하기' }).click();
  await expect(page.getByRole('heading', { name: '결제가 완료됐어요' })).toBeVisible();
  await page.getByRole('button', { name: '이어서 읽기' }).click();
  await expect(page).toHaveURL(new RegExp(`/tarot/r/${readingId}$`));
  await expect(page.getByRole('button', { name: /깊은 풀이 열기/ })).toHaveCount(0);
  await expect(page.getByText('A를 고른다면 — ', { exact: false })).toBeVisible();
  await expect(page.getByText('B를 고른다면 — ', { exact: false })).toBeVisible();

  const opened = await apiCall<{ locked: boolean; options: { a: string; b: string } }>(api, 'GET', `/tarot/readings/${readingId}`, { token: tokens.accessToken });
  expect(opened).toMatchObject({ locked: false, options: { a: '지금 회사에 남기', b: '새 회사로 옮기기' } });
});

test('궁합 타로: 저장한 두 사람으로 뽑고, 결과에 두 사람과 2,900원 깊은 풀이가 보인다', async ({ page, api }) => {
  const { tokens } = await signupViaApi(api, { nickname: '서윤' });
  await createProfileViaApi(api, tokens.accessToken, '서윤');
  await createProfileViaApi(api, tokens.accessToken, '민준', BIRTH_PARTNER, 'partner');
  await injectSession(page, tokens);

  await page.goto('/tarot/ask?topic=compat');
  await expect(page.getByRole('heading', { name: '누구와의 궁합을 볼까요?' })).toBeVisible();
  // 기본값 — 나는 대표 사주, 상대는 저장한 연인·배우자
  await expect(page.getByRole('button', { name: '나: 서윤' })).toBeVisible();
  await expect(page.getByRole('button', { name: '민준' })).toBeVisible();
  await page.getByRole('button', { name: '카드 섞기' }).click();
  await page.getByRole('button', { name: '카드 고르기' }).click();
  await expect(page.getByRole('heading', { name: '카드 5장을 골라 주세요' })).toBeVisible();
  await page.getByRole('button', { name: '알아서 골라 주세요' }).click();
  await page.getByRole('button', { name: '카드 펼치기', exact: true }).click();
  await page.getByRole('button', { name: '한 번에 펼치기' }).click();
  await page.getByRole('button', { name: '풀이 읽기' }).click();

  await expect(page).toHaveURL(/\/tarot\/r\/[\w-]+$/);
  await expect(page.getByRole('heading', { name: '궁합 타로' })).toBeVisible();
  await expect(page.getByText('서윤 × 민준')).toBeVisible();
  await expect(page.getByText('서윤님과 민준님 사이를 다섯 장으로 펼쳤어요', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '깊은 풀이 열기 · 2,900원' })).toBeVisible();
});

test('켈틱 크로스: 10자리(2번은 가로로)로 펼치고, 4,900원 목업 결제로 열면 질문권 3회가 함께 지급된다', async ({ page, api }) => {
  const { tokens } = await signupViaApi(api, { nickname: '서윤' });
  await createProfileViaApi(api, tokens.accessToken, '서윤');
  const token = tokens.accessToken;
  const s = await apiCall<{ deckToken: string }>(api, 'POST', '/tarot/shuffle', { token, body: { spread: 'celtic', topic: 'celtic', question: '올해 이직, 어떻게 준비할까요?' } });
  const r = await apiCall<{ id: string; cards: { nameKo: string }[] }>(api, 'POST', '/tarot/readings', {
    token,
    body: { deckToken: s.deckToken, spread: 'celtic', topic: 'celtic', question: '올해 이직, 어떻게 준비할까요?', picks: [3, 9, 15, 21, 27, 33, 39, 45, 51, 57] },
  });
  await injectSession(page, tokens);

  await page.goto(`/tarot/r/${r.id}`);
  await expect(page.getByRole('heading', { name: '켈틱 크로스 타로' })).toBeVisible();
  const cross = page.locator('[data-spread="celtic"]');
  await expect(cross.getByRole('img')).toHaveCount(10);
  // 2번(가로막는 것)은 1번 위에 90° 돌려 놓인다
  await expect(cross.locator('[data-crossing] > div')).toHaveClass(/rotate-90/);
  await expect(cross.locator('[data-crossing]').getByRole('img')).toHaveAttribute('alt', new RegExp(`^${r.cards[1]!.nameKo} · `));
  await expect(cross.getByRole('listitem').filter({ hasText: '가로막는 것' })).toContainText(r.cards[1]!.nameKo);
  await expect(cross.getByRole('listitem')).toHaveCount(10);

  await page.getByRole('button', { name: '깊은 풀이 열기 · 4,900원' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '4,900원 결제하기' }).click();
  await expect(page.getByRole('heading', { name: '결제가 완료됐어요' })).toBeVisible();
  await expect(page.getByText('AI 상담 질문권 3회가 지급됐어요.')).toBeVisible();
  await page.getByRole('button', { name: '이어서 읽기' }).click();
  await expect(page).toHaveURL(new RegExp(`/tarot/r/${r.id}$`));
  await expect(page.getByRole('heading', { name: '사주로 본 근거' })).toBeVisible();
  await expect(page.getByRole('button', { name: /깊은 풀이 열기/ })).toHaveCount(0);
});
