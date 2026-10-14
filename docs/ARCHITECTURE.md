# 아키텍처

## 1. 한눈에 보기

```
                     ┌──────────────────────────── apps/web ─────────────────────────────┐
  브라우저 / PWA ──▶  │ React 19 + Vite 7 + Tailwind v4 + React Router 7 + TanStack Query │
  iOS / Android ───▶  │  └─ Capacitor 네이티브 계층(src/native) — 저장소·푸시·IAP·공유·뒤로가기 │
                     └──────────────┬─────────────────────────────────────────────────────┘
                                    │ REST /api/v1 (JSON, Bearer JWT — 쿠키 미사용 → 앱 호환)
                     ┌──────────────▼──────────── apps/api ──────────────────────────────┐
                     │ Fastify 5 · zod 검증 · helmet · CORS · rate-limit                  │
                     │ modules: auth · profiles · saju · fortune · compatibility ·        │
                     │          reports · chat · commerce · push · config                 │
                     │ interpretation(규칙 기반 해석 + 콘텐츠) ─┐   ai(Claude, 선택)        │
                     │ Drizzle ORM ── SQLite(dev) / PostgreSQL(운영 전환)                  │
                     └──────┬───────────────────────────┬────────────────────────────────┘
                            │                           │ 외부 연동(키 없으면 목업/NOT_CONFIGURED)
          ┌─────────────────▼──────┐     토스페이먼츠 · 포트원 · App Store/Play 검증 · Kakao/Naver/Google/Apple
          │ packages/saju-core      │     로그인 · FCM · Anthropic
          │ 순수 TS 사주 계산 엔진   │
          └─────────────────────────┘
          packages/shared — API 계약(zod 스키마 + DTO 타입) : web ↔ api 공용
```

| 계층 | 기술 | 선택 이유 |
|---|---|---|
| 모노레포 | npm workspaces | 추가 도구 없이 엔진·계약을 프론트/백/앱이 공유 |
| 계산 엔진 | TypeScript, lunar-javascript(절기), korean-lunar-calendar(KASI 음력) | 프레임워크 무관 → 서버·브라우저·앱 어디서나 동일 결과 |
| 백엔드 | Fastify 5, Drizzle ORM, better-sqlite3, jose, zod | 가볍고 빠름, 타입 안전, 테스트 시 인메모리 DB |
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
  app.ts / server.ts / services.ts   조립(DI)·진입점
  config/env.ts                      env 검증 + 기능 플래그(features.*)
  db/                                schema·client·migrate·seed
  modules/interpretation/            reading.ts(해석 생성기) + content/(콘텐츠팀 문구)
  modules/ai/                        Claude 연동(선택)
  modules/commerce/                  catalog·service·providers(toss/portone/iap/mock)
  modules/auth/ …                    oauth(카카오·네이버·구글·애플)
  jobs/dailyPush.ts                  08:00 KST 오늘의 운세 푸시
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
- 유료 리포트(`POST /reports`)는 권한 확인 후 규칙 기반 본문(수 ms)을 바로 저장·응답한다. `ANTHROPIC_API_KEY` 가 있으면 `generator: 'polishing'` 으로 저장하고 뒤에서 Claude 가 규칙 기반 초안을 근거로 문장을 다듬어(사실 변경 금지, 구조화 출력) 같은 행을 최종본으로 바꾼다. 결제 확정 시 commerce 의 지급 알림(`setFulfilledListener`)으로 미리 만들기 시작하고, 화면은 `GET /reports/:id/progress` 를 폴링한다. 동일 조건 리포트는 재사용해 AI 비용을 줄이고, 다듬기 진행은 메모리에만 두어 서버 재시작으로 끊긴 다듬기는 다음 열람 때 다시 시작한다(단일 인스턴스 기준).
- 첫 생성 대기 시간의 원인은 AI 다듬기였다(규칙 기반 생성 2~4ms). 사주분석서 9덩어리를 4개씩 세 차례 나눠 보내던 것을 한 번에 보내고(리포트당 10, 서버 전체 16 동시 상한), 사용자는 규칙 기반 본문을 즉시 읽는다. 리포트마다 `[ai:report] n덩어리 · 걸린 초 · 출력 토큰` 로그를 남긴다.
- 문장 선택은 `hashSeed(날짜·출생시각)` 기반 **결정적 선택** → 같은 날 같은 사람은 항상 같은 운세.

### 3.3 결제 (웹)
```
상품 선택 → POST /orders (서버가 금액 결정, orderId 발급) → 결제창(토스/포트원, 목업)
  → successUrl(/payments/success?paymentKey&orderId&amount)
  → POST /payments/confirm  ─ 서버: 주문 금액 == 요청 금액 검증 → 결제사 승인 → 결제사 확인 금액 재검증
                             → 트랜잭션: 주문 paid + 지급(권한 entitlement / 질문권 / 구독 기간)
  → 원래 읽던 화면(returnTo)으로 복귀
웹훅: 취소 → 지급분 회수, 결제완료(승인 응답 유실) → 복구. 이벤트 ID 로 멱등.
```
### 3.4 결제 (앱, IAP)
스토어 결제 → 영수증(transactionId / purchaseToken) → `POST /payments/iap/verify` → 스토어 서버 API 로 검증 → 거래 ID 로 멱등 지급 → 앱이 finish/consume.

### 3.5 권한(entitlement) 모델
- 상품의 `grants` 템플릿이 지급 시 실제 키로 변환: `report:lifetime:<profileId>`, `report:mini:<profileId>`, `report:yearly:<profileId>:2027`, `report:compatibility:<a>:<b>`(정렬), `ticket:compatibility:<orderId>`(1회권 → 사용 시 실제 키로 교환).
- 질문권: `users.credits`(합계) + `users.paidCredits`(유상) + `credit_ledger`(원장, source=paid/free, channel=web/ios/android/system). 사용은 **무상분 먼저** 차감(환불 가능한 유상분 보존).

## 4. 데이터 모델 (Drizzle, `apps/api/src/db/schema.ts`)
`users` · `refresh_tokens`(해시 저장, 회전·재사용 탐지) · `profiles`(출생정보) · `products` · `orders` · `credit_ledger` · `entitlements` · `reports` · `chat_messages` · `push_tokens` · `webhook_events`

탈퇴 시: 프로필·리포트·상담·토큰 즉시 삭제, 결제 기록은 익명화된 사용자 행에 5년 보존(전자상거래법).

## 5. 운영 전환 가이드

### PostgreSQL 전환
1. `drizzle-orm/pg-core` 로 `schema.ts` 를 옮긴다(`sqliteTable`→`pgTable`, `integer(..., {mode:'boolean'})`→`boolean`, JSON→`jsonb`, 시각은 `bigint` 또는 `timestamp`).
2. `db/client.ts` 를 `drizzle-orm/node-postgres` 로 교체, `drizzle.config.ts` dialect `postgresql`.
3. 서비스 코드는 동기 `.run()/.get()/.all()` 대신 `await` 사용으로 바꾼다(better-sqlite3 는 동기 드라이버).

### 배포
- API: `npm run build -w @saju/api` → `node apps/api/dist/server.js` (마이그레이션·상품 시드는 기동 시 자동). 단일 인스턴스에서 `DAILY_PUSH_ENABLED=true`.
- Web: `npm run build -w @saju/web` → `apps/web/dist` 를 정적 호스팅(SPA fallback: 모든 경로 → `index.html`).
- 앱: [`docs/APP_PORTING.md`](./APP_PORTING.md)
- Docker (✅ 빌드·운영 모드 기동 검증 완료): `deploy/api.Dockerfile`, `deploy/web.Dockerfile`(nginx — SPA fallback + `/api` 프록시), `docker-compose.yml` → `API_ENV_FILE=<운영 env 파일> docker compose up --build` 후 http://localhost:8080 (리버스 프록시 뒤라 `TRUST_PROXY_HOPS=1` 이 compose 에 지정됨).
  운영 모드(`NODE_ENV=production`)이므로 `apps/api/.env` 에 JWT 시크릿(32자+)과 `PAYMENT_PROVIDER=toss|portone` + 결제 키가 있어야 기동됩니다(목업 결제는 운영 모드에서 차단).

## 6. 보안 체크
- 결제 금액은 서버가 결정·검증(클라이언트 금액 신뢰 안 함), 결제사 응답 금액 재검증.
- 유료 콘텐츠는 서버에서 잘라서 응답. 프로필·리포트·주문은 소유자 검증.
- refresh token 은 SHA-256 해시로 저장, 회전 + 재사용 탐지 시 전 세션 폐기.
- 비밀번호 scrypt, JWT HS256(운영 시크릿 32자 이상 강제), helmet, rate limit, zod 입력 검증.
- 웹훅: 토스는 재조회 검증, 포트원은 Standard Webhooks 서명 검증, 이벤트 ID 멱등 처리.
