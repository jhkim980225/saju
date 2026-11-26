# npm workspaces 모노레포로 나누고 사주 엔진과 API 계약을 공용 패키지로 둔다

- 날짜: 2026-10-15 (첫 커밋에 이미 들어 있는 결정이다. 결정을 내린 날은 TODO: 확인 필요)
- 상태: 채택
- 관련 커밋:
  - `ae6492f` 첫 커밋: `packages/saju-core`, `packages/shared`, `apps/api`, `apps/web` 네 워크스페이스
  - `14ae3eb` 토정비결 작괘 엔진을 saju-core 에 추가
  - `ff71a6a` 띠별·별자리 계산을 saju-core 에, 띠·별자리 데이터를 shared 에 추가
  - `2a81904` 택일 엔진을 saju-core 에 추가
  - `5c895e6` 꿈해몽 사전 데이터를 shared 에 추가(`@saju/shared/dream`)
  - `e14308f` 랜딩 첫 번들에서 zod 스키마 묶음을 빼려고 `@saju/shared/tojeong` 을 따로 둠
  - `2a4b0b8` API 를 Fastify 에서 Hono(Workers)로 바꿀 때 두 패키지는 고치지 않음
- 관련 문서: [architecture.md](../architecture.md) §1·§2, [SAJU_ENGINE.md](../SAJU_ENGINE.md), [APP_PORTING.md](../APP_PORTING.md), [features/saju.md](../features/saju.md), [features/seo.md](../features/seo.md)

## 맥락

서비스는 웹(브라우저, PWA), Capacitor 로 감싼 iOS·Android 앱, API 서버로 이루어진다. 사주 계산은 절기 시각, 음양력 변환, 시간대와 서머타임, 경도 보정을 다루므로 어디서 계산하든 같은 결과가 나와야 한다. 요청 형식도 서버 검증과 클라이언트 폼 검증이 같은 규칙을 써야 한다.

## 결정

- 저장소는 npm workspaces 모노레포로 하고, 루트 `package.json` 의 `workspaces` 에 `packages/*` 와 `apps/*` 를 둔다.
- 사주 계산은 `packages/saju-core`(`@saju/core`)에 프레임워크와 무관한 순수 TypeScript 로 둔다. 외부 의존성은 절기 계산용 `lunar-javascript` 와 한국천문연구원 음력 데이터용 `korean-lunar-calendar` 두 개다.
- 엔진은 계산과 점수만 내고 문장은 만들지 않는다. 풀이 문장은 `apps/api` 의 interpretation 모듈이 만든다.
- API 계약은 `packages/shared`(`@saju/shared`)에 zod 요청 스키마와 응답 DTO 타입으로 두고, 웹과 API 가 같은 스키마를 쓴다. API 는 `apps/api/src/lib/validate.ts` 의 `parse()` 로 이 스키마를 검증한다.
- 두 패키지는 빌드하지 않고 `src/index.ts` 를 그대로 내보낸다. 쓰는 쪽의 TypeScript 와 번들러가 직접 컴파일한다.

## 근거

- architecture.md §1 은 모노레포의 선택 이유를 "추가 도구 없이 엔진·계약을 프론트, 백엔드, 앱이 함께 쓴다"로, 계산 엔진의 선택 이유를 "프레임워크와 무관해서 서버·브라우저·앱 어디서나 같은 결과가 나온다"로 적는다. 첫 커밋의 아키텍처 문서도 같은 이유를 적었다.
- `packages/shared/src/index.ts` 머리 주석은 "요청 바디는 zod 스키마로 정의해 서버 검증과 클라이언트 폼 검증에 함께 사용한다"고 적는다.
- Turborepo, pnpm 같은 다른 도구를 검토했는지는 기록에 없다. TODO: 확인 필요.

## 결과와 영향

얻은 것:
- 2026-11-11 에 API 를 Fastify 에서 Hono 로, 실행 환경을 Node 에서 Cloudflare Workers 로 옮길 때 두 패키지는 한 줄도 바뀌지 않았다.
- 엔진만 따로 시험한다(`npm test -w @saju/core`). lunar-javascript 의 八字와 무작위 3,000건을 교차 검증하고, 한국천문연구원 절입 시각과 서머타임, 경도 보정을 시험한다(SAJU_ENGINE.md §4). 보안 점검에서는 엔진 경계 입력 85,246건을 퍼징했다(SECURITY_REVIEW.md).
- 띠·별자리·꿈해몽 데이터를 shared 에 두어 API, 웹 화면, 빌드 때 도는 사전 렌더링 스크립트(`apps/web/scripts/prerender.mts`)가 같은 데이터를 쓴다.

감수한 것:
- `@saju/shared` 를 가져오면 zod 와 스키마 전체가 번들에 들어간다. 랜딩 화면이 상수 하나를 가져왔을 때 첫 번들이 439KB 에서 548KB 로 커져, 그 상수를 zod 없는 `@saju/shared/tojeong` 으로 옮겼다(`e14308f`). shared 에는 이렇게 나눈 진입점(`./dream`, `./tojeong`, `./profile`)이 생겼다.
- shared 가 엔진의 런타임 코드를 끌어오지 않도록 일부 값을 복제한다. 예를 들어 택일 목적 목록 `TAEKIL_PURPOSE_IDS` 는 `@saju/core` 의 `TaekilPurpose` 와 같은 순서로 손으로 맞춘다.
- 두 패키지를 빌드하지 않으므로 패키지를 쓰는 모든 곳의 TypeScript 설정과 번들러가 원본 TS 를 컴파일할 수 있어야 한다.

남은 일:
- 웹은 지금 `@saju/core` 에서 타입만 가져오고 계산은 모두 API 가 한다. "브라우저·앱 어디서나 같은 결과"는 아직 쓰이지 않는다. APP_PORTING.md 는 클라이언트에서 계산하는 오프라인 만세력을 정리가 필요한 항목으로 남겨 두었다.
