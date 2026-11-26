# 궁합

> 기준일: 2026-11-26. `feat/cloudflare` 작업 트리의 코드를 기준으로 적었다. 이 문서는 [FEATURES.md](../FEATURES.md) §5 를 대체한다. 유료 궁합 리포트 본문(`/reports/:id`)의 생성·AI 다듬기 규칙은 [reports.md](reports.md)에 있다.

## 목적

저장한 두 사람의 사주로 궁합 점수와 요약을 무료로 보여 주고, 상세 풀이와 궁합 리포트를 유료(`report_compat` 5,900원, 또는 2027 신년 패키지의 궁합 1회권)로 연다. 무료 화면은 규칙 기반이며 AI 를 쓰지 않는다.

운영 상태: **운영 중**.

## 사용자 흐름

1. 하단 탭 '궁합', 전체 운세 메뉴, 결과 화면 링크에서 `/compatibility` 로 들어온다. 쿼리 `?a=&b=` 로 두 사람을 지정할 수 있다.
2. 첫 사람(`a`)은 쿼리가 없으면 대표 프로필(없으면 첫 프로필)이다. 상대(`b`)를 고르는 시트에서 프로필을 고르거나 새로 추가한다(관계 기본값 '연인·배우자', `next=/compatibility`). 프로필이 하나도 없으면 본인 사주 추가로 안내한다.
3. 관계(연인·친구 등)는 고르지 않는다. 결과는 두 사람의 사주만으로 정해진다. 두 사람이 정해지면 `POST /compatibility` 로 점수·등급·한 줄·항목별 점수(성격·끌림·안정·보완)와 섹션을 받는다.
4. 잠긴 섹션을 누르면 먼저 지갑(`GET /wallet`)에서 궁합 1회권 수를 본다. 1회권이 있으면 "궁합 1회권 n장을 가지고 있어요. A × B 궁합에 1장을 쓰면 …" 확인 시트를 띄우고, '1회권 1장 쓰기'를 누르면 `POST /reports { type: 'compatibility' }` 가 1회권을 써서 두 사람 조합을 연다. "궁합 1회권을 사용했어요" 알림을 띄운 뒤 화면을 다시 불러온다. 1회권이 없으면 요청 없이 결제 시트(궁합 리포트 + 대상 연도의 신년 패키지 `bundle_newyear_<targetFortuneYear()>`, 그해 상품이 없으면 빠짐)를 연다. 확인 뒤 1회권이 그사이 없어졌으면 402 가 오고 결제 시트를 연다.
5. 결제 뒤에는 `/compatibility?a=&b=` 로 돌아온다. 잠금이 모두 풀리면 '궁합 리포트 전체' 카드(`OpenReportCard`)가 붙고, 여기서 리포트를 연다.
6. 공유 버튼은 두 사람 이름이 들어간 문구와 `/compatibility` 링크를 보낸다. 생년월일은 넣지 않는다. 카카오톡 공유는 키가 없어 꺼져 있고 링크 복사·시스템 공유만 된다.

## 관련 파일

| 구분 | 경로 |
|---|---|
| 화면 | `apps/web/src/pages/CompatibilityPage.tsx` |
| 컴포넌트 | `apps/web/src/components/ReadingSection.tsx`(`ReadingSectionCard`), `apps/web/src/components/PaywallSheet.tsx`, `apps/web/src/components/OpenReportCard.tsx`, `apps/web/src/components/ShareSheet.tsx` |
| API | `apps/api/src/modules/compatibility/routes.ts` |
| 문장 | `apps/api/src/modules/interpretation/reading.ts`(`buildCompatibilitySections`, `COMPAT_GRADE_LABEL`) |
| 권한 | `apps/api/src/modules/reports/service.ts`(`compatUnlocked`, `create` 의 `compatibility` 분기), `apps/api/src/modules/commerce/service.ts`(`compatKey`, `redeemTicket`, `entitlementKeys`) |
| 계산 엔진 | `packages/saju-core/src/compatibility.ts`(`calculateCompatibility`) |
| 계약 | `packages/shared/src/index.ts`(`compatibilityRequestSchema`, `CompatibilityDto`) |
| 테스트 | `apps/api/test/api.test.ts`('비회원 궁합', '신년 패키지 → 신년운세 + 궁합 1회권 사용'), `apps/api/test/report-polish.test.ts`('신년 패키지 · 궁합 1회권'), `apps/api/test/profile-report-fixes.test.ts`('궁합 리포트: 두 사람 순서'), `e2e/compatibility.spec.ts` |

## API / 데이터 모델

| 엔드포인트 | 인증 | 비고 |
|---|---|---|
| `POST /compatibility` | opt | 양쪽 각각 `profileId` 또는 `birth`(+`name`). 프로필 ID 를 쓰면 토큰이 필요하고 소유자만. 같은 프로필 ID 두 번은 400 |
| `POST /reports { type: 'compatibility', profileId, partnerProfileId }` | ✓ | 1회권 사용과 리포트 생성. [reports.md](reports.md) |

요청·응답 형식은 [API.md 「사주 · 운세 · 궁합」](../API.md), 점수 산식(일간 관계·일지(배우자궁) 관계·띠 관계·오행 보완·용신 보완·배우자성)은 [SAJU_ENGINE.md §3](../SAJU_ENGINE.md)을 본다.

권한 키는 두 프로필 ID 를 정렬해 만든 `report:compatibility:<작은 ID>:<큰 ID>` 다(`compatKey`). 그래서 A×B 와 B×A 는 같은 권한으로 열린다. 궁합 리포트도 두 순서를 같은 리포트로 본다. 저장 행은 처음 만든 순서(누구의 입장에서 쓴 풀이인지)를 그대로 두고, 반대 순서로 열면 그 저장본을 돌려준다. 상대가 정해지지 않은 구매는 `ticket:compatibility:<주문 ID>` 1회권으로 지급된다.

## 비즈니스 규칙 & 엣지케이스

### 무료·유료 경계

| 범위 | 무료 | 궁합 권한이 있을 때 |
|---|---|---|
| 점수(100점 만점)·등급·한 줄, 항목별 점수 4개 | 공개 | 공개 |
| 한눈에 보는 궁합(`summary`) | 공개. 긍정 요인 2개까지를 문장으로 쓴다 | 공개 |
| 서로 끌리는 이유·함께 조심할 점·더 좋은 관계를 위한 조언 | 제목·한 줄 요약 + 첫 문단 80자까지 | 공개 |
| 근거(`result.factors`) | 긍정 요인 2개까지만 응답에 담는다 | 전부 |
| 궁합 리포트 본문(`/reports/:id`) | 없음 | 공개 |

- 근거를 2개로 자르는 이유는, 잠긴 섹션의 본문과 같은 내용이 근거 목록으로 새지 않게 하려는 것이다. 무료 요약에 쓴 긍정 요인과 같은 범위만 보낸다.
- 점수는 달달사주 자체 지표라고 화면에 한 번 밝힌다([PLAIN_KOREAN.md §4](../PLAIN_KOREAN.md)).

### 권한과 1회권

- **잠금 해제 조건**: 로그인한 사용자가 두 사람 모두 **프로필 ID** 로 요청하고, 그 조합의 권한이 있을 때만 풀린다. 한쪽이라도 `birth` 로 보내면 산 사람이라도 언제나 잠긴 응답이다. 웹 화면은 저장한 프로필만 쓴다.
- **궁합 화면에서 사면**: 주문에 두 사람이 들어가므로 그 조합에 바로 권한이 걸리고, 결제 확정 직후 주문의 순서(`profileId` → `partnerProfileId`)대로 리포트를 미리 만든다.
- **상점에서 사거나 패키지로 받으면**: 상대가 정해지지 않아 1회권으로 지급된다. 신년 패키지는 궁합 화면 결제 시트에서 사도 상대를 넘기지 않으므로 1회권이다. 1회권은 처음으로 잠긴 궁합을 열 때(`POST /reports`) 가장 오래된 것부터 하나 쓰이고 실제 권한으로 바뀐다(`redeemTicket`, `atomic()` 으로 같은 1회권을 두 요청이 쓰지 못하게 한다).
- **1회권은 확인을 받고 쓴다**: 잠금을 눌렀을 때 1회권이 있으면 어느 두 사람에게 쓸지 화면이 먼저 묻는다. 한 번 쓴 1회권은 다른 조합으로 옮길 수 없다.
- **이미 열린 조합**은 1회권을 쓰지 않는다. 1회권이 없을 때는 동시에 다른 요청이 방금 연 경우를 대비해 권한을 한 번 더 확인한다.
- 같은 사람끼리는 리포트를 만들 수 없다(400). 화면의 고르기 시트도 이미 고른 사람을 목록에서 뺀다.
- 결제는 회원만 할 수 있다. 1회권 사용(`POST /reports`)은 결제가 아니므로 토큰만 있으면 된다.

## 주의사항 / 알려진 이슈

1. 해결(2026-11-26): **순서를 바꿔 열면 리포트가 하나 더 생기던 문제**. 재사용 조회(`create` 의 `findExisting`)가 A×B 와 B×A 를 함께 찾고, 둘 다 있으면 먼저 만든(ID 가 작은) 쪽을 쓴다. 두 순서를 동시에 처음 만들면 유니크 인덱스 `reports_target_uq` 가 순서를 그대로 써서 둘 다 저장되므로, 저장 직후 반대 순서의 행을 다시 찾아 ID 가 큰 쪽이 자기 행을 지우고 물러난다(다듬기를 맡기기 전이라 AI 비용도 한 번이다). 스키마는 바꾸지 않았다. 이 수정 전에 이미 두 건이 생긴 계정은 두 건이 그대로 보관함에 남고, 다시 열면 먼저 만든 쪽이 열린다. 회귀 테스트: `profile-report-fixes.test.ts`, `report-polish.test.ts`('궁합 단건 결제').
2. 해결(2026-11-26): **관계 칩이 아무 데도 쓰이지 않던 문제**. 화면에서 관계 선택(연인·알아 가는 사이·친구·가족·동료)과 그 문구(`compatibility.relationLabel`·`compatibility.relations`)를 없앴다. 궁합 점수와 풀이는 두 사람의 사주만으로 정해지고 관계에 따라 달라지는 문안이 없으므로, 보내서 쓰는 쪽보다 화면에서 빼는 쪽을 골랐다.
3. 해결(2026-11-26): **결제 시트의 패키지 ID 가 고정돼 있던 문제**. `CompatibilityPage`·`ReadingView` 가 `bundle_newyear_<targetFortuneYear()>` 를 넘긴다. 그해 패키지가 카탈로그에 없으면 결제 시트가 목록에서 뺀다. 2028 패키지는 카탈로그에만 넣으면 된다([fortune.md](fortune.md) 이슈 1).
4. 해결(2026-11-26): **잠금 섹션 클릭이 곧 1회권 사용이던 문제**. 잠금을 누르면 먼저 지갑(`GET /wallet`)에서 궁합 1회권 수를 본다. 1회권이 있으면 "궁합 1회권 n장을 가지고 있어요. A × B 궁합에 1장을 쓰면 …" 확인 시트를 띄우고, '1회권 1장 쓰기'를 눌러야 `POST /reports` 를 보낸다. 1회권이 없으면 요청 없이 결제 시트를 연다. E2E: `e2e/compatibility.spec.ts`.
5. 의도된 동작으로 유지 + 일부 고침(2026-11-26): **무료 궁합은 비회원 생년월일로도 API 가 동작한다**. `POST /compatibility` 가 인증 없이 `birthA`·`birthB` 를 받는 것은 무료 계산이고 아무것도 저장하지 않으며, 생년월일로 보낸 쪽은 언제나 잠긴 응답이라 우회할 것이 없어 그대로 둔다(웹 밖의 클라이언트가 비회원 결과처럼 쓸 수 있게 열어 둔 계약이다). 같은 프로필 ID 를 두 번 보내는 요청은 리포트 생성과 같게 400 으로 막았다.
6. FEATURES §5 와 코드의 차이는 없다. 궁합 계산 문구의 정확성 수정 이력('둘 다 지치기 쉬운 달'을 두 사람 모두 낮은 달로 고침, 원진·반합 정의 정리)은 [ACCURACY_REVIEW.md](../ACCURACY_REVIEW.md) §2·§6 에 있다.
