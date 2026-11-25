/**
 * 토스 세션 — 로그인 화면 없이 사용자 식별키 인증 코드로 계정을 만든다(계약 1번, POST /auth/toss).
 *  - 같은 토스 사용자는 기기를 바꿔도 같은 계정으로 들어온다.
 *  - 게스트 토큰이 있으면 함께 보내서 게스트로 저장한 사주가 토스 계정으로 옮겨지게 한다.
 *  - 토스앱이 낮은 버전이거나 서버에 토스 연동이 없으면(501) 게스트 세션으로 무료 기능만 연다. 그때 상점은 '준비 중'이다.
 */
import { User } from '@apps-in-toss/web-framework';
import type { AuthTokensDto } from '@saju/shared';
import { API_BASE } from '@/lib/config';
import { useSession } from '@/lib/session';

export type TossAuthDeps = {
  authCode: () => Promise<{ code: string } | undefined>;
  fetch: typeof fetch;
};

const defaultDeps = (): TossAuthDeps => ({
  authCode: () => User.createAnonymousKeyAuthCode() as Promise<{ code: string } | undefined>,
  fetch: (...args) => fetch(...args),
});

/** 이번 실행에서 토스 계정을 만들 수 없다고 확인됨(지원하지 않는 토스앱·서버 미설정) — 화면마다 다시 시도하지 않는다 */
let unavailable = false;

export const isTossAccount = () => useSession.getState().user?.provider === 'toss';

/** 토스 계정으로 로그인한다. 성공하면 true. 지원하지 않는 환경이면 false 를 돌려주고 다시 시도하지 않는다 */
export async function signInWithToss(deps: TossAuthDeps = defaultDeps()): Promise<boolean> {
  let code: string | undefined;
  try {
    code = (await deps.authCode())?.code;
  } catch {
    code = undefined;
  }
  if (!code) {
    unavailable = true;
    return false;
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const guestToken = useSession.getState().accessToken;
  if (guestToken) headers.authorization = `Bearer ${guestToken}`;
  let res: Response;
  try {
    // 인증 코드는 짧은 시간만 유효하므로 받은 즉시 보낸다
    res = await deps.fetch(`${API_BASE}/auth/toss`, { method: 'POST', headers, body: JSON.stringify({ code }) });
  } catch {
    return false; // 네트워크 오류 — 다음에 다시 시도할 수 있다
  }
  if (res.status === 501) unavailable = true;
  if (!res.ok) return false;
  useSession.getState().setTokens((await res.json()) as AuthTokensDto);
  return true;
}

/**
 * lib/session 의 ensureSession 이 토스 빌드에서 부른다.
 * 토스 계정이면 그대로, 아니면 토스 로그인을 시도하고, 안 되면 게스트 세션을 만든다(이미 게스트면 그대로 둔다).
 */
export async function ensureTossSession(startGuest: () => Promise<void>, deps?: TossAuthDeps): Promise<void> {
  if (isTossAccount()) return;
  if (!unavailable && (await signInWithToss(deps))) return;
  if (!useSession.getState().accessToken) await startGuest();
}

/** 결제·보상처럼 토스 계정이 꼭 필요한 순간에 부른다. 토스 계정이 준비되면 true */
export async function requireTossAccount(deps?: TossAuthDeps): Promise<boolean> {
  if (isTossAccount()) return true;
  unavailable = false; // 사용자가 직접 누른 순간에는 한 번 더 시도한다
  return signInWithToss(deps);
}

/** 테스트용 */
export function resetTossAuthForTest() {
  unavailable = false;
}
