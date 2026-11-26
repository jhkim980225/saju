# 운세 (오늘의 운세 · 신년운세 화면)

> 기준일: 2026-11-26. `feat/cloudflare` 작업 트리의 코드를 기준으로 적었다. 이 문서는 [FEATURES.md](../FEATURES.md) §3·§4.3과 §22 중 이 도메인 항목을 대체한다. 유료 신년운세 리포트(`/reports/:id`)와 상품 규칙은 [reports.md](reports.md)에 있다.

## 목적

매일 다시 들어올 이유를 주는 무료 콘텐츠(오늘의 운세)와, 유료 신년운세로 이어지는 무료 미리보기(신년운세 화면)를 제공한다. 둘 다 규칙 기반이며 AI 를 쓰지 않고, 결과를 저장하지 않는다. 점수와 등급은 달달사주 자체 지표라고 화면에 한 번 밝힌다([PLAIN_KOREAN.md §4](../PLAIN_KOREAN.md)).

| 기능 | 주소 | 무료/유료 | 운영 상태 |
|---|---|---|---|
| 오늘의 운세 | `/today` | 전부 무료 | 운영 중 |
| 오늘의 운세 푸시(매일 08:00 KST) | 앱 알림 | 무료 | 키 없어 꺼짐(앱 전용, [push.md](push.md)) |
| 신년운세 화면 | `/yearly`, `/yearly/:profileId` | 총운·첫 두 달 무료, 나머지는 2027 신년운세(5,900원) 구매 | 운영 중 |

## 사용자 흐름

### 오늘의 운세 (`/today`)

1. 하단 탭 '오늘', 앱의 시작 화면, 첫 화면과 전체 운세 메뉴에서 들어온다.
2. 보여 줄 사람은 화면에서 고른 프로필 → 마지막으로 고른 프로필(`activeProfile`) → 대표 프로필 → 목록 첫 번째 순서로 정한다. 오른쪽 위 버튼으로 바꾸면 `activeProfile` 에 기억한다.
3. 프로필이 없고 비회원 입력값(`birthDraft`)만 있으면 그 생년월일로 `POST /fortune/daily` 를 부르고, "결과에서 저장하면 매일 바로 볼 수 있어요" 안내를 띄운다. 둘 다 없으면 프로필 추가로 안내한다.
4. 화면 구성: 한 줄·등급·총운 점수, 영역별 점수(돈·연애·일·건강·공부)와 문장, 한눈에 보는 오늘, '오늘이 이런 이유', 사주 근거, 행운 색·숫자·방향·물건·시간, 공유 문구. 아래에 이번 주 흐름(월~일 7칸), 인피드 광고 자리(`home_infeed`, [ads-analytics.md](ads-analytics.md)), 공유 버튼, 신년운세·입력 바로가기, 전체 운세 메뉴가 있다.
5. 이번 주 흐름은 화면이 같은 주 7일을 각각 요청해 만든다(`weekDates` + `useQueries`, 10분 캐시). 칸을 누르면 그날 운세로 바뀐다.
6. 토스 미니앱에서는 내일 이후 날짜를 보상형 광고로 열게 한다(`useFutureDayGate`, 보류 상태, [toss-miniapp.md](toss-miniapp.md)). 웹·앱에서는 그대로 통과한다.

### 신년운세 화면 (`/yearly`, `/yearly/:profileId`)

1. `/yearly`(메뉴의 신년운세 버튼)는 마지막으로 고른 프로필 → 대표 프로필 → 첫 번째 프로필로 넘기고, 프로필이 없으면 프로필 추가 화면(`next=/yearly`)으로 보낸다(`YearlyEntryPage`).
2. 내 사주·오늘 화면의 "2027 신년운세" 바로가기로도 들어온다. 연도는 `?year=` 가 없으면 `targetFortuneYear()` 다.
3. 총운·키포인트·영역별 섹션·열두 달 흐름을 보여 주고, 잠금을 누르거나 아래 버튼을 누르면 결제 시트(그해 신년운세 + 그해 신년 패키지)를 연다. 그해 상품이 둘 다 없으면 결제 시트 대신 "판매하지 않아요" 안내를 띄우고, 아래 버튼 자리에 판매 중인 해로 가는 링크를 둔다.
4. 산 뒤에는 잠금이 모두 풀리고 '신년운세 리포트 열기' 카드가 붙는다. 리포트 본문은 [reports.md](reports.md).

## 관련 파일

| 구분 | 경로 |
|---|---|
| 화면 | `apps/web/src/pages/TodayPage.tsx`, `apps/web/src/pages/YearlyPage.tsx`(`YearlyEntryPage`, `YearlyPage`) |
| 컴포넌트 | `apps/web/src/components/KeyPointsCard.tsx`, `apps/web/src/components/ReadingSection.tsx`, `apps/web/src/components/PaywallSheet.tsx`, `apps/web/src/components/OpenReportCard.tsx`, `apps/web/src/components/ShareSheet.tsx`, `apps/web/src/components/AdSlot.tsx`, `apps/web/src/components/MoreMenu.tsx` |
| 웹 로직 | `apps/web/src/lib/format.ts`(`targetFortuneYear` 다시 내보내기, `todayKst`, `weekdayOf`), `packages/shared/src/fortuneYear.ts`(`targetFortuneYear`·`kstYear` 정의), `apps/web/src/lib/tossBridge.ts`(`useFutureDayGate`) |
| API | `apps/api/src/modules/fortune/routes.ts`, `apps/api/src/modules/saju/routes.ts`(`dateQuery`, `todayInSeoul`) |
| 생성기 | `apps/api/src/modules/interpretation/reading.ts`(`buildDailyFortune`, `buildYearlyFortune`, `monthSummaries`, `targetFortuneYear`), `apps/api/src/modules/interpretation/content/fortuneTemplates.ts`, `apps/api/src/modules/interpretation/content/plainFortune.ts`, `apps/api/src/modules/interpretation/content/luck.ts` |
| 권한 | `apps/api/src/modules/reports/service.ts`(`yearlyUnlocked`) |
| 계산 엔진 | `packages/saju-core/src/fortune.ts`(운 평가), `packages/saju-core/src/luck.ts`(세운·월운·일진) |
| 푸시 | `apps/api/src/jobs/dailyPush.ts` |
| 테스트 | `apps/api/test/profile-report-fixes.test.ts`(상품 없는 연도), `apps/web/src/lib/__tests__/core.test.ts`(대상 연도 경계), `apps/api/test/plain-daily-yearly.test.ts`, `apps/api/test/plain-fortune.test.ts`, `apps/api/test/api.test.ts`('오늘의 운세'), `e2e/today.spec.ts`, `e2e/content.spec.ts`(신년운세) |

## API / 데이터 모델

| 엔드포인트 | 인증 | 비고 |
|---|---|---|
| `GET /fortune/daily?profileId&date` | ✓ | `profileId` 가 없으면 대표 프로필. 프로필이 하나도 없으면 `{ needsProfile: true }` |
| `POST /fortune/daily` | - | 비회원 `{ birth, date?, name? }`. `name` 이 있으면 "서윤님," 하고 부른다 |
| `GET /fortune/yearly?profileId&year` | ✓ | `year` 가 없으면 `targetFortuneYear()` |

요청·응답 형식은 [API.md 「사주 · 운세 · 궁합」](../API.md), 운 평가 방법(용신 적합도·12운성·합충·신살로 점수 10~98)은 [SAJU_ENGINE.md §3](../SAJU_ENGINE.md)을 본다. 저장하는 테이블은 없다.

## 비즈니스 규칙 & 엣지케이스

### 오늘의 운세

- **날짜**: KST 기준 `YYYY-MM-DD`, 1900~2100 의 실재하는 날짜만 받는다(`dateQuery`). 없으면 오늘(KST)이다.
- **결정성**: 문장은 `날짜|출생 UTC 시각` 을 씨앗으로 고른다. 같은 사람·같은 날짜면 언제 열어도 같은 문장이 나온다. 그래서 캐시나 저장이 필요 없다.
- **무료 범위**: 전부 무료다. 잠금 섹션이 없다.
- AI 비용은 0원이다([COSTS.md §2](../COSTS.md)).
- 화면 제목의 요일은 `weekdayOf()` 로 구해 브라우저 시간대와 무관하다(QA BUG-04 해결).

### 신년운세 화면의 무료 범위

| 범위 | 무료 | `report:yearly:<프로필>:<연도>` 권한이 있을 때 |
|---|---|---|
| 총운 섹션, 키포인트(올해의 기운·잘 풀리는 일·조심할 것·해 볼 일), 그해 이름·등급·총운 점수 | 공개 | 공개 |
| 재물·애정·직장·건강 섹션 | 제목·한 줄 요약·점수 + 첫 문단 80자까지 | 공개 |
| 열두 달 흐름 | 첫 두 달(寅월·卯월, 양력 2·3월 무렵)만. 나머지 열 달은 점수 0·요약 빈 값으로 잘라 보낸다 | 공개 |

- 잠금 해제 조건은 그 연도의 권한 하나다(`yearlyUnlocked`). 사주분석서·패키지의 평생 권한은 신년운세 화면을 열지 않는다. 패키지는 신년운세 권한을 따로 함께 준다([reports.md](reports.md)).
- 열두 달은 절기 달(寅월 = 양력 2월 무렵)부터 다음 해 丑월(1월)까지이고, 마지막 달에는 "다음 해" 표시가 붙는다.

### 대상 연도 전환

- 대상 연도는 **KST 10월 1일부터 다음 해**다. 정의는 `packages/shared/src/fortuneYear.ts` 한 곳에 있고, 서버(`reading.ts`)와 웹(`lib/format.ts`)은 그것을 다시 내보낸다. 기준일(2026-11-26)에는 2027 이다.
- 이 규칙은 신년운세 화면 기본 연도, 내 사주·오늘 화면의 바로가기 문구, 결과 화면의 연간 운세 섹션, 유료 리포트의 기본 연도에 함께 쓰인다.
- 예전에는 웹이 `getFullYear() + 1` 을 써서 2027년 1월부터 판매 상품이 없는 2028 화면으로 넘어가는 문제가 있었다(QA BUG-05, 해결).
- 결제 시트의 상품 ID 는 `report_newyear_<연도>`, `bundle_newyear_<연도>` 로 연도에서 만든다. 결과·궁합 화면의 결제 시트도 신년 패키지를 `bundle_newyear_<targetFortuneYear()>` 로 만든다. 카탈로그에는 2027년분만 있으므로 그 밖의 연도에서는 살 수 있는 상품이 없고, 신년운세 화면은 결제 시트 대신 안내를 보여 주며 서버는 그 연도의 리포트 요청에 400 을 준다(아래 이슈 1·2).

## 주의사항 / 알려진 이슈

1. **2028 상품 준비 기한**(FEATURES §22 #10, 남김: 운영 일정): 신년운세 상품은 2027년분만 있다. 대상 연도가 2027-10-01 에 2028 로 넘어가므로 **2027-09-30 까지** `report_newyear_2028`·`bundle_newyear_2028` 을 카탈로그(`apps/api/src/modules/commerce/catalog.ts`)에 넣고 그로블 결제창도 만들어야 한다. 화면의 결제 시트는 연도에서 상품 ID 를 만들므로 카탈로그만 넣으면 된다(웹의 `bundle_newyear_2027` 고정 값은 없앴다). 상품을 넣기 전까지 2028 화면은 무료 미리보기와 "아직 판매를 시작하지 않았어요" 안내만 보인다.
2. 해결(2026-11-26): **상품이 없는 연도 열람**. 웹과 서버는 여전히 `?year=`·`year` 를 1900~2100 안에서 받고 무료 미리보기를 연다. 다만 그해 신년운세·패키지 상품이 모두 없으면 신년운세 화면이 잠금을 눌러도 결제 시트를 열지 않고 "판매하지 않아요" 안내와 판매 중인 해로 가는 링크를 보여 준다. 서버는 그 연도의 `POST /reports { type: 'yearly' }` 에 없는 상품 ID 가 담긴 402 대신 400("2030년 신년운세는 판매하지 않아요.")을 준다. 회귀 테스트: `profile-report-fixes.test.ts`.
3. 해결(2026-11-26): **연도 규칙이 두 곳에 있던 문제**. `targetFortuneYear()` 와 `kstYear()` 를 `packages/shared/src/fortuneYear.ts`(`@saju/shared/fortune-year`, zod 없음) 한 곳에 두고, 웹 `lib/format.ts` 와 서버 `interpretation/reading.ts`·`report.ts` 는 그것을 다시 내보낸다. 경계 테스트: `apps/web/src/lib/__tests__/core.test.ts`.
4. 의도된 동작으로 유지: **이번 주 흐름은 요청 7번**. 오늘 화면 하나를 열면 같은 주 7일의 운세를 하루씩 따로 요청한다(오늘 칸은 본문 요청과 캐시를 함께 쓴다). 칸을 누르면 그날 운세 전체를 바로 보여 줘야 하므로 날마다 전체 응답을 받아 10분 동안 캐시해 두는 편이 낫다고 판단했다. 주간 점수만 주는 API 를 따로 두면 칸을 누를 때마다 요청이 한 번 더 생긴다. 모두 IP 기준 요청 수 제한(60초 120회)에 함께 잡히지만 화면 하나에 8번 안팎이라 한도에 닿지 않는다.
5. 문서만 고침(2026-11-26): 옛 FEATURES §4.3 은 "`/yearly` 는 대표 프로필로 넘긴다"고 적었다. FEATURES.md 를 기능 문서로 나누면서 그 설명은 없어졌고, 이 문서 「신년운세 화면」 1번이 코드와 같다(마지막으로 고른 프로필 → 대표 → 첫 번째).
6. 남김(다른 영역): **푸시는 꺼져 있다**. 같은 오늘의 운세를 매일 08:00 KST 에 보내는 푸시는 FCM 키가 없어 동작하지 않는다(앱 전용). 자세한 내용은 [push.md](push.md).
7. QA 이력(모두 해결, [QA.md §3](../QA.md)): BUG-04(미주 시간대에서 요일이 하루 밀림), BUG-05(1월부터 신년운세 진입로가 다음 해로 넘어감), BUG-02(프로필 수정 뒤 오늘·신년 캐시가 남음).
