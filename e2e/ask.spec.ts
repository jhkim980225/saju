/**
 * 시나리오 6 — 물어보기: 추천 질문 → 규칙 기반 답변(AI 키 없음) + 질문권 미차감
 */
import { buyViaApi, createProfileViaApi, expect, injectSession, signupViaApi, test, walletViaApi } from './support/fixtures';

test('물어보기: 추천 질문 → 규칙 기반 답변, 질문권은 차감되지 않는다', async ({ page, api }) => {
  const { tokens } = await signupViaApi(api);
  await createProfileViaApi(api, tokens.accessToken, '서윤');
  await buyViaApi(api, tokens.accessToken, 'chat_pack_10');
  expect((await walletViaApi(api, tokens.accessToken)).credits).toBe(10);
  await injectSession(page, tokens);

  await page.goto('/ask');
  await expect(page.getByRole('heading', { name: '물어보기' })).toBeVisible();
  await expect(page.getByText('서윤님의 사주를 바탕으로 답해요')).toBeVisible();
  await expect(page.getByText('양력 1995.3.14생 · 돼지띠')).toBeVisible();
  await expect(page.getByText(/AI 상담을 준비 중이어서.*질문권은 차감되지 않아요/)).toBeVisible();
  // AI 미설정이면 질문권 배지(결제 유도)는 숨긴다
  await expect(page.getByRole('button', { name: /^질문권 \d+/ })).toHaveCount(0);

  await expect(page.getByText('이런 걸 물어볼 수 있어요')).toBeVisible();
  const sent = page.waitForResponse((r) => r.url().endsWith('/api/v1/chat') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '지금 이직해도 괜찮은 시기일까요?' }).click();
  const res = await sent;
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { generator: string; creditsLeft: number };
  expect(body.generator).toBe('rule');
  expect(body.creditsLeft).toBe(10);

  const bubbles = page.locator('ol[aria-live="polite"] > li');
  await expect(bubbles).toHaveCount(2);
  await expect(bubbles.nth(0)).toHaveText('지금 이직해도 괜찮은 시기일까요?');
  // 직업운은 유료(잠금) 주제 → 잠금 안내 후 무료인 성격 풀이로 답한다
  await expect(bubbles.nth(1)).toContainText('전체 풀이를 열면 볼 수 있어요');
  await expect(bubbles.nth(1)).toContainText('오늘 실천할 한 가지를 고른다면, ');
  await expect(bubbles.nth(1)).not.toContainText('당신');
  await expect(page.getByText('이런 걸 물어볼 수 있어요')).toHaveCount(0);

  // 직접 입력해서 한 번 더
  await page.getByRole('textbox', { name: '어떤 고민이든 편하게 적어 주세요' }).fill('올해 돈 관리는 어떻게 할까요?');
  await page.getByRole('button', { name: '보내기' }).click();
  await expect(bubbles).toHaveCount(4);
  await expect(bubbles.nth(3)).toContainText('오늘 실천할 한 가지를 고른다면, ');

  // 질문권 미차감 — 서버 지갑과 마이 화면 모두 10회
  expect((await walletViaApi(api, tokens.accessToken)).credits).toBe(10);
  await page.getByRole('link', { name: '마이' }).click();
  await expect(page.getByRole('link', { name: /AI 상담 질문권\s*10회/ })).toBeVisible();

  // 새로고침해도 상담 기록 유지
  await page.goto('/ask');
  await expect(bubbles).toHaveCount(4);

  // 위기 신호가 담긴 질문에는 전문 상담 안내를 함께 보여 준다 (Enter 로 전송)
  const input = page.getByRole('textbox', { name: '어떤 고민이든 편하게 적어 주세요' });
  await input.fill('요즘 너무 힘들어서 죽고 싶어요');
  await input.press('Enter');
  await expect(bubbles).toHaveCount(6);
  await expect(page.getByText(/자살예방상담전화 109는 24시간 열려 있어요/)).toBeVisible();
  expect((await walletViaApi(api, tokens.accessToken)).credits).toBe(10);
});
