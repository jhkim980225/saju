/**
 * 토스 광고 — 배너(무료 결과 하단·오늘 탭·무료 콘텐츠 본문)와 보상형(이번 주 남은 날 운세 미리 보기).
 * 정책(docs/ADS_ANALYTICS.md + 앱인토스): 입력·결제·유료 리포트 화면에는 넣지 않는다. 진입 직후에는 띄우지 않는다.
 * 보상은 userEarnedReward 이벤트에서만 준다(dismissed 만으로는 주지 않는다). 광고 ID 가 없으면 아무것도 부르지 않는다.
 */
import { TossAds, loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework';
import { useEffect, useSyncExternalStore } from 'react';
import { bannerId, rewardedId } from './adIds';

const MODE = import.meta.env.MODE;
export const REWARDED_AD_ID = rewardedId(MODE, import.meta.env.VITE_TOSS_AD_REWARDED);
/** 무료 결과 하단(result_bottom) — 리스트형 배너 */
export const BANNER_RESULT_AD_ID = bannerId(MODE, import.meta.env.VITE_TOSS_AD_BANNER_RESULT);
/** 오늘 탭·무료 콘텐츠 본문(home_infeed, web_content_mid) — 피드형 배너 */
export const BANNER_FEED_AD_ID = bannerId(MODE, import.meta.env.VITE_TOSS_AD_BANNER_FEED);

export type AdStatus = 'idle' | 'loading' | 'ready' | 'showing' | 'failed' | 'unsupported';

const MAX_RETRIES = 2;
/** 브라우저 mock 은 userEarnedReward 를 보내지 않아서 toss-dev(브라우저 확인용)에서만 보상을 흉내 낸다 */
const SIMULATE_REWARD = MODE === 'toss-dev';
let status: AdStatus = 'idle';
let retries = 0;
let retryTimer = 0;
let unregisterLoad: (() => void) | null = null;
const listeners = new Set<() => void>();

function setStatus(next: AdStatus) {
  status = next;
  listeners.forEach((l) => l());
}

function supported(): boolean {
  try {
    return loadFullScreenAd.isSupported() && showFullScreenAd.isSupported();
  } catch {
    return false;
  }
}

function retryLater() {
  if (retries >= MAX_RETRIES) return;
  retries++;
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(preloadRewarded, retries * 8000);
}

/** 보상형 광고를 미리 불러온다 — 같은 광고 그룹은 한 번에 하나만 */
export function preloadRewarded() {
  if (!REWARDED_AD_ID) return setStatus('unsupported');
  if (status === 'loading' || status === 'ready' || status === 'showing' || status === 'unsupported') return;
  if (!supported()) return setStatus('unsupported');
  setStatus('loading');
  try {
    unregisterLoad?.();
    unregisterLoad = loadFullScreenAd({
      options: { adGroupId: REWARDED_AD_ID },
      onEvent: (e) => {
        if (e.type === 'loaded') {
          retries = 0;
          setStatus('ready');
        }
      },
      onError: () => {
        setStatus('failed');
        retryLater();
      },
    });
  } catch {
    setStatus('failed');
    retryLater();
  }
}

/** 보상형 광고를 보여 준다. 끝까지 봐서 보상을 받았으면 true */
export function showRewarded(): Promise<boolean> {
  return new Promise((resolve) => {
    if (status !== 'ready') return resolve(false);
    setStatus('showing');
    let earned = false;
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      setStatus('idle');
      resolve(earned);
      preloadRewarded();
    };
    try {
      showFullScreenAd({
        options: { adGroupId: REWARDED_AD_ID },
        onEvent: (e) => {
          if (e.type === 'userEarnedReward') earned = true;
          else if (e.type === 'dismissed') {
            if (SIMULATE_REWARD) earned = true;
            finish();
          } else if (e.type === 'failedToShow') finish();
        },
        onError: finish,
      });
    } catch {
      finish();
    }
  });
}

/** enabled 가 true 가 되면 광고를 미리 불러오고, 준비 상태를 돌려준다 */
export function useRewardedAd(enabled: boolean): AdStatus {
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
  useEffect(() => {
    if (enabled) preloadRewarded();
  }, [enabled]);
  return current;
}

let bannerInit: Promise<void> | null = null;

/** 배너 SDK 초기화 — 실패하면 다음에 화면에 들어올 때 다시 시도한다 */
export function initBanners(): Promise<void> {
  bannerInit ??= new Promise<void>((resolve, reject) => {
    try {
      if (!TossAds.initialize.isSupported()) return reject(new Error('unsupported'));
      TossAds.initialize({ callbacks: { onInitialized: () => resolve(), onInitializationFailed: reject } });
    } catch (e) {
      reject(e instanceof Error ? e : new Error('init failed'));
    }
  }).catch((e: unknown) => {
    bannerInit = null;
    throw e;
  });
  return bannerInit;
}

export { TossAds };
