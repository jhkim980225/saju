# 달달사주

만세력 기반 사주풀이·운세·궁합·타로·꿈해몽·토정비결·택일과 AI 상담을 제공하는 서비스다. 웹을 먼저 출시했고(https://daldalsaju.com), 같은 코드를 Capacitor 로 iOS·Android 앱과 토스 미니앱(보류)으로도 빌드한다.

- 수익: 일회성 유료 리포트·타로 펼침·택일 상세·질문권 판매. 구독은 없다.
- 원칙: 결과를 먼저 보여 주고 가입은 나중에 받는다. 본문은 규칙 기반으로 만들고 AI 는 문장 다듬기·상담에만 쓴다. 외부 키가 없어도 전체 흐름이 목업으로 동작한다.
- 옛 이름은 달빛사주다(그 전 기획 단계의 추천명은 여덟자). Worker·D1·큐 이름(`dalbit-saju`)과 웹 저장소 키 접두어(`yd.`, 여덟자에서 온 것으로 보임)에는 옛 이름이 남아 있고, 바꾸지 않는다. 스토어 상품 ID 는 `com.daldalsaju.*` 로 바뀌었다.

## 스택

| 위치 | 내용 |
|---|---|
| `packages/saju-core` | 순수 TypeScript 사주 계산 엔진(절기·음양력·원국·대운·신살·궁합·토정비결·택일·별자리) |
| `packages/shared` | API 계약: zod 요청 스키마와 응답 DTO 타입. web 과 api 가 같이 쓴다 |
| `apps/api` | Hono on Cloudflare Workers, D1(SQLite) + Drizzle, Queues, Cron, jose(JWT), Anthropic SDK |
| `apps/web` | React 19, Vite 7, Tailwind v4, React Router 7, TanStack Query, Zustand, Capacitor 8 |
| 운영 | Worker `dalbit-saju` 하나가 웹 정적 파일과 `/api/v1` 을 함께 낸다 |

Node 22.13 이상, npm workspaces. 구조와 흐름은 [docs/architecture.md](docs/architecture.md).

## 주요 명령어 (저장소 루트)

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | API(:4000, `wrangler dev` + 로컬 D1, 마이그레이션 자동 적용) + 웹(:5173) |
| `npm run typecheck` | 전체 타입 검사 |
| `npm test` | 엔진·API·웹 단위·통합 테스트(API 는 libSQL 인메모리) |
| `TEST_D1=1 npm test -w @saju/api` | API 테스트를 실제 D1(Miniflare)로 실행. CI 도 두 방식으로 돈다 |
| `npm run test:e2e` | Playwright E2E(`e2e/`) |
| `npm run db:generate -w @saju/api` | 스키마 변경 → `apps/api/drizzle/*.sql` 생성 |
| `npm run db:migrate:remote -w @saju/api` | 운영 D1 에 마이그레이션 적용 |
| `PUBLIC_WEB_URL=https://daldalsaju.com npm run deploy` | 웹 빌드(사전 렌더링 포함) + Worker 배포 |
| `npm run build:app:android -w @saju/web` | 앱 번들 + `cap sync android` |
| `npx wrangler tail dalbit-saju` | 운영 로그 보기(`apps/api` 에서) |

## 컨벤션

### 코드
- 포매터(prettier 등)를 실행하지 않는다. `.editorconfig` 기준: UTF-8, LF, 들여쓰기 2칸.
- 주석·로그·오류 메시지·커밋 메시지는 한국어로 쓴다. 커밋 메시지는 "무엇을 했는지 + 이유"를 한 줄로 요약한다.
- API 모듈은 `apps/api/src/modules/<도메인>/` 에 `routes.ts`(HTTP)와 `service.ts`(규칙)로 나누고, 서비스 조립은 `apps/api/src/services.ts` 에서 한다.
- 요청 검증은 `packages/shared` 의 zod 스키마와 `apps/api/src/lib/validate.ts` 의 `parse()` 로 한다. 웹과 API 가 같은 스키마를 쓴다.
- 오류는 `apps/api/src/lib/errors.ts` 의 `AppError` 계열로 던진다. 화면에 보이는 메시지는 '~요' 체다.
- 웹 화면 문구는 `apps/web/src/i18n/ko.json` 에 둔다.
- 기능 켜짐 여부는 `apps/api/src/config/env.ts` 의 `features` 로 판정한다. 키가 없으면 목업·규칙 기반·`NOT_CONFIGURED` 로 동작하게 만들고, 테스트가 외부 키를 요구하지 않게 한다.

### 데이터와 결제
- 유료 범위는 서버에서 잘라서 응답한다. 클라이언트에서 가리는 방식으로 만들지 않는다.
- 가격은 고정이다. 정가 취소선(`listPrice`)·할인 배지·기한 있는 가격(`saleEndsAt`)을 두지 않는다.
- 금액은 서버(`apps/api/src/modules/commerce/catalog.ts`)가 정한다. 상품·가격을 바꾸면 그로블 결제창 링크(`GROBLE_PRODUCT_LINKS`)도 같이 맞춰야 한다. 그로블의 기존 상품·정산·쿠폰 설정은 건드리지 않는다.
- 동시에 실행될 수 있는 쓰기(지급·차감·구매 한도·1회권)는 `apps/api/src/db/atomic.ts` 의 `atomic()` 과 guard 로 쓴다. D1 batch 안에서는 인자가 있는 원시 `sql` 을 실행할 수 없으므로 쿼리 빌더로 쓴다([architecture.md §5.1](docs/architecture.md)).
- 스키마를 바꾸면 `db:generate` 로 마이그레이션을 만들고, 운영 적용은 배포 전에 한다. 식 유니크 인덱스 `reports_target_uq` 는 생성된 SQL 을 손으로 확인한다.
- 금액은 원 단위 정수, 시각은 epoch ms, ID 는 UUIDv7(`apps/api/src/lib/ids.ts`)이다.

### 콘텐츠 문체
- 사용자에게 보이는 풀이·안내 글은 [docs/PLAIN_KOREAN.md](docs/PLAIN_KOREAN.md) 기준을 따른다: 처음 접하는 성인 대상의 차분한 전문 설명체, 정식 용어와 첫 등장 설명, 비유·유아어 금지, 전통 명리학과 달달사주 자체 기준 구분.
- `apps/api/test/plain-tone.test.ts` 가 콘텐츠 문자열의 문체를 검사한다. 예외가 꼭 필요한 줄에는 `// 말투 예외: 이유` 를 단다.

### AI
- 기본 모델은 가장 싼 모델(`ANTHROPIC_MODEL`, Haiku 계열)이고, 유료 타로 이야기만 `ANTHROPIC_MODEL_PREMIUM`(Sonnet 계열)을 쓴다.
- AI 는 규칙 기반 초안에 없는 사주 사실을 만들지 않게 지시한다. AI 가 실패하면 리포트는 규칙 기반 본문으로 마무리한다. 상담·꿈풀이는 서비스 쪽 장애나 AI 출력이 문체 검사(`modules/ai/plainOutput.ts`)에서 탈락한 경우에만 하루 5번까지 질문권을 차감한 몫 그대로(유상분은 유상으로) 돌려주고, 모델이 답을 거절한 경우에는 돌려주지 않는다([docs/features/ask.md](docs/features/ask.md)).

### 보안·개인정보
- 저장소는 공개 저장소다. 비밀 키·웹훅 주소·사업자 정보·개인정보를 코드와 문서에 쓰지 않는다. 사업자 정보는 gitignore 된 `apps/web/.env` 의 `VITE_BIZ_*` 로만 넣는다.
- `VITE_*` 값은 웹·앱 번들에 그대로 들어가는 공개 값이다. 비밀 키를 넣지 않는다.
- 운영 비밀 값은 `npx wrangler secret put <이름>` 으로 넣는다. 목록은 [docs/ENV_KEYS.md](docs/ENV_KEYS.md).
- 로그와 운영 알림에는 이메일·이름·생년월일·질문 내용을 남기지 않는다.

### 작업 방식
- 커밋·푸시·배포·운영 DB 변경은 요청이 있을 때만 한다.
- 신년운세 상품은 2027년분만 있다. 2027-09-30 까지 2028년 상품과 결제창을 추가해야 한다([docs/features/reports.md](docs/features/reports.md)).

## 문서 인덱스

### 구조와 결정
- [docs/architecture.md](docs/architecture.md): 전체 구조, 요청·데이터 흐름, 데이터 모델, D1 동시성, 외부 연동 상태, 플랫폼별 빌드
- [docs/decisions/](docs/decisions): 설계 결정 기록(`YYYY-MM-<주제>.md`)

### 기능 (docs/features)
| 문서 | 범위 |
|---|---|
| [saju.md](docs/features/saju.md) | 사주 입력·확인·결과·요약, 내 사주, 프로필, 만세력, 사주 기초, 잠금 규칙 |
| [fortune.md](docs/features/fortune.md) | 오늘의 운세, 신년운세 화면 |
| [reports.md](docs/features/reports.md) | 유료 리포트, 미니 리포트, 신년 패키지, 보관함, AI 다듬기 |
| [compatibility.md](docs/features/compatibility.md) | 궁합 |
| [ask.md](docs/features/ask.md) | AI 상담, 질문권 사용 |
| [tarot.md](docs/features/tarot.md) | 타로 전체 |
| [dream.md](docs/features/dream.md) | 꿈해몽 사전, AI 꿈풀이 |
| [zodiac.md](docs/features/zodiac.md) | 띠별 운세, 별자리 운세 |
| [tojeong.md](docs/features/tojeong.md) | 토정비결 |
| [taekil.md](docs/features/taekil.md) | 택일 |
| [auth.md](docs/features/auth.md) | 게스트, 가입·로그인, 소셜 로그인, 비밀번호, 게스트 병합, 탈퇴, 로그인 잠금 |
| [payments.md](docs/features/payments.md) | 상품·주문·결제·인앱결제·웹훅·환불·권한·질문권 원장·관리자 API |
| [push.md](docs/features/push.md) | 오늘의 운세 푸시 |
| [ads-analytics.md](docs/features/ads-analytics.md) | 광고, 보상형 광고, 분석, 공유 |
| [seo.md](docs/features/seo.md) | 사전 렌더링, sitemap, 페이지 메타 |
| [legal.md](docs/features/legal.md) | 약관, 처리방침, 사업자 정보 |
| [ops.md](docs/features/ops.md) | 운영 알림, 어제 요약, 예약 실행, 요청 멱등성, 요청 수 제한 |
| [toss-miniapp.md](docs/features/toss-miniapp.md) | 토스 미니앱(보류) |

### 참고 문서 (docs)
| 문서 | 내용 |
|---|---|
| [PRD.md](docs/PRD.md) | 제품 범위, 상품·가격, 광고 정책, UX 원칙, 출시 체크리스트 |
| [API.md](docs/API.md) | REST API 레퍼런스(`/api/v1`) |
| [SAJU_ENGINE.md](docs/SAJU_ENGINE.md) | 계산 방법론과 검증, 토정비결·띠·별자리·택일 공식 |
| [PLAIN_KOREAN.md](docs/PLAIN_KOREAN.md) | 콘텐츠 문체 기준 |
| [ACCURACY_REVIEW.md](docs/ACCURACY_REVIEW.md) | 명리학 설명 정확성 점검 |
| [PAYMENTS.md](docs/PAYMENTS.md) | 결제사·스토어 연동 절차, 웹훅, 심사 |
| [AUTH_PUSH.md](docs/AUTH_PUSH.md) | 소셜 로그인·FCM 설정 절차 |
| [ADS_ANALYTICS.md](docs/ADS_ANALYTICS.md) | 광고·분석·공유 키 발급과 이벤트 표 |
| [APP_PORTING.md](docs/APP_PORTING.md) | Capacitor 앱 빌드·딥링크·심사 대응 |
| [ENV_KEYS.md](docs/ENV_KEYS.md) | 환경 변수·외부 키 전체 목록 |
| [DEPLOY.md](docs/DEPLOY.md) | 배포·갱신·백업·운영 알림 |
| [COSTS.md](docs/COSTS.md) | 고정비·AI 비용·수수료·상품별 마진 |
| [SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) | 보안·로직 점검 이력과 조치 |
| [QA.md](docs/QA.md) | 테스트 전략, E2E 시나리오, 발견 버그 |
| [TAROT_ART.md](docs/TAROT_ART.md) | 타로 카드 그림 출처 |
| [research/](docs/research) | 경쟁 서비스·타로 시장 분석, 카피 리소스 |

## 문서 갱신 규칙

기능을 수정하거나 추가하면 해당 docs/features/*.md도 같이 업데이트할 것. 새 도메인이 생기면 문서를 만들고 인덱스에 추가할 것.
