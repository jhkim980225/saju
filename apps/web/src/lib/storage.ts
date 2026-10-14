/**
 * 키-값 저장소 어댑터. 웹은 localStorage, 앱(Capacitor)은 platform 계층에서
 * setStorageAdapter() 로 Preferences 기반 어댑터를 주입한다(세션 토큰은 Keychain/Keystore — native/storage.ts).
 * 동기 API 를 유지하기 위해 앱 어댑터는 시작 시 메모리로 미리 불러온다(hydrate).
 */
export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

const memory = new Map<string, string>();

const localAdapter: StorageAdapter = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      memory.set(key, value);
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      memory.delete(key);
    }
  },
};

let adapter: StorageAdapter = localAdapter;

export function setStorageAdapter(a: StorageAdapter) {
  adapter = a;
}

export const storage = {
  get: (key: string) => adapter.get(key),
  set: (key: string, value: string) => adapter.set(key, value),
  remove: (key: string) => adapter.remove(key),
  getJSON<T>(key: string): T | null {
    const raw = adapter.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  setJSON(key: string, value: unknown) {
    adapter.set(key, JSON.stringify(value));
  },
};

export const STORAGE_KEYS = {
  session: 'yd.session',
  deviceId: 'yd.deviceId',
  birthDraft: 'yd.birthDraft',
  lastReading: 'yd.lastReading',
  theme: 'yd.theme',
  fontScale: 'yd.fontScale',
  activeProfile: 'yd.activeProfile',
  pendingCheckout: 'yd.pendingCheckout',
  pushPrompted: 'yd.pushPrompted',
} as const;
