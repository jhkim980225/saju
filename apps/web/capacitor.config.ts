/// <reference types="@capacitor/app" />
/// <reference types="@capacitor/splash-screen" />
/// <reference types="@capacitor/status-bar" />
/// <reference types="@capacitor/keyboard" />
/// <reference types="@capacitor-firebase/messaging" />
import type { CapacitorConfig } from '@capacitor/cli';
import type { KeyboardResize } from '@capacitor/keyboard';

/**
 * 달빛사주 iOS/Android 앱 설정 — 절차는 docs/APP_PORTING.md.
 * 웹 빌드(dist)를 네이티브 웹뷰에 싣는다: `npm run build:app -w @saju/web` (vite build --mode app → cap sync)
 */
const NIGHT = '#0A1029'; // 밤하늘 남색 — 기본 테마 배경 (theme-color 와 동일)

const config: CapacitorConfig = {
  appId: 'kr.dalbitsaju.app',
  appName: '달빛사주',
  webDir: 'dist',
  // 웹뷰 로딩 전 흰 화면 대신 밤하늘 남색
  backgroundColor: NIGHT,
  // 서버 로그·웹 콜백 페이지에서 앱 웹뷰를 구분하기 위한 표식
  appendUserAgent: 'YeodeoljaApp',
  server: {
    // 웹뷰 origin = https://localhost (Android) / capacitor://localhost (iOS) — 서버 CORS_ORIGINS 기본값에 포함됨
    androidScheme: 'https',
    // 라이브 리로드: CAP_SERVER_URL=http://<PC IP>:5173 npx cap run android  (운영 빌드에는 넣지 말 것)
    ...(process.env.CAP_SERVER_URL ? { url: process.env.CAP_SERVER_URL, cleartext: true } : {}),
  },
  ios: {
    // index.html 이 viewport-fit=cover 이고 CSS 가 env(safe-area-inset-*) 로 직접 여백을 주므로 웹뷰 자동 인셋은 끈다(이중 여백 방지)
    contentInset: 'never',
    backgroundColor: NIGHT,
  },
  android: {
    backgroundColor: NIGHT,
    allowMixedContent: false,
  },
  experimental: {
    ios: {
      // iOS 기본 의존성 관리자는 SwiftPM — @capacitor-firebase/messaging 의 패키지 이름 충돌 회피(플러그인 README, CLI 8.4+)
      spm: { packageOptions: { '@capacitor-firebase/messaging': { symlink: true } } },
    },
  },
  plugins: {
    // 앱이 뜨면 initNative() 가 첫 렌더 후 SplashScreen.hide() 를 호출한다
    SplashScreen: {
      launchAutoHide: false,
      launchShowDuration: 0,
      launchFadeOutDuration: 200,
      backgroundColor: NIGHT,
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
    // edge-to-edge: 상태바 아래까지 웹뷰를 깔고 safe-area 로 여백 처리. 글자색은 테마에 맞춰 setStatusBar 로 동기화
    StatusBar: {
      overlaysWebView: true,
      style: 'DEFAULT',
    },
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
    Keyboard: {
      // 키보드가 올라오면 body 높이를 줄여 하단 CTA 가 키보드 위로 오게 한다
      resize: 'body' as KeyboardResize,
      resizeOnFullScreen: true,
    },
    FirebaseMessaging: {
      // iOS 포그라운드 수신 시에도 배너·소리·배지 표시
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    // @capgo/native-purchases — 서버 검증 전에 StoreKit 업데이트 스트림이 거래를 끝내지 않게 한다(src/native/purchases.ts)
    NativePurchases: {
      autoFinishTransactions: false,
    },
  },
};

export default config;
