# 달빛사주 앱 포팅 가이드 (Capacitor 8 · iOS / Android)

앱팀 문서. 웹 프론트엔드(`apps/web`, React 19 + Vite 7)를 Capacitor 웹뷰에 실어 iOS·Android 앱으로 냅니다.
웹 코드는 그대로 쓰고, 앱에서만 필요한 기능은 `apps/web/src/native/` 가 `lib/platform.ts` 의 `NativeBridge` 계약에 맞춰 주입합니다.

- 관련 문서: [AUTH_PUSH.md](./AUTH_PUSH.md)(소셜 로그인·푸시 서버), [research/02 §7.14](./research/02-ui-ux-analysis.md)(앱 UX 원칙), [research/03](./research/03-pricing-payments-ads.md)(IAP·광고 정책)
- `apps/web/android/`, `apps/web/ios/` 는 **커밋 대상**입니다(팀장 결정 — Capacitor 권장). 아직 생성 전이므로 첫 `npx cap add` 후 §4 설정을 적용하고 커밋하세요.

---


## 검증 현황 (2026-10-12, 팀장)

| 항목 | 결과 | 방법 |
|---|---|---|
| 네이티브 프로젝트 생성 | ✅ `android/`, `ios/` 생성 · 플러그인 11개 연결 (2026-10-15 보안 저장소 추가로 12개) | `npx cap add android` / `npx cap add ios` |
| §4 네이티브 설정 적용 | ✅ AndroidManifest(App Links·커스텀 스킴·BILLING·AdMob 앱 ID·FCM 채널·알림 아이콘), Info.plist(AdMob 앱 ID·URL 스킴·SKAdNetwork·암호화 신고), AppDelegate(푸시 토큰 전달), PrivacyInfo.xcprivacy | AdMob 앱 ID 는 **Google 공식 테스트 ID** — 출시 전 실제 ID 로 교체 |
| Android 디버그 APK 빌드 | ✅ `app-debug.apk` 11.5MB (JDK 21 + Android SDK 36, Gradle 8.14.3) | `cd apps/web/android && ./gradlew assembleDebug` |
| APK 검사 | ✅ 패키지 `kr.dalbitsaju.app`, minSdk 24 / targetSdk 36, 권한(INTERNET·BILLING·POST_NOTIFICATIONS·AD_ID), 딥링크 intent-filter, 웹 자산 포함, 소스맵 제외 | `aapt dump badging / xmltree` |
| 에뮬레이터 실행 (Pixel 6 · Android 36) | ✅ 콜드 스타트 2~5초, 크래시 0건 — `google-services.json` 없이도 시작 시 종료되지 않음 | `adb install` → `am start` → `logcat -b crash` |
| 실제 백엔드 연동 (라이브 리로드) | ✅ 게스트 세션 생성 → 사주 입력·저장 → 오늘의 운세 표시, 네이티브 저장소(Preferences)에 세션 영속 | `CAP_SERVER_URL=http://10.0.2.2:5173` + WebView 원격 디버깅(CDP) |
| 네이티브 플러그인 초기화 | ✅ FirebaseMessaging 리스너, NativePurchases(`autoFinishTransactions:false`), StatusBar, SplashScreen 호출 확인 | logcat `Capacitor/Plugin` |
| 딥링크 | ✅ `kr.dalbitsaju.app://manse` → `/manse`, `kr.dalbitsaju.app://compatibility` → `/compatibility` | `adb shell am start -a VIEW -d …` |
| 하드웨어 뒤로가기 | ✅ 바텀시트 닫힘 → 탭 기록 역순 이동(궁합→마이→오늘) → 홈에서 앱 최소화 | `adb shell input tap/keyevent 4` |
| 세션 토큰 보안 저장소 (2026-10-15) | ✅ `assembleDebug` 성공(병합 Manifest 에 `fullBackupContent`·`dataExtractionRules`). **업데이트 이전**: 이전 버전 상태(Preferences 평문 `yd.session`)를 주입 → 첫 실행에 Keystore 암호문(`WSSecureStorageSharedPreferences.xml`, 평문 토큰 없음)으로 옮기고 Preferences 에서 삭제 → 콜드 재시작 후 마이 탭에 같은 회원 표시. **로그인 유지**: 새 설치 → 게스트 세션 생성 → 콜드 재시작 후 같은 사용자 ID, `/auth/guest` 재호출 없이 `GET /profiles` 200. iOS Keychain 은 미검증(macOS 필요) | Android 36 에뮬레이터, `run-as` 로 Preferences 주입, WebView CDP, 라이브 리로드(로컬 API) |
| iOS 빌드 | ⏳ macOS + Xcode 필요(이 저장소 개발 PC 는 Windows) → **`.github/workflows/ci.yml` 의 `ios` 잡이 macOS 러너에서 서명 없이 시뮬레이터 빌드**(`xcodebuild -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO`). Windows 에서는 SPM 플러그인 심볼릭 링크 생성 권한이 없어(`EPERM symlink`) `CapApp-SPM/Package.swift` 가 갱신되지 않음 → **macOS 에서 `npm run build:app:ios` 실행 시 자동 생성** | — |
| 실결제(IAP)·푸시 수신·소셜 로그인 | ⏳ 스토어 상품 등록·Firebase 프로젝트·각 콘솔 키 발급 후 실기기 확인 필요 (`docs/ENV_KEYS.md`) | — |

실기 검증 중 발견해 수정한 버그 2건:
1. 서버에 연결하지 못하면 탭 화면이 빈 화면으로 남음 → `useSessionGate` 로 오류 안내 + 재시도 버튼
2. http(비보안) 컨텍스트에서 `crypto.randomUUID` 미존재로 게스트 세션·OAuth state 생성 실패 → `lib/uuid.ts`(getRandomValues 대체)

### 팀장 연결 완료 (앱팀 요청 사항)
| 요청 | 반영 위치 |
|---|---|
| IAP 서버 검증 후 `finishPurchase()` | `apps/web/src/lib/payments/index.ts` (`startCheckout`) |
| 끊긴 결제 복구 `recoverUnfinishedPurchases()` | `lib/payments/index.ts` `recoverInAppPurchases()` + `App.tsx`(시작·복귀 시, 회원만) |
| 보상형 광고 → 서버 SSV 지급 | `components/RewardedAdCard.tsx` + API `GET /rewards/admob-ssv`(서명 검증·광고 단위 허용 목록·하루 3회) |
| 앱 소셜 로그인 redirectUri = `appWebOrigin()` + 외부 브라우저 | `pages/AuthPages.tsx` |
| OAuth state 없으면 실패(로그인 CSRF) | `pages/AuthPages.tsx` `OAuthCallbackPage` |
| 푸시 플랫폼 고정(android) 버그 | `pages/MyPage.tsx` → `nativePlatform()` |
| 로그아웃 시 푸시 토큰 해제 | `api.unregisterPush` + `MyPage.tsx` |
| `android/`·`ios/` 커밋 여부 | **커밋** (서명 키·google-services.json 등 비밀 파일만 `.gitignore`) |

### 빌드 스크립트
- `npm run build:app:android -w @saju/web` — Windows/macOS 공통
- `npm run build:app:ios -w @saju/web` — macOS 에서
- `npm run build:app -w @saju/web` — 두 플랫폼 모두 sync (macOS 권장)

## 0. 한눈에 보기

```
apps/web
├─ capacitor.config.ts          appId kr.dalbitsaju.app · appName 달빛사주 · webDir dist · 플러그인 설정
├─ resources/icon.svg           앱 아이콘 원본 1024×1024 (한지 바탕 + 인주색 낙관에 음각 초승달)
├─ resources/splash.svg         스플래시 원본 2732×2732
└─ src/native/
   ├─ index.ts                  initNative() + 팀장 연결용 export (플러그인 정적 import 없음 → 웹 번들 영향 최소)
   ├─ bootstrap.ts              (앱에서만 동적 import) 저장소 hydrate · 브리지 등록 · 뒤로가기 · 딥링크 · 스플래시
   ├─ storage.ts                Preferences 기반 StorageAdapter (시작 시 메모리로 hydrate) · 세션 토큰은 Keychain/Keystore(§0.3)
   ├─ navigation.ts             뒤로가기 규칙 · 딥링크 → 경로 변환 · pushState+popstate 라우팅
   ├─ push.ts                   FCM 권한·토큰·서버 등록·알림 탭 라우팅
   ├─ purchases.ts              IAP 구매 → 영수증 · finishPurchase · 미완료 거래 복구
   ├─ ads.ts                    AdMob 보상형(하루 3회) · 배너
   ├─ env.ts                    앱 빌드 환경 값 (VITE_*)
   └─ __tests__/                native.test.ts · storage.test.ts — vitest + jsdom (플러그인은 vi.mock)
```

시작 순서(`main.tsx`): `await initNative()` → `initTheme()` → `initAnalytics()` → React 렌더.
웹에서는 `initNative()` 가 즉시 끝나고, 앱에서는 다음을 합니다.

1. Preferences 의 모든 키 + 보안 저장소의 세션(`yd.session`)을 메모리로 읽어 `setStorageAdapter()` 로 교체 → `reloadSessionFromStorage()` → 테마 상태 재적용
   (처음 실행이면 웹뷰 localStorage 의 `yd.*` 값을 옮겨 옴. 이후 쓰기는 메모리 즉시 + Preferences·보안 저장소 비동기. 이전 버전의 평문 세션 이전은 §0.3)
2. `registerNative({ haptic, share, setStatusBar, openExternal, requestPush, purchase })`
3. Android 뒤로가기(`backButton`), 딥링크(`appUrlOpen` + `getLaunchUrl`) 리스너
4. FCM 토큰 갱신 리스너(서버 `/push/tokens` 등록), 알림 탭 → `data.link` 라우팅
5. IAP 자동 완료 끄기(`autoFinishTransactions: false`)
6. 첫 렌더 직후 `SplashScreen.hide()`

### 0.1 패키지 버전 (2026-10 기준 `npm view` 로 확인)

| 패키지 | 버전 | 용도 |
|---|---|---|
| `@capacitor/core` `@capacitor/ios` `@capacitor/android` / `@capacitor/cli`(dev) | ^8.5.3 | 런타임·플랫폼·CLI |
| `@capacitor/app` | ^8.1.2 | 뒤로가기, 딥링크, 최소화 |
| `@capacitor/preferences` | ^8.0.1 | 키-값 저장(UserDefaults / SharedPreferences) |
| `@aparajita/capacitor-secure-storage` | ^8.0.1 | 세션 토큰 보안 저장(iOS Keychain / Android Keystore AES-GCM) — §0.3 |
| `@capacitor/status-bar` `@capacitor/splash-screen` `@capacitor/keyboard` | ^8.0.4 / ^8.0.2 / ^8.0.6 | 상태바·스플래시·키보드 |
| `@capacitor/share` `@capacitor/haptics` `@capacitor/browser` | ^8.0.3 / ^8.0.2 / ^8.0.5 | 공유 시트·햅틱·인앱 브라우저 |
| `@capacitor-firebase/messaging` | ^8.5.2 | FCM 푸시 (iOS 도 FCM 토큰) |
| `@capgo/native-purchases` | ^8.9.2 | 인앱결제(StoreKit 2 / Play Billing) |
| `@capacitor-community/admob` | ^8.2.1 | AdMob 보상형·배너 |

설치 정책: 위 패키지들은 설치 스크립트가 없어 `npm install-scripts approve` 가 필요 없었습니다. `@capacitor/assets`(아이콘 생성기)는 `sharp` 를 쓰므로 프로젝트 의존성에 넣지 않고 필요할 때 `npx` 로 실행합니다(§10).

### 0.2 플러그인 선택 근거

**인앱결제: `@capgo/native-purchases`** (대안: `cordova-plugin-purchase`, RevenueCat)

| 기준 | @capgo/native-purchases ✅ | cordova-plugin-purchase | RevenueCat |
|---|---|---|---|
| Capacitor 8 네이티브 플러그인 | O (peer `@capacitor/core >=8`) | Cordova 호환 레이어로 동작, 전역 `CdvPurchase` 스토어 객체 | O |
| 우리 서버 검증 방식과 맞는 영수증 | iOS **StoreKit 2 `transactionId`/JWS**, Android **`purchaseToken`** 를 그대로 반환 → `/payments/iap/verify` 와 1:1 | iOS 기본이 앱 영수증(StoreKit 1 unified receipt) 중심, 자체 검증기(iaptic) 연동을 전제한 설계 | 영수증을 RevenueCat 서버가 소유. 우리 서버는 웹훅으로 간접 반영 |
| "서버 검증 후 완료" 제어 | `autoAcknowledgePurchases:false` + `finishTransaction` / `consumePurchase`, `getUnfinishedTransactions` 로 복구 | 가능(`verify()`→`finish()`) 하나 상태 머신 학습 비용 | 자동 처리(제어권 낮음) |
| 비용·의존 | 없음 (MPL-2.0) | 없음 | 매출 일정 비율 수수료, 웹 PG 결제분은 별도 연동 |

서버(`apps/api/src/modules/commerce/providers/iap.ts`)가 이미 App Store Server API·Play Developer API 로 직접 검증하고 거래 ID 로 멱등 처리하므로, 영수증을 그대로 넘겨주는 얇은 네이티브 플러그인이 가장 단순합니다.

**광고: `@capacitor-community/admob`** — Capacitor 진영의 사실상 표준 AdMob 플러그인. Capacitor 8 대응(8.2.x), 보상형·배너·전면·앱 오프닝, SSV(서버 측 보상 검증) 파라미터, UMP 동의, iOS ATT 상태 조회를 모두 지원합니다. Google Mobile Ads SDK 를 플러그인이 고정 버전으로 포함합니다.

**푸시: `@capacitor-firebase/messaging`** — `@capacitor/push-notifications` 는 iOS 에서 APNs 토큰을 돌려주지만 서버는 FCM HTTP v1 로 보내므로 FCM 토큰이 필요합니다(AUTH_PUSH §6-2). 이 패키지의 JS 진입점은 웹 구현용 `firebase/messaging` 을 동적 import 하므로 그대로 import 하면 Vite 가 `firebase` 패키지를 요구합니다. 앱에서는 네이티브 구현만 쓰므로 `push.ts` 에서 `registerPlugin('FirebaseMessaging')` 으로 프록시를 직접 만들고 타입만 패키지에서 가져옵니다.

**보안 저장소: `@aparajita/capacitor-secure-storage`** (대안: `capacitor-secure-storage-plugin`, Capawesome Secure Preferences, Ionic Identity Vault) — 2026-10-15 `npm view`·저장소 확인

| 기준 | @aparajita/capacitor-secure-storage ✅ | capacitor-secure-storage-plugin |
|---|---|---|
| Capacitor 8 | 8.0.0(2026-02) · 8.0.1(2026-09-23, Android `clear` 수정·빈 prefix 금지). `peerDependencies` 대신 `dependencies` 에 `@capacitor/core ^8.0.2` 등을 두지만 우리 8.5.3 으로 dedupe 됨(`npm ls` 확인) | 0.13.0(2026-01), peer `@capacitor/core >=8` |
| iOS | Keychain(KeychainSwift), **접근성 지정 가능** → `afterFirstUnlockThisDeviceOnly`, iCloud 동기화 끔(기본). **SwiftPM `Package.swift` 제공** | Keychain 접근성 `afterFirstUnlock` 고정(백업으로 다른 기기 이전), 미유지 라이브러리 SwiftKeychainWrapper |
| Android | 키별 Keystore AES-256-GCM 키 + 암호문은 SharedPreferences(`WSSecureStorageSharedPreferences`) | Keystore RSA/ECB/PKCS1 (deprecated `KeyPairGeneratorSpec` 경로 포함) |
| 오류 구분 | 없는 키는 `null`, OS 오류는 `code: 'osError'` 로 reject → "값 없음"과 "저장소 고장"을 구분해 복구 가능 | 없는 키도 reject("does not exist") |
| 유지 상태 | MIT, 활발(2026-09 커밋), 열린 이슈 2 | MIT, 열린 이슈 14 |

Capawesome Secure Preferences 는 후원자 전용 레지스트리(npm 미공개), Identity Vault 는 유료라 제외했습니다. `@capacitor/preferences` 는 암호화하지 않습니다(UserDefaults / SharedPreferences 평문).

### 0.3 세션 토큰 보안 저장 (`src/native/storage.ts`)

- **대상**: `yd.session`(access·refresh 토큰 + 사용자 JSON) 한 키. `lib/storage`·`lib/session` 의 동기 API 와 웹 동작은 그대로이고, 앱 어댑터 안에서만 저장 위치가 바뀝니다.
- **시작 시**: Preferences 전체 + 보안 저장소의 `yd.session` 을 함께 hydrate 합니다(읽기 1회 추가).
- **기존 설치 이전**: Preferences 에 평문 세션이 있으면(또는 첫 실행이면 웹뷰 localStorage 의 `yd.session`) 그 값으로 바로 로그인 상태를 유지하고, 보안 저장소 기록이 **성공한 뒤에** Preferences·localStorage 사본을 지웁니다. 실패하면 사본을 남겨 다음 실행에 다시 옮깁니다 → 업데이트로 로그아웃되지 않습니다.
- **이후 쓰기**: 세션은 보안 저장소에만 씁니다(Preferences 로 되돌아가지 않음). 값이 바뀌거나 로그아웃하면 아직 남은 평문 사본도 지웁니다 — 회전 전 refresh 토큰이 남아 다음 실행에 쓰이면 서버 재사용 탐지로 **전체 세션이 폐기**되기 때문입니다.
- **오류**: 보안 저장소 읽기 오류(기기 복원 후 Keystore 키 유실, Keychain 오류 등)는 "세션 없음"으로 계속합니다(사용자는 다시 로그인). 그 항목은 다음 쓰기 때 지우고 새 키로 다시 만듭니다. 쓰기 오류는 경고만 남기고 그 실행 동안 메모리로 유지합니다. 어떤 경우에도 예외가 `initNative()` 밖으로 나가지 않습니다.
- **재설치**: iOS Keychain 은 앱을 지워도 남습니다. Preferences 에 `yd.native.secureStore` 표시가 없으면(새 설치·이전 버전에서 업데이트) 보안 저장소에 남은 값을 버리고 표시를 먼저 기록합니다 → 재설치하면 로그아웃 상태로 시작(Android 와 동일).
- **플러그인이 없는 바이너리**(`cap sync` 전 빌드·옛 APK 에 라이브 리로드): `window.Capacitor.PluginHeaders` 에 `SecureStorage` 가 없으면 예전처럼 Preferences 에 둡니다. `Capacitor.isPluginAvailable()` 은 JS 등록만으로 true 이고, 이 플러그인은 네이티브 없이 호출하면 자기 자신을 끝없이 다시 불러 웹뷰가 멈추므로 쓰지 않습니다.

---

## 1. 사전 준비

| 항목 | iOS | Android |
|---|---|---|
| OS | **macOS** (Windows 에서는 iOS 빌드 불가) | Windows / macOS / Linux |
| IDE | **Xcode 26 이상** (App Store 제출은 최신 SDK 요구) | **Android Studio 최신 안정판** (AGP 8.13 을 지원하는 버전) |
| 언어/SDK | iOS 15.0 이상 타깃(Capacitor 8 최소), Swift Package Manager(기본, CocoaPods 불필요) | **JDK 21**(Android Studio 내장 JBR 사용 가능), compile/target SDK 36, minSdk 24 |
| 공통 | Node 22.13+ (`engines`), npm 11 | 〃 |
| 계정 | Apple Developer Program, App Store Connect | Google Play Console(개발자 등록) |
| 서비스 | Firebase(푸시), AdMob, 소셜 로그인 콘솔(AUTH_PUSH §3) | 〃 |

> 정확한 최소 버전은 출시 직전에 [Capacitor 공식 문서](https://capacitorjs.com/docs/getting-started/environment-setup)에서 다시 확인하세요. 위 값은 설치된 `@capacitor/ios`(deployment target 15.0)·`@capacitor/android`(AGP 8.13, SDK 36, Java 21)에서 확인한 값입니다.

---

## 2. 앱용 환경 변수

`npm run build:app` 은 `vite build --mode app` 을 실행하므로 `apps/web/.env.app`(+ `.env.app.local`)을 읽습니다.

| 변수 | 필수 | 설명 |
|---|---|---|
| `VITE_API_BASE_URL` | **필수** | API **절대 주소**(예: `https://api.dalbitsaju.kr/api/v1`). 앱 웹뷰 origin 은 `capacitor://localhost`(iOS) / `https://localhost`(Android)라서 상대 경로 `/api/v1` 은 실패합니다. 비어 있으면 앱 시작 시 콘솔 오류를 남깁니다. |
| `VITE_PUBLIC_WEB_URL` | **필수** | 웹 서비스 주소(예: `https://dalbitsaju.kr`). 소셜 로그인 `redirectUri` 기준(`appWebOrigin()`), 유니버설 링크/App Links 허용 호스트 |
| `VITE_DEEPLINK_HOSTS` | 선택 | 딥링크로 받을 추가 도메인(쉼표 구분, 예: `www.dalbitsaju.kr`) |
| `VITE_APP_URL_SCHEME` | 선택 | 추가 커스텀 스킴(예: `dalbitsaju`). `kr.dalbitsaju.app://` 는 항상 허용 |
| `VITE_ADMOB_UNIT_REWARDED_CHAT_IOS` / `_ANDROID` | 출시 시 | 보상형 광고 단위 ID. 비우면 Google **테스트** 단위로 동작 |
| `VITE_ADMOB_UNIT_BANNER_RESULT_IOS` / `_ANDROID` | 출시 시 | 결과 화면 배너 단위 ID. 비우면 테스트 단위 |
| `VITE_ADMOB_TESTING` | 선택 | `1` 이면 실제 단위 ID 로도 테스트 광고 요청(내부 테스트 빌드용) |

```dotenv
# apps/web/.env.app — VITE_* 는 앱 번들에 그대로 들어가는 공개 값입니다(비밀 키 금지)
VITE_API_BASE_URL=https://api.dalbitsaju.kr/api/v1
VITE_PUBLIC_WEB_URL=https://dalbitsaju.kr
VITE_APP_URL_SCHEME=dalbitsaju
VITE_ADMOB_UNIT_REWARDED_CHAT_IOS=ca-app-pub-XXXXXXXXXXXXXXXX/NNNNNNNNNN
VITE_ADMOB_UNIT_REWARDED_CHAT_ANDROID=ca-app-pub-XXXXXXXXXXXXXXXX/NNNNNNNNNN
VITE_ADMOB_UNIT_BANNER_RESULT_IOS=ca-app-pub-XXXXXXXXXXXXXXXX/NNNNNNNNNN
VITE_ADMOB_UNIT_BANNER_RESULT_ANDROID=ca-app-pub-XXXXXXXXXXXXXXXX/NNNNNNNNNN
```

`.env.app` 은 `.gitignore` 대상이 아닙니다. 공개 값만 넣으면 커밋해도 되고, 개인 테스트 값은 `.env.app.local`(무시됨)에 둡니다.

**서버 쪽(apps/api `.env`)**

- `CORS_ORIGINS` 기본값에 `capacitor://localhost`, `https://localhost` 가 이미 들어 있습니다. 운영에서 값을 덮어쓴다면 **두 origin 을 반드시 포함**하세요(`http://localhost` 는 라이브 리로드용).
- `APPLE_BUNDLE_ID=kr.dalbitsaju.app`(IAP 검증·Apple id_token `aud`), `GOOGLE_PLAY_PACKAGE_NAME=kr.dalbitsaju.app`, `APPLE_IAP_*`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `FCM_*` — §7, §8.

---

## 3. 단계별 빌드 명령

```bash
# 0) 의존성 (저장소 루트)
npm install

# 1) 앱용 웹 번들 — 타입 검사 → vite build --mode app → cap sync
npm run build:app -w @saju/web

# 2) 네이티브 프로젝트 생성 (최초 1회, apps/web 에서)
cd apps/web
npx cap add ios        # macOS 만
npx cap add android

# 3) 이후 웹 코드를 바꿀 때마다
npm run build:app      # (= tsc → vite build --mode app → cap sync)
npm run cap:sync       # 플러그인 추가·config 변경만 반영할 때

# 4) IDE 열기 → 서명·실행·Archive
npm run cap:open:ios
npm run cap:open:android
npm run cap:doctor     # 버전·환경 점검
```

- `cap sync` = `dist` 를 네이티브 프로젝트로 복사(copy) + 플러그인 네이티브 코드 반영(update). 플랫폼이 없으면 웹 복사만 하고 끝납니다.
- **라이브 리로드**(개발 중): PC 에서 `npm run dev -w @saju/web` 후
  `CAP_SERVER_URL=http://<PC의 LAN IP>:5173 npx cap run android` (iOS 는 `cap run ios`). 이 경우 API 는 Vite 프록시를 타므로 `VITE_API_BASE_URL` 없이도 동작합니다. 운영 빌드에는 `CAP_SERVER_URL` 을 넣지 마세요.
- **네이티브 프로젝트 관리 (결정됨)**: `ios/`·`android/` 를 소스로 커밋합니다(Info.plist, AndroidManifest, AppDelegate, 서명 설정 변경 이력 보존). `.gitignore` 에서 제외 항목을 제거했습니다. 서명 키(`*.jks`, `*.p12`)와 `google-services.json` 운영본 등 비밀 파일은 커밋하지 마세요.

---

## 4. 네이티브 프로젝트 설정 (cap add 직후 1회)

### 4.1 iOS (Xcode → `ios/App/App.xcodeproj` 또는 `npm run cap:open:ios`)

1. **Signing & Capabilities**
   - Bundle Identifier `kr.dalbitsaju.app`, Team 선택, Display Name `달빛사주`
   - `+ Capability`: **Push Notifications**, **Background Modes → Remote notifications**, **In-App Purchase**, **Associated Domains**(`applinks:dalbitsaju.kr`), (네이티브 Apple 로그인 시) **Sign in with Apple**
2. **Firebase**: Firebase 콘솔에서 iOS 앱(번들 ID `kr.dalbitsaju.app`) 등록 → `GoogleService-Info.plist` 를 `ios/App/App/` 에 넣고 Xcode 에서 App 타깃에 추가.
   ⚠ 이 파일 없이 실행하면 FirebaseMessaging 플러그인이 `FirebaseApp.configure()` 에서 **앱이 시작 즉시 종료**됩니다.
3. **AppDelegate.swift** — 푸시 토큰 전달 (플러그인 README)

   ```swift
   func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
       NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
   }
   func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
       NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
   }
   func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
       NotificationCenter.default.post(name: Notification.Name.init("didReceiveRemoteNotification"), object: completionHandler, userInfo: userInfo)
   }
   ```
4. **Info.plist** (`ios/App/App/Info.plist`, 바깥 `<dict>` 안)

   ```xml
   <!-- AdMob 앱 ID (광고 단위 ID 아님). ⚠ 없으면 SDK 초기화 시 앱이 종료된다 — 개발 중엔 테스트 앱 ID ca-app-pub-3940256099942544~1458002511 -->
   <key>GADApplicationIdentifier</key>
   <string>ca-app-pub-XXXXXXXXXXXXXXXX~NNNNNNNNNN</string>
   <key>SKAdNetworkItems</key>
   <array>
     <dict><key>SKAdNetworkIdentifier</key><string>cstr6suwn9.skadnetwork</string></dict>
     <!-- Google iOS 가이드의 나머지 SKAdNetwork ID 목록도 추가 -->
   </array>
   <!-- ATT 팝업을 띄울 경우에만 필요. 현재 코드는 ATT 를 요청하지 않고 비개인화 광고(npa)로 요청한다 -->
   <key>NSUserTrackingUsageDescription</key>
   <string>맞춤형 광고를 보여 드리는 데 사용돼요. 허용하지 않아도 모든 기능을 쓸 수 있어요.</string>
   <!-- 커스텀 스킴 딥링크 (kr.dalbitsaju.app:// , dalbitsaju://) -->
   <key>CFBundleURLTypes</key>
   <array>
     <dict>
       <key>CFBundleURLName</key><string>kr.dalbitsaju.app</string>
       <key>CFBundleURLSchemes</key><array><string>kr.dalbitsaju.app</string><string>dalbitsaju</string></array>
     </dict>
   </array>
   <key>CFBundleDevelopmentRegion</key><string>ko</string>
   <key>ITSAppUsesNonExemptEncryption</key><false/>
   ```
5. **Keychain(세션 토큰)**: 추가 Capability·entitlement 불필요(기본 액세스 그룹). 항목 접근성은 코드에서 `afterFirstUnlockThisDeviceOnly` 로 지정 — 재부팅 후 첫 잠금 해제 전에는 읽을 수 없고(Background Modes 로 그 사이 깨어나면 세션 없음으로 시작), 백업으로 다른 기기에 옮겨지지 않습니다(새 기기에서는 다시 로그인). SwiftPM 의존성(`keychain-swift`)은 macOS 에서 `npm run build:app:ios` 가 `CapApp-SPM/Package.swift` 에 추가합니다.
6. **Privacy Manifest**(`PrivacyInfo.xcprivacy`): Preferences 가 UserDefaults 를 쓰므로 Required Reason API `NSPrivacyAccessedAPICategoryUserDefaults` → 사유 `CA92.1` 을 선언합니다. 수집 데이터(이메일, 생년월일시, 구매 내역, 기기 ID)도 App Store Connect 의 "앱 개인정보" 라벨과 일치시킵니다.
7. (선택) **iOS 스와이프 뒤로가기**: 웹뷰 기본값은 꺼져 있습니다. 켜려면 `MainViewController: CAPBridgeViewController` 를 만들어 `capacitorDidLoad()` 에서 `webView?.allowsBackForwardNavigationGestures = true` 로 설정하고 Main.storyboard 의 클래스로 지정합니다. 바텀시트가 열린 상태에서는 스와이프가 페이지를 넘기므로 QA 로 확인하세요.

### 4.2 Android (`npm run cap:open:android`)

1. `android/app/build.gradle` 의 `applicationId` 가 `kr.dalbitsaju.app` 인지 확인(`cap add` 가 appId 로 생성).
2. **Firebase**: Android 앱(패키지 `kr.dalbitsaju.app`) 등록 → `google-services.json` 을 `android/app/` 에 둡니다. Capacitor 템플릿이 파일이 있을 때만 `com.google.gms.google-services` 플러그인을 적용합니다.
3. **`android/app/src/main/AndroidManifest.xml`** (`<application>` 안)

   ```xml
   <!-- AdMob 앱 ID. ⚠ 없으면 시작 즉시 종료 — 개발 중엔 ca-app-pub-3940256099942544~3347511713 -->
   <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="@string/admob_app_id" />
   <!-- FCM 기본 채널 = src/native/push.ts 의 ANDROID_CHANNEL_ID -->
   <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="yd_default" />
   <!-- 알림 아이콘: 투명 배경 + 흰색 단색 (Android Studio > New > Image Asset > Notification Icons 로 icon.svg 에서 생성) -->
   <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_yd" />
   ```

   `MainActivity` 의 `<activity>` 안에 딥링크 intent-filter 를 추가합니다.

   ```xml
   <!-- App Links (https) — assetlinks.json 검증 -->
   <intent-filter android:autoVerify="true">
     <action android:name="android.intent.action.VIEW" />
     <category android:name="android.intent.category.DEFAULT" />
     <category android:name="android.intent.category.BROWSABLE" />
     <data android:scheme="https" android:host="dalbitsaju.kr" />
   </intent-filter>
   <!-- 커스텀 스킴 -->
   <intent-filter>
     <action android:name="android.intent.action.VIEW" />
     <category android:name="android.intent.category.DEFAULT" />
     <category android:name="android.intent.category.BROWSABLE" />
     <data android:scheme="kr.dalbitsaju.app" />
     <data android:scheme="dalbitsaju" />
   </intent-filter>
   ```

   `<manifest>` 바로 아래: `<uses-permission android:name="com.android.vending.BILLING" />`(Billing 라이브러리가 병합하지만 명시 권장). `POST_NOTIFICATIONS`(Android 13+)는 FCM SDK 가 병합하고, 권한 요청은 `requestPush()` 가 합니다.
4. **`res/values/strings.xml`**: `<string name="admob_app_id">ca-app-pub-XXXXXXXXXXXXXXXX~NNNNNNNNNN</string>`
5. **서명**: 업로드 키 생성 → Play App Signing 사용. assetlinks.json 에 **업로드 키와 Play 앱 서명 키의 SHA-256 둘 다** 넣습니다(§5).
6. **백업 규칙(세션 토큰)**: `android:allowBackup="true"` 는 유지하되(기기 ID·테마 등 Preferences 복원) `android:fullBackupContent="@xml/backup_rules"`(Android 11 이하)·`android:dataExtractionRules="@xml/data_extraction_rules"`(12+)로 `WSSecureStorageSharedPreferences.xml` 을 클라우드 백업·기기 이전에서 제외합니다. Keystore 키는 백업되지 않아 암호문만 복원되면 쓸모없는 낡은 값이기 때문입니다(복원돼도 플러그인은 `null` 을 돌려주고 앱은 로그아웃 상태로 시작). 두 XML 은 함께 고치세요.
7. Android 15+ 는 edge-to-edge 가 강제됩니다. `capacitor.config.ts` 는 `StatusBar.overlaysWebView: true` + `SystemBars.insetsHandling: 'css'` 로 웹뷰를 상태바 아래까지 깔고, 웹 CSS 의 `env(safe-area-inset-*)`(`.safe-top`, `.safe-bottom`)로 여백을 줍니다. 상태바 글자색은 테마 변경 시 `native.setStatusBar` 가 맞춥니다.

---

## 5. 딥링크 — Universal Links / App Links / 커스텀 스킴

앱이 받는 링크는 `src/native/navigation.ts` 의 `resolveDeepLink()` 가 내부 경로로 바꾸고, `history.pushState` + `popstate` 로 react-router 에 전달합니다(라우터를 import 하지 않음, `history.state.idx` 를 라우터 형식으로 유지).

| 들어오는 링크 | 처리 |
|---|---|
| `https://dalbitsaju.kr/today` (유니버설 링크/App Links) | `/today` |
| `kr.dalbitsaju.app://auth/callback/kakao?code=…&state=…` | `/auth/callback/kakao?code=…&state=…` (host 가 첫 경로 조각) |
| 푸시 `data.link` = `/reports/abc` 또는 절대 URL | `/reports/abc` |
| 허용 목록 밖 경로·다른 도메인·모르는 스킴 | 무시 |

허용 경로: `/auth/callback/*`, `/payments/*`, `/today`, `/saju`, `/yearly/*`, `/compatibility`, `/ask`, `/my`, `/reports/*`, `/store`, `/manse`, `/result`, `/input`, `/login`, `/signup`, `/legal/*` (`/fortune/today` → `/today` 별칭). 새 화면을 딥링크로 열려면 `ALLOWED_PATHS` 에 추가하세요.
`/auth/callback/*`, `/payments/*` 로 돌아오면 인앱 브라우저(`Browser.close()`, iOS)를 자동으로 닫습니다. 콜드 스타트 링크는 `App.getLaunchUrl()` 로도 받고, 2초 안의 같은 URL 은 한 번만 처리합니다.

**apple-app-site-association** — `https://dalbitsaju.kr/.well-known/apple-app-site-association` (확장자 없음, `Content-Type: application/json`, **리다이렉트 없이 200**)

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["ABCDE12345.kr.dalbitsaju.app"],
        "components": [
          { "/": "/auth/callback/*", "comment": "소셜 로그인 복귀" },
          { "/": "/payments/*" },
          { "/": "/today" },
          { "/": "/reports/*" },
          { "/": "/saju*" },
          { "/": "/compatibility*" }
        ]
      }
    ]
  }
}
```

`ABCDE12345` 는 Apple Team ID. 랜딩(`/`)·약관 등 웹으로 보여 줄 페이지는 넣지 않습니다(앱 설치자가 웹 링크를 못 여는 문제 방지).

**assetlinks.json** — `https://dalbitsaju.kr/.well-known/assetlinks.json`

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "kr.dalbitsaju.app",
      "sha256_cert_fingerprints": [
        "AA:BB:…(Play 앱 서명 키 SHA-256)",
        "CC:DD:…(업로드 키 SHA-256)"
      ]
    }
  }
]
```

두 파일은 웹 호스팅에서 서빙합니다(예: `apps/web/public/.well-known/` 에 두면 Vite 가 그대로 복사 — 프론트팀/팀장 작업 범위). 호스팅이 SPA fallback 으로 `index.html` 을 돌려주지 않는지 꼭 확인하세요.

**테스트**

```bash
xcrun simctl openurl booted "https://dalbitsaju.kr/today"
xcrun simctl openurl booted "kr.dalbitsaju.app://reports/abc"
adb shell am start -W -a android.intent.action.VIEW -d "https://dalbitsaju.kr/today" kr.dalbitsaju.app
adb shell pm get-app-links kr.dalbitsaju.app        # verified 인지 확인
```

---

## 6. 소셜 로그인 (앱)

카카오·네이버·구글 웹 클라이언트는 커스텀 스킴 redirect 를 받지 않으므로 **웹과 같은 HTTPS 콜백**을 쓰고 앱으로 되돌아옵니다(AUTH_PUSH §2 "앱").

```
앱 ── state 생성·sessionStorage 저장 ──▶ api.oauthUrl(p, `${appWebOrigin()}/auth/callback/${p}`, state)
앱 ── native.openExternal(url) ──▶ SFSafariViewController / Custom Tabs 에서 제공자 로그인
제공자 ── 302 https://dalbitsaju.kr/auth/callback/{p}?code&state ──▶ (유니버설 링크/App Links) 앱 appUrlOpen
앱 ── openDeepLink: Browser.close() + /auth/callback/{p}?code&state 로 라우팅 ──▶ OAuthCallbackPage
OAuthCallbackPage ── state 비교 → api.oauthCallback(p, { code, state, redirectUri: 같은 HTTPS 주소 })
```

**팀장 연결 필요 (`src/pages/AuthPages.tsx`)**

```ts
import { appWebOrigin } from '@/native';
import { isNativeApp, native } from '@/lib/platform';

const origin = isNativeApp() ? appWebOrigin() : window.location.origin; // 앱 origin(capacitor://localhost)은 redirect 로 못 씀
const redirectUri = `${origin}/auth/callback/${p}`;
const { url } = await api.oauthUrl(p, redirectUri, state);
if (isNativeApp() && native.openExternal) await native.openExternal(url);
else window.location.assign(url);
// OAuthCallbackPage 의 redirectUri 도 같은 origin 으로 만들 것
```

- **유니버설 링크가 안 열리는 경우 대비**: 리다이렉트만으로는 iOS 가 유니버설 링크를 열지 않는 경우가 있습니다. 앱에서 시작한 로그인은 `state` 앞에 `app.` 을 붙이고, 웹 콜백 페이지가 (앱 밖 브라우저에서) `app.` state 를 보면 `kr.dalbitsaju.app://auth/callback/{p}?code=…&state=…` 로 이동하고 "앱으로 돌아가기" 버튼도 함께 보여 주세요. 앱은 같은 경로로 처리합니다.
- **보안**: 현재 `OAuthCallbackPage` 는 저장된 state 가 없으면 비교를 건너뜁니다. 딥링크로 외부에서 콜백 경로를 열 수 있으므로 **저장된 state 가 없으면 실패 처리**하도록 바꿔 주세요(로그인 CSRF 방지).
- Apple 심사 4.8: 카카오·네이버·구글 로그인을 넣으면 **Sign in with Apple** 도 제공해야 합니다(웹 방식으로도 가능, form_post 처리는 AUTH_PUSH §2).

---

## 7. 인앱결제 (IAP)

앱에서 디지털 콘텐츠는 IAP 로만 팝니다(Apple 3.1.1). `lib/payments/startCheckout()` 은 앱이면 이미 `native.purchase` → `api.verifyIap` 경로를 탑니다. **모든 상품은 소모성(consumable)** 으로 등록합니다(리포트는 프로필마다 다시 살 수 있어야 하므로 — research/03 §5.2).

### 7.1 등록할 상품 (`apps/api/src/modules/commerce/catalog.ts`)

| 서버 ID | 이름 | 가격(원) | App Store 상품 ID | Play 상품 ID | 유형 |
|---|---|---:|---|---|---|
| `report_saju_mini` | 첫 사주 미니 리포트 (계정당 1회) | 990 | `kr.saju.report.mini` | `report_saju_mini` | 소모성 |
| `report_saju_lifetime` | 평생 사주 정밀 리포트 | 9,900 | `kr.saju.report.lifetime` | `report_saju_lifetime` | 소모성 |
| `report_newyear_2027` | 2027 丁未년 신년운세 | 5,900 | `kr.saju.report.newyear2027` | `report_newyear_2027` | 소모성 |
| `report_compat` | 사주 궁합 리포트 | 5,900 | `kr.saju.report.compat` | `report_compat` | 소모성 |
| `bundle_newyear_2027` | 2027 신년 패키지 | 16,900 | `kr.saju.bundle.newyear2027` | `bundle_newyear_2027` | 소모성 |
| `chat_pack_10` | AI 상담 질문권 10회 | 3,900 | `kr.saju.chat.10` | `chat_pack_10` | 소모성 |
| `chat_pack_30` | AI 상담 질문권 30회 | 9,900 | `kr.saju.chat.30` | `chat_pack_30` | 소모성 |
| `report_love` 외 2차 상품 | (comingSoon) | — | 미정 | 미정 | — |
| `sub_plus_monthly` / `sub_plus_yearly` | 플러스 구독 (2차) | 6,900 / 59,000 | 미정 | 미정 | 자동 갱신 구독, 그룹 `plus` |

- App Store 상품 ID 는 **삭제해도 재사용할 수 없습니다.** 등록 전에 catalog 의 ID 를 확정하세요(번들 ID 와 접두사가 달라도 문제없음).
- 스토어 가격은 각 스토어의 원화 가격 포인트에서 고릅니다. 3,900·5,900원 포인트가 있는지 확인하고, 없으면 catalog 가격을 맞춥니다(research/03 §5.2).
- 앱에 스토어 ID 가 없는 상품은 `startCheckout` 이 "앱에서 아직 구매할 수 없어요" 오류를 냅니다. 앱에서는 이런 상품을 **목록에서 숨기는 것**을 권장합니다.

### 7.2 App Store Connect

1. **계약/세금/은행**(유료 앱 계약) 완료, **Small Business Program** 신청(수수료 15%).
2. 앱 → **수익화 → 앱 내 구입**: 위 표대로 "소모품(Consumable)" 생성, 가격·한국어 표시명·설명·심사용 스크린샷 입력.
3. **사용자 및 액세스 → 통합 → App Store Connect API → 앱 내 구입** 키 생성 → 서버 `APPLE_IAP_ISSUER_ID`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_PRIVATE_KEY`, `APPLE_BUNDLE_ID=kr.dalbitsaju.app`.
4. (권장) **App Store Server Notifications V2** URL 을 서버에 연결해 환불을 반영(서버 엔드포인트는 결제팀 TODO).
5. 테스트: Xcode StoreKit Configuration 파일(로컬) → 샌드박스 테스터 계정. 앱 심사는 샌드박스로 운영 서버를 호출하므로 서버의 "운영 → 샌드박스 재시도"가 필요합니다(이미 구현).
6. 첫 IAP 는 **앱 버전과 함께 심사 제출**해야 합니다(버전 페이지의 "앱 내 구입" 섹션에 추가).

### 7.3 Google Play Console

1. **결제 프로필** 생성(판매자 계정).
2. `com.android.vending.BILLING` 이 포함된 빌드를 **내부 테스트 트랙에 먼저 업로드**해야 상품을 만들 수 있습니다.
3. **수익 창출 → 제품 → 일회성 제품(인앱 상품)**: 위 표의 Play 상품 ID 로 생성·활성화. (소모 여부는 스토어가 아니라 앱이 `consumePurchase` 로 결정)
4. **설정 → API 액세스**: 서비스 계정 연결, 권한 "재무 데이터 보기, 주문 및 구독 관리" → 키 JSON 을 `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `GOOGLE_PLAY_PACKAGE_NAME=kr.dalbitsaju.app`.
5. (권장) **실시간 개발자 알림(RTDN)** Pub/Sub 토픽 → `GOOGLE_PLAY_RTDN_TOPIC`(환불·취소 반영, 결제팀 TODO).
6. **라이선스 테스터** 등록(테스트 카드로 결제, orderId 없음 → 서버가 토큰 해시로 대체).

### 7.4 앱 쪽 흐름과 연결 지점

```
native.purchase(storeId)          purchases.ts: purchaseProduct({ autoAcknowledgePurchases:false, isConsumable:false })
  → { receipt }                   iOS transactionId / Android purchaseToken (취소 시 null)
api.verifyIap({ … receipt })      서버가 스토어 API 로 검증·지급 (거래 ID 멱등)
finishPurchase(receipt)           iOS finishTransaction / Android consumePurchase(확인+소모)
```

- ⚠ **Google Play 는 3일 안에 확인(acknowledge)하지 않으면 자동 환불**합니다. 반대로 서버 검증 전에 소모하면 검증 실패 시 복구할 거래가 사라지므로, 반드시 **검증 성공 후** `finishPurchase` 를 호출합니다.
- **팀장 연결 (`src/lib/payments/index.ts`)**

  ```ts
  import { finishPurchase } from '@/native';
  …
  const purchased = await native.purchase(storeId);
  if (!purchased) throw new Error('결제를 취소했어요.');
  const result = await api.verifyIap({ platform, productId: storeId, receipt: purchased.receipt, profileId: input.profileId });
  await finishPurchase(purchased.receipt); // 실패해도 throw 하지 않음(다음 복구 때 재시도)
  return result;
  ```

- **복구**: 검증 중 앱 종료·네트워크 오류·iOS "구매 승인 요청(Ask to Buy)" 승인 등으로 끝나지 않은 거래는 로그인 상태에서 앱 시작·복귀 시 처리합니다.

  ```ts
  import { recoverUnfinishedPurchases } from '@/native';
  await recoverUnfinishedPurchases((p) => api.verifyIap({ ...p, profileId: storage.get(STORAGE_KEYS.activeProfile) ?? undefined }));
  ```

  Android 에서 같은 상품의 미소모 구매가 남아 `ITEM_ALREADY_OWNED` 가 나면 `purchase()` 가 그 영수증을 돌려줘 검증을 이어 갑니다.
- 서버는 **게스트 계정의 IAP 를 거부**합니다(`403 로그인이 필요해요`). 앱 결제 버튼은 로그인 후에만 활성화하세요.
- 소모성 상품은 "구매 복원" 의무 대상이 아닙니다. 웹에서 산 리포트·질문권은 같은 계정으로 로그인하면 보입니다(3.1.3(b)).

---

## 8. 푸시 (FCM)

서버 설정은 AUTH_PUSH §6. 앱 쪽 체크리스트:

1. Firebase 프로젝트에 iOS(`kr.dalbitsaju.app`) / Android(`kr.dalbitsaju.app`) 앱 등록 → `GoogleService-Info.plist` → `ios/App/App/`, `google-services.json` → `android/app/` (§4).
2. **APNs 인증 키(.p8)** 를 Firebase 콘솔(프로젝트 설정 → 클라우드 메시징 → Apple 앱 구성)에 업로드. Xcode 에 Push Notifications + Background Modes(Remote notifications).
3. JS 동작 (`src/native/push.ts`)
   - `native.requestPush()` — 권한 요청 → (Android) 채널 `yd_default` 생성 → **FCM 토큰** 반환. OS 권한 팝업 전에 프리프롬프트(무엇을·언제·얼마나 자주)를 화면에서 먼저 보여 주세요(UX §7.14-13). 첫 결과를 본 뒤에 요청합니다.
   - 시작 시 권한이 이미 있으면 토큰을 가져와 `api.registerPush(token, 'ios'|'android')` 로 등록. 토큰 갱신(`tokenReceived`)·로그인 계정 변경 시 재등록, 같은 사용자·토큰은 중복 등록하지 않습니다.
   - 알림 탭(`notificationActionPerformed`) → `data.link` 로 라우팅(§5).
4. **팀장 확인 필요**
   - `src/pages/MyPage.tsx` 의 `api.registerPush(token, 'android')` 가 플랫폼을 고정하고 있습니다 → `nativePlatform()` 값으로 바꿔 주세요(iOS 토큰이 android 로 등록됨).
   - 로그아웃 시 `DELETE /api/v1/push/tokens` 호출이 `api.ts` 에 없습니다(AUTH_PUSH §6-1-6).
   - Android 는 앱이 **포그라운드일 때 알림을 자동 표시하지 않습니다**. 필요하면 `notificationReceived` 에서 앱 내 토스트로 보여 주세요(iOS 는 `presentationOptions` 로 표시됨).
5. 광고성 푸시는 별도 동의·야간 동의·"(광고)" 표기(정보통신망법 제50조, AUTH_PUSH §6-3).

---

## 9. AdMob

1. AdMob 에서 iOS·Android 앱을 각각 만들고 **앱 ID**(`ca-app-pub-…~…`)를 Info.plist `GADApplicationIdentifier` / AndroidManifest `com.google.android.gms.ads.APPLICATION_ID` 에 넣습니다(§4). **앱 ID 가 없으면 시작 시 종료**되므로 개발 중에도 테스트 앱 ID 를 넣으세요.
2. 광고 단위: 보상형 `app_rewarded_chat`, 배너 `app_banner_result` (research/03 §5.7) → `.env.app` 의 `VITE_ADMOB_UNIT_*`. 비어 있으면 Google 테스트 단위 + `isTesting` 으로 요청합니다.
3. **app-ads.txt** 를 웹 도메인 루트(`https://dalbitsaju.kr/app-ads.txt`)에 두고, 스토어 등록정보의 개발자 웹사이트를 같은 도메인으로 맞춥니다.
4. **보상형 SSV**: AdMob 콘솔에서 보상형 단위에 SSV 콜백 URL(서버, 결제·광고팀 TODO)을 등록하면 `showRewardedAd()` 가 보내는 `ssv.userId`(서버 사용자 ID)·`customData` 가 콜백으로 옵니다. **질문권 지급은 서버가 SSV 로 확인한 뒤** 무상 버킷에 적립하세요(클라이언트 `true` 만 믿지 않기).
5. 사용법 (`@/native`)

   ```ts
   import { rewardedAdsRemaining, showRewardedAd, showBannerAd, removeBannerAd, onBannerSizeChanged } from '@/native';

   // AI 질문권 소진 시 — 사용자가 버튼을 눌렀을 때만 (자동 재생 금지)
   if ((await rewardedAdsRemaining()) > 0 && (await showRewardedAd({ ssvCustomData: `chat:${profileId}` }))) {
     await refetchWallet(); // 서버가 SSV 로 지급한 무상 질문권 반영
   }

   // 무료 결과 화면 진입/이탈 (유료 구매자·구독자에게는 띄우지 않음)
   useEffect(() => {
     void showBannerAd({ margin: 0 });
     const off = onBannerSizeChanged((h) => setBottomPadding(h));
     return () => { off(); void removeBannerAd(); };
   }, []);
   ```

   - `showRewardedAd()` 는 하루 3회(기기 현지 날짜, Preferences `yd.native.rewardedAds`)까지, **보상을 받은 경우에만** 횟수를 셉니다. 중도 닫기·로드 실패·웹은 `false`.
   - 배너는 네이티브 오버레이라 웹 레이아웃을 밀어내지 않습니다. 높이만큼 본문 하단 여백을 주세요.
   - 금지 구역: 생년월일 입력, 결제·체크아웃, 유료 리포트 뷰어, AI 채팅 입력창 주변(research/03 §5.7).
6. **동의**: iOS 는 ATT 를 요청하지 않고 상태가 `authorized` 가 아니면 비개인화 광고(`npa`)로 요청합니다. 맞춤 광고를 위해 ATT 를 띄우려면 프리프롬프트 후 `AdMob.requestTrackingAuthorization()` 을 호출하고 `NSUserTrackingUsageDescription` 을 넣으세요. EEA/영국에 배포하면 UMP 동의(`AdMob.requestConsentInfo`)가 필요합니다.

---

## 10. 아이콘 · 스플래시

원본: `apps/web/resources/icon.svg`(1024×1024, 한지 `#F7F3EC` 바탕 + 인주색 `#A63A2B` 낙관에 음각 초승달), `apps/web/resources/splash.svg`(2732×2732, 같은 낙관을 가운데 480px 에). 초승달은 폰트 없이 패스로 그려 렌더러·폰트 설치 여부와 무관하게 같게 나옵니다. `public/favicon.svg` 와 같은 낙관 모티프입니다.

[`@capacitor/assets`](https://github.com/ionic-team/capacitor-assets) 는 `icon-only` / `icon-foreground` / `icon-background` / `splash` / `splash-dark` 파일명을 읽으므로, 원본을 임시 폴더에 그 이름으로 복사해 생성합니다(플랫폼 추가 후, `apps/web` 에서).

```bash
cd apps/web
rm -rf .assets && mkdir .assets
cp resources/icon.svg   .assets/icon-only.svg          # iOS 아이콘 · Android 레거시 아이콘
cp resources/icon.svg   .assets/icon-foreground.svg    # Android 적응형 전경(16.7% 인셋 → 낙관이 안전 영역 안)
printf '%s' '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#F7F3EC"/></svg>' > .assets/icon-background.svg
cp resources/splash.svg .assets/splash.svg
# 다크 스플래시: 바탕(id="bg")만 먹밤색으로
sed 's/id="bg" width="2732" height="2732" fill="#F7F3EC"/id="bg" width="2732" height="2732" fill="#14130F"/' resources/splash.svg > .assets/splash-dark.svg
npx @capacitor/assets@3.0.5 generate --assetPath .assets --ios --android
rm -rf .assets
```

- 결과: iOS `ios/App/App/Assets.xcassets/AppIcon.appiconset`, `Splash.imageset`; Android `res/mipmap-*`(ic_launcher, 적응형 xml), `res/drawable*/splash.png`.
- `@capacitor/assets` 는 `sharp` 네이티브 바이너리를 받습니다. npm 11 설치 스크립트 정책으로 막히면 `npm install-scripts approve sharp` 후 다시 실행하거나, 정책이 없는 환경에서 생성해 결과 이미지만 커밋하세요.
- Android 12+ 시스템 스플래시는 "아이콘 + 배경색"만 씁니다(배경색은 `capacitor.config.ts` 의 `SplashScreen.backgroundColor`). 그 이후 Capacitor 스플래시는 `launchAutoHide:false` 라서 `initNative()` 가 첫 렌더 직후 숨깁니다.
- 알림 아이콘(Android)은 흰색 단색 + 투명 배경이어야 합니다. Android Studio **Image Asset → Notification Icons** 에서 `icon.svg` 로 `ic_stat_yd` 를 만듭니다.

---

## 11. 심사 대응

### 11.1 Apple 4.3(b) 포화 카테고리 · 4.2 최소 기능

운세(fortune telling)는 4.3(b) 에 포화 카테고리로 명시돼 있고, 웹을 감싸기만 한 앱은 4.2 로 거절될 수 있습니다. **"웹사이트 래퍼가 아니다"를 기능으로 보여 줘야** 합니다.

| 네이티브 가치 | 상태 |
|---|---|
| 푸시(오늘의 운세·리포트 완성), 알림 탭 딥링크 | ✅ 이번 작업(src/native/push.ts) |
| 시스템 공유 시트, 햅틱, 하드웨어 뒤로가기, 시트 닫기, 상태바·키보드 테마 동기화 | ✅ |
| 유니버설 링크/App Links, 인앱결제(StoreKit 2), 보상형 광고 | ✅ |
| 앱 저장소(Preferences, 세션 토큰은 Keychain/Keystore)에 세션·마지막 결과 보관 → 재방문 즉시 표시 | ✅ |
| **오프라인 만세력**: `@saju/core` 가 클라이언트에서 결정론적으로 계산 → 네트워크 없이 명식 표 | 🔶 오프라인 화면/캐시 정책 정리 필요 |
| **홈 화면 위젯 '오늘의 한 줄'** (iOS WidgetKit / Android Glance) | ⬜ 2차 — 네이티브 코드 필요, 심사 설득력 가장 큼 |
| **로컬 알림**(매일 아침 운세 리마인더, 오프라인 동작) — `@capacitor/local-notifications` | ⬜ 2차 |
| Dynamic Type 200% 대응, 다크 모드 | ✅ 웹 CSS(`--font-scale`, 테마) |

**심사 노트(App Review Information → Notes) 예시**

> 달빛사주 is not a generic horoscope app. It computes a person's Four Pillars (사주팔자) with a deterministic, open calculation engine that shows every correction step (solar term boundaries, true solar time), works offline for the chart itself, and uses the computed chart as structured input for its readings. Native features: daily push digest with deep links, home-screen widget (if shipped), haptics, share sheet, in-app purchases via StoreKit 2. Demo account: review@dalbitsaju.kr / ******** (purchases require sign-in).

- **데모 계정**을 반드시 제공합니다(IAP 는 로그인 필수).
- 운세 콘텐츠는 "오락·참고용" 고지를 결과 화면·약관에 둡니다.

### 11.2 계정 삭제 (Apple 5.1.1(v), Google Play 정책)

- 앱 안에서 찾기 쉬운 위치: **마이 탭 → 하단 "회원 탈퇴"** (`MyPage` 의 `deleteAccount` → `DELETE /auth/me`). 설정 깊숙이 숨기지 말고, 탈퇴 전 데이터 삭제 범위·구매 내역 처리 안내를 보여 주세요.
- Apple 로그인 회원 탈퇴 시 **토큰 철회(revoke)** 가 필요합니다(AUTH_PUSH §3-4-7, 서버 TODO).
- Google Play 는 앱 내 삭제 경로와 **별도로 웹에서 삭제를 요청할 수 있는 URL**(데이터 보안 양식)을 요구합니다(예: `https://dalbitsaju.kr/legal/delete-account`).

### 11.3 결제 관련 (3.1.1 / 3.1.3)

- 앱 안에서는 **외부 결제로 유도하는 버튼·링크·문구 금지**: 웹 PG 결제창, "웹에서 사면 더 싸요", 웹 가격 페이지 링크, 쿠폰·라이선스 코드로 유료 기능 해제 모두 불가. 한국 StoreKit External Purchase Entitlement 는 쓰지 않습니다(research/03 §5.6).
- `startCheckout` 은 앱이면 IAP 로만 갑니다. `native.openExternal` 로 결제 페이지를 열지 마세요(약관·고객센터 링크만).
- 웹에서 산 상품을 앱에서 보는 것은 허용(3.1.3(b))되나, **같은 상품을 IAP 로도 판매**해야 합니다.
- IAP 크레딧(질문권)은 만료될 수 없습니다 → 유상 질문권 유효기간 없음(서버 원장 정책과 일치).

### 11.4 기타

- 4.8: 서드파티 소셜 로그인 제공 시 Sign in with Apple 함께 제공.
- 개인정보: App Store "앱 개인정보" 라벨 / Play "데이터 보안" 양식을 실제 수집(이메일, 생년월일시, 구매 내역, 기기 ID, 광고 ID)과 일치. 개인정보처리방침 URL 필수.
- 연령 등급 설문: 운세 콘텐츠, 광고 포함, 인앱 구매 포함으로 답변.

---

## 12. 출시 전 체크리스트

**빌드·설정**
- [ ] `.env.app` 의 `VITE_API_BASE_URL` 이 **https 절대 주소**, `VITE_PUBLIC_WEB_URL` 설정
- [ ] 서버 `CORS_ORIGINS` 에 `capacitor://localhost`, `https://localhost` 포함, `APPLE_BUNDLE_ID`·`GOOGLE_PLAY_PACKAGE_NAME` = `kr.dalbitsaju.app`
- [ ] `npm run build:app -w @saju/web` 성공, `npx cap doctor` 정상
- [ ] 아이콘·스플래시 생성(§10), 라이트/다크 모두 확인
- [ ] 버전: iOS `CFBundleShortVersionString`/`CFBundleVersion`, Android `versionName`/`versionCode` 증가

**네이티브**
- [ ] `GoogleService-Info.plist` / `google-services.json` 배치, APNs 키 Firebase 업로드
- [ ] AdMob 앱 ID(Info.plist / Manifest) — 운영 ID 로 교체, `app-ads.txt` 게시
- [ ] Capabilities: Push, Background Modes, In-App Purchase, Associated Domains(, Sign in with Apple)
- [ ] `apple-app-site-association`, `assetlinks.json`(업로드 키 + 앱 서명 키 SHA-256) 게시, 링크 검증
- [ ] Privacy Manifest(UserDefaults CA92.1), 앱 개인정보 라벨 / 데이터 보안 양식
- [ ] Android 백업 규칙(`backup_rules.xml`·`data_extraction_rules.xml`)이 Manifest 에 연결됨
- [ ] Android 알림 아이콘 `ic_stat_yd`, 채널 `yd_default` meta-data

**기능 QA (실기기)**
- [ ] 첫 실행 → 게스트 세션 → 앱 재시작 후 세션 유지(Keychain/Keystore)
- [ ] 이전 버전(Preferences 세션) 설치 위에 업데이트 → 로그인 유지, Preferences 에서 `yd.session` 삭제 확인
- [ ] 앱 삭제 → 재설치 → 로그아웃 상태로 시작(iOS Keychain 잔여 세션 무시)
- [ ] 라이트/다크 전환 시 상태바 글자색, 키보드 올라올 때 하단 CTA 위치
- [ ] Android 뒤로가기: 시트 닫힘 → 이전 화면 → 홈(`/today`)에서 앱 최소화
- [ ] 딥링크: 유니버설 링크·커스텀 스킴·콜드 스타트·푸시 탭
- [ ] 소셜 로그인 4종(인앱 브라우저 → 앱 복귀, 브라우저 자동 닫힘)
- [ ] IAP: 샌드박스/라이선스 테스터로 구매 → 지급 → `finishPurchase`(Play 콘솔에서 "확인됨/소모됨") → 같은 상품 재구매 가능
- [ ] IAP 복구: 검증 직전 앱 강제 종료 → 재실행 후 `recoverUnfinishedPurchases` 로 지급
- [ ] 보상형 광고: 끝까지 시청 시만 지급, 하루 3회 후 버튼 비활성, 다음 날 초기화
- [ ] 결과 화면 배너가 본문·탭바를 가리지 않음, 유료 사용자 비노출
- [ ] 계정 삭제 동작, 앱 내 외부 결제 유도 문구 없음

---

## 13. 팀장 연결 지점 요약

| 위치 | 할 일 |
|---|---|
| `src/lib/payments/index.ts` | `api.verifyIap` 성공 직후 `await finishPurchase(purchased.receipt)` (§7.4) |
| 앱 시작/복귀(로그인 상태) | `recoverUnfinishedPurchases(p => api.verifyIap({ ...p, profileId }))` (§7.4) |
| AI 질문권 소진 UI | "광고 보고 1회 추가" → `showRewardedAd()` + 서버 SSV 지급 (§9) |
| 무료 결과 화면 | `showBannerAd` / `removeBannerAd` / `onBannerSizeChanged` (§9) |
| `src/pages/AuthPages.tsx` | 앱이면 `appWebOrigin()` 기준 redirectUri + `native.openExternal` (§6), state 없으면 실패 처리 |
| `src/pages/MyPage.tsx` | `registerPush(token, 'android')` → `nativePlatform()` (§8) |
| `src/lib/api.ts` | 로그아웃 시 푸시 토큰 삭제 API (§8) |
| 상점·페이월 | 앱에서 스토어 ID 없는 상품 숨김, 게스트는 로그인 후 결제 (§7.1, §7.4) |
