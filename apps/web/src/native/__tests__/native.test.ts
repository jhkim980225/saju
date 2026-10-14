/**
 * 네이티브 계층 테스트 — Capacitor 플러그인은 전부 vi.mock 으로 대체하고,
 * window.Capacitor 를 심어 isNativeApp() 이 true 가 되게 한다.
 */
import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (ev?: unknown) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

const h = vi.hoisted(() => {
  const prefs = new Map<string, string>();
  const appListeners: Record<string, Listener> = {};
  const fcmListeners: Record<string, Listener> = {};
  const adListeners = new Map<string, Set<Listener>>();
  const emitAd = (event: string, payload?: unknown) => adListeners.get(event)?.forEach((cb) => cb(payload));
  const mk = () => vi.fn<AnyFn>();
  return {
    prefs,
    appListeners,
    fcmListeners,
    adListeners,
    emitAd,
    launchUrl: undefined as { url: string } | undefined,
    fn: {
      minimizeApp: mk(),
      browserOpen: mk(),
      browserClose: mk(),
      hapticImpact: mk(),
      hapticNotify: mk(),
      share: mk(),
      statusBarStyle: mk(),
      registerPush: mk(),
      purchaseProduct: mk(),
      finishTransaction: mk(),
      consumePurchase: mk(),
      getUnfinished: mk(),
      prepareReward: mk(),
      showReward: mk(),
    },
  };
});

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    keys: async () => ({ keys: [...h.prefs.keys()] }),
    get: async ({ key }: { key: string }) => ({ value: h.prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => void h.prefs.set(key, value),
    remove: async ({ key }: { key: string }) => void h.prefs.delete(key),
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (event: string, cb: Listener) => {
      h.appListeners[event] = cb;
      return { remove: async () => undefined };
    },
    minimizeApp: h.fn.minimizeApp,
    getLaunchUrl: async () => h.launchUrl,
  },
}));

vi.mock('@capacitor/browser', () => ({ Browser: { open: h.fn.browserOpen, close: h.fn.browserClose } }));
vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: h.fn.hapticImpact, notification: h.fn.hapticNotify },
  ImpactStyle: { Light: 'LIGHT' },
  NotificationType: { Success: 'SUCCESS' },
}));
vi.mock('@capacitor/keyboard', () => ({ Keyboard: { setStyle: async () => undefined }, KeyboardStyle: { Dark: 'DARK', Light: 'LIGHT' } }));
vi.mock('@capacitor/share', () => ({ Share: { canShare: async () => ({ value: true }), share: h.fn.share } }));
vi.mock('@capacitor/splash-screen', () => ({ SplashScreen: { hide: async () => undefined } }));
vi.mock('@capacitor/status-bar', () => ({
  StatusBar: { setStyle: h.fn.statusBarStyle },
  Style: { Dark: 'DARK', Light: 'LIGHT', Default: 'DEFAULT' },
}));
// push.ts 는 registerPlugin('FirebaseMessaging') 로 프록시를 만든다
vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({
    addListener: async (event: string, cb: Listener) => {
      h.fcmListeners[event] = cb;
      return { remove: async () => undefined };
    },
    checkPermissions: async () => ({ receive: 'prompt' }),
    requestPermissions: async () => ({ receive: 'granted' }),
    getToken: async () => ({ token: 'fcm-token-1' }),
    createChannel: async () => undefined,
  }),
}));
vi.mock('@capgo/native-purchases', () => ({
  PURCHASE_TYPE: { INAPP: 'inapp', SUBS: 'subs' },
  NativePurchases: {
    configure: async () => undefined,
    purchaseProduct: h.fn.purchaseProduct,
    finishTransaction: h.fn.finishTransaction,
    consumePurchase: h.fn.consumePurchase,
    getUnfinishedTransactions: h.fn.getUnfinished,
  },
}));
vi.mock('@capacitor-community/admob', () => ({
  RewardAdPluginEvents: { Rewarded: 'onRewardedVideoAdReward', Dismissed: 'onRewardedVideoAdDismissed', FailedToShow: 'onRewardedVideoAdFailedToShow' },
  BannerAdPluginEvents: { SizeChanged: 'bannerAdSizeChanged' },
  BannerAdPosition: { BOTTOM_CENTER: 'BOTTOM_CENTER' },
  BannerAdSize: { ADAPTIVE_BANNER: 'ADAPTIVE_BANNER' },
  AdMob: {
    initialize: async () => undefined,
    trackingAuthorizationStatus: async () => ({ status: 'authorized' }),
    prepareRewardVideoAd: h.fn.prepareReward,
    showRewardVideoAd: h.fn.showReward,
    addListener: async (event: string, cb: Listener) => {
      if (!h.adListeners.has(event)) h.adListeners.set(event, new Set());
      h.adListeners.get(event)!.add(cb);
      return { remove: async () => void h.adListeners.get(event)?.delete(cb) };
    },
  },
}));
vi.mock('../../lib/api', () => ({ api: { registerPush: h.fn.registerPush } }));

function setPlatform(platform: 'ios' | 'android' | null) {
  if (platform) window.Capacitor = { isNativePlatform: () => true, getPlatform: () => platform };
  else delete window.Capacitor;
}

/** Node 22+ 의 실험적 전역 localStorage(파일 미지정 시 undefined)가 jsdom 것을 가리므로 메모리 구현을 심는다 */
function installLocalStorage() {
  const data = new Map<string, string>();
  const ls: Storage = {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
  };
  Object.defineProperty(window, 'localStorage', { value: ls, configurable: true, writable: true });
}

const cleanups: (() => void)[] = [];
function listen(type: string, cb: (e: Event) => void) {
  window.addEventListener(type, cb);
  cleanups.push(() => window.removeEventListener(type, cb));
}

beforeEach(() => {
  vi.resetModules();
  h.prefs.clear();
  h.adListeners.clear();
  for (const k of Object.keys(h.appListeners)) delete h.appListeners[k];
  for (const k of Object.keys(h.fcmListeners)) delete h.fcmListeners[k];
  h.launchUrl = undefined;
  for (const f of Object.values(h.fn)) f.mockReset().mockResolvedValue(undefined);
  h.fn.purchaseProduct.mockResolvedValue({});
  h.fn.getUnfinished.mockResolvedValue({ transactions: [] });
  h.fn.prepareReward.mockResolvedValue({ adUnitId: 'test' });
  h.fn.showReward.mockImplementation(async () => {
    h.emitAd('onRewardedVideoAdReward', { type: 'coin', amount: 1 });
    h.emitAd('onRewardedVideoAdDismissed');
    return { type: 'coin', amount: 1 };
  });
  installLocalStorage();
  window.history.replaceState(null, '', '/');
  document.body.innerHTML = '';
  setPlatform('android');
});

afterEach(() => {
  cleanups.splice(0).forEach((f) => f());
  setPlatform(null);
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function boot() {
  const native = await import('../index');
  await native.initNative();
  return native;
}

describe('Preferences 저장소 hydrate', () => {
  it('시작 시 Preferences 를 메모리로 읽어 어댑터를 교체하고 세션·테마를 다시 읽는다', async () => {
    h.prefs.set('yd.session', JSON.stringify({ accessToken: 'a1', refreshToken: 'r1', user: { id: 'u1', provider: 'kakao' } }));
    h.prefs.set('yd.theme', 'dark');
    const { useSession } = await import('../../lib/session');
    const { useTheme } = await import('../../lib/theme');
    const { storage } = await import('../../lib/storage');
    expect(useSession.getState().accessToken).toBeNull(); // import 시점에는 (비어 있는) localStorage 기준

    await boot();

    expect(storage.get('yd.theme')).toBe('dark');
    expect(useSession.getState()).toMatchObject({ accessToken: 'a1', refreshToken: 'r1', user: { id: 'u1' } });
    expect(useTheme.getState().mode).toBe('dark');
  });

  it('쓰기는 메모리에 즉시 반영되고 Preferences 에는 비동기로 기록된다', async () => {
    await boot();
    const { storage } = await import('../../lib/storage');

    storage.set('yd.deviceId', 'device-1');
    expect(storage.get('yd.deviceId')).toBe('device-1'); // 동기 API 유지
    expect(h.prefs.has('yd.deviceId')).toBe(false); // 아직 기록 전
    await vi.waitFor(() => expect(h.prefs.get('yd.deviceId')).toBe('device-1'));
    expect(window.localStorage.getItem('yd.deviceId')).toBeNull(); // localStorage 는 더 이상 쓰지 않음

    storage.setJSON('yd.lastReading', { a: 1 });
    storage.remove('yd.deviceId');
    expect(storage.get('yd.deviceId')).toBeNull();
    await vi.waitFor(() => {
      expect(h.prefs.has('yd.deviceId')).toBe(false);
      expect(h.prefs.get('yd.lastReading')).toBe('{"a":1}');
    });
  });

  it('Preferences 가 비어 있는 첫 실행이면 localStorage 의 yd.* 값을 옮긴다', async () => {
    window.localStorage.setItem('yd.fontScale', '1.2');
    window.localStorage.setItem('other.key', 'x');
    await boot();
    const { storage } = await import('../../lib/storage');
    expect(storage.get('yd.fontScale')).toBe('1.2');
    await vi.waitFor(() => expect(h.prefs.get('yd.fontScale')).toBe('1.2'));
    expect(h.prefs.has('other.key')).toBe(false);
  });

  it('웹에서는 아무 것도 하지 않는다', async () => {
    setPlatform(null);
    h.prefs.set('yd.theme', 'dark');
    const native = await boot();
    const { storage } = await import('../../lib/storage');
    expect(storage.get('yd.theme')).toBeNull();
    expect(h.appListeners.backButton).toBeUndefined();
    expect(await native.showRewardedAd()).toBe(false);
  });
});

describe('브리지 등록', () => {
  it('registerNative 로 햅틱·공유·상태바·외부 링크가 연결된다', async () => {
    await boot();
    const { native } = await import('../../lib/platform');
    native.haptic?.('success');
    expect(h.fn.hapticNotify).toHaveBeenCalledWith({ type: 'SUCCESS' });
    native.setStatusBar?.('dark');
    expect(h.fn.statusBarStyle).toHaveBeenCalledWith({ style: 'DARK' });
    expect(await native.share?.({ title: 't', text: 'x', url: 'https://a.b' })).toBe(true);
    await native.openExternal?.('https://kauth.kakao.com/x');
    expect(h.fn.browserOpen).toHaveBeenCalledWith({ url: 'https://kauth.kakao.com/x' });
    expect(await native.requestPush?.()).toBe('fcm-token-1');
  });
});

describe('하드웨어 뒤로가기', () => {
  it('열린 시트가 있으면 yd:back 을 보내고, 없으면 history.back, 첫 화면이면 앱 최소화', async () => {
    await boot();
    const back = h.appListeners.backButton!;
    const onBack = vi.fn();
    listen('yd:back', onBack);
    const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);

    window.history.pushState({ idx: 1 }, '', '/saju');
    const sheet = document.createElement('div');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    document.body.append(sheet);
    back({ canGoBack: true });
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(historyBack).not.toHaveBeenCalled();

    sheet.remove();
    back({ canGoBack: true });
    expect(historyBack).toHaveBeenCalledTimes(1);
    expect(h.fn.minimizeApp).not.toHaveBeenCalled();

    window.history.replaceState({ idx: 0 }, '', '/today');
    back({ canGoBack: true });
    expect(h.fn.minimizeApp).toHaveBeenCalledTimes(1);

    window.history.replaceState({ idx: 3 }, '', '/store');
    back({ canGoBack: false });
    expect(h.fn.minimizeApp).toHaveBeenCalledTimes(2);
  });

  it('실제 BottomSheet 가 뒤로가기로 닫힌다', async () => {
    await boot();
    const { BottomSheet } = await import('../../components/BottomSheet');
    const onClose = vi.fn();
    render(createElement(BottomSheet, { open: true, onClose, title: '용어 풀이', children: '내용' }));
    act(() => h.appListeners.backButton!({ canGoBack: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(h.fn.minimizeApp).not.toHaveBeenCalled();
  });
});

describe('딥링크', () => {
  it('appUrlOpen 의 URL 을 pushState + popstate 로 라우팅한다', async () => {
    vi.stubEnv('VITE_PUBLIC_WEB_URL', 'https://dalbitsaju.kr');
    await boot();
    const open = h.appListeners.appUrlOpen!;
    const pops: PopStateEvent[] = [];
    listen('popstate', (e) => pops.push(e as PopStateEvent));

    open({ url: 'https://dalbitsaju.kr/auth/callback/kakao?code=abc&state=xyz' });
    expect(window.location.pathname).toBe('/auth/callback/kakao');
    expect(window.location.search).toBe('?code=abc&state=xyz');
    expect(pops).toHaveLength(1);
    expect(h.fn.browserClose).toHaveBeenCalledTimes(1); // 로그인용 인앱 브라우저 닫기
    const idx = (window.history.state as { idx: number }).idx;

    open({ url: 'kr.dalbitsaju.app://payments/success?orderId=o1' });
    expect(`${window.location.pathname}${window.location.search}`).toBe('/payments/success?orderId=o1');
    expect((window.history.state as { idx: number }).idx).toBe(idx + 1); // react-router 인덱스 유지

    open({ url: 'https://dalbitsaju.kr/today/' });
    expect(window.location.pathname).toBe('/today');

    // 다른 도메인·허용되지 않은 경로·모르는 스킴은 무시
    for (const url of ['https://evil.example/today', 'https://dalbitsaju.kr/admin', 'javascript:alert(1)', 'other.app://today']) open({ url });
    expect(window.location.pathname).toBe('/today');
    expect(pops).toHaveLength(3);
  });

  it('콜드 스타트 링크(getLaunchUrl)와 알림 탭(data.link)도 라우팅한다', async () => {
    h.launchUrl = { url: 'https://dalbitsaju.kr/reports/r1' };
    await boot();
    expect(window.location.pathname).toBe('/reports/r1');

    h.fcmListeners.notificationActionPerformed!({ actionId: 'tap', notification: { data: { link: '/fortune/today' } } });
    expect(window.location.pathname).toBe('/today');
  });

  it('resolveDeepLink 단위 규칙', async () => {
    vi.stubEnv('VITE_PUBLIC_WEB_URL', 'https://dalbitsaju.kr');
    vi.stubEnv('VITE_APP_URL_SCHEME', 'dalbitsaju');
    const { resolveDeepLink } = await import('../navigation');
    expect(resolveDeepLink('dalbitsaju://auth/callback/apple?code=1#x')).toBe('/auth/callback/apple?code=1#x');
    expect(resolveDeepLink('kr.dalbitsaju.app:///today')).toBe('/today');
    expect(resolveDeepLink('capacitor://localhost/my')).toBe('/my');
    expect(resolveDeepLink('/yearly/p1?year=2027')).toBe('/yearly/p1?year=2027');
    expect(resolveDeepLink('/auth/callback/')).toBeNull();
    expect(resolveDeepLink('')).toBeNull();
  });
});

describe('보상형 광고 (AdMob)', () => {
  it('보상을 받은 경우만 세어 하루 3회로 제한하고, 날짜가 바뀌면 초기화한다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 12, 10, 0));
    const native = await boot();

    expect(await native.rewardedAdsRemaining()).toBe(3);
    for (let i = 0; i < 3; i++) expect(await native.showRewardedAd()).toBe(true);
    expect(await native.showRewardedAd()).toBe(false);
    expect(h.fn.showReward).toHaveBeenCalledTimes(3);
    expect(await native.rewardedAdsRemaining()).toBe(0);
    expect(JSON.parse(h.prefs.get('yd.native.rewardedAds')!)).toEqual({ date: '2026-10-12', count: 3 });

    vi.setSystemTime(new Date(2026, 9, 13, 0, 5));
    expect(await native.rewardedAdsRemaining()).toBe(3);
    expect(await native.showRewardedAd()).toBe(true);
    expect(h.fn.showReward).toHaveBeenCalledTimes(4);
  });

  it('끝까지 보지 않고 닫거나 로드에 실패하면 false 이고 횟수를 쓰지 않는다', async () => {
    const native = await boot();
    h.fn.showReward.mockImplementationOnce(() => {
      h.emitAd('onRewardedVideoAdDismissed');
      return new Promise(() => undefined); // 보상 없이 닫힘 → 네이티브 promise 는 끝나지 않는다
    });
    expect(await native.showRewardedAd()).toBe(false);

    h.fn.prepareReward.mockRejectedValueOnce(new Error('No fill'));
    expect(await native.showRewardedAd()).toBe(false);

    expect(await native.rewardedAdsRemaining()).toBe(3);
    expect(h.adListeners.get('onRewardedVideoAdDismissed')?.size ?? 0).toBe(0); // 리스너 정리
  });

  it('SSV 에 사용자 ID 를 넘긴다', async () => {
    h.prefs.set('yd.session', JSON.stringify({ accessToken: 'a', refreshToken: 'r', user: { id: 'user-1', provider: 'kakao' } }));
    const native = await boot();
    await native.showRewardedAd({ ssvCustomData: 'chat:p1' });
    expect(h.fn.prepareReward).toHaveBeenCalledWith(expect.objectContaining({ ssv: { userId: 'user-1', customData: 'chat:p1' }, isTesting: true }));
  });
});

describe('인앱결제', () => {
  it('Android: purchaseToken 을 영수증으로 돌려주고, 서버 검증 후 finishPurchase 가 소모한다', async () => {
    h.fn.purchaseProduct.mockResolvedValueOnce({ transactionId: 'GPA.1', purchaseToken: 'tok-1', purchaseState: '1', productIdentifier: 'report_compat' });
    const native = await boot();
    const { native: bridge } = await import('../../lib/platform');

    expect(await bridge.purchase!('report_compat')).toEqual({ receipt: 'tok-1' });
    expect(h.fn.purchaseProduct).toHaveBeenCalledWith(expect.objectContaining({ productIdentifier: 'report_compat', autoAcknowledgePurchases: false, isConsumable: false }));
    expect(h.fn.consumePurchase).not.toHaveBeenCalled(); // 검증 전에는 소모하지 않음

    expect(await native.finishPurchase('tok-1')).toBe(true);
    expect(h.fn.consumePurchase).toHaveBeenCalledWith({ purchaseToken: 'tok-1' });
  });

  it('iOS: transactionId 를 영수증으로 쓰고 finishTransaction 으로 마무리, 취소는 null', async () => {
    setPlatform('ios');
    h.fn.purchaseProduct.mockResolvedValueOnce({ transactionId: '2000001', productIdentifier: 'kr.saju.chat.10' });
    const native = await boot();
    const { native: bridge } = await import('../../lib/platform');
    expect(await bridge.purchase!('kr.saju.chat.10')).toEqual({ receipt: '2000001' });
    await native.finishPurchase('2000001');
    expect(h.fn.finishTransaction).toHaveBeenCalledWith({ transactionId: '2000001' });

    h.fn.purchaseProduct.mockRejectedValueOnce(Object.assign(new Error('User cancelled'), { code: '' }));
    expect(await bridge.purchase!('kr.saju.chat.10')).toBeNull();
  });

  it('미완료 거래를 서버 검증 후 마무리한다', async () => {
    h.fn.getUnfinished.mockResolvedValue({ transactions: [{ transactionId: 'GPA.9', purchaseToken: 'tok-9', productIdentifier: 'chat_pack_10' }] });
    const native = await boot();
    const verify = vi.fn(async () => ({ ok: true }));
    expect(await native.recoverUnfinishedPurchases(verify)).toEqual({ recovered: 1, failed: 0 });
    expect(verify).toHaveBeenCalledWith({ platform: 'android', productId: 'chat_pack_10', receipt: 'tok-9' });
    expect(h.fn.consumePurchase).toHaveBeenCalledWith({ purchaseToken: 'tok-9' });
  });
});
