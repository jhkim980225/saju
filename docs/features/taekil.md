# 택일 (좋은 날 고르기)

> 기준일: 2026-11-26. 계산 규칙과 근거 문헌은 [SAJU_ENGINE.md §8](../SAJU_ENGINE.md), 요청·응답 형식은 [API.md 「택일」](../API.md), 결제 흐름은 [payments.md](./payments.md)를 본다.

## 목적

이사·계약·면접/시험·결혼·개업·여행/출발에 맞춰, 저장한 사주와 옛 달력(건제12신·황도흑도 등 통서 요소)을 함께 보고 좋은 날을 고른다. 날짜마다 등급과 추천 3일은 무료로 보여 주고, 날짜별 이유와 종합 분석은 결과 1건 단위로 판다(990원).

운영 상태는 **운영 중**이다. 상세 문장의 AI 다듬기도 켜져 있다.

## 사용자 흐름

1. 전체 운세 메뉴('좋은 날 고르기'), 마이, 상점의 택일 상품, 만세력의 택일 카드에서 `/taekil` 로 들어온다. 상점에서 택일 상품을 누르면 결제 대신 이 화면으로 보낸다. 만세력에서 미래 날짜를 보다가 들어오면 `?date=` 로 그날부터 기간을 잡는다.
2. 저장한 프로필이 있어야 한다. 없으면 프로필 추가 화면으로 보낸 뒤 돌아온다.
3. 목적을 고르고, 기간(최대 92일) 또는 후보 날짜(2~10개)를 고른다. 결혼은 상대 프로필을 선택으로 고를 수 있다.
4. 결과 `/taekil/r/:id` 에서 달력에 날짜별 등급과 추천 3일을 본다. 잠긴 날짜를 누르면 상세가 잠겨 있다는 시트가 뜬다.
5. 결제하면 같은 결과가 전부 열린다. 열린 택일은 보관함(`/my/reports`)에도 보인다.

## 관련 파일

| 구분 | 경로 |
|---|---|
| 엔진 | `packages/saju-core/src/taekil.ts`(`selectTaekilDays`, `taekilDateRange`, `TAEKIL_MAX_RANGE_DAYS`, `OFFICER_NET`) |
| 라우트·서비스 | `apps/api/src/modules/taekil/routes.ts`, `apps/api/src/modules/taekil/service.ts`(`taekilByKey`, `birthPrint`, `TAEKIL_DAILY_CREATE_LIMIT`, `TAEKIL_LIST_RECENT`, `AI_POLISH_MAX_ATTEMPTS`) |
| 문장 | `apps/api/src/modules/taekil/content.ts`(`dayDtos`, `buildSections`, `lockedSections`, `AI_SECTION_KEYS`, `TAEKIL_DISCLAIMER`) |
| AI | `apps/api/src/modules/ai/service.ts`(`enhanceSections` 의 `interactive`, `AI_INTERACTIVE_TIMEOUT_MS`, `REPORT_SYSTEM`) |
| 공용 정의 | `packages/shared/src/index.ts`(`TAEKIL_LIMITS`, `TAEKIL_GRADE_NAME`, `TAEKIL_PRODUCT_ID`, `taekilCreateSchema`) |
| 상품 | `apps/api/src/modules/commerce/catalog.ts`(`report_taekil`) |
| 화면 | `apps/web/src/pages/TaekilPage.tsx`, `apps/web/src/pages/TaekilResultPage.tsx`, `apps/web/src/components/TaekilCalendar.tsx`, `apps/web/src/components/TaekilEntryCard.tsx`, `apps/web/src/lib/taekil.ts`, `apps/web/src/pages/ReportsPage.tsx`(보관함) |
| 테스트 | `packages/saju-core/test/taekil.test.ts`, `apps/api/test/taekil.test.ts`, `apps/api/test/plain-taekil-tarot.test.ts`, `apps/api/test/ai-failure.test.ts`, `apps/web/src/lib/__tests__/taekil.test.ts`, `e2e/taekil.spec.ts` |

## API / 데이터 모델

- `POST /taekil`(201), `GET /taekil`, `GET /taekil/:id`. 모두 인증이 필요하고 게스트 토큰도 통과한다.
- `GET /taekil` 은 최근 100건(`TAEKIL_LIST_RECENT`)에 더해 그보다 오래된 구매 결과(`taekil:reading` 권한)도 싣는다. 잠금 여부는 플러스 구독 조회 1번과 권한 목록 조회 1번으로 정한다.
- 결제는 `POST /orders { productId: report_taekil, readingId: <택일 결과 ID> }`(앱은 `/payments/iap/verify` 에 `readingId`)다. `readingId` 가 없으면 400, 내 결과가 아니면 404 다. 지급 권한 키는 `taekil:reading:<결과 ID>` 이고 **그 결과 하나만** 열린다. 질문권은 주지 않는다. 결제는 회원만 할 수 있다.
- 결과는 마이그레이션 없이 `reports` 테이블에 `type='taekil'` 로 둔다. `content` 에 판정 키, 목적·방식·기간, 이름, **계산 당시 원국**, 엔진 결과, AI 다듬은 섹션을 함께 저장한다. 리포트 서비스는 모르는 `type` 을 열람 불가로 보므로 `/reports` 목록·조회에 섞이지 않는다. 같은 입력 찾기는 판정 키 식 인덱스 `reports_taekil_key_idx` 로 한다.
- AI 재시도 기록은 택일 행에서 쓰지 않는 `reports.polish_done`(시도 횟수)·`polish_lease_until`(다음 시도 시각)에 둔다.

## 비즈니스 규칙 & 엣지케이스

### 무료·유료 경계

| 범위 | 무료 | 상세(`report_taekil`, 990원) |
|---|---|---|
| 날짜마다 등급(아주 좋은 날·좋은 날·평범한 날·조심할 날·피할 날)·순위 | 공개 | 공개 |
| 추천 3일, 한 줄 요약, 계산 기준 | 공개 | 공개 |
| 날짜별 점수·건제12신·황도·이유·빠진 까닭·좋은 시간·근거 | 비움(`null`) | 공개 |
| 종합 분석·목적 맞춤 조언·날짜를 바꿀 수 없을 때·빠진 날짜 | 잠금(종합 분석만 첫 문단, 나머지는 소개 한 줄) | 공개 |

- 플러스 구독자는 모두 열리지만 구독 상품은 없다.
- 등급과 점수는 **달달사주 기준**이며 화면에 밝힌다([../PLAIN_KOREAN.md §4](../PLAIN_KOREAN.md)).

### 입력 검증

- 목적은 6가지다. 결혼만 상대 프로필을 쓰고, 자기 자신을 고르면 400, 남의 프로필이면 404 다. 다른 목적에 보낸 상대 프로필은 무시한다.
- 기간(`from`·`to`)과 후보 날짜(`dates`) 중 하나만 보낸다. 기간은 최대 92일, 후보는 중복을 뺀 뒤 2~10개다.
- 날짜는 KST 기준 오늘부터 2년(730일) 안만 받는다. 지난 날짜, 2년 밖, 없는 날짜는 400 이다.

### 같은 입력 재사용

- 목적·프로필·상대·방식·날짜 목록과 두 사람의 출생 정보가 같으면 새로 계산하지 않고 저장본을 돌려준다. 이미 산 결과를 다시 사지 않게 하려는 규칙이다.
- 판정 키는 `목적|프로필 ID~출생 정보 지문|상대 ID~출생 정보 지문|방식|날짜` 다. 지문(`birthPrint`)은 프로필의 출생 정보(`profileToBirth`)를 SHA-256 으로 줄인 앞 16자리라 출생 정보 자체는 키에 들어가지 않는다. 출생 정보를 고친 뒤에는 키가 달라져 새로 계산하고, 예전 저장본은 기록에 그대로 남는다(주소로 열 수 있다). 이 규칙을 넣기 전에 만든 저장본은 키 모양이 달라 다음 같은 요청 때 한 번 새로 계산한다.
- 저장본은 계산 당시 원국과 결과를 그대로 둔다. 엔진이 바뀌거나 프로필을 고치거나 지워도 산 결과의 문장은 바뀌지 않는다.

### 하루 생성 상한

- 새 택일 결과는 사용자마다 하루(KST) 30건까지다(`TAEKIL_DAILY_CREATE_LIMIT`). 넘으면 429 `RATE_LIMITED`(`details.limit`)다. 무료 결과가 무제한으로 쌓이지 않게 하려는 것이다.
- 같은 입력(저장본 안내)은 세지 않는다. 계산 전에 한 번, 저장 묶음 실행 시점에 한 번 더 확인해 동시 요청으로도 상한을 넘지 않는다.
- 저장된 결과는 지우지 않는다. 지우는 API 도 없다.

### AI 다듬기

- 상세가 열린 뒤 처음 볼 때 종합 분석·조언·'날짜를 바꿀 수 없을 때' 세 섹션만 `ANTHROPIC_MODEL`(기본 `claude-haiku-5-5`)로 한 번 다듬어 저장한다(`generator: 'ai'`). 날짜별 근거와 '빠진 날짜' 목록은 규칙 계산 그대로다.
- 리포트와 달리 Queue 를 쓰지 않고 그 조회 요청 안에서 끝날 때까지 기다린다. 리포트 다듬기와 같은 함수(`enhanceSections`)를 쓰므로, 초안에 없던 용어·한자·비유를 들이면 그 섹션은 규칙 기반 초안을 쓴다.
- 사용자가 기다리는 호출이라 `interactive: true` 로 부른다. 호출별 제한 시간 60초·재시도 1번(`AI_INTERACTIVE_TIMEOUT_MS`)이고, 리포트 다듬기와 나눠 쓰는 서버 전체 동시 호출 자리(16개)를 기다리지 않는다. 덩어리 하나짜리 호출이라 동시 호출 상한에 주는 부담이 작다.
- 실패하면 규칙 기반 문장을 보여 준다. 다시 열면 재시도하되 결과당 3번까지, 직전 시도 뒤 10분이 지나야 한다. 조건부 갱신으로 시도를 맡아 동시에 열어도 한 번만 부른다.
- 건당 추정 비용은 약 10원이다([../COSTS.md](../COSTS.md)).

### 계산 요약

- 하루 점수 = 기준 50 + 통서 요소(누구에게나 같은 그날의 성질) + 본명 요소(그날 일진과 내 사주). 같은 입력은 언제나 같은 결과다.
- 등급 경계: 대길 ≥68 · 길 ≥58 · 보통 ≥44 · 주의 ≥34 · 그 아래 피함. 월파·사리/사절·일지 충은 점수와 관계없이 피함이고 순위 맨 뒤다.
- 추천 3일은 '피함'을 뺀 상위 3일이다(없으면 빈 목록). 추천 날짜는 낮 시간(辰~酉)의 황도시를 좋은 시간으로 안내한다.
- 넣지 않은 것: 생기복덕, 가취월, 삼살 방위, 복단일. 시주와의 관계는 보지 않는다. 자세한 표와 한계는 [SAJU_ENGINE.md §8](../SAJU_ENGINE.md).

## 주의사항 / 알려진 이슈

1. 해결(2026-11-26): 같은 입력 판정 키에 두 사람의 출생 정보 지문(`birthPrint`)을 넣었다. 프로필의 출생 정보를 고친 뒤 같은 조건으로 다시 요청하면 새 원국으로 다시 계산한다. 회귀 테스트: `apps/api/test/taekil.test.ts` '출생 정보 수정 뒤 저장본'.
2. 해결(2026-11-26): 택일 상세를 사도 프로필 출생 정보 변경이 막히지 않던 문제. 출생 정보 변경 차단(`profiles/service.ts` 의 `hasPurchase`)이 `report:%<프로필 ID>%` 권한에 더해, 상세를 연 택일 결과(`taekil:reading:<결과 ID>` 권한이 있고 그 결과의 본인이나 상대가 이 프로필)도 구매로 본다. 그래서 산 택일 결과의 본인·상대 프로필은 출생 정보를 바꿀 수 없고(409) 이름·관계는 바꿀 수 있다. 상세를 열지 않은 무료 결과만 있는 프로필은 막지 않는다. 회귀 테스트: `apps/api/test/profile-report-fixes.test.ts`.
3. 해결(2026-11-26): `GET /taekil` 은 최근 100건에 더해 그보다 오래된 구매 결과도 싣는다. 산 결과가 보관함과 목록에서 사라지지 않는다.
4. 해결(2026-11-26): 택일 상세 AI 다듬기는 호출별 제한 시간 60초·재시도 1번으로 부르고, 리포트 다듬기와 나눠 쓰는 동시 호출 자리를 기다리지 않는다(`enhanceSections` 의 `interactive`).
5. 해결(2026-11-26): 목록은 플러스 여부와 권한 목록을 한 번씩만 조회해서 잠금 여부를 정한다.
