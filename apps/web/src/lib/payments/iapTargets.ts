/**
 * 앱 인앱결제의 끊긴 결제 복구용 대상 기록 — 스토어 결제 뒤 서버 검증 전에 앱이 꺼지면, 다음 실행 때 그 거래를
 * 어느 프로필(또는 리딩)에 지급할지 알아야 한다.
 *
 * 결제마다 한 건씩 쌓는다. 스토어 상품 ID 하나를 키로 쓰면 같은 상품을 다른 프로필로 연달아 사다 끊겼을 때 앞의 대상이
 * 덮어써지기 때문이다. 결제창이 영수증을 돌려주면 그 건에 영수증을 붙이고, 복구는 영수증이 같은 건을 먼저 쓰고
 * 없으면(영수증을 받기 전에 꺼진 경우) 같은 상품의 영수증 없는 건 가운데 가장 최근 것을 쓴다. 검증이 끝나면 지운다.
 */
import { storage } from '../storage';

export const IAP_TARGETS_KEY = 'yd.iapPendingTargets';
/** 30일 지난 기록은 버린다(스토어가 그보다 오래 끝나지 않은 거래를 남기는 경우는 없다고 본다) */
const TTL_MS = 30 * 86_400_000;

export interface IapTarget {
  /** 기록 하나를 가리키는 값(결제 시작 시각 + 난수) */
  id: string;
  storeId: string;
  profileId?: string;
  readingId?: string;
  receipt?: string;
  at: number;
}

const load = (): IapTarget[] => {
  const raw = storage.getJSON<unknown>(IAP_TARGETS_KEY);
  const list = Array.isArray(raw) ? (raw as IapTarget[]) : [];
  const now = Date.now();
  return list.filter((t) => t && typeof t.id === 'string' && typeof t.storeId === 'string' && typeof t.at === 'number' && now - t.at < TTL_MS);
};
const save = (list: IapTarget[]) => {
  if (list.length === 0) storage.remove(IAP_TARGETS_KEY);
  else storage.setJSON(IAP_TARGETS_KEY, list);
};

/** 결제를 시작하기 직전에 대상을 적는다. 반환한 id 로 영수증을 붙이거나 지운다 */
export function rememberIapTarget(storeId: string, target: { profileId?: string; readingId?: string }): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  save([...load(), { id, storeId, profileId: target.profileId, readingId: target.readingId, at: Date.now() }]);
  return id;
}

/** 스토어가 돌려준 영수증을 그 결제의 대상 기록에 붙인다(같은 영수증의 예전 기록은 지운다) */
export function attachIapReceipt(id: string, receipt: string) {
  save(load().filter((t) => t.id === id || t.receipt !== receipt).map((t) => (t.id === id ? { ...t, receipt } : t)));
}

/** 기록 지우기 — 사용자가 결제를 취소했거나 검증이 끝났을 때 */
export function forgetIapTarget(match: { id?: string; receipt?: string }) {
  save(load().filter((t) => !((match.id && t.id === match.id) || (match.receipt && t.receipt === match.receipt))));
}

/**
 * 복구할 거래의 대상 — 영수증이 같은 기록, 없으면 같은 상품의 영수증 없는 기록 가운데 가장 최근 것.
 * exclude 는 이번 복구에서 이미 다른 거래에 쓴 기록 id 다
 */
export function findIapTarget(storeId: string, receipt: string, exclude: ReadonlySet<string> = new Set()): IapTarget | undefined {
  const list = load().filter((t) => !exclude.has(t.id));
  return list.find((t) => t.receipt === receipt) ?? list.filter((t) => t.storeId === storeId && !t.receipt).sort((a, b) => b.at - a.at)[0];
}
