/**
 * 광고 슬롯 (웹 전용) — 마케팅팀 정책(docs/ADS_ANALYTICS.md):
 *  - 노출 위치: 무료 결과 하단(result_bottom), 홈/오늘 인피드(home_infeed), 띠별·별자리 같은 SEO 콘텐츠 본문 중간(content_mid).
 *    입력·결제·유료 리포트·AI 상담 화면에는 절대 넣지 않는다.
 *  - 프리미엄 사용자(user.isPremium)에게는 노출하지 않는다.
 *  - 앱(Capacitor)에서는 렌더링하지 않는다 — AdMob 배너/보상형은 앱팀이 native 계층에서 처리.
 *  - 서버 /config 의 ads.enabled 가 true 이고, ads.provider('adsense' | 'adfit')의 키가 있을 때만 렌더링.
 *    키가 하나도 없으면 /config 조회도 하지 않고 null.
 *  - "광고" 라벨 + 고정 최소 높이(CLS 방지). 광고 미노출(unfilled)·스크립트 차단 시 슬롯을 접는다.
 */
import type { ReactNode } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useConfig } from '@/hooks/queries';
import { loadScript } from '@/lib/analytics';
import { isNativeApp } from '@/lib/platform';
import { useSession } from '@/lib/session';

export type AdPlacement = 'result_bottom' | 'home_infeed' | 'content_mid';

const ADSENSE_SRC = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';
const ADFIT_SRC = 'https://t1.daumcdn.net/kas/static/ba.min.js';
/** CLS 방지용 예약 높이(px) — AdSense 반응형은 모바일에서 대체로 250 내외, 애드핏 320x100 */
const MIN_HEIGHT = { adsense: 250, adfit: 100 } as const;

const env = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function adsenseUnit(placement: AdPlacement): { client: string; slot: string } | null {
  const client = env(import.meta.env.VITE_ADSENSE_CLIENT_ID);
  const slot = env(placement === 'result_bottom' ? import.meta.env.VITE_ADSENSE_SLOT_RESULT_BOTTOM : placement === 'content_mid' ? import.meta.env.VITE_ADSENSE_SLOT_CONTENT_MID : import.meta.env.VITE_ADSENSE_SLOT_HOME_INFEED);
  return client && slot ? { client, slot } : null;
}

function adfitUnit(placement: AdPlacement): string | null {
  return env(placement === 'result_bottom' ? import.meta.env.VITE_ADFIT_UNIT_RESULT_BOTTOM : placement === 'content_mid' ? import.meta.env.VITE_ADFIT_UNIT_CONTENT_MID : import.meta.env.VITE_ADFIT_UNIT_HOME_INFEED) || null;
}

export function AdSlot({ placement }: { placement: AdPlacement }) {
  if (isNativeApp()) return null;
  if (!adsenseUnit(placement) && !adfitUnit(placement)) return null;
  return <ConfiguredAdSlot placement={placement} />;
}

function ConfiguredAdSlot({ placement }: { placement: AdPlacement }) {
  const { data: config } = useConfig();
  const isPremium = useSession((s) => s.user?.isPremium === true);
  const [collapsed, setCollapsed] = useState(false);
  const collapse = useCallback(() => setCollapsed(true), []);

  if (isPremium || collapsed || !config?.ads?.enabled) return null;

  if (config.ads.provider === 'adsense') {
    const unit = adsenseUnit(placement);
    if (!unit) return null;
    return (
      <AdFrame minHeight={MIN_HEIGHT.adsense} placement={placement}>
        <AdSenseUnit key={unit.slot} client={unit.client} slot={unit.slot} onUnfilled={collapse} />
      </AdFrame>
    );
  }
  if (config.ads.provider === 'adfit') {
    const unit = adfitUnit(placement);
    if (!unit) return null;
    return (
      <AdFrame minHeight={MIN_HEIGHT.adfit} placement={placement}>
        <AdFitUnit key={unit} unit={unit} onUnfilled={collapse} />
      </AdFrame>
    );
  }
  return null;
}

function AdFrame({ minHeight, placement, children }: { minHeight: number; placement: AdPlacement; children: ReactNode }) {
  return (
    <aside aria-label="광고" data-ad-placement={placement} className="overflow-hidden rounded-2xl border border-line bg-subtle">
      <span className="block px-3 pt-2 text-[11px] font-medium leading-none text-ink-3">광고</span>
      <div className="flex w-full items-center justify-center px-1 pb-2 pt-1.5" style={{ minHeight }}>
        {children}
      </div>
    </aside>
  );
}

/** Google AdSense 반응형 디스플레이 */
function AdSenseUnit({ client, slot, onUnfilled }: { client: string; slot: string; onUnfilled: () => void }) {
  const ref = useRef<HTMLModElement>(null);
  const pushed = useRef(false);

  useEffect(() => {
    const ins = ref.current;
    if (!ins) return;
    loadScript(`${ADSENSE_SRC}?client=${encodeURIComponent(client)}`, { crossOrigin: 'anonymous' }).catch(onUnfilled);
    // StrictMode 의 이펙트 재실행에서 같은 <ins> 에 두 번 push 하면 AdSense 오류가 나므로 1회만
    if (!pushed.current) {
      pushed.current = true;
      try {
        const w = window as unknown as { adsbygoogle?: unknown[] };
        (w.adsbygoogle = w.adsbygoogle || []).push({});
      } catch {
        /* 조용히 무시 */
      }
    }
    // 채울 광고가 없으면 AdSense 가 data-ad-status="unfilled" 를 붙인다 → 빈 박스 대신 슬롯을 접는다
    const mo = new MutationObserver(() => {
      if (ins.getAttribute('data-ad-status') === 'unfilled') onUnfilled();
    });
    mo.observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] });
    return () => mo.disconnect();
  }, [client, slot, onUnfilled]);

  return (
    <ins
      ref={ref}
      className="adsbygoogle"
      style={{ display: 'block', width: '100%' }}
      data-ad-client={client}
      data-ad-slot={slot}
      data-ad-format="auto"
      data-full-width-responsive="true"
      {...(import.meta.env.DEV ? { 'data-adtest': 'on' } : {})}
    />
  );
}

/**
 * 카카오 애드핏 320x100 배너.
 * ba.min.js 는 실행될 때 문서의 미처리 <ins class="kakao_ad_area"> 를 찾아 렌더링하므로, SPA 에서는
 * 공식 삽입 코드처럼 슬롯마다 <ins> 바로 뒤에 스크립트를 붙이고 언마운트 때 제거한다(브라우저 캐시로 재다운로드 없음).
 */
function AdFitUnit({ unit, onUnfilled }: { unit: string; onUnfilled: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const failCallback = `__ydAdfitFail_${useId().replace(/[^a-zA-Z0-9_]/g, '')}`;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = window as unknown as Record<string, unknown> & { adfit?: { destroy?: (unit: string) => void } };
    w[failCallback] = () => onUnfilled(); // data-ad-onfail: 광고가 없을 때 애드핏이 호출
    const s = document.createElement('script');
    s.async = true;
    s.src = ADFIT_SRC;
    s.onerror = () => onUnfilled();
    el.appendChild(s);
    return () => {
      s.remove();
      try {
        w.adfit?.destroy?.(unit);
      } catch {
        /* noop */
      }
      delete w[failCallback];
    };
  }, [unit, failCallback, onUnfilled]);

  return (
    <div ref={box} className="flex justify-center">
      <ins className="kakao_ad_area" style={{ display: 'none' }} data-ad-unit={unit} data-ad-width="320" data-ad-height="100" data-ad-onfail={failCallback} />
    </div>
  );
}
