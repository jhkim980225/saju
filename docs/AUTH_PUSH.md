# 소셜 로그인 · 푸시 알림 설정 가이드

인증·알림팀 문서. 서버 구현은 `apps/api/src/modules/auth/oauth.ts`(소셜 로그인), `apps/api/src/modules/push/service.ts`(FCM)에 있습니다.
**키를 넣으면 동작하고, 키가 비어 있으면 해당 기능은 `501 NOT_CONFIGURED`를 반환합니다.**

---

## 1. 전체 흐름

### 웹 로그인 (Authorization Code)

```
프론트 ──GET /api/v1/auth/oauth/{provider}/authorize?redirectUri=…&state=…──▶ API
      ◀── { url } ─────────────────────────────────────────────────────────────
프론트 ──(location.href = url)──▶ 제공자 로그인/동의 화면
제공자 ──302 {redirectUri}?code=…&state=… (Apple 은 POST form_post)──▶ 프론트 콜백 페이지
프론트 ──POST /api/v1/auth/oauth/{provider}/callback { code, state, redirectUri, name? }──▶ API
API   ── 코드 교환 · id_token 서명 검증 · 프로필 조회 → upsertSocialUser → 토큰 발급
```

- `state`: 프론트가 8자 이상 난수를 만들어 `sessionStorage`에 저장하고, 콜백에서 받은 값과 **같은지 비교**한 뒤에만 callback API를 호출합니다(CSRF 방지).
- `redirectUri`: authorize 요청과 callback 요청에서 **글자 하나까지 같아야** 합니다. callback 요청에서 생략하면 서버가 `{PUBLIC_WEB_URL}/auth/callback/{provider}`를 씁니다.
- 실패하면 `401 UNAUTHORIZED`가 오고, 메시지는 "카카오 로그인에 실패했어요. 다시 시도해 주세요." 형태입니다. 원인은 서버 쪽 `err.cause`에만 남고 클라이언트에는 보내지 않습니다.
- 외부 호출 타임아웃은 10초입니다.

### 네이티브 앱 id_token (Apple · Google)

iOS의 Sign in with Apple이나 Android/iOS의 Google Sign-In SDK가 `idToken`을 직접 받았다면, 이 값을 callback body의 `idToken`에 넣어 보내면 됩니다. 이 경우 서버는 코드 교환을 하지 않고 JWKS로 서명, `iss`, `aud`, `exp`만 검증합니다.
현재 공용 스키마에서 `code`가 필수(`min(1)`)이므로 `code`에는 SDK가 준 authorizationCode를 넣고, 없으면 아무 문자열이나 넣습니다.

| 제공자 | 허용 `aud` |
|---|---|
| Apple | `APPLE_CLIENT_ID`(웹 Services ID), `APPLE_BUNDLE_ID`(iOS 번들 ID) |
| Google | `GOOGLE_CLIENT_ID`(**웹** 클라이언트 ID). 네이티브 SDK에서 `serverClientId`를 웹 클라이언트 ID로 설정하세요 |

---

## 2. Redirect URI

### 웹

```
{PUBLIC_WEB_URL}/auth/callback/{provider}
예) https://saju.example.com/auth/callback/kakao
    http://localhost:5173/auth/callback/kakao   ← 로컬 개발(Apple 제외)
```

각 제공자 콘솔에 **운영 도메인과 로컬 주소를 모두** 등록합니다. Apple은 HTTPS만 허용하고 localhost도 받지 않으므로 로컬에서는 ngrok 같은 터널을 씁니다.

### 앱 (Capacitor)

카카오·네이버·구글 웹 클라이언트는 커스텀 스킴(`myapp://`)을 Redirect URI로 받지 않습니다. 그래서 **HTTPS 웹 콜백을 그대로 쓰고 앱으로 되돌아오는 방식**을 권장합니다.

1. **권장 — Universal Links / App Links**
   - 앱이 `@capacitor/browser`(SFSafariViewController / Custom Tabs)로 authorize URL을 엽니다. `redirectUri`는 웹과 같은 `https://{도메인}/auth/callback/{provider}`입니다.
   - 도메인에 `/.well-known/apple-app-site-association`(iOS)과 `/.well-known/assetlinks.json`(Android)을 올리고 `/auth/callback/*` 경로를 앱에 연결합니다.
   - 앱은 `App.addListener('appUrlOpen', …)`로 code와 state를 받아 callback API를 호출합니다. 이때 `redirectUri`는 authorize 때와 같은 HTTPS 주소를 씁니다.
   - 콘솔에 추가로 등록할 Redirect URI가 없습니다.
2. **대안 — 웹 콜백 페이지에서 커스텀 스킴으로 넘기기**
   - 웹 콜백 페이지가 앱 안(Capacitor UA 또는 `?app=1` 같은 표식)에서 열렸다고 판단하면 `com.example.saju://auth/callback/{provider}?code=…&state=…`로 이동시킵니다.
   - Capacitor `App` 플러그인의 `appUrlOpen`으로 받습니다. Android `AndroidManifest.xml`의 intent-filter와 iOS `Info.plist`의 `CFBundleURLSchemes`에 스킴을 등록해야 합니다.
3. **네이티브 SDK** — Apple과 Google은 위의 idToken 방식을 씁니다. iOS 앱에 다른 소셜 로그인을 넣는다면 App Store 심사 지침 4.8에 따라 Sign in with Apple(또는 그에 준하는 로그인)을 함께 제공해야 합니다. 카카오·네이버 네이티브 SDK가 주는 access token 방식은 **현재 서버가 지원하지 않습니다**. code 방식(1번)을 쓰세요.

### Apple `form_post` 주의

`scope=name email`을 요청하면 Apple은 `response_mode=form_post`를 강제합니다. 그래서 Redirect URI로 **POST(form)** 요청이 들어오는데, 정적 호스팅된 SPA는 POST를 받지 못합니다.

해결책은 **POST를 받아 302로 넘겨주는 서버 엔드포인트**입니다(예: `POST /api/v1/auth/oauth/apple/form-post`, 라우트는 팀장 작업 범위).
- 이 엔드포인트가 받은 `code`, `state`, `user`(최초 로그인 때만 오는 JSON)를 웹 콜백으로 넘깁니다: `{PUBLIC_WEB_URL}/auth/callback/apple?code=…&state=…&name=…`
- Apple 콘솔의 Return URL에는 이 엔드포인트 주소를 등록합니다.
- 그 주소를 authorize와 callback 요청의 `redirectUri`로 똑같이 씁니다.

---

## 3. 제공자별 앱 등록

### 3-1. 카카오 — [Kakao Developers](https://developers.kakao.com)

1. **내 애플리케이션 → 애플리케이션 추가하기**에서 앱 이름과 사업자명을 입력합니다.
2. **앱 키 → REST API 키** 값을 `KAKAO_REST_API_KEY`에 넣습니다.
3. **카카오 로그인 → 활성화 설정 ON**으로 바꿉니다.
4. **Redirect URI**에 웹 콜백(운영과 로컬)을 등록합니다. 콘솔 개편 후에는 [플랫폼 키 → REST API 키] 상세 화면에 있습니다.
5. **동의항목**
   - 닉네임(`profile_nickname`)은 필수 동의로 둡니다.
   - 카카오계정(이메일)(`account_email`)은 선택 동의로 둡니다. 이메일 항목은 **비즈 앱 전환**이 필요할 수 있습니다.
   - 서버는 `scope=profile_nickname,account_email`을 요청합니다. **두 항목이 모두 설정돼 있지 않으면 `KOE205` 오류**가 납니다. 이메일을 받을 수 없는 상황이면 `oauth.ts`의 `KAKAO_SCOPE`에서 `account_email`을 빼세요.
6. **보안 → Client Secret**
   - 코드를 생성하고 활성화 상태를 "사용함"으로 둔 경우에만 `KAKAO_CLIENT_SECRET`을 설정합니다.
   - "사용함"인데 env가 비어 있으면 토큰 발급이 실패합니다(`KOE010`).
7. (선택) **플랫폼**에 Web 사이트 도메인, iOS 번들 ID, Android 패키지명과 키 해시를 등록합니다. 네이티브 SDK를 쓸 때만 필요합니다.

### 3-2. 네이버 — [NAVER Developers](https://developers.naver.com/apps)

1. **Application → 애플리케이션 등록**에서 사용 API로 **네이버 로그인**을 고릅니다.
2. **제공 정보**에서 회원이름, 이메일 주소, 별명을 고릅니다(필수 또는 추가).
3. **로그인 오픈 API 서비스 환경 → PC 웹**에 서비스 URL과 **Callback URL**(웹 콜백, 운영과 로컬)을 등록합니다.
4. 발급된 **Client ID / Client Secret**을 `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET`에 넣습니다.
5. "개발 중" 상태에서는 **멤버 관리에 등록한 네이버 ID만** 로그인할 수 있습니다. 출시 전에 **검수 요청**을 하세요.
6. 네이버는 토큰 요청에도 `state`가 필수입니다.
   - 라우트가 `state`를 넘기지 않으면 서비스가 임의 값으로 채웁니다.
   - 프론트가 보낸 `state`를 그대로 쓰려면 `routes.ts`의 `exchangeCode` 호출에 `state: body.state`를 추가하세요. 인터페이스는 이미 이 필드를 받습니다.

### 3-3. 구글 — [Google Cloud Console](https://console.cloud.google.com)

1. 프로젝트를 만들거나 고릅니다. Firebase 프로젝트와 같은 프로젝트를 써도 됩니다.
2. **Google 인증 플랫폼(OAuth 동의 화면)**
   - 앱 이름, 지원 이메일, 승인된 도메인을 입력합니다.
   - 범위는 `openid`, `email`, `profile`만 씁니다(비민감 범위라 검수가 가볍습니다).
   - 게시 상태가 "테스트"이면 테스트 사용자만 로그인할 수 있습니다. 출시 전에 **프로덕션으로 게시**하세요.
3. **클라이언트 → OAuth 클라이언트 ID 만들기 → 웹 애플리케이션**
   - **승인된 리디렉션 URI**에 웹 콜백(운영과 로컬)을 넣습니다.
   - 발급된 **클라이언트 ID / 보안 비밀**을 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`에 넣습니다.
4. (앱) 네이티브 Google Sign-In을 쓴다면 Android 클라이언트(패키지명과 SHA-1, 업로드 키와 Play 앱 서명 키 **둘 다**)와 iOS 클라이언트(번들 ID)를 추가합니다. 앱 SDK에는 `serverClientId = 웹 클라이언트 ID`를 설정합니다.
5. 서버는 `id_token`을 `https://www.googleapis.com/oauth2/v3/certs`로 검증합니다(`iss`=accounts.google.com, `aud`=`GOOGLE_CLIENT_ID`). 이메일은 `email_verified=true`일 때만 저장합니다.

### 3-4. Apple — [Apple Developer](https://developer.apple.com/account)

1. **Membership**에서 Team ID를 확인해 `APPLE_TEAM_ID`에 넣습니다.
2. **Identifiers → App IDs**
   - 앱 번들 ID(예: `com.example.saju`)에서 **Sign In with Apple** capability를 체크합니다.
   - 이 번들 ID를 `APPLE_BUNDLE_ID`에 넣습니다(IAP 설정과 같은 값). 네이티브 id_token의 `aud`로 쓰입니다.
3. **Identifiers → Services IDs → +**
   - 웹용 ID(예: `com.example.saju.web`)를 만들고 Sign In with Apple을 켭니다.
   - **Configure**에서 Primary App ID를 고르고, **Domains**(예: `saju.example.com`)와 **Return URLs**(HTTPS만, 2장의 form_post 엔드포인트)를 등록합니다.
   - 이 Services ID를 `APPLE_CLIENT_ID`에 넣습니다.
4. **Keys → +**
   - **Sign in with Apple**을 체크하고 Configure에서 Primary App ID를 고릅니다.
   - `.p8` 파일을 **한 번만** 내려받을 수 있습니다. Key ID를 `APPLE_KEY_ID`에, `.p8` 내용을 `APPLE_PRIVATE_KEY`에 넣습니다.
   - 서버는 이 키로 `client_secret`(ES256 JWT, `iss`=Team ID, `sub`=Services ID, `aud`=`https://appleid.apple.com`, 유효 1시간, 메모리 캐시)을 만듭니다.
5. **이름**은 **최초 로그인 때 한 번만** form_post의 `user` JSON(`{"name":{"firstName","lastName"}}`)으로 옵니다. 프론트가 이 값을 callback body의 `name`으로 넘겨야 닉네임에 반영됩니다.
   - 테스트하다 이름을 놓쳤다면 iPhone **설정 → Apple ID → 로그인 및 보안 → Apple로 로그인**에서 앱 연결을 끊고 다시 시도하세요.
6. **이메일 가리기**를 쓴 사용자는 `@privaterelay.appleid.com` 주소가 옵니다. 이 주소로 메일을 보내려면 **Services → Sign in with Apple for Email Communication**에 발신 도메인과 주소를 등록해야 합니다.
7. ⚠️ **회원 탈퇴 시 토큰 철회(revoke)**: App Store 정책상 Apple 로그인 회원이 탈퇴하면 `POST https://appleid.apple.com/auth/revoke`를 호출해야 합니다. 이를 위해 토큰 응답의 `refresh_token`을 저장하는 후속 작업이 필요합니다(스키마 변경이 필요해 이번 범위에서는 제외).

---

## 4. 환경 변수 (apps/api `.env`)

PEM 키(`APPLE_PRIVATE_KEY`, `FCM_PRIVATE_KEY`)는 줄바꿈을 `\n`으로 이스케이프한 **한 줄**로 넣어도 되고, 따옴표로 감싸도 됩니다. 서버가 정규화합니다.

| 키 | 필수 | 설명 |
|---|---|---|
| `PUBLIC_WEB_URL` | ● | 웹 주소. 기본 Redirect URI와 웹 푸시 링크 기준. 운영은 `https://` |
| `KAKAO_REST_API_KEY` | 카카오 | REST API 키 |
| `KAKAO_CLIENT_SECRET` | 선택 | 콘솔에서 Client Secret을 "사용함"으로 둔 경우 |
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 네이버 | |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 구글 | **웹 애플리케이션** 유형 클라이언트 |
| `APPLE_CLIENT_ID` | 애플 | Services ID (웹) |
| `APPLE_TEAM_ID` | 애플 | 10자리 Team ID |
| `APPLE_KEY_ID` | 애플 | Sign in with Apple 키의 Key ID |
| `APPLE_PRIVATE_KEY` | 애플 | `.p8` 내용 (`-----BEGIN PRIVATE KEY-----…`) |
| `APPLE_BUNDLE_ID` | 앱 | iOS 번들 ID. 네이티브 id_token `aud` 허용 (IAP와 공용) |
| `FCM_PROJECT_ID` | 푸시 | 서비스 계정 JSON의 `project_id` |
| `FCM_CLIENT_EMAIL` | 푸시 | 서비스 계정 JSON의 `client_email` |
| `FCM_PRIVATE_KEY` | 푸시 | 서비스 계정 JSON의 `private_key` (JSON 안의 `\n` 문자열을 그대로 복사해도 됨) |

프론트(`apps/web/.env`, 웹 푸시용):

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_VAPID_KEY=        # 클라우드 메시징 → 웹 푸시 인증서 → 키 쌍
```

---

## 5. 게스트 → 회원 전환

1. 앱을 처음 실행하면 `POST /api/v1/auth/guest { deviceId }`가 게스트 계정(`provider=guest`)과 토큰을 발급합니다. 같은 deviceId로 다시 호출하면 같은 게스트 계정이 돌아옵니다.
2. 게스트 상태에서도 프로필, 리포트, 구매 등 데이터가 이 계정에 쌓입니다.
3. 소셜 로그인 callback(또는 `POST /auth/signup`)을 호출할 때 **게스트 access token을 `Authorization: Bearer`로 붙이면** 됩니다(`optionalAuth`).
   - `upsertSocialUser`가 게스트 행을 **그대로 소셜 회원으로 바꿉니다**. id가 유지되므로 데이터도 그대로 남습니다.
   - 이때 가입 보너스 크레딧이 지급됩니다.
4. 응답으로 받은 새 access/refresh 토큰으로 교체하고, 이전 게스트 refresh 토큰은 버립니다.
5. 예외 동작
   - **이미 같은 소셜 계정으로 가입된 회원**이 있으면 그 계정으로 로그인만 되고, 게스트 데이터는 옮겨지지 않습니다. 데이터를 합칠지는 정책 결정이 필요합니다.
   - **같은 이메일을 쓰는 다른 계정**이 있으면 새 소셜 계정의 이메일을 비워 둡니다. 계정을 자동으로 합치지 않습니다.
   - 게스트 토큰 없이 로그인하면 새 회원이 만들어집니다.

---

## 6. 푸시 알림 (FCM HTTP v1)

### 6-1. Firebase 프로젝트

1. [Firebase 콘솔](https://console.firebase.google.com)에서 **프로젝트를 추가**합니다. 구글 로그인용 GCP 프로젝트에 연결해도 됩니다.
2. **프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성**으로 JSON을 받습니다.
   - `project_id`, `client_email`, `private_key`를 각각 `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`에 넣습니다.
   - 키 파일은 저장소에 커밋하지 마세요.
3. Google Cloud Console의 **API 및 서비스**에서 **Firebase Cloud Messaging API (V1)**가 사용 설정됐는지 확인합니다. 예전 Legacy API는 종료됐습니다.
4. 기본 `firebase-adminsdk-…` 서비스 계정은 그대로 동작합니다. 별도 계정을 만들 때는 **Firebase Cloud Messaging API 관리자**(`roles/firebasecloudmessaging.admin`) 역할을 줍니다.
5. 플랫폼별로 앱을 등록합니다.
   - **웹**: 웹 앱을 추가하고 `firebaseConfig` 값을 위의 `VITE_FIREBASE_*`에 넣습니다.
     - **클라우드 메시징 → 웹 푸시 인증서 → 키 쌍 생성**으로 만든 값을 `VITE_FIREBASE_VAPID_KEY`에 넣습니다.
     - 웹은 `public/firebase-messaging-sw.js` 서비스 워커가 필요합니다(프론트팀).
   - **Android**: 패키지명을 등록하고 `google-services.json`을 `android/app/`에 둡니다.
   - **iOS**: 번들 ID를 등록하고 `GoogleService-Info.plist`를 `ios/App/App/`에 둔 뒤, 6-2의 APNs 키를 업로드합니다.
6. 앱과 웹은 로그인 후 받은 FCM 토큰을 `POST /api/v1/push/tokens { token, platform }`으로 등록하고, 로그아웃할 때 `DELETE /api/v1/push/tokens`를 호출합니다.

### 6-2. iOS — APNs 인증 키 업로드

1. Apple Developer에서 **Keys → +**로 가서 **Apple Push Notifications service (APNs)**를 체크하고 `.p8`을 내려받습니다(Key ID 메모). Sign in with Apple 키와는 따로 만드는 것을 권장합니다.
2. Firebase 콘솔의 **프로젝트 설정 → 클라우드 메시징 → Apple 앱 구성**에서 **APNs 인증 키**로 `.p8`, Key ID, Team ID를 업로드합니다. 인증 키 하나로 개발용과 운영용을 모두 처리합니다.
3. App ID에 **Push Notifications** capability를 켭니다. Xcode의 Signing & Capabilities에서 **Push Notifications**와 **Background Modes → Remote notifications**를 추가합니다.
4. ⚠️ `@capacitor/push-notifications`는 iOS에서 **APNs 토큰**을 돌려줍니다. 서버는 FCM으로 보내므로 **FCM 등록 토큰**이 필요합니다.
   - `@capacitor-firebase/messaging`을 쓰거나 AppDelegate에서 Firebase Messaging을 연동해 FCM 토큰을 등록하세요.

### 6-3. 서버 동작

- **액세스 토큰**
  - 서비스 계정 키로 서명한 RS256 JWT를 `https://oauth2.googleapis.com/token`(scope `firebase.messaging`)에서 교환합니다.
  - 만료 1분 전까지 메모리에 캐시하고, 동시에 들어온 요청은 토큰 발급 한 번으로 합칩니다.
  - FCM이 401을 주면 토큰을 다시 발급받고 한 번 재시도합니다.
- **발송**
  - 토큰마다 `POST https://fcm.googleapis.com/v1/projects/{FCM_PROJECT_ID}/messages:send`를 호출합니다. 동시 발송은 20개까지입니다.
  - 메시지 구성은 다음과 같습니다.
    - `notification {title, body}`
    - `data`: `message.data`와 `link`
    - `webpush.fcm_options.link`: 링크를 `PUBLIC_WEB_URL` 기준 **HTTPS 절대 URL**로 바꾼 값. http(로컬)이면 생략합니다.
    - `android.priority=HIGH`, sound default
    - `apns`: priority 10, alert, sound default
  - 앱은 `data.link`를 읽어 라우팅합니다.
- **토큰 정리**: 응답이 `404` / `UNREGISTERED`인 토큰은 DB에서 바로 지웁니다. 일시 오류(5xx 등)는 실패로만 집계하고 토큰은 남겨 둡니다.
- **수신 동의**
  - `users.pushEnabled=false`(`PATCH /auth/me { pushEnabled: false }`)이거나 탈퇴한 사용자에게는 보내지 않습니다.
  - 정보통신망법 제50조에 따라 **광고성** 푸시는 별도 수신 동의, 야간(21시~08시) 추가 동의, "(광고)" 표기가 필요합니다. 순수 운세 안내가 아니라 상품 홍보가 들어가면 광고성으로 취급하세요.

```ts
const { push } = app.ctx.services;
await push.sendToUser(userId, { title: '리포트가 준비됐어요', body: '지금 확인해 보세요', link: '/reports/abc' });
// → { sent, failed, removed }

// 스케줄러(팀장 연결)에서 매일 아침 호출
await push.sendDailyFortuneDigest((userId) => {
  // 해당 사용자의 대표 프로필로 오늘의 운세 한 줄 생성. 보낼 게 없으면 null
  return { title: '오늘의 운세', body: '…', link: '/fortune/today' };
});
// → { users, skipped, sent, failed, removed }
```

`sendDailyFortuneDigest`는 수신 동의한 사용자 가운데 토큰이 있는 사용자만 대상으로 합니다. 그 사용자마다 `buildMessage`를 한 번 호출하고, 반환값이 null이거나 예외가 나면 그 사용자를 건너뜁니다.

---

## 7. 키 설정 후 점검 체크리스트

- [ ] 각 콘솔에 등록한 Redirect URI와 실제로 보내는 `redirectUri`가 **완전히 같은지** 확인했다(슬래시와 http/https까지).
- [ ] 카카오 동의항목(닉네임, 이메일)을 설정했다. Client Secret을 "사용함"으로 뒀다면 env에도 넣었다.
- [ ] 네이버 앱은 검수를 마쳤다. 검수 전에는 멤버만 로그인할 수 있다.
- [ ] 구글 OAuth 동의 화면을 프로덕션으로 게시했다.
- [ ] Apple: Return URL이 HTTPS이고 form_post를 받는 엔드포인트다. 이름 전달을 확인했다. 탈퇴 시 revoke를 처리할 계획이 있다.
- [ ] PEM 키를 `\n` 한 줄 형식으로 넣었고, 서버 기동 후 실제 로그인과 푸시가 1회 성공했다.
- [ ] iOS는 APNs 키를 Firebase에 업로드했고, 앱이 **FCM 토큰**(APNs 토큰 아님)을 등록한다.
- [ ] 운영 `PUBLIC_WEB_URL`이 `https://`다. http면 웹 푸시 클릭 링크가 빠진다.
