# 결제 · 상점 · 환불

## 목적

유료 리포트·풀이와 AI 상담 질문권을 팔고, 돈을 받은 만큼 정확히 한 번 지급하고, 환불되면 지급분을 거둬들이는 것이 목적이다. 결제사는 채널마다 다르다.

- 웹은 그로블 결제창을 쓴다. 사업자 등록 없이 판매할 수 있는 링크형 결제라서 골랐다(2026-10-15 결정). 대신 승인·취소·조회 API 가 없어 서명된 웹훅만으로 확정하고, 같은 링크로 두 번 결제하는 것을 그로블이 막지 않는다. 이 두 가지가 이 문서의 규칙 대부분을 만든다.
- 앱은 App Store·Google Play 인앱결제만 쓴다. 디지털 콘텐츠는 스토어 정책상 외부 결제를 쓸 수 없다.
- 토스페이먼츠·포트원 V2 는 대안 코드로 남겨 두었다. `PAYMENT_PROVIDER` 를 바꾸면 전환된다.

금액은 언제나 서버가 정한다. 클라이언트가 보낸 금액은 대조용일 뿐이고, 결제사가 확인해 준 금액을 다시 주문 금액과 맞춰 본다.

| 기능 | 운영 상태 (FEATURES.md §0.2 기준, 2026-11-25) |
|---|---|
| 웹 그로블 결제 · 상점 · 결제 시트 · 보관함 · 결제 내역 · 관리자 API | 운영 중(그로블 결제창 15개 연결 완료) |
| App Store · Google Play 인앱결제와 스토어 환불 알림 | 앱 전용(앱 출시 전, 키 없음) |
| 토스페이먼츠 · 포트원 V2 | 대안 코드만 있음(운영에서 꺼짐) |
| mock 결제 | 개발 전용. 운영 모드에서 `PAYMENT_PROVIDER=mock` 이면 기동하지 않는다 |
| 운영 알림(`OPS_ALERT_WEBHOOK_URL`) | 켜짐(2026-11-26 운영 시크릿 목록에서 확인). 없으면 로그만 남는다 |
| 토스 미니앱 인앱결제 | 보류. [toss-miniapp.md](./toss-miniapp.md) |

결제사 가입·키 발급·결제창 만들기·스토어 심사 절차는 [../PAYMENTS.md](../PAYMENTS.md) §3·§4, 키 목록은 [../ENV_KEYS.md](../ENV_KEYS.md) §2, 수수료와 상품별 남는 돈은 [../COSTS.md](../COSTS.md) §3·§4(웹 약 4.84%, 앱 15%)를 본다.

## 사용자 흐름

| 화면 | 주소 | 들어오는 곳 |
|---|---|---|
| 결제 시트 | 각 화면의 잠금 섹션·리포트 카드 | `PaywallSheet` |
| 상점 | `/store` | 데스크톱 메뉴 '이용권', 마이, 결제 내역 |
| 결제 확인 · 실패 | `/payments/success`, `/payments/fail` | 결제창 복귀, 진행 중인 결제 안내 |
| 리포트 보관함 | `/my/reports` | 마이, 내 사주 |
| 결제 내역 | `/my/payments` | 마이, 마이의 질문권 잔액 |

**웹(그로블)**

1. 구매 버튼을 누르면 회원인지 먼저 본다. 게스트면 `/login?next=…&reason=purchase` 로 보낸다([auth.md](./auth.md)). 리포트 상품은 누구의 리포트인지 프로필을 고른다.
2. `POST /orders` 가 주문을 만들고 그 상품의 그로블 결제창 링크에 `?ref=<접두어>-<주문 ID>` 를 붙여 돌려준다. 웹은 주문 ID·돌아갈 경로·대상을 저장소(`pendingCheckout`)에 적고 같은 탭에서 결제창으로 간다.
3. 결제창의 진입 페이지와 이동 페이지는 모두 `/payments/success?provider=groble` 이다. 돌아온 화면은 저장한 주문을 2초마다 최대 90초 동안 조회한다. 시간 안에 확정되지 않으면 '다시 확인'과 결제 내역 버튼을 보여 준다. 결제하지 않고 돌아온 사용자는 '결제하지 않고 돌아가기'로 나가고, 이때 주문은 `failed(USER_CANCEL)` 로 닫힌다(실제로 결제했다면 늦게 온 웹훅으로 그대로 지급된다).
4. 그로블이 `payment.completed` 웹훅을 보내면 서버가 검증한 뒤 지급하고, 화면이 완료로 바뀌어 원래 읽던 화면(`returnTo`)으로 돌아간다.
5. 결제 확인을 기다리다 구매 버튼을 다시 누르면 새 주문 대신 409 `PAYMENT_IN_PROGRESS` 를 받고 같은 주문의 확인 화면(`/payments/success?resume=1`)으로 간다. 거기서 "결제하지 않았어요, 결제창 다시 열기"를 누르면 같은 주문·같은 ref 로 결제창을 다시 연다.

**웹(토스·포트원 대안)**: 결제창 복귀 뒤 `/payments/success` 가 `POST /payments/confirm` 으로 서버 승인을 요청한다. 실패·취소는 `/payments/fail` 이 `POST /payments/fail` 로 기록한다.

**앱(인앱결제)**: 스토어 결제창을 띄우기 전에 `POST /payments/iap/check` 로 살 수 있는지 확인한다(판매 중지·출시 예정·한도 초과·이미 가진 콘텐츠·대상 오류면 결제를 시작하지 않는다). 스토어 구매 뒤 앱이 영수증(iOS transactionId, Android purchaseToken)을 `POST /payments/iap/verify` 로 보내고, 서버 검증이 성공한 뒤에만 `finish`·`consume` 한다. 서버가 지급을 거절하면 응답의 `details.finish` 를 따른다(아래 「인앱결제」). 앱은 결제마다 대상(프로필·리딩) 기록을 한 건씩 남기고(`yd.iapPendingTargets`, 영수증을 받으면 그 건에 붙인다), 검증 전에 앱이 꺼진 거래는 다음 실행·복귀 때 `recoverInAppPurchases` 가 그 기록으로 다시 검증한다. 앱 쪽 연결: [../APP_PORTING.md](../APP_PORTING.md) §7.

**상점 구성**: '사주 리포트'(미니·평생·신년운세·궁합·신년 패키지), '주제별 리포트', 'AI 상담 질문권' 세 묶음이다. 타로·택일 상품은 결과 하나를 여는 상품이라 상점에 나오지 않고 각 결과 화면의 결제 시트에서만 판다. 이미 산 주제별 리포트는 '보고서 열기'로 바뀌고, 계정당 한도를 다 쓴 상품은 '구매 완료'로 비활성화된다. 결제 시트는 "이용약관(제5조 청약 철회와 환불 포함)에 동의" 문구를 보여 준다([legal.md](./legal.md)).

## 관련 파일

- 상품·주문·지급·환불: `apps/api/src/modules/commerce/catalog.ts`, `apps/api/src/modules/commerce/service.ts`, `apps/api/src/modules/commerce/routes.ts`
- 결제사: `apps/api/src/modules/commerce/providers/`(`groble.ts`, `toss.ts`, `portone.ts`, `mock.ts`, `iap.ts`, `appleJws.ts`, `storeNotifications.ts`, `types.ts`, `index.ts`)
- 토스 미니앱(보류): `apps/api/src/modules/commerce/tossIap.ts`, `apps/api/src/modules/commerce/tossCatalog.ts`
- 원자적 쓰기·시드: `apps/api/src/db/atomic.ts`, `apps/api/src/db/seed.ts`, `apps/api/src/db/schema.ts`
- 요청 ID 선점·운영 알림: `apps/api/src/lib/requestClaim.ts`, `apps/api/src/lib/alert.ts`, `apps/api/src/modules/ops/service.ts`(`checkPendingPayments`), `apps/api/src/worker.ts`(10분 예약 실행)
- 웹: `apps/web/src/lib/payments/index.ts`(`startCheckout`, `recoverInAppPurchases`), `apps/web/src/lib/payments/iapTargets.ts`(앱 결제 복구 대상 기록), `apps/web/src/lib/payments/providers.ts`, `apps/web/src/hooks/usePurchase.ts`, `apps/web/src/components/PaywallSheet.tsx`, `apps/web/src/pages/StorePage.tsx`, `apps/web/src/pages/PaymentResultPages.tsx`, `apps/web/src/pages/PaymentsPage.tsx`, `apps/web/src/pages/ReportsPage.tsx`
- 앱: `apps/web/src/native/purchases.ts`, `apps/web/src/native/index.ts`
- 테스트: `apps/api/test/commerce-rules.test.ts`(공유 권한 환불·한도 초과 상태·인앱결제 거절과 복구), `apps/api/test/groble.test.ts`, `payments.providers.test.ts`, `duplicate-payment.test.ts`, `idempotency.test.ts`, `store-notifications.test.ts`(가짜 인증서 체인 `test/helpers/appleChain.ts`), `toss-iap.test.ts`, `concurrency.test.ts`, `catalog.test.ts`, `security.test.ts`, `apps/web/src/lib/payments/__tests__/`(`iap.test.ts` 포함), `apps/web/src/pages/__tests__/PaymentResultPages.test.tsx`

## API / 데이터 모델

요청·응답 형식은 [../API.md](../API.md) 「커머스」 표를 본다.

**카탈로그**(`catalog.ts` 가 원본, 가격은 원·VAT 포함)

| 상품 ID | 가격 | 지급 권한 | 질문권 | 비고 |
|---|---:|---|---:|---|
| `report_saju_mini` | 990 | `report:mini:<프로필>` | 0 | 계정당 1회(`perUserLimit=1`) |
| `report_saju_lifetime` | 9,900 | `report:lifetime:<프로필>` | 3 | |
| `report_newyear_2027` | 5,900 | `report:yearly:<프로필>:2027` | 0 | 기한 없이 같은 가격(2026-11-26 결정, 연말 인상 없음) |
| `report_compat` | 5,900 | `report:compatibility:<a>:<b>`(정렬) | 0 | 상대가 없으면 1회권 `ticket:compatibility:<주문>` |
| `report_love`, `report_career_wealth` | 각 4,900 | `report:<종류>:<프로필>` | 0 | |
| `bundle_newyear_2027` | 16,900 | 평생 + 2027 신년 + 궁합 1회권 | 10 | |
| `chat_pack_10`, `chat_pack_30` | 3,900 / 9,900 | 없음 | 10 / 30 | `credit_pack` |
| `tarot_question_3`, `tarot_choice_3` | 각 990 | `tarot:reading:<리딩>` | 1 | `readingId` 필수 |
| `tarot_love_5`, `tarot_compat_5` | 각 2,900 | `tarot:reading:<리딩>` | 1 | `readingId` 필수 |
| `tarot_celtic_10` | 4,900 | `tarot:reading:<리딩>` | 3 | `readingId` 필수 |
| `report_taekil` | 990 | `taekil:reading:<택일 결과>` | 0 | `readingId` 필수, 그 결과 하나만 열림 |

- 카탈로그는 Worker 인스턴스의 첫 요청 때 `app_meta.catalog_hash` 가 바뀌었을 때만 `products` 에 다시 넣는다. 카탈로그에서 뺀 상품은 지우지 않고 `active=false` 로 둔다(지난 주문이 참조한다).
- 상품별 화면·무료 범위는 [reports.md](./reports.md), [compatibility.md](./compatibility.md), [tarot.md](./tarot.md), [taekil.md](./taekil.md), 질문권 사용은 [ask.md](./ask.md)·[dream.md](./dream.md)를 본다.

**테이블**

- `orders`: 상태는 `pending | paid | failed | canceled | refunded` 다. `(provider, provider_payment_key)` 유니크가 같은 결제의 재사용을 막는다. `metadata` 에는 대상(`profileId`, `partnerProfileId`, `readingId`)과 결제 확인 화면 첫 조회 시각(`firstPolledAt`), 결제 확인 대기 표시(`awaitingAt`, `delayAlerted`), 반복 결제 표시(`repeatOf`)가 들어간다.
- `entitlements`: `(user_id, key)` 유니크다. `order_id` 로 어느 주문이 준 권한인지 기록해 환불 때 그 주문분만 지운다. 두 주문이 같은 키를 주면(평생 사주분석서와 신년 패키지 등) 행은 먼저 지급한 주문 ID 로 하나만 남으므로, 그 주문을 회수할 때 같은 키를 주는 다른 `paid` 주문이 있으면 지우지 않고 그 주문 ID 로 넘긴다. 1회권은 사용할 때 실제 키로 바뀌며 원래 주문 ID 를 물려받는다.
- `credit_ledger`: `reason`(purchase·consume·refund·bonus·admin), `source`(paid·free), `channel`(web·ios·android·toss·system), `ref_type`·`ref_id`(주문 `order`, 상담 `chat`, 꿈풀이 `dream`, AI 장애 환급 `ai_refund`)를 남긴다. `users.credits` 는 합계, `users.paid_credits` 는 유상분이다.
- `webhook_events`: 기본 키 하나로 여러 용도를 겸한다. `<결제사>:<이벤트 ID>`(웹훅·스토어 알림 중복 방지, `processed_at` 이 있어야 처리 완료), `<결제사>:voided:<결제 키>`(먼저 환불된 결제 표시), `<결제사>:duplicate:<결제 키>`(지급하지 않은 결제 기록, `event_type=DUPLICATE_PAYMENT`), `<종류>:<사용자>:<요청 ID>`(상담·꿈풀이 요청 ID 선점)다. 그로블 알림 사본에서는 구매자 이름·연락처·설문 답·카드번호를 지운다.

## 비즈니스 규칙 & 엣지케이스

**주문 생성(`createOrder`)**

- 게스트는 403(`reason: LOGIN_REQUIRED`)이다. 웹은 403 을 받으면 로그인 화면으로 보낸다.
- 리포트 상품은 내 프로필이, 궁합은 상대도 내 프로필이어야 한다. 타로·택일 상품은 내 결과 ID 이고 펼침 방식·상품이 맞아야 한다.
- 계정당 한도를 넘었으면 409 다. 결제사가 설정되지 않았거나, 그로블 결제창이 연결되지 않은 상품은 주문을 만들기 전에 501 `NOT_CONFIGURED` 다.
- 같은 대상으로 이미 가진 리포트·풀이는 409 `ALREADY_OWNED` 다. 리포트에 덤으로 딸린 질문권은 따지지 않고, 질문권 팩과 1회권이 든 상품(신년 패키지·상대 없는 궁합)은 해당하지 않는다.
- 결제창 링크형 결제사(그로블)에서만, 같은 상품·같은 대상·같은 금액의 미결 주문이 30분(`CHECKOUT_RESUME_WINDOW_MS`) 안에 있으면 409 `PAYMENT_IN_PROGRESS { orderId, amount, productId }` 다. `resumeOrderId` 가 그 주문이면 같은 주문의 결제창을 다시 준다. 이어서 결제하려던 주문이 그사이 확정됐으면 409 `ALREADY_PAID` 다.
- 두 탭에서 동시에 주문하면 주문을 넣은 뒤 다시 조회해 가장 먼저 만든 것만 남기고 나머지는 `canceled(DUPLICATE_CHECKOUT)` 와 409 로 끝낸다.
- 가격은 고정이다(2026-11-26 사용자 결정). 어떤 상품에도 정가 취소선(`listPrice`)·할인 배지·기한 있는 가격을 두지 않는다. `apps/api/test/catalog.test.ts` 가 이를 검사한다.
- 금액은 `currentPrice` 다. `saleEndsAt` 이 지나면 정가(`listPrice`)로 파는 장치는 남아 있지만, 지금 카탈로그에 `saleEndsAt` 이 있는 상품은 없다(날짜에 따라 가격이 오르는 상품이 없어 그로블 결제창 가격을 날짜에 맞춰 바꿀 일이 없다). `catalog.test.ts` 가 이것을 확인한다.

**지급(`settle`)**: 웹 승인·웹훅·인앱결제가 모두 이 함수를 지난다. `atomic` 하나에서 아래 조건을 실행 시점에 다시 확인하고, 하나라도 깨지면 batch 전체를 취소하고 처음부터 다시 판단한다([../architecture.md](../architecture.md) 「D1 동시성」).

- 주문이 아직 `pending` 이나 `failed` 다. 그래서 동시 승인·웹훅 경쟁에서도 지급은 정확히 1회다.
- 계정당 구매 횟수가 한도 미만이다. 주문 생성 때만 확인하면 주문을 여러 개 만들어 우회할 수 있다.
- 이 결제 키의 무효 표시(`voided`)가 없다. 환불 알림이 완료 알림과 겹쳐도 환불된 결제를 지급하지 않는다.
- 통과하면 주문 `paid`, 권한 지급, 유상 질문권 적립(원장 `channel` 은 결제 채널)을 한 batch 로 쓴다. 토스 미니앱 결제는 리포트·타로에 딸린 질문권을 주지 않는다(질문권 팩은 준다).
- batch 가 끝난 뒤에만 결제 완료 운영 알림과 지급 알림을 보낸다. 지급 알림은 산 리포트를 미리 만드는 데 쓰이고([reports.md](./reports.md)), 실패해도 결제 응답을 깨지 않는다.

**웹 승인(토스·포트원)**: 요청 금액이 주문 금액과 다르면 주문을 `failed(AMOUNT_MISMATCH)` 로 두고 400 이다. 결제사 승인 뒤 확인된 금액이 다르면 결제를 취소한다. 결제사 오류는 402 `PAYMENT_FAILED { code }` 인데, 그사이 다른 요청이 확정했으면 완료로 응답한다. 한도 초과면 결제를 취소하고 409 `{ reason: PER_USER_LIMIT }` 다. 주문 상태는 모든 결제 경로에 공통인 규칙을 따른다: 결제사에서 결제를 취소했으면 `canceled(PER_USER_LIMIT)`, 취소하지 못해 돈이 결제된 채 남았으면 `failed(PER_USER_LIMIT)` 와 운영 알림이다(그로블 웹훅은 취소 API 가 없어 항상 `failed`, 인앱결제는 스토어 환불 대상이라 `failed`). 결제사별 검증(토스 재조회, 포트원 `paymentId = orderId` 규칙과 원화 확인, 가상계좌 미지원)은 [../PAYMENTS.md](../PAYMENTS.md) §1·§2·§5 를 본다.

**그로블 웹훅**

- 서명은 `HMAC-SHA256(secret, "{timestamp}.{원문}")` 이고 시각은 ±5분이다. 시크릿 교체 중 24시간은 이전 시크릿 서명도 받는다. 서명 실패는 400(그로블이 다시 보내지 않음), 처리 오류는 5xx(그로블이 최대 7회 다시 보냄)다. 410 은 그로블이 엔드포인트를 꺼 버리므로 쓰지 않는다.
- 같은 이벤트 ID 는 `processed_at` 기준으로 한 번만 처리한다. 처리 중 오류로 끝난 이벤트는 재전송 때 다시 처리한다. 이벤트 ID 만 바꿔 다시 온 같은 결제는 주문 상태로 걸러진다.
- `GROBLE_REF_PREFIX` 가 다른 결제 완료 알림은 같은 그로블 계정을 쓰는 다른 서비스의 것으로 보고 기록만 한다. ref 없이 링크로 바로 산 결제도 200 으로 받고 기록만 한다.
- `payment.completed` 가 미결 주문에 오면 다음 순서로 판정한다.
  1. 이 결제 키가 이미 환불 표시돼 있으면 지급하지 않고 `refunded(REFUNDED_BEFORE_PAID)` 로 닫는다. 그로블은 알림 순서를 보장하지 않는다.
  2. 금액(`pricing.finalAmount`)이나 결제창(`content.id`)이 다르면 `failed(WEBHOOK_AMOUNT_MISMATCH·WEBHOOK_PRODUCT_MISMATCH)` 와 운영 알림이다. 그로블에서 쿠폰·할인을 켜거나 우리 가격이 바뀐 날 결제창 가격을 같이 바꾸지 않으면 이렇게 된다.
  3. 다른 주문으로 이미 받은 콘텐츠면 `failed(ALREADY_OWNED)`, 기록, 운영 알림이다.
  4. 한도 초과면 결제 취소를 시도한다. 그로블은 취소 API 가 없어 `failed(PER_USER_LIMIT)` 와 운영 알림이다(취소에 성공하는 결제사라면 `canceled`, 위 「웹 승인」의 상태 규칙).
  5. 나머지는 지급한다. 결제 키(`merchantUid`)를 주문에 저장해 환불 알림과 연결한다.
- 이미 지급된 주문에 다른 결제 키의 `payment.completed` 가 오면 같은 링크로 한 번 더 결제한 것이다. 질문권 팩이고 금액·결제창이 같으면 그 결제를 새 주문(`metadata.repeatOf`)으로 지급한다. 새 주문에 결제 키를 먼저 붙여(유니크) 같은 알림이 여러 번 와도 1회다. 그 밖의 상품은 지급하지 않고 `DUPLICATE_PAYMENT` 기록과 운영 알림을 남긴다(결제 키마다 1회). 지급된 주문을 실패로 덮어쓰지 않는다.
- `payment.refunded` 에는 ref 가 없어 결제 키로 주문을 찾는다. 전액 환불이면 회수한다. 부분 환불은 회수할 양을 운영자가 정하도록 운영 알림만 보낸다. 주문을 못 찾았거나 아직 지급 전이면 결제 키에 무효 표시를 남기고, 표시 직전에 지급이 끝났으면 바로 회수한다. 어느 순서로 겹쳐도 최종 결과는 `refunded` 와 지급 없음이다.
- `payment.cancel_requested` 와 정기결제 이벤트는 판매자가 그로블에서 처리할 일이라 기록만 한다.
- 지금 운영 구성에서는 그로블 웹훅 주소가 스토어당 하나라 같은 계정을 쓰는 다른 서비스 서버가 먼저 받아, 자기 결제가 아닌 알림을 본문·서명 헤더 그대로 달달사주로 넘긴다. 두 Worker 가 같은 시크릿을 쓰므로 그로블에서 시크릿을 재발급하면 24시간 안에 두 Worker 모두 바꿔야 한다. 주소와 설정은 [../PAYMENTS.md](../PAYMENTS.md) §1.0 을 본다.

**인앱결제**

- 결제 전 확인(`POST /payments/iap/check`): 게스트 403, 검증 키 없음 501, 판매 중지(`active=false`)·출시 예정은 409 `NOT_FOR_SALE`, 계정당 한도 초과는 409 `PER_USER_LIMIT`, 같은 대상으로 이미 가진 콘텐츠는 409 `ALREADY_OWNED`, 대상 프로필·리딩 오류는 400 이다. 아직 결제 전이라 환불 안내는 붙이지 않는다.
- 검증(`POST /payments/iap/verify`): 게스트는 403 이다. 스토어 상품 ID 로 카탈로그 상품을 찾고 스토어 서버 API 로 영수증을 검증한다(Apple 은 x5c 체인을 내장 Apple Root CA - G3 까지 검증하고 bundleId·environment·productId·환불 여부를 대조한다). 결제는 이미 끝난 뒤라 이 거래의 주문이 있으면 대상 확인보다 먼저 그 주문의 최종 상태로 답한다. 지급했으면 200, 지급하지 않았으면 처음과 같은 거절이다. 다른 계정이 같은 거래를 쓰면 409 다.
- 처음 보는 거래는 대상을 확인한다. 리포트 상품인데 대상 프로필이 오지 않았으면(복구 때 대상 기록을 잃은 경우) 대표 프로필(없으면 가장 먼저 저장한 프로필)로 채우고, 저장한 사주가 없으면 400 이다. 이 400 에는 `finish` 가 없어 거래가 남고, 사주를 저장한 뒤 앱을 다시 열면 복구된다.
- 결제 전 확인과 같은 사유(판매 중지·한도 초과·이미 가진 콘텐츠)에 걸리면 주문을 `failed(<사유>)` 로 남기고 지급하지 않는다. 스토어 환불 알림이 먼저 온 거래는 402 `REVOKED` 다. 지급 단계에서 한도 초과·환불 표시가 확인돼도 같은 거절이 된다.
- 거절 응답의 `details` 는 `{ reason, finish }` 다(`REVOKED` 는 `code: 'REVOKED'` 도 있다). iOS 는 `finish=true` 다. 끝내지 않은 소모성 거래는 저절로 환불되지 않고 앱을 열 때마다 다시 검증되므로, 앱은 지급 없이 거래를 끝내고 메시지는 App Store 구매 내역에서 환불을 요청하라고 안내한다. 운영자에게도 거래마다 한 번 알린다(`iap_apple:duplicate:<거래 ID>`). Android 는 `finish=false` 다. 앱이 거래를 그대로 두면 Google 이 3일 안에 확인(acknowledge·consume)하지 않은 구매를 자동 환불하므로 메시지는 그렇게 안내한다. 이미 환불된 거래(`REVOKED`)는 두 플랫폼 모두 `finish=true` 다.
- 리딩 상품의 대상 리딩 ID 를 잃은 거래는 서버가 채울 수 없어 400 이 반복된다. 앱이 결제마다 대상 기록을 남기므로 저장소를 지운 경우에만 생긴다.

**스토어 환불 알림**: Apple `REFUND`·`REVOKE` 와 Google `voidedPurchaseNotification` 은 지급분을 회수하고 거래 ID 에 무효 표시를 남긴다. Apple `REFUND_REVERSED` 는 주문을 `paid` 로 되돌리고 권한과, 환불 때 회수했던 만큼의 질문권만 다시 준다. 그 밖의 유형과 우리 주문이 없는 알림은 기록만 하고 200 이다. 거부 사유는 응답에 넣지 않고 서버 로그에만 남긴다. 알림 ID(notificationUUID, Pub/Sub messageId)로 멱등이다. 알림별 처리표: [../PAYMENTS.md](../PAYMENTS.md) §5.1.

**환불과 회수**

| 결제 경로 | 환불하는 곳 | 지급분 회수 |
|---|---|---|
| 그로블 | 그로블 판매자 화면(환불 API 없음). 관리자 API 는 400 으로 거절한다 | 전액 `payment.refunded` 웹훅으로 자동. 부분 환불은 알림만 |
| 토스·포트원 | 관리자 API `POST /admin/orders/:id/refund` | 즉시 |
| 인앱결제 | 고객이 Apple·Google 에 요청. 관리자 API 는 400 으로 거절한다 | 스토어 알림으로 자동, 환불 철회 시 복구 |

- 회수(`revokeOrder`)는 `paid` 주문일 때만 조건부로 바꾼다. 관리자 환불·결제사 웹훅·스토어 알림이 겹쳐도 회수는 1회다. 그 주문이 준 권한을 지우되, 같은 키를 주는 다른 `paid` 주문이 있으면 그 주문으로 넘긴다(넘겨받는 주문이 batch 실행 시점에도 `paid` 여야 하므로 두 주문이 동시에 환불되면 다시 판단해 둘 다 지운다). 남은 유상 질문권에서 그 상품의 질문권 수만큼(남은 것보다 많으면 남은 만큼) 뺀다. 이미 쓴 질문권은 거두지 못한다.
- 관리자 환불에서 질문권 팩은 남은 유상 질문권 비율만큼만 부분 취소하고, 모두 썼으면 409 로 환불하지 않는다. 그 밖의 상품은 전액이다. 결제사 어댑터는 부분 취소를 지원하지만 서비스는 이 경우에만 쓴다.
- 환불된 리포트는 보관함에서 빠지고 열면 402 다([reports.md](./reports.md)).
- 리포트 생성 실패 시 자동 환불은 구현하지 않았다. 결제가 확정되면 규칙 기반 본문을 바로 저장하고 AI 다듬기가 실패해도 그 본문으로 마무리하므로 상품이 비는 경우가 없다. 장애로 열람하지 못한 경우는 운영자가 환불한다.
- 정책 문구(청약철회 제한, 장애 시 7일 이내 예외)는 약관이 정한다([legal.md](./legal.md)).

**질문권 원장**

- 쓸 때는 무상분부터 차감한다. 환불 대상인 유상분을 최대한 남기기 위해서다. 나눈 몫이 실행 시점에도 남아 있는지 `atomic` 조건으로 확인하므로 동시 차감으로 음수가 되지 않는다.
- 같은 요청 ID 의 상담·꿈풀이는 한 번만 차감한다(`requestClaim`). AI 장애 환급은 차감한 몫 그대로(유상분은 유상으로) 사용자당 하루(KST) 5번까지다. 자세한 규칙은 [ask.md](./ask.md)·[dream.md](./dream.md) 에 있다.
- 무상 지급은 관리자 지급, 가입 보너스(운영 0), 앱 보상형 광고(하루 한도를 지급 batch 실행 시점에 확인, [ads-analytics.md](./ads-analytics.md)), 게스트 병합 이동이다.
- 의도된 동작: 유상 질문권은 주문별이 아니라 계정 합계(`paid_credits`)로 관리한다. 팩 두 개를 산 뒤 하나를 환불하면 실제로 어느 팩을 썼는지와 관계없이 남은 유상분에서 그 팩의 질문권 수만큼(남은 것보다 많으면 남은 만큼) 뺀다. 질문권은 서로 구별되지 않는 같은 이용권이라 어느 팩의 것을 썼는지가 고객에게 의미가 없고, 주문별로 나누려면 원장 스키마와 차감 규칙 전체를 바꿔야 해서 합계 방식을 유지한다. 환불 때 이미 쓴 몫을 거두지 못하는 것도 같은 이유다.
- 질문권에는 유효기간이 없다. 인앱결제로 산 크레딧은 만료될 수 없다는 Apple 3.1.1 과 맞춘 것이다.
- 원장 잔액(`balance_after`)은 같은 batch 안에서 갱신 직후 사용자 행을 읽는 서브쿼리로 넣는다. drizzle 의 D1 batch 가 인자 있는 `db.run(sql)` 을 실행하지 못해서 생긴 방식이다.

**결제 확인 지연 감지**: 그로블 결제창의 진입 페이지도 결제 확인 화면이라 결제하지 않고 돌아온 사용자도 주문을 조회한다. 그래서 첫 조회 때는 `metadata.firstPolledAt` 만 남기고, 그 뒤 20초(`AWAITING_MARK_AFTER_MS`) 넘게 화면에 남아 다시 조회할 때(결제했다고 보고 기다리는 경우)에만 `metadata.awaitingAt` 을 남긴다. '결제하지 않고 돌아가기'를 누른 주문은 `failed(USER_CANCEL)` 이 되어 대상에서 빠진다. 10분마다 도는 예약 실행(`checkPendingPayments`)이 `awaitingAt` 뒤 30분이 지나도 `pending` 인 주문을 찾아 한 번(`delayAlerted`) 운영 알림을 보낸다. 결제했는데 웹훅이 오지 않은 경우를 운영자가 그로블 판매자 화면에서 확인하게 하려는 것이다.

**운영 알림**: 결제 완료, 환불·결제 취소 회수, 환불이 필요한 결제(중복 결제, 이미 가진 콘텐츠 재결제, 금액·결제창 불일치, 한도 초과, 결제사 자동 취소 실패), 지급하지 않은 App Store 결제(고객에게 Apple 환불 요청을 안내한 거래), 부분 환불, 결제 확인 지연, 웹훅 서명 검증 실패 때 나간다. 주문 ID·결제 키·금액만 넣고 이메일·연락처는 넣지 않는다. 알림 채널과 하루 요약은 [ops.md](./ops.md) 를 본다.

**관리자 API**: `POST /admin/orders/:id/refund { reason(1~200자) }` 와 `POST /admin/users/:id/credits { amount(1~1000), memo }`(무상 지급) 두 개다. `x-admin-token` 헤더(SHA-256 다이제스트를 상수 시간 비교) 또는 `role=admin` 사용자의 토큰으로 인증한다. 운영에서 `ADMIN_API_TOKEN` 이 32자보다 짧으면 관리자 API 를 끈다. 운영 모드에서 접속 IP 당 60초 20회로 제한한다. 관리자 웹 화면은 없다.

**보관함·결제 내역**: 보관함은 볼 권한이 남은 리포트와 상세가 열린 택일 결과를 최신순으로 보여 주고, 리포트 화면에서 PDF 로 저장한다. 결제 내역은 주문 목록(결제창을 열기만 한 `pending` 주문은 숨긴다)과 질문권 원장(서버는 최근 100건을 주고 화면은 그 가운데 20건)을 보여 주고, 그 아래에 "열람한 리포트는 청약철회가 제한될 수 있고 환불 문의는 고객센터로" 안내를 둔다. 문의처는 `SUPPORT_EMAIL` 다음 `VITE_BIZ_EMAIL` 순서다.

## 주의사항 / 알려진 이슈

1. 그로블 첫 실결제로 웹훅의 `content.id` 가 결제창 링크 ID 와 같은지 확인해야 한다. 다르면 주문이 `WEBHOOK_PRODUCT_MISMATCH` 로 실패하고, `상품ID=링크|콘텐츠ID` 로 고친다(외부 작업, FEATURES.md §22.1 9번).
2. 신년운세는 2027년 상품만 있다. 대상 연도가 KST 10월부터 다음 해로 넘어가므로 2027-09-30 까지 `report_newyear_2028`·`bundle_newyear_2028` 과 그로블 결제창을 추가해야 한다(외부 작업, FEATURES.md §22.2 10번).
3. 해결(2026-11-26): `report_newyear_2027` 의 2027-01-01 가격 인상(7,900원)을 없앴다. 사용자 결정으로 기한 없이 5,900원이고 카탈로그에서 `listPrice`·`saleEndsAt`·'얼리버드' 배지를 뺐다. 그래서 그로블 결제창 가격을 날짜에 맞춰 바꿀 일과 인상 전후 미결 주문의 금액 불일치가 없다. 날짜에 따라 가격이 오르는 다른 상품은 없다(`catalog.test.ts` 가 확인). 미니 리포트·평생 사주분석서·신년 패키지·질문권 30회의 `listPrice` 는 할인 표시용 정가일 뿐 기한이 없다.
4. 죽은 코드(이번에는 유지): 구독 상품이 없어 플러스(`isPremium`, `users.premium_until`)가 될 사용자가 없다. `fulfill` 의 구독 기간 분기, `commerce.isPremium`, 리포트·타로·택일의 "권한 또는 플러스" 판정, 마이 화면의 '플러스' 배지가 남아 있다. 여러 도메인에 걸쳐 있어 따로 정리한다. PRD §2 의 "구독 안 함" 결정과 같아 동작에는 문제가 없다(FEATURES.md §22.2 11번).
5. 운영 Worker 에 `ADMIN_API_TOKEN`·`OPS_ALERT_WEBHOOK_URL` 시크릿이 들어 있다(2026-11-26 `wrangler secret list` 로 이름만 확인). 토큰 길이가 32자 이상인지는 값을 보지 않아 확인하지 않았다(외부 작업, TODO: 확인 필요).
6. 해결(2026-11-26): 결제 내역의 실제 동작(`pending` 주문 숨김, 원장은 서버 100건 중 화면 20건)을 이 문서 「보관함·결제 내역」에 적었다. 예전 FEATURES.md §14 의 설명은 이 문서로 옮겨지며 없어졌다.
7. 해결(2026-11-26): 한도 초과로 지급하지 않은 주문의 상태를 모든 경로에서 같은 규칙으로 맞췄다. 결제사에서 결제를 취소했으면 `canceled(PER_USER_LIMIT)`, 취소하지 못해 결제가 남았으면 `failed(PER_USER_LIMIT)` 와 운영 알림이다. 토스·포트원 승인은 취소 결과에 따라 둘 중 하나가 되고(예전에는 취소 실패도 `canceled` 로 적었다), 그로블 웹훅과 인앱결제는 `failed` 다. SECURITY_REVIEW.md 7번도 고쳤다.
8. 해결(2026-11-26): 같은 권한 키를 두 주문이 줄 때(평생 사주분석서를 산 뒤 신년 패키지를 산 경우 등) 먼저 산 주문을 환불하면 다른 유효 주문의 권한까지 지워지던 문제를 고쳤다. `revokeOrder` 가 지우기 전에 같은 키를 주는 다른 `paid` 주문을 찾아 권한 행의 `order_id` 를 그 주문으로 넘긴다. 회귀 테스트: `commerce-rules.test.ts`.
9. 의도된 동작: 유상 질문권은 계정 합계(`paid_credits`)로 관리한다. 이유는 「질문권 원장」에 적었다.
10. 해결(2026-11-26): 인앱결제에 결제 전 확인(`POST /payments/iap/check`)을 더했고, 검증에도 판매 중지·출시 예정(`NOT_FOR_SALE`)과 이미 가진 콘텐츠(`ALREADY_OWNED`) 확인을 넣었다. 앱은 결제창을 띄우기 전에 확인한다.
11. 해결(2026-11-26): 인앱 거절 안내를 사실에 맞췄다. 거절 응답에 `details.finish` 를 넣어 iOS 는 지급 없이 거래를 끝내고 App Store 환불 요청을 안내하고(운영 알림도 보낸다), Android 는 거래를 그대로 둬 3일 안 자동 환불을 안내한다. 같은 거래를 다시 검증하면 예전에는 실패한 주문을 200 으로 돌려줘 앱이 Android 구매를 소모해 버릴 수 있었는데, 이제 같은 거절을 돌려준다. 대상 프로필을 잃은 복구는 대표 프로필로 채우고, 이미 처리한 거래는 대상 확인 없이 마무리한다.
12. 해결(2026-11-26): 앱의 끊긴 결제 복구 기록을 스토어 상품 ID 키(`yd.iapPendingProfiles`)에서 결제마다 한 건씩 쌓는 목록(`yd.iapPendingTargets`, `lib/payments/iapTargets.ts`)으로 바꿨다. 영수증을 받으면 그 건에 붙이고 복구는 영수증으로 찾으므로 같은 상품을 다른 프로필로 연달아 사다 끊겨도 덮어써지지 않는다. 예전 키는 복구 때 지운다.
13. 일부 해결(2026-11-26): 결제창에서 결제하지 않고 돌아와 바로 떠난 그로블 주문에는 결제 확인 지연 알림이 가지 않게 했다(첫 조회 뒤 20초 넘게 기다린 주문만 `awaitingAt`). '결제하지 않고 돌아가기'를 누르면 주문을 `failed(USER_CANCEL)` 로 닫는다. 남은 것: 결제 확인 화면을 띄워 둔 채 20초 넘게 머문 미결제 사용자에게는 여전히 알림이 간다. 아무 버튼도 누르지 않고 떠난 주문은 `pending` 으로 남는다(결제 알림이 늦게 올 수 있어 시간으로 닫지 않는다). 결제 내역은 `pending` 주문을 숨긴다.
14. 의도된 동작: 같은 그로블 계정을 쓰는 다른 서비스의 환불 알림도 넘어오면 우리 주문이 없어 결제 키에 무효 표시(`groble:voided:…`)만 남는다. 알림 순서가 뒤바뀐 우리 결제를 막으려면 주문이 없어도 표시해야 해서 남는 기록이다. 동작에는 영향이 없다.
15. 막을 수 없는 경우: 결제를 마친 뒤 브라우저 뒤로 가기로 그로블 결제창에 돌아가 다시 결제하는 것은 우리가 막지 못한다. 질문권 팩은 새 주문으로 지급하고, 그 밖의 상품은 운영 알림을 보고 운영자가 그로블에서 환불한다.
16. 해결(2026-11-26): 죽은 코드를 지웠다. 공용 스키마 `orderCreateSchema` 의 `couponCode`·`year` 와 주문 `metadata` 의 같은 값, 상점의 실행되지 않던 택일 상품 분기(`/taekil` 로 이동)를 뺐다.
17. 해결: architecture.md 「권한(entitlement)과 질문권」의 원장 `channel` 목록에 `toss` 가 들어가 있다(2026-11-26 확인).
18. 미구현(출시 뒤 검토): Apple `CONSUMPTION_REQUEST` 소비 정보 회신(고객 동의 절차가 없어 기록만), Apple 인증서 OCSP 폐기 확인, Google Voided Purchases API 정기 대조, Google Play 구매의 서버 측 acknowledge, Google 구독 검증. 내장 Apple Root CA - G3 는 2039-04-30 에 만료된다([../PAYMENTS.md](../PAYMENTS.md) §8, [../SECURITY_REVIEW.md](../SECURITY_REVIEW.md) 「남은 권장 사항」).
19. 토스 미니앱 결제는 환불 알림이 없어 Cron 이 하루 한 번 최근 주문의 환불 여부를 다시 확인한다. 보류 기능이라 [toss-miniapp.md](./toss-miniapp.md) 에서 다룬다.
