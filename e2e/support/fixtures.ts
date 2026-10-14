/**
 * 공용 픽스처·도우미
 *  - 외부 네트워크 차단(auto): localhost 외 요청(폰트 CDN·분석·광고·결제 SDK)은 모두 abort → 테스트가 인터넷에 의존하지 않는다.
 *  - api: API 서버를 직접 호출하는 request 컨텍스트(테스트 데이터 준비·서버 상태 검증용)
 *  - UI 도우미: 출생 정보 입력, 잠금 섹션 찾기, 세션 주입
 */
import { test as base, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { API_BASE } from './env';

export { expect };

type Fixtures = {
  blockExternalNetwork: void;
  api: APIRequestContext;
};

export const test = base.extend<Fixtures>({
  blockExternalNetwork: [
    async ({ context }, use) => {
      await context.route(
        (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
        (route) => route.abort('blockedbyclient'),
      );
      await use();
    },
    { auto: true },
  ],
  api: async ({ playwright }, use) => {
    const ctx = await playwright.request.newContext();
    await use(ctx);
    await ctx.dispose();
  },
});

// ── 테스트 데이터 ───────────────────────────────────────────────

/** 1995-03-14 14:30 서울, 여성 → 乙亥년 己卯월 甲辰일 辛未시, 음력 1995-02-14, 경도 보정 -32분 */
export const BIRTH_ME = {
  calendar: 'solar',
  year: 1995,
  month: 3,
  day: 14,
  isLeapMonth: false,
  hour: 14,
  minute: 30,
  gender: 'female',
  timeZone: 'Asia/Seoul',
  longitude: 126.978,
  timeCorrection: 'lmt',
  ziHourRule: 'nextDay',
} as const;

/** 1992-08-20 09:15 서울, 남성 → 戊辰일주 */
export const BIRTH_PARTNER = { ...BIRTH_ME, year: 1992, month: 8, day: 20, hour: 9, minute: 15, gender: 'male' } as const;

export const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// ── API 도우미 ─────────────────────────────────────────────────

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string | null; nickname: string; provider: string; credits: number };
}

export async function apiCall<T = unknown>(api: APIRequestContext, method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<T> {
  const res = await api.fetch(`${API_BASE}${path}`, {
    method,
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    data: opts.body,
  });
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
  return (res.status() === 204 ? undefined : await res.json()) as T;
}

export async function signupViaApi(api: APIRequestContext, opts: { nickname?: string } = {}) {
  const email = `e2e-${uid()}@example.com`;
  const password = 'password1234';
  const tokens = await apiCall<Tokens>(api, 'POST', '/auth/signup', { body: { email, password, nickname: opts.nickname } });
  return { email, password, tokens };
}

export async function guestViaApi(api: APIRequestContext) {
  return apiCall<Tokens>(api, 'POST', '/auth/guest', { body: { deviceId: `e2e-device-${uid()}` } });
}

export async function createProfileViaApi(api: APIRequestContext, token: string, name: string, birth: object = BIRTH_ME, relation = 'self') {
  return apiCall<{ id: string; name: string; dayPillar: string }>(api, 'POST', '/profiles', { token, body: { name, relation, birth } });
}

/** 목업 결제로 상품 구매 (주문 생성 → 승인) */
export async function buyViaApi(api: APIRequestContext, token: string, productId: string, profileId?: string) {
  const checkout = await apiCall<{ order: { id: string; amount: number } }>(api, 'POST', '/orders', { token, body: { productId, profileId } });
  return apiCall<{ granted: { credits: number } }>(api, 'POST', '/payments/confirm', {
    token,
    body: { provider: 'mock', orderId: checkout.order.id, amount: checkout.order.amount, paymentKey: `mock_${checkout.order.id}` },
  });
}

export async function walletViaApi(api: APIRequestContext, token: string) {
  return apiCall<{ credits: number; paidCredits: number; freeCredits: number }>(api, 'GET', '/wallet', { token });
}

/**
 * 브라우저에 로그인 세션을 심는다(웹 앱이 쓰는 localStorage 'yd.session').
 * 첫 문서 로드에서 한 번만 심고(sessionStorage 표시), 이후 로그아웃 등으로 지워진 상태는 그대로 둔다.
 */
export async function injectSession(page: Page, tokens: Tokens) {
  const value = JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, user: tokens.user });
  await page.addInitScript((v) => {
    if (window.sessionStorage.getItem('e2e.sessionInjected')) return;
    window.localStorage.setItem('yd.session', v);
    window.sessionStorage.setItem('e2e.sessionInjected', '1');
  }, value);
}

// ── UI 도우미 ──────────────────────────────────────────────────

export interface BirthFormInput {
  name?: string;
  calendar?: 'solar' | 'lunar';
  leapMonth?: boolean;
  /** 숫자 8자리 YYYYMMDD */
  date: string;
  /** 'HH:MM' 또는 null(시간 모름) */
  time: string | null;
  gender: 'female' | 'male';
  /** 도시 검색어 (기본 서울특별시) */
  city?: string;
}

/** 출생 정보 폼(/input, /profiles/new) 입력 — 제출은 하지 않는다 */
export async function fillBirthForm(page: Page, f: BirthFormInput) {
  if (f.name !== undefined) await page.locator('#name').fill(f.name);
  await page.getByRole('radio', { name: f.calendar === 'lunar' ? '음력' : '양력', exact: true }).click();
  if (f.leapMonth) await page.getByRole('checkbox', { name: /윤달이에요/ }).check();
  await page.getByPlaceholder('예) 19950314').fill(f.date);
  if (f.time === null) {
    await page.getByRole('button', { name: '시간을 몰라요' }).click();
  } else {
    await page.getByPlaceholder('예) 14:30').fill(f.time);
  }
  await page.getByRole('radio', { name: f.gender === 'female' ? '여성' : '남성', exact: true }).click();
  if (f.city) {
    await page.getByRole('button', { name: '서울특별시', exact: true }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByPlaceholder('도시 이름을 검색하세요').fill(f.city);
    await sheet.getByRole('button', { name: new RegExp(f.city) }).first().click();
    await expect(sheet).toBeHidden();
  }
}

/** 비회원 흐름: 랜딩 없이 /input 에서 입력 → 확인 → 결과까지 */
export async function goToResult(page: Page, f: BirthFormInput) {
  await page.goto('/input');
  await fillBirthForm(page, f);
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page).toHaveURL(/\/confirm$/);
  await page.getByRole('button', { name: '사주 풀이 보기' }).click();
  await expect(page).toHaveURL(/\/result$/);
}

/**
 * 결과 하단의 "전체 풀이 열기" 버튼.
 * 상품 가격을 불러오기 전에는 잠금 카드 버튼들도 같은 이름이라 여러 개가 잡히므로, 카드에 가격이 붙은 뒤 하나로 특정한다.
 */
export async function fullReadingButton(page: Page): Promise<Locator> {
  await expect(page.getByRole('button', { name: /^전체 풀이 열기 · / }).first()).toBeVisible();
  return page.getByRole('button', { name: '전체 풀이 열기', exact: true });
}

/** 잠금(유료) 섹션 카드 */
export const lockedSections = (page: Page): Locator => page.locator('[aria-label="잠긴 내용이에요. 전체 풀이를 열면 읽을 수 있어요."]');

/** 사주표 타일 (aria-label: "일 천간 갑, 한자 甲, 목(木) 양") */
export const pillarTile = (page: Page, position: '년' | '월' | '일' | '시', kind: '천간' | '지지', hangul: string, hanja: string): Locator =>
  page.locator(`[aria-label^="${position} ${kind} ${hangul}, 한자 ${hanja},"]`);
