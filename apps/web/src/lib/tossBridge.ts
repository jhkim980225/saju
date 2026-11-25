/**
 * 토스 미니앱 빌드가 공용 화면에 끼워 넣는 지점. 이 파일은 토스 SDK 를 가져오지 않는다.
 * 토스 빌드에서는 src/toss/bootstrap.ts 가 첫 렌더 전에 실제 구현을 등록하고,
 * 웹·Capacitor 빌드에서는 아무도 등록하지 않으므로 기본값(그대로 통과)으로 동작한다.
 */
import type { ReactNode } from 'react';
import type { RouteObject } from 'react-router';

// ── 라우트: 토스 첫 버전에 없는 화면을 빼고 화면 틀을 바꾼다 (App.tsx)
type RouteTransform = (routes: RouteObject[]) => RouteObject[];
let routeTransform: RouteTransform = (routes) => routes;
export const registerRouteTransform = (fn: RouteTransform) => {
  routeTransform = fn;
};
export const applyRouteTransform = (routes: RouteObject[]) => routeTransform(routes);

// ── 오늘 탭: 내일부터의 운세를 보상형 광고로 미리 보기 (pages/TodayPage.tsx)
export interface FutureDayGate {
  /** 날짜를 고른다. 막힌 날이면 광고 안내를 띄우고, 열리면 apply 를 부른다 */
  select: (iso: string, apply: (iso: string) => void) => void;
  /** 화면에 함께 그릴 안내 시트 */
  sheet: ReactNode;
}
type UseFutureDayGate = (todayIso: string) => FutureDayGate;
const openGate: UseFutureDayGate = () => ({ select: (iso, apply) => apply(iso), sheet: null });
let futureDayGate: UseFutureDayGate = openGate;
/** 첫 렌더 전에 한 번만 등록한다(훅 순서가 바뀌지 않게) */
export const registerFutureDayGate = (fn: UseFutureDayGate) => {
  futureDayGate = fn;
};
export const useFutureDayGate: UseFutureDayGate = (todayIso) => futureDayGate(todayIso);

// ── 바텀시트: 열려 있는 동안 브라우저 히스토리 한 칸과 묶어, 토스 뒤로가기가 시트만 닫게 한다 (components/BottomSheet.tsx)
type UseSheetHistory = (open: boolean, onClose: () => void) => void;
let sheetHistory: UseSheetHistory = () => undefined;
/** 첫 렌더 전에 한 번만 등록한다(훅 순서가 바뀌지 않게) */
export const registerSheetHistory = (fn: UseSheetHistory) => {
  sheetHistory = fn;
};
export const useSheetHistory: UseSheetHistory = (open, onClose) => sheetHistory(open, onClose);

// ── 약관·개인정보 처리방침: 토스 미니앱은 토스용 문서를 보여 준다 (pages/MiscPages.tsx 의 LegalPage)
type LegalDocs = Record<string, { title: string; body: string[] }>;
let legalDocs: LegalDocs | null = null;
export const registerLegalDocs = (docs: LegalDocs) => {
  legalDocs = docs;
};
/** 등록된 문서가 없으면(웹·앱) undefined — 화면이 기본 문서를 쓴다 */
export const legalDocOverride = (doc: string) => legalDocs?.[doc];
