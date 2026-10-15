/**
 * 시나리오 7 — 콘텐츠 화면: 신년운세(2027 丁未), 만세력(24절기), 상점 상품 목록
 */
import { createProfileViaApi, expect, guestViaApi, injectSession, lockedSections, test } from './support/fixtures';

test('신년운세: 2027 丁未년 — 미구매 시 총운·첫 두 달만 공개', async ({ page, api }) => {
  const guest = await guestViaApi(api);
  const profile = await createProfileViaApi(api, guest.accessToken, '서윤');
  await injectSession(page, guest);

  // 내 사주 화면의 바로가기에서 진입
  await page.goto(`/saju/${profile.id}`);
  await page.getByRole('link', { name: '2027 신년운세' }).click();
  await expect(page).toHaveURL(new RegExp(`/yearly/${profile.id}$`));

  await expect(page.getByRole('heading', { level: 1, name: '2027 신년운세' })).toBeVisible();
  // 그해 이름은 한자 대신 '붉은 양의 해', 맨 위에 요약 카드
  await expect(page.getByText('서윤님의 2027년 · 붉은 양의 해(정미년)')).toBeVisible();
  await expect(page.getByText(/^총운 \d+점$/)).toBeVisible();
  await expect(page.getByRole('heading', { name: '한눈에 보는 2027년' })).toBeVisible();
  expect(await lockedSections(page).count()).toBeGreaterThan(0);

  const months = page.getByRole('heading', { name: '열두 달의 흐름' }).locator('..').getByRole('listitem');
  await expect(months).toHaveCount(12);
  // 앞의 두 달은 점수 막대, 나머지는 잠금 표시
  await expect(months.filter({ has: page.locator('svg.lucide-lock') })).toHaveCount(10);
  await expect(page.getByRole('button', { name: '2027 신년운세 전체 보기 · 5,900원' })).toBeVisible();

  // 결제 시트: 신년운세 단품 + 신년 패키지
  await page.getByRole('button', { name: '2027 신년운세 전체 보기 · 5,900원' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('radio')).toHaveText([/2027 丁未년 신년운세/, /2027 신년 패키지/]);
});

test('만세력: 날짜별 간지와 그 해의 24절기', async ({ page }) => {
  await page.goto('/manse');
  await expect(page.getByRole('heading', { name: '만세력' })).toBeVisible();
  const date = page.getByLabel('날짜 선택');
  await date.fill('2000-01-01');
  await expect(page.getByText('양력 2000-01-01 · 음력 1999.11.25')).toBeVisible();
  // 고른 날을 먼저 문장으로, 한자 아래에는 읽는 법 — 입춘 전이라 아직 지난해(己卯)로 센다는 안내
  await expect(page.getByText('사주로는 기묘년(누런 토끼의 해) 병자월 무오일이에요.')).toBeVisible();
  await expect(page.getByText(/입춘\(2월 4일 무렵\)부터 새해로/)).toBeVisible();
  const pillar = (k: string) => page.getByText(k, { exact: true }).locator('..');
  await expect(pillar('해')).toContainText('己卯기묘');
  await expect(pillar('달')).toContainText('丙子병자');
  await expect(pillar('날')).toContainText('戊午무오');

  await expect(page.getByRole('heading', { name: '2000년 24절기' })).toBeVisible();
  const terms = page.getByRole('heading', { name: '2000년 24절기' }).locator('..').getByRole('listitem');
  await expect(terms).toHaveCount(24);
  await expect(terms.filter({ hasText: '입춘' })).toContainText('2. 4. 21:40'); // KASI 2000-02-04 21:40 KST
  await expect(terms.filter({ hasText: '동지' })).toHaveCount(1);

  // 다른 해로 바꾸면 그 해 절기로 갱신
  await date.fill('2024-06-01');
  await expect(page.getByRole('heading', { name: '2024년 24절기' })).toBeVisible();
  await expect(page.getByText(/입춘\(2월 4일 무렵\)부터 새해로/)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '2024년 24절기' }).locator('..').getByRole('listitem')).toHaveCount(24);
  await expect(page.getByRole('heading', { name: '2024년 24절기' }).locator('..').getByRole('listitem').filter({ hasText: '입춘' })).toContainText('2. 4. 17:27');
});

test('상점: 판매 상품·가격 (일회성 판매만, 출시 예정 없음)', async ({ page }) => {
  await page.goto('/store');
  await expect(page.getByRole('heading', { name: '이용권 · 리포트' })).toBeVisible();
  for (const g of ['사주 리포트', '주제별 리포트', 'AI 상담 질문권']) await expect(page.getByRole('heading', { level: 2, name: g })).toBeVisible();
  // 플러스 구독·질문권 100회는 팔지 않는다(2026-10-15 결정)
  await expect(page.getByRole('heading', { level: 2, name: '플러스 구독' })).toHaveCount(0);

  const card = (name: string) => page.getByRole('listitem').filter({ hasText: name });
  const onSale: [string, string][] = [
    ['첫 사주 미니 리포트', '990원'],
    ['평생 사주분석서', '9,900원'],
    ['2027 丁未년 신년운세', '5,900원'],
    ['사주 궁합 리포트', '5,900원'],
    ['연애·결혼운 리포트', '4,900원'],
    ['재물·직업운 리포트', '4,900원'],
    ['2027 신년 패키지', '16,900원'],
    ['AI 상담 질문권 10회', '3,900원'],
    ['AI 상담 질문권 30회', '9,900원'],
  ];
  for (const [name, price] of onSale) {
    await expect(card(name)).toContainText(price);
    await expect(card(name).getByRole('button', { name: '구매하기' })).toBeEnabled();
  }
  await expect(page.getByRole('button', { name: '준비 중' })).toHaveCount(0);
  for (const name of ['AI 상담 질문권 100회', '플러스 월 구독', '플러스 연 구독']) await expect(card(name)).toHaveCount(0);
  await expect(card('2027 신년 패키지')).toContainText('23,700원'); // 정가(취소선)
  await expect(card('2027 丁未년 신년운세')).toContainText(/할인 마감 2026\. 12\. 31\./);

  // 비회원이 사지 않아도 되는 상품(질문권)을 누르면 로그인으로 보낸다
  await card('AI 상담 질문권 10회').getByRole('button', { name: '구매하기' }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fmy%2Fpayments&reason=purchase/);
});

// BUG-05: 웹은 신년운세 연도를 항상 `올해 + 1` 로 정한다(YearlyPage 기본값, 내 사주·오늘 화면의 "신년운세" 바로가기).
// 2027-01-01 부터는 2028 신년운세로 연결되는데 report_newyear_2028 상품이 없어 결제 시트가 "지금 구매할 수 있는 상품이 없어요"가 되고,
// 판매 중인 2027 신년운세로 가는 길이 사라진다. (서버 reading.ts 는 10월부터 다음 해로 넘기는 규칙을 써서 서로 다르다)
test('1월에는 신년운세 바로가기가 그해(2027) 신년운세로 연결되고 구매할 수 있다', async ({ page, api }) => {
  await page.clock.setFixedTime(new Date('2027-01-15T10:00:00+09:00'));
  const guest = await guestViaApi(api);
  const profile = await createProfileViaApi(api, guest.accessToken, '서윤');
  await injectSession(page, guest);
  await page.goto(`/saju/${profile.id}`);
  await expect(page.getByRole('link', { name: '2027 신년운세' })).toBeVisible();
  await page.goto(`/yearly/${profile.id}`);
  await expect(page.getByRole('heading', { level: 1, name: '2027 신년운세' })).toBeVisible();
  await expect(page.getByRole('button', { name: /2027 신년운세 전체 보기 · [\d,]+원/ })).toBeVisible();
});
