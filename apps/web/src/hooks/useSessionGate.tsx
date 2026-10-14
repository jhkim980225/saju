import { useCallback, useEffect, useState } from 'react';
import { ErrorState } from '@/components/ui';
import { t } from '@/lib/copy';
import { ensureSession, useSession } from '@/lib/session';

/**
 * 탭 화면 진입 시 게스트 세션을 보장한다. 서버에 닿지 못하면(오프라인·서버 장애) 오류와 재시도를 제공해
 * 빈 화면으로 남지 않게 한다.
 */
export function useSessionGate() {
  const token = useSession((s) => s.accessToken);
  const [failed, setFailed] = useState(false);
  const start = useCallback(() => {
    setFailed(false);
    ensureSession().catch(() => setFailed(true));
  }, []);
  // 화면 진입 시 한 번만 — 로그아웃·탈퇴로 토큰이 비는 순간 게스트를 다시 만들지 않도록 토큰 변화는 구독하지 않는다
  useEffect(() => {
    if (!useSession.getState().accessToken) start();
  }, [start]);
  return { ready: Boolean(token), failed, retry: start };
}

export function SessionGateError({ onRetry }: { onRetry: () => void }) {
  return <ErrorState title={t('error.network.title')} body={t('error.network.body')} onRetry={onRetry} />;
}
