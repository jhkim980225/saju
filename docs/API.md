# API 레퍼런스 (`/api/v1`)

- 인증: `Authorization: Bearer <accessToken>` (쿠키 미사용 — 웹·앱 공용)
- 오류 형식: `{ "error": { "code": "VALIDATION_ERROR|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|CONFLICT|PAYMENT_REQUIRED|INSUFFICIENT_CREDITS|NOT_CONFIGURED|PAYMENT_FAILED|RATE_LIMITED|INTERNAL_ERROR", "message": "사용자에게 보여줄 한국어 문장", "details": … } }`
- 요청 스키마·응답 타입: `packages/shared/src/index.ts` (zod / TS 타입)
- 인증 열: `-` 불필요, `opt` 선택(있으면 개인화), `✓` 필수, `admin` 관리자

## 공통
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| GET | `/health` (prefix 없음) | - | 헬스 체크 |
| GET | `/config` | - | 서버 주도 설정: 결제사·공개 키·소셜 로그인/AI/광고 활성 여부·기능 플래그. `ai.creditCost` 는 AI 상담·꿈풀이 한 번에 쓰는 질문권 수(`AI_CHAT_CREDIT_COST`). `supportEmail` 은 문의처(`SUPPORT_EMAIL`), `notices` 는 서비스 공지 `[{ id, title, body }]`(`SERVICE_NOTICES`, 없으면 빈 배열) |

## 인증 · 회원
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/auth/guest` | - | 게스트 시작 `{ deviceId }` → 토큰 (같은 기기 ID 는 같은 게스트). 요청 수 제한은 세션 제한(IP 60초 60회) |
| POST | `/auth/signup` | opt | 이메일 가입. 게스트 토큰을 보내면 게스트 → 회원 전환(데이터 유지) |
| POST | `/auth/login` | - | 이메일 로그인 |
| POST | `/auth/refresh` | - | 토큰 회전 `{ refreshToken }` (재사용 탐지 시 전 세션 폐기). 요청 수 제한은 세션 제한(IP 60초 60회) |
| POST | `/auth/logout` | - | refresh token 폐기 |
| POST | `/auth/password/forgot` | - | 재설정 메일 요청 `{ email }` → 가입 여부와 관계없이 `{ ok }` (메일 미설정이면 501). 링크 30분 유효, 이전 링크 무효화 |
| POST | `/auth/password/reset` | - | 메일 링크 토큰으로 새 비밀번호 `{ token, password }` → 그 사용자의 refresh token 전부 폐기. 만료·사용됨은 400 |
| POST | `/auth/password/change` | ✓ | `{ currentPassword, newPassword }` → `{ ok, accessToken, refreshToken, … }` (이메일 계정만. 다른 기기의 로그인은 모두 끊기고 지금 기기는 응답의 새 토큰으로 이어간다) |
| GET | `/auth/oauth/:provider/authorize?redirectUri&state` | - | 소셜 로그인 URL (kakao·naver·google·apple) |
| POST | `/auth/oauth/:provider/callback` | opt | `{ code, state, redirectUri?, idToken?, name? }` → 토큰 + `isNewUser`(이번에 처음 가입했으면 true, 게스트 전환 포함. 웹의 가입 전환 집계용) (게스트 전환 지원) |
| POST | `/auth/oauth/apple/form-post` | - | Apple form_post 수신 → 웹 콜백으로 302 |
| GET / PATCH / DELETE | `/auth/me` | ✓ | 내 정보 / 닉네임·마케팅 동의·푸시 수신 / **회원 탈퇴** |

## 프로필(저장한 사주)
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| GET | `/profiles` | ✓ | 목록(대표 우선) |
| POST | `/profiles` | ✓ | `{ name, relation?, birth, cityName?, isPrimary? }` — 날짜 유효성(음력·윤달 포함) 검증. `relation` 기본값 `self`. 관계가 `self` 이거나 첫 사주면 대표가 된다. 계정당 50개(동시 요청에도 넘지 않음, 넘으면 400) |
| GET / PATCH / DELETE | `/profiles/:id` | ✓ | 조회/수정/삭제 (소유자만). PATCH 는 보낸 필드만 바꾼다(기본값 없음). 구매한 리포트·택일 상세가 묶인 사주의 출생 정보 변경은 409. 대표를 끄거나(`isPrimary: false`) 지우면 남은 사주(관계 `self` 우선)를 대표로 올린다. DELETE 는 지우기 전에 이 사주로 산 리포트 중 아직 없는 것을 만들어 보관함에 남긴다 |

## 사주 · 운세 · 궁합
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/saju/chart` | opt | `{ birth }` 또는 `{ profileId }` → `SajuChart`(원국·오행·십신·신살·대운 등) |
| POST | `/saju/reading` | opt | 기본 풀이. 권한에 따라 유료 섹션 `locked` (미니: 재물·연애·직업 / 평생: 전체) |
| POST | `/saju/years?from&to` | opt | 연도별 세운 점수. 기본 범위는 올해(KST) −2 ~ +7, 최대 30년 |
| GET | `/saju/manse?date=YYYY-MM-DD` | - | 만세력: 년·월·일 간지, 음력, 그 해 24절기 |
| GET | `/fortune/daily?profileId&date` | ✓ | 오늘의 운세(대표 프로필 기본) |
| POST | `/fortune/daily` | - | 비회원 오늘의 운세 `{ birth, date?, name? }` — `name` 이 있으면 "서윤님," 하고 부른다 |
| GET | `/fortune/yearly?profileId&year` | ✓ | 신년운세(미구매 시 총운·첫 두 달만) |
| POST | `/compatibility` | opt | `{ profileIdA|birthA, profileIdB|birthB }` → 점수·근거(상세는 구매 시). 같은 프로필 ID 두 번은 400 |

## 유료 리포트 · AI 상담
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/reports` | ✓ | `{ type: lifetime|yearly|compatibility|love|career_wealth, profileId, partnerProfileId?, year? }` — 권한 없으면 **402 + details.productId**(`love` → `report_love`, `career_wealth` → `report_career_wealth`), 궁합 1회권 자동 사용(이미 열린 조합은 차감 없음). `yearly` 에서 상품이 없는 연도는 402 대신 400. `love`·`career_wealth` 는 프로필 하나에 대한 주제별 리포트로, 권한 키는 `report:love:<profileId>`·`report:career_wealth:<profileId>`(산 프로필만 열림). 규칙 기반 본문을 바로 돌려주고, AI 가 설정돼 있으면 `status: 'polishing'` + `progress: { done, total }`(덩어리 수)로 뒤에서 다듬는다. 같은 조건은 저장본(결제 직후 미리 만든 것 포함)을 돌려준다. 궁합은 두 사람 순서와 무관하게 같은 저장본이다. 만든 때와 지금의 기준 연도가 다르거나 프로필 이름이 바뀌었으면 같은 ID 로 새 본문을 만든다(신년운세는 연도만 고정이라 이름이 바뀐 경우만) |
| GET | `/reports`, `/reports/:id` | ✓ | 보관함. 리포트는 결제 확정(웹 승인·인앱결제·웹훅) 직후 자동으로 만들어진다(궁합 1회권·미니 리포트 제외 — 연애·결혼운·재물·직업운 포함). 환불되면 목록에서 빠지고 `/reports/:id` 는 402. `/reports/:id` 도 저장본이 낡았으면 새 본문으로 바꿔 돌려준다(`createdAt` 이 바뀐다) |
| GET | `/reports/:id/progress` | ✓ | `{ status: polishing|ready, progress: { done, total } | null }` — 다듬는 동안 본문 없이 폴링(화면은 2초 간격). ready 가 되면 `/reports/:id` 를 다시 받는다 |
| GET / POST / DELETE | `/chat?profileId` | ✓ | 상담 기록 / 질문 `{ profileId, message, requestId? }`(질문권 1회, 부족하면 402 INSUFFICIENT_CREDITS. 같은 `requestId` 는 한 번만 차감하고 처음 답을 돌려줌, 처리 중이면 409. AI 가 서비스 쪽 장애·문체 검사 탈락으로 답하지 못하면 차감한 몫 그대로 환급, 하루 5번까지) / 그 프로필의 대화 모두 삭제(화면의 '대화 지우기'). 프로필을 지우면 그 프로필의 대화도 지운다 |

## 타로
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| GET | `/tarot/daily?profileId?` | ✓ | 오늘의 카드 — 같은 사람·같은 날(KST)은 같은 카드. 저장한 사주가 있으면 사주 결합 근거 포함, 전부 무료. `profileId` 를 주면 이미 저장된 오늘의 카드도 그 프로필로 사주 결합을 바꾼다(카드는 그대로) |
| POST | `/tarot/shuffle` | ✓ | `{ spread: three|feelings5|reunion5|yesno|choice|compat|celtic, topic, question?, optionA?, optionB?, partnerProfileId? }` → `{ deckToken(30분), deckSize: 78, existingReadingId }`. 카드 순서는 보내지 않음. 오늘 같은 질문으로 뽑은 리딩이 있으면 `existingReadingId` |
| POST | `/tarot/readings` | ✓ | `{ deckToken, picks: number[](0~77, 펼침 순서), spread, topic, question?, profileId?, optionA?, optionB?, partnerProfileId? }` → 리딩. 같은 날 같은 질문·이미 쓴 토큰은 **409 (details.readingId)**, 오늘 뽑고 지운 질문은 409 `details.reason='DELETED_TODAY'`, 장수·주제 불일치·만료 토큰·예·아니오 빈 질문은 400 |
| GET | `/tarot/readings`, `/tarot/readings/:id` | ✓ | 기록(최근 100개 + 그보다 오래된 구매 리딩) / 리딩 — 권한(`tarot:reading:<id>` 또는 플러스)이 없으면 자리별 풀이·이야기·행동·사주 근거는 첫 문단 미리보기(`locked`)이고 최상위 `basis` 는 `null`. 사주 근거는 뽑을 때 저장한 프로필로만 만든다 |
| DELETE | `/tarot/readings/:id` | ✓ | 기록 지우기. 오늘 뽑은 리딩(오늘의 카드 제외)은 내용만 비운 표지로 남겨 예·아니오 하루 횟수와 같은 질문 판정에 계속 들어간다 |

- 결제: `POST /orders { productId: tarot_question_3 | tarot_love_5 | tarot_choice_3 | tarot_compat_5 | tarot_celtic_10, readingId }` (IAP 는 `/payments/iap/verify` 에 `readingId`). 리딩과 상품의 펼침 방식이 맞아야 하며, 지급 권한은 `tarot:reading:<readingId>` + 질문권(켈틱 크로스 3회, 나머지 1회).

### 2차 펼침 방식 (예·아니오 · 양자택일 · 궁합 타로 · 켈틱 크로스)
`/tarot/shuffle`·`/tarot/readings` 를 그대로 쓰고, `spread` 와 `topic` 을 같은 이름으로 보낸다(펼침 방식이 곧 주제).

| spread / topic | 장수 · 자리 | 추가 입력 | 무료 범위 | 깊은 풀이 상품 |
|---|---|---|---|---|
| `yesno` | 1 · 기울기 | `question` 필수(화면에서) | 전부 무료, **KST 하루 1회**(`TAROT_YESNO_DAILY_FREE`) | 없음 |
| `choice` | 3 · 지금의 나 / A를 고르면 / B를 고르면 | `optionA`·`optionB` 필수(각 1~20자, 서로 달라야 함) | 카드·총평 첫 문단·'지금의 나' 자리 | `tarot_choice_3` 990원 (질문권 1회) |
| `compat` | 5 · 나의 마음 / 상대의 마음 / 서로 끌리는 점 / 조율할 점 / 함께 챙길 것 | `partnerProfileId` 필수(내 프로필, 나와 다른 사람). `profileId`(나)가 없으면 대표 프로필 | 카드·총평 첫 문단·'나의 마음' 자리 | `tarot_compat_5` 2,900원 (질문권 1회) |
| `celtic` | 10 · 지금 상황 / 가로막는 것 / 바탕 / 지나가는 것 / 바라는 것 / 다가오는 것 / 나의 태도 / 주변 / 바람과 걱정 / 흐름의 방향 | — | 카드·총평 첫 문단 (자리 풀이는 모두 깊은 풀이) | `tarot_celtic_10` 4,900원 (질문권 3회) |

- 같은 질문 판정 키에 양자택일은 선택지 A·B, 궁합 타로는 상대 프로필까지 넣는다(같은 질문이라도 선택지·상대가 다르면 새로 뽑는다).
- 예·아니오: 오늘 같은 질문이면 횟수와 상관없이 `existingReadingId` 로 안내하고, 새 질문인데 무료 횟수를 다 썼으면 셔플·뽑기 모두 **429 `RATE_LIMITED` (details: `{ readingId: 오늘 본 리딩, limit }`)**.
- 응답(`TarotReadingDto`) 추가 필드: `lean`(예·아니오 기울기 `yes|maybe|no`, 그 외 null), `options`(`{ a, b }`), `partnerName`. 궁합 타로의 사주 근거는 두 사람의 일간·용신으로 읽는다(`basis`: `근거: 민수 일간 庚金·용신 木 · 지은 일간 戊土·용신 火 · 카드 원소 …`).
- 양자택일은 어느 한쪽을 정답으로 표시하지 않는다 — 한 줄은 '지금의 나' 카드, 행동은 지금의 나·A·B 에서 하나씩, 사주 근거의 용신 비교도 '지금의 나' 카드로 한다.
- AI 이야기 문단(`ANTHROPIC_MODEL_PREMIUM`)은 유료 펼침에서만 만든다. 예·아니오는 규칙 기반만.

#### 예·아니오 기울기 표
기울기는 카드와 방향만으로 정한다(사주·질문은 바꾸지 않는다). 원본은 카드 문안의 `yesNo` 값(`apps/api/src/modules/tarot/content/*`, `yesno.ts`)이고, `apps/api/test/tarot.test.ts` 가 이 표와 문안이 같은지 확인한다. maybe 는 화면에서 '조건부'로 보여 주고 카드의 조언을 조건으로 붙인다.

| 기울기 | 정방향 (78장) | 역방향 (78장) |
|---|---|---|
| 예 `yes` | 아래 두 줄에 없는 51장 | 완드 5 · 컵 4 · 컵 7 · 소드 8 (4장 — 막힘이 풀리는 카드) |
| 조건부 `maybe` | 여사제 · 은둔자 · 정의 · 매달린 사람 · 죽음 · 달 · 완드 5 · 완드 10 · 컵 4 · 컵 7 · 소드 2 · 소드 4 · 소드 페이지 · 펜타클 2 · 펜타클 4 · 펜타클 7 (16장) | 위·아래 줄에 없는 51장 |
| 아니오 `no` | 악마 · 탑 · 컵 5 · 컵 8 · 소드 3 · 소드 5 · 소드 7 · 소드 8 · 소드 9 · 소드 10 · 펜타클 5 (11장) | 바보 · 마법사 · 여사제 · 황제 · 연인 · 전차 · 은둔자 · 운명의 수레바퀴 · 정의 · 매달린 사람 · 죽음 · 완드 7 · 완드 나이트 · 컵 에이스 · 소드 에이스 · 소드 페이지 · 소드 나이트 · 소드 퀸 · 소드 킹 · 펜타클 2 · 펜타클 7 · 펜타클 나이트 · 펜타클 킹 (23장) |

역방향 35%(`deck.ts`)를 반영한 실제 비율은 대략 예 44% · 조건부 36% · 아니오 20%.

## 꿈해몽
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/dream/interpret` | ✓ | AI 꿈풀이 `{ text(5~500자), profileId?, withoutSaju?, requestId? }` — `requestId`(영문·숫자·`-_` 8~64자, 보낼 때마다 새로)가 같은 요청은 한 번만 차감하고, 두 번째 요청에는 같은 꿈 이야기로 엮은 기본 풀이를 돌려준다(처음 풀이는 저장하지 않음, 처리 중이면 409) → `DreamInterpretationDto { symbols, headline, paragraphs, generator: ai|rule, creditsCharged, creditsLeft, profileName, crisis, notice, disclaimer }`. 꿈 이야기에서 사전 상징을 찾아(규칙 기반 근거) AI(`ANTHROPIC_MODEL`)가 풀이. **AI 연동 시 질문권 1회**(AI 상담과 같은 `AI_CHAT_CREDIT_COST`, 부족하면 402 INSUFFICIENT_CREDITS), AI 실패 시 기본 풀이 — 서비스 쪽 장애·문체 검사 탈락이면 차감한 몫 그대로 환급(유상분은 유상으로, 하루 5번까지), 거절이면 차감 유지(`creditsCharged` 에 반영). **AI 미설정이면 사전 해석을 엮은 기본 풀이, 차감 없음.** 사주는 지정 프로필 → 대표 프로필 순(AI 풀이에만 사용), 남의 프로필은 400. 꿈 이야기는 저장하지 않음 |

- 사전(337항목·검색·분류)은 API 가 아니라 `@saju/shared/dream`(`packages/shared/src/dream/`)을 웹이 직접 번들한다 — 웹 `/dream`, `/dream/:slug`(별칭 주소는 대표 키워드로 이동), `/dream/ask`. 계약 타입도 같은 곳에 있다.

## 띠별 · 별자리 운세 (무료 공개 콘텐츠)
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| GET | `/zodiac?period&date` | - | 12띠 한 줄 요약 `ZodiacOverviewDto` (띠·흐름·제목·근거 한 줄, 이번 주는 좋은 날·살필 날 요일) |
| GET | `/zodiac/:animal?period&date` | - | 띠 하나 `ZodiacFortuneDto` — `animal`: `rat ox tiger rabbit dragon snake horse sheep monkey rooster dog pig` |
| GET | `/horoscope?period&date` | - | 12별자리 한 줄 요약 `HoroscopeOverviewDto`. 별자리는 `date` 가 1900~2049년이어야 한다(행성 궤도 근사 범위, 밖이면 400). 띠는 1900~2100년. `date` 없이 부르면 KST 오늘로 계산하고 캐시를 KST 자정 너머로 주지 않는다 |
| GET | `/horoscope/:sign?period&date` | - | 별자리 하나 `HoroscopeDto` — `sign`: `aries taurus gemini cancer leo virgo libra scorpio sagittarius capricorn aquarius pisces` |

- `period`: `today`(기본) · `tomorrow` · `week`(그 날이 속한 월~일) · `month` · `year`. `date`: `YYYY-MM-DD`(KST, 기본 오늘, 1900~2100). 잘못된 값은 400, 없는 띠·별자리는 404.
- 개인 정보를 받지 않고 같은 입력이면 같은 응답이라 `Cache-Control: public, max-age=600`.
- 띠: `pillar`(오늘·내일 일진 / 이번 달 월건 / 올해 세운, 이번 주는 `null`), `reasons`(관계와 오행 작용 근거), `keyDays`(이번 주 좋은 날·살필 날), `lucky`, `years`(7~90세 년생별 한 줄 + 근거), `range`(이번 달은 절기 달, 올해는 입춘~입춘), `basisNote`(입춘 기준 안내).
- 별자리: `sky`(달·태양·목성·토성이 지나는 별자리, 내 별자리에서 몇 번째 자리·각, 근거 문장), `keyDays`(이번 주), `range`(이번 달은 태양이 지금 별자리에 머무는 기간, 올해는 그 해 1~12월), `basisNote`(계산 방법·오차).
- 계산 방법: [`SAJU_ENGINE.md`](SAJU_ENGINE.md) §7. 생일 → 별자리는 `@saju/shared` 의 `starSignOfBirthday(month, day)` (날짜표, 경계일 `isCusp`).

## 커머스
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| GET | `/products` | opt | 상품 카탈로그(판매가·계정당 구매 가능 여부. 가격은 고정이라 `listPrice`·`saleEndsAt` 은 모든 상품에서 `null`) |
| POST | `/orders` | ✓(회원) | `{ productId, profileId?, partnerProfileId?, readingId?, resumeOrderId? }` → 결제창 파라미터(`CheckoutDto`). 409 `details.reason`: `PAYMENT_IN_PROGRESS`(같은 상품·대상의 결제를 30분 안에 시작함, `orderId` 를 `resumeOrderId` 로 보내면 같은 주문의 결제창), `ALREADY_OWNED`(이미 가진 리포트·풀이), `ALREADY_PAID`(이어서 결제하려던 주문이 결제 확인됨). 결제창 링크형 결제사(그로블)만 진행 중 확인을 한다 |
| GET | `/orders`, `/orders/:id` | ✓ | 주문 내역. 그로블 미결 주문을 `/orders/:id` 로 조회하면 첫 조회 시각을 남기고, 20초 넘게 지나 다시 조회하면 결제 확인 대기 표시(`awaitingAt`)를 남긴다(결제 확인 지연 알림 대상) |
| POST | `/payments/confirm` | ✓ | `{ provider, orderId, amount, paymentKey? }` 서버 승인 + 금액 검증 + 지급 (멱등). 계정당 한도 초과는 409 `PER_USER_LIMIT`(결제사 취소에 성공하면 주문 `canceled`, 실패하면 `failed` + 운영 알림) |
| POST | `/payments/fail` | ✓ | `{ orderId, code?, message? }` 결제창 취소/실패 기록(미결 주문만 `failed`). 그로블 결제 확인 화면의 '결제하지 않고 돌아가기'도 `code: USER_CANCEL` 로 부른다. 그 뒤 결제 알림이 오면 그대로 지급된다 |
| POST | `/payments/iap/check` | ✓(회원) | `{ platform, productId, profileId?, readingId? }` → `{ ok: true }`. 스토어 결제창을 띄우기 전 확인. 판매 중지·출시 예정 409 `NOT_FOR_SALE`, 한도 초과 409 `PER_USER_LIMIT`, 이미 가진 콘텐츠 409 `ALREADY_OWNED`, 대상 오류 400 |
| POST | `/payments/iap/verify` | ✓(회원) | `{ platform, productId, receipt, profileId?, readingId? }` 인앱결제 검증·지급 (거래 ID 멱등, 같은 거래는 같은 답). 리포트 상품에 `profileId` 가 없으면 대표 프로필로 채운다. 지급 거절은 409(`NOT_FOR_SALE`·`PER_USER_LIMIT`·`ALREADY_OWNED`) 또는 402(`REVOKED`)이고 `details: { reason, finish }` 의 `finish` 가 true 면 앱이 지급 없이 스토어 거래를 끝낸다(iOS·환불된 거래), false 면 거래를 그대로 둔다(Android 자동 환불) |
| POST | `/payments/webhooks/:provider` | - | groble·toss·portone·mock 웹훅 (원문 서명 검증, 이벤트 멱등). groble: `X-Groble-Signature`(HMAC-SHA256 `"{timestamp}.{body}"`)·±5분, `payment.completed` → ref(주문 ID)·결제창·금액 대조 후 지급, `payment.refunded`(전액) → merchantUid 로 찾아 회수(완료 알림보다 먼저 오면 결제 키를 무효로 표시해, 뒤에 온 완료 알림은 지급 없이 주문을 `refunded` 로 닫음), 그 밖은 기록. 서명 실패 400 |
| POST | `/payments/iap/notifications/apple` | - (Apple 서명) | App Store Server Notifications V2 `{ signedPayload }` — x5c 체인을 Apple Root CA - G3 까지 검증, `REFUND`·`REVOKE` → 지급분 회수, `REFUND_REVERSED` → 복구, 그 밖은 기록. notificationUUID 멱등. 위조 400, 키 없으면 501 |
| POST | `/payments/iap/notifications/google` | - (Pub/Sub OIDC) | Google Play RTDN Pub/Sub 푸시 — `Authorization: Bearer` OIDC 토큰 검증(audience·서비스 계정), `voidedPurchaseNotification` → 지급분 회수, 그 밖은 기록. messageId 멱등. 인증 실패 401, 키 없으면 501 |
| GET | `/wallet` | ✓ | 질문권(유상/무상)·원장·보유 권한 |
| POST | `/admin/orders/:id/refund` | admin | 환불: 결제사 취소 + 권한·질문권 회수(같은 권한을 주는 다른 유효 주문이 있으면 그 권한은 남긴다) |
| POST | `/admin/users/:id/credits` | admin | 무상 질문권 지급 |

## 보상형 광고 (앱)
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| GET | `/rewards/admob-ssv` | - (Google 서명) | AdMob 서버 측 확인 콜백 → 서명 검증 후 무상 질문권 지급 (거래 ID 멱등, 하루 한도). IP 요청 수 제한에서 뺀다. `custom_data` 는 읽지 않는다 |
| GET | `/rewards/status` | ✓ | 오늘 남은 보상 횟수 |

## 토스 미니앱 (보류: 웹 출시 뒤)
토스 빌드(`apps/web` build:toss)만 쓴다. 웹·앱 화면은 호출하지 않는다. 연동 키·mTLS 인증서가 없으면 꺼져 있다.

| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/auth/toss` | 선택 | 토스 로그인 인가 코드로 가입·로그인. 게스트로 쓰던 데이터는 계정으로 옮긴다 |
| GET | `/payments/iap/toss/products` | - | 토스 인앱결제로 파는 상품(연결된 SKU 만) |
| POST | `/payments/iap/toss/orders` | ✓ | 토스 인앱결제 주문 만들기 |
| POST | `/payments/iap/verify` | ✓ | `platform: 'toss'` 이면 토스 주문 검증 후 지급 |
| POST | `/rewards/toss/start`, `/rewards/toss/claim` | ✓ | 토스 보상형 광고 시작·지급. `{ kind: 'unlock', slot: 'tomorrow_fortune' }` 만 받는다. `kind: 'credit'`(질문권)은 부르는 화면이 없어 꺼져 있어 **403** `FORBIDDEN`(`details.reason: 'CREDIT_REWARD_OFF'`). 같은 날 이미 열었으면 `start` 가 **409**(`details.reason: 'DAILY_LIMIT'`) |

## 푸시
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST / DELETE | `/push/tokens` | ✓ | FCM 토큰 등록/해제 `{ token, platform: web|ios|android }` |

## 토정비결 (무료)
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/tojeong` | opt | `{ birth?: { calendar, year, month, day, isLeapMonth? }, profileId?, year? }` → `TojeongDto`. 비회원은 `birth`(양력·음력 생년월일만, 시각·성별 불필요 — 저장한 `BirthInputDto` 를 그대로 보내도 됨), 세션이 있으면 저장한 사주 `profileId`(남의 프로필 404, 세션 없이 401). `year` 기본은 KST 10월부터 다음 해(`tojeongDefaultYear`, 1900~2049). 대상 연도 탓(범위 밖·태어난 해보다 앞선 해)의 400 은 `details: { field: 'year', defaultYear }`. 응답: 괘(번호·상중하·괘사 원문·독음·제목·요약·키워드), 총평 2문단, 음력 1~12월(양력 기간·`flow: rise|even|care`·문장), 작괘 근거(`basis`: 음력 생일·세는나이·태세수/월건수/일진수와 합, 보정 메모), 공유 문구. 없는 음력 날짜·윤달, 태어난 해보다 앞선 대상 연도는 400 |

- 계산: `@saju/core` `computeTojeong` — 규칙은 [`SAJU_ENGINE.md`](./SAJU_ENGINE.md)「토정비결 작괘」. 원고: `apps/api/src/modules/tojeong/content/gwae1.ts`~`gwae8.ts`(144괘, AI 미사용 → 키 없이 동작).

## 택일
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/taekil` | ✓ | `{ profileId, purpose: move|contract|exam|wedding|opening|travel, from, to }`(기간, 최대 92일) 또는 `{ ..., dates: string[] }`(후보 2~10개), 결혼만 `partnerProfileId?`. 날짜는 `YYYY-MM-DD`(KST), 오늘~2년 안. → **201** `TaekilResultDto`(무료 미리보기). 같은 입력(목적·사람과 그 출생 정보·방식·날짜)은 저장본을 돌려주고, 프로필의 출생 정보를 고친 뒤에는 새로 계산한다. 새로 만드는 것은 사용자마다 하루(KST) 30건까지 — 넘으면 **429** `RATE_LIMITED`(`details.limit`) |
| GET | `/taekil` | ✓ | 내 택일 목록(`TaekilSummaryDto[]`, `locked` 포함, 최근 100건 + 그보다 오래된 구매 결과) — 보관함은 `locked=false` 만 보여 준다 |
| GET | `/taekil/:id` | ✓ | 결과. 권한(`taekil:reading:<id>` 또는 플러스)이 없으면 `locked: true` |

- 무료(`locked: true`): 날짜마다 `grade`·`gradeLabel`·`rank`, `top`(추천 Top 3 날짜), `counts`, `headline`, `basis`. 날짜의 `score`·`officer`·`tianShen`·`summary`·`reasons`·`dropReason`·`goodHours` 는 `null`, 섹션 4개(`taekil_overview`·`taekil_advice`·`taekil_turn`·`taekil_dropped`)는 `locked` + 소개(종합 분석만 첫 문단)
- 상세: 위 필드 전부 + 섹션 본문. AI 키가 있으면 종합 분석·조언·'날짜를 바꿀 수 없을 때'만 한 번 다듬어 저장(`generator: 'ai'`), 날짜별 근거는 규칙 계산 그대로
- 결제: `POST /orders { productId: report_taekil, readingId: <택일 결과 ID> }` (IAP 는 `/payments/iap/verify` 에 `readingId`). `readingId` 가 없으면 400, 내 택일 결과가 아니면 404. 지급 권한은 `taekil:reading:<readingId>` — **그 결과 하나만** 열린다
- 저장: 마이그레이션 없이 `reports` 테이블에 `type='taekil'` 로 둔다(계산 결과를 그대로 저장해 엔진이 바뀌어도 산 결과는 그대로). `/reports` 목록·조회에는 나오지 않는다
- 계산 규칙과 근거: `docs/SAJU_ENGINE.md` §8
