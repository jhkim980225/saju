/**
 * 오늘 탭의 "앞으로의 운세 미리 보기" — 보상형 광고(하루 1회, POST /rewards/toss/start·claim 의 slot `tomorrow_fortune`).
 *  - 오늘과 지난 날은 그대로 볼 수 있다. 내일부터의 날짜를 누르면 "광고 보고 미리 보기"를 묻는다.
 *  - 광고는 사용자가 버튼을 눌렀을 때만 나오고, 끝까지 봤을 때(userEarnedReward)만 열린다.
 *  - 열린 상태는 한국 시간 날짜와 함께 기기에 기억한다(서버는 하루 한도와 일회성만 확인한다).
 *  - 광고를 쓸 수 없는 환경(광고 ID 없음·낮은 토스앱·서버 미설정(GET /config 의 features.tossRewards)·게스트)에서는 막지 않는다 — 웹과 같이 모든 날을 볼 수 있다.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/ui';
import { useConfig } from '@/hooks/queries';
import { ApiError } from '@/lib/api';
import { storage } from '@/lib/storage';
import { REWARDED_AD_ID, showRewarded, useRewardedAd } from './ads';
import { tossApi } from './api';
import { isTossAccount } from './session';

export const FUTURE_UNLOCK_KEY = 'yd.tossFutureUnlock';

export const isFutureUnlocked = (todayIso: string) => storage.get(FUTURE_UNLOCK_KEY) === todayIso;

/** 광고를 본 뒤 서버에 지급을 요청한다. 너무 이르다고 하면 잠깐 기다렸다가 한 번 더 요청한다 */
async function claim(token: string, minWatchMs: number, startedAt: number): Promise<boolean> {
  const wait = minWatchMs - (Date.now() - startedAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const first = await tossApi.rewardClaim(token);
  if (first.granted) return true;
  if (first.reason !== 'TOO_EARLY') return first.reason === 'DUPLICATE';
  await new Promise((r) => setTimeout(r, 1500));
  return (await tossApi.rewardClaim(token)).granted;
}

export function useFutureDayGate(todayIso: string): { select: (iso: string, apply: (iso: string) => void) => void; sheet: ReactNode } {
  const [unlocked, setUnlocked] = useState(() => isFutureUnlocked(todayIso));
  const [pending, setPending] = useState<{ iso: string; apply: (iso: string) => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // 진입 직후에는 광고를 불러오지 않는다 — 앞날을 처음 눌렀을 때부터 준비한다
  const [wanted, setWanted] = useState(false);
  const ad = useRewardedAd(wanted);
  /** 광고로 막을 수 있는 환경인가 */
  const rewardsOn = useConfig().data?.features.tossRewards === true;
  const gated = Boolean(REWARDED_AD_ID) && rewardsOn && isTossAccount() && ad !== 'unsupported';

  const select = useCallback(
    (iso: string, apply: (iso: string) => void) => {
      if (iso <= todayIso || unlocked || !gated) return apply(iso);
      setWanted(true);
      setMessage(null);
      setPending({ iso, apply });
    },
    [todayIso, unlocked, gated],
  );

  const watch = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const startedAt = Date.now();
      const start = await tossApi.rewardStart({ kind: 'unlock', slot: 'tomorrow_fortune' });
      if (!(await showRewarded())) return setMessage('광고를 끝까지 보면 미리 볼 수 있어요.');
      if (!(await claim(start.token, start.minWatchMs, startedAt))) return setMessage('보상을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
      storage.set(FUTURE_UNLOCK_KEY, todayIso);
      setUnlocked(true);
      pending.apply(pending.iso);
      setPending(null);
    } catch (e) {
      const reason = e instanceof ApiError ? (e.details as { reason?: string } | undefined)?.reason : undefined;
      // 오늘 한도를 이미 썼다면(다른 기기에서 열었을 때) 같은 날이므로 그대로 열어 준다
      if (reason === 'DAILY_LIMIT') {
        storage.set(FUTURE_UNLOCK_KEY, todayIso);
        setUnlocked(true);
        pending.apply(pending.iso);
        setPending(null);
      } else setMessage('지금은 광고를 불러올 수 없어요. 잠시 뒤 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const sheet = (
    <BottomSheet
      open={pending !== null}
      onClose={() => setPending(null)}
      title="앞으로의 운세 미리 보기"
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setPending(null)}>
            닫기
          </Button>
          <Button loading={busy} disabled={ad !== 'ready'} onClick={watch}>
            {ad === 'ready' ? '광고 보고 미리 보기' : '광고 준비 중이에요'}
          </Button>
        </div>
      }
    >
      <p className="text-[15px] leading-relaxed text-ink-2">광고를 끝까지 보면 오늘 하루 동안 이번 주 남은 날의 운세를 미리 볼 수 있어요. 오늘과 지난 날의 운세는 광고 없이 볼 수 있어요.</p>
      {message && (
        <p role="alert" className="mt-3 rounded-xl bg-subtle p-3 text-sm text-danger">
          {message}
        </p>
      )}
    </BottomSheet>
  );

  return { select, sheet };
}
