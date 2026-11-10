# 아키텍처

## 1. 한눈에 보기

```
                     ┌──────────────────────────── apps/web ─────────────────────────────┐
  브라우저 / PWA ──▶  │ React 19 + Vite 7 + Tailwind v4 + React Router 7 + TanStack Query │
  iOS / Android ───▶  │  └─ Capacitor 네이티브 계층(src/native) — 저장소·푸시·IAP·공유·뒤로가기 │
                     └──────────────┬─────────────────────────────────────────────────────┘
                                    │ REST /api/v1 (JSON, Bearer JWT — 쿠키 미사용 → 앱 호환)
                     ┌──────────────▼──────────── apps/api ──────────────────────────────┐
                     │ Hono · zod 검증 · secureHeaders · CORS · 요청 수 제한(Cloudflare)    │
                     │ modules: auth · profiles · saju · fortune · compatibility ·        │
                     │          reports · chat · commerce · push · config                 │
                     │ interpretation(규칙 기반 해석 + 콘텐츠) ─┐   ai(Claude, 선택)        │
                     │ Drizzle ORM ── Cloudflare D1(SQLite) · Queues(다듬기) · Cron(푸시)  │
                     └──────┬───────────────────────────┬────────────────────────────────┘
                            │                           │ 외부 연동(키 없으면 목업/NOT_CONFIGURED)
          ┌─────────────────▼──────┐     토스페이먼츠 · 포트원 · App Store/Play 검증 · Kakao/Naver/Google/Apple
          │ packages/saju-core      │     로그인 · FCM · Anthropic
          │ 순수 TS 사주 계산 엔진   │
          └─────────────────────────┘
          packages/shared — API 계약(zod 스키마 + DTO 타입) : web ↔ api 공용
          운영 — Cloudflare Worker `dalbit-saju` 하나가 apps/web 빌드(정적 파일)와 apps/api 를 같은 주소로 낸다
```

| 계층 | 기술 | 선택 이유 |
|---|---|---|
| 모노레포 | npm workspaces | 추가 도구 없이 엔진·계약을 프론트/백/앱이 공유 |
| 계산 엔진 | TypeScript, lunar-javascript(절기), korean-lunar-calendar(KASI 음력) | 프레임워크 무관 → 서버·브라우저·앱 어디서나 동일 결과 |
| 백엔드 | Hono, Drizzle ORM, Cloudflare D1(SQLite), jose, zod | Workers 에서 도는 가벼운 프레임워크, 타입 안전. 개발은 `wrangler dev` 의 로컬 D1, 테스트는 libSQL 인메모리 SQLite 라 DB 설치가 필요 없다 |
| 운영 | Cloudflare Workers(정적 파일 + API 를 Worker 하나로), D1, Queues, Cron Triggers, Rate Limiting | 서버 관리가 없고, 계정당 월 $5(Workers Paid) 플랜 안에서 돈다. 웹과 API 가 같은 출처 |
| 프론트 | React 19, Vite 7, Tailwind v4, React Router 7, TanStack Query, Zustand | 모바일 퍼스트 SPA → Capacitor 로 그대로 앱 포팅 |
| 앱 | Capacitor 8 | 웹 코드 재사용 + 네이티브 기능(IAP·푸시·위젯) 추가 |
| AI | Anthropic Claude (`@anthropic-ai/sdk`) | 키가 있을 때만 리포트 문장 고도화·상담. 없으면 규칙 기반 |

## 2. 디렉터리

```
packages/saju-core/src
  constants.ts     천간·지지·지장간·납음·12절 테이블
  calendar.ts      시간대(IANA)·태양시 보정·절기 시각·음양력 변환·일진(JDN)
  chart.ts         원국 계산(년월일시주) + 분석 조립 → SajuChart
  basics.ts        십신·12운성
  relations.ts     합충형파해·원진
  shinsal.ts       신살·공망
  elements.ts      오행 분포·신강약·간이 용신(억부)
  luck.ts          대운·세운·월운·일진
  fortune.ts       운 평가(카테고리 점수·하이라이트) — 문장은 만들지 않음
  compatibility.ts 궁합 점수·근거
packages/shared/src/index.ts   zod 요청 스키마 + 응답 DTO
apps/api/src
  app.ts / worker.ts / services.ts   조립(DI)·Worker 진입점(fetch·scheduled·queue)
  config/env.ts                      env 검증 + 기능 플래그(features.*)
  db/                                schema·client(D1)·atomic(원자적 쓰기)·local(Node 테스트용 libSQL·Miniflare)·seed
  modules/interpretation/            reading.ts(해석 생성기) + content/(콘텐츠팀 문구)
  modules/ai/                        Claude 연동(선택)
  modules/commerce/                  catalog·service·providers(toss/portone/iap/mock)
  modules/auth/ …                    oauth(카카오·네이버·구글·애플)
  jobs/dailyPush.ts                  08:00 KST 오늘의 운세 푸시(Cron Trigger 가 호출)
apps/api/wrangler.jsonc              Worker 설정 — 정적 파일·D1·Queue·Cron·요청 수 제한·vars
apps/api/scripts/local.mjs           로컬 Worker 실행(로컬 D1 마이그레이션 → wrangler dev)
apps/web/src
  pages/ components/ hooks/ lib/(api·session·payments·analytics·share·platform) native/ i18n/ko.json
```

## 3. 핵심 흐름

### 3.1 "결과 먼저, 가입은 나중에"
1. 비회원: `/input` → `/confirm`(`POST /saju/chart` 로 음양력·보정 확인) → `/result`(`POST /saju/reading`, 생년월일만 전송)
2. 저장·오늘의 운세·결제 시점에 `ensureSession()` 이 **게스트 계정**(`POST /auth/guest`, 기기 ID)을 만든다.
3. 가입/소셜 로그인 시 게스트 토큰을 함께 보내면 **같은 계정으로 전환**되어 저장한 사주가 유지된다.
4. 결제는 회원만 가능(구매 내역 보존). 게스트가 결제하려 하면 로그인 화면으로 보낸 뒤 원래 위치로 복귀한다.

### 3.2 해석 생성
`SajuChart`(엔진) → `reading.ts` 가 콘텐츠(일간 10·일주 60·오행·십신·12운성·신살·강약·용신·운세 템플릿)를 조합 → `ReadingSection[]`.
- 무료/유료 구분은 서버에서: 권한이 없으면 섹션을 **첫 문단 미리보기 + `locked`** 로 잘라서 내려보낸다(클라이언트 우회 불가).
- 유료 리포트(`POST /reports`)는 권한 확인 후 규칙 기반 본문(수 ms)을 바로 저장·응답한다. `ANTHROPIC_API_KEY` 가 있으면 `generator: 'polishing'` 으로 저장하고 뒤에서 Claude 가 규칙 기반 초안을 근거로 문장을 다듬어(사실 변경 금지, 구조화 출력) 같은 행을 최종본으로 바꾼다. 결제 확정 시 commerce 의 지급 알림(`setFulfilledListener`)으로 미리 만들기 시작하고, 화면은 `GET /reports/:id/progress` 를 폴링한다. 동일 조건 리포트는 재사용해 AI 비용을 줄인다.
- 다듬기는 응답 뒤 작업으로 Cloudflare Queues(큐 `dalbit-saju-jobs`, 바인딩 `JOBS`, `max_batch_size` 1)에 넘긴다. 요청마다 다른 Worker 인스턴스가 받을 수 있으므로 진행률과 담당 기한(lease)은 DB 컬럼 `reports.polish_done`·`polish_total`·`polish_lease_until` 에 둔다. 담당 기한은 5분이고 덩어리 하나가 끝날 때마다 늘어난다. 기한이 지나도록 진행이 없으면(작업이 끊김) 다음 열람 때 처음부터 다시 다듬는다. Node 테스트에서는 같은 프로세스에서 바로 실행한다.
- 첫 생성 대기 시간의 원인은 AI 다듬기였다(규칙 기반 생성 2~4ms). 사주분석서 9덩어리를 4개씩 세 차례 나눠 보내던 것을 한 번에 보내고(리포트당 10, AI 서비스 인스턴스당 16 동시 상한), 사용자는 규칙 기반 본문을 즉시 읽는다. 리포트마다 `[ai:report] n덩어리 · 걸린 초 · 출력 토큰` 로그를 남긴다.
- 문장 선택은 `hashSeed(날짜·출생시각)` 기반 **결정적 선택** → 같은 날 같은 사람은 항상 같은 운세.

### 3.3 결제 (웹)
```
상품 선택 → POST /orders (서버가 금액 결정, orderId 발급) → 결제창(토스/포트원, 목업)
  → successUrl(/payments/success?paymentKey&orderId&amount)
  → POST /payments/confirm  ─ 서버: 주문 금액 == 요청 금액 검증 → 결제사 승인 → 결제사 확인 금액 재검증
                             → 원자적 batch: 주문 paid + 지급(권한 entitlement / 질문권 / 구독 기간)
  → 원래 읽던 화면(returnTo)으로 복귀
웹훅: 취소 → 지급분 회수, 결제완료(승인 응답 유실) → 복구. 이벤트 ID 로 멱등.
```
### 3.4 결제 (앱, IAP)
스토어 결제 → 영수증(transactionId / purchaseToken) → `POST /payments/iap/verify` → 스토어 서버 API 로 검증 → 거래 ID 로 멱등 지급 → 앱이 finish/consume.

### 3.5 권한(entitlement) 모델
- 상품의 `grants` 템플릿이 지급 시 실제 키로 변환: `report:lifetime:<profileId>`, `report:mini:<profileId>`, `report:yearly:<profileId>:2027`, `report:compatibility:<a>:<b>`(정렬), `ticket:compatibility:<orderId>`(1회권 → 사용 시 실제 키로 교환).
- 질문권: `users.credits`(합계) + `users.paidCredits`(유상) + `credit_ledger`(원장, source=paid/free, channel=web/ios/android/system). 사용은 **무상분 먼저** 차감(환불 가능한 유상분 보존).

## 4. 데이터 모델 (Drizzle, `apps/api/src/db/schema.ts`)
`users` · `refresh_tokens`(해시 저장, 회전·재사용 탐지) · `password_resets` · `profiles`(출생정보) · `products` · `orders` · `credit_ledger` · `entitlements` · `reports` · `tarot_readings` · `chat_messages` · `push_tokens` · `webhook_events` · `app_meta`(카탈로그 해시) · `atomic_guards`(원자적 쓰기의 조건 확인용, 행은 남지 않음)

- 금액은 원 단위 정수, 시각은 epoch ms(`integer`), JSON 은 `text`(drizzle json 모드). ID 는 시간순 UUIDv7(`lib/ids.ts`) — 같은 ms 에 만든 행의 정렬 보조 기준.
- `reports_target_uq`: 같은 대상(사람·종류·연도·상대)의 리포트는 하나만(택일 제외). 결제 직후 미리 만들기와 첫 열람이 겹쳐도 한 번만 만든다.

탈퇴 시: 프로필·리포트·상담·토큰 즉시 삭제, 결제 기록은 익명화된 사용자 행에 5년 보존(전자상거래법).

## 5. 운영 전환 가이드

### DB (Cloudflare D1) — 2026-11 PostgreSQL 에서 전환
- 운영·`wrangler dev` 는 Worker 의 D1 바인딩 `DB`(데이터베이스 이름 `dalbit-saju`)를 drizzle 로 감싸 쓴다(`db/client.ts`). Node 테스트는 `db/local.ts` 의 libSQL 인메모리 SQLite 를 쓴다(같은 SQLite, 같은 drizzle 쿼리 API).
- 마이그레이션: `npm run db:generate -w @saju/api`(drizzle-kit, dialect sqlite — 스키마 → `drizzle/*.sql`). 운영 적용은 `npm run db:migrate:remote -w @saju/api`(`wrangler d1 migrations apply DB --remote`), 로컬은 `npm run dev` 가 기동 전에 자동으로 적용한다. 첫 마이그레이션의 식(expression) 유니크 인덱스 `reports_target_uq` 는 손으로 고쳤다(drizzle-kit 이 식을 잘못 감싼다) — 다시 생성할 때 확인한다.
- 상품 시드: Worker 인스턴스마다 첫 요청 때 `app_meta` 의 `catalog_hash` 와 카탈로그 해시를 비교해, 바뀌었을 때만 `products` 를 다시 넣는다(`db/seed.ts`).
- 동시성: D1 에는 BEGIN…COMMIT 대화형 트랜잭션이 없다. 대신 `db.batch` 는 한 번에 실행되고 한 문장이라도 실패하면 전체가 취소된다. `db/atomic.ts` 의 `atomic()` 이 이것으로 낙관적 동시성 제어를 한다.
  - 먼저 읽고 판단한 뒤, 모든 쓰기를 batch 하나로 실행한다.
  - batch 맨 앞에 판단의 전제를 다시 확인하는 문장(guard)을 둔다 — "주문이 아직 pending", "무상 질문권이 n 이상", "사용자별 구매 횟수 < 한도", "1회권이 아직 있음", "재설정 토큰 미사용". guard 는 `insert into atomic_guards select null where (조건) is not 1` 이라 조건이 깨졌으면 NOT NULL 위반으로 batch 전체가 취소된다. 그러면 처음부터 다시 실행한다(최대 12번, 넘으면 409).
  - 잔액 갱신은 상대 SQL(`credits = credits + ?`)로 쓰고, 원장의 `balance_after` 는 같은 batch 안에서 계산되는 서브쿼리로 넣는다.
  - 중복 생성은 유니크 인덱스 + `ON CONFLICT DO NOTHING` 으로 막는다(`reports_target_uq`, `webhook_events`, 광고 보상).
  - 주의: drizzle 의 D1 batch 는 인자가 있는 원시 문장 ``db.run(sql`…`)`` 을 실행하지 못한다(drizzle 버그). batch 에 넣는 쓰기는 쿼리 빌더(`insert … select(sql)`, 값에 SQL 서브쿼리를 넣는 `values`)로 쓴다.
  - 회귀 테스트: `apps/api/test/concurrency.test.ts`.
- 실제 D1 로 테스트: `TEST_D1=1 npm test -w @saju/api` — 같은 테스트를 Miniflare(workerd) 의 D1 에서 돌린다(CI 가 이 방식으로 한 번 더 돈다).
- 백업·복구: D1 Time Travel(최근 30일) — [`docs/DEPLOY.md`](./DEPLOY.md) §4.

### 배포
- Cloudflare Worker `dalbit-saju` 하나가 웹과 API 를 함께 낸다. 웹은 Workers Static Assets(`apps/web/dist`, 없는 주소는 `index.html` — SPA fallback, `html_handling: drop-trailing-slash` 로 사전 렌더링한 `<경로>/index.html` 을 `/경로` 로 낸다). `/api/*` 와 `/health` 만 Worker 코드가 먼저 받는다(`assets.run_worker_first`). 같은 출처라 웹에는 CORS 가 필요 없고, `CORS_ORIGINS` 는 Capacitor 앱을 위해 둔다.
- Worker 진입점 `src/worker.ts`: `fetch`(Hono 앱), `scheduled`(Cron `0 23 * * *` = 08:00 KST → `runDailyPush`, `DAILY_PUSH_ENABLED=true` 이고 FCM 키가 있을 때만), `queue`(리포트 다듬기).
- 요청 수 제한: Cloudflare Rate Limiting 바인딩, 접속 IP(`cf-connecting-ip`) 기준, 운영 모드에서만 — API 60초 120회, 인증 경로 60초 10회, 관리자 경로 60초 20회(`wrangler.jsonc` 의 `ratelimits`).
- Smart Placement(D1 가까이에서 실행)와 observability(로그)를 켜 두었다. 로그는 `npx wrangler tail` 또는 대시보드.
- 배포: 루트에서 `npm run deploy`(웹 빌드 + 사전 렌더링 → `wrangler deploy`). 앱: [`docs/APP_PORTING.md`](./APP_PORTING.md)
- **처음 설정·갱신·백업 절차: [`docs/DEPLOY.md`](./DEPLOY.md)**
- 운영 모드(`NODE_ENV=production`, `wrangler.jsonc` vars)는 JWT 시크릿(32자+)이 시크릿으로 들어 있고 `PAYMENT_PROVIDER` 가 mock 이 아니어야 기동한다(목업 결제는 운영 모드에서 차단).

## 6. 보안 체크
- 결제 금액은 서버가 결정·검증(클라이언트 금액 신뢰 안 함), 결제사 응답 금액 재검증.
- 유료 콘텐츠는 서버에서 잘라서 응답. 프로필·리포트·주문은 소유자 검증.
- refresh token 은 SHA-256 해시로 저장, 회전 + 재사용 탐지 시 전 세션 폐기.
- 비밀번호 scrypt, JWT HS256(운영 시크릿 32자 이상 강제), 보안 헤더(Hono secureHeaders · 정적 파일은 `apps/web/public/_headers`), 요청 수 제한(Cloudflare Rate Limiting), zod 입력 검증.
- 웹훅: 토스는 재조회 검증, 포트원은 Standard Webhooks 서명 검증, 이벤트 ID 멱등 처리.
