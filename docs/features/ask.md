# AI 상담 · 질문권 사용

> 기준일: 2026-11-26. 질문권 상품·원장·환불은 [payments.md](./payments.md)에서 다룬다. 이 문서는 질문권을 **쓰는** 규칙만 다룬다.

## 목적

저장한 사주(프로필)의 계산 결과를 근거로 AI 상담가가 사용자의 질문에 답한다. 질문 1개에 질문권 1회를 쓴다. 같은 질문권을 AI 꿈풀이([dream.md](./dream.md))에서도 쓰므로, 차감·환급 규칙은 이 문서가 두 기능의 기준이다.

운영 상태는 **운영 중**(AI 켜짐)이다. 질문권이 한 번 묻는 데 드는 수보다 적을 때 보이는 보상형 광고 카드는 **앱 전용**이다.

## 사용자 흐름

1. 하단 탭 '물어보기'(`/ask`)로 들어온다. 위쪽 전환(`AskSegment`)으로 타로(`/tarot`)와 오간다.
2. 저장한 프로필이 있어야 쓸 수 있다. 프로필 칩으로 상담 대상을 바꾸고, 대화는 프로필마다 따로 쌓인다. 처음 고르는 프로필은 마지막으로 쓴 프로필(`activeProfile`) → 대표 프로필 → 첫 프로필 순서다.
3. 추천 질문 칩을 누르거나 직접 질문(최대 500자)을 보낸다.
4. 질문권이 모자라면 서버가 402 `INSUFFICIENT_CREDITS` 를 주고, 화면은 질문권 결제 시트(`chat_pack_30`, `chat_pack_10`)를 연다.
5. 앱에서는 질문권이 한 번 묻는 데 드는 수(`GET /config` 의 `ai.creditCost`, 서버 `AI_CHAT_CREDIT_COST`)보다 적으면 보상형 광고 카드가 보인다. 광고를 끝까지 보면 서버 콜백을 거쳐 무상 질문권 1회가 들어온다.
6. 마지막 사용자 질문에 자해·자살을 암시하는 말이 있으면 화면이 자살예방상담전화 109 안내를 띄운다. 판정 기준은 꿈풀이·타로 질문과 같은 공용 패턴(`CRISIS_PATTERN`)이다.
7. 대화가 있으면 아래쪽 '대화 지우기'로 지금 고른 프로필과 나눈 대화를 모두 지울 수 있다. 확인 시트를 거쳐 `DELETE /chat` 을 부른다. 이미 쓴 질문권은 돌아오지 않는다.

## 관련 파일

| 구분 | 경로 |
|---|---|
| 라우트·서비스 | `apps/api/src/modules/chat/routes.ts`, `apps/api/src/modules/chat/service.ts`(`chartSummary`, `ruleBasedAnswer`, `createChatService`) |
| AI 호출 | `apps/api/src/modules/ai/service.ts`(`CHAT_SYSTEM`, `chat`, `AiFailure`, `isRefundableAiFailure`) |
| AI 출력 문체 검사 | `apps/api/src/modules/ai/plainOutput.ts`(`cleanAiText`, `cleanAiParagraphs`) |
| 위기 표현 | `packages/shared/src/crisis.ts`(`CRISIS_PATTERN`, `CRISIS_LINE`) |
| 질문권 차감·환급 | `apps/api/src/modules/commerce/service.ts`(`consumeCredits`, `refundAiFailure`, `AI_REFUND_DAILY_LIMIT`) |
| 같은 요청 한 번만 처리 | `apps/api/src/lib/requestClaim.ts` |
| 보상형 광고 | `apps/api/src/modules/rewards/routes.ts`, `apps/api/src/modules/rewards/service.ts`, `apps/web/src/components/RewardedAdCard.tsx` |
| 요청 스키마 | `packages/shared/src/index.ts`(`chatSendSchema`, `requestIdSchema`) |
| 화면 | `apps/web/src/pages/AskPage.tsx`, `apps/web/src/components/AskSegment.tsx`, `apps/web/src/components/PaywallSheet.tsx`, `apps/web/src/lib/api.ts`(`chatClear`) |
| 테스트 | `apps/api/test/ai-failure.test.ts`, `apps/api/test/ai-chat-dream-fixes.test.ts`, `apps/api/test/idempotency.test.ts`, `apps/api/test/rewards.test.ts`, `e2e/ask.spec.ts` |

## API / 데이터 모델

- `GET /chat?profileId`, `POST /chat`, `DELETE /chat?profileId`(모두 인증 필요, 게스트 토큰 허용), `GET /wallet`. 요청·응답 형식은 [API.md 「유료 리포트 · AI 상담」](../API.md)을 본다. `DELETE /chat` 은 화면의 '대화 지우기'가 부른다.
- 보상형 광고: `GET /rewards/admob-ssv`(Google 서명), `GET /rewards/status`. [API.md 「보상형 광고 (앱)」](../API.md).
- 대화는 `chat_messages` 에 사용자 질문과 답을 한 줄씩 저장한다. 프로필 ID 에는 외래 키가 없으므로, 프로필을 지울 때 `profiles/service.ts` 의 `remove` 가 그 프로필의 대화를 같은 묶음에서 지운다.
- 질문권 원장(`credit_ledger`)의 차감 줄은 `ref_type` 으로 쓴 곳을 구분한다. 상담은 `chat`, 꿈풀이는 `dream` 이고 `ref_id` 는 질문(또는 꿈풀이) ID 다.
- `requestId` 를 보내면 `webhook_events` 에 `chat:<사용자 ID>:<요청 ID>` 행을 먼저 넣고, 처리가 끝나면 답변 ID 와 생성 방식만 적어 둔다.
- 질문권 잔액은 `users.credits`(합계)·`users.paidCredits`(유상분)와 원장 `credit_ledger` 로 관리한다. 구조는 [payments.md](./payments.md)와 [../architecture.md](../architecture.md)를 본다.

## 비즈니스 규칙 & 엣지케이스

### 질문권 차감

- 차감량은 `AI_CHAT_CREDIT_COST`(기본 1)다. AI 가 켜져 있고(`ANTHROPIC_API_KEY` 있음) 차감량이 0보다 클 때만 차감한다.
- **AI 를 부르기 전에 먼저 차감한다.** 동시 요청을 여러 개 보내 잔액보다 많은 AI 호출을 만드는 것을 막기 위해서다.
- **무상분부터 차감한다.** 유상분은 환불 대상이므로 최대한 남긴다. 무상분과 유상분이 한 질문에 섞여 쓰이면 원장에 두 줄로 남는다. 동시 차감으로 몫이 바뀌면 묶음 실행이 취소되고 다시 계산한다(모자라면 402).
- 질문권은 상품으로 산다: `chat_pack_10` 3,900원(10회), `chat_pack_30` 9,900원(30회). 평생 사주분석서(3회)·신년 패키지(10회)·유료 타로(1회 또는 3회)에도 딸려 온다. 가격과 지급은 [payments.md](./payments.md).
- 기준일 설정에서는 가입 보너스(`SIGNUP_BONUS_CREDITS`)가 0이라 게스트와 새 회원 모두 질문권 0으로 시작한다.

### AI 호출과 실패 처리

- 모델은 `ANTHROPIC_MODEL`(기본 `claude-haiku-5-5`)이다. 호출 하나의 제한 시간은 60초이고, SDK 가 실패한 호출을 최대 2번 다시 보낸다.
- 보내는 내용은 고정 시스템 지시문(`CHAT_SYSTEM`) + `[상담 대상: 이름]` 과 사주 요약(원국·십신·오행 개수·강약·용신·희신·신살·현재 대운·오늘 날짜) + 직전 대화 12개 + 새 질문이다. 시스템 지시문과 사주 요약에는 캐시 표시(`cache_control`)를 건다.
- 사주 요약의 오늘 날짜와 현재 대운은 KST 날짜(`todayInSeoul`)로 정한다.
- 답이 오면 문체 검사(`cleanAiText`)를 거친다. 괄호 속 한자 표기('경금(庚金)')는 괄호째 지우고, 그 밖의 한자·'당신'·비유·유아적인 표현(`plainGuard.ts` 의 목록)이 든 문장은 뺀다. 사용자가 직접 쓴 질문·이전 질문에 있는 표현은 허용한다. 명리학 용어는 처음 나올 때 뜻을 붙여 쓸 수 있으므로 막지 않는다. 빼야 할 문장이 3분의 1을 넘으면 답 전체를 쓰지 않는다(`filtered`).
- 시스템 지시문은 결론을 첫 문장에, 3~6문장, 마지막에 오늘 할 수 있는 한 가지를 쓰게 한다. 질병·법률·투자·도박은 일반적인 성향만 말하고 전문가 상담을 권하게 한다. 자해·자살 암시가 있으면 사주 이야기를 멈추고 109·1577-0199 를 안내하게 한다. 문체 규칙은 [../PLAIN_KOREAN.md](../PLAIN_KOREAN.md)와 같다.
- AI 결과는 세 가지로 나뉜다. 질문권 처리가 다르다.

| 결과 | 판정 | 답변 | 질문권 |
|---|---|---|---|
| 성공 | 글이 있는 응답 | AI 답변(`generator: ai`) | 차감 유지 |
| 거절(`refused`) | `stop_reason` 이 거절이거나 응답 글이 비어 있음 | 규칙 기반 답변 | **차감 유지**. 거절을 유도하는 질문으로 AI 를 공짜로 되풀이해 부르지 못하게 한다 |
| 장애(`unavailable`) | 네트워크·5xx·시간 초과·요청 한도·인증 오류 등 응답을 받지 못함 | 규칙 기반 답변 | **돌려준다**. 사용자마다 하루(KST) 5번까지(`AI_REFUND_DAILY_LIMIT`, 원장 `ref_type=ai_refund` 를 `ref_id` 단위로 센다, 상담·꿈풀이 합산). 넘으면 차감한 채로 둔다 |
| 문체 검사 탈락(`filtered`) | 응답은 왔지만 위 문체 검사에서 빼야 할 문장이 많음 | 규칙 기반 답변 | 장애와 같이 **돌려준다**(같은 하루 상한). 서비스 쪽 품질 문제라서다 |

- 이 환급 규칙(서비스 쪽 장애·문체 검사 탈락일 때만, 하루 5번까지)은 의도한 정책이다. 거절은 돌려주지 않는다.
- AI 가 꺼져 있으면(키 없음) 질문권을 쓰지 않고 규칙 기반 답변을 준다. 화면은 "질문권은 차감되지 않아요" 안내를 보인다.
- 환급은 **차감한 몫 그대로** 돌려준다. 같은 `ref_id` 로 차감한 원장 줄을 찾아 무상분은 무상으로, 유상분은 유상으로 되돌린다(환불할 수 있는 유상 잔액이 무상으로 바뀌지 않게). 같은 `ref_id` 는 한 번만 돌려준다.

### 규칙 기반 답변

- 질문의 낱말로 풀이 섹션을 고른다: 돈·재물·투자 → 재물, 연애·결혼·인연 → 연애, 직장·이직·진로 → 직업, 건강 → 건강, 대운·인생 → 대운, 성격·장점 → 성격, 그 밖에는 총평.
- 사용자에게 열람 권한이 없는 섹션은 쓰지 않는다. 잠긴 주제를 물으면 "전체 풀이를 열면 볼 수 있어요" 안내와 함께 공개된 성격 풀이로 답한다. 유료 본문이 상담으로 새어 나가지 않게 하려는 규칙이다.
- 마지막 문장은 용신 오행에 맞춘 오늘의 행동 한 가지다(`TODAY_ACTION`).
- 질문에 위기 표현(`CRISIS_PATTERN`)이 있으면 답변 맨 앞에 상담 전화 안내(`CRISIS_LINE`, 109)를 넣는다. AI 지시문의 위기 대응은 AI 답변에만 적용되므로 규칙 기반 답변에도 같은 안내를 넣는 것이다.

### 같은 요청 한 번만 처리

- 웹은 질문을 보낼 때마다 새 `requestId`(UUID)를 만든다. 같은 `requestId` 가 두 번 오면(응답 유실 뒤 재시도) 한 번만 차감하고 처음 답변을 그대로 돌려준다. 처리 중이면 409 `REQUEST_IN_PROGRESS` 다.
- 처리 중 오류가 나면 선점을 풀어 같은 요청 ID 로 다시 보낼 수 있게 한다.

### 대화 보관

- 질문은 AI 를 부르기 전에 저장하고, 답은 그 뒤에 저장한다. AI 가 실패해도 질문과 규칙 기반 답이 함께 남는다.
- 대화는 사용자가 지우기 전까지 기한 없이 남는다. 화면의 '대화 지우기'(`DELETE /chat`)는 그 프로필의 대화를 모두 지우고, 프로필을 지우면 그 프로필의 대화도 함께 지운다. 회원 탈퇴 때 모두 지우고, 게스트가 기존 계정으로 로그인하면 프로필과 함께 회원 계정으로 옮긴다(`users/service.ts` 의 `deleteAccount`, `mergeGuestInto`). 게스트의 무상 질문권도 함께 옮긴다.
- 대화 기록 조회(`GET /chat`)는 전체를 한 번에 돌려준다. AI 에는 최근 12개만 보낸다.

### 보상형 광고(앱 전용)

- AI 상담·AI 꿈풀이 화면에서 AI 가 켜져 있고 질문권이 한 번 쓰는 수(`ai.creditCost`) 미만이며 오늘 남은 보상이 있을 때만 앱에 카드가 보인다. 웹에서는 그리지 않는다.
- 광고를 끝까지 보면 AdMob 이 서버 콜백(SSV)을 부르고, 서버가 Google 서명을 확인한 뒤 무상 질문권 1회(`REWARDED_AD_CREDITS`)를 준다. 하루(KST) 3회(`REWARDED_AD_DAILY_LIMIT`)이고 거래 ID 로 중복 지급을 막는다.
- 운영에서 허용 광고 단위(`ADMOB_REWARDED_AD_UNITS`)가 비어 있으면 지급하지 않는다. 앱은 시청 뒤 2·4·8초 간격으로 지갑을 다시 불러온다.

### 비용

- 건당 추정 비용은 약 2원이다(입력 6천·출력 1천 토큰). 근거는 [../COSTS.md §2](../COSTS.md).
- 질문을 보내면 분석 이벤트 `chat_sent` 를 남긴다. 분석은 키가 없어 꺼져 있다([ads-analytics.md](./ads-analytics.md)).

## 주의사항 / 알려진 이슈

1. 해결(2026-11-26): FEATURES.md §6 의 환급 서술을 코드에 맞췄다. 서비스 쪽 장애(`unavailable`)와 문체 검사 탈락(`filtered`)일 때만 하루 5번까지 돌려주고, 거절은 차감한 채로 둔다. 이 규칙은 의도한 동작이다.
2. 해결(2026-11-26): 상담 화면에 '대화 지우기'를 넣었다. `apps/web/src/lib/api.ts` 의 `chatClear` 가 `DELETE /chat` 을 부르고, 확인 시트를 거친 뒤 지금 고른 프로필의 대화를 지운다.
3. 해결(2026-11-26): 프로필을 지우면 `profiles/service.ts` 의 `remove` 가 그 프로필의 `chat_messages` 를 같은 묶음에서 지운다. 볼 수 없는 대화가 탈퇴 전까지 남지 않는다.
4. 해결(2026-11-26): `chartSummary` 의 오늘 날짜와 현재 대운을 KST 날짜(`todayInSeoul`)로 정한다. KST 0~9시에 하루 전 날짜나 전년도 대운이 AI 에 가지 않는다.
5. 해결(2026-11-26): 위기 표현 패턴을 `packages/shared/src/crisis.ts` 의 `CRISIS_PATTERN` 하나로 합쳐 상담·꿈풀이·타로 질문 화면이 같이 쓴다('목숨을 끊', '극단적 선택' 포함). 서버도 같은 패턴으로 판정해 규칙 기반 상담 답변 맨 앞에 상담 전화 안내를 넣는다.
6. 해결(2026-11-26): `consumeCredits` 가 `refType` 을 받는다. 꿈풀이 차감은 원장에 `ref_type='dream'`, 상담은 `chat` 으로 남는다.
7. 해결(2026-11-26): 장애 환급은 차감한 몫 그대로 돌려준다. 같은 `ref_id` 의 차감 원장을 찾아 유상분은 유상으로 되돌리므로 환불할 수 있는 유상 잔액이 무상으로 바뀌지 않는다. 같은 차감을 두 번 돌려주지 않고, 하루 상한은 `ref_id` 단위로 센다.
8. 해결(2026-11-26): 상담·꿈풀이·타로 이야기의 AI 출력에 문체 검사(`ai/plainOutput.ts`)를 적용한다. 한자·'당신'·비유·유아적인 표현이 든 문장을 빼고, 많이 빠지면 AI 답을 쓰지 않고 규칙 기반 결과를 준다(상담·꿈풀이는 질문권 환급). 초안이 없으므로 리포트처럼 '새로 들인 용어'를 막지는 않는다.
9. 해결(2026-11-26): `GET /config` 가 `ai.creditCost`(`AI_CHAT_CREDIT_COST`)를 내려 주고, 상담·꿈풀이 화면은 잔액이 이보다 적을 때 보상형 광고 카드를 보인다. 차감량을 2 이상으로 바꿔도 질문할 수 없는 잔액에서 카드가 보인다.
