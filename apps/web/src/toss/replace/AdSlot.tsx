/**
 * 광고 슬롯 (토스 빌드) — components/AdSlot.tsx 를 대신한다(toss/vite-plugin.ts 의 TOSS_REPLACE).
 * 위치 정책은 웹과 같다: 무료 결과 하단(result_bottom), 오늘 탭(home_infeed), 무료 콘텐츠 본문(web_content_mid).
 * 모두 스크롤되는 화면 안이다(앱인토스: 배너는 스크롤되는 화면에만). 프리미엄 사용자에게는 보이지 않는다.
 * 광고 그룹 ID 가 없거나, 채울 광고가 없거나, 지원하지 않는 토스앱이면 아무것도 그리지 않는다.
 */
import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/session';
import { BANNER_FEED_AD_ID, BANNER_RESULT_AD_ID, TossAds, initBanners } from '../ads';

export type AdPlacement = 'result_bottom' | 'home_infeed' | 'web_content_mid';

export function AdSlot({ placement }: { placement: AdPlacement }) {
  const adGroupId = placement === 'result_bottom' ? BANNER_RESULT_AD_ID : BANNER_FEED_AD_ID;
  const isPremium = useSession((s) => s.user?.isPremium === true);
  const ref = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!adGroupId || isPremium) return;
    let alive = true;
    let handle: { destroy: () => void } | null = null;
    initBanners()
      .then(() => {
        if (!alive || !ref.current || !TossAds.attachBanner.isSupported()) return;
        handle = TossAds.attachBanner(adGroupId, ref.current, {
          theme: 'light',
          tone: 'blackAndWhite',
          variant: 'card',
          callbacks: {
            onNoFill: () => alive && setHidden(true),
            onAdFailedToRender: () => alive && setHidden(true),
          },
        });
      })
      .catch(() => alive && setHidden(true));
    return () => {
      alive = false;
      handle?.destroy();
    };
  }, [adGroupId, isPremium]);

  if (!adGroupId || isPremium || hidden) return null;
  return <div ref={ref} aria-label="광고" data-ad-placement={placement} className="min-h-[96px] overflow-hidden rounded-2xl" />;
}
