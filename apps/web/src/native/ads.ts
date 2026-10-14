/**
 * AdMob (@capacitor-community/admob) — 보상형 광고 + 배너 헬퍼.
 * 정책(docs/research/03-pricing-payments-ads.md §5.7):
 *  - 보상형 app_rewarded_chat: "AI 질문권을 다 썼을 때 광고 보고 1회 추가", 하루 3회 한도, 사용자가 직접 선택해야 함
 *  - 배너 app_banner_result: 무료 결과 화면 하단만. 입력·결제·유료 리포트·AI 채팅 입력창 주변 금지, 유료/구독자 비노출
 *  - 보상 지급은 서버 측 검증(SSV) 권장 — 클라이언트 true 만 믿고 유상 재화를 주지 말 것
 */
import {
  AdMob,
  BannerAdPluginEvents,
  BannerAdPosition,
  BannerAdSize,
  RewardAdPluginEvents,
  type AdMobBannerSize,
} from '@capacitor-community/admob';
import type { PluginListenerHandle } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { nativePlatform } from '../lib/platform';
import { useSession } from '../lib/session';
import { adUnitId } from './env';

export const REWARDED_DAILY_LIMIT = 3;
/** Preferences 키 — { date: 'YYYY-MM-DD'(기기 현지 날짜), count } */
export const REWARDED_COUNT_KEY = 'yd.native.rewardedAds';
/** 광고를 닫은 뒤 보상 콜백이 늦게 오는 경우를 기다리는 시간 */
const REWARD_GRACE_MS = 500;
/** 닫힘 이벤트가 끝내 오지 않을 때(SDK 이상) 다음 호출이 막히지 않도록 하는 안전장치 */
const PRESENT_TIMEOUT_MS = 5 * 60_000;

const storePlatform = (): 'ios' | 'android' => (nativePlatform() === 'ios' ? 'ios' : 'android');

let initialized: Promise<boolean> | null = null;

function ensureAdMob(): Promise<boolean> {
  initialized ??= AdMob.initialize()
    .then(() => true)
    .catch((e: unknown) => {
      console.warn('[native] AdMob 초기화 실패', e);
      initialized = null;
      return false;
    });
  return initialized;
}

/** iOS ATT 미허용이면 비개인화 광고(npa)로 요청. (ATT 팝업은 여기서 띄우지 않는다 — 필요 시 화면에서 프리프롬프트 후 요청) */
async function nonPersonalized(): Promise<boolean> {
  if (storePlatform() !== 'ios') return false;
  try {
    const { status } = await AdMob.trackingAuthorizationStatus();
    return status !== 'authorized';
  } catch {
    return true;
  }
}

function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function readCount(): Promise<{ date: string; count: number }> {
  const today = localDate();
  try {
    const { value } = await Preferences.get({ key: REWARDED_COUNT_KEY });
    const parsed = value ? (JSON.parse(value) as { date?: string; count?: number }) : null;
    if (parsed?.date === today && typeof parsed.count === 'number') return { date: today, count: parsed.count };
  } catch {
    /* 손상된 값 — 0 으로 */
  }
  return { date: today, count: 0 };
}

/** 오늘 남은 보상형 광고 횟수 */
export async function rewardedAdsRemaining(): Promise<number> {
  const { count } = await readCount();
  return Math.max(0, REWARDED_DAILY_LIMIT - count);
}

/** 광고를 띄우고 보상 획득 여부를 반환. (showRewardVideoAd 는 보상 시에만 resolve 되므로 닫힘 이벤트로 끝을 판단) */
function present(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let earned = false;
    let dismissed = false;
    let done = false;
    let safety: ReturnType<typeof setTimeout> | undefined;
    const handles: Promise<PluginListenerHandle>[] = [];
    const finish = (value: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(safety);
      for (const h of handles) void h.then((x) => x.remove()).catch(() => undefined);
      resolve(value);
    };
    safety = setTimeout(() => finish(earned), PRESENT_TIMEOUT_MS);
    const onEarned = () => {
      earned = true;
      if (dismissed) finish(true);
    };
    handles.push(AdMob.addListener(RewardAdPluginEvents.Rewarded, onEarned));
    handles.push(
      AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
        dismissed = true;
        if (earned) finish(true);
        else setTimeout(() => finish(earned), REWARD_GRACE_MS);
      }),
    );
    handles.push(AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => finish(false)));
    void Promise.all(handles)
      .then(() => AdMob.showRewardVideoAd())
      .then(onEarned, () => finish(false));
  });
}

let showing: Promise<boolean> | null = null;

/**
 * 보상형 광고 1회 — 보상을 받았으면 true. 웹·한도 초과·로드 실패·중도 닫기는 false.
 * 하루 3회(기기 현지 날짜 기준, Preferences 에 카운트). 보상을 받은 경우에만 횟수를 차감한다.
 * ssvCustomData 는 AdMob SSV 콜백으로 서버에 전달된다(예: 'chat:<profileId>').
 */
export function showRewardedAd(opts: { ssvCustomData?: string } = {}): Promise<boolean> {
  showing ??= (async () => {
    if ((await readCount()).count >= REWARDED_DAILY_LIMIT) return false;
    if (!(await ensureAdMob())) return false;
    const { adId, isTesting } = adUnitId('rewarded', storePlatform());
    const userId = useSession.getState().user?.id;
    const ssv = userId ? { userId, ...(opts.ssvCustomData ? { customData: opts.ssvCustomData } : {}) } : opts.ssvCustomData ? { customData: opts.ssvCustomData } : undefined;
    try {
      await AdMob.prepareRewardVideoAd({ adId, isTesting, npa: await nonPersonalized(), ...(ssv ? { ssv } : {}) });
    } catch (e) {
      console.warn('[native] 보상형 광고 로드 실패', e);
      return false;
    }
    const earned = await present();
    if (earned) {
      const { date, count } = await readCount();
      await Preferences.set({ key: REWARDED_COUNT_KEY, value: JSON.stringify({ date, count: count + 1 }) });
    }
    return earned;
  })().finally(() => (showing = null));
  return showing;
}

// ── 배너 ─────────────────────────────────────────────────────
let bannerVisible = false;

/**
 * 결과 화면 하단 적응형 배너. 네이티브 오버레이라 웹 레이아웃을 밀어내지 않으므로,
 * onBannerSizeChanged 로 높이를 받아 본문 하단 여백을 그만큼 늘린다. margin 은 하단 탭바 높이(pt/dp).
 */
export async function showBannerAd(opts: { margin?: number } = {}): Promise<boolean> {
  if (!(await ensureAdMob())) return false;
  const { adId, isTesting } = adUnitId('banner', storePlatform());
  try {
    await AdMob.showBanner({
      adId,
      isTesting,
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: opts.margin ?? 0,
      npa: await nonPersonalized(),
    });
    bannerVisible = true;
    return true;
  } catch (e) {
    console.warn('[native] 배너 광고 실패', e);
    return false;
  }
}

export async function hideBannerAd(): Promise<void> {
  if (!bannerVisible) return;
  await AdMob.hideBanner().catch(() => undefined);
}

export async function resumeBannerAd(): Promise<void> {
  if (!bannerVisible) return;
  await AdMob.resumeBanner().catch(() => undefined);
}

export async function removeBannerAd(): Promise<void> {
  if (!bannerVisible) return;
  bannerVisible = false;
  await AdMob.removeBanner().catch(() => undefined);
}

/** 배너 높이 변화 구독 (숨김/제거 시 0). 반환 함수로 구독 해제 */
export function onBannerSizeChanged(cb: (height: number) => void): () => void {
  const handle = AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size: AdMobBannerSize) => cb(size.height));
  return () => void handle.then((h) => h.remove()).catch(() => undefined);
}
