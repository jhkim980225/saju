import { defineConfig } from '@apps-in-toss/web-framework/config';

/**
 * 토스 미니앱(앱인토스) 설정 — `npm run build:toss` 의 `ait build` 가 읽는다.
 * 웹·Capacitor 빌드와는 관계가 없다.
 */
export default defineConfig({
  // 콘솔에 등록한 appName 과 같아야 업로드할 수 있다 (등록 뒤에는 바꿀 수 없다)
  appName: 'daldal-saju',
  brand: {
    // 버튼과 같은 밤하늘 남색
    primaryColor: '#1B2452',
  },
  // 토스 내비게이션 바가 뒤로가기·홈을 맡는다 — 화면 안에 자체 뒤로가기를 두지 않는다
  navigationBar: {
    withBackButton: true,
    withHomeButton: true,
  },
  webView: {
    bounces: false,
    overScrollMode: 'never',
  },
  // 링크 복사·사주 요약 '텍스트로 복사' — 토스 앱 안의 웹뷰는 브라우저 클립보드가 막힐 수 있어 setClipboardText 를 쓴다
  permissions: [{ name: 'clipboard', access: 'write' }],
  // vite build --mode toss | toss-qa 의 출력 폴더
  webBundleDir: 'dist-toss',
});
