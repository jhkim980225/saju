# 토정비결

> 기준일: 2026-11-26. 작괘 공식·수 표·출전은 [SAJU_ENGINE.md §6](../SAJU_ENGINE.md), 요청·응답 형식은 [API.md 「토정비결 (무료)」](../API.md)를 본다.

## 목적

음력 생년월일과 대상 연도의 달력으로 144괘 중 하나를 뽑아 한 해 총평과 음력 열두 달 흐름을 무료로 보여 준다. 시각·성별 없이 생년월일만으로 볼 수 있어 검색 유입과 첫 방문자를 받고, 결과 아래에서 신년운세([reports.md](./reports.md))로 이어 준다.

운영 상태는 **운영 중**이다. AI 를 쓰지 않으므로 외부 키 없이 동작한다.

## 사용자 흐름

1. 전체 운세 메뉴, 첫 화면, 데스크톱 메뉴에서 `/tojeong` 으로 들어온다. `?year=` 로 대상 연도를 바꿀 수 있다. 기본 연도는 신년운세와 같은 규칙으로 KST 10월부터 다음 해다(`tojeongDefaultYear`, 2026-11-26 기준 2027). `?year=` 가 네 자리 정수가 아니거나 1900~2049 밖이면 웹은 그 값을 버리고 기본 연도를 쓴다(`parseTojeongYear`).
2. 화면이 입력값을 자동으로 고른다. 순서는 마지막으로 쓴 프로필(`activeProfile`) → 대표 프로필 → 첫 프로필 → 이 화면에서 전에 넣은 생년월일 → 사주 입력 중인 비회원 생년월일이다. 고를 것이 없으면 입력 폼(양력·음력, 윤달)을 보여 준다. 프로필 칩과 '다른 생년월일' 칩으로 바꿀 수 있다.
3. 결과는 괘 제목·요약·키워드, 총평 2문단, 음력 1~12월(양력 기간과 좋은 달·무난한 달·조심할 달), 옛 글귀(괘사 원문·독음), 접힌 '괘를 뽑은 방법'(세는나이·태세수·월건수·일진수와 합)이다.
4. 결과 아래에 신년운세 바로가기(프로필이 있으면 `/yearly/:id?year=<대상 연도>`, 없으면 `/input`), 결과 하단 광고 자리(`result_bottom`), 공유 버튼이 있다.

## 관련 파일

| 구분 | 경로 |
|---|---|
| 작괘 엔진 | `packages/saju-core/src/tojeong.ts`(`computeTojeong`, `TOJEONG_MIN_YEAR`, `TOJEONG_MAX_YEAR`, `TojeongYearError`) |
| 라우트·결과 조립 | `apps/api/src/modules/tojeong/routes.ts`, `apps/api/src/modules/tojeong/reading.ts`(`buildTojeong`, `plainOverview`, `TOJEONG_FLOW_LABEL`, `TOJEONG_DISCLAIMER`) |
| 144괘 원고 | `apps/api/src/modules/tojeong/content/gwae1.ts` ~ `apps/api/src/modules/tojeong/content/gwae8.ts`, `apps/api/src/modules/tojeong/content/index.ts`, `apps/api/src/modules/tojeong/content/types.ts` |
| 공용 정의 | `packages/shared/src/tojeong.ts`(`tojeongDefaultYear`, `parseTojeongYear`, `TOJEONG_YEAR_MIN`, `TOJEONG_YEAR_MAX`), `packages/shared/src/index.ts`(`tojeongBirthSchema`, `tojeongRequestSchema`) |
| 화면 | `apps/web/src/pages/TojeongPage.tsx`, `apps/web/src/lib/tojeong.ts`(`TOJEONG_BIRTH_KEY`, `validateTojeongForm`, `isTojeongYearError`, `FLOW_LABEL`) |
| 테스트 | `packages/saju-core/test/tojeong.test.ts`, `apps/api/test/tojeong.test.ts`, `apps/web/src/lib/__tests__/tojeong.test.ts`, `e2e/tojeong.spec.ts` |

## API / 데이터 모델

- `POST /tojeong`(인증 선택). 비회원은 `birth`(양력·음력 생년월일), 세션이 있으면 저장한 프로필의 `profileId` 를 보낸다. 저장한 출생 정보를 그대로 보내도 시각·성별은 무시한다.
- 서버는 아무것도 저장하지 않는다. 웹은 이 화면에서 넣은 생년월일을 브라우저 저장소(`yd.tojeongBirth`)에 기억한다.

## 비즈니스 규칙 & 엣지케이스

### 입력 검증

- 생년월일은 1900~2050년, 대상 연도는 1900~2049년이다. 음력 데이터(KASI 기준 `korean-lunar-calendar`)가 2050년까지라 대상 연도 상한이 2049 다.
- 없는 음력 날짜·윤달, 태어난 해보다 앞선 대상 연도(세는나이 1 미만)는 400 이다. 대상 연도 탓(범위 밖·태어난 해보다 앞선 해)이면 엔진이 `TojeongYearError` 를 던지고 서버는 `details: { field: 'year', defaultYear }` 를 붙인다.
- 웹은 생년월일 탓인 400 일 때만 기억해 둔 생년월일을 지운다. 연도 탓이면 생년월일은 그대로 두고 "<연도>년 토정비결은 볼 수 없어요" 안내와 기본 연도 토정비결 보기 버튼을 보인다.
- `profileId` 를 보냈는데 세션이 없으면 401, 남의 프로필이면 404 다.

### 계산

- 상괘(8)·중괘(6)·하괘(3)를 뽑아 괘 번호 111~863 을 만든다. 태어난 시각·성별은 쓰지 않는다.
- 출전마다 다른 부분은 엔진이 기준을 정했다: 세는나이는 음력 출생 연도 기준, 대상 연도 간지는 설 기준(입춘 아님), 생월 날수와 월건은 **대상 연도**의 생월 기준, 윤달 출생은 평달로 본다, 30일생인데 대상 연도 생월이 작은달이면 일진은 그믐(29일)로 본다. 보정이 들어가면 근거의 `notes` 에 적는다. 자세한 표와 손으로 푼 예시는 [SAJU_ENGINE.md §6](../SAJU_ENGINE.md).
- 월별 흐름은 음력 1~12월을 유지하고, 대상 연도에 생월의 윤달이 있으면 그달 기간에 윤달을 포함한다.

### 문장

- 괘마다 직접 쓴 원고를 쓴다. AI 를 쓰지 않는다. 괘사 첫 구절 8자는 한문 원문(공유 저작물)을 그대로 싣고, 제목·요약·총평·열두 달 문장은 원문의 뜻을 바탕으로 달달사주 콘텐츠팀이 새로 썼다. 시중 해설서와 다른 사이트의 현대어 풀이는 쓰지 않았다.
- 출산·성별·성씨·상례·관재 같은 원문의 표현은 생활 속 관리 포인트로 바꿨다.
- 총평 원고의 '…괘예요'는 화면에서 '…모습이에요·…뜻이에요'로 바꿔 보여 준다(`plainOverview`). '괘'를 설명 없이 처음 보여 주지 않으려는 규칙이다. '괘'의 뜻은 '괘를 뽑은 방법' 접힘에서 설명한다.
- 달 이름은 '좋은 달·무난한 달·조심할 달'로 신년운세 등급과 맞춘다. 서버 `TOJEONG_FLOW_LABEL` 과 웹 `FLOW_LABEL` 은 같은 값이어야 한다.
- 저자를 이지함으로 단정하지 않고 "조선 후기부터 전해 오는 세시 풍속"으로 소개한다. 『토정유고』와 『동국세시기』에 보이지 않아 19세기 중·후반에 퍼진 것으로 보기 때문이다.
- 2026-11 정확성 점검에서 괘사 오독, 요약·총평과 열두 달 흐름이 어긋난 약 60괘, 한 괘 안에서 달 문장끼리 모순된 곳을 고쳤다. 달 흐름 값은 바꾸지 않았다([../ACCURACY_REVIEW.md §4](../ACCURACY_REVIEW.md)).
- `apps/api/test/tojeong.test.ts` 가 144괘의 형식·분량·한자·금지어·제목과 달 문장 중복을 검사한다.

### 그 밖

- 검색 유입 화면이라 이 화면에 있는 동안만 탭 제목과 설명을 바꾼다. 사전 렌더링 주소에도 들어 있다([seo.md](./seo.md)).
- 공유 문구는 "<대상 연도> 토정비결 <괘 번호>괘 「제목」 + 요약"이고, 공용 공유 시트(`ShareSheet`)로 보낸다. 카카오톡 공유는 키가 없어 꺼져 있고 링크 복사·시스템 공유만 된다.
- 광고는 키가 없어 꺼져 있다([ads-analytics.md](./ads-analytics.md)).

## 주의사항 / 알려진 이슈

1. 해결(2026-11-26): FEATURES.md §9 의 자동 선택 순서 서술을 코드 기준으로 정리했다. 순서는 마지막으로 쓴 프로필(`activeProfile`) → 대표 프로필 → 첫 프로필 → 이 화면에서 전에 넣은 생년월일 → 사주 입력 중인 비회원 생년월일이다(이 문서 '사용자 흐름' 2). FEATURES.md 는 도메인 문서로 옮겨져 지금은 이 문서가 기준이다.
2. 해결(2026-11-26): 기본 대상 연도를 상수(2027) 대신 날짜로 정한다(`tojeongDefaultYear`, KST 10월부터 다음 해). 서버 기본값과 웹 기본값이 같은 함수를 쓴다. `e2e/tojeong.spec.ts` 는 2027년을 기대하므로 2027-10-01(KST) 이후에는 기대값을 고쳐야 한다.
3. 해결(2026-11-26): 웹은 `?year=` 를 범위 확인(`parseTojeongYear`) 뒤에만 쓰고, 서버가 대상 연도 탓의 400(`details.field='year'`)을 주면 기억해 둔 생년월일을 지우지 않는다.
