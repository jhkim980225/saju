# 토스 미니앱 (보류)

> 기준일: 2026-11-26. `feat/cloudflare` 작업 트리의 코드를 기준으로 적었다. 이 문서는 [FEATURES.md](../FEATURES.md) §21과 §0.2·§22 중 토스 항목(8번)을 대체한다. 요청·응답 형식은 [API.md 토스 미니앱 절](../API.md)에 있다.

## 목적

같은 웹 코드를 토스 앱 안의 미니앱(앱인토스)으로 따로 빌드해 토스 사용자에게 내놓는다. 로그인은 토스 계정, 결제는 토스 인앱결제, 광고는 토스 광고를 쓴다. 웹 출시 뒤로 미뤘다.

| 기능 | 운영 상태 |
|---|---|
| 토스 미니앱 전체 | 보류(웹 출시 뒤) |
| 서버 쪽 토스 기능 | 꺼짐. `wrangler.jsonc` 에 mTLS 인증서 바인딩(`TOSS_MTLS`)이 없어 `/config` 의 `tossAuth`·`tossIap`·`tossRewards` 가 모두 `false` 다. 켜지는 조건은 아래 "켜지는 조건" 표 |
| `TOSS_USER_KEY_SECRET`·`TOSS_IAP_SKUS` | 운영 Worker 에 없다(2026-11-26 시크릿 이름 목록과 `wrangler.jsonc` vars 로 확인). 보류 상태와 같다 |

## 사용자 흐름

1. **빌드**: `npm run build:toss -w @saju/web` 이 타입 검사, `vite build --mode toss`, 번들 검사(`apps/web/scripts/check-toss-bundle.mjs`), `ait build`, 번들 검사를 차례로 한다. 모드는 `toss`(제출용), `toss-qa`(QR 시험용, 테스트 광고 ID), `toss-dev`(브라우저 확인용, SDK 모의)다. 빌드 플러그인(`apps/web/toss/vite-plugin.ts`)이 앱·카카오·애드센스·결제창 모듈을 `src/toss/replace/*` 로 바꾸고, `index.html` 을 밝은 화면·og 태그 제거·제목 고정으로 고친다.
2. **시작**: `bootstrapToss` 가 밝은 화면으로 고정하고, 첫 버전에 없는 화면(랜딩, 로그인·가입·비밀번호, 웹 결제 결과, 타로, AI 상담, AI 꿈풀이)을 라우트에서 빼고, 토스 뒤로가기가 바텀시트만 닫게 하고, 토스용 약관을 등록한 뒤 세션을 만든다.
3. **로그인**: 로그인 화면은 없다. SDK 의 `User.createAnonymousKeyAuthCode()` 로 받은 일회용 코드를 게스트 토큰과 함께 `POST /auth/toss` 로 보낸다. 서버는 mTLS 로 토스에 코드를 보내 사용자 식별키(anonKey)를 받고, 그 HMAC 값을 계정 식별값으로 쓴다. 처음이면 지금의 게스트 계정이 그대로 토스 계정이 되고, 이미 토스 계정이 있으면 게스트의 데이터를 그 계정으로 옮긴다. 토스앱이 낮은 버전이거나 서버가 501 이면 게스트 세션으로 무료 기능만 열고, 상점은 '준비 중'이다.
4. **결제**: 상점은 서버 상품에 토스 SKU 연결(`GET /payments/iap/toss/products`)과 SDK 가격을 합쳐 보여 준다. 질문권 팩·타로·상담·묶음 상품은 첫 버전에서 뺀다. 구매하면 `POST /payments/iap/toss/orders` 로 주문 의도를 먼저 만들고, SDK `createOneTimePurchaseOrder` 의 `processProductGrant` 안에서 `POST /payments/iap/verify { platform: 'toss' }` 로 서버 검증을 받는다. 지급하지 못한 주문은 앱 시작·복귀 때 `getPendingOrders` 로 찾아 다시 검증하고 `completeProductGrant` 로 끝낸다.
5. **광고**: 배너는 무료 결과 하단(리스트형)과 오늘 탭·무료 콘텐츠 본문(피드형)에 둔다. 보상형은 오늘 탭에서 내일 이후 날짜를 미리 보는 데 쓴다(`tomorrow_fortune`, 하루 1회). `POST /rewards/toss/start` 로 일회용 토큰을 받고, 광고를 끝까지 보면(`userEarnedReward`) `POST /rewards/toss/claim` 으로 확인한 뒤 열린 날짜를 기기에 기억한다. 서버에 오늘 연 기록이 이미 있으면(다른 기기에서 열었거나 기기 저장값이 지워졌을 때) `start` 가 409 `DAILY_LIMIT` 을 주고, 앱은 광고 없이 바로 연다. 질문권 광고 보상(`kind: 'credit'`)은 부르는 화면이 없어 서버에서 꺼 두었다.
6. **환불**: 토스 일회성 구매에는 환불 알림이 없다. 매일 08:00 KST 예약 실행이 최근 주문의 상태를 다시 물어 환불된 주문의 지급분을 회수하고 운영 알림을 보낸다([ops.md](ops.md)).

## 관련 파일

| 구분 | 경로 |
|---|---|
| 토스 API 클라이언트(mTLS) | `apps/api/src/modules/toss/client.ts`(`createTossClient`, `TossApiError`) |
| 토스 로그인 | `apps/api/src/modules/toss/auth.ts`, `apps/api/src/modules/auth/routes.ts`(`POST /auth/toss`) |
| 토스 인앱결제 | `apps/api/src/modules/commerce/tossIap.ts`(`createIntent`, `verify`, `syncRefunds`), `apps/api/src/modules/commerce/tossCatalog.ts`(`parseTossSkus`, `tossPriceFor`, `TOSS_PRICE_OVERRIDES`), `apps/api/src/modules/commerce/routes.ts` |
| 토스 광고 보상 | `apps/api/src/modules/rewards/toss.ts`(`TossRewardsDeps.creditRewards`), `apps/api/src/modules/rewards/routes.ts` |
| 조립·켜짐 조건 | `apps/api/src/services.ts`, `apps/api/src/worker.ts`(`TOSS_MTLS`, 환불 확인), `apps/api/src/config/env.ts`(`TOSS_*`), `apps/api/src/modules/config/routes.ts` |
| 공용 계약 | `packages/shared/src/toss.ts` |
| 웹 토스 빌드 | `apps/web/src/toss/*`(`bootstrap.ts`, `session.ts`, `routes.tsx`, `purchases.ts`, `iap.ts`, `products.ts`, `ads.ts`, `adIds.ts`, `futureDayGate.tsx`, `legal.ts`, `sheetHistory.ts`, `replace/*`), `apps/web/src/lib/tossBridge.ts`, `apps/web/toss/vite-plugin.ts` |
| 빌드 검사·심사 준비 | `apps/web/scripts/check-toss-bundle.mjs`, `toss-review.mjs`, `toss-shots.mjs` |
| 테스트 | `apps/api/test/toss-auth.test.ts`, `toss-iap.test.ts`, `toss-rewards.test.ts`, `apps/web/src/toss/__tests__/*` |

## API / 데이터 모델

- 엔드포인트: `POST /auth/toss`, `GET /payments/iap/toss/products`, `POST /payments/iap/toss/orders`, `POST /payments/iap/verify`(`platform: 'toss'`), `POST /rewards/toss/start`, `POST /rewards/toss/claim`. 형식은 [API.md](../API.md).
- **계정**: `users.provider = 'toss'`, `provider_user_id` 는 anonKey 의 HMAC-SHA256(`TOSS_USER_KEY_SECRET`) 값이다. 원문은 저장하지 않는다.
- **주문**: `orders.provider = 'iap_toss'`, `provider_payment_key` 는 토스 주문 ID 다. `(provider, provider_payment_key)` 유일 인덱스로 같은 결제가 두 주문에 붙지 않는다.
- **광고 보상 기록**(`webhook_events`): 질문권 보상은 `tossad:<토큰 jti>`, 날짜 열기는 `tossad:unlock:<slot>:<사용자 ID>:<KST 날짜>`.
- **서버 설정**: 바인딩 `TOSS_MTLS`(`mtls_certificates`), `TOSS_API_BASE`, `TOSS_USER_KEY_SECRET`, `TOSS_IAP_SKUS`(`상품ID=SKU` 콤마 구분), `TOSS_DEV_MOCK`(개발 전용).
- **웹 빌드 설정**: 광고 ID `VITE_TOSS_AD_REWARDED`, `VITE_TOSS_AD_BANNER_RESULT`, `VITE_TOSS_AD_BANNER_FEED`. 사업자 정보는 웹과 같은 `.env` 의 `VITE_BIZ_*` 를 쓰고, 토스에서만 다른 항목은 `.env.toss` 의 `VITE_TOSS_BIZ_*` 로 덮어쓴다.

**켜지는 조건**(`apps/api/src/modules/toss/client.ts` `isConfigured()`, 각 서비스의 `enabled()`)

| 기능 | 조건 |
|---|---|
| 공통(토스 서버 호출) | 바인딩 `TOSS_MTLS` 와 `TOSS_USER_KEY_SECRET` 이 모두 있어야 한다(운영·개발 같음). 운영 모드가 아니면 바인딩 없이 `TOSS_DEV_MOCK=true` 만으로 모의로 켜진다 |
| 로그인(`tossAuth`) | 공통 조건 |
| 인앱결제(`tossIap`) | 공통 조건 + `TOSS_IAP_SKUS`(상품ID=SKU) |
| 광고 보상(`tossRewards`) | 공통 조건. 날짜 열기(`unlock`)만 받고, 질문권(`credit`)은 `services.ts` 에서 `creditRewards` 를 켜야 받는다(기본 꺼짐) |
| 웹 화면의 광고 | 위 서버 조건 + 제출용 빌드의 광고 ID(`VITE_TOSS_AD_*`) + 토스 계정 로그인 + 토스앱이 광고를 지원 |
- `TOSS_CLIENT_KEY`·`TOSS_SECRET_KEY`(`features.toss`)는 웹 결제 대안인 토스페이먼츠 키로, 미니앱과 관계없다.

## 비즈니스 규칙 & 엣지케이스

**공통**

- 토스 파트너 API 는 업무 오류도 HTTP 200 으로 준다. `resultType` 이 `SUCCESS` 가 아니면 모두 실패로 본다.
- mTLS 바인딩이 없으면 토스 경로는 501 `NOT_CONFIGURED` 를 주고 나머지 서비스는 그대로 돈다.
- `TOSS_DEV_MOCK` 은 바인딩이 없고 운영 모드가 아닐 때만 켜진다. 모의 모드는 토스 서버를 부르지 않는다.

**로그인**

- 운영에서 `TOSS_USER_KEY_SECRET` 이 없으면 토스 로그인을 켜지 않는다. 누구나 아는 개발용 고정 키로 HMAC 을 만들면 계정 식별값을 위조할 수 있기 때문이다(2026-11-25 보안 점검 조치).
- 이 비밀값을 바꾸면 기존 토스 사용자를 알아보지 못한다. 한 번 정하면 바꾸지 않는다.
- 코드 교환이 실패하면 계정을 만들지 않고 401 `TOSS_AUTH_FAILED` 다. 탈퇴한 뒤 다시 들어오면 새 계정이 생긴다.

**인앱결제**

- 게스트는 살 수 없다(403 `LOGIN_REQUIRED`). 토스 로그인이 되면 회원이다.
- 주문 의도 단계에서 계정당 1회 한도, 프로필·리딩 소유를 결제 전에 확인한다.
- 운영에서는 토스 서버가 알려 준 SKU 로만 상품을 정한다. 요청의 `sku` 는 모의 모드에서만 쓴다.
- `PAYMENT_COMPLETED`·`PURCHASED` 일 때만 지급한다. `ORDER_IN_PROGRESS` 는 402 `IN_PROGRESS`, 환불된 주문은 402 `REVOKED`, 토스 조회 실패는 502 `VERIFY_UNAVAILABLE` 이고, 지급하지 않은 주문은 앱이 미결로 남겨 다시 시도한다.
- 토스 주문 ID 로 멱등이다. 같은 주문을 다시 보내면 처음 결과를 주고, 다른 계정이 같은 주문 ID 를 쓰면 409 `OTHER_ACCOUNT` 다. 주문 의도와 다른 상품의 결제는 `SKU_MISMATCH` 로 거절한다.
- **복구**: 앱이 주문 의도 ID 를 잃었으면 7일 안의 같은 상품 대기 주문을 찾는다. 없으면 대상이 필요 없는 상품이거나 대표 프로필(또는 프로필이 하나뿐)로 대상을 정할 수 있을 때만 새 주문을 만들어 지급한다. 리딩이 필요한 상품은 409 `TARGET_REQUIRED` 다.
- 결제 뒤 검증에서 계정당 1회 한도에 걸리면 주문을 실패로 두고 409 와 함께 환불 문의를 안내한다. 관리자 환불 API 는 토스 결제를 직접 취소하지 않는다.
- 토스 결제는 리포트·타로에 딸린 질문권을 주지 않는다. 질문권은 질문권 팩에서만 준다(`creditsFor`).
- **판매가 기록**: 토스의 주문 상태 조회는 금액을 주지 않으므로 주문 금액은 `tossPriceFor` 로 계산해 기록한다. 공급가를 웹 가격 ÷ 1.1 을 100원 단위로 반올림한 값으로 보고 판매가를 공급가 × 1.1 로 가정한다(990원·9,900원은 그대로). 콘솔 판매가가 다르면 `TOSS_PRICE_OVERRIDES` 를 고친다. 화면 가격은 SDK 가 준 콘솔 가격을 쓴다.
- **환불 확인**: 지급한 지 30일 안의 토스 주문을 최근 순으로 최대 200건 다시 조회해 `REFUNDED` 면 회수한다. 조회 실패는 건너뛰고 다음 날 다시 본다.

**광고 보상**

- 토스 광고에는 AdMob SSV 같은 서버 확인 콜백이 없다. 그래서 광고 직전에 서버가 서명한 일회용 토큰을 주고, 끝까지 본 뒤 그 토큰으로 지급을 요청하게 한다. 서버는 광고를 실제로 봤는지 확인할 수 없으므로 한도를 작게 둔다.
- 토큰은 사용자·종류에 묶이고 10분 동안 유효하며 한 번만 쓴다. 발급 뒤 3초 안의 지급 요청은 `TOO_EARLY` 로 거절한다(앱은 기다렸다가 한 번 더 요청한다).
- 토스 계정만 받을 수 있다(그 밖은 403).
- `credit`(무상 질문권)은 기본으로 꺼져 있어 토큰 발급·지급 모두 403 `CREDIT_REWARD_OFF` 다. 첫 버전에 AI 상담·꿈풀이가 없어 부르는 화면이 없고, 광고 시청을 서버가 확인할 수 없는 지급 경로를 열어 둘 이유가 없기 때문이다. 화면을 붙일 때 `createTossRewardsService` 의 `creditRewards` 를 켜면 AdMob 보상과 같은 하루 한도(`REWARDED_AD_DAILY_LIMIT`)를 지급 묶음 실행 시점에 확인하며 지급한다.
- `unlock` 은 슬롯마다 KST 하루 1회이고, 같은 날 다시 요청하면 열린 상태를 그대로 알려 준다. 열린 기록(`tossad:unlock:<slot>:<사용자 ID>:<KST 날짜>`)은 `start` 가 읽어 같은 날 두 번째 광고를 막고(409 `DAILY_LIMIT`, 앱은 이때 바로 연다), 30일 뒤 정리되며 탈퇴하면 바로 지운다([ops.md](ops.md)).
- 광고 ID: 제출용 빌드(`toss`)만 환경 변수의 실제 ID 를 쓰고, 그 밖의 모드는 테스트 ID 를 쓴다. 제출 번들에 테스트 ID 글자가 있으면 심사에서 반려되므로 제출용 빌드에서는 테스트 ID 상수를 빈 문자열로 만들고 번들 검사가 확인한다.
- 광고는 진입 직후에 띄우지 않고, 입력·결제·유료 리포트 화면에는 넣지 않는다.

## 주의사항 / 알려진 이슈

1. **보류 상태다**: `wrangler.jsonc` 에 `mtls_certificates` 바인딩이 없어 서버 쪽 토스 기능이 모두 꺼져 있다. 남김(보류 기능): 웹 출시 뒤 재개한다.
2. 문서만 고침(2026-11-26): **켜지는 조건이 FEATURES 설명보다 많던 문제**. 위 "켜지는 조건" 표에 `TOSS_USER_KEY_SECRET`(바인딩과 함께 필수), `TOSS_IAP_SKUS`(인앱결제), `TOSS_DEV_MOCK`(개발), 질문권 보상의 `creditRewards` 를 모두 적었다. 코드가 맞고 FEATURES §0.2·§21 은 이 문서로 대체한다.
3. **환불 확인 범위가 제한된다**: 지급 뒤 30일이 지난 환불, 하루 200건을 넘는 주문은 확인하지 않는다. 확인은 하루 한 번이라 회수가 최대 하루 늦다. 의도된 동작으로 유지: 토스 일회성 구매에 환불 알림이 없어 조회로 대신하는 한계다.
4. **판매가 기록이 실제와 다를 수 있다**: 주문 금액은 공급가 × 1.1 가정으로 계산한 값이고 콘솔 판매가와 대조하지 않았다. 화면은 SDK 의 콘솔 가격을 보여 주므로 두 값이 어긋나면 결제 내역·운영 알림·하루 요약의 금액이 실제 결제액과 달라진다. 남김(외부 작업): 토스 콘솔에 판매가를 등록한 뒤 다르면 `TOSS_PRICE_OVERRIDES` 를 고친다. 토스 주문 상태 조회가 금액을 주지 않아 코드로 대조할 수 없다. TODO: 확인 필요(콘솔 판매가 규칙).
5. **날짜 열기는 기기에서만 막는다**: 운세 API 는 날짜만 받으면 누구에게나 답한다(`POST /fortune/daily` 는 로그인 없이 웹에서도 모든 날짜를 연다). 의도된 동작으로 유지: 같은 내용이 웹에서 무료라 서버가 막을 대상이 아니고, 토스 광고는 노출 정책이다. 문서만 고침(2026-11-26): "서버가 기록을 읽지 않는다"는 사실과 달랐다. `start` 가 오늘 연 기록을 읽어 두 번째 광고를 막고, 앱은 그 응답으로 기기 저장값이 없어도 바로 연다.
6. 해결(2026-11-26): **질문권 광고 보상 경로를 부르는 화면이 없던 문제**. 서버의 `kind: 'credit'` 경로를 기본으로 끄고(토큰 발급·지급 모두 403 `CREDIT_REWARD_OFF`), 화면을 붙일 때 `creditRewards` 로 켜게 했다. 토스 토큰을 가진 사람이 광고 없이 질문권을 받아 갈 수 있는 경로를 닫은 것이다. 지급 로직은 테스트(`toss-rewards.test.ts`)에서 켜서 계속 검증한다.
7. 해결(2026-11-26): **코드 주석이 저장소에 없는 계약 문서를 가리키던 문제**. `tossIap.ts`, `toss/client.ts`, 웹 `toss/api.ts`·`purchases.ts`·`session.ts`·`futureDayGate.tsx` 의 주석을 이 저장소의 [API.md 토스 미니앱 절](../API.md), `packages/shared/src/toss.ts`, 이 문서로 바꿨다.
8. 해결(2026-11-26): **사업자 정보를 따로 넣어야 하던 문제**. 토스 약관이 `.env` 의 `VITE_BIZ_*` 를 함께 읽는다. `VITE_TOSS_BIZ_*` 는 토스에서만 다를 때 덮어쓴다. 둘 다 비면 `(출시 전 입력)` 이 보이는 것은 그대로다([legal.md](legal.md)).
9. **보상 토큰 서명 키가 로그인 시크릿에서 나온다**: 키는 `JWT_ACCESS_SECRET` 에 접미어를 붙여 만든다. JWT 시크릿을 바꾸면 이미 발급한 보상 토큰(최대 10분)이 모두 무효가 된다. 의도된 동작으로 유지: 토큰 수명이 10분이라 영향이 작다.
