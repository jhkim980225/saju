# AI 기능은 Haiku 계열 기본 모델로 하고 유료 타로 이야기만 Sonnet 계열을 쓴다

- 날짜: 2026-10-15 (두 기본값은 첫 커밋에 이미 들어 있다. 리포트 다듬기 모델 비교는 2026-10-13 이라고 ENV_KEYS.md 가 적는다)
- 상태: 채택
- 관련 커밋:
  - `ae6492f` 첫 커밋: `ANTHROPIC_MODEL` 기본 `claude-haiku-5-5`, `ANTHROPIC_MODEL_PREMIUM` 기본 `claude-sonnet-5-5`
  - `bb49fd7` 타로·택일 AI 재시도를 결과당 3회, 10분 간격으로 제한
  - `464c569` 하루 요약에 AI 호출 수와 예상 비용을 넣음
- 관련 문서: [COSTS.md](../COSTS.md), [ENV_KEYS.md](../ENV_KEYS.md) §3, [FEATURES.md](../FEATURES.md) §0.2, [features/ask.md](../features/ask.md), [features/reports.md](../features/reports.md), [features/dream.md](../features/dream.md), [features/taekil.md](../features/taekil.md), [features/tarot.md](../features/tarot.md)

## 맥락

서비스 안에서 Anthropic 모델을 부르는 곳은 AI 상담, AI 꿈풀이, 유료 리포트 다듬기, 택일 상세, 타로 '이어지는 이야기'다. 리포트 다듬기와 택일 상세는 규칙 기반 초안의 문장을 고치는 일이고, 상담과 꿈풀이는 질문권 1회당 한 번 부른다([2026-10-rule-based-with-ai-polish.md](./2026-10-rule-based-with-ai-polish.md)). 모델은 `apps/api/src/config/env.ts` 의 두 값으로 고른다.

## 결정

- 상담, 꿈풀이, 리포트 다듬기, 택일 상세는 `ANTHROPIC_MODEL`(기본 `claude-haiku-5-5`)을 쓴다. 가장 싼 모델이다.
- 타로 이야기만 `ANTHROPIC_MODEL_PREMIUM`(기본 `claude-sonnet-5-5`)을 쓴다. 이 호출은 유료 스프레드에서만 한다.
- 모델 이름은 환경 변수로 바꿀 수 있게 둔다.

## 근거

- 리포트는 규칙 기반 초안을 다듬는 일이라 2026-10-13 비교에서 Sonnet 과 차이가 거의 없었다(ENV_KEYS.md §3). `env.ts` 주석도 "초안을 다듬는 일이라 가장 싼 모델로 충분"이라고 적는다.
- 타로 이야기는 카드끼리 엮어 읽는 품질이 Haiku 보다 나았다(ENV_KEYS.md §3, `env.ts` 주석). 비교한 날짜와 방법은 기록에 없다. TODO: 확인 필요.
- COSTS.md 기준 단가는 100만 토큰당 Haiku 입력 $0.10·출력 $0.50, Sonnet 입력 $2.00·출력 $10.00 이다.

## 결과와 영향

얻은 것:
- 건당 추정 비용은 상담·꿈풀이 약 2원, 사주분석서 다듬기 약 40원, 택일 상세 약 10원이다. AI 비용은 상품 가격의 1~5% 수준이다(COSTS.md §2·§4).

감수한 것:
- 타로 이야기는 건당 약 45원으로 Haiku 기능의 20배 이상이다. 무료 스프레드에 이 호출을 붙이면 비용을 다시 계산해야 한다(COSTS.md §6).
- AI 실패가 반복되면 유료 타로를 열 때마다 Sonnet 을 다시 부르는 문제가 2026-11-25 보안 점검에서 나왔다. 결과당 최대 3회, 10분 간격으로 제한했다.
- Haiku 는 거절 시 서버 측 대체 모델 재시도 기능을 지원하지 않아 Haiku 호출에는 그 옵션을 보내지 않는다(`apps/api/src/modules/ai/service.ts`).
- 리포트 다듬기의 서버 전체 동시 호출 상한 16개는 Haiku 의 분당 출력 토큰 한도를 넘지 않게 잡은 값이다. 모델이나 요금 등급을 바꾸면 이 값도 다시 봐야 한다.
- 시스템 프롬프트에 캐시를 걸었지만 프롬프트가 모델의 최소 캐시 길이보다 짧으면 적용되지 않는다. 비용 추정에는 캐시 할인을 넣지 않았다.

남은 일:
- 실제 비용은 운영 로그와 Anthropic 콘솔 사용량으로 확인한다. 하루 요약의 예상 비용은 `apps/api/src/modules/ops/service.ts` 의 단가표와 환율 1,450원으로 어림하므로, 단가가 바뀌면 이 표도 고쳐야 한다.
