# 기능구현명세 (FEATURES)

> 기준일: **2026-11-25**. 이 날의 코드(`feat/cloudflare` 작업 트리)와 운영 설정을 기준으로 적었다.

이 문서는 달달사주의 기능을 하나씩 나눠, 기능마다 아래 다섯 가지를 한곳에서 찾을 수 있게 정리한다.

1. 어떤 화면에서 보이고 어디서 들어오는가
2. 무료로 보이는 범위와 돈을 내야 열리는 범위(상품 ID·가격·함께 주는 질문권)
3. 동작 규칙: 입력 검증, 횟수 제한, 1회 구매 제한, AI 사용 여부와 실패했을 때의 대체 동작, 저장·재사용
4. API 엔드포인트와 핵심 코드 위치(`경로:줄`)
5. 운영 상태

이미 다른 문서에 자세히 적힌 내용(요청·응답 형식, 결제사 연동 절차, 계산 공식, 비용)은 옮겨 적지 않고 해당 문서의 절로 연결한다. 코드에서 확인하지 못한 내용은 "확인 못 함"이라고 적는다.

## 0. 읽기 전에

### 0.1 자주 나오는 말

| 말 | 뜻 |
|---|---|
| 게스트 | 가입하지 않은 사용자. 앱·웹을 처음 열면 서버가 게스트 계정을 만들고 토큰을 준다(`POST /auth/guest`). 사주 저장·상담·타로는 게스트로도 쓸 수 있지만 결제는 회원만 할 수 있다 |
| 회원 | 이메일(또는 소셜) 계정으로 가입한 사용자. 코드에서는 `provider !== 'guest'` 인 사용자다(`apps/web/src/lib/session.ts:89`) |
| 프로필 | 저장한 사주 한 사람분(이름·관계·출생 정보). 한 계정에 여러 명을 저장한다 |
| 규칙 기반 | 미리 써 둔 문안과 계산 결과를 정해진 규칙으로 엮어 만든 글. AI 없이 만들어진다 |
| AI 다듬기 | 규칙 기반 초안을 Anthropic Claude 모델이 문장만 고쳐 쓰는 일. 초안에 없는 사주 사실은 넣지 않게 지시한다 |
| 권한 키(entitlement) | 결제로 열린 것을 기록한 문자열. 예: `report:lifetime:<프로필 ID>`. 자세한 모양은 [ARCHITECTURE.md §3.5](./ARCHITECTURE.md) |
| 질문권 | AI 상담·AI 꿈풀이에 1회씩 쓰는 이용권. 유상(돈 주고 산 것)과 무상(보상·운영 지급)을 나눠 기록하고, 쓸 때는 무상분부터 차감한다 |
| 잠금(locked) | 유료 섹션을 첫 문단 일부만 남기고 가린 상태. 본문은 첫 문단만, 80자가 넘으면 80자에서 자른다(`apps/api/src/modules/interpretation/reading.ts:111`) |

### 0.2 운영 설정 상태 (2026-11-25)

운영 Worker `dalbit-saju` 하나가 웹 정적 파일과 `/api/v1/*` 를 https://daldalsaju.com 에서 낸다(`apps/api/wrangler.jsonc`). 기능이 켜지는 조건은 `apps/api/src/config/env.ts:188` 의 `features` 와 `apps/api/src/modules/config/routes.ts:8` 의 `GET /config` 응답이다.

| 항목 | 상태 | 켜지는 조건 |
|---|---|---|
| AI(Anthropic) | 켜짐. 상담·꿈풀이·리포트 다듬기·택일 상세는 `ANTHROPIC_MODEL`(기본 `claude-haiku-5-5`), 유료 타로 이야기만 `ANTHROPIC_MODEL_PREMIUM`(기본 `claude-sonnet-5-5`) | `ANTHROPIC_API_KEY` |
| 웹 결제(그로블) | 켜짐(`PAYMENT_PROVIDER=groble`, `wrangler.jsonc` vars) | `GROBLE_WEBHOOK_SECRET` + `GROBLE_PRODUCT_LINKS` |
| 앱 인앱결제 | 코드 있음, 앱 출시 전 | Apple·Google 키 4종/2종 |
| 카카오·네이버·구글·Apple 로그인 | 꺼짐(키 없음) | 제공자별 키 |
| 비밀번호 재설정 메일(Resend) | 꺼짐(키 없음) | `RESEND_API_KEY` + `MAIL_FROM` |
| 문의 이메일 | 비어 있음 | `SUPPORT_EMAIL` |
| 광고 | 꺼짐 | 서버 `ADS_ENABLED=true` + `ADS_PROVIDER` + 웹 빌드 `VITE_ADSENSE_*`/`VITE_ADFIT_*` |
| 푸시 | 꺼짐(FCM 키 없음) | `FCM_PROJECT_ID`·`FCM_CLIENT_EMAIL`·`FCM_PRIVATE_KEY` + `DAILY_PUSH_ENABLED=true`(설정됨) |
| GA4·메타 픽셀·카카오 픽셀·카카오톡 공유 | 꺼짐(웹 빌드에 `apps/web/.env` 없음) | `VITE_GA4_MEASUREMENT_ID`·`VITE_META_PIXEL_ID`·`VITE_KAKAO_PIXEL_ID`·`VITE_KAKAO_JS_KEY` |
| 가입 보너스 질문권 | 0 | `SIGNUP_BONUS_CREDITS`(기본 0, `env.ts:30`) |
| 보상형 광고 | 앱 전용 | 앱 AdMob + `ADMOB_REWARDED_AD_UNITS` |
| 토스 미니앱 | 보류(웹 출시 뒤) | Worker 의 `TOSS_MTLS` 바인딩. `wrangler.jsonc` 에 없음 |

상태 열에 쓰는 말은 네 가지다.

- **운영 중**: 운영 설정에서 켜져 있고 웹에서 쓸 수 있다.
- **키 없어 꺼짐**: 코드는 있지만 외부 서비스 키나 스위치가 없어 동작하지 않는다.
- **앱 전용**: Capacitor 앱(iOS·Android)에서만 동작한다. 앱은 아직 출시 전이다.
- **보류**: 일부러 미뤄 둔 기능이다.

### 0.3 모든 기능에 공통인 규칙

- **인증**: `Authorization: Bearer <accessToken>`. 라우트마다 `authenticate`(토큰 필수, 게스트 토큰도 통과)나 `optionalAuth`(있으면 사용) 중 하나를 붙인다(`apps/api/src/app.ts:75`). 탈퇴한 계정의 토큰은 401 이다.
- **요청 수 제한**: 운영(`NODE_ENV=production`)에서만 접속 IP 기준 60초 창으로 일반 API 120회, 로그인·가입 계열 10회, 관리자 API 20회다(`wrangler.jsonc` `ratelimits`, `apps/api/src/worker.ts`).
- **본문 크기**: 요청 본문은 1MB 까지 받는다(`apps/api/src/app.ts:107`).
- **오류 형식**: `{ error: { code, message, details } }`. 코드 목록은 [API.md](./API.md) 머리말.
- **세션 자동 생성**: 탭 화면에 들어오면 웹이 게스트 세션을 만든다(`apps/web/src/hooks/useSessionGate.tsx`, `apps/web/src/lib/session.ts:79`).

## 1. 기능 한눈에 보기

| 기능 | 주소 | 무료/유료 | 상태 |
|---|---|---|---|
| 사주 입력·확인 | `/`(웹 첫 화면 입력 폼), `/input`, `/confirm` | 무료 | 운영 중 |
| 사주 결과(비회원 입력) | `/result` | 일부 무료, 나머지 잠금 | 운영 중 |
| 내 사주(저장한 프로필) | `/saju`, `/saju/:profileId` | 일부 무료, 나머지 잠금 | 운영 중 |
| 사주 요약 | `/result/summary`, `/saju/:profileId/summary` | 무료 | 운영 중 |
| 프로필 추가·수정 | `/profiles/new`, `/profiles/:id/edit` | 무료 | 운영 중 |
| 사주 기초 | `/basics` | 무료 | 운영 중 |
| 오늘의 운세 | `/today` | 무료 | 운영 중 |
| 신년운세 화면 | `/yearly`, `/yearly/:profileId` | 총운·첫 두 달 무료, 나머지 5,900원 | 운영 중 |
| 첫 사주 미니 리포트 | 결과 화면의 잠금 섹션, `/store` | 990원(계정당 1회) | 운영 중 |
| 평생 사주분석서 | `/reports/:id` | 9,900원 | 운영 중 |
| 2027 신년운세 리포트 | `/reports/:id` | 5,900원(12/31까지, 뒤에는 7,900원) | 운영 중 |
| 궁합 | `/compatibility` | 점수·요약 무료, 상세 5,900원 | 운영 중 |
| 연애·결혼운 / 재물·직업운 리포트 | `/saju/:profileId` 카드, `/store` | 각 4,900원 | 운영 중 |
| 2027 신년 패키지 | `/store`, 결제 시트 | 16,900원 | 운영 중 |
| 리포트 보관함 | `/my/reports`, `/reports/:id` | 구매분 | 운영 중 |
| AI 상담 | `/ask` | 질문권 1회 | 운영 중 |
| AI 상담 질문권 팩 | `/store` | 3,900원(10회) / 9,900원(30회) | 운영 중 |
| 보상형 광고로 질문권 받기 | `/ask`, `/dream/ask` | 무료(하루 3회) | 앱 전용 |
| 꿈해몽 사전 | `/dream`, `/dream/:slug` | 무료 | 운영 중 |
| AI 꿈풀이 | `/dream/ask` | 질문권 1회 | 운영 중 |
| 띠별 운세 | `/zodiac`, `/zodiac/:animal/:period?` | 무료 | 운영 중 |
| 별자리 운세 | `/horoscope`, `/horoscope/:sign/:period?` | 무료 | 운영 중 |
| 토정비결 | `/tojeong` | 무료 | 운영 중 |
| 만세력 | `/manse` | 무료 | 운영 중 |
| 타로 오늘의 카드 | `/tarot`, `/tarot/daily` | 무료 | 운영 중 |
| 타로 예·아니오 | `/tarot/ask` → `/tarot/draw` → `/tarot/r/:id` | 무료(하루 1회) | 운영 중 |
| 타로 유료 펼침(질문 3장·속마음·재회·양자택일·궁합·켈틱) | 같음 | 990원 ~ 4,900원 | 운영 중 |
| 타로 기록 | `/tarot/history` | 무료 | 운영 중 |
| 택일 | `/taekil`, `/taekil/r/:id` | 등급·추천 3일 무료, 상세 990원 | 운영 중 |
| 이메일 가입·로그인 | `/signup`, `/login` | 무료 | 운영 중 |
| 소셜 로그인 4종 | `/login`, `/auth/callback/:provider` | 무료 | 키 없어 꺼짐 |
| 비밀번호 재설정 메일 | `/password/forgot`, `/password/reset` | 무료 | 키 없어 꺼짐(문의 안내로 대체) |
| 비밀번호 변경·회원 탈퇴 | `/my` | 무료 | 운영 중 |
| 웹 결제(그로블) | 결제 시트 → 그로블 결제창 → `/payments/success` | 유료 | 운영 중 |
| 앱 인앱결제 | 앱 결제 시트 | 유료 | 앱 전용 |
| 상점 | `/store` | | 운영 중 |
| 결제 내역 | `/my/payments` | | 운영 중 |
| 링크 공유 | 결과·오늘·궁합·토정비결·타로 | 무료 | 운영 중 |
| 카카오톡 공유 | 같은 곳 | 무료 | 키 없어 꺼짐 |
| 오늘의 운세 푸시(매일 08:00) | 앱 알림, `/my` 토글 | 무료 | 키 없어 꺼짐(앱 전용) |
| 웹 광고 | 결과 하단·오늘 인피드·콘텐츠 본문 | | 키 없어 꺼짐 |
| 분석(GA4·메타·카카오 픽셀) | 모든 화면 | | 키 없어 꺼짐 |
| SEO 사전 렌더링 | 빌드 산출물(`dist/<경로>/index.html`, `sitemap.xml`) | | 운영 중 |
| 약관·처리방침·면책 | `/legal/:doc` | | 운영 중 |
| 관리자 API | `/api/v1/admin/*` | | 운영 중(토큰 설정 여부는 확인 못 함) |
| 토스 미니앱 | 별도 빌드(`npm run build:toss -w @saju/web`) | | 보류 |

## 2. 사주 입력 · 결과 · 사주 요약

### 화면과 진입 경로

| 화면 | 주소 | 들어오는 곳 |
|---|---|---|
| 입력 | `/`(웹은 첫 화면에 입력 폼이 붙어 있다, 앱은 `/today` 로 바로 간다), `/input` | 첫 화면, 오늘 화면의 입력 바로가기, 확인·결과 화면의 '다시 입력' |
| 계산 확인 | `/confirm` | 입력 뒤. 보정 시각(경도·서머타임)과 이유를 보여 준다(`apps/web/src/pages/ConfirmPage.tsx`) |
| 결과(비회원) | `/result` | 확인 화면. 입력값은 브라우저 저장소(`STORAGE_KEYS.birthDraft`)에만 있다 |
| 내 사주 | `/saju`, `/saju/:profileId` | 하단 탭 '내 사주', 마이의 프로필 목록, 결과 화면의 저장 버튼 |
| 사주 요약 | `/result/summary`, `/saju/:profileId/summary` | 결과·내 사주 화면 본문의 '사주 요약' 카드(`apps/web/src/components/ReadingView.tsx:124`) |
| 프로필 추가·수정 | `/profiles/new`, `/profiles/:id/edit` | 내 사주·마이·오늘·궁합의 추가 버튼 |
| 사주 기초 | `/basics` | 첫 화면 '사주 기초부터 보기', 마이, 전체 운세(`/menu`), 용어 시트 |

### 무료·유료 경계 (결과·내 사주 화면)

풀이 섹션은 `buildBasicReading`(`apps/api/src/modules/interpretation/reading.ts:581`)이 만든다.

| 섹션 | 무료 | 미니 리포트(`report_saju_mini`) | 평생 사주분석서(`report_saju_lifetime`) |
|---|---|---|---|
| 한눈에 보는 나(성격·잘하는 것·조심할 것·필요한 것·행운 포인트) | 공개 | 공개 | 공개 |
| 총평·성격·오행·용신·신살 | 공개 | 공개 | 공개 |
| 재물·연애·직업 | 잠금 | 공개 | 공개 |
| 건강·십신·대운·올해(또는 다음 해) 운세 | 잠금 | 잠금 | 공개 |

- 잠긴 섹션도 제목과 한 줄 요약(`summary`)은 응답에 들어 있다. 본문은 첫 문단 일부만 온다.
- 사주표(8글자, 전문가 보기의 지장간·12운성·납음·신살)와 오행 분포는 무료다.
- 잠금 섹션을 누르면 결제 시트가 열린다. 재물·연애·직업 섹션이면 평생 사주분석서·미니 리포트·2027 신년 패키지, 그 밖의 섹션이면 평생 사주분석서·신년 패키지를 보여 준다(`ReadingView.tsx:59`).
- 사주 요약은 원국·분석(오행·강약·용신·십성·신살·합충·공망)·대운·분야별 한 줄 요약·한눈에 보는 나를 한 장에 모으고 '텍스트로 복사'를 준다(`apps/web/src/lib/sajuSummary.ts`). 분야별 한 줄은 섹션의 `summary` 를 그대로 쓰므로 잠긴 분야의 한 줄도 보인다. 풀이 화면과 같은 query key 를 써서 다시 계산하지 않는다.

### 동작 규칙

- **입력 검증**: 연도 1900~2100, 시·분은 비워도 된다(시간 모름), 성별 필수, 시간대·경도·보정 방식·야자시 규칙은 선택이다(`packages/shared/src/index.ts:49`). 음력·윤달의 실재 여부는 계산 엔진이 확인하고 틀리면 400 이다. 계산 규칙은 [SAJU_ENGINE.md §1~§3](./SAJU_ENGINE.md).
- **이름**: 1~20자. 비회원 결과는 `name` 으로 받아 풀이에서 부른다.
- **프로필**: 한 계정에 50개까지(`apps/api/src/modules/profiles/service.ts:10`). 관계가 '본인'이거나 첫 프로필이면 대표 프로필이 된다.
- **구매 뒤 수정 제한**: `report:` 로 시작하는 권한이 걸린 프로필은 출생 정보를 바꿀 수 없다(409, `profiles/service.ts:132`). 이름·관계 수정과 삭제는 막지 않는다.
- **비회원 결과에서 저장·결제**: 저장 버튼이나 결제를 누르면 게스트 세션을 만들고 입력값을 프로필로 저장한 뒤 `/saju/:id` 로 옮긴다(`apps/web/src/pages/ResultPage.tsx:35`).
- **AI**: 쓰지 않는다. 결과 화면은 규칙 기반만이다.
- **저장**: 비회원 결과는 서버에 저장하지 않는다. 프로필로 저장하면 서버에 남는다.

### API · 코드

| 엔드포인트 | 인증 | 코드 |
|---|---|---|
| `POST /saju/chart` | opt | `apps/api/src/modules/saju/routes.ts:46` |
| `POST /saju/reading` | opt | `saju/routes.ts:52` (권한 판정 `apps/api/src/modules/reports/service.ts:46`) |
| `POST /saju/years` | opt | `saju/routes.ts:61` |
| `GET·POST·PATCH·DELETE /profiles` | ✓ | `apps/api/src/modules/profiles/routes.ts`, `profiles/service.ts` |

화면: `apps/web/src/pages/BirthFormPage.tsx`, `ConfirmPage.tsx`, `ResultPage.tsx`, `MySajuPage.tsx`, `SummaryPage.tsx`, `BasicsPage.tsx`, 공통 본문 `apps/web/src/components/ReadingView.tsx`.

### 운영 상태

운영 중.

## 3. 오늘의 운세

### 화면과 진입 경로

`/today`(하단 탭 '오늘', 앱의 시작 화면, 첫 화면·전체 운세 메뉴). 대표 프로필(또는 마지막으로 고른 프로필)로 보여 주고, 프로필이 없고 비회원 입력값만 있으면 그 생년월일로 본다(`apps/web/src/pages/TodayPage.tsx:45`).

### 무료·유료 경계

전부 무료다. 등급·한 줄·영역별 점수(돈·연애·일·건강·공부)와 문장, 한눈에 보는 오늘, '오늘이 이런 이유', 사주 근거, 행운 색·숫자·방향·물건·시간, 공유 문구를 준다(`packages/shared/src/index.ts:256`). 이번 주 흐름은 화면이 같은 주 7일을 각각 불러 만든다(`TodayPage.tsx:53`).

### 동작 규칙

- 날짜는 KST 기준이며 `YYYY-MM-DD`, 1900~2100 의 실재하는 날짜만 받는다(`saju/routes.ts:34` `dateQuery`).
- 같은 사주·같은 날짜면 같은 문장이 나온다(날짜와 사주로 문안을 고른다).
- AI 를 쓰지 않는다. 저장하지 않는다.
- 화면 아래에 오늘 인피드 광고 자리(`home_infeed`)와 공유 버튼, 신년운세·입력 바로가기, 전체 운세 메뉴가 있다.

### API · 코드

| 엔드포인트 | 인증 | 코드 |
|---|---|---|
| `GET /fortune/daily?profileId&date` | ✓ | `apps/api/src/modules/fortune/routes.ts:16`. 프로필이 없으면 `{ needsProfile: true }` |
| `POST /fortune/daily` | - | `fortune/routes.ts:25`. 비회원 `{ birth, date?, name? }` |

생성기: `buildDailyFortune`(`apps/api/src/modules/interpretation/reading.ts:723`).

### 운영 상태

운영 중. 같은 내용을 매일 아침 보내는 푸시는 §16.

## 4. 유료 리포트 5종 · 첫 사주 미니 리포트 · 2027 신년 패키지

### 4.1 상품

상품 정의는 `apps/api/src/modules/commerce/catalog.ts` 하나뿐이고, 서버가 켜질 때 DB 로 덮어쓴다(`ensureCatalog`). 카탈로그에서 뺀 상품은 지우지 않고 판매 중지한다.

| 상품 ID | 이름 | 가격 | 함께 주는 질문권 | 권한 키 | 제한 | 코드 |
|---|---|---|---|---|---|---|
| `report_saju_mini` | 첫 사주 미니 리포트 | 990원(정가 2,900) | 없음 | `report:mini:<프로필>` | 계정당 1회 | `catalog.ts:36` |
| `report_saju_lifetime` | 평생 사주분석서 | 9,900원(정가 19,800) | 3회 | `report:lifetime:<프로필>` | | `catalog.ts:49` |
| `report_newyear_2027` | 2027 신년운세 | 5,900원, 2026-12-31 23:59:59 KST 뒤 7,900원 | 없음 | `report:yearly:<프로필>:2027` | | `catalog.ts:62` |
| `report_compat` | 사주 궁합 리포트 | 5,900원 | 없음 | `report:compatibility:<A>:<B>`(두 ID 정렬), 상대가 없으면 1회권 | | `catalog.ts:75` |
| `report_love` | 연애·결혼운 리포트 | 4,900원 | 없음 | `report:love:<프로필>` | | `catalog.ts:86` |
| `report_career_wealth` | 재물·직업운 리포트 | 4,900원 | 없음 | `report:career_wealth:<프로필>` | | `catalog.ts:96` |
| `bundle_newyear_2027` | 2027 신년 패키지 | 16,900원(정가 23,700) | 10회 | 평생 + 2027 신년운세 + 궁합 1회권(`ticket:compatibility:<주문>`) | | `catalog.ts:106` |

- "리포트 5종"은 보관함에 저장되는 `lifetime`·`yearly`·`compatibility`·`love`·`career_wealth` 다(`packages/shared/src/index.ts` `REPORT_TYPES`).
- 미니 리포트는 별도 문서가 아니라 결과·내 사주 화면의 재물·연애·직업 섹션을 여는 권한이다(§2 표). 보관함에 아무것도 만들지 않는다.
- 할인 마감(`saleEndsAt`)이 지나면 서버가 정가로 팔고 화면 가격도 바뀐다(`apps/api/src/modules/commerce/service.ts:71`).

### 4.2 화면과 진입 경로

| 리포트 | 사는 곳 | 여는 곳 |
|---|---|---|
| 미니 리포트 | 결과·내 사주의 재물·연애·직업 잠금 섹션, `/store` | 결과·내 사주 화면 그대로 |
| 평생 사주분석서 | 잠금 섹션 결제 시트, `/store` | 내 사주 화면의 '보고서 열기' 카드(`OpenReportCard`), `/my/reports` |
| 신년운세 | `/yearly/:profileId` 결제 시트(신년운세 + 패키지), `/store` | `/yearly/:profileId` 의 열기 버튼, `/my/reports` |
| 궁합 리포트 | `/compatibility` 결제 시트(궁합 리포트 + 패키지), `/store` | `/compatibility` 의 열기 버튼, `/my/reports` |
| 연애·결혼운·재물·직업운 | 내 사주 화면의 주제별 리포트 카드(`apps/web/src/components/TopicReportCards.tsx`), `/store`('주제별 리포트' 묶음) | 같은 카드, `/my/reports` |
| 신년 패키지 | 위 결제 시트들, `/store` | 각 리포트 자리 |

리포트 본문은 `/reports/:id`(`apps/web/src/pages/ReportsPage.tsx`)에서 읽는다. 다듬는 동안 진행률(덩어리 n/전체)을 2초마다 받아 보여 주고, 끝나면 최종본으로 바꾼다. 'PDF로 저장'은 웹은 브라우저 인쇄, 앱은 시스템 인쇄 화면이다(`ReportsPage.tsx:86`).

### 4.3 신년운세 화면(`/yearly/:profileId`)의 무료 범위

- 대상 연도는 KST 10월부터 다음 해다(`reading.ts:63`, 웹 `apps/web/src/lib/format.ts:6`). 기준일에는 2027 이다.
- 무료: 총운 섹션, 재물·애정·직장·건강 섹션의 첫 문단, 열두 달 중 첫 두 달(`reading.ts:848`).
- 잠금 해제 조건: `report:yearly:<프로필>:<연도>` 권한(`reports/service.ts:51`).
- `/yearly` 는 대표 프로필로 넘기고, 프로필이 없으면 프로필 추가 화면으로 보낸다(`apps/web/src/pages/YearlyPage.tsx:21`).

### 4.4 동작 규칙 (`apps/api/src/modules/reports/service.ts`)

- **권한 확인**: 없으면 402 + `details.productId`(`reports/service.ts:151`). 궁합은 이미 열린 조합이면 차감 없이 열고, 아니면 궁합 1회권을 먼저 쓴다(`reports/service.ts:182`, `commerce/service.ts:685`). 같은 사람끼리는 400.
- **결제 직후 미리 만들기**: 결제가 확정되면 산 리포트를 바로 만든다(`prewarm`, `reports/service.ts:265`). 미니 리포트와 궁합 1회권은 대상이 정해지지 않아 건너뛴다. 실패해도 결제는 그대로이고 처음 열 때 다시 만든다.
- **규칙 기반 즉시 저장**: 규칙 기반 본문을 먼저 저장하고 바로 돌려준다(`reports/service.ts:228`). 생성기는 사주분석서·신년운세·궁합이 `apps/api/src/modules/interpretation/report.ts`, 주제별이 `loveReport.ts`·`careerWealthReport.ts`(공통 도구 `topicReportKit.ts`)다.
- **AI 다듬기**: AI 가 켜져 있으면 `status: 'polishing'` 으로 저장하고 Cloudflare Queue(`dalbit-saju-jobs`)에 작업을 넣는다. Worker 의 `queue` 처리기가 다듬는다(`apps/api/src/worker.ts:69`). 초안을 약 3,500자 덩어리로 나눠 리포트당 10개, 서버(AI 서비스 하나) 전체 16개까지 동시에 보낸다(`apps/api/src/modules/ai/service.ts:108`). 모델은 `ANTHROPIC_MODEL`(Haiku).
- **AI 실패**: 덩어리 하나가 실패하면 그 덩어리는 초안을 유지한다. 전부 실패하거나 작업 자체가 실패하면 규칙 기반 본문으로 마무리한다(`reports/service.ts:105`). 담당 기한(5분) 안에 진행 소식이 없으면 다음 열람 때 처음부터 다시 다듬고, 그사이 AI 키를 뺐으면 규칙 기반으로 끝낸다(`reports/service.ts:144`).
- **재사용**: 같은 사용자·프로필·종류·연도·상대의 리포트는 하나만 저장하고(DB 유니크 인덱스 `reports_target_uq`), 다시 열면 저장본을 준다.
- **환불 뒤**: 권한이 사라지면 목록에서 빠지고 열람은 402 다(`reports/service.ts:58`).
- **1회 구매 제한**: 미니 리포트만 계정당 1회다(주문 생성·결제 확정 두 번 확인, §14).

### 4.5 API · 코드

| 엔드포인트 | 인증 | 코드 |
|---|---|---|
| `GET /fortune/yearly?profileId&year` | ✓ | `fortune/routes.ts:31` |
| `POST /reports` | ✓ | `apps/api/src/modules/reports/routes.ts:18` |
| `GET /reports`, `GET /reports/:id` | ✓ | `reports/routes.ts:12`, `:23` |
| `GET /reports/:id/progress` | ✓ | `reports/routes.ts:29` |

요청·응답 형식: [API.md 「유료 리포트 · AI 상담」](./API.md). 문체 기준: [PLAIN_KOREAN.md](./PLAIN_KOREAN.md). AI 비용: [COSTS.md §2](./COSTS.md).

### 4.6 운영 상태

운영 중(그로블 결제·AI 다듬기 켜짐). 어느 상품에 그로블 결제창이 연결돼 있는지는 시크릿(`GROBLE_PRODUCT_LINKS`)이라 확인 못 함(§14).

## 5. 궁합

### 화면과 진입 경로

`/compatibility`(하단 탭 '궁합', 전체 운세 메뉴, 결과 화면 링크). 저장한 프로필 두 명을 고른다. 프로필이 없으면 추가 화면으로 보낸다. 쿼리 `?a=&b=` 로 두 사람을 지정할 수 있다.

### 무료·유료 경계

| 범위 | 무료 | 궁합 리포트 구매 뒤 |
|---|---|---|
| 점수·등급·한 줄 | 공개 | 공개 |
| 한눈에 보는 궁합 | 공개 | 공개 |
| 서로 끌리는 이유·함께 조심할 점·더 좋은 관계를 위한 조언 | 첫 문단 일부 | 공개 |
| 근거(factors) | 긍정 요인 2개까지(`apps/api/src/modules/compatibility/routes.ts:33`) | 전부 |
| 궁합 리포트 본문(`/reports/:id`) | 없음 | 공개 |

상품은 `report_compat` 5,900원 또는 `bundle_newyear_2027` 의 궁합 1회권이다. 결제 시트는 이 두 상품을 보여 준다(`apps/web/src/pages/CompatibilityPage.tsx:199`).

### 동작 규칙

- API 는 프로필 ID 나 생년월일을 받지만 웹 화면은 저장한 프로필만 쓴다.
- 궁합 화면에서 사면 두 사람 조합에 권한이 걸린다. 상점에서 사면 상대가 정해지지 않아 1회권으로 지급되고, 처음 여는 궁합 리포트에 쓰인다(`commerce/service.ts:198`).
- AI: 무료 화면은 쓰지 않는다. 궁합 리포트 본문은 §4 의 AI 다듬기를 따른다.
- 계산: `@saju/core` `calculateCompatibility`, 문장: `buildCompatibilitySections`(`reading.ts:882`).

### API · 코드

| 엔드포인트 | 인증 | 코드 |
|---|---|---|
| `POST /compatibility` | opt | `compatibility/routes.ts:15` |
| `POST /reports { type: 'compatibility', profileId, partnerProfileId }` | ✓ | §4 |

### 운영 상태

운영 중.

## 6. AI 상담 · 질문권

### 화면과 진입 경로

`/ask`(하단 탭 '물어보기'). 위쪽 전환(`AskSegment`)으로 타로(`/tarot`)와 오간다. 저장한 프로필이 있어야 쓸 수 있고, 프로필마다 대화가 따로 쌓인다.

### 무료·유료 경계

- AI 가 켜져 있으면 질문 1개에 질문권 1회(`AI_CHAT_CREDIT_COST`, 기본 1)를 쓴다.
- 질문권은 상품으로 산다: `chat_pack_10` 3,900원(10회), `chat_pack_30` 9,900원(30회), 그리고 평생 사주분석서(3회)·신년 패키지(10회)·유료 타로(1회 또는 3회)에 딸려 온다.
- 질문권이 모자라면 402 `INSUFFICIENT_CREDITS` 이고 화면은 질문권 결제 시트를 연다(`apps/web/src/pages/AskPage.tsx:48`).
- 앱에서는 질문권이 0일 때 보상형 광고 카드(하루 3회, 1회당 1질문권)가 보인다(§17).
- 기준일 설정에서는 가입 보너스가 0이라 게스트·새 회원 모두 질문권 0으로 시작한다.

### 동작 규칙 (`apps/api/src/modules/chat/service.ts`)

- **입력**: 질문 1~500자(`packages/shared/src/index.ts:380`).
- **차감 순서**: AI 를 부르기 전에 질문권을 먼저 차감하고(`chat/service.ts:94`), 무상분부터 쓴다(`commerce/service.ts:707`).
- **AI 호출**: 시스템 지시문 + 사주 요약(원국·십신·오행·강약·용신·신살·현재 대운) + 직전 대화 12개를 보낸다(`apps/api/src/modules/ai/service.ts:373`). 모델은 `ANTHROPIC_MODEL`(Haiku), 60초 제한.
- **AI 실패·거절**: 차감한 질문권을 무상으로 돌려주고(`chat/service.ts:109`) 규칙 기반 답변을 준다.
- **AI 꺼짐**: 질문권을 쓰지 않고 규칙 기반 답변을 준다. 규칙 기반 답변은 질문의 낱말(돈·연애·직장·건강·대운·성격)로 풀이 섹션을 골라 쓰되, 사용자가 열람 권한이 없는 섹션은 쓰지 않는다(`chat/service.ts:64`).
- **저장**: 질문과 답을 `chat_messages` 에 저장하고, 화면에서 기록을 지울 수 있다.

### API · 코드

| 엔드포인트 | 인증 | 코드 |
|---|---|---|
| `GET /chat?profileId` | ✓ | `apps/api/src/modules/chat/routes.ts:12` |
| `POST /chat` | ✓ | `chat/routes.ts:17` |
| `DELETE /chat?profileId` | ✓ | `chat/routes.ts:22` |
| `GET /wallet` | ✓ | `apps/api/src/modules/commerce/routes.ts:25` |

### 운영 상태

운영 중(AI 켜짐).

## 7. 꿈해몽

### 화면과 진입 경로

| 화면 | 주소 | 들어오는 곳 |
|---|---|---|
| 사전 첫 화면·분류 | `/dream`, `/dream?c=<분류>` | 전체 운세 메뉴, 마이, 데스크톱 메뉴 |
| 키워드 풀이 | `/dream/:slug` | 사전 검색·목록. 별칭 주소는 대표 키워드로 옮긴다 |
| AI 꿈풀이 | `/dream/ask` | 사전 화면 |

### 무료·유료 경계

- 사전은 전부 무료다. 337개 항목·11개 분류(`packages/shared/src/dream/entries/*.ts`, `types.ts:16`)이고 길몽·흉몽·중립과 상황별 풀이가 있다. 사전은 API 가 아니라 웹이 `@saju/shared/dream` 을 직접 번들한다.
- AI 꿈풀이는 AI 가 켜져 있으면 질문권 1회(상담과 같은 단가)다. 질문권이 모자라면 402 이고 화면은 결제 시트를 연다.

### 동작 규칙 (`apps/api/src/modules/dream/service.ts`)

- **입력**: 꿈 이야기 5~500자(`packages/shared/src/dream/index.ts:89`). 사주를 함께 볼 프로필을 고르거나(`profileId`), 대표 프로필을 쓰거나, '사주 없이 보기'(`withoutSaju`)를 고른다. 남의 프로필은 400.
- **상징 찾기**: 꿈 이야기에서 사전 상징을 최대 6개 찾는다(규칙 기반).
- **AI**: 상징과 (있으면) 사주 요약을 함께 보내 `ANTHROPIC_MODEL`(Haiku)이 풀이한다(`ai/service.ts:425`). 차감은 AI 호출 전(`dream/service.ts:118`).
- **AI 실패**: 질문권을 무상으로 돌려주고(`dream/service.ts:132`) 사전 문장을 엮은 기본 풀이를 준다.
- **AI 꺼짐**: 차감 없이 기본 풀이를 준다.
- **위기 문구**: 자해·자살을 암시하는 말이 있으면 응답에 `crisis: true` 를 넣고, 기본 풀이 맨 앞에 자살예방상담전화 109 안내를 붙인다(`dream/service.ts:33`).
- **저장**: 꿈 이야기는 저장하지 않는다.
- 사전 화면 본문 중간에 콘텐츠 광고 자리(`web_content_mid`)가 있다.

### API · 코드

| 엔드포인트 | 인증 | 코드 |
|---|---|---|
| `POST /dream/interpret` | ✓ | `apps/api/src/modules/dream/routes.ts:17` |

화면: `apps/web/src/pages/DreamPages.tsx`. 사전 데이터·검색: `packages/shared/src/dream/`.

### 운영 상태

운영 중.

## 8. 띠별 운세 · 별자리 운세

### 화면과 진입 경로

`/zodiac`, `/zodiac/:animal/:period?`, `/horoscope`, `/horoscope/:sign/:period?`. 전체 운세 메뉴('띠·별자리'), 마이, 검색 유입(§18). 하단 탭이 함께 보인다. 저장한 프로필이 있으면 내 띠·별자리를 먼저 고른다.

### 무료·유료 경계

전부 무료다. 로그인도 필요 없다.

### 동작 규칙

- `period`: `today`(기본)·`tomorrow`·`week`·`month`·`year`. `date`: KST `YYYY-MM-DD`(1900~2100). 잘못된 값은 400, 없는 띠·별자리는 404.
- 개인 정보를 받지 않고 같은 입력이면 같은 응답이라 `Cache-Control: public, max-age=600` 을 붙인다(`apps/api/src/modules/zodiac/routes.ts:25`).
- AI 를 쓰지 않는다. 저장하지 않는다.
- 계산 방법: [SAJU_ENGINE.md §7](./SAJU_ENGINE.md). 응답 필드: [API.md 「띠별 · 별자리 운세」](./API.md).
- 광고 자리: 띠별은 콘텐츠 본문(`web_content_mid`), 별자리는 콘텐츠 본문과 결과 하단(`result_bottom`)이다.

### API · 코드

| 엔드포인트 | 인증 | 코드 |
|---|---|---|
| `GET /zodiac`, `GET /zodiac/:animal` | - | `zodiac/routes.ts:37`, `:42` (생성기 `zodiacFortune.ts`) |
| `GET /horoscope`, `GET /horoscope/:sign` | - | `zodiac/routes.ts:50`, `:55` (생성기 `horoscope.ts`) |

화면: `apps/web/src/pages/ZodiacPage.tsx`, `HoroscopePage.tsx`.

### 운영 상태

운영 중.

## 9. 토정비결

### 화면과 진입 경로

`/tojeong`(전체 운세 메뉴, 첫 화면, 데스크톱 메뉴). `?year=` 로 대상 연도를 바꿀 수 있고 기본은 2027 이다(`packages/shared/src/tojeong.ts:7`). 대표 프로필 → 이 화면에서 전에 넣은 생년월일 → 비회원 입력값 순서로 자동으로 고르고, 없으면 입력 폼을 보여 준다(`apps/web/src/pages/TojeongPage.tsx:65`).

### 무료·유료 경계

전부 무료다. 결과 아래에 신년운세 바로가기(프로필이 있으면 `/yearly/:id`, 없으면 `/input`), 결과 하단 광고 자리, 공유가 있다.

### 동작 규칙

- **입력**: 비회원은 양력·음력 생년월일(1900~2050, 시각·성별 불필요), 세션이 있으면 저장한 프로필 ID. 대상 연도 1900~2049. 없는 음력 날짜·윤달, 태어난 해보다 앞선 대상 연도는 400 이다.
- **계산**: 144괘 작괘. 규칙은 [SAJU_ENGINE.md §6](./SAJU_ENGINE.md).
- **문장**: 괘마다 직접 쓴 원고(`apps/api/src/modules/tojeong/content/gwae1.ts` ~ `gwae8.ts`). AI 를 쓰지 않는다.
- **저장**: 서버는 저장하지 않는다. 웹은 마지막에 넣은 생년월일을 브라우저에 기억하고, 서버가 400 을 주면 지운다.

### API · 코드

| 엔드포인트 | 인증 | 코드 |
|---|---|---|
| `POST /tojeong` | opt | `apps/api/src/modules/tojeong/routes.ts:17`, `tojeong/reading.ts:72` |

### 운영 상태

운영 중.

## 10. 만세력 · 사주 기초

### 화면과 진입 경로

- `/manse`: 전체 운세 메뉴, 마이, 데스크톱 메뉴. 날짜를 고르면 양력·음력, 연주·월주·일주(한자와 한글 독음), 입춘 전이면 "아직 지난해 간지" 안내, 그해 24절기 시각(KST)을 보여 준다. 고른 날이 오늘 뒤면 그 날짜로 택일 바로가기 카드를 붙인다(`apps/web/src/pages/MiscPages.tsx:47`).
- `/basics`: 사주 기초(천간·지지·일간·오행·십성·용신·대운) 설명 화면(`apps/web/src/pages/BasicsPage.tsx`).

### 무료·유료 경계

전부 무료다. 로그인도 필요 없다.

### 동작 규칙

- 날짜 범위는 1900-01-01 ~ 2100-12-31, 없으면 오늘(KST)이다(`saju/routes.ts:75`).
- AI 를 쓰지 않는다. 저장하지 않는다.

### API · 코드

| 엔드포인트 | 인증 | 코드 |
|---|---|---|
| `GET /saju/manse?date=YYYY-MM-DD` | - | `saju/routes.ts:75` |

### 운영 상태

운영 중.

## 11. 타로

### 화면과 진입 경로

| 화면 | 주소 | 들어오는 곳 |
|---|---|---|
| 타로 홈 | `/tarot` | 데스크톱 메뉴, 물어보기 탭 위 전환, 전체 운세 메뉴 |
| 오늘의 카드 | `/tarot/daily` | 타로 홈 |
| 질문 고르기 | `/tarot/ask` | 타로 홈의 주제·펼침 타일 |
| 카드 뽑기 | `/tarot/draw` | 질문 화면 |
| 결과 | `/tarot/r/:id` | 뽑기 뒤, 기록 |
| 기록 | `/tarot/history` | 타로 홈 |

카드 그림은 1909년 웨이트-스미스 덱 원판 스캔이다([TAROT_ART.md](./TAROT_ART.md)).

### 무료·유료 경계

펼침 방식 정의는 `packages/shared/src/index.ts:546` `TAROT_SPREADS` 다.

| 펼침 | 주제 | 장수 | 무료 범위 | 상품(가격, 질문권) |
|---|---|---|---|---|
| 오늘의 카드 `daily` | | 1 | 전부 | 없음 |
| 예·아니오 `yesno` | 예·아니오 | 1 | 전부, KST 하루 1회 | 없음 |
| 질문 리딩 `three` | 연애·일/진로·돈·관계·나 | 3 | 카드, 카드별 전통 뜻, 총평 첫 문단 | `tarot_question_3`(990원, 1회) |
| 연애 속마음 `feelings5` | 속마음 | 5 | 위 + 첫 자리 풀이 | `tarot_love_5`(2,900원, 1회) |
| 재회 `reunion5` | 재회 | 5 | 위 + 첫 자리 풀이 | `tarot_love_5`(2,900원, 1회) |
| 양자택일 `choice` | 양자택일 | 3 | 위 + '지금의 나' 자리 | `tarot_choice_3`(990원, 1회) |
| 궁합 타로 `compat` | 궁합 | 5 | 위 + '나의 마음' 자리 | `tarot_compat_5`(2,900원, 1회) |
| 켈틱 크로스 `celtic` | 켈틱 크로스 | 10 | 카드, 카드별 뜻, 총평 첫 문단 | `tarot_celtic_10`(4,900원, 3회) |

유료 펼침의 잠금 부분은 남은 자리 풀이, 카드끼리 이어지는 이야기, 지금 해 볼 수 있는 행동, 사주로 본 근거다(`apps/api/src/modules/tarot/reading.ts:573`). 상품은 리딩 하나를 연다(`tarot:reading:<리딩 ID>`).

### 동작 규칙 (`apps/api/src/modules/tarot/service.ts`)

- **카드 섞기**: 서버가 서명한 덱 토큰(30분 유효)을 주고 카드 순서는 보내지 않는다. 사용자가 고른 자리로 서버가 카드를 꺼낸다(`tarot/deck.ts`). 역방향 비율은 35%다.
- **입력 검증**: 질문 80자까지, 양자택일 선택지 각 1~20자이고 서로 달라야 한다, 궁합 타로는 내 프로필과 다른 상대 프로필이 필요하다. 주제와 펼침이 맞지 않으면 400, 장수가 다르거나 같은 카드를 두 번 고르면 400, 만료된 토큰은 400, 이미 쓴 토큰은 409.
- **같은 질문 다시 뽑기 금지**: 같은 날(KST) 같은 펼침·주제·질문(띄어쓰기·끝 문장부호·대소문자 무시, 양자택일은 선택지, 궁합은 상대까지)이면 새로 뽑지 않고 기존 리딩으로 안내한다(셔플 응답 `existingReadingId`, 뽑기 409 `details.readingId`, `tarot/service.ts:44`).
- **예·아니오 횟수**: 새 질문이 하루 1회(`TAROT_YESNO_DAILY_FREE`)를 넘으면 429 `RATE_LIMITED`(`tarot/service.ts:104`). 기울기 표는 [API.md 「예·아니오 기울기 표」](./API.md).
- **오늘의 카드**: 같은 사람·같은 날은 같은 카드다(`tarot/service.ts:250`).
- **사주 결합**: 지정 프로필(없으면 대표 프로필)의 일간·용신으로 근거 문장을 만든다. 궁합 타로는 두 사람의 사주를 읽는다.
- **AI**: 유료 펼침을 연 뒤 처음 볼 때 '카드끼리 이어지는 이야기'를 `ANTHROPIC_MODEL_PREMIUM`(Sonnet)으로 한 번 만들고 저장한다(`tarot/service.ts:116`, `ai/service.ts:406`). 무료 펼침(오늘의 카드·예·아니오)은 AI 를 쓰지 않는다.
- **AI 실패**: 규칙 기반 이야기를 그대로 보여 준다.
- **저장**: 리딩은 `tarot_readings` 에 저장하고, 기록 화면에서 최근 100개를 보거나 지울 수 있다.
- **결제**: `POST /orders { productId, readingId }`. 리딩의 펼침과 상품이 맞아야 하고 내 리딩이어야 한다(`tarot/service.ts:268`).

### API · 코드

| 엔드포인트 | 인증 | 코드 |
|---|---|---|
| `GET /tarot/daily` | ✓ | `apps/api/src/modules/tarot/routes.ts:13` |
| `POST /tarot/shuffle` | ✓ | `tarot/routes.ts:19` |
| `POST /tarot/readings` | ✓ | `tarot/routes.ts:22` |
| `GET /tarot/readings`, `GET /tarot/readings/:id` | ✓ | `tarot/routes.ts:24`, `:26` |
| `DELETE /tarot/readings/:id` | ✓ | `tarot/routes.ts:31` |

요청·응답 상세: [API.md 「타로」](./API.md).

### 운영 상태

운영 중.

## 12. 택일 (좋은 날 고르기)

### 화면과 진입 경로

`/taekil`(전체 운세 메뉴 '좋은 날 고르기', 마이, 상점의 택일 상품, 만세력의 택일 카드), 결과 `/taekil/r/:id`. 저장한 프로필이 있어야 한다.

### 무료·유료 경계

| 범위 | 무료 | 상세(`report_taekil`, 990원) |
|---|---|---|
| 날짜마다 등급(아주 좋은 날 ~ 피할 날)·순위 | 공개 | 공개 |
| 추천 3일, 한 줄, 계산 기준 | 공개 | 공개 |
| 날짜별 점수·건제12신·황도·이유·빠진 까닭·좋은 시간 | 비움(`null`) | 공개 |
| 종합 분석·목적 맞춤 조언·날짜를 바꿀 수 없을 때·빠진 날짜 | 잠금(종합 분석만 첫 문단) | 공개 |

상품은 택일 결과 하나를 연다(`taekil:reading:<결과 ID>`). 상점에서 누르면 `/taekil` 로 보낸다(`apps/web/src/pages/StorePage.tsx:50`).

### 동작 규칙 (`apps/api/src/modules/taekil/service.ts`)

- **목적**: 이사·계약·면접/시험·결혼·개업·여행/출발. 결혼만 상대 프로필을 고를 수 있다(자기 자신은 400).
- **날짜**: 기간(최대 92일) 또는 후보 2~10개 중 하나. 오늘(KST)부터 2년(730일) 안만 받는다(`taekil/service.ts:170`, `packages/shared/src/index.ts:884`).
- **같은 입력 재사용**: 목적·프로필·상대·방식·날짜가 같으면 저장본을 돌려준다(이미 산 결과를 다시 사지 않게, `taekil/service.ts:174`).
- **저장**: `reports` 테이블에 `type='taekil'` 로 계산 당시 원국과 결과를 함께 저장한다. 프로필을 고치거나 지워도 산 결과의 문장은 그대로다. `/reports` 목록에는 나오지 않고, 보관함 화면은 상세가 열린 택일만 따로 불러 보여 준다(`ReportsPage.tsx:32`).
- **AI**: 상세가 열린 뒤 처음 볼 때 종합 분석·조언·'날짜를 바꿀 수 없을 때'만 `ANTHROPIC_MODEL`(Haiku)로 한 번 다듬어 저장한다(`taekil/service.ts:58`). 리포트와 달리 Queue 를 쓰지 않고 그 조회 요청 안에서 끝날 때까지 기다린다. 날짜별 근거는 규칙 계산 그대로다.
- **AI 실패**: 규칙 기반 문장을 보여 준다.
- 계산 규칙: [SAJU_ENGINE.md §8](./SAJU_ENGINE.md).

### API · 코드

| 엔드포인트 | 인증 | 코드 |
|---|---|---|
| `POST /taekil` | ✓ | `apps/api/src/modules/taekil/routes.ts:13` (201) |
| `GET /taekil` | ✓ | `taekil/routes.ts:18` |
| `GET /taekil/:id` | ✓ | `taekil/routes.ts:20` |

### 운영 상태

운영 중.

## 13. 계정 · 게스트 · 탈퇴

### 화면과 진입 경로

`/login`, `/signup`(첫 화면 오른쪽 위, 마이, 결제 시도), `/password/forgot`, `/password/reset`(메일 링크), `/auth/callback/:provider`(소셜 로그인 복귀), `/my`(비밀번호 변경·로그아웃·탈퇴·글자 크기·화면 테마).

### 동작 규칙

- **게스트 시작**: `deviceId`(8~128자)를 보내면 같은 기기는 같은 게스트를 돌려준다. 닉네임은 '별빛1234' 같은 임의 값이다(`apps/api/src/modules/users/service.ts:61`).
- **이메일 가입**: 이메일 120자까지, 비밀번호 8~72자, 닉네임 1~20자. 이미 있는 이메일은 409(`users/service.ts:72`). 게스트 토큰을 함께 보내면 그 게스트 계정을 회원으로 바꿔 데이터가 그대로 남는다.
- **이미 있는 계정으로 로그인**: 게스트로 만든 프로필·리포트(택일 포함)·상담 기록을 그 계정으로 옮기고 게스트는 지운다(`mergeGuestInto`, `users/service.ts:128`). 옮기는 대상은 이 세 가지뿐이다(§22).
- **토큰**: access token 1시간, refresh token 30일. refresh 는 쓸 때마다 바꾸고, 이미 쓴 refresh 가 다시 오면 그 사용자의 모든 세션을 끊는다.
- **소셜 로그인**: 카카오·네이버·구글·Apple. 서버가 켜진 제공자만 `/config` 의 `socialLogin` 에 `true` 로 내려가고, 로그인 화면은 켜진 버튼만 그린다(`apps/web/src/pages/AuthPages.tsx:34`). 같은 이메일의 다른 계정이 있으면 이메일을 비워 둔 새 계정을 만든다. 설정 방법: [AUTH_PUSH.md](./AUTH_PUSH.md).
- **비밀번호 재설정**: 메일이 켜져 있으면 가입 여부와 관계없이 200 을 주고 30분짜리 일회용 링크를 보낸다. 메일이 꺼져 있으면 서버는 501 이고, 웹은 요청 폼 대신 문의 안내를 보여 준다(`apps/web/src/pages/PasswordPages.tsx:43`). 재설정에 성공하면 그 사용자의 refresh token 을 모두 폐기한다.
- **비밀번호 변경**: 이메일 계정만, 현재 비밀번호 확인 뒤 바꾸고 현재 세션은 유지한다.
- **회원 탈퇴**: 프로필·리포트(택일 포함)·상담·refresh token·푸시 토큰을 지우고, 사용자 행은 이메일·비밀번호·소셜 ID·기기 ID 를 비운 채 '탈퇴한 사용자'로 남긴다. 주문·결제 기록은 보존 의무 때문에 남긴다(`users/service.ts:149`). Apple 로그인 회원이면 Apple 토큰 철회를 먼저 요청한다(`apps/api/src/modules/auth/routes.ts:135`).
- **AI**: 쓰지 않는다.

### API · 코드

[API.md 「인증 · 회원」](./API.md)의 표 그대로다. 코드: `apps/api/src/modules/auth/routes.ts`, `auth/service.ts`(재설정 30분 `:16`, 메일 꺼짐 501 `:95`), `auth/oauth.ts`, `users/service.ts`, `mail/service.ts`.

### 운영 상태

| 기능 | 상태 |
|---|---|
| 게스트·이메일 가입·로그인·비밀번호 변경·탈퇴 | 운영 중 |
| 소셜 로그인 4종 | 키 없어 꺼짐 |
| 비밀번호 재설정 메일 | 키 없어 꺼짐(문의 안내로 대체, 문의 이메일도 비어 있음) |

## 14. 결제 · 상점 · 보관함 · 결제 내역 · 환불

### 화면과 진입 경로

| 화면 | 주소 | 들어오는 곳 |
|---|---|---|
| 결제 시트 | 각 화면의 잠금 섹션·리포트 카드 | `apps/web/src/components/PaywallSheet.tsx` |
| 상점 | `/store` | 데스크톱 메뉴 '이용권', 마이, 결제 내역 |
| 결제 완료·실패 | `/payments/success`, `/payments/fail` | 결제창 복귀 |
| 리포트 보관함 | `/my/reports` | 마이, 내 사주 |
| 결제 내역 | `/my/payments` | 마이, 마이의 질문권 잔액 |

상점은 '사주 리포트'(미니·평생·신년운세·궁합·신년 패키지), '주제별 리포트', 'AI 상담 질문권' 세 묶음을 보여 준다. 타로·택일 상품은 결과 하나에 붙는 상품이라 상점에 나오지 않는다(`StorePage.tsx:16`). 프로필이 필요한 상품은 누구의 리포트인지 먼저 고른다.

### 결제 흐름

| 경로 | 쓰는 곳 | 확정 방법 | 상태 |
|---|---|---|---|
| 그로블 결제창 | 웹 | 그로블이 보내는 서명 웹훅(`payment.completed`)만으로 확정 | 운영 중 |
| App Store / Google Play 인앱결제 | 앱 | 앱이 받은 영수증을 서버가 검증(`/payments/iap/verify`) | 앱 전용(출시 전) |
| 토스페이먼츠·포트원 V2 | 웹(대안) | 결제창 복귀 뒤 서버 승인(`/payments/confirm`) | 코드만 남김(`PAYMENT_PROVIDER` 로 전환) |
| 목업 | 개발 | 결제창 없이 성공 처리 | 운영에서는 서버가 켜지지 않는다(`env.ts:179`) |
| 토스 미니앱 인앱결제 | 토스 미니앱 | 토스 서버 조회 | 보류(§21) |

그로블 흐름(`apps/web/src/lib/payments/index.ts:84`, `apps/api/src/modules/commerce/providers/groble.ts`):

1. 화면이 `POST /orders` 로 주문을 만든다. 서버는 상품에 연결된 그로블 결제창 링크에 `?ref=saju-<주문 ID>` 를 붙여 돌려준다(`groble.ts:132`). 연결된 결제창이 없는 상품은 주문 전에 501 `NOT_CONFIGURED` 다(`commerce/service.ts:398`).
2. 브라우저가 같은 탭에서 그로블 결제창으로 이동한다. 주문 ID·돌아갈 경로는 브라우저 저장소에 기억한다.
3. 결제 뒤 `/payments/success?provider=groble` 로 돌아오면 화면이 2초마다 최대 90초 동안 주문 상태를 조회한다(`apps/web/src/pages/PaymentResultPages.tsx:14`).
4. 그로블 웹훅이 오면 서버가 서명(HMAC-SHA256, ±5분)을 확인하고, ref 의 주문과 금액·결제창이 모두 맞을 때만 지급한다(`commerce/service.ts:569`). 맞지 않으면 주문을 `failed` 로 두고 지급하지 않는다. 다른 접두어(`GROBLE_REF_PREFIX`)의 웹훅은 다른 서비스의 결제로 보고 건너뛴다.

자세한 절차와 설정: [PAYMENTS.md §1.0, §3.5](./PAYMENTS.md).

### 동작 규칙 (`apps/api/src/modules/commerce/service.ts`)

- **로그인 필수**: 게스트는 주문 403(`reason: LOGIN_REQUIRED`, `:384`), 인앱결제 검증도 403(`:492`). 웹은 결제 전에 회원인지 보고 아니면 `/login?next=...&reason=purchase` 로 보낸다(`apps/web/src/hooks/usePurchase.ts:23`).
- **대상 확인**: 리포트 상품은 내 프로필이 필요하고, 타로·택일 상품은 내 결과 ID(`readingId`)가 필요하다.
- **1회 구매 제한**: `perUserLimit`(미니 리포트만 1)을 주문 생성 때 확인하고(`:387`), 결제 확정 묶음 실행 시점에 다시 확인한다(`:321`). 확정 때 넘으면 결제를 취소하고(그로블은 취소 API 가 없어 `failed` 와 결제 키를 남겨 운영자가 환불) 409 다.
- **지급**: 결제 확정·권한 지급·질문권 적립을 한 묶음으로 처리해 동시 요청에서도 정확히 1회만 지급한다. 웹훅·영수증은 이벤트 ID·거래 ID 로 중복을 막는다.
- **지급 뒤**: 산 리포트를 미리 만든다(§4.4).

### 보관함 · 결제 내역

- 보관함(`/my/reports`): 볼 권한이 남은 리포트와 상세가 열린 택일 결과를 최신순으로 보여 준다. 리포트를 연 화면에서 PDF 로 저장한다.
- 결제 내역(`/my/payments`): 주문 목록(상태: 결제 대기·완료·실패·취소·환불)과 질문권 원장(최근 100건)을 보여 준다(`GET /orders`, `GET /wallet`). 아래에 "열람한 리포트는 청약철회가 제한될 수 있고 환불 문의는 고객센터로" 안내가 있다.

### 환불

| 결제 경로 | 환불하는 곳 | 지급분 회수 |
|---|---|---|
| 그로블 | 그로블 판매자 화면(환불 API 없음). 관리자 API 는 400 으로 거절한다(`:647`) | `payment.refunded`(전액) 웹훅으로 자동 회수. 부분 환불은 기록만 하고 회수하지 않는다 |
| 토스·포트원 | 관리자 API `POST /admin/orders/:id/refund` | 즉시 회수 |
| 인앱결제 | Apple·Google 고객 요청 | 스토어 서버 알림으로 회수, 환불 철회 시 복구 |

- 회수 내용: 권한 삭제 + 남은 유상 질문권에서 그 주문분을 뺀다. 이미 쓴 만큼은 회수하지 못한다.
- 질문권 팩은 관리자 환불 때 남은 유상 질문권 비율만큼만 부분 취소한다(`:652`).
- 정책과 연동 지점: [PAYMENTS.md §7](./PAYMENTS.md).

### API · 코드

| 엔드포인트 | 인증 | 코드 |
|---|---|---|
| `GET /products` | opt | `commerce/routes.ts:23` |
| `POST /orders`, `GET /orders`, `GET /orders/:id` | ✓ | `commerce/routes.ts:28`, `:32`, `:33` |
| `POST /payments/confirm`, `POST /payments/fail` | ✓ | `commerce/routes.ts:40`, `:46` |
| `POST /payments/iap/verify` | ✓(회원) | `commerce/routes.ts:52` |
| `POST /payments/webhooks/:provider` | - (서명) | `commerce/routes.ts:91` |
| `POST /payments/iap/notifications/apple`·`google` | - (스토어 서명) | `commerce/routes.ts:84`, `:85` |
| `GET /wallet` | ✓ | `commerce/routes.ts:25` |

### 운영 상태

웹 그로블 결제·상점·보관함·결제 내역은 운영 중. 인앱결제는 앱 전용(앱 출시 전). 토스페이먼츠·포트원은 대안 코드로만 남아 있다.

## 15. 공유

### 화면과 진입 경로

공유 시트(`apps/web/src/components/ShareSheet.tsx`)는 사주 결과·내 사주(`ReadingView`), 오늘의 운세, 궁합, 토정비결, 타로 결과에 있다. 사주 요약 화면은 공유 대신 '텍스트로 복사'를 준다.

### 동작 규칙

- 공유 시트의 선택지는 카카오톡(웹 빌드에 `VITE_KAKAO_JS_KEY` 가 있을 때만), 시스템 공유(브라우저·앱이 지원할 때), 링크 복사다(`apps/web/src/lib/share.ts`).
- 사주 결과의 공유 링크는 결과 주소가 아니라 서비스 첫 화면(`/`)이고, 카카오톡 버튼은 `/input` 으로 연결한다(`ReadingView.tsx:75`). 생년월일과 태어난 시간은 공유 내용에 넣지 않는다.
- 카카오 SDK 는 처음 필요할 때 공식 CDN 에서 한 번만 불러온다.
- 공유하면 분석 이벤트 `share` 를 보낸다(분석이 켜져 있을 때).
- 설정: [ADS_ANALYTICS.md §2.6](./ADS_ANALYTICS.md).

### 운영 상태

| 기능 | 상태 |
|---|---|
| 링크 복사·시스템 공유 | 운영 중 |
| 카카오톡 공유 | 키 없어 꺼짐 |

## 16. 푸시 (오늘의 운세 알림)

### 화면과 진입 경로

앱 알림. `/my` 의 '알림' 토글(오전 08:00 안내)에서 켜고 끈다.

### 동작 규칙

- **발송 시각**: Cloudflare Cron `0 23 * * *`(UTC) = 매일 08:00 KST(`wrangler.jsonc` `triggers`). `features.push`(FCM 키 3종)와 `DAILY_PUSH_ENABLED=true` 가 모두 있어야 보낸다(`apps/api/src/worker.ts:60`).
- **대상**: 푸시 토큰이 있고 수신 동의(`pushEnabled`)이며 탈퇴하지 않은 사용자. 대표 프로필로 오늘의 한 줄을 만들어 보낸다. 대표 프로필이 없으면 건너뛴다(`apps/api/src/jobs/dailyPush.ts:10`, `apps/api/src/modules/push/service.ts:212`).
- **토큰 등록**: 앱이 FCM 토큰을 받아 `POST /push/tokens` 로 등록한다. 웹은 토큰을 등록하지 않는다(마이 화면은 플랫폼이 `web` 이 아닐 때만 등록, `apps/web/src/pages/MyPage.tsx:64`). 로그아웃하면 이 기기의 토큰을 해제한다.
- **수신 동의 저장**: 회원이면 토글이 `PATCH /auth/me { pushEnabled }` 를 보낸다.
- 설정 방법: [AUTH_PUSH.md §6](./AUTH_PUSH.md).

### API · 코드

| 엔드포인트 | 인증 | 코드 |
|---|---|---|
| `POST /push/tokens`, `DELETE /push/tokens` | ✓ | `apps/api/src/modules/push/routes.ts:12`, `:18` |

### 운영 상태

키 없어 꺼짐(FCM 키 없음). 받을 수 있는 곳은 앱뿐이라 앱 전용이기도 하다.

## 17. 광고 · 분석

### 17.1 웹 광고

- **자리**: 무료 결과 하단(`result_bottom`: 사주 결과, 토정비결, 별자리), 오늘 인피드(`home_infeed`), 무료 콘텐츠 본문(`web_content_mid`: 꿈해몽, 띠별, 별자리). 입력·결제·유료 리포트·AI 상담 화면에는 넣지 않는다.
- **켜지는 조건**(`apps/web/src/components/AdSlot.tsx:38`): 웹(앱 아님) + 그 자리의 웹 빌드 키(`VITE_ADSENSE_*` 또는 `VITE_ADFIT_*`) + 서버 `/config` 의 `ads.enabled`(`ADS_ENABLED=true` 이고 `ADS_PROVIDER` 가 `none` 이 아님) + 플러스 사용자가 아님. 광고가 채워지지 않으면 자리를 접는다.
- 정책·키 발급: [ADS_ANALYTICS.md §1, §2](./ADS_ANALYTICS.md).

### 17.2 앱 보상형 광고

- AI 상담·AI 꿈풀이 화면에서 질문권이 0일 때 앱에만 카드가 보인다(`apps/web/src/components/RewardedAdCard.tsx:15`). 웹에서는 그리지 않는다.
- 광고를 끝까지 보면 AdMob 이 서버 콜백(SSV)을 부르고, 서버가 Google 서명을 확인한 뒤 무상 질문권 1회(`REWARDED_AD_CREDITS`)를 준다. 하루 3회(`REWARDED_AD_DAILY_LIMIT`), 거래 ID 로 중복을 막는다(`apps/api/src/modules/rewards/service.ts:104`). 운영에서 허용 광고 단위(`ADMOB_REWARDED_AD_UNITS`)가 비어 있으면 지급하지 않는다.
- API: `GET /rewards/admob-ssv`(Google 호출), `GET /rewards/status`(✓, `apps/api/src/modules/rewards/routes.ts:11`, `:19`).

### 17.3 분석

- GA4·메타 픽셀·카카오 픽셀. 키가 없는 매체는 스크립트를 불러오지 않는다(`apps/web/src/lib/analytics.ts`).
- 이벤트: `page_view`(라우트 변경마다, `apps/web/src/App.tsx`), `birth_submitted`, `reading_viewed`, `daily_viewed`, `compatibility_viewed`, `paywall_viewed`, `checkout_started`, `purchase`, `signup`, `login`, `share`, `chat_sent`, `tarot_drawn`, `tarot_daily_drawn`, `tarot_result_viewed`. 매체별 이름은 [ADS_ANALYTICS.md §3](./ADS_ANALYTICS.md).
- 생년월일·이메일·이름 같은 개인정보는 걸러 보내지 않고, 주소의 쿼리는 `utm_*` 만 남긴다.

### 17.4 운영 상태

| 기능 | 상태 |
|---|---|
| 웹 광고 | 키 없어 꺼짐(`ADS_ENABLED` 도 꺼짐) |
| 앱 보상형 광고 | 앱 전용 |
| 분석 3종 | 키 없어 꺼짐 |

## 18. SEO 사전 렌더링

### 동작

- 웹 빌드(`npm run build -w @saju/web`) 뒤 `apps/web/scripts/prerender.mts` 가 검색 유입용 주소마다 제목·설명·canonical·og 태그를 넣은 정적 `dist/<경로>/index.html` 을 만들고, `sitemap.xml`·`robots.txt` 를 함께 만든다. 본문은 그대로 JS 가 그린다.
- 대상: 주요 무료 화면(첫 화면·입력·오늘·신년운세·궁합·오늘의 타로·상담·상점·약관·사주 기초·토정비결·만세력·타로·택일·띠별·별자리·꿈해몽), 띠 12 × 기간 5, 별자리 12 × 기간 5, 꿈해몽 분류 11, 꿈해몽 항목 337.
- 주소 기준은 빌드 환경 변수 `PUBLIC_WEB_URL`(기본 `https://daldalsaju.com`)이다. `robots.txt` 는 개인 화면(`/my`, `/result`, `/saju/`, `/reports/`, `/tarot/r/` 등)과 `/api/` 를 막는다.
- Worker 는 `html_handling: drop-trailing-slash` 로 `<경로>/index.html` 을 끝 슬래시 없는 주소로 내고, 없는 주소는 `index.html`(SPA)로 보낸다(`apps/api/wrangler.jsonc` `assets`).
- 사전 렌더링하지 않은 주소는 SPA 대체 파일(홈 `index.html`)을 받아서 홈의 canonical 을 갖고 온다. 그래서 `RootLayout` 의 `useRouteMeta`(`apps/web/src/lib/pageMeta.ts`)가 주소가 바뀔 때마다 canonical 을 지금 주소로 맞추고, 개인 화면에는 `<meta name="robots" content="noindex">` 를 단다(목록은 `robots.txt` 와 같다). 화면이 `usePageMeta` 로 정한 값이 있으면 그 값이 이긴다.
- 최신 대상 목록은 스크립트의 `routes()` 를 본다(2026-11-25 기준 사전 렌더링 475개, sitemap 486개).

### 운영 상태

운영 중. 네이버 서치어드바이저·구글 서치콘솔 등록은 아직 하지 않았다(인증 태그 필요).

## 19. 약관 · 처리방침 · 면책

### 화면과 진입 경로

`/legal/terms`(이용약관), `/legal/privacy`(개인정보 처리방침), `/legal/disclaimer`(면책 고지). 첫 화면 아래, 마이, 결제 시트 문구에서 들어온다. 모르는 문서 이름은 이용약관을 보여 준다.

### 동작 규칙

- 본문은 웹 코드에 직접 들어 있다(`apps/web/src/pages/MiscPages.tsx:109`). 코드 주석에 "출시 전 법무 검토를 거쳐 확정한다"고 적혀 있다.
- 이용약관은 제1조~제5조(목적, 서비스의 성격, 유료 콘텐츠와 청약철회 제한·미사용 질문권 환불, 인앱결제 환불, 회원 탈퇴)다.
- 결과·리포트·타로·택일·꿈풀이 응답에는 각자 면책 문구(`disclaimer`)가 붙는다(예: `reading.ts:68`, `apps/api/src/modules/tarot/reading.ts:27`, `apps/api/src/modules/taekil/content.ts:31`).
- 결제 시트 아래에는 "결제하면 이용약관과 환불 정책에 동의한 것으로 봐요" 문구가 있다(`apps/web/src/i18n/ko.json:323`).
- 토스 미니앱 빌드는 토스용 약관으로 바꿔 보여 준다(`apps/web/src/toss/legal.ts`).

### 운영 상태

운영 중(본문은 법무 검토 전).

## 20. 관리자 API

| 엔드포인트 | 하는 일 | 코드 |
|---|---|---|
| `POST /admin/orders/:id/refund { reason }` | 결제사 취소 + 권한·질문권 회수. 인앱결제·그로블 주문은 거절(각 스토어·판매자 화면에서 환불) | `commerce/routes.ts:98`, `commerce/service.ts:640` |
| `POST /admin/users/:id/credits { amount(1~1000), memo }` | 무상 질문권 지급 | `commerce/routes.ts:105` |

- 인증: `x-admin-token: <ADMIN_API_TOKEN>` 헤더(상수 시간 비교) 또는 `role=admin` 사용자의 토큰(`commerce/routes.ts:14`). 운영에서 분당 20회로 제한한다.
- 관리자 화면(웹 UI)은 없다.
- 운영 상태: 코드는 운영 중이다. 운영 Worker 에 `ADMIN_API_TOKEN` 시크릿이 들어 있는지는 확인 못 함.

## 21. 토스 미니앱 (보류)

- 웹 코드를 토스 앱 안의 미니앱으로 따로 빌드한다(`npm run build:toss -w @saju/web`, `apps/web/src/toss/*`). 로그인은 토스 계정, 결제는 토스 인앱결제, 광고는 토스 광고를 쓴다.
- 서버 쪽은 `POST /auth/toss`, `GET /payments/iap/toss/products`, `POST /payments/iap/toss/orders`, `POST /payments/iap/verify`(`platform: 'toss'`), `POST /rewards/toss/start`·`/claim` 이 있다. 토스 결제는 리포트·타로에 딸린 질문권을 주지 않는다(`commerce/service.ts:210`). 토스 결제에는 환불 알림이 없어 Cron 이 하루 한 번 최근 주문의 환불 여부를 다시 확인한다(`worker.ts:60`).
- 서버와 토스 사이 통신은 mTLS 인증서 바인딩(`TOSS_MTLS`)이 있어야 켜진다(`apps/api/src/worker.ts`). 기준일의 `wrangler.jsonc` 에는 이 바인딩이 없어 `/config` 의 `tossAuth`·`tossIap`·`tossRewards` 는 `false` 다.
- 운영 상태: 보류(웹 출시 뒤로 미룸).

## 22. 알려진 빈 곳

코드를 읽다 발견한 미완성 부분과 문서·화면과 코드가 다른 부분이다. 2026-11-25 에 코드로 고친 항목은 '해결'로 표시하고 남겨 둔다.

### 22.1 키·설정이 없어 꺼진 기능 (운영자가 키를 넣으면 켜짐)

1. 소셜 로그인 4종(카카오·네이버·구글·Apple)이 꺼져 있다. 로그인 화면에는 이메일 로그인만 보인다.
2. 비밀번호 재설정 메일(Resend)이 꺼져 있다. `/password/forgot` 은 문의 안내로 바뀌는데, `SUPPORT_EMAIL` 이 비어 있어 받는 주소가 없는 `mailto:` '문의하기' 링크만 보인다(`PasswordPages.tsx:59`).
3. 결제 내역 화면은 "환불 문의는 고객센터로 연락해 주세요"라고 안내하지만 화면 어디에도 연락처가 없다(`PaymentsPage.tsx:87`). `SUPPORT_EMAIL` 을 정한 뒤 이 화면에도 연결해야 한다.
4. 푸시가 꺼져 있다(FCM 키 없음, 앱 전용). 해결: 웹 마이 화면에서는 알림 토글을 숨기고, 앱에서는 서버에 저장된 값(`UserDto.pushEnabled`)으로 토글을 시작한다(`MyPage.tsx`).
5. 웹 광고가 꺼져 있다(`ADS_ENABLED` 꺼짐, 웹 빌드에 광고 키 없음).
6. 분석(GA4·메타 픽셀·카카오 픽셀)이 꺼져 있어 `purchase` 같은 전환 이벤트가 기록되지 않는다. 처리방침은 "수집할 수 있다"고 적는다.
7. 카카오톡 공유가 꺼져 있다(`VITE_KAKAO_JS_KEY` 없음). 링크 복사·시스템 공유만 된다.
8. 토스 미니앱 서버 기능은 `TOSS_MTLS` 바인딩이 없어 꺼져 있다(보류 상태와 같음).
9. 그로블 결제창 15개는 2026-11-25 에 모두 연결했다(`GROBLE_PRODUCT_LINKS`, 가격 대조 완료). 첫 실결제로 웹훅의 `content.id` 가 링크 ID 와 같은지 확인해야 한다([PAYMENTS.md](./PAYMENTS.md) §3.5).

### 22.2 코드의 미완성·불일치

10. 신년운세 상품은 2027년분만 있다. 대상 연도는 KST 10월부터 다음 해로 넘어가므로(`reading.ts:63`) **2027-09-30 까지** `report_newyear_2028`·`bundle_newyear_2028` 을 카탈로그에 넣고 그로블 결제창도 만들어야 한다. 그 전에는 영향이 없다.
11. 플러스 구독 판정(`isPremium`, `premiumUntil`)이 화면 곳곳에 남아 있지만 구독 상품이 없어 누구도 플러스가 되지 않는다. PRD §2 의 "구독 안 함" 결정과 같으므로 동작에는 문제가 없다.
12. 해결: 회원 탈퇴 때 타로 기록(질문 글 포함)·열람 권한·비밀번호 재설정 기록도 지운다(`users/service.ts` 의 deleteAccount, 테스트 `tarot.test.ts` '계정 정리').
13. 해결: 게스트로 쓰다가 이미 있는 계정으로 로그인하면 타로 기록과 무상 질문권도 옮긴다. 같은 날 같은 질문의 타로는 회원 것을 남긴다. 게스트는 결제할 수 없어 주문·권한은 옮길 것이 없다(`users/service.ts` 의 mergeGuestInto).
14. 프로필 삭제는 구매 여부를 확인하지 않는다. 삭제해도 리포트는 보관함에 '삭제된 프로필'로 남고 본문도 열린다. 다만 사주분석서·연애·재물 리포트 위의 근거 표(원국·오행·대운)는 프로필이 없어 빠진다(`ReportsPage.tsx` 의 chart 조회가 404).
15. 해결: 4번과 같다.
16. 해결: 결제 시트 문구를 "이용약관(제3조 유료 콘텐츠 환불 규정 포함)에 동의"로 바꿨다. 별도 환불 정책 문서는 두지 않는다.
17. 해결: 처리방침의 AI 항목에 AI 상담·꿈풀이·유료 타로 이야기·리포트 다듬기·택일 상세를 모두 적었다. 처리방침 전체(보호책임자·위탁·국외 이전 등)는 운영자 정보가 정해지면 다시 쓴다.
18. 해결: 사주 결과 공유 링크를 무료 풀이 화면(`/input`)으로 바꿨다. 결과는 공유한 사람의 생년월일로만 열리므로, 받은 사람은 자기 사주를 넣게 한다.

### 22.3 문서와 코드가 다른 곳 (모두 해결)

19. [PAYMENTS.md](./PAYMENTS.md)의 "웹훅 `paid` 복구 때 금액 대조 안 함(확인 필요)"을 해결됨으로 고쳤다.
20. [PAYMENTS.md](./PAYMENTS.md)의 "리포트 생성 실패 시 자동 환불"을 "구현하지 않음, 규칙 기반 본문으로 마무리"로 고쳤다.
21. [API.md](./API.md)에 토스 미니앱 엔드포인트 절을 넣었다.
22. [API.md](./API.md) 타로 결제 줄에 2차 펼침 상품 3종을 넣었다.
23. [PRD.md §4](./PRD.md)의 데스크톱 "상단 내비"를 왼쪽 사이드바로 고쳤다.
24. [ARCHITECTURE.md](./ARCHITECTURE.md) 그림과 모듈 설명에 그로블을 넣었다.
