# 운영 (알림 · 예약 실행 · 요청 처리 공통 규칙)

> 기준일: 2026-11-26. `feat/cloudflare` 작업 트리의 코드를 기준으로 적었다. 이 문서는 [FEATURES.md](../FEATURES.md) §0.3의 요청 수 제한·본문 크기·오류 형식 항목을 대체하고, [DEPLOY.md §4](../DEPLOY.md)의 운영 알림 설명을 코드 기준으로 보충한다. 시크릿 넣는 법, 배포, 백업·복구 명령은 DEPLOY.md 에 있다. 인증·세션 규칙은 [auth.md](auth.md), 결제 멱등성과 관리자 API 는 [payments.md](payments.md)에 있다.

## 목적

운영자 한 명이 관리 화면 없이 서비스를 지킬 수 있게 한다.

- 돈과 장애에 관한 사건(가입, 결제, 환불, 부분 환불, 환불이 필요한 결제, 결제 확인 지연, AI 장애, 서버 오류, 결제 웹훅 검증 실패)을 Discord 채널로 바로 알린다.
- 매일 08:00 KST 에 어제 하루의 수치를 한 메시지로 요약한다.
- 모든 요청에 같은 규칙(요청 수 제한, 본문 크기, 오류 형식, 로그의 개인정보 제거, 응답 뒤 작업)을 적용하고, 같은 요청이 두 번 와도 질문권을 두 번 쓰지 않게 한다.
- 개인정보가 담길 수 있는 처리 기록(요청 ID 선점, 광고 보상, 결제 웹훅, 로그인 실패 집계)을 보관 기간이 지나면 지운다.

| 기능 | 운영 상태 |
|---|---|
| 운영 알림·어제 요약 | 운영 중. `OPS_ALERT_WEBHOOK_URL` 시크릿이 운영 Worker 에 들어 있다(2026-11-26 시크릿 이름 목록으로 확인). 없으면 로그(`[ops-alert]`)만 남는다 |
| 예약 실행(`0 23 * * *`, `*/10 * * * *`) | 운영 중 |
| 요청 수 제한 | 운영 중(운영 모드에서만). 세션 제한 바인딩 `RATE_LIMIT_SESSION` 은 다음 배포부터 |
| 요청 ID 멱등(AI 상담·AI 꿈풀이) | 운영 중 |
| 서비스 공지(`SERVICE_NOTICES`) | 코드 있음. 운영 값은 비어 있다 |
| 로그(observability) | 운영 중 |

## 사용자 흐름

### 요청 하나가 처리되는 순서

1. Worker 는 `/api/*` 와 `/health` 만 코드로 받고, 나머지 주소는 정적 파일이 낸다([seo.md](seo.md)).
2. 인스턴스(isolate)마다 한 번 설정을 읽고(`loadConfig`) 앱을 조립한다. 첫 요청은 상품 카탈로그 시드(`ensureCatalog`)가 끝날 때까지 기다리고, 시드가 실패하면 다음 요청에서 다시 시도한다.
3. 미들웨어는 응답 뒤 작업 범위 설정(`withBackground`), 보안 헤더(`secureHeaders`), CORS, 본문 1MB 제한(넘으면 413), `/api/v1` 아래에서 IP 요청 수 제한(서버 간 호출 제외), 로그인 요청 응답의 캐시 금지 순서로 돈다. 인증·세션·관리자 경로는 라우트에서 제한을 덧붙인다.
4. 오류는 `app.onError` 가 받는다. `AppError` 는 그 상태와 코드로, 사주 입력 오류(`SajuInputError`)는 400 으로, 500 미만 `HTTPException` 은 그 상태로 답한다. 그 밖의 오류는 `[api] <메서드> <경로>` 로그(개인정보 제거)를 남기고 서버 오류 알림을 걸고, 내부 정보 없는 고정 문구로 500 을 준다. 형식은 `{ error: { code, message, details } }` 이고 코드 목록은 [API.md 머리말](../API.md)에 있다.
5. 처리 중 생긴 알림·집계는 `background()` 로 넘겨 응답을 보낸 뒤 그 요청의 `waitUntil` 안에서 끝낸다.

### 운영자가 받는 알림

| 알림 | 언제 | 할 일 |
|---|---|---|
| 새 회원 가입 | 이메일·소셜·토스 가입, 게스트에서 회원 전환. 게스트 시작과 중복 가입(409)은 알리지 않는다 | 없음 |
| 결제 완료 | 결제가 확정되어 지급했을 때(웹·인앱 모두). 같은 결제창으로 한 번 더 결제한 질문권 팩은 "새 주문으로 지급"을 덧붙인다 | 없음 |
| 환불·결제 취소 | 결제사·스토어·토스·관리자 API 로 환불되어 지급분을 회수했을 때. 관리자의 질문권 팩 부분 취소는 "주문 금액 중 돌려준 금액"으로 적는다 | 없음 |
| 부분 환불 | 결제사가 부분 환불을 알렸을 때. 자동으로 회수하지 않는다 | 회수할 질문권 확인 |
| 환불 필요 | 중복 결제, 이미 가진 콘텐츠 재결제, 금액·상품 불일치, 구매 한도 초과. 지급하지 않았다 | 결제사 판매자 화면에서 그 결제 환불 |
| 결제 확인 지연 | 결제 확인 화면에 머물러 결제를 기다린 주문(`awaitingAt`)에 30분이 지나도 결제 알림이 오지 않았을 때 | 그로블에서 결제 여부 확인, 결제됐으면 웹훅 설정 점검 |
| 결제 웹훅 검증 실패 | 서명이 틀린 결제 알림을 거절했을 때(결제사별 30분 창에 1회) | 웹훅 시크릿이 결제사 설정과 같은지 확인 |
| AI 장애 | Anthropic 잔액 부족·키 오류·요청 한도·서버 장애(종류별 30분 창에 1회) | 잔액 부족이면 콘솔에서 충전 |
| 서버 오류 | 처리하지 못한 500(같은 메서드·경로는 5분 창에 1회) | 로그에서 원인 확인 |
| 같은 알림 N건 더 | 묶음 창이 끝난 뒤, 창 안에 같은 알림이 더 있었을 때. DB 장애 중 인스턴스 메모리로 센 창도 "DB 장애 중 이 인스턴스에서 센 수"로 보낸다 | 위와 같음 |
| 어제 요약 | 매일 08:00 KST | 없음 |

### 예약 실행

| 크론(UTC) | 하는 일 |
|---|---|
| `*/10 * * * *` | 결제 확인 지연 확인, 끝난 묶음 창 정리('N건 더' 알림) |
| `0 23 * * *`(08:00 KST) | 어제 요약, 오래된 기록 정리(하루 집계·요청 ID 선점·광고 보상·결제 웹훅 기록·지난 로그인 실패 집계), 오늘의 운세 푸시(조건부, [push.md](push.md)), 토스 환불 확인(조건부, [toss-miniapp.md](toss-miniapp.md)) |

## 관련 파일

| 구분 | 경로 |
|---|---|
| 알림·집계·요약·정리 | `apps/api/src/modules/ops/service.ts`(`createOpsService`, `once`, `bump`, `refunded`, `partialRefund`, `pushResult`, `dailySummaryText`, `checkPendingPayments`, `flushWindows`, `cleanup`, `routeOf`, `EVENT_RETENTION_MS`) |
| 알림 전송·응답 뒤 작업 | `apps/api/src/lib/alert.ts`(`createOpsAlert` 는 전달 여부를 돌려준다, `withBackground`, `background`, `flushBackground`) |
| 요청 ID 선점 | `apps/api/src/lib/requestClaim.ts`(`createRequestClaims`, `userEventsWhere`, `REQUEST_CLAIM_PROVIDER`), 쓰는 곳 `apps/api/src/modules/chat/service.ts`(`send`), `apps/api/src/modules/dream/service.ts`(`interpret`), 탈퇴 때 지우는 곳 `apps/api/src/modules/users/service.ts`(`deleteAccount`) |
| 요청 수 제한·공용 미들웨어 | `apps/api/src/lib/http.ts`(`rateLimit`, `clientIp`, `RouteKit.sessionLimit`), `apps/api/src/app.ts`(`buildApp`, `RATE_LIMIT_EXEMPT`, `onError`), `apps/api/src/modules/auth/routes.ts`(경로별 제한) |
| 오류 | `apps/api/src/lib/errors.ts`, `apps/api/src/lib/validate.ts`(검증 오류 details 앞 20개) |
| 로그 개인정보 제거 | `apps/api/src/lib/log.ts`(`safeErrorText`) |
| 진입점·예약 실행 | `apps/api/src/worker.ts`(`scheduled`, `DAILY_CRON`, `boot`), `apps/api/wrangler.jsonc`(`triggers`, `ratelimits`, `observability`) |
| 설정 검증·공지 | `apps/api/src/config/env.ts`(`loadConfig`, `OPS_ALERT_WEBHOOK_URL`, `SERVICE_NOTICES`), `apps/api/src/modules/config/routes.ts`(`notices`), `apps/web/src/components/NoticeBar.tsx` |
| 사건을 알리는 곳 | `apps/api/src/modules/users/service.ts`(가입), `apps/api/src/modules/commerce/service.ts`(결제·환불·부분 환불·환불 필요·웹훅 검증 실패), `apps/api/src/modules/ai/service.ts`(`aiFailureKind`, 택일 상세는 `taekil` 로 센다), `apps/api/src/modules/auth/loginThrottle.ts`(로그인 잠금), `apps/api/src/jobs/dailyPush.ts`(푸시 결과) |
| DB | `apps/api/src/db/schema.ts`(`opsCounters`, `users.registeredAt`, `webhookEvents`, `loginFailures`), `apps/api/drizzle/0004_ops_alerts.sql` |
| 웹 요청 ID | `apps/web/src/lib/api.ts`(`chatSend`), `apps/web/src/pages/AskPage.tsx`, `apps/web/src/pages/DreamPages.tsx`, `apps/web/src/lib/uuid.ts` |
| 테스트 | `apps/api/test/ops-alerts.test.ts`, `idempotency.test.ts`, `duplicate-payment.test.ts`, `rate-limit.test.ts` |

## API / 데이터 모델

- **`ops_counters`**(`key`, `value`, `note`, `updated_at`): 키가 `d:<KST 날짜>:<이름>` 이면 하루 집계, `b:<종류>:<창 끝 시각 ms>` 이면 묶음 창이다. 하루 집계 이름은 `server.error`, `ai.fail`, `ai.kind.<report|taekil|chat|tarot|dream>`, `ai.model.<모델>.<calls|in|out|cw|cr>`, `auth.locked`, `webhook.rejected`, `refund.count`, `refund.amount`, `refund.partial.count`, `refund.partial.amount`, `push.<users|skipped|sent|failed|removed>` 다.
- **`users.registered_at`**(마이그레이션 0004): 회원 가입 또는 게스트 전환 시각. 기존 회원은 `created_at` 으로 채웠다(게스트에서 전환한 기존 회원은 전환 시각을 알 수 없다). 하루 요약의 가입·탈퇴·전체 회원 수가 이 값으로 회원을 가른다.
- **`orders.metadata`** 의 `firstPolledAt`(결제 확인 화면의 첫 조회), `awaitingAt`(화면에 머물러 다시 조회한 시각, 그로블처럼 결제창 링크 방식만), `delayAlerted`(지연 알림이 전달된 시각). 표시 규칙은 [payments.md](payments.md).
- **`webhook_events`**: 결제 웹훅·스토어 알림·환불 표시, 광고 보상(`admob:<거래 ID>`, `tossad:*`), 요청 ID 선점 행(`<chat|dream>:<사용자 ID>:<요청 ID>`, provider `app`)을 담는다. 보관 기간은 아래 "기록 정리"에 있다.
- **요청 ID**: `requestId` 는 영문·숫자·`_`·`-` 8~64자(`REQUEST_ID_PATTERN`)이고, 형식이 틀리면 400 이다.
- **`GET /config` 의 `notices`**: `SERVICE_NOTICES` 의 `[{ id, title, body }]`(최대 5개). 비어 있으면 빈 배열이다.

## 비즈니스 규칙 & 엣지케이스

**알림 내용과 전송**

- 알림에는 이메일·이름·연락처·생년월일·질문 내용을 넣지 않는다. 가입 방식, 상품, 금액, 결제사, 주문 번호, 결제 키, 전체 회원 수만 적는다.
- 형식은 Discord 웹훅의 `{"content": "..."}` POST 이고, 앞에 `[달달사주]` 를 붙이며 1,900자에서 자른다. 전송은 5초 제한이고 실패해도 예외를 던지지 않는다. 알림이 결제 처리를 깨면 안 되기 때문이다. 같은 글은 언제나 `[ops-alert]` 로그로도 남는다. 전송 함수는 전달 여부를 돌려주고(웹훅 주소가 없으면 로그만 남기고 전달한 것으로 본다), 결제 확인 지연이 이 값을 쓴다.
- 사용자 요청 중의 알림(가입, 결제 완료, 환불, 서버 오류, AI 장애)은 응답 뒤에 보낸다. 웹훅·예약 실행 안의 알림(환불 필요, 부분 환불, 웹훅 검증 실패, 결제 확인 지연, 어제 요약)은 보낼 때까지 기다린다.

**묶음 창**

- 서버 오류는 5분, AI 장애와 웹훅 검증 실패는 30분 창이다. 창은 시계 기준으로 고정된 구간(5분·30분 단위)이다.
- 창마다 첫 건만 바로 보내고 나머지는 센다. 10분 예약 실행이 끝난 창을 찾아 "같은 알림 N건 더"를 보내고 행을 지운다. 그래서 'N건 더'는 창이 끝나고 최대 10분 뒤에 온다.
- DB 의 한 행을 올려 세므로 인스턴스가 여러 개여도 창마다 한 번이다. DB 를 쓸 수 없으면(그것 자체가 장애) 인스턴스 메모리로 대신 세고, 그 인스턴스의 `flushWindows` 가 끝난 메모리 창도 'N건 더'로 보낸다. DB 조회가 실패해도 메모리 창은 먼저 정리하고, 실패는 `[scheduled] 묶음 알림 정리 실패` 로그로 남는다.
- 서버 오류는 메서드와 경로로 묶는다. ID 모양의 경로 조각(UUID, 숫자 3개 이상이 이어진 조각, 숫자가 섞인 12자 이상 조각)만 `:id` 로 바꾼다. `/api/v1/compatibility` 처럼 숫자 없는 긴 고정 이름은 그대로 둔다.
- AI 장애 종류: 401·403 은 키 오류, 429 는 요청 한도, 400 중 "credit balance" 는 잔액 부족, 연결 실패와 5xx 는 서버 장애다. 그 밖의 400(요청 내용 탓)은 알리지 않는다.

**결제 확인 지연**: 결제 확인 화면이 대기 주문을 처음 조회하면 `firstPolledAt`, 화면에 머물러 다시 조회하면 `awaitingAt` 을 적는다(commerce `getOrder`, [payments.md](payments.md)). 10분 예약 실행이 `awaitingAt` 뒤 30분 넘게 `pending` 인 주문을 한 번에 최대 20건 묶어 한 알림으로 보내고, 알림이 전달된 뒤에만 주문마다 `delayAlerted` 를 표시한다. 전송이 실패하면 표시하지 않고 다음 실행(10분 뒤)에 다시 보낸다. 결제창만 열고 확인 화면에 머물지 않은 주문, '결제하지 않고 돌아가기'로 나가 실패 처리된 주문(`failed`), 이미 결제된 주문은 알리지 않는다.

**어제 요약**(매일 08:00 KST, 어제 = KST 0시부터 24시까지)

- 가입(가입 방식별)·탈퇴·전체 회원 수, 결제 건수·금액과 상품별 판매 수, 환불·취소 건수·금액(부분 환불은 따로), 타로·AI 꿈풀이·상담 답변·리포트 수, AI 호출 수(종류별)·입출력 토큰·예상 비용, 오늘의 운세 푸시 결과(발송한 날만), 로그인 잠금·검증 실패 웹훅·서버 오류 수가 들어간다.
- 탈퇴는 어제 `deleted_at` 이 생긴 회원(`registered_at` 있음) 수다. 닉네임 글자에 기대지 않고, 로그인으로 합쳐져 정리된 게스트는 회원이 아니라서 빠진다.
- 환불·취소는 실제로 지급분을 회수할 때 센 하루 집계(`refund.count`·`refund.amount`)다. 금액은 돌려준 금액이라 관리자의 질문권 팩 부분 취소는 그 금액만 잡힌다. 결제사의 부분 환불 웹훅은 자동 회수하지 않으므로 "부분 환불 n건 금액(자동 회수 안 함)"으로 따로 적는다.
- 예상 비용은 모델별 토큰에 단가표(`AI_PRICES`, 100만 토큰당 Haiku $0.1/$0.5, Sonnet $2/$10, Opus $4/$20)를 곱하고, 캐시 쓰기는 입력의 1.25배, 캐시 읽기는 0.1배로 어림한다. 환율은 1,450원이다. 단가표에 없는 모델은 빼고 그 사실을 적는다. 단가 근거는 [COSTS.md](../COSTS.md).
- AI 호출은 리포트 다듬기·택일 상세·AI 상담·타로 이야기·AI 꿈풀이로 나눠 센다. 택일 상세는 리포트와 같은 다듬기 함수를 쓰지만 `taekil` 로 따로 센다.

**기록 정리**(매일 08:00 KST, `cleanup`)

| 기록 | 보관 | 이유 |
|---|---|---|
| 하루 집계(`ops_counters` 의 `d:`) | 40일 | 지난 요약 대조 |
| 묶음 창(`b:`) | 창이 끝나면 `flushWindows` 가 지운다 | |
| 요청 ID 선점(`webhook_events`, provider `app`) | 2일 | 재전송은 몇 초~몇 분 안에 온다. 꿈풀이 결과 전체와 프로필 이름이 담긴다 |
| 광고 보상(provider `admob`·`toss_ad`) | 30일 | 거래 ID 중복 차단. 토스 날짜 열기 기록은 당일에만 읽는다 |
| 결제 웹훅·스토어 알림·환불 표시(그 밖의 provider) | 180일 | 늦은 재전송과 늦은 환불(카드 이의 제기 등)에도 같은 결제를 두 번 처리하지 않게 |
| 로그인 실패 집계(`login_failures`) | 집계 창 시작 뒤 1일 | 15분 창이 지난 행은 없는 것과 같다 |

**예약 실행**

- 23:00 UTC 에는 두 크론이 함께 실행된다. 그래서 `*/10` 실행만 10분 작업을 하고, `0 23` 실행은 하루 작업만 한다. 둘을 가르는 값은 `worker.ts` 의 `DAILY_CRON` 이며 `wrangler.jsonc` 의 크론 글과 글자까지 같아야 한다.
- 작업마다 `run()` 으로 감싸 하나가 실패해도 다음 작업을 한다. 실패는 `[scheduled] <작업 이름> 실패` 로그로 남는다.
- 예약 실행 전체도 `withBackground` 로 감싸, 그 안에서 `background()` 로 넘긴 작업이 실행의 `waitUntil` 로 들어간다.

**응답 뒤 작업(waitUntil)**: Worker 는 응답을 보낸 뒤 `waitUntil` 로 받은 작업만 끝까지 돌리고, 다른 요청의 작업을 섞어 쓰는 것을 막는다. 그래서 요청마다 그 요청의 `waitUntil` 을 `AsyncLocalStorage` 에 두고 꺼내 쓴다. 요청 범위가 없는 테스트·Node 에서는 그냥 돌리고 `flushBackground()` 로 기다린다. 작업 오류는 `[background] 작업 실패` 로그만 남긴다. 비밀번호 재설정 메일도 응답 뒤에 보낸다([auth.md](auth.md)). 리포트 AI 다듬기는 `waitUntil` 이 아니라 Queue 로 돈다([reports.md](reports.md)).

**요청 멱등성(requestClaim)**

- 웹은 AI 상담·AI 꿈풀이를 보낼 때마다 새 `requestId` 를 만든다. 서버는 `<종류>:<사용자 ID>:<요청 ID>` 행을 `webhook_events` 에 먼저 넣은 요청만 처리한다.
- 같은 ID 가 다시 오면, 처리가 끝났으면 처음 결과(상담은 저장된 답변, 꿈풀이는 저장된 풀이)에 지금 잔액을 붙여 돌려주고 질문권을 다시 차감하지 않는다. 아직 처리 중이면 409 `REQUEST_IN_PROGRESS` 다.
- 처리 중 오류가 나면 선점 행을 지워 같은 ID 로 다시 보낼 수 있다. `requestId` 가 없는 요청은 이 장치 없이 처리한다(옛 클라이언트 호환).
- 선점 행은 2일 뒤 정리 작업이 지운다. 그래서 2일이 지난 같은 ID 는 새 요청으로 처리된다(웹은 보낼 때마다 새 ID 를 쓰므로 영향이 없다). 탈퇴하면 `deleteAccount` 가 같은 묶음 안에서 그 사용자의 선점 행과 토스 날짜 열기 기록(`userEventsWhere`)을 바로 지운다.
- 결제 웹훅·결제 승인·인앱결제 재검증·결제 시작 단계의 중복 차단(`PAYMENT_IN_PROGRESS`, `ALREADY_OWNED`)은 [payments.md](payments.md), refresh 토큰 재사용 유예·게스트 전환 경합은 [auth.md](auth.md), 광고 보상의 거래 ID 멱등과 하루 한도는 [ads-analytics.md](ads-analytics.md)에 있다. 점검 기록은 [SECURITY_REVIEW.md 멱등성 점검](../SECURITY_REVIEW.md).

**요청 수 제한**

- Cloudflare Rate Limiting 바인딩으로, 접속 IP(`cf-connecting-ip`) 기준 60초 창이며 운영 모드(`NODE_ENV=production`)에서만 켠다. 로컬·E2E 는 한 IP 에서 계정을 많이 만들기 때문이다.

| 바인딩 | 경로 | 한도 |
|---|---|---|
| `RATE_LIMIT_API` | `/api/v1` 전체. 결제 웹훅(`/payments/webhooks/*`), 스토어 알림(`/payments/iap/notifications/*`), AdMob SSV(`/rewards/admob-ssv`)는 뺀다 | 60초 120회 |
| `RATE_LIMIT_AUTH` | 가입·로그인·소셜 로그인 콜백·Apple form-post·토스 로그인·비밀번호 찾기·재설정·변경 | 60초 10회 |
| `RATE_LIMIT_SESSION` | 게스트 시작·토큰 갱신 | 60초 60회 |
| `RATE_LIMIT_ADMIN` | 관리자 경로 | 60초 20회 |

- 넘으면 429 `RATE_LIMITED` 다. `/health` 는 제한하지 않는다.
- 서버 간 호출(결제사·스토어·Google)은 한 IP 에서 몰려 오므로 IP 제한에서 뺀다. 이 경로들은 서명이나 재조회로 따로 검증한다.
- 게스트 시작과 토큰 갱신은 비밀번호를 맞히는 경로가 아니라서 인증 제한(10회) 대신 세션 제한(60회)을 받는다. 한 IP 를 여럿이 쓰는 곳(회사·학교)에서 막히지 않게 하려는 것이다.
- `namespace_id` 는 계정 안에서 겹치면 안 된다. 같은 계정의 다른 Worker 와 겹치면 횟수를 함께 센다.
- 이메일 로그인은 따로 이메일 해시 단위로 15분에 10회 실패하면 막는다([auth.md](auth.md)).

**로그·설정**

- observability 를 켜 두었다. `npx wrangler tail` 이나 대시보드 Logs 에서 본다. 주요 접두어는 `[api]`, `[ops-alert]`, `[scheduled]`, `[background]`, `[push]`, `[rewards]`, `[toss]`, `[commerce]`, `[ai:<종류>]`, `[reports]`, `[config]` 다.
- 예상하지 못한 오류 로그는 `safeErrorText` 로 drizzle 오류의 SQL 본문과 `params`(이메일·생년월일·질문이 들어 있다)를 지우고, 원인의 이름·메시지와 스택 앞 5줄만 남긴다. 서버 오류 알림도 이 글의 첫 줄 200자를 쓴다.
- `Authorization` 헤더가 있는 요청의 응답은 따로 정하지 않았으면 `Cache-Control: private, no-store` 를 붙인다.
- 운영 모드는 JWT 시크릿이 32자 미만이거나 `PAYMENT_PROVIDER=mock` 이면 기동하지 않는다. `ADMIN_API_TOKEN` 이 32자 미만이면 서버 전체를 멈추지 않고 관리자 API 만 끈다.
- `OPS_ALERT_WEBHOOK_URL` 이 `https://` 로 시작하지 않으면 서버를 멈추지 않고 알림만 끄며 `[config]` 오류 로그를 남긴다(주소 값은 적지 않는다). 운영 모드에서 이 값이 없으면 기동할 때 `[config]` 경고 로그를 남긴다.
- `SERVICE_NOTICES` 형식이 틀리면 공지 없이 기동하고 `[config]` 오류 로그를 남긴다.

## 주의사항 / 알려진 이슈

1. **알림 웹훅이 빠지면 로그로만 남는다**: 운영에는 `OPS_ALERT_WEBHOOK_URL` 이 들어 있다(2026-11-25 가입 알림 도착, 2026-11-26 시크릿 목록 확인). 해결(2026-11-26): 운영 모드에서 이 값이 없으면 인스턴스가 설정을 읽을 때 `[config]` 경고 로그를 남긴다. 로그를 보지 않으면 여전히 알 수 없으므로 새 환경을 만들 때 [DEPLOY.md §4](../DEPLOY.md)의 확인 절차를 따른다.
2. 해결(2026-11-26): **웹훅 주소 값이 틀리면 API 전체가 멈추던 문제**. `OPS_ALERT_WEBHOOK_URL` 검증을 zod 스키마에서 빼고, `loadConfig` 가 `https://` 로 시작하지 않는 값을 버린 뒤 `[config]` 오류 로그만 남기게 했다. API·예약 실행은 그대로 돌고 알림은 로그로만 남는다.
3. 해결(2026-11-26): **하루 요약의 환불 금액이 실제와 다르던 문제**. 환불을 주문 상태로 세지 않고, 지급분을 회수할 때 `ops.refunded` 가 실제로 돌려준 금액(관리자의 질문권 팩 부분 취소는 `cancelAmount`)으로 하루 집계를 올린다. 결제사의 부분 환불 웹훅은 `ops.partialRefund` 가 알림과 함께 따로 세고, 요약에 "부분 환불 n건 금액(자동 회수 안 함)"으로 나온다. 이 집계는 2026-11-26 배포 뒤의 환불부터 잡힌다.
4. 해결(2026-11-26): **탈퇴 수를 닉네임 글자로 세던 문제**. 어제 `deleted_at` 이 생긴 회원(`registered_at` 있음)을 센다. 로그인으로 합쳐져 정리된 게스트는 `registered_at` 이 없어 빠진다. 탈퇴한 게스트는 회원이 아니므로 세지 않는다.
5. 해결(2026-11-26): **메모리로 센 창의 'N건 더'를 보내지 않던 문제**. 메모리 창에 알림 문구를 함께 두고, `flushWindows` 가 DB 창을 처리한 뒤(DB 조회가 실패해도) 끝난 메모리 창을 "DB 장애 중 이 인스턴스에서 센 수"로 알린다. 다른 인스턴스가 메모리로 센 수는 합치지 못한다.
6. 해결(2026-11-26): **결제 확인 지연이 전송 실패 때 다시 알리지 않던 문제**. 알림을 먼저 보내고, 전달됐을 때만 `delayAlerted` 를 표시한다. 전송이 실패하면 10분 뒤 다시 보낸다. 한 번에 20건만 보고 나머지는 다음 실행으로 넘기는 것은 그대로다. 결제하지 않고 돌아온 그로블 주문의 지연 알림은 commerce 쪽 표시 기준(`firstPolledAt`·`awaitingAt`, USER_CANCEL 실패 처리)과 맞물려 줄었다([payments.md](payments.md)).
7. 해결(2026-11-26): **요청 ID 선점 행이 기한 없이 남고 탈퇴에서도 남던 문제**. 정리 작업이 2일 지난 선점 행을 지우고, `deleteAccount` 가 같은 묶음 안에서 그 사용자의 `chat:`·`dream:` 선점 행과 토스 날짜 열기 기록을 지운다. 처리 중 Worker 가 끊겨 선점을 풀지 못한 ID 도 2일 뒤에는 풀린다(웹은 보낼 때마다 새 ID 를 쓰므로 다시 보내면 된다).
8. 해결(2026-11-26): **정리 작업이 없는 표가 있던 문제**. `cleanup` 이 위 "기록 정리" 표의 보관 기간대로 `webhook_events`(요청 ID 2일, 광고 보상 30일, 결제 웹훅·스토어 알림·환불 표시 180일)와 `login_failures`(1일)를 지운다. AdMob 보상 기록에는 사용자 ID·SSV 쿼리 전체 대신 광고 단위·보상량·시각만 남긴다([ads-analytics.md](ads-analytics.md)).
9. 해결(2026-11-26): **결제 웹훅·AdMob SSV 가 IP 요청 수 제한에 걸리고, 토큰 갱신·게스트 생성에 인증 10회 제한이 걸리던 문제**. 결제 웹훅·스토어 알림·AdMob SSV 를 `/api/v1` 전체 제한에서 빼고(`RATE_LIMIT_EXEMPT`), 게스트 시작·토큰 갱신은 새 바인딩 `RATE_LIMIT_SESSION`(60초 60회)으로 옮겼다. 새 바인딩은 다음 `wrangler deploy` 때 함께 만들어진다. 실제 호출 빈도는 운영 로그로 확인할 일로 남는다.
10. **Rate Limiting 바인딩은 느슨하다**: 2026-11-25 실측에서 한도 5회 시험 Worker 가 42회 중 3회만 막았다. 남김(외부 작업): 대시보드에서 `/api/v1/auth/` IP 기준 WAF 규칙을 추가하고 최소 TLS 를 1.2 로 올리는 것은 운영자가 Cloudflare 대시보드에서 할 일이다. 했는지 TODO: 확인 필요([SECURITY_REVIEW.md 운영 점검](../SECURITY_REVIEW.md)).
11. **AI 비용 어림의 한계**: 단가표가 코드 상수라 가격·모델이 바뀌면 손으로 고쳐야 한다. "AI 꿈풀이 n회"는 AI 가 성공한 꿈풀이 수라 규칙 기반 풀이는 빠진다. 토스 결제 금액은 추정 판매가다([toss-miniapp.md](toss-miniapp.md)). 해결(2026-11-26): 택일 상세 AI 가 `ai.kind.report` 로 섞여 세던 것은 `ai.kind.taekil` 로 나눴고, 요약의 AI 호출 줄에 종류별 수가 나온다.
12. 해결(2026-11-26): **경로 묶기가 긴 고정 이름도 `:id` 로 바꾸던 문제**. `routeOf` 가 UUID, 숫자 3개 이상이 이어진 조각, 숫자가 섞인 12자 이상 조각만 `:id` 로 바꾼다. `/api/v1/compatibility` 는 그대로 나온다.
13. 해결(2026-11-26): **푸시 발송 결과가 알림·요약에 없던 문제**. `runDailyPush` 가 결과를 `ops.pushResult` 로 하루 집계에 올리고, 다음 날 요약에 "오늘의 운세 푸시 · 대상·보냄·실패·지운 토큰·건너뜀" 줄이 나온다. 실패가 많을 때 바로 오는 알림은 없다.
