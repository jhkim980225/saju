# 서비스명을 달빛사주에서 달달사주로 바꾼다

- 날짜: 2026-11-11
- 상태: 채택
- 관련 커밋:
  - `d35100d` 스토어 상품 ID 를 `kr.dalbitsaju.*` 로 변경(2026-10-15, 이번 결정 전의 이름 정리)
  - `4846e3c` 서비스명을 달빛사주에서 달달사주로 변경: 같은 이름의 사주 서비스가 dalbitsaju.kr 에서 운영 중
- 관련 문서: [research/04-copywriting-guide.md](../research/04-copywriting-guide.md), [PRD.md](../PRD.md) §5, [DEPLOY.md](../DEPLOY.md), [architecture.md](../architecture.md), [features/ops.md](../features/ops.md)

## 맥락

서비스는 첫 커밋부터 "달빛사주"였다. 2026-10-15 에는 스토어 등록 전이라는 이유로 앱 ID 와 맞춰 스토어 상품 ID 를 `kr.saju.*` 에서 `kr.dalbitsaju.*` 로 바꿨다. 이후 「달빛사주」라는 같은 이름의 사주 서비스가 dalbitsaju.kr 에서 이미 운영 중인 것을 확인했다.

## 결정

- 출시 전에 서비스명을 「달달사주」로 바꾼다. 달(月)과 '달달하다'를 겹친 이름이다.
- 화면, 메타 정보, 문서, 테스트의 이름과 도메인을 바꾼다. 도메인은 daldalsaju.com 이다.
- 앱 ID 와 스토어 상품 ID 를 `kr.dalbitsaju.*` 에서 `com.daldalsaju.*` 로 바꾼다. Android 패키지 폴더, iOS 번들 ID, 딥링크 스킴도 포함한다.
- 로고 글자는 원래 워드마크의 '달' 픽셀을 복사해 '빛' 자리에 넣어 같은 글씨체를 유지한다. 초승달 로고와 밤하늘 디자인은 그대로 둔다.
- 화면에 쓰이지 않던 한자 표기(月光四柱)는 지운다.
- Cloudflare 내부 이름(Worker·D1·Queue 의 `dalbit-saju`)은 사용자에게 보이지 않으므로 바꾸지 않는다.

## 근거

- 같은 이름의 서비스가 운영 중이어서 상표, 검색, 결제에서 혼동될 우려가 있었다(research/04-copywriting-guide.md 의 2026-11-11 변경 메모).
- 스토어 상품 ID 변경 시점에 대해 `d35100d` 는 "스토어 등록 전이라 지금 바꾼다"고 적는다. 이번 변경도 스토어 등록 전에 했다.
- 내부 이름을 그대로 둔 이유는 "사용자에게 보이지 않아서"다(`4846e3c`).

## 결과와 영향

얻은 것:
- 출시 전에 이름 충돌을 피했다. 스토어 상품을 등록하기 전이라 상품 ID 변경에 따른 이전 작업이 없었다.

감수한 것:
- 132개 파일을 바꿨다. 로고 이미지, 스플래시, OG 이미지, Android·iOS 사본까지 다시 만들었다.
- 운영 이름과 내부 이름이 다르다. Worker `dalbit-saju`, D1 `dalbit-saju`, Queue `dalbit-saju-jobs` 가 `apps/api/wrangler.jsonc`, DEPLOY.md 의 명령, PAYMENTS.md 의 웹훅 전달 설명에 남아 있다. 운영 작업을 할 때 두 이름을 함께 알아야 한다.
- 웹 저장소 키의 접두어 `yd.`(`yd.session`, `yd.deviceId`)도 바뀌지 않았다. 이 접두어의 유래는 기록에 없다. TODO: 확인 필요.

남은 일:
- PRD §5 출시 전 체크리스트의 "서비스명 상표·도메인 확인('달달사주')"이 아직 끝나지 않았다.
- 내부 이름을 언젠가 맞출지는 정하지 않았다. 바꾸려면 새 D1 과 Queue 를 만들어 데이터를 옮겨야 하는지 확인이 필요하다. TODO: 확인 필요.
