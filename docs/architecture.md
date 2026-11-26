# 아키텍처

전체 구조, 요청과 데이터가 흐르는 길, 외부 연동을 정리한다. 기능별 규칙은 [features/](./features)에, 설계 결정의 배경은 [decisions/](./decisions)에 있다.

## 0. 용어

| 말 | 뜻 |
|---|---|
| 게스트 | 가입하지 않은 사용자. 앱·웹이 세션이 필요해지면 서버가 게스트 계정을 만들고 토큰을 준다(`POST /auth/guest`). 사주 저장·상담·타로는 게스트로도 쓸 수 있지만 결제는 회원만 할 수 있다 |
| 회원 | 이메일이나 소셜 계정으로 가입한 사용자. 코드에서는 `provider !== 'guest'` 인 사용자다(`apps/web/src/lib/session.ts`) |
| 프로필 | 저장한 사주 한 사람분(이름·관계·출생 정보). 한 계정에 여러 명을 저장한다 |
| 규칙 기반 | 미리 써 둔 문안과 계산 결과를 정해진 규칙으로 엮어 만든 글. AI 없이 만들어진다 |
| AI 다듬기 | 규칙 기반 초안을 Anthropic Claude 모델이 문장만 고쳐 쓰는 일. 초안에 없는 사주 사실은 넣지 않게 지시한다 |
| 권한 키(entitlement) | 결제로 열린 것을 기록한 문자열. 예: `report:lifetime:<프로필 ID>`. 모양은 §4.4 |
| 질문권 | AI 상담·AI 꿈풀이에 1회씩 쓰는 이용권. 유상(돈 주고 산 것)과 무상(보상·운영 지급)을 나눠 기록한다 |
| 잠금(locked) | 유료 섹션을 첫 문단 일부만 남기고 가린 상태. 서버가 잘라서 내려보낸다 |

## 1. 한눈에 보기

```
                     ┌──────────────────────────── apps/web ─────────────────────────────┐
  브라우저 / PWA ──▶  │ React 19 + Vite 7 + Tailwind v4 + React Router 7 + TanStack Query │
  iOS / Android ───▶  │  ├─ src/native: Capacitor 계층(보안 저장소·푸시·IAP·광고·뒤로가기)   │
  토스 미니앱(보류) ─▶ │  └─ src/toss: 토스 앱 안에서 도는 별도 빌드                         │
                     └──────────────┬─────────────────────────────────────────────────────┘
                                    │ REST /api/v1 (JSON, Bearer JWT, 쿠키 미사용)
                     ┌──────────────▼──────────── apps/api ──────────────────────────────┐
                     │ Hono: 백그라운드 범위 · secureHeaders · CORS · 1MB 제한 · 요청 수 제한 │
                     │ modules: auth · users · profiles · saju · fortune · compatibility · │
                     │   reports · chat · tarot · dream · zodiac · tojeong · taekil ·     │
                     │   commerce · rewards · push · mail · ops · config · toss          │
                     │ interpretation(규칙 기반 해석·콘텐츠)   ai(Claude, 키 있을 때만)     │
                     │ Drizzle ── D1(SQLite) · Queues(리포트 다듬기) · Cron(요약·지연·푸시) │
                     └──────┬───────────────────────────┬────────────────────────────────┘
                            │                           │ 외부 연동(키 없으면 목업 또는 꺼짐)
          ┌─────────────────▼──────┐   그로블(웹 결제) · 토스페이먼츠·포트원(대안) · App Store/Play
          │ packages/saju-core      │   카카오·네이버·구글·Apple 로그인 · FCM · Anthropic · Resend
          │ 순수 TS 사주 계산 엔진   │   Discord(운영 알림) · 토스(미니앱, 보류)
          └─────────────────────────┘
          packages/shared: API 계약(zod 스키마 + DTO 타입), web 과 api 가 같이 쓴다
          운영: Cloudflare Worker `dalbit-saju` 하나가 웹 정적 파일과 API 를 https://daldalsaju.com 에서 낸다
```

| 계층 | 기술 | 선택 이유 |
|---|---|---|
| 모노레포 | npm workspaces | 추가 도구 없이 엔진·계약을 프론트, 백엔드, 앱이 함께 쓴다 |
| 계산 엔진 | TypeScript, lunar-javascript(절기), korean-lunar-calendar(KASI 음력) | 프레임워크와 무관해서 서버·브라우저·앱 어디서나 같은 결과가 나온다 |
| 백엔드 | Hono, Drizzle ORM, Cloudflare D1(SQLite), jose, zod | Workers 에서 도는 가벼운 프레임워크이고 타입이 안전하다. 개발은 `wrangler dev` 의 로컬 D1, 테스트는 libSQL 인메모리 SQLite 라 DB 설치가 필요 없다 |
| 운영 | Cloudflare Workers(정적 파일과 API 를 Worker 하나로), D1, Queues, Cron Triggers, Rate Limiting | 서버 관리가 없고 Workers Paid(월 $5) 플랜 안에서 돈다. 웹과 API 가 같은 출처다 ([결정 기록](./decisions/2026-11-cloudflare-workers-d1.md)) |
| 프론트 | React 19, Vite 7, Tailwind v4, React Router 7, TanStack Query, Zustand | 모바일 우선 SPA 를 Capacitor 로 그대로 앱에 옮긴다 |
| 앱 | Capacitor 8 | 웹 코드를 다시 쓰고 IAP·푸시 같은 네이티브 기능만 더한다 ([APP_PORTING.md](./APP_PORTING.md)) |
| AI | Anthropic Claude(`@anthropic-ai/sdk`) | 키가 있을 때만 리포트 문장 다듬기·상담·꿈풀이·유료 타로 이야기에 쓴다. 키가 없으면 규칙 기반으로만 동작한다 |

## 2. 디렉터리

```
packages/saju-core/src   계산 엔진. calendar(시간대·태양시·절기·음양력) → chart(원국) → basics·relations·shinsal·elements·luck
                         fortune(점수만, 문장은 만들지 않음) · compatibility · tojeong · zodiac · astro · taekil
packages/shared/src      zod 요청 스키마 + 응답 DTO (dream/ 은 꿈해몽 사전 데이터)
apps/api/src
  worker.ts              Worker 진입점: fetch · scheduled(Cron) · queue(리포트 다듬기)
  app.ts / services.ts   Hono 앱 조립, 서비스 조립(DI)
  config/env.ts          env 검증과 기능 플래그(features.*)
  db/                    schema · client(D1) · atomic(원자적 쓰기) · local(테스트용 libSQL·Miniflare) · seed(상품)
  lib/                   alert(운영 알림·백그라운드 작업) · requestClaim(요청 멱등성) · tokens · password · http · errors
  modules/<도메인>/       routes.ts(HTTP) + service.ts(규칙). interpretation/ 은 해석 생성기와 콘텐츠 문안
  jobs/dailyPush.ts      08:00 KST 오늘의 운세 푸시
apps/api/drizzle         마이그레이션 SQL(0000~0005)
apps/api/wrangler.jsonc  Worker 설정: 정적 파일 · D1 · Queue · Cron · 요청 수 제한 · vars
apps/web/src             pages · components · hooks · lib(api·session·payments·analytics·share·platform·legal) · native · toss · i18n/ko.json
apps/web/scripts         prerender.mts(SEO 사전 렌더링) · 토스 빌드 점검 스크립트
apps/web/android, ios    Capacitor 네이티브 프로젝트
e2e/                     Playwright 시나리오
```

## 3. 요청 처리 흐름

`apps/api/src/app.ts` 의 미들웨어는 아래 순서로 실행된다.

1. **백그라운드 범위**: 요청의 `executionCtx.waitUntil` 을 `withBackground` 로 감싼다. 운영 알림처럼 응답을 늦추면 안 되는 작업은 `background(task)` 로 넘기고, Worker 는 응답 뒤에도 그 작업을 끝까지 실행한다. 테스트·Node 에는 executionCtx 가 없어서 작업을 모아 두었다가 `flushBackground()` 로 기다린다.
2. `secureHeaders`, CORS(`CORS_ORIGINS`, Capacitor 앱 출처 포함), 본문 1MB 제한.
3. `/api/v1` 아래: 요청 수 제한(운영에서만, 접속 IP 기준 60초 창으로 일반 120회, 인증 10회, 게스트 시작·토큰 갱신 60회, 관리자 20회. 결제 웹훅·스토어 알림·AdMob SSV 는 IP 제한에서 뺀다). 로그인한 요청의 응답에는 `Cache-Control: private, no-store` 를 붙인다.
4. 라우트별 인증: `authenticate`(토큰 필수, 게스트 토큰도 통과) 또는 `optionalAuth`(있으면 사용). 탈퇴한 계정의 토큰은 401 이다.
5. 오류: `AppError` 는 `{ error: { code, message, details } }` 로 응답한다. 처리하지 못한 오류는 로그를 남기고 운영 알림(`ops.serverError`)을 보낸 뒤 500 을 돌려준다. 코드 목록은 [API.md](./API.md) 머리말에 있다.

Worker 의 `scheduled` 와 `queue` 도 같은 백그라운드 범위 안에서 돈다. 예약 실행 내용은 [features/ops.md](./features/ops.md)에 있다.

## 4. 핵심 데이터 흐름

### 4.1 결과 먼저, 가입은 나중에
1. 비회원: `/input` → `/confirm`(`POST /saju/chart` 로 음양력·보정 확인) → `/result`(`POST /saju/reading`, 생년월일만 전송).
2. 저장·오늘의 운세·결제 시점에 웹의 `ensureSession()` 이 기기 ID 로 게스트 계정을 만든다.
3. 가입이나 소셜 로그인 때 게스트 토큰을 같이 보내면 같은 계정으로 전환되어 저장한 사주가 유지된다. 이미 있는 계정으로 로그인하면 게스트 데이터를 그 계정으로 합친다.
4. 결제는 회원만 할 수 있다(구매 내역 보존). 게스트가 결제하려 하면 로그인 화면으로 보낸 뒤 원래 위치로 돌아온다.

자세한 규칙: [features/auth.md](./features/auth.md), 배경: [결정 기록](./decisions/2026-10-guest-first.md).

### 4.2 해석 생성
`SajuChart`(엔진)를 `interpretation/reading.ts` 가 콘텐츠(일간 10·일주 60·오행·십신·12운성·신살·강약·용신·운세 템플릿)와 엮어 `ReadingSection[]` 으로 만든다.
- 무료·유료 구분은 서버가 한다. 권한이 없으면 섹션을 첫 문단 미리보기와 `locked` 로 잘라 보내므로 클라이언트에서 우회할 수 없다.
- 문장 선택은 날짜·출생시각으로 만든 시드(`hashSeed`)에 따른 결정적 선택이라서, 같은 날 같은 사람은 항상 같은 운세를 받는다.
- 유료 리포트는 규칙 기반 본문(수 ms)을 바로 저장·응답하고, AI 키가 있으면 Queue 에서 문장을 다듬어 같은 행을 최종본으로 바꾼다. 진행률과 담당 기한(lease)은 DB 에 둔다. 자세한 규칙: [features/reports.md](./features/reports.md).

### 4.3 결제
```
웹:  상품 선택 → POST /orders (서버가 금액 결정, 주문 ID 발급) → 결제창(그로블, 개발은 mock)
       → 결제사 웹훅 또는 POST /payments/confirm → 금액 재검증 → 원자적 batch: 주문 paid + 지급
       → 원래 읽던 화면(returnTo)으로 복귀
앱:  스토어 결제 → POST /payments/iap/verify → 스토어 서버 API 검증 → 거래 ID 로 멱등 지급 → 앱이 finish/consume
환불: 결제사 웹훅·스토어 알림·관리자 API → 지급분 회수 + 운영 알림
```
결제 전 중복 차단, 웹훅 멱등 처리, 환불 규칙은 [features/payments.md](./features/payments.md), 결제사별 연동 절차는 [PAYMENTS.md](./PAYMENTS.md).

### 4.4 권한(entitlement)과 질문권
- 상품의 `grants` 템플릿이 지급할 때 실제 키로 바뀐다: `report:lifetime:<profileId>`, `report:mini:<profileId>`, `report:yearly:<profileId>:2027`, `report:compatibility:<a>:<b>`(정렬), `ticket:compatibility:<orderId>`(1회권, 사용할 때 실제 키로 교환).
- 질문권: `users.credits`(합계) + `users.paidCredits`(유상분) + `credit_ledger`(원장, source=paid/free, channel=web/ios/android/toss/system). 사용할 때는 무상분부터 차감해서 환불할 수 있는 유상분을 남긴다.

## 5. 데이터 모델 (Drizzle, `apps/api/src/db/schema.ts`)

`users` · `refresh_tokens`(해시 저장, 회전·재사용 탐지) · `password_resets` · `profiles`(출생 정보) · `products` · `orders` · `credit_ledger` · `entitlements` · `reports` · `chat_messages` · `tarot_readings` · `push_tokens` · `webhook_events` · `app_meta`(카탈로그 해시) · `login_failures`(로그인 실패 잠금) · `ops_counters`(운영 집계·알림 묶음 창) · `atomic_guards`(원자적 쓰기의 조건 확인용, 행은 남지 않음)

- 금액은 원 단위 정수, 시각은 epoch ms(`integer`), JSON 은 `text`(drizzle json 모드)다. ID 는 시간순 UUIDv7(`lib/ids.ts`)이라 같은 ms 에 만든 행도 순서대로 정렬된다.
- `reports_target_uq`: 같은 대상(사람·종류·연도·상대)의 리포트는 하나만 만든다(택일 제외). 결제 직후 미리 만들기와 첫 열람이 겹쳐도 한 번만 생성된다.
- 탈퇴하면 프로필·리포트·상담·타로 기록·토큰을 바로 지우고, 결제 기록은 익명화한 사용자 행에 5년 보존한다(전자상거래법).

### 5.1 D1 동시성
D1 에는 BEGIN…COMMIT 대화형 트랜잭션이 없다. 대신 `db.batch` 는 한 번에 실행되고 한 문장이라도 실패하면 전체가 취소된다. `db/atomic.ts` 의 `atomic()` 은 이 성질로 낙관적 동시성 제어를 한다.
- 먼저 읽고 판단한 뒤, 모든 쓰기를 batch 하나로 실행한다.
- batch 맨 앞에 판단의 전제를 다시 확인하는 문장(guard)을 둔다. 예: "주문이 아직 pending", "무상 질문권이 n 이상", "사용자별 구매 횟수 < 한도", "1회권이 아직 있음", "재설정 토큰 미사용". guard 는 `insert into atomic_guards select null where (조건) is not 1` 이라서 조건이 깨졌으면 NOT NULL 위반으로 batch 전체가 취소되고, 처음부터 다시 실행한다(최대 12번, 넘으면 409).
- 잔액은 상대 SQL(`credits = credits + ?`)로 갱신하고, 원장의 `balance_after` 는 같은 batch 안의 서브쿼리로 계산한다.
- 중복 생성은 유니크 인덱스와 `ON CONFLICT DO NOTHING` 으로 막는다(`reports_target_uq`, `webhook_events`, 광고 보상).
- 함정: drizzle 의 D1 batch 는 인자가 있는 원시 문장 ``db.run(sql`…`)`` 을 실행하지 못한다(drizzle 버그). batch 에 넣는 쓰기는 쿼리 빌더(`insert … select(sql)`, 값에 SQL 서브쿼리를 넣는 `values`)로 쓴다.
- 회귀 테스트: `apps/api/test/concurrency.test.ts`. 실제 D1 로 돌리려면 `TEST_D1=1 npm test -w @saju/api`(CI 가 이 방식으로 한 번 더 돈다).

### 5.2 마이그레이션과 시드
- 스키마를 바꾸면 `npm run db:generate -w @saju/api`(drizzle-kit, dialect sqlite)로 `drizzle/*.sql` 을 만든다. 운영 적용은 `npm run db:migrate:remote -w @saju/api`, 로컬은 `npm run dev` 가 기동 전에 자동 적용한다.
- 함정: 첫 마이그레이션의 식(expression) 유니크 인덱스 `reports_target_uq` 는 drizzle-kit 이 식을 잘못 감싸서 손으로 고쳤다. 다시 생성할 때 확인한다.
- 상품 시드: Worker 인스턴스마다 첫 요청 때 `app_meta` 의 `catalog_hash` 와 카탈로그 해시를 비교해서, 바뀌었을 때만 `products` 를 다시 넣는다(`db/seed.ts`).

## 6. 외부 연동과 운영 설정 상태 (2026-11-26)

기능이 켜지는 조건은 `apps/api/src/config/env.ts` 의 `features` 와 `GET /config` 응답(`modules/config/routes.ts`)이다. 키 목록과 발급처는 [ENV_KEYS.md](./ENV_KEYS.md).

| 연동 | 쓰는 곳 | 상태 | 켜지는 조건 |
|---|---|---|---|
| Anthropic | 상담·꿈풀이·리포트 다듬기·택일 상세(`ANTHROPIC_MODEL`, 기본 Haiku), 유료 타로 이야기(`ANTHROPIC_MODEL_PREMIUM`, 기본 Sonnet) | 켜짐 | `ANTHROPIC_API_KEY` |
| 그로블 | 웹 결제 | 켜짐(`PAYMENT_PROVIDER=groble`) | `GROBLE_WEBHOOK_SECRET` + `GROBLE_PRODUCT_LINKS` |
| 토스페이먼츠·포트원 | 웹 결제 대안 | 코드만 있음 | `PAYMENT_PROVIDER` 변경 + 각 키 |
| App Store·Google Play | 앱 인앱결제, 스토어 환불 알림 | 앱 출시 전 | Apple 키 4종, Google 키 2종 |
| 카카오·네이버·구글·Apple | 소셜 로그인 | 꺼짐(키 없음) | 제공자별 키 |
| Resend | 비밀번호 재설정 메일 | 꺼짐(키 없음) | `RESEND_API_KEY` + `MAIL_FROM` |
| FCM | 오늘의 운세 푸시(앱 전용) | 꺼짐(키 없음) | FCM 키 3종 + `DAILY_PUSH_ENABLED=true`(설정됨) |
| AdSense·애드핏·AdMob | 웹 광고, 앱 보상형 광고 | 꺼짐 | 서버 `ADS_ENABLED` + 웹 빌드 `VITE_*` 키 |
| GA4·메타·카카오 픽셀·카카오톡 공유 | 분석, 공유 | 꺼짐(웹 빌드에 키 없음) | `VITE_*` 키 |
| Discord 웹훅 | 운영 알림·어제 요약 | 켜짐 | `OPS_ALERT_WEBHOOK_URL` |
| 토스 | 미니앱 로그인·결제·광고 | 보류 | Worker 의 `TOSS_MTLS` 바인딩(`wrangler.jsonc` 에 없음) |

그 밖의 설정: 가입 보너스 질문권 `SIGNUP_BONUS_CREDITS` 는 0, 문의 이메일 `SUPPORT_EMAIL` 은 비어 있다.

키가 없을 때의 원칙: 결제는 mock(운영 모드에서는 기동 차단), AI 는 규칙 기반, 나머지는 `NOT_CONFIGURED` 응답이나 화면에서 숨김으로 처리한다. 그래서 키 없이도 전체 흐름을 개발·테스트할 수 있다.

## 7. 플랫폼별 빌드

| 대상 | 명령 | 차이 |
|---|---|---|
| 웹 | `npm run build`(`vite build` + `prerender`) | `apps/web/dist`. Worker 가 정적 파일로 낸다. SEO 는 [features/seo.md](./features/seo.md) |
| Android·iOS | `npm run build:app:android -w @saju/web` / `build:app:ios` | `vite build --mode app` + `cap sync`. 세션 토큰은 Keychain/Keystore(`src/native/storage.ts`), 결제는 IAP. 절차는 [APP_PORTING.md](./APP_PORTING.md) |
| 토스 미니앱 | `npm run build:toss -w @saju/web` | `--mode toss`, 출력 `dist-toss`, 진입점 `src/toss/entry.ts`. 보류 중이며 [features/toss-miniapp.md](./features/toss-miniapp.md) |

플랫폼 판정은 `apps/web/src/lib/platform.ts`, 앱 쪽 연결 지점은 `apps/web/src/native/` 에 모여 있다.

## 8. 운영 구성

- **배포**: Worker `dalbit-saju` 하나가 웹과 API 를 함께 낸다. 웹은 Workers Static Assets(`apps/web/dist`)이고, 없는 주소는 `index.html`(SPA fallback), `html_handling: drop-trailing-slash` 로 사전 렌더링한 `<경로>/index.html` 을 `/경로` 로 낸다. `/api/*` 와 `/health` 만 Worker 코드가 먼저 받는다(`assets.run_worker_first`). 같은 출처라 웹에는 CORS 가 필요 없고, `CORS_ORIGINS` 는 Capacitor 앱을 위해 둔다. 절차는 [DEPLOY.md](./DEPLOY.md).
- **Worker 진입점**(`src/worker.ts`): `fetch`(Hono 앱), `scheduled`(Cron), `queue`(리포트 다듬기, 큐 `dalbit-saju-jobs`, `max_batch_size` 1).
- **Cron**: `*/10 * * * *` 결제 확인 지연·묶음 알림 정리, `0 23 * * *`(08:00 KST) 어제 요약·집계 정리·오늘의 운세 푸시·토스 환불 확인. 두 일정이 23:00 UTC 에 겹치므로 매일 실행은 10분 작업을 건너뛴다. 자세한 내용은 [features/ops.md](./features/ops.md).
- **운영 모드**(`NODE_ENV=production`): JWT 시크릿(32자 이상)이 있고 `PAYMENT_PROVIDER` 가 mock 이 아니어야 기동한다.
- Smart Placement(D1 가까이에서 실행)와 observability(로그)를 켜 두었다. 로그는 `npx wrangler tail dalbit-saju` 나 대시보드에서 본다.
- **백업·복구**: D1 Time Travel(최근 30일), [DEPLOY.md](./DEPLOY.md) §4.

## 9. 보안 원칙

- 결제 금액은 서버가 정하고 검증한다. 클라이언트 금액은 믿지 않고, 결제사 응답 금액도 다시 확인한다.
- 유료 콘텐츠는 서버에서 잘라서 응답한다. 프로필·리포트·주문은 소유자를 확인한다.
- refresh token 은 SHA-256 해시로 저장하고, 회전하다가 재사용이 탐지되면 그 사용자의 모든 세션을 폐기한다.
- 비밀번호는 scrypt, JWT 는 HS256(운영 시크릿 32자 이상 강제)이다. 보안 헤더는 Hono secureHeaders 와 정적 파일용 `apps/web/public/_headers` 가 맡는다. 입력은 zod 로 검증한다.
- 로그인 실패가 쌓이면 계정을 잠근다(`modules/auth/loginThrottle.ts`).
- 웹훅은 결제사별로 서명이나 재조회로 검증하고, 이벤트 ID 로 멱등 처리한다. 같은 요청의 재전송은 요청 ID(`lib/requestClaim.ts`)로 한 번만 처리한다.
- 점검 이력은 [SECURITY_REVIEW.md](./SECURITY_REVIEW.md).
