/**
 * 플랫폼 감지·네이티브 연동 지점. Capacitor 앱에서 실행되면 window.Capacitor 가 존재한다.
 * 네이티브 기능(푸시, 공유, 햅틱, 상태바, 뒤로가기, 딥링크, IAP)은 src/native/* 에서 주입한다.
 */
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => 'ios' | 'android' | 'web';
}

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
  }
}

export function isNativeApp(): boolean {
  return Boolean(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.());
}

export function nativePlatform(): 'ios' | 'android' | 'web' {
  return (typeof window !== 'undefined' && window.Capacitor?.getPlatform?.()) || 'web';
}

/** 카카오톡·인스타그램·페이스북·네이버 인앱 브라우저 (결제/로그인 제한 안내용) */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /KAKAOTALK|Instagram|FBAN|FBAV|NAVER\(inapp|Line\//i.test(navigator.userAgent);
}

/** 네이티브 기능 훅 — 앱 계층이 등록, 웹에서는 no-op */
export interface NativeBridge {
  haptic?: (kind: 'light' | 'success') => void;
  share?: (data: { title: string; text: string; url: string }) => Promise<boolean>;
  setStatusBar?: (theme: 'light' | 'dark') => void;
  requestPush?: () => Promise<string | null>;
  /** 인앱결제 — 성공 시 서버 검증용 영수증 반환 */
  purchase?: (storeProductId: string) => Promise<{ receipt: string } | null>;
  openExternal?: (url: string) => Promise<void>;
}

export const native: NativeBridge = {};

export function registerNative(bridge: NativeBridge) {
  Object.assign(native, bridge);
}
