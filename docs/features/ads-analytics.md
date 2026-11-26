# 광고 · 분석 · 공유

> 기준일: 2026-11-26. `feat/cloudflare` 작업 트리의 코드를 기준으로 적었다. 이 문서는 [FEATURES.md](../FEATURES.md) §15·§17과 §0.2·§22 중 광고·분석·공유 항목을 대체한다. 매체별 키 발급, 콘솔 설정, 처리방침 문구 초안, ads.txt 게시, 운영 체크리스트는 [ADS_ANALYTICS.md](../ADS_ANALYTICS.md)에 있다. 토스 미니앱의 광고는 [toss-miniapp.md](toss-miniapp.md)에 있다.

## 목적

- **웹 광고**: 무료 화면에서 수익을 낸다. 입력·결제·유료 콘텐츠·AI 상담처럼 사용자가 집중하거나 돈을 낸 화면에는 넣지 않는다.
- **앱 보상형 광고**: 질문권을 다 쓴 사용자에게 광고 시청으로 무상 질문권 1회를 준다. 유료 상품을 광고로 대신 열어 주지는 않는다(AdMob 정책).
- **분석**: 유입과 전환(가입·결제)을 매체별로 측정한다.
- **공유**: 결과를 친구에게 보내 새 사용자를 데려온다.

모든 매체는 키가 없으면 스크립트를 불러오지 않고, 그리지 않고, 보내지 않는다. 외부 SDK 는 npm 의존성 없이 공식 CDN 스크립트를 처음 필요할 때 한 번만 불러오고, 광고 차단기 등으로 실패하면 조용히 넘어간다(`loadScript`).

| 기능 | 운영 상태 |
|---|---|
| 웹 광고(AdSense·카카오 애드핏) | 키 없어 꺼짐(`ADS_ENABLED` 꺼짐, 웹 빌드에 광고 키 없음) |
| 앱 보상형 광고(AdMob) | 앱 전용 |
| 앱 배너·전면 광고 | 미구현(알려진 이슈 5) |
| GA4·메타 픽셀·카카오 픽셀 | 키 없어 꺼짐(웹 빌드에 `apps/web/.env` 없음) |
| 링크 복사·시스템 공유 | 운영 중 |
| 카카오톡 공유 | 키 없어 꺼짐(`VITE_KAKAO_JS_KEY` 없음) |

## 사용자 흐름

### 웹 광고 자리 (코드 기준)

| placement | 화면 · 위치 |
|---|---|
| `result_bottom` | 사주 결과·내 사주 하단(잠긴 섹션이 있고 플러스가 아닐 때, `ReadingView`), 토정비결 결과 하단, 띠별·별자리 상세 하단(오늘의 운세 안내 카드 아래), 타로 결과 하단(잠겼거나 무료 리딩일 때, `TarotReadingView`) |
| `home_infeed` | 오늘 탭, 운세 카드 아래·공유 버튼 위 |
| `web_content_mid` | 꿈해몽 사전 첫 화면과 키워드 화면의 본문 중간·하단, 띠별·별자리 허브(12개 목록 아래)와 상세(근거 카드 아래) |

넣지 않는 곳: 생년월일 입력·입력 확인, 상점·결제·결제 결과·결제 내역·페이월 시트, 유료 리포트 뷰어와 잠금이 모두 풀린 결과, AI 상담·AI 꿈풀이 입력 주변, 로그인·가입·인증 콜백, 약관. AdSense 자동 광고는 이 금지 구역에도 광고를 넣으므로 켜지 않는다.

`AdSlot` 이 광고를 그리는 판정 순서는 다음과 같다.

1. 앱(Capacitor)이면 그리지 않는다. 앱 광고는 native 계층(AdMob) 몫이다.
2. 그 자리의 웹 빌드 키(`VITE_ADSENSE_*` 또는 `VITE_ADFIT_*`)가 하나도 없으면 그리지 않고 `/config` 도 부르지 않는다.
3. `/config` 의 `ads.enabled` 가 참이 아니면(불러오는 중 포함) 그리지 않는다. 서버는 `ADS_ENABLED=true` 이고 `ADS_PROVIDER` 가 `none` 이 아닐 때만 참을 준다. 배포 없이 끌 수 있는 스위치다.
4. 플러스 사용자(`user.isPremium`)에게는 그리지 않는다.
5. `ads.provider` 가 `adsense` 면 AdSense 키, `adfit` 이면 애드핏 키가 있어야 한다. 다른 매체로 대신하지 않고, `admob`·`none` 은 웹에서 그리지 않는다.
6. 채울 광고가 없거나(AdSense `data-ad-status="unfilled"`, 애드핏 `data-ad-onfail`) 스크립트가 막히면 빈 상자 대신 자리를 접는다.

광고 자리에는 "광고" 라벨을 붙이고, 레이아웃 밀림(CLS)을 막으려고 AdSense 250px, 애드핏 100px 높이를 미리 잡는다. 개발 서버에서는 AdSense 에 `data-adtest="on"` 을 붙여 무효 노출을 막는다.

### 앱 보상형 광고

1. AI 상담(`AskPage`)과 AI 꿈풀이(`DreamPages`)에서 AI 가 켜져 있고 질문권이 1 미만이면 `RewardedAdCard` 가 보인다. 앱에서만 그리고, `GET /rewards/status` 의 남은 횟수가 0이면 숨긴다.
2. 사용자가 '보기'를 눌렀을 때만 광고를 띄운다. 앱은 SSV 옵션에 서버 사용자 ID(`ssv.userId`)를 넣고, 서버가 알려 준 하루 한도(`limit`)를 `showRewardedAd({ dailyLimit })` 로 넘긴다.
3. 광고를 끝까지 보면 Google 이 `GET /rewards/admob-ssv` 를 부르고, 서버가 서명을 확인한 뒤 무상 질문권을 준다. 앱이 보내는 "보상 받음" 값만으로는 주지 않는다.
4. 앱은 2초·4초·8초 뒤 지갑과 남은 횟수를 다시 불러온다.

iOS 는 ATT 를 묻지 않고, 허용 상태가 아니면 비개인화 광고(`npa`)로 요청한다. 앱 ID·광고 단위 설정은 [APP_PORTING.md §9](../APP_PORTING.md)에 있다.

### 분석

`main.tsx` 가 시작할 때 한 번 초기화하고, 화면이 `track(event, props)` 를 부르면 키가 있는 매체에만 보낸다. 이벤트는 `page_view`(라우트가 바뀔 때마다, `App.tsx`), `birth_submitted`, `reading_viewed`, `daily_viewed`, `compatibility_viewed`, `paywall_viewed`, `checkout_started`, `purchase`, `signup`, `login`, `share`, `chat_sent`, `tarot_drawn`, `tarot_daily_drawn`, `tarot_result_viewed` 다. 매체별 이벤트 이름과 속성은 [ADS_ANALYTICS.md §3](../ADS_ANALYTICS.md)에 있다.

### 공유

공유 시트(`ShareSheet`)는 사주 결과·내 사주(`ReadingView`), 오늘의 운세, 궁합, 토정비결, 타로 결과에 있다. 사주 요약 화면은 공유 대신 '텍스트로 복사'를 준다. 선택지는 카카오톡(웹 빌드에 `VITE_KAKAO_JS_KEY` 가 있을 때만), 시스템 공유(브라우저·앱이 지원할 때), 링크 복사다.

## 관련 파일

| 구분 | 경로 |
|---|---|
| 웹 광고 | `apps/web/src/components/AdSlot.tsx` |
| 앱 보상형 카드 | `apps/web/src/components/RewardedAdCard.tsx` |
| 앱 광고 native | `apps/web/src/native/ads.ts`(`showRewardedAd`, `REWARDED_DAILY_LIMIT`), `apps/web/src/native/env.ts`(광고 단위 키) |
| 분석·스크립트 로더 | `apps/web/src/lib/analytics.ts`(`initAnalytics`, `track`, `loadScript`, `sanitize`, `recoverWebPurchase`) |
| 공유 | `apps/web/src/lib/share.ts`, `apps/web/src/components/ShareSheet.tsx` |
| 서버 광고 스위치 | `apps/api/src/modules/config/routes.ts`(`ads`), `apps/api/src/config/env.ts`(`ADS_ENABLED`, `ADS_PROVIDER`) |
| 광고 보상 | `apps/api/src/modules/rewards/routes.ts`, `apps/api/src/modules/rewards/service.ts`(`handleAdmobSsv`, `todayCount`), `apps/api/src/modules/commerce/service.ts`(`grantDailyCapped`) |
| 테스트 | `apps/web/src/lib/__tests__/marketing.test.ts`, `apps/web/src/native/__tests__/native.test.ts`('보상형 광고'), `apps/api/test/rewards.test.ts`, `apps/api/test/idempotency.test.ts`('질문권 한도가 있는 무상 지급') |

## API / 데이터 모델

- `GET /config` 의 `ads: { enabled, provider }`, `GET /rewards/admob-ssv`(Google 호출, 인증 없음, IP 요청 수 제한에서 뺀다), `GET /rewards/status`(로그인 필요). 형식은 [API.md 보상형 광고 절](../API.md)을 본다.
- 광고 보상 기록은 `webhook_events` 의 `admob:<transaction_id>` 행(payload 는 광고 단위·보상량·시각뿐이고 사용자 ID 는 두지 않는다, 30일 뒤 정리)과 `credit_ledger` 의 `reason='bonus'`, `memo='광고 보상'` 행이다. 하루 한도는 이 원장 행 수로 센다.
- 키 목록과 위치(서버 vars·웹 빌드·앱 빌드 `.env.app`)는 [ENV_KEYS.md §7](../ENV_KEYS.md)에 있다.

## 비즈니스 규칙 & 엣지케이스

**AdMob SSV**

- 서명 대상은 쿼리 원문에서 `&signature=` 앞부분이다. 파싱하기 전 문자열로 검증한다.
- Google 공개키는 24시간 동안 메모리에 둔다. 모르는 `key_id` 가 오면 다시 받되 최소 10분 간격을 둔다(외부 요청 증폭 방지).
- 광고 단위 허용 목록(`ADMOB_REWARDED_AD_UNITS`, 콤마 구분)에 없는 단위는 지급하지 않는다. 다른 앱의 광고 단위가 콜백 주소를 우리 서버로 지정해 보상을 가져가는 것을 막는다. 목록이 비면 운영에서는 모두 거부하고 개발에서는 허용한다. 항목은 숫자 부분만 적어도, `ca-app-pub-…/숫자` 로 적어도 맞는다.
- 같은 거래 ID 는 먼저 기록한 요청만 지급한다. 지급 단계에서 오류가 나면 기록을 지워, AdMob 이 다시 보낼 때 지급되게 한다.
- 하루 한도(`REWARDED_AD_DAILY_LIMIT`, 기본 3)는 KST 0시 기준이고, 지급 묶음이 실행되는 시점에 다시 확인한다. 그래서 서로 다른 거래가 동시에 와도 한도를 넘지 않는다. 토스 미니앱 광고 보상과 같은 한도를 함께 쓴다.
- 앱도 같은 기준으로 센다. 기기 카운트(`yd.native.rewardedAds`)는 KST 날짜로 세고, 한도는 `GET /rewards/status` 의 `limit` 을 따른다(받지 못하면 3). 기기 카운트는 광고를 쓸데없이 띄우지 않기 위한 보조 장치이고 지급 여부는 서버가 정한다.
- SSV 의 `custom_data` 는 읽지 않는다. 지급은 `user_id` 로만 정한다.
- 1회 지급량은 `REWARDED_AD_CREDITS`(기본 1)이고 무상 질문권으로 쌓인다. 무상 질문권은 쓸 때 먼저 차감되고 환불 대상이 아니다.
- 지급하지 않는 경우(허용되지 않은 단위, 파라미터 누락, 중복, 없는 사용자·탈퇴, 한도 초과)도 200 `{ granted: false, reason }` 으로 답해 AdMob 이 다시 보내지 않게 한다. 서명이 없거나 틀리면 400 이다.

**분석**

- **개인정보 필터**: 속성 이름이 `email`·`birth*`·`dob`·`phone*`·`name`·`nickname`·`address`·`gender`·`year`·`month`·`day`·`hour`·`minute`·`password`·`token` 등이면 버리고, 이메일이나 날짜(`YYYY-MM-DD`, `YYYYMMDD`)처럼 보이는 값도 버린다.
- **주소 정리**: `page_location` 에는 `utm_*`·`gclid`·`gbraid`·`wbraid`·`fbclid` 만 남기고 나머지 쿼리(OAuth `code`, 결제 키 등)와 해시를 지운다.
- **중복 집계 방지**: SPA 라서 GA4 자동 `page_view` 를 끄고(`send_page_view: false`) 라우트마다 직접 보낸다. 메타 픽셀은 history 자동 PageView 를 끄고(`disablePushState`), 자동 수집(`autoConfig`)도 끈다. GA4 콘솔의 "방문 기록 기반 페이지 변경"도 꺼야 한다([ADS_ANALYTICS.md §2.3](../ADS_ANALYTICS.md)).
- **금액**: `price`·`value` 는 원 단위 정수, 통화는 항상 `KRW` 다. `purchase` 는 메타 `eventID` 와 GA4 `transaction_id` 를 주문 ID 로 맞춘다.
- **결제 전환 한 번만**: 같은 주문 ID 의 `purchase` 는 이 기기에서 한 번만 보낸다(최근 50개를 `yd.analytics.purchases` 에 둔다). 결제 확인 화면을 다시 열어도, 주문 ID 로 거르지 못하는 카카오 픽셀에도 겹치지 않는다.
- **빠진 결제 전환 복구**: 그로블 결제는 결제 확인 화면이 `paid` 를 본 뒤에 `purchase` 를 보낸다. 그 전에 화면을 닫았으면 다음 시작 3초 뒤 `recoverWebPurchase` 가 이 기기에 남은 결제 대기 주문을 주문 목록(`GET /orders`)에서 찾아, 결제됐고 만든 지 하루 안이면 그때 보낸다. 주문 하나 조회(`GET /orders/:id`)는 서버가 결제를 기다리는 표시로 쓰므로 부르지 않는다. 분석 키가 하나도 없으면 확인하지 않는다.
- **가입 전환**: 이메일 가입은 `signup` 을 보낸다. 소셜 로그인 콜백은 서버 응답의 `isNewUser`(처음 가입, 게스트 전환 포함)가 참이면 `signup`, 아니면 `login` 을 보낸다.
- **개발 서버**: 스크립트를 불러오지 않고 매체별로 보낼 내용을 `console.debug('[analytics] …')` 로만 찍는다.

**공유**

- 웹 공유 순서는 앱 네이티브 공유, Web Share API, 클립보드(글+주소) 순이다. 사용자가 시스템 공유를 취소하면 이벤트를 보내지 않는다.
- 사주 결과의 공유 주소와 카카오 버튼은 모두 무료 풀이 입력 화면(`/input`)이다. 결과는 공유한 사람의 생년월일로만 열리므로 받은 사람은 자기 사주를 넣게 한다.
- 공유 내용에는 프로필 이름, 일주, 생년월일, 태어난 시각을 넣지 않는다. 사주 결과 제목은 "여덟 글자로 읽은 사주, '`별칭`'"(`share.kakaoResult.title`), 오늘의 운세 제목은 "오늘의 한 줄: `한 줄`", 궁합 설명에는 두 사람의 이름을 넣지 않는다. 공유 시트 아래 안내도 "이름과 생년월일, 태어난 시간은 공유되지 않아요."다.
- 카카오 SDK(2.7.4)는 공유 시트가 열릴 때 미리 받아 두어, 버튼을 누른 사용자 동작 안에서 바로 호출한다(데스크톱 팝업 차단 방지). 앱에서는 `kakaoAvailable()` 이 거짓이라 시스템 공유를 쓴다.
- 카카오 디벨로퍼스의 Web 플랫폼에 운영·스테이징·개발 도메인을 모두 등록해야 SDK 호출이 성공한다. JavaScript 키는 공개 키라 이 도메인 제한이 사실상 유일한 보호 장치다.
- 공유하면 분석 이벤트 `share`(채널 `kakao`·`system`·`clipboard`·`copy_link`)를 보낸다.

**토스 빌드**: `AdSlot`·`RewardedAdCard`·`ShareSheet`·`lib/share.ts`·`lib/analytics.ts` 는 토스 빌드에서 `apps/web/src/toss/replace/*` 로 바뀐다([toss-miniapp.md](toss-miniapp.md)).

## 주의사항 / 알려진 이슈

1. **모두 꺼져 있다**: 웹 광고·분석 3종·카카오톡 공유는 키가 없다. 분석이 꺼져 있어 `purchase` 같은 전환이 기록되지 않는다. 남김(외부 작업): 매체 키 발급과 웹 빌드 설정은 운영자가 한다([ADS_ANALYTICS.md](../ADS_ANALYTICS.md)).
2. 문서만 고침(2026-11-26): **광고 자리 목록이 문서와 다르던 문제**. [ADS_ANALYTICS.md §1.1](../ADS_ANALYTICS.md)에 띠별·별자리 상세 하단과 타로 결과 하단의 `result_bottom` 을 넣었다. 이 문서의 표가 코드 기준이다.
3. 문서만 고침(2026-11-26): **ADS_ANALYTICS 의 앱 광고 키 이름**. §1.5 를 실제 이름 `VITE_ADMOB_UNIT_REWARDED_CHAT_{IOS,ANDROID}`, `VITE_ADMOB_UNIT_BANNER_RESULT_{IOS,ANDROID}`, `VITE_ADMOB_TESTING`(`apps/web/src/native/env.ts`)으로 고쳤다.
4. 문서만 고침(2026-11-26): **ADS_ANALYTICS §4 의 낡은 처리방침 문구**. §4 를 "처리방침은 `apps/web/src/lib/legal.ts` 의 7번(행태정보와 쿠키)·8번(카카오톡 공유)과 5·6번(FCM·AdMob 포함)에 반영됐다"로 바꿨다.
5. **앱 배너·전면·상세 보상형은 미구현이다**: 새 기능이라 이번에 만들지 않는다. `showBannerAd` 등은 `native/ads.ts` 에만 있고 어느 화면도 부르지 않는다. ADS_ANALYTICS §1.5의 `app_banner_result`, `app_rewarded_detail`, `app_interstitial_result` 에 "미구현"을 적었다.
6. 해결(2026-11-26): **앱과 서버의 하루 한도 계산이 다르던 문제**. 앱의 기기 카운트를 KST 날짜로 세고, 한도는 `GET /rewards/status` 의 `limit` 을 `RewardedAdCard` 가 `showRewardedAd({ dailyLimit })` 로 넘긴다. 해외 시간대 기기와 서버 한도 변경에도 서버와 같은 기준이다.
7. **지급 결과를 사용자에게 알리지 않는다**: `RewardedAdCard` 는 시청 뒤 약 14초 동안만 지갑을 다시 불러온다. SSV 콜백이 더 늦으면 지급이 바로 보이지 않고, 지급이 거절돼도(허용 단위·한도) 화면은 알 수 없다. 남김(새 기능): 서버가 SSV 결과를 사용자별로 알려 주는 경로가 필요하다.
8. 해결(2026-11-26): **SSV 부가 데이터와 보상 기록**. 앱은 더 이상 쓰이지 않는 `ssvCustomData: 'chat'` 을 보내지 않고, 서버는 `custom_data` 를 읽지 않는다고 문서에 적었다(APP_PORTING §9 예시도 고쳤다). `admob:` 기록에는 사용자 ID·SSV 쿼리 전체 대신 광고 단위·보상량·시각만 두고, 30일 뒤 정리 작업이 지운다([ops.md](ops.md)).
9. 해결(2026-11-26): **소셜 첫 가입이 `signup` 으로 잡히지 않던 문제**. 소셜 로그인 콜백 응답에 `isNewUser` 를 넣고(`POST /auth/oauth/:provider/callback`), 웹이 참이면 `signup`(GA4 `sign_up`, 메타 `CompleteRegistration`, 카카오 `signUp`)을 보낸다.
10. 해결(2026-11-26): **웹 결제 전환이 빠지거나 겹치던 문제**. 같은 주문의 `purchase` 는 기기에서 한 번만 보내고(카카오 픽셀 포함), 결제 확인 화면을 닫아 빠진 그로블 결제는 다음 시작 때 주문 목록으로 확인해 보낸다. 다른 기기에서 확인하거나 하루가 지나면 복구하지 않는다.
11. **타로 이벤트는 GA4 로만 간다**: `tarot_drawn`·`tarot_daily_drawn`·`tarot_result_viewed` 는 메타·카카오 픽셀에 대응 이벤트가 없다. 의도된 동작으로 유지: 전환이 아닌 이용 이벤트라 GA4 로만 본다. 문서만 고침(2026-11-26): ADS_ANALYTICS §3 표에 세 이벤트를 넣었다.
12. 해결(2026-11-26): **공유 제목에 이름과 일주가 들어가던 문제**. 사주 결과·오늘의 운세·궁합 공유 문구에서 프로필 이름과 일주를 뺐다. 처리방침 8번도 "결과 제목(사주 풀이의 별칭 등)·요약·링크, 이름과 생년월일·태어난 시각은 공유하지 않음"으로 맞췄다.
13. **CSP 를 강화할 때 광고·분석 도메인을 함께 넣어야 한다**: 지금 `apps/web/public/_headers` 의 CSP 는 `script-src` 를 걸지 않아 광고·분석 스크립트를 막지 않는다. `script-src`·`frame-src`·`connect-src` 를 넣으려면 [ADS_ANALYTICS.md §6](../ADS_ANALYTICS.md)의 도메인 목록을 함께 넣는다. 남김: CSP 강화는 보안 점검 범위다.
14. **ads.txt·app-ads.txt 가 없다**: 남김(외부 작업): 게시할 내용(AdSense 게시자 ID·AdMob 앱 ID)이 아직 없어 빈 파일을 만들지 않는다. AdSense 승인 뒤 `apps/web/public/ads.txt` 에, 앱 출시 전 개발자 웹사이트에 `app-ads.txt` 를 게시한다([ADS_ANALYTICS.md §5](../ADS_ANALYTICS.md), [APP_PORTING.md §9](../APP_PORTING.md)).
