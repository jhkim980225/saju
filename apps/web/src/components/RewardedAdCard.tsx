import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PlayCircle } from 'lucide-react';
import { useState } from 'react';
import { qk } from '@/hooks/queries';
import { api } from '@/lib/api';
import { isNativeApp } from '@/lib/platform';
import { showRewardedAd } from '@/native';
import { toast } from './Toast';
import { Button } from './ui';

/**
 * 앱 전용 — 보상형 광고 시청으로 무상 질문권 받기 (하루 3회, 마케팅 정책).
 * 실제 지급은 서버가 AdMob SSV 콜백(서명 검증)을 받은 뒤에 하므로, 시청 후 잠시 뒤 지갑을 다시 불러온다.
 */
export function RewardedAdCard() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const status = useQuery({ queryKey: ['rewardStatus'], queryFn: api.rewardStatus, enabled: isNativeApp() });
  if (!isNativeApp() || !status.data || status.data.remaining <= 0) return null;

  const watch = async () => {
    setBusy(true);
    try {
      const rewarded = await showRewardedAd({ ssvCustomData: 'chat' });
      if (!rewarded) return toast('광고를 끝까지 보면 질문권을 드려요');
      toast('보상을 확인하고 있어요');
      for (const wait of [2000, 4000, 8000]) {
        await new Promise((r) => setTimeout(r, wait));
        await qc.invalidateQueries({ queryKey: qk.wallet });
        await status.refetch();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 flex items-center gap-3 rounded-2xl border border-line bg-surface p-4">
      <PlayCircle className="size-8 shrink-0 text-ink-2" aria-hidden />
      <div className="flex-1 text-sm">
        <p className="font-semibold">광고 보고 질문권 {status.data.creditsPerReward}회 받기</p>
        <p className="text-ink-3">오늘 {status.data.remaining}번 더 받을 수 있어요</p>
      </div>
      <Button size="sm" variant="secondary" loading={busy} onClick={watch}>
        보기
      </Button>
    </div>
  );
}
