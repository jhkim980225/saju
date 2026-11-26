# 유료 리포트 (리포트 5종 · 미니 리포트 · 2027 신년 패키지 · 보관함 · AI 다듬기)

> 기준일: 2026-11-26. `feat/cloudflare` 작업 트리의 코드를 기준으로 적었다. 이 문서는 [FEATURES.md](../FEATURES.md) §4(4.3 은 [fortune.md](fortune.md))와 §14 의 보관함 부분, §22 중 이 도메인 항목을 대체한다. 결제 흐름·환불 절차는 [payments.md](payments.md)에 있다.

## 목적

결제한 사람에게 A4 10~20쪽 분량의 풀이 문서를 만들어 보관함에 남긴다. 본문은 규칙 기반 생성기가 몇 ms 안에 만들고, AI(Claude Haiku)는 그 초안의 문장만 다듬는다. 이렇게 나눈 이유는 두 가지다. 사용자가 결제 직후 기다리지 않고 바로 읽게 하려는 것과, AI 가 실패하거나 꺼져 있어도 산 문서가 항상 나오게 하려는 것이다. 한 번 만든 리포트는 저장해 두고 다시 쓰므로 AI 비용은 리포트당 처음 한 번만 든다([COSTS.md §2](../COSTS.md): 사주분석서 약 40원, 나머지 약 20원).

운영 상태: **운영 중**(그로블 웹 결제·AI 다듬기 켜짐). 인앱결제로 사는 경로는 앱 전용(출시 전)이다.

## 사용자 흐름

### 상품 (`apps/api/src/modules/commerce/catalog.ts` 한 곳에서 정의)

| 상품 ID | 이름 | 가격 | 함께 주는 질문권 | 지급 권한 | 제한 |
|---|---|---|---|---|---|
| `report_saju_mini` | 첫 사주 미니 리포트 | 990원 | 없음 | `report:mini:<프로필>` | 계정당 1회 |
| `report_saju_lifetime` | 평생 사주분석서 | 9,900원 | 3회 | `report:lifetime:<프로필>` | |
| `report_newyear_2027` | 2027 신년운세 | 5,900원(기한 없음, 2026-11-26 결정으로 연말 인상 없음) | 없음 | `report:yearly:<프로필>:2027` | |
| `report_compat` | 사주 궁합 리포트 | 5,900원 | 없음 | `report:compatibility:<A>:<B>`(정렬), 상대가 없으면 1회권 | |
| `report_love` | 연애·결혼운 리포트 | 4,900원 | 없음 | `report:love:<프로필>` | |
| `report_career_wealth` | 재물·직업운 리포트 | 4,900원 | 없음 | `report:career_wealth:<프로필>` | |
| `bundle_newyear_2027` | 2027 신년 패키지 | 16,900원 | 10회 | 평생 + 2027 신년운세 + 궁합 1회권(`ticket:compatibility:<주문>`) | |

- "리포트 5종"은 보관함에 저장되는 `lifetime`·`yearly`·`compatibility`·`love`·`career_wealth` 다(`REPORT_TYPES`).
- **미니 리포트**는 문서가 아니라 결과·내 사주 화면의 재물·연애·직업 섹션을 여는 권한이다. 보관함에 아무것도 만들지 않는다. 잠금 범위는 [saju.md](saju.md).
- 서버가 켜질 때 카탈로그를 DB 로 덮어쓰고(`ensureCatalog`, 해시가 바뀐 경우만), 카탈로그에서 뺀 상품은 지우지 않고 판매 중지한다.
- 가격은 고정이다(2026-11-26 결정). 정가 취소선·할인 배지·기한 있는 가격을 두지 않는다. 할인 마감(`saleEndsAt`)이 지나면 정가(`listPrice`)로 파는 장치(`currentPrice`)는 코드에 남아 있지만 쓰는 상품이 없다([payments.md](./payments.md)).

### 사는 곳과 여는 곳

| 리포트 | 사는 곳 | 여는 곳 |
|---|---|---|
| 미니 리포트 | 결과·내 사주의 재물·연애·직업 잠금 섹션, `/store` | 결과·내 사주 화면 그대로 |
| 평생 사주분석서 | 잠금 섹션 결제 시트, `/store` | 내 사주 화면의 '보고서 열기' 카드(`OpenReportCard`), `/my/reports` |
| 신년운세 | `/yearly/:profileId` 결제 시트(신년운세 + 패키지), `/store` | `/yearly/:profileId` 의 열기 카드, `/my/reports` |
| 궁합 리포트 | `/compatibility` 결제 시트(궁합 리포트 + 패키지), `/store` | `/compatibility` 의 열기 카드, `/my/reports` |
| 연애·결혼운, 재물·직업운 | 내 사주·보관함의 주제별 리포트 카드(`TopicReportCards`), `/store` '주제별 리포트' 묶음 | 같은 카드, `/my/reports` |
| 신년 패키지 | 위 결제 시트들, `/store` | 각 리포트 자리 |

1. 상점(`/store`)에서 프로필이 필요한 상품은 누구의 리포트인지 먼저 고른다. 주제별 리포트는 이미 산 프로필이면 결제 없이 바로 연다.
2. 결제가 확정되면 서버가 산 리포트를 미리 만들어 보관함에 넣는다(`prewarm`). 사용자가 '리포트 열기'를 누르면 `POST /reports` 가 저장본을 돌려주고 `/reports/:id` 로 간다.
3. `/reports/:id`(`ReportsPage.tsx`)는 규칙 기반 본문을 바로 보여 준다. 다듬는 중이면 'AI가 문장을 다듬고 있어요 n/전체' 진행률을 2초마다 `GET /reports/:id/progress` 로 받는다. 끝나면 최종본으로 바꾸되, 240px 넘게 내려 읽는 중이면 바로 바꾸지 않고 '바꿔 보기'를 띄운다.
4. 사주분석서·연애·재물 리포트 위에는 근거 표(원국·오행·대운)를 붙인다. 이 표는 저장본이 아니라 프로필로 원국을 다시 계산해(`POST /saju/chart`) 그린다. 사주분석서는 '타고난 사주'·'분야별 운' 같은 탭으로 묶는다.
5. 'PDF로 저장'은 웹은 브라우저 인쇄, 앱은 시스템 인쇄 화면이다. 다크 테마여도 밝은 테마로 인쇄하고 끝나면 되돌린다(`printAsPdf`).
6. **보관함**(`/my/reports`): 지금도 볼 권한이 남은 리포트와 상세가 열린 택일 결과([taekil.md](taekil.md))를 최신순으로 보여 준다. 아래에 프로필별 주제별 리포트 카드가 있다.

## 관련 파일

| 구분 | 경로 |
|---|---|
| 화면 | `apps/web/src/pages/ReportsPage.tsx`(보관함·본문), `apps/web/src/pages/StorePage.tsx`, `apps/web/src/pages/MySajuPage.tsx`, `apps/web/src/pages/YearlyPage.tsx`, `apps/web/src/pages/CompatibilityPage.tsx` |
| 컴포넌트 | `apps/web/src/components/OpenReportCard.tsx`(`useOpenReport`), `apps/web/src/components/TopicReportCards.tsx`(`useOwnedTopicReports`), `apps/web/src/components/PaywallSheet.tsx`, `apps/web/src/components/ReadingView.tsx` |
| 웹 로직 | `apps/web/src/hooks/usePurchase.ts`, `apps/web/src/native/`(앱 인쇄) |
| API | `apps/api/src/modules/reports/routes.ts`, `apps/api/src/modules/reports/service.ts` |
| 생성기 | `apps/api/src/modules/interpretation/report.ts`(`buildSajuAnalysis`, `buildYearlyReport`, `buildCompatibilityReport`), `apps/api/src/modules/interpretation/loveReport.ts`, `apps/api/src/modules/interpretation/careerWealthReport.ts`, `apps/api/src/modules/interpretation/topicReportKit.ts`, `apps/api/src/modules/interpretation/verdicts.ts`, `apps/api/src/modules/interpretation/content/reportPlain.ts`, `apps/api/src/modules/interpretation/content/loveReport.ts`, `apps/api/src/modules/interpretation/content/careerWealthReport.ts` |
| AI | `apps/api/src/modules/ai/service.ts`(`enhanceSections`, `polishSections`, `chunkSections`, `REPORT_SYSTEM`), `apps/api/src/modules/interpretation/plainGuard.ts` |
| 작업 처리 | `apps/api/src/worker.ts`(`queue` 처리기), `apps/api/wrangler.jsonc`(`queues`), `apps/api/src/services.ts`(`setFulfilledListener` 로 `prewarm` 연결) |
| 권한·상품 | `apps/api/src/modules/commerce/catalog.ts`, `apps/api/src/modules/commerce/service.ts`(`entitlementKeys`, `ownsAllGrants`, `redeemTicket`, `currentPrice`) |
| 데이터 | `apps/api/src/db/schema.ts`(`reports`), `apps/api/drizzle/0000_init.sql`(`reports_target_uq`) |
| 테스트 | `apps/api/test/report.test.ts`, `apps/api/test/report-polish.test.ts`, `apps/api/test/profile-report-fixes.test.ts`, `apps/api/test/report-consistency.test.ts`, `apps/api/test/topic-report.test.ts`, `apps/api/test/topic-report-api.test.ts`, `apps/api/test/plain-report.test.ts`, `apps/api/test/ai-failure.test.ts`, `apps/api/test/catalog.test.ts`, `e2e/report.spec.ts`, `e2e/topic-report.spec.ts`, `e2e/purchase.spec.ts` |

## API / 데이터 모델

| 엔드포인트 | 인증 | 비고 |
|---|---|---|
| `POST /reports` | ✓ | 만들기 또는 저장본 돌려주기. 권한이 없으면 402 + `details.productId` |
| `GET /reports`, `GET /reports/:id` | ✓ | 보관함 목록·본문. 권한이 사라졌으면 목록에서 빠지고 본문은 402 |
| `GET /reports/:id/progress` | ✓ | `{ status, progress }` 만 돌려준다. 본문은 읽지 않는다 |

요청·응답 형식은 [API.md 「유료 리포트 · AI 상담」](../API.md)을 본다. `reports` 테이블의 `generator` 는 `'rule' | 'ai' | 'polishing'` 이고, 다듬기 진행률과 담당 기한은 `polish_done`·`polish_total`·`polish_lease_until` 컬럼에 둔다. 요청마다 다른 Worker 인스턴스가 받을 수 있어 메모리가 아니라 DB 에 둔 것이다([architecture.md §4.2](../architecture.md)). 택일(`type='taekil'`)도 같은 테이블을 다른 뜻으로 쓴다([taekil.md](taekil.md)).

## 비즈니스 규칙 & 엣지케이스

### 권한과 생성

- **권한 확인**: 종류마다 권한 키를 확인하고 없으면 402 와 필요한 상품 ID 를 준다(`lifetime` → `report_saju_lifetime`, `yearly` → `report_newyear_<연도>`(그 상품이 카탈로그에 없으면 402 대신 400), `compatibility` → `report_compat`, `love` → `report_love`, `career_wealth` → `report_career_wealth`). 사주분석서는 미니 권한으로는 열리지 않는다. 신년운세 연도는 요청에 없으면 `targetFortuneYear()`(KST 10월부터 다음 해)다.
- **궁합**: 이미 열린 조합이면 차감 없이 열고, 아니면 궁합 1회권을 먼저 쓴다. 같은 사람끼리는 400 이다([compatibility.md](compatibility.md)).
- **규칙 기반 즉시 저장**: 권한을 확인한 뒤 규칙 기반 본문을 만들어 바로 저장하고 응답한다. AI 가 켜져 있으면 `generator: 'polishing'` 으로 저장하고 다듬기를 맡긴다.
- **결제 직후 미리 만들기**(`prewarm`): 결제 확정(웹 승인·그로블 웹훅·인앱결제)의 지급 알림을 받아 산 리포트를 만든다. 미니 리포트와 궁합 1회권은 대상 문서가 정해지지 않아 건너뛴다. 궁합은 주문의 순서(`profileId` → `partnerProfileId`)대로 만든다. 실패해도 결제는 그대로이고 처음 열 때 다시 만든다.
- **재사용**: 같은 사용자·프로필·종류·연도·상대의 리포트는 하나만 저장한다(DB 유니크 인덱스 `reports_target_uq`, 택일 제외). 결제 직후 미리 만들기와 첫 열람이 겹쳐도 `ON CONFLICT DO NOTHING` 으로 하나만 남고, 진 쪽은 먼저 저장된 행을 쓴다. 다시 열면 저장본을 준다. 궁합은 A×B 와 B×A 를 같은 리포트로 찾는다. 유니크 인덱스는 순서를 그대로 쓰므로, 두 순서를 동시에 처음 만들면 저장 직후 ID 가 큰 쪽이 자기 행을 지우고 먼저 만든 행을 쓴다.
- **낡은 저장본 갱신**: 열 때(`POST /reports`, `GET /reports/:id`) 저장본이 지금과 맞지 않으면 같은 ID 로 새 본문을 만든다(`refreshIfStale`). 사주분석서·궁합·연애·재물 리포트는 만든 때와 지금의 KST 연도·대상 연도 가운데 하나라도 다를 때, 모든 종류는 지금 프로필 이름으로 만든 제목이 저장된 제목과 다를 때다. `createdAt` 이 지금으로 바뀌어 보관함 맨 위로 오고, AI 가 켜져 있으면 다시 다듬는다. 다듬는 중이거나 프로필을 지운 리포트는 바꾸지 않는다.
- **프로필 삭제 전 만들어 두기**: `DELETE /profiles/:id` 는 지우기 전에 그 프로필로 산 리포트(평생·주제별·신년운세, 그 프로필이 들어간 궁합) 가운데 아직 없는 것을 만든다(`materializeForProfile`). 실패해도 삭제는 진행한다.
- **중복 구매 차단**: 이미 모든 권한을 가진 리포트를 다시 사려 하면 주문 단계에서 409(`ALREADY_OWNED`)다. 평생 사주분석서는 미니 리포트가 여는 섹션을 모두 열므로, 평생 권한이 있는 프로필의 미니 리포트 주문도 409 다. 1회권이 든 상품(패키지, 상대 없는 궁합)과 질문권 팩은 이 검사를 하지 않는다. 미니 리포트는 결제된 주문 수로 계정당 1회를 주문 생성과 결제 확정 때 두 번 확인한다([payments.md](payments.md)).
- **환불 뒤**: 권한이 사라지면 보관함 목록에서 빠지고 본문은 402 다. 저장된 행은 지우지 않는다.

### AI 다듬기

- **대기열**: Cloudflare Queue `dalbit-saju-jobs`(바인딩 `JOBS`, `max_batch_size` 1, `max_retries` 2)에 `{ kind: 'polish', reportId }` 를 보내고, Worker 의 `queue` 처리기가 `runPolish` 를 실행한다. Node 테스트에서는 같은 프로세스에서 바로 실행한다.
- **나누기**: 초안을 섹션 단위로 약 3,500자 덩어리로 묶는다(`REPORT_CHUNK_CHARS`). 덩어리 수가 진행률의 전체 값이다. 사주분석서는 7덩어리 안팎이다.
- **동시 호출**: 리포트 하나에서 10개(`REPORT_CONCURRENCY`), AI 서비스 인스턴스 전체에서 16개(`REPORT_GLOBAL_CONCURRENCY`)까지 보낸다. 16개는 Haiku 의 분당 출력 토큰 한도의 절반 아래로 맞춘 값이다. 예전에는 4개씩 나눠 보내 첫 생성이 1분 가까이 걸렸다.
- **모델**: `ANTHROPIC_MODEL`(기본 `claude-haiku-5-5`), 호출 제한 시간 120초, SDK 재시도 2회, 구조화 출력. 성별은 보내지 않는다(성 고정관념이 섞일 여지를 줄이려는 것이다).
- **담당 기한(lease)**: 맡을 때 5분(`POLISH_LEASE_MS`)으로 잡고, 덩어리 하나가 끝날 때마다 그리고 다듬는 동안 1분(`POLISH_HEARTBEAT_MS`)마다 늘린다. 덩어리 하나가 기한보다 오래 걸려도 살아 있는 작업의 기한은 지나지 않는다. 조건부 UPDATE 로 맡으므로 같은 리포트를 두 작업이 함께 다듬지 않는다. 기한이 지나도록 진행이 없으면(작업이 끊김) 다음 열람이나 진행률 조회 때 처음부터 다시 다듬고, 그사이 AI 키를 뺐으면 규칙 기반으로 마무리한다.
- **대기열 전송 실패**: `JOBS.send` 가 실패하면 로그를 남기고 담당 기한을 비운 채 규칙 기반 본문으로 정상 응답한다. 다음 진행률 조회나 열람이 바로 다시 맡긴다.
- **AI 실패 시 대체 동작**: 덩어리 하나가 실패하거나 거절되면 그 덩어리는 초안을 유지한다. 다듬은 섹션이 초안에 없던 용어·한자·'당신'·비유를 들이거나(`introducesJargon`, `introducesFigurative`), 두 겹 추측 표현('~기 쉽다고 봐요')을 늘리면 그 섹션만 초안을 쓴다. 다듬은 덩어리가 하나도 없거나 작업 자체가 실패하면 `generator: 'rule'` 로 마무리한다. 리포트 생성 실패로 자동 환불하지는 않는다.
- **로그**: 리포트마다 `[ai:report] n덩어리 중 m개 다듬음 · 걸린 초 · 출력 토큰` 을 남긴다. 탈퇴로 행이 지워졌으면 저장하지 않고 끝낸다.
- 문체 기준은 [PLAIN_KOREAN.md](../PLAIN_KOREAN.md), 설명 정확성 기준은 [ACCURACY_REVIEW.md](../ACCURACY_REVIEW.md)를 따른다.

## 주의사항 / 알려진 이슈

### 버그 의심 (모두 해결)

1. 해결(2026-11-26): **궁합 리포트를 순서를 바꿔 열면 두 번 만들던 문제**. 재사용 조회가 두 순서를 함께 찾고, 동시에 처음 만들면 ID 가 큰 쪽이 물러난다. 자세한 내용은 [compatibility.md](compatibility.md) 이슈 1.
2. 해결(2026-11-26): **담당 기한이 최악의 호출 시간보다 짧던 문제**. `runPolish` 가 다듬는 동안 1분(`POLISH_HEARTBEAT_MS`)마다 담당 기한을 5분 뒤로 다시 늘린다. 덩어리 하나가 제한 시간 120초에 재시도 2회로 6분 넘게 걸리거나 서버 전체 동시 상한(16)을 기다려도, 작업이 살아 있는 동안에는 기한이 지나지 않아 다른 요청이 처음부터 다시 맡지 않는다. 작업이 죽으면 늘리기도 멈추므로 5분 뒤에는 예전처럼 다시 맡는다. 회귀 테스트: `report-polish.test.ts`('담당 기한과 대기열').
3. 해결(2026-11-26): **대기열 전송이 실패하면 첫 요청이 500 이던 문제**. `startPolish` 가 `JOBS.send` 실패를 잡아 로그를 남기고 담당 기한을 비운 뒤, 규칙 기반 본문과 `status: 'polishing'` 으로 정상 응답한다. 화면이 2초 뒤 진행률을 물으면 기한이 비어 있으므로 바로 다시 맡긴다(5분을 기다리지 않는다). 결제 직후 미리 만들기도 같은 방식이라 결제에는 영향이 없다.
4. 해결(2026-11-26): **저장본이 만든 시점에 고정되던 문제**. 열 때(`POST /reports` 의 저장본 재사용, `GET /reports/:id`) 두 가지를 확인한다. 사주분석서·궁합·연애·재물 리포트는 만든 때와 지금의 날짜 기준(KST 연도와 대상 연도)이 다르면, 모든 종류는 지금 프로필 이름으로 만든 제목이 저장된 제목과 다르면 같은 행(같은 ID)을 새 본문으로 바꾸고 `createdAt` 을 지금으로 고친 뒤 다시 다듬는다(`refreshIfStale`). 신년운세는 연도가 정해진 문서라 날짜로는 다시 만들지 않는다. 다듬는 중인 행과 프로필을 지운 리포트는 그대로 둔다. 두 요청이 함께 열어도 `createdAt` 조건부 UPDATE 로 한 번만 바꾼다. 날짜 기준은 1년에 두 번(1월 1일, 10월 1일) 바뀌므로 AI 다듬기 비용도 리포트마다 그 횟수만큼 더 든다. 회귀 테스트: `profile-report-fixes.test.ts`('저장본 갱신').
5. 해결(2026-11-26): **삭제한 프로필의 리포트**(FEATURES §22 #14). 프로필을 지우기 직전에 그 프로필로 산 리포트 중 아직 만들지 않은 것을 먼저 만든다(`materializeForProfile`). 그래서 미리 만들기가 실패한 채 프로필을 지워도 산 리포트가 보관함에 남는다. 이렇게 만든 리포트는 다듬기 작업이 실행될 때 프로필이 없으면 규칙 기반 본문으로 마무리한다. 의도된 동작으로 유지: 지운 프로필의 리포트는 보관함에 '삭제된 프로필'로 남고 본문도 열리지만, 근거 표는 출생 정보를 지웠으므로 다시 계산하지 않고 빠진다.
6. 해결(2026-11-26): **진행률 조회가 가볍지 않던 문제**. `progress()` 가 본문(`content`)을 읽지 않고 권한 판정과 진행 칸만 읽는다. 끊긴 다듬기를 다시 맡길 때만 본문을 읽는다.
7. 해결(2026-11-26): **보관함 목록의 권한 확인이 행마다 따로 나가던 문제**. `list()` 가 사용자의 `report:` 권한 키 전체와 구독 여부를 한 번씩만 읽고, 리포트마다 메모리에서 판정한다(`viewKeys`). 리포트 수와 무관하게 조회 수가 일정하다.
8. 해결(2026-11-26): **평생 권한이 있어도 미니 리포트를 살 수 있던 문제**. 중복 구매 검사(`commerce/service.ts` 의 `ownsAllGrants`)가 `report:mini:<프로필>` 을 `report:lifetime:<프로필>` 로도 가진 것으로 본다. 평생 사주분석서가 있는 프로필로 미니 리포트를 주문하면 409(`ALREADY_OWNED`)라 계정당 1회 기회를 쓰지 않는다. 다른 프로필에는 그대로 살 수 있다. 회귀 테스트: `profile-report-fixes.test.ts`('미니 리포트').

### 미완성·운영 확인 필요

9. 남김(운영 일정): **2028 상품 준비 기한**(FEATURES §22 #10). 2027-09-30 까지 `report_newyear_2028`·`bundle_newyear_2028` 을 넣어야 한다. 해결(2026-11-26): 웹의 `ReadingView`·`CompatibilityPage` 는 이제 `bundle_newyear_<targetFortuneYear()>` 를 넘기므로 화면은 고칠 것이 없다. 상품이 없는 연도의 신년운세 리포트 요청은 400 이다([fortune.md](fortune.md) 이슈 2).
10. 남김: **구독 판정은 죽은 코드다**(FEATURES §22 #11). `access`·`yearlyUnlocked`·`compatUnlocked`·`topicUnlocked`·`canView` 가 모두 `isPremium` 을 먼저 보지만 구독 상품이 없어 누구도 해당하지 않는다. PRD §2 의 "구독 안 함" 결정과 같아 동작 문제는 없고, 정리는 이번 범위에서 뺐다.
11. TODO: 확인 필요. 그로블 결제창 15개는 2026-11-25 에 모두 연결하고 가격을 대조했다고 기록돼 있지만(FEATURES §22 #9), 링크 목록은 시크릿(`GROBLE_PRODUCT_LINKS`)이라 문서에서 확인할 수 없고, 웹훅의 `content.id` 가 링크 ID 와 같은지는 첫 실결제로 확인해야 한다([PAYMENTS.md §3.5](../PAYMENTS.md)).
12. TODO: 확인 필요. 앱(인앱결제)에서 리포트 PDF 저장이 화면과 같게 나오는지는 실기기 확인 항목으로 남아 있다([QA.md §4](../QA.md)).
13. 참고: 다듬기 작업 전체의 실행 시간에는 따로 상한이 없다. 덩어리 하나는 제한 시간 120초·재시도 2회로 끝나지만, 서버 전체 동시 상한을 기다리는 시간이 길어지면 Queue 소비자의 실행 시간 한도(15분)에 닿을 수 있다. 그때는 작업이 끊기고 담당 기한 늘리기도 멈추므로, 5분 뒤 다음 열람이 처음부터 다시 맡는다.
