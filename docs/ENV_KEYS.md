# 환경 변수 · 외부 API 키 목록

> 모든 외부 연동은 **"키만 넣으면 동작"**하도록 껍데기가 구현되어 있습니다.
> 키가 비어 있으면 해당 기능은 **목업/규칙 기반으로 대체**되거나 `501 NOT_CONFIGURED`(어떤 키가 필요한지 메시지에 표시)를 반환하므로, 키 없이도 전체 서비스를 로컬에서 실행·테스트할 수 있습니다.
>
> - 서버 키: `apps/api/.env` (예시: `apps/api/.env.example`)
> - 프론트 공개 키: `apps/web/.env` (예시: `apps/web/.env.example`) — **`VITE_` 로 시작하는 값은 브라우저에 노출**되므로 비밀 키를 절대 넣지 마세요.
> - 현재 어떤 연동이 켜져 있는지: 서버 기동 로그의 `미설정 연동:` 줄, 또는 `GET /api/v1/config`

## 1. 출시 전 반드시 설정 (운영 필수)

| 키 | 위치 | 용도 | 발급/설정 | 없으면 |
|---|---|---|---|---|
| `JWT_ACCESS_SECRET` | api | 액세스 토큰 서명 | `openssl rand -base64 48` (32자 이상) | 개발용 기본값 사용, **운영에서는 기동 실패** |
| `JWT_REFRESH_SECRET` | api | 리프레시 토큰 | 위와 동일(다른 값) | 위와 동일 |
| `PUBLIC_WEB_URL` | api | 결제·소셜로그인 리다이렉트 기준 주소 | 운영 웹 도메인 (https) | `http://localhost:5173` |
| `CORS_ORIGINS` | api | 허용 오리진 | 웹 도메인 + `capacitor://localhost,https://localhost` | 로컬 기본값 |
| `PAYMENT_PROVIDER` | api | 결제사 선택 | **`groble`**(2026-10-15 결정). 대안 `toss`·`portone` | `mock` — **운영에서는 기동 실패** |
| `VITE_API_BASE_URL` | web | API 주소 | 운영 API 절대 주소 (앱 빌드는 필수) | 같은 출처 `/api/v1` |

## 2. 결제 (웹은 그로블 — 2026-10-15 사용자 결정. 토스·포트원 연동은 대안으로 남겨 둠)

| 키 | 위치 | 용도 | 발급처 | 없으면 |
|---|---|---|---|---|
| `GROBLE_WEBHOOK_SECRET` | api | 그로블 웹훅 서명 검증 — 결제 완료·환불을 이걸로만 확정 | [그로블](https://www.groble.im) > 내 스토어 > 연동 > 웹훅 등록 시 발급(한 번만 보여 줌) | `/orders` 501 |
| `GROBLE_PRODUCT_LINKS` | api | 우리 상품 ID → 그로블 결제창 링크(`상품ID=링크`, 콤마 구분). 결제창 가격 = `catalog.ts` 판매가 | 그로블 > 결제창 만들기 > 링크 복사 (`docs/PAYMENTS.md` §3.5) | `/orders` 501, 연결 안 된 상품만 501 |
| `TOSS_CLIENT_KEY` | api(+web `VITE_TOSS_CLIENT_KEY`) | 결제창 호출(공개 키 `gck_`/`ck_`) | [토스페이먼츠 개발자센터](https://developers.tosspayments.com) > API 키 | `/orders` 501 |
| `TOSS_SECRET_KEY` | api | 결제 승인·취소(`gsk_`/`sk_`) | 위와 동일 | 승인 501 |
| `TOSS_WEBHOOK_SECRET` | api | (예비) 토스 결제 웹훅은 서명이 없어 재조회로 검증 | — | 무관 |
| `PORTONE_STORE_ID` / `PORTONE_CHANNEL_KEY` | api | 포트원 결제창 파라미터 | [포트원 콘솔](https://admin.portone.io) > 결제 연동 | 501 |
| `PORTONE_API_SECRET` | api | 결제 조회·취소 | 포트원 콘솔 > V2 API Secret | 501 |
| `PORTONE_WEBHOOK_SECRET` | api | 웹훅 서명 검증(`whsec_`) | 포트원 콘솔 > 웹훅 | 웹훅 무시 |
| `APPLE_IAP_ISSUER_ID` / `APPLE_IAP_KEY_ID` / `APPLE_IAP_PRIVATE_KEY` / `APPLE_BUNDLE_ID` | api | iOS 인앱결제 검증(App Store Server API) + App Store Server Notifications V2 수신(환불 회수) | App Store Connect > 사용자 및 액세스 > 통합 > 인앱 구매 키 | iOS 결제·Apple 알림 501 |
| `APPLE_IAP_ENVIRONMENTS` | api | 받아들일 App Store 거래·알림 환경(`Production,Sandbox`) | — (스테이징 서버는 `Sandbox`) | `Production,Sandbox` |
| `GOOGLE_PLAY_PACKAGE_NAME` / `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | api | Android 인앱결제 검증(Play Developer API) | Google Cloud 서비스 계정 + Play Console API 액세스 권한 | Android 결제 501 |
| `GOOGLE_PLAY_RTDN_AUDIENCE` / `GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT` | api | Google Play 실시간 개발자 알림(RTDN) Pub/Sub 푸시 인증 — OIDC 토큰의 audience·서비스 계정 이메일 대조 | Google Cloud > Pub/Sub > 푸시 구독의 인증 설정 (`docs/PAYMENTS.md` 3.4) | RTDN 501 (Google 환불이 자동 회수되지 않음) |

자세한 흐름·심사 체크리스트: [`docs/PAYMENTS.md`](./PAYMENTS.md)

> 💡 상점 계약 전에도 토스페이먼츠 공식 샘플의 **공개 테스트 키**로 샌드박스 결제창·승인 API 를 시험할 수 있습니다(실제 출금 없음). 실행 예시와 검증 결과는 `docs/PAYMENTS.md` 마지막 절. 운영에는 반드시 본인 상점 키를 사용하세요.

## 3. AI 해석 · 상담 (Anthropic Claude)

| 키 | 위치 | 용도 | 발급처 | 없으면 |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | api | 유료 리포트 문장 고도화, AI 상담 | [Claude Console](https://console.anthropic.com) > API Keys | 리포트는 **규칙 기반 풀이**, 상담은 **기본 답변(질문권 차감 없음)** |
| `ANTHROPIC_MODEL` | api | 상담(채팅), 유료 리포트 다듬기, AI 꿈풀이 | 기본 `claude-haiku-5-5`(가장 저렴). 리포트는 규칙 기반 초안을 다듬는 일이라 Sonnet 과 차이가 거의 없었음(2026-10-13 비교) | 기본값 |
| `ANTHROPIC_MODEL_PREMIUM` | api | 타로 '이어지는 이야기' | 기본 `claude-sonnet-5-5`. 카드끼리 엮어 읽는 품질이 Haiku 보다 나았음 | 기본값 |
| `AI_CHAT_CREDIT_COST` | api | 상담·AI 꿈풀이 1회당 차감 질문권 | — | 1 |

## 4. 소셜 로그인

| 키 | 위치 | 발급처 | Redirect URI |
|---|---|---|---|
| `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`(선택) | api | [카카오 디벨로퍼스](https://developers.kakao.com) | `{PUBLIC_WEB_URL}/auth/callback/kakao` |
| `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | api | [네이버 개발자센터](https://developers.naver.com) | `{PUBLIC_WEB_URL}/auth/callback/naver` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | api | [Google Cloud Console](https://console.cloud.google.com) > OAuth 클라이언트 | `{PUBLIC_WEB_URL}/auth/callback/google` |
| `APPLE_CLIENT_ID`(Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | api | Apple Developer > Certificates, IDs & Profiles | Return URL: `{API}/api/v1/auth/oauth/apple/form-post` |

없으면 로그인 화면에 해당 버튼이 노출되지 않고, 이메일 로그인·게스트 모드로 동작합니다. 상세: [`docs/AUTH_PUSH.md`](./AUTH_PUSH.md)

## 5. 푸시 알림 (Firebase Cloud Messaging)

| 키 | 위치 | 용도 | 발급처 |
|---|---|---|---|
| `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` | api | 서버 발송(HTTP v1) | Firebase 콘솔 > 프로젝트 설정 > 서비스 계정 > 새 비공개 키 |
| `DAILY_PUSH_ENABLED` | api | 매일 08:00 KST 오늘의 운세 발송 (서버 1대에서만 true) | — |
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_VAPID_KEY` | web | 웹 푸시 토큰 발급 | Firebase 콘솔 > 웹 앱 / Cloud Messaging > 웹 푸시 인증서 |

## 6. 광고 · 분석 · 공유 (마케팅·광고팀)

| 키 | 위치 | 용도 | 발급처 |
|---|---|---|---|
| `ADS_ENABLED`, `ADS_PROVIDER` | api | 서버 주도 광고 노출 on/off, `adsense`/`adfit`/`admob`/`none` | — |
| `VITE_ADSENSE_CLIENT_ID`, `VITE_ADSENSE_SLOT_RESULT_BOTTOM`, `VITE_ADSENSE_SLOT_HOME_INFEED` | web | 웹 배너 | Google AdSense |
| `VITE_ADFIT_UNIT_RESULT_BOTTOM`, `VITE_ADFIT_UNIT_HOME_INFEED` | web | 웹 배너(카카오) | 카카오 애드핏 |
| `VITE_ADSENSE_SLOT_CONTENT_MID`, `VITE_ADFIT_UNIT_CONTENT_MID` | web | SEO 콘텐츠(꿈해몽·띠별·별자리) 본문 중간·하단 `web_content_mid` | Google AdSense / 카카오 애드핏 |
| `VITE_ADMOB_UNIT_REWARDED_CHAT_IOS/_ANDROID`, `VITE_ADMOB_UNIT_BANNER_RESULT_IOS/_ANDROID` | web(`.env.app`, 앱 빌드) | 앱 보상형·배너 광고 단위(비우면 Google 테스트 단위) + AdMob **앱 ID** 는 Info.plist / AndroidManifest 에 (`docs/APP_PORTING.md`) | Google AdMob |
| `VITE_PUBLIC_WEB_URL`, `VITE_DEEPLINK_HOSTS`, `VITE_APP_URL_SCHEME` | web(`.env.app`) | 앱 소셜 로그인 콜백·딥링크 기준 웹 도메인 | — |
| `ADMOB_REWARDED_AD_UNITS` | api | **우리 앱의** 보상형 광고 단위 ID 허용 목록(콤마 구분). 운영에서 비어 있으면 SSV 지급 거부(타 앱 광고 단위로 보상 탈취 방지) | AdMob 콘솔 > 광고 단위 |
| `REWARDED_AD_CREDITS`, `REWARDED_AD_DAILY_LIMIT` | api | 보상형 광고 1회당 무상 질문권(기본 1) / 하루 한도(기본 3). AdMob 콘솔의 "서버 측 확인 URL"에 `{API}/api/v1/rewards/admob-ssv` 등록 | — (Google 공개키로 서명 검증, 별도 키 불필요) |
| `VITE_GA4_MEASUREMENT_ID` | web | 방문·전환 분석 | Google Analytics 4 |
| `VITE_META_PIXEL_ID` | web | 메타 광고 전환 | Meta 이벤트 관리자 |
| `VITE_KAKAO_PIXEL_ID` | web | 카카오 광고 전환 | 카카오모먼트 |
| `VITE_KAKAO_JS_KEY` | web | 카카오톡 공유 | 카카오 디벨로퍼스 > 앱 키 > JavaScript 키 (+ 플랫폼 > Web 사이트 도메인 등록) |

광고 정책(노출 위치·금지 위치·프리미엄 제외): [`docs/ADS_ANALYTICS.md`](./ADS_ANALYTICS.md)

## 7. 운영 기타

| 키 | 위치 | 용도 | 기본값 |
|---|---|---|---|
| `ADMIN_API_TOKEN` | api | 관리자 API(`x-admin-token` 헤더) — 환불, 질문권 지급 | 비어 있으면 관리자 계정(role=admin)만 |
| `SIGNUP_BONUS_CREDITS` | api | 가입 축하 무상 질문권 | 0 |
| `RATE_LIMIT_PER_MIN` | api | IP 당 분당 요청 제한 | 120 |
| `AUTH_RATE_LIMIT_PER_MIN` | api | 로그인·가입·게스트·토큰 갱신 경로의 분당 제한(무차별 대입 방지) | 10 |
| `TRUST_PROXY_HOPS` | api | 앞단 리버스 프록시 수(nginx 1대 = 1). 0 이면 `X-Forwarded-For` 무시 → IP 위조로 rate limit 우회 불가 | 0 (docker-compose 는 1) |
| `DATABASE_PATH` | api | SQLite 파일 경로 (운영 PostgreSQL 전환은 `docs/ARCHITECTURE.md`) | `./data/saju.db` |
| `ACCESS_TOKEN_TTL_SEC` / `REFRESH_TOKEN_TTL_DAYS` | api | 토큰 수명 | 3600 / 30 |
