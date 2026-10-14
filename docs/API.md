# API 레퍼런스 (`/api/v1`)

- 인증: `Authorization: Bearer <accessToken>` (쿠키 미사용 — 웹·앱 공용)
- 오류 형식: `{ "error": { "code": "VALIDATION_ERROR|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|CONFLICT|PAYMENT_REQUIRED|INSUFFICIENT_CREDITS|NOT_CONFIGURED|PAYMENT_FAILED|RATE_LIMITED|INTERNAL_ERROR", "message": "사용자에게 보여줄 한국어 문장", "details": … } }`
- 요청 스키마·응답 타입: `packages/shared/src/index.ts` (zod / TS 타입)
- 인증 열: `-` 불필요, `opt` 선택(있으면 개인화), `✓` 필수, `admin` 관리자

## 공통
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| GET | `/health` (prefix 없음) | - | 헬스 체크 |
| GET | `/config` | - | 서버 주도 설정: 결제사·공개 키·소셜 로그인/AI/광고 활성 여부·기능 플래그 |

## 인증 · 회원
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/auth/guest` | - | 게스트 시작 `{ deviceId }` → 토큰 (같은 기기 ID 는 같은 게스트) |
| POST | `/auth/signup` | opt | 이메일 가입. 게스트 토큰을 보내면 게스트 → 회원 전환(데이터 유지) |
| POST | `/auth/login` | - | 이메일 로그인 |
| POST | `/auth/refresh` | - | 토큰 회전 `{ refreshToken }` (재사용 탐지 시 전 세션 폐기) |
| POST | `/auth/logout` | - | refresh token 폐기 |
| GET | `/auth/oauth/:provider/authorize?redirectUri&state` | - | 소셜 로그인 URL (kakao·naver·google·apple) |
| POST | `/auth/oauth/:provider/callback` | opt | `{ code, state, redirectUri?, idToken?, name? }` → 토큰 (게스트 전환 지원) |
| POST | `/auth/oauth/apple/form-post` | - | Apple form_post 수신 → 웹 콜백으로 302 |
| GET / PATCH / DELETE | `/auth/me` | ✓ | 내 정보 / 닉네임·마케팅 동의·푸시 수신 / **회원 탈퇴** |

## 프로필(저장한 사주)
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| GET | `/profiles` | ✓ | 목록(대표 우선) |
| POST | `/profiles` | ✓ | `{ name, relation, birth }` — 날짜 유효성(음력·윤달 포함) 검증 |
| GET / PATCH / DELETE | `/profiles/:id` | ✓ | 조회/수정/삭제 (소유자만) |

## 사주 · 운세 · 궁합
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/saju/chart` | opt | `{ birth }` 또는 `{ profileId }` → `SajuChart`(원국·오행·십신·신살·대운 등) |
| POST | `/saju/reading` | opt | 기본 풀이. 권한에 따라 유료 섹션 `locked` (미니: 재물·연애·직업 / 평생: 전체) |
| POST | `/saju/years?from&to` | opt | 연도별 세운 점수 |
| GET | `/saju/manse?date=YYYY-MM-DD` | - | 만세력: 년·월·일 간지, 음력, 그 해 24절기 |
| GET | `/fortune/daily?profileId&date` | ✓ | 오늘의 운세(대표 프로필 기본) |
| POST | `/fortune/daily` | - | 비회원 오늘의 운세 `{ birth, date? }` |
| GET | `/fortune/yearly?profileId&year` | ✓ | 신년운세(미구매 시 총운·첫 두 달만) |
| POST | `/compatibility` | opt | `{ profileIdA|birthA, profileIdB|birthB }` → 점수·근거(상세는 구매 시) |

## 유료 리포트 · AI 상담
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | `/reports` | ✓ | `{ type: lifetime|yearly|compatibility, profileId, partnerProfileId?, year? }` — 권한 없으면 **402 + details.productId**, 궁합 1회권 자동 사용 |
| GET | `/reports`, `/reports/:id` | ✓ | 보관함 |
| GET / POST / DELETE | `/chat?profileId` | ✓ | 상담 기록 / 질문(질문권 1회, 부족하면 402 INSUFFICIENT_CREDITS) / 기록 삭제 |

## 타로
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| GET | `/tarot/daily?profileId?` | ✓ | 오늘의 카드 — 같은 사람·같은 날(KST)은 같은 카드. 저장한 사주가 있으면 사주 결합 근거 포함, 전부 무료 |
| POST | `/tarot/shuffle` | ✓ | `{ spread: three|feelings5|reunion5, topic, question? }` → `{ deckToken(30분), deckSize: 78, existingReadingId }`. 카드 순서는 보내지 않음. 오늘 같은 질문으로 뽑은 리딩이 있으면 `existingReadingId` |
| POST | `/tarot/readings` | ✓ | `{ deckToken, picks: number[](0~77, 펼침 순서), spread, topic, question?, profileId? }` → 리딩. 같은 날 같은 질문·이미 쓴 토큰은 **409 (details.readingId)**, 장수·주제 불일치·만료 토큰은 400 |
| GET | `/tarot/readings`, `/tarot/readings/:id` | ✓ | 기록 / 리딩 — 권한(`tarot:reading:<id>` 또는 플러스)이 없으면 자리별 풀이·이야기·행동·사주 근거는 첫 문단 미리보기(`locked`) |
| DELETE | `/tarot/readings/:id` | ✓ | 기록 지우기 |

- 결제: `POST /orders { productId: tarot_question_3 | tarot_love_5, readingId }` (IAP 는 `/payments/iap/verify` 에 `readingId`). 리딩과 상품의 펼침 방식이 맞아야 하며, 지급 권한은 `tarot:reading:<readingId>` + 질문권 1회.

## 커머스
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| GET | `/products` | opt | 상품 카탈로그(현재가·할인 마감·계정당 구매 가능 여부) |
| POST | `/orders` | ✓(회원) | `{ productId, profileId?, partnerProfileId? }` → 결제창 파라미터(`CheckoutDto`) |
| GET | `/orders`, `/orders/:id` | ✓ | 주문 내역 |
| POST | `/payments/confirm` | ✓ | `{ provider, orderId, amount, paymentKey? }` 서버 승인 + 금액 검증 + 지급 (멱등) |
| POST | `/payments/fail` | ✓ | 결제창 취소/실패 기록 |
| POST | `/payments/iap/verify` | ✓(회원) | `{ platform, productId, receipt, profileId? }` 인앱결제 검증·지급 (거래 ID 멱등) |
| POST | `/payments/webhooks/:provider` | - | toss·portone·mock 웹훅 (원문 서명 검증, 이벤트 멱등) |
| GET | `/wallet` | ✓ | 질문권(유상/무상)·원장·보유 권한 |
| POST | `/admin/orders/:id/refund` | admin | 환불: 결제사 취소 + 권한·질문권 회수 |
| POST | `/admin/users/:id/credits` | admin | 무상 질문권 지급 |

## 보상형 광고 (앱)
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| GET | `/rewards/admob-ssv` | - (Google 서명) | AdMob 서버 측 확인 콜백 → 서명 검증 후 무상 질문권 지급 (거래 ID 멱등, 하루 한도) |
| GET | `/rewards/status` | ✓ | 오늘 남은 보상 횟수 |

## 푸시
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST / DELETE | `/push/tokens` | ✓ | FCM 토큰 등록/해제 `{ token, platform: web|ios|android }` |
