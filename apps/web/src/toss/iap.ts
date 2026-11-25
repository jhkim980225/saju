/**
 * 앱인토스 인앱 결제 SDK 연결. 지원하지 않는 환경(낮은 토스앱 버전, 토스 밖 브라우저)에서는 null → 상점이 '준비 중'으로 보인다.
 * 함수마다 isSupported() 로 버전을 확인하고, 지원하지 않는 함수는 비워 둔다.
 */
import { IAP } from '@apps-in-toss/web-framework';
import type { GetPendingOrdersResult, IapCreateOneTimePurchaseOrderOptions, IapGetProductItemListResult } from '@apps-in-toss/web-framework';

/** 앱에서 쓰는 인앱 결제 기능만 모은 모양 — 테스트에서는 가짜 객체를 넣는다 */
export interface IapLike {
  getProductItemList: () => Promise<IapGetProductItemListResult | undefined>;
  createOneTimePurchaseOrder: (params: IapCreateOneTimePurchaseOrderOptions) => () => void;
  getPendingOrders?: () => Promise<GetPendingOrdersResult | undefined>;
  completeProductGrant?: (args: { params: { orderId: string } }) => Promise<boolean | undefined>;
}

function sup(fn: unknown): boolean {
  try {
    const f = fn as { isSupported?: () => boolean } | undefined;
    return !!f && typeof f.isSupported === 'function' && f.isSupported() === true;
  } catch {
    return false;
  }
}

export function createSdkIap(): IapLike | null {
  try {
    if (!IAP || !sup(IAP.getProductItemList) || !sup(IAP.createOneTimePurchaseOrder)) return null;
    return {
      getProductItemList: () => IAP.getProductItemList(),
      createOneTimePurchaseOrder: (params) => IAP.createOneTimePurchaseOrder(params),
      getPendingOrders: sup(IAP.getPendingOrders) ? () => IAP.getPendingOrders() : undefined,
      completeProductGrant: sup(IAP.completeProductGrant) ? (args) => IAP.completeProductGrant(args) : undefined,
    };
  } catch {
    return null;
  }
}
