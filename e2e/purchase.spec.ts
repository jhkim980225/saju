/**
 * 시나리오 3 — 비회원 결제 시도 → 로그인 유도 → 가입 → 같은 프로필로 복귀 → 목업 결제 → 결제 성공 → 이어서 읽기 → 잠금 0개
 */
import { apiCall, buyViaApi, createProfileViaApi, expect, fullReadingButton, goToResult, injectSession, lockedSections, signupViaApi, test, uid, type Tokens } from './support/fixtures';

test('비회원 결제 → 가입 → 같은 프로필로 복귀 → 목업 결제 → 전체 풀이 열림', async ({ page, api }) => {
  await goToResult(page, { name: '서윤', date: '19950314', time: '14:30', gender: 'female' });
  await expect(page.getByText(/^갑진일주 · /)).toBeVisible({ timeout: 15_000 });
  const lockedBefore = await lockedSections(page).count();
  expect(lockedBefore).toBeGreaterThan(0);

  // 결제 시트: 평생 리포트가 기본 선택
  await (await fullReadingButton(page)).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('서윤님의 전체 풀이')).toBeVisible();
  await expect(sheet.getByRole('radio', { name: /평생 사주분석서/ })).toHaveAttribute('aria-checked', 'true');
  await sheet.getByRole('button', { name: '9,900원 결제하기' }).click();

  // 비회원 → 로그인 유도 (결과는 게스트 프로필로 저장된 뒤 그 프로필로 복귀하도록 next 지정)
  await expect(page).toHaveURL(/\/login\?next=%2Fsaju%2F[\w-]+&reason=purchase/);
  await expect(page.getByText('구매 내역을 안전하게 보관하려면 로그인이 필요해요')).toBeVisible();
  const next = decodeURIComponent(new URL(page.url()).searchParams.get('next')!);
  const profileId = next.split('/').pop()!;
  const guest = await page.evaluate(() => JSON.parse(localStorage.getItem('yd.session') ?? 'null') as { user: { id: string; provider: string } } | null);
  expect(guest?.user.provider).toBe('guest');

  // 가입 (게스트 → 회원 전환)
  await page.getByRole('link', { name: '가입하기' }).click();
  await expect(page).toHaveURL(/\/signup\?next=/);
  // 로그인 → 가입 폼은 다시 마운트되므로 가입 화면이 그려진 뒤 입력
  await expect(page.getByRole('heading', { level: 1, name: '가입하기' })).toBeVisible();
  await expect(page.getByLabel('닉네임')).toBeVisible();
  const email = `e2e-${uid()}@example.com`;
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill('password1234');
  await expect(page.getByLabel('이메일')).toHaveValue(email);
  const submit = page.getByRole('button', { name: '가입하고 계속하기' });
  await submit.click();
  await expect(page.getByRole('alert')).toHaveText('이용약관과 개인정보 처리방침에 동의해 주세요.');
  await page.getByRole('checkbox', { name: /이용약관/ }).check();
  await submit.click();

  // 같은 프로필 화면으로 복귀, 같은 계정(게스트 ID 유지)
  await expect(page).toHaveURL(new RegExp(`/saju/${profileId}$`));
  await expect(page.getByRole('heading', { name: '서윤님의 사주' })).toBeVisible();
  const member = await page.evaluate(() => JSON.parse(localStorage.getItem('yd.session')!) as Tokens);
  expect(member.user.provider).toBe('email');
  expect(member.user.id).toBe(guest!.user.id);
  await expect(page.getByText(/^갑진일주 · /)).toBeVisible();
  await expect(lockedSections(page)).toHaveCount(lockedBefore);

  // 목업 결제
  await (await fullReadingButton(page)).click();
  await page.getByRole('dialog').getByRole('button', { name: '9,900원 결제하기' }).click();
  await expect(page).toHaveURL(/\/payments\/success\?/);
  await expect(page.getByRole('heading', { name: '결제가 완료됐어요' })).toBeVisible();
  await expect(page.getByText('이제 서윤님의 전체 풀이를 끝까지 읽을 수 있어요.')).toBeVisible();
  await expect(page.getByText('AI 상담 질문권 3회가 지급됐어요.')).toBeVisible();

  // 이어서 읽기 → 읽던 프로필로 돌아와 잠금 0개
  await page.getByRole('button', { name: '이어서 읽기' }).click();
  await expect(page).toHaveURL(new RegExp(`/saju/${profileId}$`));
  await expect(page.getByText(/^갑진일주 · /)).toBeVisible();
  await expect(lockedSections(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /전체 풀이 열기/ })).toHaveCount(0);

  // 서버 상태: 주문 1건 paid, 평생 리포트 권한 보유
  const orders = await apiCall<{ status: string; productId: string }[]>(api, 'GET', '/orders', { token: member.accessToken });
  expect(orders).toEqual([expect.objectContaining({ productId: 'report_saju_lifetime', status: 'paid' })]);

  // 결제 내역 화면
  await page.goto('/my/payments');
  await expect(page.getByText(/평생 사주분석서/).first()).toBeVisible();
  await expect(page.getByText(/9,900원 · mock/)).toBeVisible();
});

test('비회원 결제 → 기존 회원 로그인 → 게스트 사주를 이어받아 같은 프로필로 복귀 → 결제', async ({ page, api }) => {
  const { email, password, tokens } = await signupViaApi(api, { nickname: '기존회원' });
  await goToResult(page, { name: '서윤', date: '19950314', time: '14:30', gender: 'female' });
  await expect(page.getByText(/^갑진일주 · /)).toBeVisible({ timeout: 15_000 });
  await (await fullReadingButton(page)).click();
  await page.getByRole('dialog').getByRole('button', { name: '9,900원 결제하기' }).click();

  await expect(page).toHaveURL(/\/login\?next=%2Fsaju%2F[\w-]+&reason=purchase/);
  const profileId = decodeURIComponent(new URL(page.url()).searchParams.get('next')!).split('/').pop()!;
  await expect(page.getByRole('heading', { level: 1, name: '로그인' })).toBeVisible();
  await page.getByLabel('이메일').fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await expect(page.getByLabel('이메일')).toHaveValue(email);
  await page.getByRole('button', { name: '로그인', exact: true }).click();

  // 게스트로 저장된 사주가 기존 계정으로 옮겨져 같은 프로필 화면으로 돌아온다
  await expect(page).toHaveURL(new RegExp(`/saju/${profileId}$`));
  await expect(page.getByText(/^갑진일주 · /)).toBeVisible();
  const profiles = await apiCall<{ id: string }[]>(api, 'GET', '/profiles', { token: tokens.accessToken });
  expect(profiles.map((p) => p.id)).toEqual([profileId]);

  await (await fullReadingButton(page)).click();
  await page.getByRole('dialog').getByRole('button', { name: '9,900원 결제하기' }).click();
  await expect(page.getByRole('heading', { name: '결제가 완료됐어요' })).toBeVisible();
  await page.getByRole('button', { name: '이어서 읽기' }).click();
  await expect(page).toHaveURL(new RegExp(`/saju/${profileId}$`));
  await expect(lockedSections(page)).toHaveCount(0);
});

test('첫 사주 미니 리포트(990원): 재물·연애·직업만 열리고, 계정당 1회라 다시 살 수 없다', async ({ page, api }) => {
  const { tokens } = await signupViaApi(api);
  const profile = await createProfileViaApi(api, tokens.accessToken, '서윤');
  await injectSession(page, tokens);

  await page.goto(`/saju/${profile.id}`);
  await expect(page.getByText(/^갑진일주 · /)).toBeVisible();
  const locked = (key: string) => page.locator(`#sec-${key}`).locator('[aria-label="잠긴 내용이에요. 전체 풀이를 열면 읽을 수 있어요."]');
  for (const key of ['wealth', 'love', 'career', 'health', 'daeun']) await expect(locked(key)).toHaveCount(1);

  // 미니 리포트로 잠긴 섹션(재물운)에서 결제 시트 → 미니 리포트 선택 → 목업 결제
  await locked('wealth').getByRole('button', { name: /전체 풀이 열기/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('radio')).toHaveText([/평생 사주분석서/, /첫 사주 미니 리포트/, /2027 신년 패키지/]);
  await sheet.getByRole('radio', { name: /첫 사주 미니 리포트/ }).click();
  await sheet.getByRole('button', { name: '990원 결제하기' }).click();
  await expect(page.getByRole('heading', { name: '결제가 완료됐어요' })).toBeVisible();
  await page.getByRole('button', { name: '이어서 읽기' }).click();
  await expect(page).toHaveURL(new RegExp(`/saju/${profile.id}$`));
  await expect(page.getByText(/^갑진일주 · /)).toBeVisible();

  for (const key of ['wealth', 'love', 'career']) await expect(locked(key)).toHaveCount(0);
  for (const key of ['health', 'daeun']) await expect(locked(key)).toHaveCount(1);

  // 계정당 1회: 상점에서 구매 완료로 표시
  await page.goto('/store');
  await expect(page.getByRole('listitem').filter({ hasText: '첫 사주 미니 리포트' }).getByRole('button', { name: '구매 완료' })).toBeDisabled();

  // 서버도 두 번째 구매를 거절
  await expect(buyViaApi(api, tokens.accessToken, 'report_saju_mini', profile.id)).rejects.toThrow(/40\d/);
  const orders = await apiCall<{ productId: string; status: string }[]>(api, 'GET', '/orders', { token: tokens.accessToken });
  expect(orders.filter((o) => o.productId === 'report_saju_mini' && o.status === 'paid')).toHaveLength(1);
});

test.describe('결제 실패·위변조', () => {
  test('결제 금액을 바꾼 성공 URL 은 승인되지 않고, 주문은 결제 완료가 되지 않는다', async ({ page, api }) => {
    const { tokens } = await signupViaApi(api);
    const profile = await createProfileViaApi(api, tokens.accessToken, '서윤');
    await injectSession(page, tokens);
    const checkout = await apiCall<{ order: { id: string; amount: number } }>(api, 'POST', '/orders', {
      token: tokens.accessToken,
      body: { productId: 'report_saju_lifetime', profileId: profile.id },
    });
    expect(checkout.order.amount).toBe(9900);

    await page.goto(`/payments/success?orderId=${checkout.order.id}&amount=100&paymentKey=mock_${checkout.order.id}&provider=mock`);
    await expect(page.getByRole('heading', { name: '결제가 완료되지 않았어요' })).toBeVisible();
    await expect(page.getByText('결제가 두 번 된 것 같다면, 다시 결제하기 전에 결제 내역을 먼저 확인해 주세요.')).toBeVisible();
    const order = await apiCall<{ status: string }>(api, 'GET', `/orders/${checkout.order.id}`, { token: tokens.accessToken });
    expect(order.status).not.toBe('paid');
    const wallet = await apiCall<{ entitlements: { key: string }[]; credits: number }>(api, 'GET', '/wallet', { token: tokens.accessToken });
    expect(wallet.entitlements).toEqual([]);
    expect(wallet.credits).toBe(0);
  });

  test('카드 승인 거절·사용자 취소 화면', async ({ page, api }) => {
    const { tokens } = await signupViaApi(api);
    const profile = await createProfileViaApi(api, tokens.accessToken, '서윤');
    await injectSession(page, tokens);
    const order = async () =>
      (await apiCall<{ order: { id: string; amount: number } }>(api, 'POST', '/orders', { token: tokens.accessToken, body: { productId: 'report_saju_mini', profileId: profile.id } })).order;

    // 목업 결제사 승인 거절(paymentKey=mock_fail)
    const o1 = await order();
    await page.goto(`/payments/success?orderId=${o1.id}&amount=${o1.amount}&paymentKey=mock_fail&provider=mock`);
    await expect(page.getByRole('heading', { name: '결제가 완료되지 않았어요' })).toBeVisible();
    await expect(page.getByText(/카드 승인이 거절되었어요/)).toBeVisible();

    // 결제창에서 사용자가 취소
    const o2 = await order();
    await page.goto(`/payments/fail?orderId=${o2.id}&code=PAY_PROCESS_CANCELED&message=${encodeURIComponent('사용자가 결제를 취소했어요')}`);
    await expect(page.getByRole('heading', { name: '결제를 취소했어요' })).toBeVisible();
    await expect(page.getByText('무료 풀이는 그대로 볼 수 있고, 전체 풀이는 언제든 다시 열 수 있어요.')).toBeVisible();
    await expect.poll(async () => (await apiCall<{ status: string }>(api, 'GET', `/orders/${o2.id}`, { token: tokens.accessToken })).status).not.toBe('pending');

    // 실패·취소 건은 결제 내역에 남되 결제 완료로 보이지 않는다
    const orders = await apiCall<{ id: string; status: string }[]>(api, 'GET', '/orders', { token: tokens.accessToken });
    expect(orders.filter((o) => o.status === 'paid')).toEqual([]);
  });
});
