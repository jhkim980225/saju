# 광고·분석·공유 연동 가이드 (ADS_ANALYTICS)

- 작성: 마케팅·광고팀
- 기준일: 2026-10-12
- 관련 문서: [`research/03-pricing-payments-ads.md`](research/03-pricing-payments-ads.md) §3 광고 모델, §5.7 광고 슬롯 위치, [`ENV_KEYS.md`](ENV_KEYS.md)
- 원칙: **키가 없으면 아무 것도 렌더링·로드·전송하지 않습니다.** 키만 넣으면 동작합니다. 외부 SDK 는 npm 의존성 없이 공식 CDN `<script>` 를 런타임에 한 번만 동적 로드하고, 로드에 실패하면(광고 차단기 등) 조용히 무시합니다.

| 구분 | 코드 |
|---|---|
| 광고 슬롯 (AdSense / 카카오 애드핏) | `apps/web/src/components/AdSlot.tsx` |
| 분석·전환 추적 (GA4 / Meta Pixel / Kakao Pixel), 공용 스크립트 로더 `loadScript` | `apps/web/src/lib/analytics.ts` |
| 공유 (카카오톡 / 시스템 공유 / 링크 복사) | `apps/web/src/lib/share.ts` |
| 공유 바텀시트 UI | `apps/web/src/components/ShareSheet.tsx` |
| 테스트 | `apps/web/src/lib/__tests__/marketing.test.ts` |
| 서버 광고 스위치 | `GET /config` 의 `ads: { enabled, provider }` (`ADS_ENABLED`, `ADS_PROVIDER`) |

---

## 1. 광고 정책

### 1.1 노출 위치 (웹)

| placement | 화면 · 위치 | 사용처 | 네트워크 · 크기 | 예약 높이(CLS) |
|---|---|---|---|---|
| `result_bottom` | 무료 결과 본문 하단, 유료 상품 추천(전체 풀이 열기) **아래** | `ReadingView.tsx` (잠긴 섹션이 있고 프리미엄이 아닐 때) | AdSense 반응형 디스플레이 / 애드핏 320×100 | AdSense 250px, 애드핏 100px |
| `home_infeed` | 오늘 탭, 운세 카드들 아래·공유 버튼 위 | `TodayPage.tsx` | AdSense 반응형 디스플레이 / 애드핏 320×100 | 같음 |
| `content_mid` | 띠별·별자리 운세(SEO 콘텐츠) 본문 중간 — 상세는 근거 카드 아래·년생별 목록 위, 허브는 12개 목록 아래. 같은 화면 하단(오늘의 운세 안내 카드 **아래**)은 `result_bottom` | `ZodiacPage.tsx`, `HoroscopePage.tsx` (키: `VITE_ADSENSE_SLOT_CONTENT_MID`, `VITE_ADFIT_UNIT_CONTENT_MID`) | 같음 | 같음 |

2차 후보(리서치 §5.7): SEO 콘텐츠 본문 중간·하단(`web_content_mid`), AdSense Offerwall(`web_offerwall_detail`, 하루 1~2회). 추가할 때는 `AdPlacement` 타입과 env 키를 함께 늘립니다.

### 1.2 금지 위치 (공통)

- 생년월일 입력 폼(`/input`, `/profiles/new`, `/profiles/:id/edit`), 입력 확인(`/confirm`)
- 결제·체크아웃·결제 결과·결제 내역(`/store`, `/payments/*`, `/my/payments`, 페이월 시트)
- 유료 리포트 뷰어(`/reports/:id`), 잠금이 모두 풀린 결과 화면
- AI 상담(물어보기) 입력창 주변
- 로그인·회원가입(`/login`, `/signup`, `/auth/callback/*`), 약관·개인정보 처리방침(`/legal/*`)
- **AdSense 자동 광고(Auto ads)는 켜지 마세요.** 자동 광고는 위 금지 구역에도 광고를 넣습니다.

### 1.3 노출 조건 (AdSlot 판정 순서)

1. 앱(Capacitor)이면 렌더링하지 않음 — 앱 광고는 앱팀이 native 계층(AdMob)에서 처리
2. 해당 placement 의 광고 키가 하나도 없으면 렌더링하지 않음(이때는 `/config` 조회도 하지 않음)
3. 서버 `/config` 의 `ads.enabled` 가 `true` 가 아니면(로딩 중 포함) 렌더링하지 않음
4. **프리미엄 사용자(`user.isPremium`)에게는 렌더링하지 않음** — 구독자 전체 광고 제거
5. `ads.provider` 가 `adsense` 면 AdSense 키, `adfit` 이면 애드핏 키가 있어야 렌더링(다른 네트워크로 대체하지 않음). `admob`·`none` 은 웹에서 미노출
6. 광고가 채워지지 않거나(`data-ad-status="unfilled"`, 애드핏 `data-ad-onfail`) 스크립트가 차단되면 빈 박스 대신 슬롯을 접음

광고 영역에는 작은 **"광고" 라벨**이 붙고, 컨테이너는 디자인 토큰(`bg-subtle`, `border-line`, `text-ink-3`)을 써서 다크 모드에 맞춰집니다. 광고 소재 자체의 색은 네트워크가 정합니다. 개발 모드(`npm run dev`)에서는 AdSense 에 `data-adtest="on"` 을 붙여 무효 노출이 집계되지 않게 합니다.

### 1.4 서버 스위치

| env (api) | 값 | 설명 |
|---|---|---|
| `ADS_ENABLED` | `true` / `false` | 광고 전체 on/off. 배포 없이 끌 수 있는 킬 스위치 |
| `ADS_PROVIDER` | `adsense` / `adfit` / `admob` / `none` | 웹 슬롯이 쓸 네트워크. AdSense 승인 전에는 `adfit`(또는 `none`) |

### 1.5 앱 광고 — 앱팀 영역 (참고)

| slot | 위치 | 포맷 | 한도 |
|---|---|---|---|
| `app_banner_result` | 무료 결과 본문 하단(인라인 적응형 배너). 홈 하단 고정 배너는 쓰지 않음 | AdMob 배너 | — |
| `app_rewarded_chat` | AI 질문권을 다 썼을 때 "광고 보고 1회 추가" | AdMob 보상형 + **SSV(서버 측 검증)** | **하루 3회**, 무상 버킷에 적립 |
| `app_rewarded_detail` | 오늘의 운세 상세, 내일 운세 미리보기 | AdMob 보상형 | 하루 1회 |
| `app_interstitial_result` | 무료 결과 진입 | AdMob 전면 (3차, 신중) | 세션당 1회, 첫 세션·결제 직후·구독자 제외 |

- 보상형은 사용자가 **명시적으로 선택**해야 합니다(AdMob 정책). 유료 IAP 상품 자체를 광고로 대신 풀어주지 말고 '추가 무료 1회' 수준으로 제한합니다.
- 키: `VITE_ADMOB_BANNER_ID_{ANDROID,IOS}`, `VITE_ADMOB_REWARDED_ID_{ANDROID,IOS}`. 앱 웹뷰에서는 `AdSlot` 이 항상 `null` 이므로 웹 광고와 겹치지 않습니다.

---

## 2. 키 발급처

웹 키는 모두 `apps/web/.env`(예시: `apps/web/.env.example`)에 넣습니다. `VITE_` 키는 브라우저에 노출되는 **공개 키**만 넣습니다.

### 2.1 Google AdSense — `VITE_ADSENSE_CLIENT_ID`, `VITE_ADSENSE_SLOT_RESULT_BOTTOM`, `VITE_ADSENSE_SLOT_HOME_INFEED`

1. <https://adsense.google.com> 가입 → **사이트** 에 서비스 도메인 추가 → 승인 신청
   - 승인 조건: 충분한 콘텐츠, 이용약관·개인정보 처리방침 페이지, HTTPS. 승인 전에는 `ADS_PROVIDER=adfit` 또는 `none`
2. 게시자 ID `ca-pub-XXXXXXXXXXXXXXXX` → `VITE_ADSENSE_CLIENT_ID`
3. **광고 → 광고 단위 기준 → 디스플레이 광고**(반응형)를 2개 만들고, 각 코드의 `data-ad-slot` 숫자를 `VITE_ADSENSE_SLOT_RESULT_BOTTOM`, `VITE_ADSENSE_SLOT_HOME_INFEED` 에 넣습니다.
4. 자동 광고는 **끔**(1.2 참고). 유럽(EEA·영국) 트래픽이 있다면 **개인정보 보호 및 메시지**에서 동의 메시지(인증 CMP)를 설정합니다.
5. 승인 후 ads.txt 를 게시합니다(5장).

### 2.2 카카오 애드핏 — `VITE_ADFIT_UNIT_RESULT_BOTTOM`, `VITE_ADFIT_UNIT_HOME_INFEED`

1. <https://adfit.kakao.com> → 매체 등록. **사전 승인 또는 초대제**이므로 제휴 문의부터 시작합니다.
2. 승인 후 **광고 단위 만들기 → 웹 → 배너 320×100** 을 위치별로 2개 만들고 광고 단위 ID(`DAN-…`)를 넣습니다.
3. 매체 URL 에 서비스 도메인을 등록해야 광고가 나옵니다. 정산은 매월입니다.

### 2.3 Google Analytics 4 — `VITE_GA4_MEASUREMENT_ID`

1. <https://analytics.google.com> → 관리 → 속성 만들기 → **데이터 스트림 → 웹** → 측정 ID `G-XXXXXXXXXX`
2. 데이터 스트림 → **향상된 측정 → 페이지 조회수 → 고급 설정**에서 "브라우저 방문 기록 이벤트 기반 페이지 변경"을 **끕니다**. 코드가 라우트마다 `page_view` 를 수동으로 보내므로, 켜 두면 중복 집계됩니다.
3. 관리 → 이벤트에서 `purchase`, `sign_up`, `begin_checkout` 을 **주요 이벤트(전환)**로 표시합니다.
4. 데이터 보관 기간(기본 2개월 → 14개월)을 정하고, 개인정보 처리방침의 보유 기간과 맞춥니다.

### 2.4 Meta Pixel — `VITE_META_PIXEL_ID`

1. <https://business.facebook.com> → **이벤트 관리자 → 데이터 소스 연결 → 웹 → Meta 픽셀** → 픽셀 ID(숫자)
2. 픽셀 설정에서 **자동 고급 매칭을 끕니다.** 켜면 폼의 이메일·전화번호가 해시되어 전송될 수 있습니다. 코드도 `fbq('set', 'autoConfig', false)` 로 자동 수집을 끕니다.
3. 비즈니스 설정 → **도메인 인증**, 웹 이벤트 우선순위: Purchase > InitiateCheckout > CompleteRegistration > ViewContent
4. (선택) Conversions API 로 서버에서 Purchase 를 보낼 때 `event_id` 를 주문 ID 로 맞추면, 브라우저 이벤트(`eventID` = `orderId`)와 중복 제거됩니다.

### 2.5 카카오 픽셀 — `VITE_KAKAO_PIXEL_ID`

1. 카카오모먼트 <https://moment.kakao.com> → 광고계정 → **광고자산 관리 → 픽셀 & SDK 연동 관리 → 만들기** → 트랙 ID(숫자)
2. 사용할 이벤트(페이지뷰, 구매, 회원가입, 콘텐츠 조회)를 켜고, 광고그룹 최적화에 연결합니다. 메뉴 이름은 카카오모먼트 개편으로 바뀔 수 있습니다.

### 2.6 카카오 디벨로퍼스 (카카오톡 공유) — `VITE_KAKAO_JS_KEY`

1. <https://developers.kakao.com> → 내 애플리케이션 → 앱 만들기 → **앱 키 → JavaScript 키** → `VITE_KAKAO_JS_KEY`
2. **플랫폼 → Web → 사이트 도메인**에 실제로 공유를 호출하는 모든 출처를 등록합니다. 운영(`https://dalbitsaju.kr`, `https://www.dalbitsaju.kr`), 스테이징, 개발(`http://localhost:5173`)이 해당합니다.
   - **주의**: 등록하지 않은 도메인에서는 SDK 호출이 실패합니다. 공유 카드의 링크(`webUrl`/`mobileWebUrl`) 도메인도 등록된 도메인이어야 카드 클릭이 정상 동작합니다.
   - JavaScript 키는 공개 키이고, 이 도메인 제한이 사실상 유일한 보호 장치입니다.
3. 쿼터: 공식 FAQ 기준 "주어진 쿼터 내 무료"입니다. 초과하면 유료 설정이 필요합니다(정확한 수치는 미확인, 리서치 §4).
4. 앱(Capacitor)에서는 `kakaoAvailable()` 이 `false` 라서 시스템 공유를 씁니다. 앱에서 카톡 공유가 필요하면 앱팀이 네이티브 SDK(`KAKAO_NATIVE_APP_KEY`)로 붙입니다.

---

## 3. 이벤트 표

`track(event, props)` 하나로 세 매체에 보냅니다. 키가 있는 매체에만 전송합니다.

| AnalyticsEvent | 호출 위치 | 주요 props | GA4 | Meta Pixel | Kakao Pixel |
|---|---|---|---|---|---|
| `page_view` | `App.tsx` RootLayout(라우트 변경) | `path` | `page_view` (수동, `page_location`) | `PageView` | `pageView()` |
| `birth_submitted` | `BirthFormPage` | `mode`, `calendar`, `timeKnown` | `birth_submitted` | — | — |
| `reading_viewed` | `ReadingView` | `locked` | `reading_viewed` | `ViewContent {content_name:'reading'}` | `viewContent({id:'reading'})` |
| `daily_viewed` | `TodayPage` | `grade` | `daily_viewed` | `ViewContent {content_name:'daily'}` | `viewContent({id:'daily'})` |
| `compatibility_viewed` | `CompatibilityPage` | `score` | `compatibility_viewed` | `ViewContent {content_name:'compatibility'}` | `viewContent({id:'compatibility'})` |
| `paywall_viewed` | `PaywallSheet` | `products` | `paywall_viewed` | — | — |
| `checkout_started` | `usePurchase` | `product`, `price` | `begin_checkout {value, currency:'KRW', items}` | `InitiateCheckout {value, currency:'KRW', content_ids}` | — |
| `purchase` | `PaymentResultPages`(웹), `usePurchase`(IAP) | `product`, `price`, `channel`, (`orderId`) | `purchase {value, currency:'KRW', items, transaction_id}` | `Purchase {value, currency:'KRW', content_ids}` + `eventID` | `purchase({total_price, currency:'KRW', products})` |
| `signup` | `AuthPages` | `method` | `sign_up {method}` | `CompleteRegistration` | `signUp()` |
| `login` | `AuthPages` | `method` | `login {method}` | — | — |
| `share` | `share.ts` | `channel`(`kakao`/`system`/`clipboard`/`copy_link`) | `share {method}` | — | — |
| `chat_sent` | `AskPage` | — | `chat_sent` | — | — |

- **금액**: `price`(또는 `value`)는 **원 단위 정수**이고 `currency` 는 항상 `KRW` 입니다.
- **SPA page_view**: GA4 는 `send_page_view:false` 로 자동 전송을 끄고 라우트마다 수동으로 보냅니다. Meta 는 `disablePushState` 로 history 자동 PageView 를 끕니다.
- **개인정보 필터**: 키 이름이 `email`·`birth*`·`dob`·`phone*`·`name`·`nickname`·`address`·`gender`·`year`·`month`·`day`·`hour`·`minute`·`password`·`token` 인 값, 이메일처럼 보이는 값, 날짜(`YYYY-MM-DD`, `YYYYMMDD`)처럼 보이는 값은 버립니다. `page_location` 에는 `utm_*`·`gclid`·`gbraid`·`wbraid`·`fbclid` 만 남기고 나머지 쿼리(OAuth `code`, 결제 `paymentKey` 등)와 해시는 지웁니다.
- **디버그 모드**: 개발 서버(`import.meta.env.DEV`)에서는 스크립트를 로드하지 않고, 매체별로 보낼 내용을 `console.debug('[analytics] …')` 로만 출력합니다. Chrome 콘솔 레벨을 "상세(Verbose)"로 바꿔야 보입니다.
- **운영 검증**: GA4 DebugView(Tag Assistant), Meta Pixel Helper(크롬 확장), 카카오모먼트 픽셀 이벤트 현황에서 확인합니다.

---

## 4. 개인정보 처리방침에 추가할 문구 (초안, 법무 검토 필요)

현재 처리방침(`apps/web/src/pages/MiscPages.tsx` 의 `privacy`)에는 분석·광고 도구 고지가 없습니다. 키를 넣기 **전에** 아래 내용을 추가해야 합니다.

> **행태정보의 수집·이용 및 거부 방법**
> 회사는 서비스 이용 통계 분석, 광고 성과 측정, 관심 기반 맞춤형 광고 제공을 위해 아래와 같이 행태정보를 수집·이용합니다.
> - 수집 항목: 방문 페이지·방문 일시 등 서비스 이용 기록, 회원가입·결제 완료·콘텐츠 조회 등 이용 이벤트, 쿠키 및 광고 식별자, 기기·브라우저 정보
> - 수집 방법: 이용자가 웹사이트를 방문·이용할 때 자동으로 수집
> - 행태정보를 수집·처리하는 사업자: Google LLC(Google Analytics, Google AdSense), Meta Platforms, Inc.(Meta 픽셀), 주식회사 카카오(카카오 픽셀, 카카오 애드핏)
> - 보유·이용 기간: 수집일로부터 최대 14개월(각 사업자 정책에 따름)
> - 생년월일·태어난 시각·성별·이름·이메일 등 사주 입력 정보와 계정 정보는 위 사업자에게 제공하지 않습니다.
> - 거부 방법: 브라우저 설정에서 쿠키 저장을 거부하거나 삭제할 수 있습니다(Chrome: 설정 > 개인정보 보호 및 보안 > 서드파티 쿠키, Safari: 설정 > 개인정보 보호). 맞춤형 광고는 Google 광고 설정(<https://adssettings.google.com>), Meta 광고 기본 설정에서 끌 수 있습니다. 쿠키를 거부하면 일부 기능 이용에 제한이 있을 수 있습니다.
>
> **개인정보의 국외 이전**
> Google LLC(미국), Meta Platforms, Inc.(미국)에 쿠키·온라인 식별자와 서비스 이용 기록이 서비스 이용 시점에 네트워크를 통해 전송됩니다. 목적은 이용 통계 분석과 광고 성과 측정이고, 보유 기간은 위와 같습니다. 이용자는 위 거부 방법으로 이전을 거부할 수 있습니다.
>
> **카카오톡 공유**
> 카카오톡 공유를 이용하면 공유 내용(결과 제목·요약 문구·링크)이 주식회사 카카오를 통해 전달됩니다. 생년월일과 태어난 시간은 공유되지 않습니다.

- 근거: 개인정보 보호법 제28조의8(국외 이전 고지), 방송통신위원회·행정안전부 「온라인 맞춤형 광고 개인정보보호 가이드라인」(행태정보 수집·이용 고지)
- AdSense·Meta 정책도 쿠키 사용과 제3자 광고 사업자 고지를 요구합니다(AdSense 승인 조건).

---

## 5. ads.txt

AdSense 승인 후 **루트 도메인**에 `ads.txt` 를 게시해야 수익이 제한되지 않습니다. 실제 게시자 ID 가 필요하므로 저장소에는 파일을 만들지 않고, 승인 후 아래처럼 추가합니다.

1. `apps/web/public/ads.txt` 를 만들고 다음 한 줄을 넣습니다. `ca-` 접두사를 뗀 `pub-` 부터 씁니다.

   ```
   google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0
   ```

2. 카카오 애드핏 관리 화면에서 ads.txt 문구를 안내하면 같은 파일에 줄을 추가합니다(미확인).
3. Vite 는 `public/` 을 빌드 루트로 복사하므로 `https://dalbitsaju.kr/ads.txt` 로 서빙됩니다.
   - 호스팅의 SPA 폴백(모든 경로 → `index.html`)이 `ads.txt` 를 가로채지 않는지, `text/plain` 으로 응답하는지 확인합니다.
   - `www` 와 루트 도메인을 모두 쓴다면 둘 다에서 열려야 합니다.
4. 앱(AdMob)은 스토어 등록정보의 개발자 웹사이트 루트에 `app-ads.txt` 가 필요합니다(앱팀).

---

## 6. 운영 체크리스트

- [ ] AdSense 자동 광고 꺼짐, 금지 구역(1.2)에 `AdSlot` 이 없음
- [ ] 프리미엄 계정으로 로그인했을 때 광고 미노출
- [ ] `ADS_ENABLED=false` 로 바꾸면 배포 없이 광고가 사라짐
- [ ] GA4 향상된 측정의 "방문 기록 기반 페이지 변경" 꺼짐(page_view 중복 방지)
- [ ] Meta 자동 고급 매칭 꺼짐, 도메인 인증 완료
- [ ] 카카오 디벨로퍼스 Web 플랫폼에 운영·스테이징·개발 도메인 등록
- [ ] 개인정보 처리방침에 4장 문구 반영(법무 검토)
- [ ] AdSense 승인 후 `public/ads.txt` 게시
- [ ] CSP 를 도입한다면 허용 목록에 추가할 도메인
  - script-src: `pagead2.googlesyndication.com`, `www.googletagmanager.com`, `connect.facebook.net`, `t1.daumcdn.net`, `t1.kakaocdn.net`
  - frame-src: `googleads.g.doubleclick.net`, `tpc.googlesyndication.com`, 카카오 광고 도메인
  - connect-src: `*.google-analytics.com`, `www.facebook.com`
