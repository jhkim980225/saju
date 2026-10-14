/**
 * Capacitor Preferences 기반 StorageAdapter.
 * lib/storage 는 동기 API 이므로 시작 시 Preferences 의 모든 키를 메모리로 읽어 오고(hydrate),
 * 이후 읽기는 메모리, 쓰기는 메모리 즉시 반영 + Preferences 비동기 기록(순서 보장 큐)으로 처리한다.
 *
 * 왜 localStorage 를 그대로 쓰지 않나: iOS WKWebView 의 localStorage 는 저장 공간 압박 시 OS 가 지울 수 있고,
 * 앱 삭제·재설치 전까지 확실히 유지되는 저장소(UserDefaults / SharedPreferences)가 세션·기기 ID 에 적합하다.
 * TODO(보안): refresh token 은 장기적으로 Keychain/Keystore(보안 저장소 플러그인)로 옮기는 것을 권장.
 */
import { Preferences } from '@capacitor/preferences';
import type { StorageAdapter } from '../lib/storage';

export interface PreferencesAdapter extends StorageAdapter {
  /** 대기 중인 Preferences 쓰기가 모두 끝날 때까지 기다린다 */
  flush(): Promise<void>;
  /** hydrate 된 키 개수 (진단용) */
  readonly size: number;
}

/** 최초 실행 시 이전 웹 저장소(localStorage)에서 옮겨 올 키 접두사 */
const MIGRATE_PREFIX = 'yd.';

export async function createPreferencesAdapter(opts: { migrateFrom?: Pick<Storage, 'length' | 'key' | 'getItem'> | null } = {}): Promise<PreferencesAdapter> {
  const memory = new Map<string, string>();
  const { keys } = await Preferences.keys();
  const entries = await Promise.all(keys.map(async (key) => [key, (await Preferences.get({ key })).value] as const));
  for (const [key, value] of entries) if (value !== null && value !== undefined) memory.set(key, value);

  let queue: Promise<void> = Promise.resolve();
  const enqueue = (op: () => Promise<unknown>) => {
    queue = queue.then(op).then(
      () => undefined,
      (e: unknown) => console.warn('[native] Preferences 저장 실패', e),
    );
  };

  // 처음 앱을 연 경우(Preferences 비어 있음) 웹뷰 localStorage 에 남아 있던 yd.* 값을 옮긴다
  const legacy = opts.migrateFrom;
  if (keys.length === 0 && legacy) {
    try {
      for (let i = 0; i < legacy.length; i++) {
        const key = legacy.key(i);
        if (!key?.startsWith(MIGRATE_PREFIX)) continue;
        const value = legacy.getItem(key);
        if (value === null) continue;
        memory.set(key, value);
        enqueue(() => Preferences.set({ key, value }));
      }
    } catch {
      /* localStorage 접근 불가 — 무시 */
    }
  }

  return {
    get: (key) => memory.get(key) ?? null,
    set(key, value) {
      memory.set(key, value);
      enqueue(() => Preferences.set({ key, value }));
    },
    remove(key) {
      memory.delete(key);
      enqueue(() => Preferences.remove({ key }));
    },
    flush: () => queue,
    get size() {
      return memory.size;
    },
  };
}
