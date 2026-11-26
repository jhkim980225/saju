# 타로

> 기준일: 2026-11-26. 결제 흐름·주문·권한 지급은 [payments.md](./payments.md), 요청·응답 형식은 [API.md 「타로」](../API.md)를 본다.

## 목적

1909년 웨이트-스미스 덱의 전통 카드 뜻으로 고민을 정리해 보는 기능이다. 무료 기능(오늘의 카드, 예·아니오)으로 들어오게 하고, 고민별 펼침의 깊은 풀이를 리딩 1건 단위로 판다(990원~4,900원). 저장한 사주가 있으면 일간·용신과 카드의 오행을 견주는 '달달사주 방식' 근거를 덧붙인다.

운영 상태는 **운영 중**이다. 유료 펼침의 AI 이야기도 켜져 있다.

## 사용자 흐름

| 화면 | 주소 | 들어오는 곳 |
|---|---|---|
| 타로 홈 | `/tarot` | 데스크톱 메뉴, 물어보기 탭 위 전환(`AskSegment`), 전체 운세 메뉴 |
| 오늘의 카드 | `/tarot/daily` | 타로 홈 |
| 질문 고르기 | `/tarot/ask` | 타로 홈의 주제 타일·펼침 방식 타일 |
| 카드 뽑기 | `/tarot/draw` | 질문 화면 |
| 결과 | `/tarot/r/:id` | 뽑기 뒤, 기록 |
| 기록 | `/tarot/history` | 타로 홈 |

1. 주제(연애·속마음·재회·일/진로·돈·관계·나) 또는 펼침 방식(예·아니오·양자택일·궁합·켈틱 크로스)을 고르고 질문을 적는다.
2. '섞기'를 누르면 서버가 덱 토큰을 준다. 오늘 같은 질문으로 뽑은 리딩이 있으면 그 결과로 안내하고 다음 단계로 넘어가지 않는다.
3. 뒤집힌 78장 중 펼침 장수만큼 자리를 고르면 서버가 카드를 꺼내 리딩을 저장하고 결과를 돌려준다.
4. 유료 펼침은 잠긴 섹션의 첫 문단만 보인다. 결제하면 같은 카드로 전부 열린다.
5. 결과 화면에서 공유하거나 기록을 지울 수 있다(오늘의 카드 제외). 지우기 확인 창은 오늘 뽑은 카드는 지워도 같은 질문으로 다시 뽑을 수 없고 예·아니오 하루 횟수에도 들어간다는 것과, 깊은 풀이 결제 내역은 결제 내역에 그대로 남는다는 것을 알린다.

## 관련 파일

| 구분 | 경로 |
|---|---|
| 라우트·서비스 | `apps/api/src/modules/tarot/routes.ts`, `apps/api/src/modules/tarot/service.ts`(`questionKey`, `deletedQuestionKey`, `ensureAiStory`, `AI_STORY_MAX_ATTEMPTS`, `TAROT_HISTORY_RECENT`) |
| 덱·토큰 | `apps/api/src/modules/tarot/deck.ts`(`issueDeckToken`, `readDeckToken`, `dailyCard`, `REVERSED_RATE`) |
| 리딩 문장 | `apps/api/src/modules/tarot/reading.ts`(`buildTarotReading`, `SUIT_ELEMENT`, `MAJOR_ELEMENT`, `ELEMENT_NOTE`), `apps/api/src/modules/tarot/yesno.ts` |
| 카드 문안 78장 | `apps/api/src/modules/tarot/content/`(`major.ts`, `wands.ts`, `cups.ts`, `swords.ts`, `pentacles.ts`) |
| AI | `apps/api/src/modules/ai/service.ts`(`TAROT_SYSTEM`, `tarotStory`, `AI_INTERACTIVE_TIMEOUT_MS`), `apps/api/src/modules/ai/plainOutput.ts`(문체 검사) |
| 펼침·주제 정의 | `packages/shared/src/index.ts`(`TAROT_SPREADS`, `TAROT_TOPICS`, `TAROT_YESNO_DAILY_FREE`, `tarotShuffleSchema`) |
| 상품 | `apps/api/src/modules/commerce/catalog.ts` |
| 화면 | `apps/web/src/pages/TarotHomePage.tsx`, `apps/web/src/pages/TarotAskPage.tsx`, `apps/web/src/pages/TarotDrawPage.tsx`, `apps/web/src/pages/TarotResultPage.tsx`, `apps/web/src/pages/TarotHistoryPage.tsx` |
| 화면 부품 | `apps/web/src/components/TarotCard.tsx`, `apps/web/src/components/TarotReadingView.tsx`, `apps/web/src/components/TarotSpread.tsx`, `apps/web/src/components/AskSegment.tsx`, `apps/web/src/lib/tarot.ts` |
| 카드 그림 | `apps/web/public/tarot/cards/`(78장 webp), `apps/web/public/tarot/back.webp` |
| 테스트 | `apps/api/test/tarot.test.ts`, `apps/api/test/plain-taekil-tarot.test.ts`, `apps/api/test/ai-failure.test.ts`, `apps/web/src/lib/__tests__/tarot.test.tsx`, `e2e/tarot.spec.ts`, `e2e/tarot-spreads.spec.ts` |

## API / 데이터 모델

- `GET /tarot/daily?profileId?`, `POST /tarot/shuffle`, `POST /tarot/readings`, `GET /tarot/readings`, `GET /tarot/readings/:id`, `DELETE /tarot/readings/:id`. 모두 인증이 필요하고 게스트 토큰도 통과한다. 형식과 예·아니오 기울기 표는 [API.md 「타로」](../API.md).
- 결제는 `POST /orders { productId, readingId }`(앱은 `/payments/iap/verify` 에 `readingId`)다. 서버는 내 리딩인지, 리딩의 펼침 방식과 상품이 맞는지 확인한다(`assertPurchasable`). 지급 권한 키는 `tarot:reading:<리딩 ID>` 다.
- 리딩은 `tarot_readings` 에 저장한다. 같은 질문 판정 키(`question_key`)와 날짜 키(`date_key`, KST), 덱 토큰 지문(`deck_fingerprint`), AI 이야기(`ai_paragraphs`)와 재시도 기록(`ai_attempts`, `ai_retry_at`)을 함께 둔다.
- 오늘 뽑은 리딩을 지우면 행을 지우지 않고 표지로 바꾼다. `question_key` 를 `deleted:<판정 키의 SHA-256>` 으로 바꾸고 질문·주제·카드·선택지·AI 문단·프로필 연결을 비운다. 표지는 조회·기록·결제에서 없는 리딩으로 보고(404), 지난날의 표지는 그 사용자가 다음에 리딩을 지울 때 함께 지우고, 탈퇴하면 모두 지운다. 표지에는 질문 글이 남지 않는다.
- 잠긴 리딩은 응답 최상위 `basis` 를 `null` 로 보낸다. 잠긴 '사주로 본 근거' 섹션에서 `basis` 를 빼는 것과 같은 규칙이다.

## 비즈니스 규칙 & 엣지케이스

### 펼침별 무료 범위와 가격

| 펼침 | 주제 | 장수 | 무료 범위 | 상품(가격, 함께 주는 질문권) |
|---|---|---|---|---|
| 오늘의 카드 `daily` | | 1 | 전부 | 없음 |
| 예·아니오 `yesno` | 예·아니오 | 1 | 전부, KST 하루 1회 | 없음 |
| 질문 리딩 `three` | 연애·일/진로·돈·관계·나 | 3 | 카드, 카드별 전통 뜻, 총평 첫 문단 | `tarot_question_3`(990원, 1회) |
| 연애 속마음 `feelings5` | 속마음 | 5 | 위 + 첫 자리 풀이 | `tarot_love_5`(2,900원, 1회) |
| 재회 `reunion5` | 재회 | 5 | 위 + 첫 자리 풀이 | `tarot_love_5`(2,900원, 1회) |
| 양자택일 `choice` | 양자택일 | 3 | 위 + '지금의 나' 자리 | `tarot_choice_3`(990원, 1회) |
| 궁합 타로 `compat` | 궁합 | 5 | 위 + '나의 마음' 자리 | `tarot_compat_5`(2,900원, 1회) |
| 켈틱 크로스 `celtic` | 켈틱 크로스 | 10 | 카드, 카드별 뜻, 총평 첫 문단 | `tarot_celtic_10`(4,900원, 3회) |

- 잠기는 부분은 남은 자리 풀이, 카드끼리 이어지는 이야기, 지금 해 볼 수 있는 행동, 사주로 본 근거다. 잠긴 섹션은 첫 문단 미리보기만 보낸다.
- 상품 하나는 리딩 하나만 연다. 플러스 구독자는 모두 열리지만 구독 상품은 없다.
- 결제는 회원만 할 수 있다. 게스트는 결제 전에 가입·로그인한다([auth.md](./auth.md)).

### 카드 섞기와 공정성

- 서버가 서명한 덱 토큰(30분 유효)만 주고 카드 순서는 보내지 않는다. 토큰에는 임의 nonce 만 있고 셔플 시드는 서버 비밀로 nonce 에서 만든다. 토큰만 보고는 카드 순서를 알 수 없다.
- 토큰 서명에 사용자 ID 를 묶어 다른 계정에서 쓸 수 없다. 같은 토큰·같은 자리는 언제나 같은 카드라 다시 보내도 카드가 바뀌지 않는다. 한 토큰으로는 리딩을 한 번만 만든다(이미 쓴 토큰 409).
- 역방향 비율은 35%다.
- 입력 검증: 질문 80자까지, 예·아니오는 질문이 필수다(빈 질문 400), 양자택일 선택지 각 1~20자이고 서로 달라야 한다, 궁합 타로는 내 프로필과 다른 상대 프로필이 필요하다. 주제와 펼침이 맞지 않거나 장수가 다르거나 같은 카드를 두 번 고르면 400, 만료된 토큰은 400 이다.

### 같은 질문 다시 뽑기 금지

- 같은 날(KST) 같은 펼침·주제·질문이면 새로 뽑지 않고 기존 리딩으로 안내한다. 띄어쓰기·끝 문장부호·대소문자 차이는 같은 질문으로 본다. 양자택일은 선택지 A·B, 궁합은 상대 프로필까지 같아야 같은 질문이다.
- 셔플 응답의 `existingReadingId`, 뽑기 409 의 `details.readingId` 로 안내한다. 동시에 같은 질문을 두 번 보내도 고유 제약으로 하나만 저장된다.
- 오늘 뽑고 지운 질문은 셔플·뽑기 모두 409 `details.reason='DELETED_TODAY'` 로 거절한다("같은 질문은 내일 다시 볼 수 있어요"). 지우고 다시 뽑아 새 카드를 보는 우회를 막는 것이다.
- 카드를 다시 뽑아 원하는 답이 나올 때까지 되풀이하는 것을 막고, 유료 리딩을 다시 뽑아 공짜로 새 카드를 보는 것을 막는 규칙이다.

### 예·아니오

- 새 질문은 하루 1회(`TAROT_YESNO_DAILY_FREE`)다. 넘으면 셔플·뽑기 모두 429 `RATE_LIMITED` 이고 `details.readingId` 로 오늘 본 리딩을 알려 준다(그 리딩을 지웠으면 `readingId` 없이). 같은 질문 다시 열기는 횟수에 넣지 않고, 지운 리딩은 횟수에 넣는다.
- 횟수 확인은 저장과 한 묶음(`atomic()` guard)이다. 서로 다른 질문 여러 개를 동시에 보내도 하루 횟수만큼만 저장되고 나머지는 429 다.
- 기울기(예·조건부·아니오)는 카드와 방향만으로 정한다. 사주와 질문은 기울기를 바꾸지 않는다. 기울기 표는 전통 뜻을 바탕으로 달달사주가 정한 기준이며 화면에 그렇게 밝힌다. 실제 비율은 대략 예 44%·조건부 36%·아니오 20%다.
- 화면은 큰 YES/NO 대신 3단계 기울기와 경향 문장만 보인다. 결정을 대신하지 않게 하려는 것이다. AI 는 쓰지 않는다.

### 오늘의 카드

- 같은 사람·같은 날(KST)은 같은 카드다. 사용자 ID 와 날짜로 시드를 만든다. 처음 연 날 리딩으로 저장되어 기록에도 남는다. AI 는 쓰지 않는다.
- `profileId` 를 주면 그날 저장된 카드의 사주 결합 프로필을 그 프로필로 바꾼다(카드는 그대로). 주지 않으면 마지막으로 고른 프로필을 쓴다.

### 사주 결합

- 뽑을 때 지정한 프로필(지정하지 않으면 그때의 대표 프로필)을 리딩에 저장하고, 그 프로필의 일간·용신과 카드에 대응시킨 오행의 관계로 근거 문장을 만든다. 궁합 타로는 두 사람의 일간·용신을 함께 읽는다.
- 열 때는 리딩에 저장한 프로필만 쓴다. 프로필 없이 뽑았거나 그 프로필이 지워졌으면 사주 섹션이 없다. 그때의 대표 프로필로 대신하지 않는다.
- 사주 섹션은 뽑을 때 저장한 출생 정보(`saju_snapshot`)로 계산한다. 나중에 프로필을 고쳐도 이미 뽑은 리딩은 바뀌지 않는다. 오늘의 카드에서 사람을 바꾸면 스냅샷도 그 사람으로 바꾼다.
- 사주 근거는 저장하지 않고 열 때마다 저장한 프로필의 현재 출생 정보로 다시 계산한다(아래 알려진 이슈 4).
- 카드와 오행의 대응은 **달달사주 기준**이다. 전통(황금여명회 체계) 원소는 완드 불·컵 물·소드 공기·펜타클 흙이지만, 달달사주는 완드 木·컵 水·소드 金·펜타클 土로 잇고 메이저는 대응 행성(동양 이름의 오행)과 별자리 원소를 따른다. 총평의 슈트 설명은 전통 원소로 말하고, 오행 연결은 사주 섹션에서만 쓴다. 화면에 "전통 타로에는 없는 해석"이라고 밝힌다.
- 양자택일은 어느 한쪽을 정답으로 표시하지 않는다. 한 줄은 '지금의 나' 카드로, 행동은 지금의 나·A·B 에서 하나씩 같은 무게로 쓴다.

### AI 이야기

- 유료 펼침을 연 뒤 처음 볼 때 '카드끼리 이어지는 이야기'를 `ANTHROPIC_MODEL_PREMIUM`(기본 `claude-sonnet-5-5`)으로 한 번 만들고 저장한다. 무료 펼침(오늘의 카드·예·아니오)과 잠긴 리딩은 AI 를 부르지 않는다.
- 결과를 보는 `GET /tarot/readings/:id` 요청 안에서 기다리므로 호출별 제한 시간 60초·재시도 1번(`AI_INTERACTIVE_TIMEOUT_MS`)으로 부른다.
- 받은 이야기는 문체 검사(`cleanAiParagraphs`)를 거친다. 한자(질문·선택지에 쓴 글자 제외)·'당신'·비유(카드 뜻·질문에 있는 말 제외)가 든 문장을 빼고, 3분의 1 넘게 빠지면 실패로 본다.
- 실패하면 규칙 기반 이야기를 보여 준다. 다시 열면 재시도하되 리딩당 3번까지(`AI_STORY_MAX_ATTEMPTS`), 직전 시도 뒤 10분이 지나야 한다. 조건부 갱신으로 시도를 맡아 여러 인스턴스에서 동시에 열어도 한 번만 부른다.
- Sonnet 은 Haiku 기능보다 건당 비용이 20배 이상(약 45원)이다. 무료 펼침에 AI 를 붙이려면 [../COSTS.md](../COSTS.md)의 비용을 다시 계산한다.

### 기록과 계정

- 기록 목록은 최근 100개(`TAROT_HISTORY_RECENT`)에 더해, 그보다 오래된 구매 리딩(`tarot:reading` 권한)도 모두 싣는다. 잠금 여부는 플러스 구독 조회 1번과 권한 목록 조회 1번으로 정한다. 지운 리딩(표지)은 싣지 않는다.
- 회원 탈퇴 때 타로 기록(질문 글 포함)을 지운다. 게스트가 기존 계정으로 로그인하면 타로 기록을 옮기고, 같은 날 같은 질문이 겹치면 회원 것을 남긴다(`users/service.ts` 의 `deleteAccount`, `mergeGuestInto`).
- 분석 이벤트 `tarot_drawn`, `tarot_daily_drawn`, `tarot_result_viewed` 를 남긴다(분석은 키가 없어 꺼짐, [ads-analytics.md](./ads-analytics.md)). 결과는 링크로 공유할 수 있다.

### 카드 그림 출처

- 앞면 78장은 1909년 웨이트-스미스 덱 원판(그림 패멀라 콜먼 스미스, 1878~1951)의 위키미디어 공용 스캔본이다. 그린 사람이 1951년에 사망해 한국·미국·유럽 모두 보호 기간이 끝난 공개 저작물이다.
- 1971년 이후 U.S. Games 가 낸 **다시 칠한 판은 쓰지 않는다.** 'Rider-Waite' 는 U.S. Games 의 상표라 화면·문서에 쓰지 않고 '웨이트-스미스'로 적는다.
- 변환: 가장자리를 좌우 0.8%·위아래 0.5% 잘라 내고, 484×836(11:19)으로 맞추고, 반경 16px 둥근 모서리 바깥을 카드 여백색 `#ece2d5` 로 채우고, `blur(0.6)` 를 준 뒤 webp 품질 72로 저장했다. 바보 카드 스캔은 왼쪽 바탕 30px 를 더 잘라 냈다. 78장 합계는 약 4.3MB 다.
- 화면 비율은 `apps/web/src/components/TarotCard.tsx` 의 `aspect-[11/19]` 다. 켈틱 크로스 2번(가로) 카드는 `apps/web/src/components/TarotSpread.tsx` 에서 `scale-[0.7]` 로 줄여 옆 칸을 넘지 않게 한다.
- 뒷면 `back.webp` 는 달달사주 디자인(남색 바탕, 금빛 이중 테두리, 초승달과 팔각 별)이다.
- 이력: 2026-10-13~15 에는 생성형 AI(Higgsfield) 수묵화 78장을 썼고, 2026-10-21 "너무 동양풍"이라는 의견으로 원판 스캔으로 바꿨다. 카드 뜻·그림 설명(`imagery`) 글은 원래 1909년 원판 장면 기준이라 고치지 않았다.

## 주의사항 / 알려진 이슈

1. 해결(2026-11-26): 오늘 뽑은 리딩을 지우면 행 대신 표지(`question_key='deleted:<해시>'`)를 남기고 내용을 비운다. 예·아니오 하루 횟수와 같은 질문 판정이 그대로 남아 지우고 다시 뽑을 수 없다. 예·아니오 횟수 확인은 저장과 한 묶음(`atomic()` guard)으로 바꿔 서로 다른 질문을 동시에 보내도 하루 횟수를 넘지 않는다.
2. 해결(2026-11-26): 잠긴 리딩은 응답 최상위 `basis` 도 `null` 로 보낸다. 테스트(`tarot.test.ts` '질문 3장', '궁합 타로')의 기대값을 같이 고쳤다.
3. 해결(2026-11-26): `chartFor` 를 뽑을 때(지정 프로필, 없으면 대표 프로필)와 열 때(저장한 프로필만)로 나누고 주석을 동작에 맞췄다. 프로필 없이 뽑은 리딩이나 프로필이 지워진 리딩은 열 때 사주 섹션이 없다.
4. 해결(2026-11-26): 뽑을 때 본인(과 궁합 상대)의 이름·출생 정보를 `tarot_readings.saju_snapshot` 에 저장하고(마이그레이션 0005), 열 때 그 프로필이 아직 있으면 스냅샷으로 계산한다. 그래서 프로필 출생 정보를 고쳐도 이미 뽑은 리딩의 사주 섹션은 바뀌지 않는다. 프로필을 지우면 그 사람이 들어 있는 리딩의 스냅샷을 비우고 사주 섹션도 빠진다(지운 사람의 출생 정보를 남기지 않는다). 스냅샷이 없는 이전 리딩은 지금 프로필로 계산한다. 회귀 테스트: `tarot.test.ts` '타로 사주 스냅샷'.
5. 해결(2026-11-26): `tarotStory` 를 호출별 제한 시간 60초·재시도 1번(`AI_INTERACTIVE_TIMEOUT_MS`)으로 부른다.
6. 해결(2026-11-26): 기록 목록은 최근 100개에 더해 그보다 오래된 구매 리딩도 싣는다. 잠금 여부는 플러스 구독·권한 목록을 한 번씩만 조회해서 정한다.
7. 해결(2026-11-26): `GET /tarot/daily` 에 `profileId` 를 주면 이미 저장된 오늘의 카드도 그 프로필로 사주 결합을 바꾼다. 카드는 바뀌지 않는다.
8. 해결(2026-11-26): 예·아니오는 서버에서도 질문이 필수다. 빈 질문은 400 이다.
9. 남김: TAROT_ART.md 의 카드 변환(sharp) 스크립트는 저장소에 없다. 그림 원본과 변환 조건은 이 문서 '카드 그림 출처'에 적혀 있지만 스크립트 자체는 코드로 되살릴 수 없다. 그림을 다시 만들 때 쓸 스크립트의 위치는 TODO: 확인 필요.
