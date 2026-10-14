/**
 * native/storage.ts 단위 테스트 — 세션 토큰의 보안 저장소(Keychain/Keystore) 이전·오류 처리.
 * Preferences 와 @aparajita/capacitor-secure-storage 는 Map 기반 가짜로 대체하고,
 * window.Capacitor.PluginHeaders 로 "네이티브 바이너리에 플러그인이 있음"을 흉내 낸다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPreferencesAdapter, type LegacyStorage, SECURE_STORE_MARKER } from '../storage';

const h = vi.hoisted(() => {
  const prefs = new Map<string, string>();
  const secure = new Map<string, string>();
  return {
    prefs,
    secure,
    fn: {
      setAccess: vi.fn<(access: number) => Promise<void>>(),
      getItem: vi.fn<(key: string) => Promise<string | null>>(),
      setItem: vi.fn<(key: string, value: string) => Promise<void>>(),
      removeItem: vi.fn<(key: string) => Promise<void>>(),
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

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  KeychainAccess: { whenUnlocked: 0, afterFirstUnlockThisDeviceOnly: 3 },
  SecureStorage: {
    setDefaultKeychainAccess: h.fn.setAccess,
    getItem: h.fn.getItem,
    setItem: h.fn.setItem,
    removeItem: h.fn.removeItem,
  },
}));

const KEY = 'yd.session';
const OLD = JSON.stringify({ accessToken: 'a0', refreshToken: 'r0', user: { id: 'u1' } });
const SESSION = JSON.stringify({ accessToken: 'a1', refreshToken: 'r1', user: { id: 'u1' } });
const NEXT = JSON.stringify({ accessToken: 'a2', refreshToken: 'r2', user: { id: 'u1' } });
const osError = () => Object.assign(new Error('An OS error occurred (-1)'), { code: 'osError' });

function setNative(withPlugin = true) {
  window.Capacitor = Object.assign(
    { isNativePlatform: () => true, getPlatform: () => 'android' as const },
    { PluginHeaders: withPlugin ? [{ name: 'SecureStorage', methods: [] }] : [] },
  );
}

/** 웹뷰 localStorage 대용 */
function legacyStorage(init: Record<string, string>): LegacyStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    removeItem: (k) => void data.delete(k),
  };
}

beforeEach(() => {
  h.prefs.clear();
  h.secure.clear();
  h.fn.setAccess.mockReset().mockResolvedValue(undefined);
  h.fn.getItem.mockReset().mockImplementation(async (key) => h.secure.get(key) ?? null);
  h.fn.setItem.mockReset().mockImplementation(async (key, value) => void h.secure.set(key, value));
  h.fn.removeItem.mockReset().mockImplementation(async (key) => void h.secure.delete(key));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  setNative();
});

afterEach(() => {
  delete window.Capacitor;
  vi.restoreAllMocks();
});

describe('기존 설치 → 보안 저장소 이전', () => {
  it('Preferences 의 세션을 보안 저장소로 옮기고 평문을 지운다 (업데이트로 로그아웃되지 않음)', async () => {
    h.prefs.set(KEY, SESSION);
    h.prefs.set('yd.deviceId', 'd1');
    let markerBeforeSecureWrite = false;
    h.fn.setItem.mockImplementation(async (key, value) => {
      markerBeforeSecureWrite = h.prefs.has(SECURE_STORE_MARKER);
      h.secure.set(key, value);
    });

    const a = await createPreferencesAdapter();
    expect(a.get(KEY)).toBe(SESSION); // hydrate 직후 동기 읽기
    expect(h.fn.setAccess).toHaveBeenCalledWith(3); // iOS afterFirstUnlockThisDeviceOnly
    await a.flush();
    expect(h.secure.get(KEY)).toBe(SESSION);
    expect(h.prefs.has(KEY)).toBe(false);
    expect(h.prefs.get('yd.deviceId')).toBe('d1'); // 비밀이 아닌 키는 그대로
    expect(h.prefs.get(SECURE_STORE_MARKER)).toBe('1');
    expect(markerBeforeSecureWrite).toBe(true); // 표시를 먼저 남겨야 다음 실행이 '새 설치'로 보지 않는다

    const b = await createPreferencesAdapter(); // 다음 실행 — 보안 저장소에서 읽는다
    expect(b.get(KEY)).toBe(SESSION);
  });

  it('보안 저장소 기록에 실패하면 평문을 남기고 다음 실행에 다시 옮긴다', async () => {
    h.prefs.set(KEY, SESSION);
    h.fn.setItem.mockRejectedValueOnce(osError());

    const a = await createPreferencesAdapter();
    expect(a.get(KEY)).toBe(SESSION);
    await a.flush();
    expect(h.secure.has(KEY)).toBe(false);
    expect(h.prefs.get(KEY)).toBe(SESSION);

    const b = await createPreferencesAdapter();
    expect(b.get(KEY)).toBe(SESSION);
    await b.flush();
    expect(h.secure.get(KEY)).toBe(SESSION);
    expect(h.prefs.has(KEY)).toBe(false);
  });

  it('보안 저장소 값이 기준 — 지우지 못하고 남은 평문 사본은 쓰지 않고 지운다', async () => {
    h.prefs.set(SECURE_STORE_MARKER, '1');
    h.prefs.set(KEY, OLD);
    h.secure.set(KEY, SESSION);

    const a = await createPreferencesAdapter();
    expect(a.get(KEY)).toBe(SESSION);
    await a.flush();
    expect(h.prefs.has(KEY)).toBe(false);
    expect(h.fn.setItem).not.toHaveBeenCalled();
  });

  it('첫 실행: localStorage 의 세션은 보안 저장소로 옮겨 지우고, 나머지 yd.* 는 Preferences 로 옮긴다', async () => {
    const legacy = legacyStorage({ [KEY]: SESSION, 'yd.fontScale': '1.2', 'other.key': 'x' });

    const a = await createPreferencesAdapter({ migrateFrom: legacy });
    expect(a.get(KEY)).toBe(SESSION);
    expect(a.get('yd.fontScale')).toBe('1.2');
    await a.flush();
    expect(h.secure.get(KEY)).toBe(SESSION);
    expect(h.prefs.has(KEY)).toBe(false);
    expect(legacy.data.has(KEY)).toBe(false); // 웹뷰에 평문 토큰을 남기지 않는다
    expect(h.prefs.get('yd.fontScale')).toBe('1.2');
    expect(h.prefs.has('other.key')).toBe(false);
  });

  it('첫 실행이 아니면 localStorage 에 남은 낡은 세션은 쓰지 않고 지운다', async () => {
    h.prefs.set(SECURE_STORE_MARKER, '1');
    h.prefs.set('yd.deviceId', 'd1');
    const legacy = legacyStorage({ [KEY]: OLD });

    const a = await createPreferencesAdapter({ migrateFrom: legacy });
    expect(a.get(KEY)).toBeNull();
    await a.flush();
    expect(legacy.data.has(KEY)).toBe(false);
    expect(h.secure.has(KEY)).toBe(false);
  });

  it('새 설치면 Keychain 에 남은 이전 설치의 세션을 쓰지 않고 지운다', async () => {
    h.secure.set(KEY, OLD); // iOS Keychain 은 앱 삭제 후에도 남는다

    const a = await createPreferencesAdapter();
    expect(a.get(KEY)).toBeNull();
    await a.flush();
    expect(h.secure.has(KEY)).toBe(false);
    expect(h.prefs.get(SECURE_STORE_MARKER)).toBe('1');

    a.set(KEY, SESSION); // 새로 로그인
    await a.flush();
    const b = await createPreferencesAdapter();
    expect(b.get(KEY)).toBe(SESSION);
  });
});

describe('실행 중 쓰기', () => {
  it('세션은 메모리에 즉시 반영되고 보안 저장소에만 기록된다. 다른 키는 Preferences 로', async () => {
    h.prefs.set(SECURE_STORE_MARKER, '1');
    const a = await createPreferencesAdapter();

    a.set(KEY, SESSION);
    a.set('yd.theme', 'dark');
    expect(a.get(KEY)).toBe(SESSION);
    expect(h.secure.has(KEY)).toBe(false); // 아직 기록 전
    await a.flush();
    expect(h.secure.get(KEY)).toBe(SESSION);
    expect(h.prefs.has(KEY)).toBe(false);
    expect(h.prefs.get('yd.theme')).toBe('dark');

    a.remove(KEY);
    expect(a.get(KEY)).toBeNull();
    await a.flush();
    expect(h.secure.has(KEY)).toBe(false);
  });

  it('로그아웃하면 옮기지 못한 평문 사본도 지워 다음 실행에 되살아나지 않는다', async () => {
    h.prefs.set(KEY, SESSION);
    h.fn.setItem.mockRejectedValueOnce(osError()); // 시작 시 이전 실패 → 평문 유지

    const a = await createPreferencesAdapter();
    a.remove(KEY);
    await a.flush();
    expect(h.prefs.has(KEY)).toBe(false);

    const b = await createPreferencesAdapter();
    expect(b.get(KEY)).toBeNull();
  });

  it('토큰 갱신 기록에 실패해도 앱은 계속되고, 낡은 평문 사본은 지운다(평문으로 되돌아가지 않음)', async () => {
    h.prefs.set(KEY, SESSION);
    h.fn.setItem.mockRejectedValue(osError()); // 계속 실패하는 기기

    const a = await createPreferencesAdapter();
    expect(a.get(KEY)).toBe(SESSION); // 업데이트 직후에는 로그인 유지
    a.set(KEY, NEXT); // refresh 토큰 회전
    expect(a.get(KEY)).toBe(NEXT);
    await expect(a.flush()).resolves.toBeUndefined();
    expect(h.prefs.has(KEY)).toBe(false); // 회전 전 토큰을 남기면 재사용 탐지로 전체 세션이 폐기된다
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('보안 저장소 오류', () => {
  it('읽기 오류(기기 복원 후 Keystore 키 유실 등)면 세션 없이 시작하고, 다음 로그인 때 항목을 새로 만든다', async () => {
    h.prefs.set(SECURE_STORE_MARKER, '1');
    h.secure.set(KEY, 'corrupted');
    h.fn.getItem.mockRejectedValueOnce(osError());

    const a = await createPreferencesAdapter();
    expect(a.get(KEY)).toBeNull(); // 다시 로그인하면 된다
    a.set(KEY, SESSION);
    await a.flush();
    expect(h.fn.removeItem).toHaveBeenCalledWith(KEY); // 손상된 항목을 지우고
    expect(h.secure.get(KEY)).toBe(SESSION); // 새로 기록
    expect(h.prefs.has(KEY)).toBe(false);

    const b = await createPreferencesAdapter();
    expect(b.get(KEY)).toBe(SESSION);
  });

  it('읽기 오류여도 아직 옮기지 못한 Preferences 세션이 있으면 그것으로 로그인을 유지하고 다시 옮긴다', async () => {
    h.prefs.set(SECURE_STORE_MARKER, '1');
    h.prefs.set(KEY, SESSION);
    h.fn.getItem.mockRejectedValueOnce(osError());

    const a = await createPreferencesAdapter();
    expect(a.get(KEY)).toBe(SESSION);
    await a.flush();
    expect(h.fn.removeItem).toHaveBeenCalledWith(KEY);
    expect(h.secure.get(KEY)).toBe(SESSION);
    expect(h.prefs.has(KEY)).toBe(false);
  });

  it('모든 호출이 실패하는 기기에서도 시작·로그인·로그아웃이 예외 없이 동작한다', async () => {
    h.prefs.set(SECURE_STORE_MARKER, '1');
    for (const f of [h.fn.setAccess, h.fn.getItem, h.fn.setItem, h.fn.removeItem]) f.mockRejectedValue(osError());

    const a = await createPreferencesAdapter();
    expect(a.get(KEY)).toBeNull();
    a.set(KEY, SESSION);
    expect(a.get(KEY)).toBe(SESSION); // 이번 실행 동안은 메모리로 유지
    a.remove(KEY);
    await expect(a.flush()).resolves.toBeUndefined();
    expect(h.prefs.has(KEY)).toBe(false); // 평문으로 대신 쓰지 않는다
  });

  it('바이너리에 플러그인이 없으면(cap sync 전 빌드) 플러그인을 부르지 않고 예전처럼 Preferences 를 쓴다', async () => {
    setNative(false);
    h.prefs.set(KEY, SESSION);

    const a = await createPreferencesAdapter();
    expect(a.get(KEY)).toBe(SESSION);
    a.set(KEY, NEXT);
    await a.flush();
    expect(h.prefs.get(KEY)).toBe(NEXT);
    for (const f of Object.values(h.fn)) expect(f).not.toHaveBeenCalled();
  });
});
