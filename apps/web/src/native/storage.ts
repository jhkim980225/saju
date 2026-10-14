/**
 * Capacitor Preferences + 보안 저장소(Keychain/Keystore) 기반 StorageAdapter.
 * lib/storage 는 동기 API 이므로 시작 시 Preferences 의 모든 키와 보안 저장소의 비밀 키를 메모리로 읽어 오고(hydrate),
 * 이후 읽기는 메모리, 쓰기는 메모리 즉시 반영 + 비동기 기록(순서 보장 큐)으로 처리한다.
 *
 * 왜 localStorage 를 그대로 쓰지 않나: iOS WKWebView 의 localStorage 는 저장 공간 압박 시 OS 가 지울 수 있고,
 * 앱 삭제·재설치 전까지 확실히 유지되는 저장소(UserDefaults / SharedPreferences)가 세션·기기 ID 에 적합하다.
 *
 * 비밀 키(SECRET_KEYS — access·refresh 토큰이 든 세션)는 평문 Preferences 대신 보안 저장소에 둔다.
 * (@aparajita/capacitor-secure-storage — iOS Keychain / Android Keystore AES-GCM 키로 암호화한 SharedPreferences)
 *  - 기존 설치: Preferences(첫 실행이면 웹뷰 localStorage)의 세션을 보안 저장소로 옮긴 뒤 원본을 지운다.
 *    옮기기에 실패하면 원본을 남겨 다음 실행에 다시 시도한다 → 업데이트로 로그아웃되지 않는다.
 *  - 보안 저장소 오류(기기 복원 후 Keystore 키 유실 등)는 값이 없는 것으로 보고 계속한다 → 다시 로그인하면 된다.
 *    손상된 항목은 다음 쓰기 때 지우고 새로 만든다. 어떤 경우에도 예외를 밖으로 던지지 않는다.
 *  - 비밀 키는 Preferences 에 다시 쓰지 않는다. 단, 바이너리에 플러그인이 없으면(cap sync 전 빌드) 예전처럼 Preferences 를 쓴다.
 *  - Keychain 은 앱을 지워도 남으므로, 새 설치(Preferences 에 SECURE_STORE_MARKER 없음)면 이전 설치가 남긴 값을 버린다.
 */
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Preferences } from '@capacitor/preferences';
import { STORAGE_KEYS, type StorageAdapter } from '../lib/storage';

export interface PreferencesAdapter extends StorageAdapter {
  /** 대기 중인 Preferences·보안 저장소 쓰기가 모두 끝날 때까지 기다린다 */
  flush(): Promise<void>;
  /** hydrate 된 키 개수 (진단용) */
  readonly size: number;
}

/** 이전 웹 저장소(웹뷰 localStorage). 보안 저장소로 옮긴 비밀 키는 여기서도 지운다 */
export type LegacyStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'removeItem'>;

/** 최초 실행 시 이전 웹 저장소(localStorage)에서 옮겨 올 키 접두사 */
const MIGRATE_PREFIX = 'yd.';

/** 보안 저장소에 두는 키 — 세션(access·refresh 토큰 + 사용자) JSON 통째로 */
export const SECRET_KEYS: ReadonlySet<string> = new Set([STORAGE_KEYS.session]);

/** 이 설치에서 보안 저장소를 쓰기 시작했다는 표시(Preferences). 없으면 새 설치 또는 이전 버전에서 업데이트 */
export const SECURE_STORE_MARKER = 'yd.native.secureStore';

/** 네이티브 플러그인 이름 (iOS/Android 공통) */
const SECURE_PLUGIN = 'SecureStorage';

interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

type Enqueue = (op: () => Promise<unknown>, what?: string) => void;
type WriteSecret = (key: string, value: string | null) => void;

/**
 * 네이티브 바이너리에 플러그인이 들어 있는지. Capacitor.isPluginAvailable 은 JS 구현 등록만으로 true 가 되고,
 * 이 플러그인은 네이티브 구현 없이 호출하면 자기 자신을 끝없이 다시 부른다(웹뷰 정지) — 그래서 PluginHeaders 를 직접 본다.
 */
function hasNativePlugin(name: string): boolean {
  const cap = window.Capacitor as (typeof window.Capacitor & { PluginHeaders?: readonly { name: string }[] }) | undefined;
  return Boolean(cap?.PluginHeaders?.some((h) => h.name === name));
}

async function openSecretStore(): Promise<SecretStore | null> {
  if (!hasNativePlugin(SECURE_PLUGIN)) return null;
  try {
    // iOS: 첫 잠금 해제 이후엔 백그라운드 실행에서도 읽을 수 있고, 백업으로 다른 기기에 옮겨지지 않는다 (Android 는 무시)
    await SecureStorage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly);
  } catch (e) {
    console.warn('[native] Keychain 접근 옵션을 설정하지 못했어요', e);
  }
  return {
    // getItem/setItem 은 문자열을 그대로 저장한다 (get/set 은 JSON·날짜 변환을 한다)
    get: (key) => SecureStorage.getItem(key),
    set: (key, value) => SecureStorage.setItem(key, value),
    remove: (key) => SecureStorage.removeItem(key),
  };
}

export async function createPreferencesAdapter(opts: { migrateFrom?: LegacyStorage | null } = {}): Promise<PreferencesAdapter> {
  const memory = new Map<string, string>();
  const { keys } = await Preferences.keys();
  const entries = await Promise.all(keys.map(async (key) => [key, (await Preferences.get({ key })).value] as const));
  for (const [key, value] of entries) if (value !== null && value !== undefined) memory.set(key, value);

  let queue: Promise<void> = Promise.resolve();
  const enqueue: Enqueue = (op, what = 'Preferences 저장') => {
    queue = queue.then(op).then(
      () => undefined,
      (e: unknown) => console.warn(`[native] ${what} 실패`, e),
    );
  };

  const secure = await openSecretStore();
  if (!secure) console.warn('[native] 보안 저장소 플러그인이 없어 세션을 Preferences 에 둡니다 (npm run build:app 으로 cap sync 필요)');

  // 처음 앱을 연 경우(Preferences 비어 있음) 웹뷰 localStorage 에 남아 있던 yd.* 값을 옮긴다 (비밀 키는 아래에서 보안 저장소로)
  const legacy = opts.migrateFrom ?? null;
  const firstRun = keys.length === 0;
  if (firstRun && legacy) {
    try {
      for (let i = 0; i < legacy.length; i++) {
        const key = legacy.key(i);
        if (!key?.startsWith(MIGRATE_PREFIX) || (secure && SECRET_KEYS.has(key))) continue;
        const value = legacy.getItem(key);
        if (value === null) continue;
        memory.set(key, value);
        enqueue(() => Preferences.set({ key, value }));
      }
    } catch {
      /* localStorage 접근 불가 — 무시 */
    }
  }

  const writeSecret = secure ? await hydrateSecrets(secure, { memory, legacy, firstRun, enqueue }) : null;
  const write = (key: string, value: string | null) => {
    if (writeSecret && SECRET_KEYS.has(key)) writeSecret(key, value);
    else if (value === null) enqueue(() => Preferences.remove({ key }));
    else enqueue(() => Preferences.set({ key, value }));
  };

  return {
    get: (key) => memory.get(key) ?? null,
    set(key, value) {
      memory.set(key, value);
      write(key, value);
    },
    remove(key) {
      memory.delete(key);
      write(key, null);
    },
    flush: () => queue,
    get size() {
      return memory.size;
    },
  };
}

/**
 * 비밀 키를 보안 저장소에서 메모리로 읽고, 평문 사본(Preferences·localStorage)을 옮기거나 지우는 작업을 큐에 넣는다.
 * 반환값은 이후 비밀 키 쓰기 함수.
 */
async function hydrateSecrets(
  secure: SecretStore,
  ctx: { memory: Map<string, string>; legacy: LegacyStorage | null; firstRun: boolean; enqueue: Enqueue },
): Promise<WriteSecret> {
  const { memory, legacy, firstRun, enqueue } = ctx;
  /** 아직 평문 사본이 남아 있는 비밀 키 — 보안 저장소 기록이 끝나거나 값이 바뀌면 지운다 */
  const plain = new Map<string, { prefs: boolean; local: boolean }>();
  /** 읽기에 실패한(손상된) 비밀 키 — 다음 쓰기 전에 항목을 지워 새 키로 다시 만들게 한다 */
  const broken = new Set<string>();

  const dropPlain = async (key: string) => {
    const p = plain.get(key);
    if (!p) return;
    plain.delete(key);
    if (p.local) {
      try {
        legacy?.removeItem(key);
      } catch {
        /* 무시 */
      }
    }
    if (p.prefs) await Preferences.remove({ key });
  };

  const putSecret = async (key: string, value: string | null) => {
    if (value === null) {
      await secure.remove(key);
    } else {
      if (broken.has(key)) await secure.remove(key).catch(() => undefined);
      await secure.set(key, value);
    }
    broken.delete(key);
  };

  // Keychain 은 앱 삭제 후에도 남는다 → 새 설치면 이전 설치의 세션을 쓰지 않는다 (Android 는 삭제 시 Keystore 키도 지워진다)
  const freshInstall = !memory.has(SECURE_STORE_MARKER);
  const decided = await Promise.all(
    [...SECRET_KEYS].map(async (key) => {
      const fromPrefs = memory.get(key) ?? null;
      memory.delete(key);
      let fromLocal: string | null = null;
      try {
        fromLocal = legacy?.getItem(key) ?? null;
      } catch {
        /* 무시 */
      }
      if (fromPrefs !== null || fromLocal !== null) plain.set(key, { prefs: fromPrefs !== null, local: fromLocal !== null });

      let stored: string | null = null;
      try {
        stored = await secure.get(key);
      } catch (e) {
        console.warn('[native] 보안 저장소를 읽지 못했어요 — 저장된 세션 없이 계속합니다', e);
        broken.add(key);
      }
      const leftover = freshInstall && (stored !== null || broken.has(key));
      if (freshInstall) stored = null;
      // localStorage 사본은 첫 실행에만 쓴다 (그 뒤에 남아 있는 것은 Preferences 도입 전의 낡은 값)
      const value = stored ?? fromPrefs ?? (firstRun ? fromLocal : null);
      if (value !== null) memory.set(key, value);
      return { key, value, fromPlain: stored === null && value !== null, leftover };
    }),
  );

  if (freshInstall) {
    const leftovers = decided.filter((d) => d.leftover).map((d) => d.key);
    memory.set(SECURE_STORE_MARKER, '1');
    enqueue(async () => {
      for (const key of leftovers) {
        await secure.remove(key).catch((e: unknown) => console.warn('[native] 이전 설치의 보안 저장소 값을 지우지 못했어요', e));
        broken.delete(key);
      }
      await Preferences.set({ key: SECURE_STORE_MARKER, value: '1' });
    }, '보안 저장소 초기화');
  }

  for (const { key, value, fromPlain } of decided) {
    if (fromPlain && value !== null) {
      // 평문 → 보안 저장소. 실패하면 평문을 남겨 다음 실행에 다시 옮긴다
      enqueue(async () => {
        await putSecret(key, value);
        await dropPlain(key);
      }, '세션을 보안 저장소로 옮기기');
    } else {
      // 보안 저장소 값이 기준이거나 값이 없으면 평문 사본은 낡은 것 → 지운다
      enqueue(() => dropPlain(key));
    }
  }

  return (key, value) => {
    enqueue(() => putSecret(key, value), '보안 저장소 저장');
    // 남아 있던 평문 사본은 이제 낡은 값(회전 전 refresh 토큰) — 기록 성공 여부와 관계없이 지운다 (로그아웃 후 부활 방지)
    enqueue(() => dropPlain(key));
  };
}
