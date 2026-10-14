# 결제 연동 가이드 (PAYMENTS)

- 작성: 결제팀
- 기준일: 2026-10-12
- 관련 문서: [`research/03-pricing-payments-ads.md`](research/03-pricing-payments-ads.md) (마케팅팀 가격·결제 리서치)
- 원칙: **키가 없으면 해당 결제 기능은 `NOT_CONFIGURED`(HTTP 501)로 응답**합니다. 키만 넣으면 실제 결제사와 연동됩니다.

| 구분 | 코드 |
|---|---|
| 게이트웨이 인터페이스 | `apps/api/src/modules/commerce/providers/types.ts` |
| 토스페이먼츠 (웹 1순위) | `apps/api/src/modules/commerce/providers/toss.ts` |
| 포트원 V2 (웹 2순위) | `apps/api/src/modules/commerce/providers/portone.ts` |
| Apple / Google 인앱결제 검증 | `apps/api/src/modules/commerce/providers/iap.ts` |
| 목업 (개발용) | `apps/api/src/modules/commerce/providers/mock.ts` |
| 주문·승인·지급·환불 | `apps/api/src/modules/commerce/service.ts`, `routes.ts` |
| 어댑터 테스트 | `apps/api/test/payments.providers.test.ts` |

---

## 1. 결제 흐름

### 1.1 웹 — 토스페이먼츠 결제창 v2 (`PAYMENT_PROVIDER=toss`)

```mermaid
sequenceDiagram
    autonumber
    participant U as 사용자
    participant W as 웹 프론트
    participant A as API 서버
    participant T as 토스페이먼츠

    U->>W: 상품 선택
    W->>A: POST /api/v1/orders { productId, profileId }
    A-->>W: checkout { clientKey, orderId, amount, successUrl, failUrl }
    W->>T: TossPayments(clientKey).payment({ customerKey }).requestPayment({ method:"CARD", amount, orderId, ... })
    T-->>U: 결제창 (카드·간편결제 인증)
    T->>W: successUrl?paymentKey=…&orderId=…&amount=…
    W->>A: POST /api/v1/payments/confirm { provider:"toss", orderId, amount, paymentKey }
    A->>A: 요청 금액 = 주문 금액? (아니면 주문 failed)
    A->>T: POST /v1/payments/confirm (Basic 인증, Idempotency-Key)
    T-->>A: Payment { status: DONE, totalAmount, method, approvedAt }
    A->>A: totalAmount 재대조 → 주문 paid + 지급(열람권·질문권) 한 트랜잭션
    A-->>W: { order, granted, creditsBalance }
    Note over T,A: 이후 상태 변경(취소 등)은 웹훅 → 결제 재조회로 반영
```

- 결제창에서 취소·실패하면 `failUrl`로 돌아오고, 프론트가 `POST /api/v1/payments/fail { orderId, code, message }`를 호출합니다.
- 승인 응답이 유실(타임아웃)되거나 `ALREADY_PROCESSED_PAYMENT`가 오면, 서버가 `GET /v1/payments/{paymentKey}`로 실제 상태를 조회해 **승인 완료(DONE)이고 같은 주문이면 성공으로 처리**합니다. 돈은 빠졌는데 주문만 실패로 남는 상황을 막기 위한 것입니다.
- 가상계좌는 승인 시 `WAITING_FOR_DEPOSIT`로 끝나므로 지금은 지원하지 않습니다. 이 경우 서버가 발급된 계좌를 바로 취소하고 `PAYMENT_NOT_DONE`을 돌려줍니다.
  - 프론트는 결제창을 `method: 'CARD'`(카드·간편결제 통합창)로만 열기 때문에 가상계좌가 노출되지 않습니다.
  - 결제위젯으로 바꾸면 위젯 결제수단 설정에서 가상계좌를 꺼야 합니다.

### 1.2 웹 — 포트원 V2 (`PAYMENT_PROVIDER=portone`)

```mermaid
sequenceDiagram
    autonumber
    participant W as 웹 프론트
    participant A as API 서버
    participant P as 포트원 (+ KCP/나이스)

    W->>A: POST /api/v1/orders
    A-->>W: checkout { storeId, channelKey, orderId, amount }
    W->>P: PortOne.requestPayment({ storeId, channelKey, paymentId: orderId, totalAmount: amount, currency: "CURRENCY_KRW", ... })
    P-->>W: 결제 완료 (PC: Promise 결과 / 모바일: redirectUrl?paymentId=…)
    W->>A: POST /api/v1/payments/confirm { provider:"portone", orderId, amount, paymentKey: paymentId }
    A->>P: GET /payments/{paymentId}?storeId=… (Authorization: PortOne {API_SECRET})
    P-->>A: Payment { status, amount.total, method, paidAt }
    A->>A: status=PAID · amount.total=주문 금액 · paymentId=orderId 확인
    A->>A: 주문 paid + 지급
    A-->>W: { order, granted, creditsBalance }
```

- **프론트 규칙: `paymentId`를 주문 ID(`checkout.orderId`)와 같게 보냅니다.** 다른 값을 쓰려면 `customData: JSON.stringify({ orderId })`를 함께 넣어야 합니다. 이 규칙이 없으면 같은 금액의 다른 주문 결제건을 재사용해 상품을 받는 공격이 가능하므로, 서버는 일치하지 않으면 `ORDER_MISMATCH`로 거절합니다.
- 포트원은 결제사가 금액을 대조해 주지 않습니다. 그래서 `amount.total`이 주문 금액과 다르면 서버가 **즉시 결제를 취소**하고 `AMOUNT_MISMATCH`를 돌려줍니다.

### 1.3 앱 — StoreKit 2 / Play Billing

```mermaid
sequenceDiagram
    autonumber
    participant App as 앱 (iOS / Android)
    participant S as 스토어 (App Store / Google Play)
    participant A as API 서버

    App->>S: 구매 (StoreKit 2 product.purchase() / BillingClient.launchBillingFlow)
    S-->>App: iOS: Transaction(transactionId) / Android: Purchase(purchaseToken)
    App->>A: POST /api/v1/payments/iap/verify { platform, productId, receipt, profileId }
    alt iOS
        A->>S: GET /inApps/v1/transactions/{transactionId} (ES256 JWT) — 운영 404면 샌드박스 재시도
        S-->>A: signedTransactionInfo (JWS)
        A->>A: 디코드 → bundleId · productId 대조, 환불(revocationDate) 여부 확인
    else Android
        A->>S: OAuth2 토큰 발급 (서비스 계정 RS256 JWT, 메모리 캐시)
        A->>S: GET purchases/products/{productId}/tokens/{token}
        S-->>A: ProductPurchase { purchaseState, orderId, purchaseTimeMillis }
        A->>A: purchaseState = 0 확인
    end
    A->>A: 주문 생성(provider iap_apple|iap_google, 거래 ID로 멱등) + 지급
    A-->>App: { order, granted, creditsBalance }
    App->>S: iOS: transaction.finish() / Android: consumeAsync()
```

- iOS `receipt`에는 StoreKit 2 `transactionId`(숫자 문자열)를 보냅니다. `jwsRepresentation`(signedTransaction)을 보내도 됩니다. 이때 서버는 그 안의 transactionId만 꺼내고, 내용은 App Store Server API로 다시 받아 검증합니다.
- Android `receipt`에는 `purchaseToken`을 보냅니다.
- **앱은 서버 검증이 성공한 뒤에만 `finish()` / `consumeAsync()`를 호출**해야 합니다. Google은 구매 후 3일 안에 확인(acknowledge 또는 consume)하지 않으면 **자동 환불**합니다.
- 같은 거래 ID로 다시 요청하면 지급 없이 기존 주문을 돌려줍니다. 다른 계정이 같은 거래를 쓰면 409로 막습니다.

### 1.4 프론트엔드 연동 (`apps/web`)

| 파일 | 역할 |
|---|---|
| `src/lib/payments/index.ts` | `startCheckout()` — 앱이면 인앱결제, 웹이면 주문 생성 → `pendingCheckout` 저장(localStorage) → provider별 결제창 호출 |
| `src/lib/payments/providers.ts` | `openToss(c)` / `openPortOne(c)` — SDK 스크립트를 1회만 동적 로드하고 결제창을 연다 |
| `src/pages/PaymentResultPages.tsx` | `/payments/success`: 쿼리 → `POST /api/v1/payments/confirm`, `/payments/fail`: `POST /api/v1/payments/fail` |
| `src/lib/payments/__tests__/providers.test.ts` | 스크립트 1회 로드, 파라미터 매핑, 포트원 리다이렉트 테스트 (jsdom, SDK는 가짜 객체) |

**SDK 로드**

- 토스: `https://js.tosspayments.com/v2/standard`
- 포트원: `https://cdn.portone.io/v2/browser-sdk.js`
- `<script>`를 한 번만 붙이고, 동시에 호출해도 같은 로딩 Promise를 함께 씁니다.
- 로드 실패(네트워크, 광고 차단)나 15초 타임아웃이면 "결제 모듈을 불러오지 못했어요…" 오류를 던집니다. 다음 호출에서 다시 로드를 시도합니다.

**토스 (결제창, 리다이렉트 방식)**

- 클라이언트 키: 서버가 준 `checkout.clientKey`를 쓰고, 없으면 `VITE_TOSS_CLIENT_KEY`를 씁니다. 둘 다 없으면 한국어 오류를 던집니다.
- 호출: `TossPayments(clientKey).payment({ customerKey }).requestPayment(...)`
  - 인자: `{ method: 'CARD', amount: { currency: 'KRW', value }, orderId, orderName, successUrl, failUrl, customerEmail, customerName, card: { flowMode: 'DEFAULT' } }`
- 성공하면 토스가 `successUrl?paymentKey=…&orderId=…&amount=…`로, 실패·취소하면 `failUrl?code=…&message=…&orderId=…`로 보냅니다.
- 결제위젯(UI) 방식으로 바꾸는 방법은 `providers.ts` 주석에 적어 두었습니다. 결제 화면에 컨테이너 2개가 필요하고, 키도 위젯 키 쌍으로 바꿔야 합니다(4장).

**포트원 V2**

- 호출: `PortOne.requestPayment({ storeId, channelKey, paymentId: orderId, orderName, totalAmount, currency: 'CURRENCY_KRW', payMethod: 'CARD', redirectUrl: successUrl, customer })`
  - **`paymentId`는 반드시 주문 ID와 같아야 합니다**(서버 검증).
- 모바일: `redirectUrl?paymentId=…`(실패 시 `&code=…&message=…`)로 돌아옵니다. 결과 페이지는 `code`가 있으면 실패 페이지로 넘깁니다. `orderId`·`amount`·`provider`는 `pendingCheckout`에서 채웁니다.
- PC: 결과가 Promise로 옵니다.
  - `code`가 있으면 `failUrl?orderId=&code=&message=`로 이동합니다.
  - 없으면 `successUrl?paymentId=&orderId=&amount=&provider=portone`으로 이동합니다(`window.location.assign`).
  - amount와 provider를 같이 넘기므로 저장소가 없어도 승인할 수 있습니다. 금액은 서버가 다시 검증합니다.

**결과 페이지 쿼리 처리** (`PaymentSuccessPage`)

| 값 | 우선순위 |
|---|---|
| orderId | `orderId` → `paymentId` → `pendingCheckout.orderId` |
| paymentKey | `paymentKey`(토스) → `paymentId`(포트원) |
| provider | `provider` → `pendingCheckout.provider` → `paymentKey`가 있으면 toss, 없으면 portone |
| amount | `amount` → `pendingCheckout.amount` (서버가 주문 금액과 다시 대조) |

**인앱 브라우저 주의**

- 카카오톡, 인스타그램 등 인앱 브라우저에서는 앱카드·간편결제 앱 전환이 막힐 수 있습니다.
- 결제 후 다른 브라우저로 돌아가 `pendingCheckout`을 못 찾는 경우도 있습니다.
- 문제가 잦으면 결제 전에 외부 브라우저로 열도록 안내합니다(카카오톡: `kakaotalk://web/openExternal?url=…`).
- Capacitor 앱에서는 이 경로 대신 인앱결제(1.3)를 씁니다.

---

## 2. 서버 검증 규칙 요약

| 항목 | 토스페이먼츠 | 포트원 V2 | Apple | Google |
|---|---|---|---|---|
| 승인/검증 API | `POST /v1/payments/confirm` | `GET /payments/{paymentId}` | `GET /inApps/v1/transactions/{id}` | `GET …/purchases/products/{productId}/tokens/{token}` |
| 인증 | `Basic base64("{TOSS_SECRET_KEY}:")` | `PortOne {PORTONE_API_SECRET}` | ES256 JWT (kid, iss, aud=`appstoreconnect-v1`, bid, 30분) | OAuth2 JWT bearer (RS256) → Bearer 토큰 |
| 금액·상품 검증 | 토스가 orderId·amount 대조 + 서비스가 totalAmount 재대조 | status=PAID, amount.total, paymentId=orderId | bundleId, productId, revocationDate | purchaseState=0, productId |
| 거래 ID | paymentKey | paymentId | transactionId | orderId (테스트 구매는 `TEST-{토큰 해시}`) |
| 취소 | `POST /v1/payments/{paymentKey}/cancel` + Idempotency-Key | `POST /payments/{paymentId}/cancel` | 스토어에서 처리 | 스토어에서 처리 |
| 타임아웃 | 10초 (`AbortSignal.timeout`) | 10초 | 10초 | 10초 |

- 결제사 오류는 `GatewayError(message, code)`로 바뀌고, 서비스가 `402 PAYMENT_FAILED { details.code }`로 응답합니다. 토스는 `{ code, message }`를, 포트원은 `{ type, message }`를 그대로 씁니다.
- 통신 실패와 타임아웃은 `NETWORK_ERROR`("결제사와 통신에 실패했어요…")입니다.
- 이미 취소된 결제를 다시 취소하는 경우(`ALREADY_CANCELED_PAYMENT`, `PAYMENT_ALREADY_CANCELLED`)는 성공으로 봅니다. 그래서 환불 재시도가 안전합니다.

---

## 3. 가입·심사 체크리스트

### 3.0 공통 선행 조건 (PG 심사 공통)

- [ ] 사업자등록과 **통신판매업 신고**
- [ ] 사이트 하단 사업자 정보 표기: 상호, 대표자, 사업자등록번호, 통신판매업 신고번호, 주소, 연락처
- [ ] 이용약관, 개인정보처리방침, **환불 정책**
  - 디지털 콘텐츠 청약철회 제한 고지: "생성이 시작되면 원칙적으로 환불 불가, 장애 시 7일 이내 예외"
- [ ] 미성년자 결제 조항(법정대리인 동의·취소)
- [ ] 심사자가 볼 수 있는 상품·가격·결제 화면(테스트 키로 동작하는 상태)
- [ ] **업종과 상품 표기 방식**
  - 업종은 **'디지털 콘텐츠(리포트) 판매'**로 신청합니다. '상담·컨설팅'으로 신청하지 않습니다. 토스페이먼츠는 컨설팅 업종을 국가 자격증 보유 사업자로 한정합니다.
  - 질문권은 **'포인트 충전'이 아니라 "AI 상담 N회 이용권(서비스 이용료)"**으로 적습니다. 포인트 충전형은 KCP·스마트로·KPN·네이버페이에서 입점할 수 없고, 다른 곳도 충전 한도와 인증 강화가 붙습니다.

### 3.1 토스페이먼츠 (1순위)

- [ ] 토스페이먼츠 가입 → 상점 생성 → 전자결제 계약 신청(업종: 디지털 콘텐츠)
- [ ] 사주·운세 업종은 **심사를 거치면 입점 가능**합니다(포트원 헬프센터 기준). 반려되면 3.2(포트원 + KCP/나이스)로 전환합니다.
- [ ] 비용: 가입비 220,000원(최초 1회), 연관리비 110,000원, 카드 3.4%(일반 등급, VAT 별도), 계좌이체 2.0%(최저 200원)
- [ ] 결제 수단: 카드, 계좌이체, 간편결제(토스페이·카카오페이 등은 별도 계약)
  - **가상계좌는 끕니다**(현재 미지원).
  - 990원 미니 리포트는 카드·간편결제만 허용합니다(계좌이체 최저 수수료 200원).
- [ ] 연동 키를 발급받습니다. **현재 프론트는 결제창 방식이라 "API 개별 연동 키"**(`test_ck_`/`test_sk_`, 운영 `live_ck_`/`live_sk_`)가 필요합니다.
  - 결제위젯 연동 키(`gck`/`gsk`)는 결제위젯(UI) 방식 전용입니다.
  - 클라이언트 키와 시크릿 키는 **같은 종류의 쌍**이어야 합니다.
- [ ] 웹훅 등록(5장)
- [ ] (2차) 자동결제(빌링): 리스크 검토와 추가 계약이 필요하고 별도 MID를 받습니다. 정기 구독형만 허용됩니다.

### 3.2 포트원 V2 + NHN KCP 또는 나이스페이 (2순위)

- [ ] 포트원 관리자 콘솔 가입 → 상점 ID 확인
- [ ] PG 계약: **NHN KCP 또는 나이스페이**(선택: 카카오페이 채널). 포트원 경유 가입비 면제 패키지도 비교합니다.
- [ ] **사주·운세 입점 불가 PG: KG이니시스, 키움페이(다우데이타), 엑심베이, 네이버페이**. 채널로 추가하지 않습니다.
- [ ] KCP는 포인트 충전형이 불가하므로 질문권을 '이용권'으로 설계하고 설명합니다.
- [ ] 채널 키 발급(테스트 채널 → 실연동 채널)
- [ ] V2 API Secret 발급
- [ ] 웹훅 등록(V2, 2024-04-25 버전)과 웹훅 시크릿 확인(5장)

### 3.3 Apple App Store (iOS IAP)

- [ ] Apple Developer Program 가입, **유료 앱 계약(Paid Applications Agreement)**, 세금·은행 정보 입력. 계약이 없으면 IAP 상품이 조회되지 않습니다.
- [ ] **Small Business Program 가입**(연 수익 100만 달러 이하, 수수료 15%)
- [ ] IAP 상품 등록
  - 리포트·질문권은 **소모성**, 구독은 자동 갱신 구독(그룹 `plus`)으로 등록합니다.
  - 상품 ID는 `{bundle_id}.{product_id}` 형식이며 `catalog.ts`의 `iosProductId`와 같아야 합니다.
- [ ] IAP로 산 크레딧은 만료될 수 없습니다(3.1.1). 그래서 질문권은 유효기간이 없습니다.
- [ ] **가이드라인 4.3(b)**: 운세 앱은 '스팸 카테고리'입니다. 네이티브 기능(푸시, 위젯, 오프라인 만세력)을 넣고 심사 노트에 차별점을 적습니다. 웹뷰로 감싸기만 하면 안 됩니다.
- [ ] 한국 스토어에서는 앱 안에서 웹 결제로 안내하는 문구나 링크를 넣지 않습니다.
- [ ] App Store Server API 키 발급: App Store Connect → 사용자 및 액세스 → 통합 → 앱 내 구입 → Issuer ID, Key ID, `.p8` 파일(**한 번만 다운로드 가능**)
- [ ] (미구현) App Store Server Notifications V2 URL 등록 — 환불과 구독 갱신 반영용

### 3.4 Google Play (Android IAP)

- [ ] Play Console 결제 프로필(판매자 계정) 등록, 수수료 15%
- [ ] 인앱 상품 등록. 상품 ID는 `product_id` 그대로 쓰며 `catalog.ts`의 `androidProductId`와 같아야 합니다.
- [ ] Google Cloud 프로젝트에서 **Google Play Android Developer API**를 켭니다 → 서비스 계정을 만들고 JSON 키를 발급합니다.
- [ ] Play Console → 사용자 및 권한 → 서비스 계정 이메일 초대. 권한: **재무 데이터 보기**, **주문 및 구독 관리**
  - 권한이 반영되기까지 시간이 걸릴 수 있습니다(수 시간~하루). 그동안은 401/403이 납니다.
- [ ] 라이선스 테스터 등록(테스트 구매용)
- [ ] (미구현) RTDN(Pub/Sub) 또는 Voided Purchases API — 환불과 취소 반영용
- [ ] 한국 대체결제(11%)는 이득이 없으므로 MVP에서는 쓰지 않습니다(리서치 2.7).

---

## 4. 환경 변수

| 변수 | 용도 | 공개/비밀 | 발급처 | 형식·메모 |
|---|---|---|---|---|
| `PAYMENT_PROVIDER` | 웹 결제 게이트웨이 선택 | 서버 설정 | — | `mock`(기본) / `toss` / `portone`. 운영에서 `mock`은 기동 실패 |
| `TOSS_CLIENT_KEY` | 결제창 초기화(주문 생성 응답으로 프론트에 전달) | 공개 | 토스페이먼츠 개발자센터 → API 키 → **API 개별 연동 키** | `test_ck_…` / `live_ck_…` (위젯 방식이면 `gck`) |
| `TOSS_SECRET_KEY` | 승인·취소·조회 | **비밀** | 같은 곳 | `test_sk_…` / `live_sk_…` (클라이언트 키와 같은 쌍) |
| `VITE_TOSS_CLIENT_KEY` | (웹, 선택) 서버가 clientKey를 주지 않을 때 쓰는 대체값 | 공개 | 위와 같음 | `apps/web/.env` |
| `TOSS_WEBHOOK_SECRET` | (사용 안 함) | — | — | 결제 상태 웹훅에는 서명이 없어 재조회로 검증 |
| `PORTONE_STORE_ID` | 상점 ID | 공개 | 포트원 콘솔 → 연동 정보 | `store-…` |
| `PORTONE_CHANNEL_KEY` | PG 채널(KCP, 나이스 등) | 공개 | 포트원 콘솔 → 결제 연동 → 채널 관리 | `channel-key-…` |
| `PORTONE_API_SECRET` | 결제 조회·취소 | **비밀** | 포트원 콘솔 → 연동 정보 → V2 API Secret | |
| `PORTONE_WEBHOOK_SECRET` | 웹훅 서명 검증(없으면 웹훅을 모두 거부) | **비밀** | 포트원 콘솔 → 웹훅 설정 | `whsec_…` (접두사가 없어도 동작) |
| `APPLE_IAP_ISSUER_ID` | App Store Server API 발급자 | 비밀 | App Store Connect → 사용자 및 액세스 → 통합 → 앱 내 구입 | UUID |
| `APPLE_IAP_KEY_ID` | API 키 ID (JWT `kid`) | 비밀 | 같은 곳 | 10자 영숫자 |
| `APPLE_IAP_PRIVATE_KEY` | `.p8` 서명 키 (ES256) | **비밀** | 같은 곳(1회 다운로드) | PKCS#8 PEM. 줄바꿈은 `\n` 이스케이프로 넣어도 됨 |
| `APPLE_BUNDLE_ID` | 번들 ID (JWT `bid`, 거래 bundleId 대조) | 서버 설정 | Xcode / App Store Connect | `kr.example.saju` |
| `GOOGLE_PLAY_PACKAGE_NAME` | 패키지명 | 서버 설정 | Play Console | `kr.example.saju` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Play Developer API 서비스 계정 | **비밀** | Google Cloud Console → IAM → 서비스 계정 → 키 | JSON 전체를 한 줄 문자열로 |

기능이 켜지는 조건(`config.features.*`):

- `toss`: CLIENT_KEY와 SECRET_KEY가 모두 있을 때
- `portone`: STORE_ID, CHANNEL_KEY, API_SECRET이 모두 있을 때
- `appleIap`: 4개 키가 모두 있을 때
- `googleIap`: 2개 키가 모두 있을 때

`apps/api/.env` 예시:

```dotenv
PAYMENT_PROVIDER=toss
TOSS_CLIENT_KEY=test_ck_xxxxxxxxxxxxxxxx
TOSS_SECRET_KEY=test_sk_xxxxxxxxxxxxxxxx

# PEM 은 한 줄로: 줄바꿈을 \n 으로
APPLE_IAP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMG...\n-----END PRIVATE KEY-----"

# JSON 은 작은따옴표로 감싸 그대로 넣는다 (private_key 안의 \n 은 JSON 이스케이프 그대로)
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON='{"type":"service_account","client_email":"…@….iam.gserviceaccount.com","private_key":"-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n","private_key_id":"…"}'
```

---

## 5. 웹훅

| 결제사 | URL | 등록 위치 | 구독할 이벤트 | 검증 방식 |
|---|---|---|---|---|
| 토스페이먼츠 | `https://{API 도메인}/api/v1/payments/webhooks/toss` | 개발자센터 → 웹훅 | `PAYMENT_STATUS_CHANGED` (가상계좌를 켜면 `DEPOSIT_CALLBACK`도) | 서명 없음 → 본문의 paymentKey/orderId로 **결제 조회 API를 재조회**해 상태 결정. DEPOSIT_CALLBACK은 `secret`도 대조 |
| 포트원 V2 | `https://{API 도메인}/api/v1/payments/webhooks/portone` | 포트원 콘솔 → 웹훅 (V2, 버전 2024-04-25) | `Transaction.*` | **Standard Webhooks 서명**(`webhook-id`/`webhook-timestamp`/`webhook-signature`, HMAC-SHA256, 허용 오차 ±5분) 검증 후 결제 재조회 |

처리 규칙:

- 검증에 실패하면(위조, 서명 불일치, 존재하지 않는 결제) `400 웹훅 검증에 실패했어요`를 돌려줍니다.
- 결제사 조회 중 통신 오류가 나면 5xx를 돌려주고, 결제사가 재전송합니다.
- 중복은 `webhook_events.id = "{provider}:{event.id}"`로 거릅니다.
  - 토스의 이벤트 ID는 **재조회한 결제의** `paymentKey:status:lastTransactionKey`로 만듭니다. 위조 본문으로 앞으로 올 이벤트 ID를 선점하지 못하게 하려는 것입니다.
  - 포트원은 서명에 포함된 `webhook-id`를 씁니다.
- 주문 반영(`service.handleWebhook`)
  - `canceled`: paid 주문을 canceled로 바꾸고 **지급분을 회수**합니다. 결제사 관리자 화면에서 직접 취소한 경우도 포함됩니다.
  - `paid`: pending 또는 failed 주문을 paid로 **복구하고 지급**합니다. 승인 응답이 유실된 경우를 위한 것입니다.
  - `failed`: 기록만 합니다.
- 웹훅 라우트는 서명 검증을 위해 본문을 원문 문자열 그대로 받습니다(`routes.ts`의 content-type parser). 프록시나 CDN이 본문을 변형하지 않게 설정합니다.

---

## 6. 로컬 검증 방법

### 6.1 단위 테스트 (외부 호출 없음)

```bash
cd apps/api
npx vitest run test/payments.providers.test.ts
```

`fetch`를 모킹해 다음을 검증합니다.

- 토스: 승인, 오류 코드 매핑, 타임아웃 복구, 취소, 웹훅 재조회
- 포트원: 승인, 금액·주문 검증, 웹훅 서명(정상, 위조, 시간 초과)
- Apple: JWT 서명, JWS 디코드, bundleId 검증, 샌드박스 재시도
- Google: 토큰 발급과 캐시, 구매 조회

### 6.2 목업 (키 없이 화면 흐름 확인)

- `PAYMENT_PROVIDER=mock`(개발 기본값)으로 둡니다.
- 웹 승인 시 `paymentKey`가 `mock_fail`이면 실패를 흉내 냅니다.
- IAP는 `receipt: "mock:<임의ID>"`로 통과합니다. 해당 스토어 키가 없을 때만 목업이 쓰입니다.

### 6.3 토스페이먼츠 테스트 키

1. 개발자센터에 가입하면 사업자 계약 전에도 **테스트 키**를 받을 수 있습니다. API 키 메뉴에서 **API 개별 연동 키**(`test_ck_`/`test_sk_`)를 확인합니다.
2. `.env`에 `PAYMENT_PROVIDER=toss`, `TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY`를 넣고 `npm run dev`로 실행합니다.
3. 웹에서 상품을 결제합니다. 테스트 결제창에서는 실제로 출금되지 않습니다. successUrl → `/payments/confirm` 순서로 진행되는지 확인합니다.
4. 지급 확인: `GET /api/v1/wallet`(질문권, 열람권), `GET /api/v1/orders`(status `paid`, method)
5. 환불 확인: 7장의 관리자 API를 호출합니다 → 개발자센터 결제 내역에서 취소를 확인합니다.
6. 웹훅을 로컬에서 받기: `cloudflared tunnel --url http://localhost:4000`(또는 ngrok)으로 공개 URL을 만듭니다 → 개발자센터 웹훅에 `{공개 URL}/api/v1/payments/webhooks/toss`를 등록합니다 → 결제를 취소한 뒤 `webhook_events` 테이블을 확인합니다.

### 6.4 포트원

1. 콘솔에서 **테스트 채널**을 추가합니다. 상점 ID, 채널 키, V2 API Secret, 웹훅 시크릿을 `.env`에 넣습니다.
2. 프론트에서 `paymentId: checkout.orderId`로 결제한 뒤 confirm을 호출합니다.
3. 서명된 웹훅을 손으로 보내 보기:

```bash
BODY='{"type":"Transaction.Cancelled","timestamp":"2026-10-12T00:00:00Z","data":{"paymentId":"ORD-…","storeId":"store-…"}}'
node -e '
const c=require("crypto"),[s,b]=process.argv.slice(1),id="msg_local_1",ts=Math.floor(Date.now()/1000);
const sig=c.createHmac("sha256",Buffer.from(s.replace(/^whsec_/,""),"base64")).update(`${id}.${ts}.${b}`).digest("base64");
console.log(`-H "webhook-id: ${id}" -H "webhook-timestamp: ${ts}" -H "webhook-signature: v1,${sig}"`)' "$PORTONE_WEBHOOK_SECRET" "$BODY"
# 출력된 헤더를 붙여서:
curl -X POST http://localhost:4000/api/v1/payments/webhooks/portone -H 'Content-Type: application/json' <헤더들> -d "$BODY"
```

### 6.5 Apple

- **Sandbox 테스터 계정**(App Store Connect → 사용자 및 액세스 → Sandbox)이나 TestFlight로 구매합니다. 서버는 운영 API에서 404가 나면 샌드박스 API를 자동으로 다시 조회합니다.
- Xcode의 **StoreKit Configuration 파일로 만든 로컬 거래는 Apple 서버에 없어서** 서버 검증이 404로 끝납니다. 이 경우는 목업 영수증을 씁니다.

### 6.6 Google

- 라이선스 테스터 계정으로 **내부 테스트 트랙** 빌드를 설치하고 테스트 카드로 구매합니다. 이렇게 얻은 purchaseToken으로 verify를 호출합니다.
- 테스트 구매에는 `orderId`가 없습니다. 이때 거래 ID는 `TEST-{구매 토큰 해시}`이고, `raw.purchaseType`은 0입니다.

---

## 7. 환불 정책 연동 포인트

**API**: `POST /api/v1/admin/orders/:id/refund`

- 인증: `x-admin-token: {ADMIN_API_TOKEN}` 헤더, 또는 admin 역할 JWT
- 본문: `{ "reason": "고객 요청 환불(1~200자)" }`

```bash
curl -X POST http://localhost:4000/api/v1/admin/orders/ORD-20261012-ABCDEF123456/refund \
  -H "x-admin-token: $ADMIN_API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"reason":"리포트 생성 실패로 자동 환불"}'
```

처리 순서(`service.refund`):

1. 주문이 `paid`인지 확인합니다.
2. 인앱결제 주문이면 거절합니다. 인앱결제 환불은 Apple과 Google이 처리합니다.
3. `gateway.cancel(전액)`으로 결제사 취소를 요청합니다.
4. 주문을 `refunded`로 바꾸고, 열람권을 삭제하고, 유상 질문권 중 남은 범위를 회수합니다.

어댑터 동작:

- 토스는 `Idempotency-Key`를 붙여 같은 결제·같은 금액의 재시도가 이중 취소되지 않게 합니다.
- 토스와 포트원 모두 '이미 취소됨' 응답을 성공으로 봅니다. 그래서 관리자 API를 다시 호출해도 안전합니다.
- 부분 취소는 어댑터가 `amount`로 지원하지만, 서비스와 관리자 API는 아직 전액 환불만 합니다.

정책과 연결되는 지점:

- **리포트 생성 실패 시 자동 환불**(리서치 5.5): 리포트 모듈이 생성 실패 시 `commerce.refund(orderId, reason)`을 호출하면 됩니다.
- 청약철회 제한 고지(생성 시작 후 원칙적 환불 불가, 장애 시 7일 이내 예외)는 약관과 결제 화면에 표시합니다.
- 질문권 환불은 **유상 미사용분만** 계산합니다. 무상분(`source=free`)은 환불 대상이 아닙니다.
- CS 환불은 관리자 API로 진행하는 것이 원칙입니다. 결제사 관리자 화면에서 직접 취소해도 웹훅으로 지급분이 회수되지만, **웹훅이 등록돼 있어야 합니다**.

---

## 8. 운영 전 확인 사항 / 알려진 제약

- [ ] 운영 키(`live_…`)로 교체했는지, 테스트 키가 운영에 남아 있지 않은지 확인합니다.
- [ ] 결제위젯이나 포트원 채널에서 **가상계좌를 꺼 둡니다**. 입금 완료 웹훅으로 지급하는 흐름이 아직 없습니다.
- [ ] 포트원 프론트가 `paymentId = orderId` 규칙을 지키는지 확인합니다.
- [ ] 앱이 서버 검증 후 `finish()` / `consumeAsync()`를 호출하는지 확인합니다. Google은 3일 안에 확인하지 않으면 자동 환불합니다.
- [ ] Apple 샌드박스 거래도 운영 서버에서 통과합니다(App Review 때문에 필요한 동작). `raw.environment`로 구분할 수 있습니다.
- [ ] 서버 시계를 NTP로 동기화합니다. 웹훅 ±5분 검증과 Apple·Google JWT에 영향을 줍니다.
- 미구현 / TODO
  - App Store Server Notifications V2와 Google RTDN: 스토어 환불을 반영하지 못합니다.
  - Apple JWS x5c 인증서 체인 검증: 서버 API 응답만 쓰기 때문에 지금은 필요 없고, 알림을 받기 시작할 때 필수입니다.
  - Google 구독 검증(`purchases.subscriptionsv2`): 구독은 2차 출시입니다.
  - **(확인 필요) 웹훅 `paid` 복구 시 금액 대조.**
    - 포트원은 브라우저에서 결제가 끝나기 때문에, 사용자가 `totalAmount`를 조작한 결제건도 `PAID` 웹훅이 옵니다.
    - 복구 경로에서는 주문 금액과 대조하지 않으므로 서비스에 금액 검증을 추가해야 합니다.
    - 어댑터는 `raw.verified.amount.total`(포트원)과 `raw.verified.totalAmount`(토스)에 검증된 금액을 넣어 둡니다.


---

## 토스페이먼츠 샌드박스 실연동 검증 (2026-10-12, 팀장)

토스페이먼츠 공식 샘플 저장소([tosspayments-sample](https://github.com/tosspayments/tosspayments-sample))에 공개된 **API 개별 연동 테스트 키 쌍**으로 실제 샌드박스와 연동해 확인했습니다. 테스트 환경이라 실제 출금은 없습니다. 키는 저장소에 넣지 않고 실행 시 환경변수로만 전달했습니다.

```bash
cd apps/api
PAYMENT_PROVIDER=toss \
TOSS_CLIENT_KEY=test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq \
TOSS_SECRET_KEY=test_sk_zXLkKEypNArWmo50nX3lmeaxYG5R \
DATABASE_PATH=./data/toss-sandbox.db npx tsx src/server.ts
# 다른 터미널: npm run dev:web → 상점에서 구매
```

| 확인 항목 | 결과 |
|---|---|
| `/config` 에 클라이언트 키 노출, 주문 생성(`provider: toss`, successUrl/failUrl) | ✅ |
| 웹 `openToss()` → 토스 SDK 로드 → **실제 샌드박스 결제창** 진입(`payment-gateway-sandbox.tosspayments.com`), 금액 3,900원·주문명·이메일 표시 | ✅ |
| 카드사 선택 → 할부 → 약관 동의 → **카드사 인증 페이지(신한카드 ACS)로 전환** | ✅ (카드사 실인증은 실물 카드 필요 — 미진행) |
| 서버 승인 API 실호출: 존재하지 않는 결제키로 `POST /payments/confirm` → 토스가 `NOT_FOUND_PAYMENT_SESSION` 응답 → 우리 API `402 PAYMENT_FAILED` + 토스 메시지 전달, 주문 `failed`, 지급 0 | ✅ (시크릿 키 Basic 인증 통과 = `UNAUTHORIZED_KEY` 아님) |

**운영 전 남은 확인**: 상점 계약 후 발급받은 본인 테스트 키로 카드 인증까지 완료하는 결제 1건, 웹훅 수신(공개 URL 필요), 부분 취소.
