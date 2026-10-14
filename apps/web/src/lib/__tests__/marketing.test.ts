/**
 * 마케팅·광고 연동 테스트 — 분석(GA4/Meta/Kakao Pixel), 카카오톡 공유, 광고 슬롯.
 * 모듈 상태(초기화 여부·스크립트 캐시)를 테스트마다 초기화하기 위해 vi.resetModules() 후 동적 import 한다.
 */
import { cleanup, render } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cfg = vi.hoisted(() => ({ value: undefined as undefined | { ads: { enabled: boolean; provider: string } } }));
vi.mock('@/hooks/queries', () => ({ useConfig: () => ({ data: cfg.value }) }));

const ENV_KEYS = [
  'VITE_GA4_MEASUREMENT_ID',
  'VITE_META_PIXEL_ID',
  'VITE_KAKAO_PIXEL_ID',
  'VITE_KAKAO_JS_KEY',
  'VITE_ADSENSE_CLIENT_ID',
  'VITE_ADSENSE_SLOT_RESULT_BOTTOM',
  'VITE_ADSENSE_SLOT_HOME_INFEED',
  'VITE_ADFIT_UNIT_RESULT_BOTTOM',
  'VITE_ADFIT_UNIT_HOME_INFEED',
] as const;

const GLOBALS = ['gtag', 'dataLayer', 'fbq', '_fbq', 'kakaoPixel', 'Kakao', 'adsbygoogle', 'adfit', 'Capacitor'];
type AnyWindow = Record<string, unknown>;
const w = () => window as unknown as AnyWindow;

const scripts = (prefix: string) => Array.from(document.querySelectorAll('script')).filter((s) => (s.getAttribute('src') ?? '').startsWith(prefix));
const allScripts = () => document.querySelectorAll('script').length;

const GTAG = 'https://www.googletagmanager.com/gtag/js';
const FB = 'https://connect.facebook.net/en_US/fbevents.js';
const KP = 'https://t1.daumcdn.net/kas/static/kp.js';
const KAKAO_SDK = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js';
const ADSENSE = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv('DEV', false); // 디버그 모드가 아닌 운영 동작을 기본으로 검증
  for (const k of ENV_KEYS) vi.stubEnv(k, '');
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  for (const k of GLOBALS) delete w()[k];
  window.history.replaceState({}, '', '/');
  cfg.value = undefined;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function stubAnalyticsKeys() {
  vi.stubEnv('VITE_GA4_MEASUREMENT_ID', 'G-TEST123');
  vi.stubEnv('VITE_META_PIXEL_ID', '1234567890');
  vi.stubEnv('VITE_KAKAO_PIXEL_ID', '999');
}

// ---------------------------------------------------------------------------
describe('analytics', () => {
  it('키가 없으면 스크립트를 로드하지 않고 track 은 no-op', async () => {
    const a = await import('../analytics');
    a.initAnalytics();
    a.track('page_view', { path: '/' });
    a.track('purchase', { product: 'report_saju_lifetime', price: 9900 });
    expect(allScripts()).toBe(0);
    expect(w().gtag).toBeUndefined();
    expect(w().fbq).toBeUndefined();
    expect(w().dataLayer).toBeUndefined();
  });

  it('initAnalytics 전에는 track 이 아무 것도 하지 않는다', async () => {
    stubAnalyticsKeys();
    const a = await import('../analytics');
    a.track('page_view', { path: '/' });
    expect(allScripts()).toBe(0);
    expect(w().gtag).toBeUndefined();
  });

  it('키가 있으면 매체별 스크립트를 1회만 삽입한다', async () => {
    stubAnalyticsKeys();
    const a = await import('../analytics');
    a.initAnalytics();
    a.initAnalytics();
    expect(scripts(GTAG)).toHaveLength(1);
    expect(scripts(GTAG)[0]!.getAttribute('src')).toBe(`${GTAG}?id=G-TEST123`);
    expect(scripts(FB)).toHaveLength(1);
    expect(scripts(KP)).toHaveLength(1);
    // GA4 는 SPA 수동 page_view — 자동 전송 끔
    const config = (w().dataLayer as IArguments[]).map((x) => Array.from(x)).find((x) => x[0] === 'config');
    expect(config?.[1]).toBe('G-TEST123');
    expect(config?.[2]).toMatchObject({ send_page_view: false });
  });

  it('loadScript 는 같은 src 를 한 번만 삽입한다', async () => {
    const a = await import('../analytics');
    const p1 = a.loadScript('https://example.com/x.js');
    const p2 = a.loadScript('https://example.com/x.js');
    expect(p1).toBe(p2);
    expect(scripts('https://example.com/x.js')).toHaveLength(1);
  });

  it('track → gtag / fbq 매핑 (purchase 는 value·KRW 포함)', async () => {
    stubAnalyticsKeys();
    const a = await import('../analytics');
    a.initAnalytics();
    const gtag = vi.fn();
    const fbq = vi.fn();
    w().gtag = gtag;
    w().fbq = fbq;

    a.track('purchase', { product: 'report_saju_lifetime', price: 9900, channel: 'web', orderId: 'ord_1' });
    expect(gtag).toHaveBeenCalledWith(
      'event',
      'purchase',
      expect.objectContaining({
        value: 9900,
        currency: 'KRW',
        transaction_id: 'ord_1',
        items: [expect.objectContaining({ item_id: 'report_saju_lifetime', price: 9900, quantity: 1 })],
      }),
    );
    expect(fbq).toHaveBeenCalledWith('track', 'Purchase', expect.objectContaining({ value: 9900, currency: 'KRW', content_ids: ['report_saju_lifetime'] }), { eventID: 'ord_1' });

    a.track('checkout_started', { product: 'report_saju_mini', price: 990 });
    expect(gtag).toHaveBeenCalledWith('event', 'begin_checkout', expect.objectContaining({ value: 990, currency: 'KRW' }));
    expect(fbq).toHaveBeenCalledWith('track', 'InitiateCheckout', expect.objectContaining({ value: 990, currency: 'KRW' }));

    a.track('signup', { method: 'kakao' });
    expect(gtag).toHaveBeenCalledWith('event', 'sign_up', { method: 'kakao' });
    expect(fbq).toHaveBeenCalledWith('track', 'CompleteRegistration', {});

    a.track('reading_viewed', { locked: true });
    expect(gtag).toHaveBeenCalledWith('event', 'reading_viewed', { locked: true });
    expect(fbq).toHaveBeenCalledWith('track', 'ViewContent', expect.objectContaining({ content_name: 'reading' }));

    a.track('share', { channel: 'kakao' });
    expect(gtag).toHaveBeenCalledWith('event', 'share', { method: 'kakao' });

    fbq.mockClear();
    a.track('login', { method: 'email' });
    a.track('chat_sent');
    expect(gtag).toHaveBeenCalledWith('event', 'login', { method: 'email' });
    expect(gtag).toHaveBeenCalledWith('event', 'chat_sent', {});
    expect(fbq).not.toHaveBeenCalled();
  });

  it('page_view 는 수동 전송하고 page_location 에서 캠페인 파라미터 외 쿼리를 지운다', async () => {
    stubAnalyticsKeys();
    window.history.replaceState({}, '', '/auth/callback/kakao?code=SECRET&state=abc&utm_source=kakao&utm_campaign=newyear#x');
    const a = await import('../analytics');
    a.initAnalytics();
    const gtag = vi.fn();
    const fbq = vi.fn();
    w().gtag = gtag;
    w().fbq = fbq;
    a.track('page_view', { path: '/auth/callback/kakao' });
    const loc = `${window.location.origin}/auth/callback/kakao?utm_source=kakao&utm_campaign=newyear`;
    expect(gtag).toHaveBeenCalledWith('set', { page_location: loc });
    expect(gtag).toHaveBeenCalledWith('event', 'page_view', { page_location: loc });
    expect(fbq).toHaveBeenCalledWith('track', 'PageView', {});
  });

  it('개인정보(이메일·생년월일 등)는 전송하지 않는다', async () => {
    stubAnalyticsKeys();
    const a = await import('../analytics');
    a.initAnalytics();
    const gtag = vi.fn();
    w().gtag = gtag;
    w().fbq = vi.fn();
    a.track('signup', { method: 'email', email: 'me@example.com', birthDate: '1990-01-01', name: '서윤', note: 'me@example.com', hour: 7 });
    expect(gtag).toHaveBeenCalledWith('event', 'sign_up', { method: 'email' });
  });

  it('Kakao Pixel: kp.js 로드 전 이벤트는 큐에 쌓였다가 로드 후 전송', async () => {
    stubAnalyticsKeys();
    const a = await import('../analytics');
    a.initAnalytics();
    w().gtag = vi.fn();
    w().fbq = vi.fn();
    a.track('page_view', { path: '/' });
    a.track('purchase', { product: 'report_saju_lifetime', price: 9900 });

    const px = { pageView: vi.fn(), purchase: vi.fn(), signUp: vi.fn(), viewContent: vi.fn() };
    const kakaoPixel = vi.fn(() => px);
    w().kakaoPixel = kakaoPixel;
    scripts(KP)[0]!.dispatchEvent(new Event('load'));

    await vi.waitFor(() => expect(px.purchase).toHaveBeenCalled());
    expect(kakaoPixel).toHaveBeenCalledWith('999');
    expect(px.pageView).toHaveBeenCalledTimes(1);
    expect(px.purchase).toHaveBeenCalledWith(expect.objectContaining({ total_price: '9900', currency: 'KRW' }));

    a.track('signup', { method: 'kakao' });
    a.track('daily_viewed', { grade: 'good' });
    expect(px.signUp).toHaveBeenCalledTimes(1);
    expect(px.viewContent).toHaveBeenCalledWith({ id: 'daily' });
  });

  it('개발 모드(DEV)에서는 스크립트 없이 console.debug 로만 출력', async () => {
    vi.stubEnv('DEV', true);
    stubAnalyticsKeys();
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const a = await import('../analytics');
    a.initAnalytics();
    a.track('purchase', { product: 'report_saju_lifetime', price: 9900 });
    expect(allScripts()).toBe(0);
    expect(w().gtag).toBeUndefined();
    expect(w().fbq).toBeUndefined();
    expect(debug).toHaveBeenCalledWith('[analytics] purchase', expect.anything(), expect.objectContaining({ ga4: expect.objectContaining({ name: 'purchase' }) }));
  });
});

// ---------------------------------------------------------------------------
describe('share (카카오톡)', () => {
  const payload = { title: '서윤님은 갑자일주', text: '여덟 글자로 읽은 나의 결', url: '/result', buttonTitle: '내 사주 결과 보러 가기' };

  it('키가 없으면 kakaoAvailable=false, shareKakao 는 스크립트 없이 false', async () => {
    const s = await import('../share');
    expect(s.kakaoAvailable()).toBe(false);
    s.preloadKakao();
    expect(await s.shareKakao(payload)).toBe(false);
    expect(allScripts()).toBe(0);
  });

  it('앱(Capacitor)에서는 키가 있어도 kakaoAvailable=false', async () => {
    vi.stubEnv('VITE_KAKAO_JS_KEY', 'kakao-js-key');
    w().Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    const s = await import('../share');
    expect(s.kakaoAvailable()).toBe(false);
    expect(await s.shareKakao(payload)).toBe(false);
    expect(allScripts()).toBe(0);
  });

  it('키가 있으면 SDK 를 1회만 로드·init 하고 sendDefault 호출', async () => {
    vi.stubEnv('VITE_KAKAO_JS_KEY', 'kakao-js-key');
    const s = await import('../share');
    expect(s.kakaoAvailable()).toBe(true);

    s.preloadKakao();
    const p1 = s.shareKakao(payload);
    const p2 = s.shareKakao(payload);
    expect(scripts(KAKAO_SDK)).toHaveLength(1);

    let inited = false;
    const sendDefault = vi.fn();
    const init = vi.fn(() => {
      inited = true;
    });
    w().Kakao = { init, isInitialized: () => inited, Share: { sendDefault } };
    scripts(KAKAO_SDK)[0]!.dispatchEvent(new Event('load'));

    expect(await p1).toBe(true);
    expect(await p2).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith('kakao-js-key');
    expect(sendDefault).toHaveBeenCalledTimes(2);
    const url = `${window.location.origin}/result`;
    expect(sendDefault).toHaveBeenCalledWith({
      objectType: 'text',
      text: '서윤님은 갑자일주\n여덟 글자로 읽은 나의 결',
      link: { mobileWebUrl: url, webUrl: url },
      buttons: [{ title: '내 사주 결과', link: { mobileWebUrl: url, webUrl: url } }],
    });

    // 이후 호출은 스크립트 추가 없이 동기 경로
    expect(await s.shareKakao({ ...payload, imageUrl: '/og.png' })).toBe(true);
    expect(scripts(KAKAO_SDK)).toHaveLength(1);
    expect(sendDefault).toHaveBeenLastCalledWith(
      expect.objectContaining({
        objectType: 'feed',
        content: { title: payload.title, description: payload.text, imageUrl: `${window.location.origin}/og.png`, link: { mobileWebUrl: url, webUrl: url } },
      }),
    );
  });

  it('버튼명은 8자 이하로 자르고 최대 2개', async () => {
    const s = await import('../share');
    const tpl = s.buildKakaoTemplate({
      title: 't',
      text: 'd',
      url: '/today',
      buttons: [
        { title: '오늘의 운세 보러가기', url: '/today' },
        { title: '내 사주 보기', url: '/input' },
        { title: '세 번째', url: '/' },
      ],
    }) as { buttons: { title: string }[] };
    expect(tpl.buttons.map((b) => b.title)).toEqual(['오늘의 운세 보', '내 사주 보기']);
  });
});

// ---------------------------------------------------------------------------
describe('AdSlot', () => {
  async function setup(opts: { premium?: boolean } = {}) {
    const [{ AdSlot }, { useSession }] = await Promise.all([import('@/components/AdSlot'), import('@/lib/session')]);
    useSession.setState({ user: opts.premium === undefined ? null : ({ id: 'u1', isPremium: opts.premium } as never) });
    return AdSlot;
  }
  function stubAdsense() {
    vi.stubEnv('VITE_ADSENSE_CLIENT_ID', 'ca-pub-123');
    vi.stubEnv('VITE_ADSENSE_SLOT_RESULT_BOTTOM', '111');
    vi.stubEnv('VITE_ADSENSE_SLOT_HOME_INFEED', '222');
  }

  it('광고 키가 없으면 서버 설정과 무관하게 null', async () => {
    cfg.value = { ads: { enabled: true, provider: 'adsense' } };
    const AdSlot = await setup();
    const { container } = render(createElement(AdSlot, { placement: 'result_bottom' }));
    expect(container).toBeEmptyDOMElement();
    expect(allScripts()).toBe(0);
  });

  it('서버 설정 ads.enabled=false 이거나 설정 로딩 중이면 null', async () => {
    stubAdsense();
    const AdSlot = await setup();
    cfg.value = undefined;
    expect(render(createElement(AdSlot, { placement: 'home_infeed' })).container).toBeEmptyDOMElement();
    cleanup();
    cfg.value = { ads: { enabled: false, provider: 'adsense' } };
    expect(render(createElement(AdSlot, { placement: 'home_infeed' })).container).toBeEmptyDOMElement();
    expect(allScripts()).toBe(0);
  });

  it('프리미엄 사용자에게는 null', async () => {
    stubAdsense();
    cfg.value = { ads: { enabled: true, provider: 'adsense' } };
    const AdSlot = await setup({ premium: true });
    expect(render(createElement(AdSlot, { placement: 'result_bottom' })).container).toBeEmptyDOMElement();
    expect(allScripts()).toBe(0);
  });

  it('앱(Capacitor)에서는 null', async () => {
    stubAdsense();
    cfg.value = { ads: { enabled: true, provider: 'adsense' } };
    w().Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
    const AdSlot = await setup({ premium: false });
    expect(render(createElement(AdSlot, { placement: 'result_bottom' })).container).toBeEmptyDOMElement();
  });

  it('provider 키가 없으면 null (adsense 설정인데 애드핏 키만 있음)', async () => {
    vi.stubEnv('VITE_ADFIT_UNIT_RESULT_BOTTOM', 'DAN-abc');
    cfg.value = { ads: { enabled: true, provider: 'adsense' } };
    const AdSlot = await setup();
    expect(render(createElement(AdSlot, { placement: 'result_bottom' })).container).toBeEmptyDOMElement();
  });

  it('AdSense: 무료 사용자에게 라벨과 <ins> 렌더, 스크립트는 슬롯이 여러 개여도 1회', async () => {
    stubAdsense();
    cfg.value = { ads: { enabled: true, provider: 'adsense' } };
    const AdSlot = await setup({ premium: false });
    const { container, getAllByText } = render(
      createElement(Fragment, null, createElement(AdSlot, { placement: 'result_bottom' }), createElement(AdSlot, { placement: 'home_infeed' })),
    );
    const ins = container.querySelectorAll('ins.adsbygoogle');
    expect(ins).toHaveLength(2);
    expect(ins[0]).toHaveAttribute('data-ad-client', 'ca-pub-123');
    expect(ins[0]).toHaveAttribute('data-ad-slot', '111');
    expect(ins[0]).toHaveAttribute('data-ad-format', 'auto');
    expect(ins[0]).toHaveAttribute('data-full-width-responsive', 'true');
    expect(ins[1]).toHaveAttribute('data-ad-slot', '222');
    expect(getAllByText('광고')).toHaveLength(2);
    expect(scripts(ADSENSE)).toHaveLength(1);
    expect(scripts(ADSENSE)[0]!.getAttribute('src')).toBe(`${ADSENSE}?client=ca-pub-123`);
    expect(w().adsbygoogle).toHaveLength(2);
  });

  it('AdSense: unfilled 이면 슬롯을 접는다', async () => {
    stubAdsense();
    cfg.value = { ads: { enabled: true, provider: 'adsense' } };
    const AdSlot = await setup();
    const { container } = render(createElement(AdSlot, { placement: 'home_infeed' }));
    container.querySelector('ins.adsbygoogle')!.setAttribute('data-ad-status', 'unfilled');
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('카카오 애드핏: kakao_ad_area <ins> 렌더', async () => {
    vi.stubEnv('VITE_ADFIT_UNIT_HOME_INFEED', 'DAN-home');
    cfg.value = { ads: { enabled: true, provider: 'adfit' } };
    const AdSlot = await setup({ premium: false });
    const { container, unmount } = render(createElement(AdSlot, { placement: 'home_infeed' }));
    const ins = container.querySelector('ins.kakao_ad_area');
    expect(ins).toHaveAttribute('data-ad-unit', 'DAN-home');
    expect(ins).toHaveAttribute('data-ad-width', '320');
    expect(ins).toHaveAttribute('data-ad-height', '100');
    expect(scripts('https://t1.daumcdn.net/kas/static/ba.min.js')).toHaveLength(1);
    unmount();
    expect(scripts('https://t1.daumcdn.net/kas/static/ba.min.js')).toHaveLength(0);
  });
});
