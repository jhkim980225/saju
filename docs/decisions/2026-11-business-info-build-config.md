# 사업자 정보와 문의처는 저장소에 두지 않고 빌드 설정(`VITE_BIZ_*`)으로 받는다

- 날짜: 2026-11-25
- 상태: 채택
- 관련 커밋:
  - `37dca41` 토스 빌드 설정 `.env.toss*` 는 사업자 정보를 담으므로 저장소에서 빼고 `.env.toss.example` 만 둠
  - `515a834` 웹 이용약관·개인정보 처리방침 전면 작성, 사업자 정보·문의처를 `apps/web/.env` 의 `VITE_BIZ_*` 로 받음
- 관련 문서: [features/legal.md](../features/legal.md), [ENV_KEYS.md](../ENV_KEYS.md) §7, [DEPLOY.md](../DEPLOY.md), [PRD.md](../PRD.md) §5, [features/toss-miniapp.md](../features/toss-miniapp.md)

## 맥락

research/03 과 PAYMENTS.md §3.0 은 PG 심사와 AdSense 승인에 통신판매업 신고와 사업자 정보 표기가 필요하다고 적고, 처리방침에는 개인정보 보호책임자를 공개해야 한다(features/legal.md). 표시할 값은 상호, 대표자, 사업자등록번호, 통신판매업 신고번호, 주소, 연락처, 보호책임자다. 2026-11-25 이전의 약관과 처리방침은 화면 코드(`MiscPages.tsx`) 안의 짧은 초안이었고 사업자 정보가 없었다. 저장소는 공개 저장소다(CLAUDE.md). 대표자 이름, 주소, 전화번호 같은 값은 운영자 개인의 정보이기도 하다.

## 결정

- 약관과 처리방침 본문은 `apps/web/src/lib/legal.ts` 에 두고, 사업자 정보와 문의처, 시행일은 웹 빌드 설정 `apps/web/.env` 의 `VITE_BIZ_*` 로 채운다. 이 파일은 저장소에 올리지 않는다.
- 키는 `VITE_BIZ_NAME`, `VITE_BIZ_REPRESENTATIVE`, `VITE_BIZ_REG_NO`, `VITE_BIZ_MAIL_ORDER_NO`, `VITE_BIZ_ADDRESS`, `VITE_BIZ_EMAIL`, `VITE_BIZ_PHONE`, `VITE_BIZ_PRIVACY_OFFICER`, `VITE_BIZ_EFFECTIVE_DATE` 다. 양식은 `apps/web/.env.example` 에 빈 값으로 둔다.
- 비어 있는 항목은 자리표시자를 띄우지 않고 그 항목을 빼고 보여 준다. 하나도 없으면 사업자 정보 줄 자체를 그리지 않는다.
- 결제 내역과 비밀번호 찾기 화면의 문의처는 서버 `SUPPORT_EMAIL` 을 먼저 쓰고, 없으면 `VITE_BIZ_EMAIL` 을 쓴다.
- 토스 미니앱 빌드도 `.env` 의 `VITE_BIZ_*` 를 함께 읽는다(2026-11-26 변경, 같은 값을 두 번 넣지 않게). 토스에서만 다른 항목은 별도 파일(`.env.toss` 등)의 `VITE_TOSS_BIZ_*` 로 덮어쓰고, 이 파일들도 저장소에서 뺀다.

## 근거

- 운영자 개인정보를 공개 저장소에 올리지 않기 위해서다(features/legal.md, `apps/web/.gitignore` 주석).
- 값을 바꿀 때 코드를 고치지 않아도 된다.
- `VITE_` 값은 번들에 그대로 들어가 브라우저에 공개되지만, 사업자 표시는 원래 화면에 공개하는 정보라서 문제가 없다고 보았다(features/legal.md).

## 결과와 영향

얻은 것:
- 저장소 기록에 사업자 정보가 남지 않는다. 공개 저장소의 커밋 이력에서 값을 지울 일이 생기지 않는다.
- 사업자 정보가 아직 없는 상태에서도 화면이 자리표시자 없이 동작한다.

감수한 것:
- 값이 빌드 시점에 번들로 들어가므로, 바꾼 뒤에는 다시 빌드하고 배포해야 화면에 반영된다.
- 빌드하는 곳에 `apps/web/.env` 가 있어야 한다. 웹 빌드에는 이 값이 비었을 때 경고하는 점검이 없어, 파일 없이 빌드하면 사업자 정보 줄이 경고 없이 빠진다. 토스 빌드만 `apps/web/scripts/check-toss-bundle.mjs` 가 빈 값을 경고한다.
- 웹과 토스에 같은 사업자 정보를 두 번 넣어야 한다. 토스 문서는 빈 값을 `(출시 전 입력)` 으로 채우므로 두 빌드의 동작도 다르다.
- 문의처 규칙이 화면마다 다르다. 약관·처리방침 본문은 `VITE_BIZ_EMAIL` 만 보므로 `SUPPORT_EMAIL` 만 넣으면 약관에는 문의 주소가 나오지 않는다(features/legal.md).

남은 일:
- 기준일(2026-11-26) 운영 빌드에는 `VITE_BIZ_*` 가 비어 있다. 처리방침의 개인정보 보호책임자 항목이 통째로 빠지고 문의처도 없다. 출시 전에 채워야 한다(features/legal.md).
- 웹 결제를 사업자 등록 없이 그로블로 시작했으므로([2026-10-groble-web-payments.md](./2026-10-groble-web-payments.md)), 사업자등록번호와 통신판매업 신고번호를 언제 갖출지는 기록에 없다. TODO: 확인 필요.
- 약관과 처리방침은 법무 검토를 받지 않은 초안이다.
