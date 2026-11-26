# 사주 (입력 · 결과 · 내 사주 · 프로필 · 만세력 · 사주 기초)

> 기준일: 2026-11-26. `feat/cloudflare` 작업 트리의 코드를 기준으로 적었다. 이 문서는 [FEATURES.md](../FEATURES.md) §2·§10과 §22 중 이 도메인 항목을 대체한다.

## 목적

생년월일시를 받아 사주 원국을 계산하고, 규칙 기반 풀이를 무료 범위와 유료 범위로 나눠 보여 준다. 설계 원칙은 "결과 먼저, 가입은 나중에"다([architecture.md §4.1](../architecture.md)). 비회원도 입력만으로 결과를 끝까지 볼 수 있고, 저장하거나 결제하는 순간에만 게스트 세션과 프로필을 만든다. 저장한 사주(프로필)는 오늘의 운세·신년운세·궁합·리포트·상담이 모두 같은 ID 로 참조하는 기준 데이터다.

운영 상태는 이 문서의 모든 기능이 **운영 중**이다(로그인 없이 쓰는 만세력·사주 기초 포함). AI 는 쓰지 않는다.

## 사용자 흐름

1. **입력**: 웹은 첫 화면(`/`)에 입력 폼이 붙어 있고, 앱은 `/today` 로 바로 간다. `/input` 도 같은 폼이다. 순서는 이름 → 성별 → 생년월일 → 시간 → 출생지이며, 고급 설정에서 보정 방식과 자시 규칙을 고른다. "입력값 기억"을 체크하면 다음에 폼이 채워진다.
2. **계산 확인**(`/confirm`): `POST /saju/chart` 로 음양력 변환, 요일, 보정 시각과 그 이유(경도 차이·서머타임)를 보여 준다. 생일에 절입이 있거나 절입 1시간 안에 태어났으면 엔진 경고를 쉬운 말로 바꿔 보여 준다(`plainWarning`).
3. **결과**(`/result`): 입력값은 브라우저 저장소(`STORAGE_KEYS.birthDraft`)에만 있고 서버에는 저장하지 않는다. `POST /saju/reading` 에 생년월일과 이름만 보낸다. 로딩 화면은 최소 1.5초 보여 준다(`MIN_LOADING_MS`).
4. **저장·결제**: 결과 화면에서 저장 버튼이나 결제를 누르면 게스트 세션을 만들고(`ensureSession`) 지금 계정의 프로필 목록을 받는다. 같은 출생 정보(이름을 넣었으면 이름까지)의 사주가 있으면 그 사주를 쓰고, 없으면 입력값을 새 프로필로 저장한 뒤 `/saju/:id` 로 옮긴다(`ResultPage` 의 `ensureProfile`). 새로 저장할 때 대표이거나 관계가 '본인'인 사주가 이미 있으면 관계 '기타'로, 없으면 '본인'으로 저장한다. 이름을 비웠으면 '나'(본인) 또는 '기타'가 이름이 된다. 결제는 회원만 가능하므로 게스트는 로그인 화면을 거쳐 돌아온다([payments.md](payments.md), [auth.md](auth.md)).
5. **내 사주**(`/saju`, `/saju/:profileId`): 하단 탭 '내 사주'. 마지막으로 고른 프로필(`STORAGE_KEYS.activeProfile`) → 목록 첫 번째 순서로 보여 주고, 프로필이 둘 이상이면 칩으로 바꾼다. 위에 신년운세 바로가기와 리포트 보관함 링크, 본문 아래에 '보고서 열기'·주제별 리포트 카드가 붙는다([reports.md](reports.md)).
6. **사주 요약**(`/result/summary`, `/saju/:profileId/summary`): 결과·내 사주 화면의 '사주 요약' 카드에서 들어간다. 원국·분석(오행·강약·용신·십성·신살·합충·공망)·대운·분야별 한 줄·한눈에 보는 나를 한 장에 모으고 '텍스트로 복사'를 준다. 풀이 화면과 같은 query key 를 써서 다시 계산하지 않는다.
7. **프로필 추가·수정**(`/profiles/new`, `/profiles/:id/edit`): 내 사주·마이·오늘·궁합의 추가 버튼에서 들어간다. 저장하면 쿼리 캐시 전체를 무효화한다(아래 QA BUG-02).
8. **만세력**(`/manse`): 전체 운세 메뉴·마이·데스크톱 메뉴에서 들어간다. 날짜를 고르면 양력·음력, 연주·월주·일주, 입춘 전이면 "아직 지난해 간지" 안내, 그해 24절기 시각(KST)을 보여 준다. 아래에 택일 바로가기 카드가 있고, 고른 날이 오늘 뒤면 그 날짜를 넘긴다([taekil.md](taekil.md)).
9. **사주 기초**(`/basics`): 천간·지지·일간·오행·십성·용신·대운 설명. 첫 화면 '사주 기초부터 보기', 마이, 전체 운세 메뉴, 풀이 화면의 용어 시트(`TermSheet`)에서 들어간다. 이 화면이 문체 기준의 기준 예시다([PLAIN_KOREAN.md](../PLAIN_KOREAN.md)).

## 관련 파일

| 구분 | 경로 |
|---|---|
| 화면 | `apps/web/src/pages/BirthFormPage.tsx`(`BirthForm`: 입력·추가·수정 공용), `apps/web/src/pages/ConfirmPage.tsx`, `apps/web/src/pages/ResultPage.tsx`, `apps/web/src/pages/MySajuPage.tsx`, `apps/web/src/pages/SummaryPage.tsx`, `apps/web/src/pages/BasicsPage.tsx`, `apps/web/src/pages/MiscPages.tsx`(`MansePage`), `apps/web/src/pages/LandingPage.tsx` |
| 공통 본문 | `apps/web/src/components/ReadingView.tsx`(결과·내 사주 공용, 결제 시트 선택), `apps/web/src/components/ReadingSection.tsx`(`navLabel`, 잠금 카드), `apps/web/src/components/PillarTable.tsx`, `apps/web/src/components/ElementBars.tsx`, `apps/web/src/components/DaeunTimeline.tsx`, `apps/web/src/components/TermSheet.tsx`, `apps/web/src/components/BasicsDialog.tsx` |
| 웹 로직 | `apps/web/src/lib/birth.ts`(폼 검증·변환, 도시 목록, `sameBirth`·`draftProfileFields`), `apps/web/src/lib/sajuSummary.ts`, `apps/web/src/lib/sajuBasics.ts`, `apps/web/src/lib/storage.ts` |
| API | `apps/api/src/modules/saju/routes.ts`(`resolveChart`, `dateQuery`, 만세력), `apps/api/src/modules/profiles/routes.ts`, `apps/api/src/modules/profiles/service.ts` |
| 풀이 생성 | `apps/api/src/modules/interpretation/reading.ts`(`buildBasicReading`, `lock`, `targetFortuneYear`), `apps/api/src/modules/interpretation/content/`, `apps/api/src/modules/interpretation/verdicts.ts` |
| 권한 판정 | `apps/api/src/modules/reports/service.ts`(`access`) |
| 계산 엔진 | `packages/saju-core/src/chart.ts`, `packages/saju-core/src/calendar.ts`, `packages/saju-core/src/basics.ts`, `packages/saju-core/src/elements.ts`, `packages/saju-core/src/shinsal.ts`, `packages/saju-core/src/relations.ts`, `packages/saju-core/src/luck.ts` |
| 계약 | `packages/shared/src/index.ts`(`birthInputSchema`, `chartRequestSchema`, `profileCreateSchema`), `packages/shared/src/profile.ts`(관계 목록) |
| 테스트 | `packages/saju-core/test/pillars.test.ts`, `packages/saju-core/test/analysis.test.ts`, `apps/api/test/api.test.ts`, `apps/api/test/profile-report-fixes.test.ts`, `apps/api/test/plain-reading.test.ts`, `apps/web/src/pages/__tests__/ResultPage.test.tsx`, `apps/web/src/lib/__tests__/core.test.ts`, `apps/api/test/plain-tone.test.ts`, `e2e/onboarding.spec.ts`, `e2e/input-validation.spec.ts`, `e2e/profile-edit.spec.ts`, `e2e/summary.spec.ts`, `e2e/basics.spec.ts`, `e2e/content.spec.ts`(만세력) |

## API / 데이터 모델

| 엔드포인트 | 인증 | 비고 |
|---|---|---|
| `POST /saju/chart` | opt | `birth` 또는 `profileId`. `profileId` 는 토큰이 있어야 하고 소유자만 |
| `POST /saju/reading` | opt | 권한에 따라 유료 섹션을 서버에서 잘라 보낸다 |
| `POST /saju/years?from&to` | opt | 연도별 세운 점수. 기본 범위는 올해(KST) −2 ~ +7, 최대 30년 |
| `GET /saju/manse?date=YYYY-MM-DD` | - | 날짜가 없으면 오늘(KST) |
| `GET·POST /profiles`, `GET·PATCH·DELETE /profiles/:id` | ✓ | 게스트 토큰도 통과한다 |

요청·응답 형식은 [API.md 「프로필」「사주 · 운세 · 궁합」](../API.md), 계산 규칙(음양력·절기·보정·자시·대운·용신)은 [SAJU_ENGINE.md §1~§5](../SAJU_ENGINE.md)를 본다. 프로필은 `profiles` 테이블에 출생 정보를 그대로 저장하고, 원국은 저장하지 않고 요청마다 다시 계산한다(`chartOf`). 권한 키 모양은 [architecture.md §4.4](../architecture.md)를 본다.

## 비즈니스 규칙 & 엣지케이스

### 무료·유료 경계 (결과·내 사주 화면)

| 섹션 | 무료 | 미니 리포트(`report_saju_mini`, 990원) | 평생 사주분석서(`report_saju_lifetime`, 9,900원) |
|---|---|---|---|
| 한눈에 보는 나(성격·잘하는 것·조심할 것·필요한 것·행운 포인트) | 공개 | 공개 | 공개 |
| 총평·성격·오행·용신·신살 | 공개 | 공개 | 공개 |
| 재물·연애·직업 | 잠금 | 공개 | 공개 |
| 건강·십신·대운·올해(10월부터는 다음 해) 운세 | 잠금 | 잠금 | 공개 |

- **잠금 방식**: `lock()` 이 본문을 첫 문단 하나만 남기고, 그 문단이 80자를 넘으면 80자에서 자른 뒤 `locked: true` 와 `unlockProductId` 를 붙인다. 제목과 한 줄 요약(`summary`)은 그대로 둔다. 서버가 자르므로 화면을 조작해도 본문을 볼 수 없다.
- 사주표(8글자, 전문가 보기의 지장간·12운성·납음·신살)와 오행 분포는 무료다.
- 사주 요약의 분야별 한 줄은 섹션 `summary` 를 그대로 쓰므로 잠긴 분야의 한 줄도 보인다. 의도된 동작이다.
- **결제 시트 구성**(`ReadingView` 의 `openPaywall`): 재물·연애·직업 잠금을 누르면 평생 사주분석서·미니 리포트·신년 패키지, 그 밖의 잠금을 누르면 평생 사주분석서·신년 패키지를 보여 준다. 신년 패키지는 대상 연도의 것(`bundle_newyear_<targetFortuneYear()>`)이고, 그해 상품이 카탈로그에 없으면 시트가 목록에서 뺀다. 잠금 카드의 가격은 미니 섹션이면 미니 가격, 나머지는 평생 가격이다.
- **권한 판정**(`reports.access`): `report:lifetime:<프로필>` 이 있으면 전체, `report:mini:<프로필>` 이 있으면 미니, 아니면 무료. 권한은 프로필 ID 에 걸리므로 비회원 결과(`birth` 로 요청)는 산 사람이라도 언제나 무료 범위다. 상품·가격 규칙은 [reports.md](reports.md).
- 미니 리포트는 계정당 1회만 살 수 있고 프로필 하나에만 걸린다. 결과 화면을 여는 권한일 뿐 보관함에 문서를 만들지 않는다.

### 입력 검증

- 서버(`birthInputSchema`): 연도 1900~2100, 월 1~12, 일 1~31, 시·분은 비워도 된다(시간 모름 → 시주 없이 6글자). 성별 필수. 시간대·경도·보정 방식·자시 규칙은 선택이고 기본값은 `Asia/Seoul`, 126.978, `lmt`, `nextDay` 다.
- 실재하지 않는 날짜, 없는 윤달, 음력 범위 밖(1000~2050년 밖)은 엔진이 `SajuInputError` 로 거절하고 400 이 된다. 프로필 저장·수정도 저장 전에 같은 계산으로 검증한다.
- 웹 폼(`lib/birth.ts`)은 연도를 1900~2050 으로, 이름을 12자로 더 좁게 막는다. 서버는 프로필 이름 1~20자(앞뒤 공백 제거), 비회원 `name` 은 20자까지 받는다.
- 웹 폼에서 이름을 비우면 본인은 '나', 그 밖의 관계는 관계 이름으로 저장한다. 풀이는 '나'·'본인' 같은 이름을 부르지 않는다(서버 `displayName`).
- 해외 출생은 도시 검색으로 시간대와 경도를 넣는다. E2E 는 뉴욕 출생이 +4분 보정되는지 확인한다.

### 프로필

- 한 계정에 50개까지 저장한다(`MAX_PROFILES`). 넘으면 400. 개수 확인과 저장은 `atomic()` 한 묶음이라 동시에 저장해도 넘지 않는다.
- **대표 프로필**: 새로 저장할 때 관계가 '본인'이거나 첫 프로필이면 대표가 되고, 기존 대표 표시는 같은 batch 안에서 끈다. 대표를 지우거나 `isPrimary: false` 로 바꾸면 남은 사주 가운데 관계가 '본인'인 사주, 없으면 가장 먼저 저장한 사주를 같은 batch 안에서 대표로 올린다. 사주가 하나뿐이면 대표를 끄는 요청은 무시한다. 목록과 `primary()` 는 대표 → 만든 순서로 정렬한다.
- **수정(PATCH)**: 보낸 필드만 바꾼다. 관계를 빼고 이름만 보내면 관계는 그대로다.
- **구매 뒤 출생 정보 수정 금지**: 그 프로필에 묶인 구매가 있으면 출생 정보를 바꾸는 PATCH 는 409 다. 묶인 구매는 `report:` 로 시작하고 그 프로필 ID 가 들어간 권한(궁합 `report:compatibility:<A>:<B>` 는 두 사람 모두), 그리고 상세를 연 택일 결과(`taekil:reading:<결과 ID>`, 그 결과의 본인이나 상대가 이 프로필)다. 권한이 프로필 ID 에 묶여 있으므로, 출생 정보를 바꿔 다른 사람 풀이에 재사용하는 것을 막으려는 규칙이다. 이름·관계 수정과 삭제는 막지 않는다.
- **삭제**: 구매 여부로 막지 않는다. 지우기 전에 이 프로필로 산 리포트 중 아직 만들지 않은 것을 먼저 만들고, 리포트는 보관함에 '삭제된 프로필'로 남는다([reports.md](reports.md)).

### 풀이의 결정성

- 문장은 무작위 없이 입력값의 해시로 고른다. 같은 입력이면 같은 날에는 항상 같은 풀이가 나온다.
- 대운 섹션은 요청 시각의 나이로, 연간 운세 섹션은 `targetFortuneYear()`(KST 10월부터 다음 해, `packages/shared/src/fortuneYear.ts`)로 정해지므로 날짜가 바뀌면 내용도 바뀐다.

### 만세력

- 날짜 범위는 1900-01-01 ~ 2100-12-31 이고, 없는 날짜는 400 이다. 음력은 2050년 뒤에는 `null` 이다.
- 연주·월주는 그날 **정오(KST), 보정 없음** 기준으로 계산한다. 절입이 그날 오후에 있으면 그날의 월주는 앞 달로 나온다. 입춘 전 안내도 같은 정오 기준이다.
- 로그인이 필요 없고 저장하지 않는다.

## 주의사항 / 알려진 이슈

### 버그 의심 (모두 해결)

1. 해결(2026-11-26): **비회원 결과 저장 ID 재사용**. 예전에는 `ResultPage` 가 처음 저장한 프로필 ID 를 `localStorage['yd.savedDraftProfile']` 에 기억해 두고, 다른 생년월일을 새로 넣거나 계정이 바뀌어도 그 ID 로 이동·결제했다. 이제 기억해 둔 ID 를 쓰지 않는다. 저장·결제를 누르면 지금 계정의 프로필 목록을 새로 받아 같은 출생 정보(이름을 넣었으면 이름까지)의 사주를 찾아 쓰고, 없으면 새로 만든다. 남아 있던 `yd.savedDraftProfile` 값은 결과 화면을 열 때 지운다. 저장·결제를 연달아 눌러도 같은 화면에서는 하나만 만든다. 회귀 테스트: `apps/web/src/pages/__tests__/ResultPage.test.tsx`.
2. 해결(2026-11-26): **비회원 결과를 저장하면 대표 프로필이 바뀌던 문제**. 대표이거나 관계가 '본인'인 사주가 이미 있으면 관계 '기타'로 저장해 대표를 바꾸지 않는다. 사주가 하나도 없을 때만 '본인'으로 저장한다(`lib/birth.ts` 의 `draftProfileFields`, 테스트 `core.test.ts`).
3. 해결(2026-11-26): **PATCH 에서 관계를 빼면 '본인'으로 바뀌던 문제**. `profileUpdateSchema` 를 기본값이 없는 필드로 따로 만들었다. 생성 스키마만 `relation` 기본값 `'self'` 를 가진다. 회귀 테스트: `apps/api/test/profile-report-fixes.test.ts`.
4. 해결(2026-11-26): **대표 프로필이 비던 문제**. 대표를 지우거나 `isPrimary: false` 로 바꾸면 남은 사주 가운데 관계가 '본인'인 사주, 없으면 가장 먼저 저장한 사주를 같은 batch 안에서 대표로 올린다. 사주가 하나뿐이면 `isPrimary: false` 를 무시하고 대표로 둔다.
5. 해결(2026-11-26): **프로필 50개 제한이 원자적이지 않던 문제**. 저장을 `atomic()` 으로 바꾸고 "읽은 개수가 그대로인가"를 guard 로 다시 확인한다. 동시에 저장해도 50개를 넘지 않고, 대표가 둘이 되지 않는다(넘는 요청은 400).
6. 해결(2026-11-26): **`/saju/years` 의 기준 연도**. 기본 범위를 KST 날짜(`todayInSeoul()`)로 정한다. KST 1월 1일 0~9시에도 새해가 기준이다.

### 죽은 코드·미완성

7. 해결(2026-11-26): `STORAGE_KEYS.lastReading` 을 지웠다. 네이티브 저장소 테스트(`native.test.ts`)는 저장 어댑터 동작만 확인하는 예시 키로 문자열 `'yd.lastReading'` 을 그대로 쓴다.
8. 해결(2026-11-26): `ReadingView` 의 AI 배지와 AI 면책 줄(`reading.generator === 'ai'`)을 지웠다. 기본 풀이는 언제나 규칙 기반이라 보이지 않던 코드다. 남김: '전체 풀이' 배지(`isPremiumUser`)와 `access()` 의 `isPremium` 분기는 구독 잔재다. 구독 상품이 없어 동작하지 않고, 정리는 이번 범위에서 뺐다(PRD §2 의 "구독 안 함" 결정과 같아 동작 문제는 없다).

### FEATURES.md 에서 옮긴 항목

9. 해결(2026-11-26): **산 리포트가 있는 프로필 삭제**. 지우기 전에 이 프로필로 산 리포트(평생·주제별·신년운세·궁합) 가운데 아직 만들지 않은 것을 먼저 만들어 보관함에 남긴다(`reports.materializeForProfile`). 결제 직후 미리 만들기가 실패한 채 지워도 산 리포트를 잃지 않는다. 의도된 동작으로 유지: 구매 여부로 삭제를 막지는 않는다. 삭제는 그 사람의 출생 정보를 지우는 일이라 막을 이유가 없다. 같은 까닭으로 사주분석서·연애·재물 리포트 위의 근거 표(원국·오행·대운)는 출생 정보가 없어 다시 계산하지 않고 빠진다. 리포트 본문은 저장본이라 그대로 열린다([reports.md](reports.md)).
10. 해결: 사주 결과 공유 링크는 무료 입력 화면(`/input`)으로 보낸다. 결과는 공유한 사람의 생년월일로만 열리기 때문이다(FEATURES §22 #18).
11. 문서만 고침(2026-11-26): 옛 FEATURES §2 는 내 사주 기본 프로필을 "대표 프로필"로 적었다. FEATURES.md 를 기능 문서로 나누면서 그 설명은 없어졌고, 이 문서 「사용자 흐름」 5번이 코드와 같다(마지막으로 고른 프로필 `activeProfile` → 목록 첫 번째, 목록은 대표가 맨 앞).

### QA 이력 (모두 해결, [QA.md §3](../QA.md))

- BUG-02: 사주 정보를 고친 뒤 예전 풀이가 보였다. 저장 뒤 `qc.invalidateQueries()` 로 전체 캐시를 무효화해 고쳤다(`profile-edit.spec.ts`).
- BUG-01: 결과 화면 섹션 바로가기에 빈 칩 4개가 있었다. `navLabel()` 로 모든 칩에 라벨을 붙였다.
- BUG-03: 10월부터 연간 운세 섹션이 다음 해인데 라벨이 "올해의 운세"였다. 다음 해면 "2027년 운세"처럼 연도를 붙인다.

### 문구 정확성

풀이 문구의 명리학 설명 기준(용신·신강약·오행 집계·대운 시작 나이 등을 "달달사주 기준"으로 밝히는 범위)은 [ACCURACY_REVIEW.md](../ACCURACY_REVIEW.md)와 [PLAIN_KOREAN.md §4](../PLAIN_KOREAN.md)를 따른다. 용신은 억부법 간이 판단이며 조후·격국은 반영하지 않는다([SAJU_ENGINE.md §5](../SAJU_ENGINE.md)).
