/**
 * 세션 스토어 — 토큰과 사용자 정보. "결과 먼저, 가입은 나중에" 원칙에 따라
 * 저장·오늘의 운세 등 서버 데이터가 필요할 때 ensureSession() 이 게스트 세션을 만든다.
 */
import { create } from 'zustand';
import type { AuthTokensDto, UserDto } from '@saju/shared';
import { API_BASE } from './config';
import { STORAGE_KEYS, storage } from './storage';
import { uuid } from './uuid';

interface SessionState {
  accessToken: string | null;
  refreshToken: string | null;
  user: UserDto | null;
  setTokens: (t: AuthTokensDto) => void;
  setUser: (u: UserDto) => void;
  clear: () => void;
}

interface Persisted {
  accessToken: string;
  refreshToken: string;
  user: UserDto;
}

const initial = storage.getJSON<Persisted>(STORAGE_KEYS.session);

export const useSession = create<SessionState>((set) => ({
  accessToken: initial?.accessToken ?? null,
  refreshToken: initial?.refreshToken ?? null,
  user: initial?.user ?? null,
  setTokens: (t) => {
    storage.setJSON(STORAGE_KEYS.session, { accessToken: t.accessToken, refreshToken: t.refreshToken, user: t.user });
    set({ accessToken: t.accessToken, refreshToken: t.refreshToken, user: t.user });
  },
  setUser: (user) =>
    set((s) => {
      if (s.accessToken && s.refreshToken) storage.setJSON(STORAGE_KEYS.session, { accessToken: s.accessToken, refreshToken: s.refreshToken, user });
      return { user };
    }),
  clear: () => {
    storage.remove(STORAGE_KEYS.session);
    set({ accessToken: null, refreshToken: null, user: null });
  },
}));

/** 세션 저장소를 다시 읽는다(앱 저장소 hydrate 이후 호출) */
export function reloadSessionFromStorage() {
  const s = storage.getJSON<Persisted>(STORAGE_KEYS.session);
  useSession.setState({ accessToken: s?.accessToken ?? null, refreshToken: s?.refreshToken ?? null, user: s?.user ?? null });
}

// 다른 탭에서 토큰이 갱신·로그아웃되면 이 탭도 따라간다(refresh 토큰 재사용 탐지로 인한 강제 로그아웃 방지)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEYS.session) reloadSessionFromStorage();
  });
}

export function deviceId(): string {
  let id = storage.get(STORAGE_KEYS.deviceId);
  if (!id) {
    id = uuid();
    storage.set(STORAGE_KEYS.deviceId, id);
  }
  return id;
}

let pending: Promise<void> | null = null;

/** 세션이 없으면 게스트 세션 생성 */
export async function ensureSession(): Promise<void> {
  if (useSession.getState().accessToken) return;
  pending ??= (async () => {
    const res = await fetch(`${API_BASE}/auth/guest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: deviceId() }) });
    if (!res.ok) throw new Error('세션을 시작하지 못했어요');
    useSession.getState().setTokens((await res.json()) as AuthTokensDto);
  })().finally(() => (pending = null));
  return pending;
}

export const isMember = (u: UserDto | null) => Boolean(u && u.provider !== 'guest');
