# 약관 · 개인정보 처리방침 · 면책

> 기준일: 2026-11-26. `feat/cloudflare` 작업 트리의 코드를 기준으로 적었다. 이 문서는 [FEATURES.md](../FEATURES.md) §19와 §22 중 약관·처리방침 항목(16·17번)을 대체한다. 환불 처리 방법 자체는 [payments.md](payments.md)에 있다.

## 목적

유료 디지털 콘텐츠를 파는 서비스로서 이용 조건, 청약 철회와 환불, 개인정보 처리, 사주·운세가 참고 정보라는 점을 알린다. 결제 직전에는 환불 조항에 동의한다는 문구를 보여 준다. 본문은 법무 검토를 받지 않은 초안이다.

| 기능 | 운영 상태 |
|---|---|
| 이용약관·처리방침·면책 화면 | 운영 중 |
| 사업자 정보(`VITE_BIZ_*`) | 비어 있음. 약관·처리방침·첫 화면에 사업자 정보 줄이 나오지 않는다 |
| 법무 검토 | 하지 않음 |

## 사용자 흐름

1. **화면**: `/legal/terms`(이용약관), `/legal/privacy`(개인정보 처리방침), `/legal/disclaimer`(면책 고지). 모르는 문서 이름은 이용약관을 보여 준다.
2. **들어오는 곳**: 첫 화면 하단(이용약관·처리방침 링크와, 값이 있으면 사업자 정보 줄), 마이 화면(세 문서 모두), 이메일 가입 폼(이용약관·처리방침 동의 체크가 없으면 가입하지 않고 동의를 요청한다), 결제 내역 화면(이용약관).
3. **결제 직전**: 결제 시트(`PaywallSheet`)와 상점(`StorePage`) 아래에 "결제하면 이용약관(제5조 청약 철회와 환불 포함)에 동의한 것으로 봐요." 문구가 있다(`TermsConsent`). "이용약관(제5조 …)" 부분은 `/legal/terms` 링크다. 상점은 "결제 금액은 부가세 포함이에요."를 덧붙인다.
4. **결과마다 붙는 면책**: 사주 결과·리포트·타로·택일·꿈풀이·토정비결·띠별·별자리 응답에 각자 면책 문구가 붙는다(예: `TAROT_DISCLAIMER`, `TAEKIL_DISCLAIMER`).
5. **토스 미니앱**: 토스 빌드는 토스용 약관·처리방침(해요체, 토스 인앱결제 기준)을 등록해 쓰고, 웹 약관 본문은 번들에서 뺀다([toss-miniapp.md](toss-miniapp.md)).
6. **약관 변경 공지**: 서버 `SERVICE_NOTICES` 에 공지를 넣으면 `GET /config` 의 `notices` 로 나가고, 웹·앱·토스 화면 위쪽에 `NoticeBar` 가 하나씩 띄운다. 닫으면 그 공지는 그 기기에서 다시 띄우지 않는다(`yd.noticesSeen`).

## 관련 파일

| 구분 | 경로 |
|---|---|
| 웹·앱 약관·처리방침 본문, 사업자 정보 | `apps/web/src/lib/legal.ts`(`webTerms`, `webPrivacy`, `businessLine`, `BUSINESS`) |
| 화면 | `apps/web/src/pages/MiscPages.tsx`(`LegalPage`, `legalDocs`, 문의처는 `useConfig` 의 `supportEmail`) |
| 사업자 정보 줄 | `apps/web/src/pages/LandingPage.tsx`(`BIZ_LINE`) |
| 문의처 표시 | `apps/web/src/pages/PaymentsPage.tsx`, `apps/web/src/pages/PasswordPages.tsx`(`ContactNotice`) |
| 결제 동의 문구·면책 문구 | `apps/web/src/components/TermsConsent.tsx`, `apps/web/src/i18n/ko.json`(`paywall.termsBefore`·`termsLink`·`termsAfter`, `disclaimer.*`), `apps/web/src/components/PaywallSheet.tsx`, `apps/web/src/pages/StorePage.tsx` |
| 약관 변경 공지 | `apps/api/src/config/env.ts`(`SERVICE_NOTICES`), `apps/api/src/modules/config/routes.ts`(`notices`), `apps/web/src/components/NoticeBar.tsx`, `apps/web/src/App.tsx`(`RootLayout`) |
| 가입 동의 | `apps/web/src/pages/AuthPages.tsx`(`AuthForm`) |
| 토스용 문서 | `apps/web/src/toss/legal.ts`, `apps/web/src/lib/tossBridge.ts`(`registerLegalDocs`, `legalDocOverride`), `apps/web/src/toss/bootstrap.ts` |
| 빌드 설정 예시 | `apps/web/.env.example`(`VITE_BIZ_*`) |
| 서버 문의처 | `apps/api/src/config/env.ts`(`SUPPORT_EMAIL`), `apps/api/src/modules/config/routes.ts`(`supportEmail`) |
| 서버 면책 문구 예 | `apps/api/src/modules/tarot/reading.ts`(`TAROT_DISCLAIMER`), `apps/api/src/modules/taekil/content.ts`(`TAEKIL_DISCLAIMER`) |
| 테스트 | `apps/web/src/toss/__tests__/haeyo-tone.test.ts`(토스 문서 문체) |

## API / 데이터 모델

약관 본문은 웹 번들 안의 문자열이라 API 를 쓰지 않는다. 서버에서 오는 값은 `GET /config` 의 `supportEmail`(`SUPPORT_EMAIL`, 약관 문의처)과 `notices`(`SERVICE_NOTICES`, 약관 변경 공지)다.

**공지 형식**(`SERVICE_NOTICES`, 서버 vars 또는 시크릿): `[{"id":"terms-2027-01","title":"이용약관이 바뀌어요","body":"2027년 1월 8일부터 …"}]`. 최대 5개, 제목 100자, 본문 1,000자. 형식이 틀리면 공지 없이 기동하고 `[config]` 오류 로그를 남긴다.

**사업자 정보 키**(웹 빌드 `apps/web/.env`): `VITE_BIZ_NAME`(상호), `VITE_BIZ_REPRESENTATIVE`(대표자), `VITE_BIZ_REG_NO`(사업자등록번호), `VITE_BIZ_MAIL_ORDER_NO`(통신판매업 신고번호), `VITE_BIZ_ADDRESS`, `VITE_BIZ_EMAIL`, `VITE_BIZ_PHONE`, `VITE_BIZ_PRIVACY_OFFICER`(개인정보 보호책임자), `VITE_BIZ_EFFECTIVE_DATE`(시행일, 없으면 `2026-11-25`). 토스 빌드도 같은 값을 쓰고, 토스에서만 다르게 보일 항목만 `.env.toss` 의 `VITE_TOSS_BIZ_*` 로 덮어쓴다. 목록은 [ENV_KEYS.md §7](../ENV_KEYS.md).

## 비즈니스 규칙 & 엣지케이스

**사업자 정보를 빌드 설정으로 받는 이유**

- 대표자 이름·주소·전화 같은 운영자 개인정보를 공개 저장소에 올리지 않기 위해서다. 값은 저장소에 없는 `apps/web/.env` 에만 둔다.
- 값을 바꿔도 코드를 고치지 않는다. 다만 빌드 시점에 번들로 들어가므로, 바꾼 뒤에는 다시 빌드·배포해야 화면에 반영된다.
- `VITE_` 값은 브라우저에 그대로 공개된다. 사업자 표시는 원래 공개하는 정보라 문제가 없지만, 같은 파일에 비밀 값을 넣지 않는다.
- 비어 있는 항목은 자리표시자를 띄우지 않고 그 항목을 빼고 보여 준다. 하나도 없으면 사업자 정보 줄 자체가 없다.

**이용약관**(제1조~제14조): 목적, 서비스의 성격(참고 정보이며 의료·법률·투자 자문이 아님), 계정(게스트·회원, 결제는 회원만), 유료 콘텐츠와 결제(웹은 그로블 결제창, 앱은 앱스토어 인앱결제), 청약 철회와 환불, 환불 절차, 무료 기능과 광고, 생성형 AI, 이용자의 의무, 탈퇴와 데이터 삭제, 서비스의 변경과 중단, 책임의 한계, 약관의 변경(7일 전, 불리한 변경은 30일 전에 서비스 화면 위쪽의 공지로 알림), 문의와 분쟁 해결.

**제5조(청약 철회와 환불)**: 결제 동의 문구가 가리키는 조항이다.

- 구매한 날부터 7일 안에, 열어 보지 않은 유료 콘텐츠는 청약을 철회할 수 있다.
- 열람이 시작된 콘텐츠는 전자상거래법 제17조 제2항에 따라 청약 철회가 제한될 수 있다. 구매 전에 무료 풀이로 내용을 미리 볼 수 있게 한 것이 이 제한의 전제다.
- AI 상담 질문권은 쓰지 않은 유상 질문권만큼 환불을 요청할 수 있고, 함께 받은 무상 질문권은 환불 대상이 아니다.
- 표시·광고와 다르거나 결제했는데 열리지 않으면 받은 날부터 3개월, 그 사실을 안 날부터 30일 안에 환불을 요청할 수 있다.
- 미성년자가 법정대리인 동의 없이 결제한 경우 본인이나 법정대리인이 취소할 수 있다.
- 환불이 끝나면 해당 콘텐츠와 함께 받은 질문권을 회수한다.

별도의 환불 정책 문서는 두지 않고 제5조·제6조가 그 역할을 한다.

**개인정보 처리방침**: 처리 항목(회원 정보, 사주 입력, AI 질문·꿈 내용·타로 질문 등 이용 기록), 이용 목적, 보유와 파기(탈퇴 즉시 삭제, 결제 기록은 5년간 식별할 수 없게 보관, D1 복원 지점에 최대 30일 잔존), 제3자 제공 없음, 처리 위탁(Cloudflare, Anthropic, 그로블, 쓰는 경우 Resend, 앱 알림의 Google Firebase Cloud Messaging, 앱 보상형 광고의 Google AdMob, 분석·광고 측정의 Google·Meta·카카오), 국외 이전(Cloudflare, Anthropic, FCM, AdMob, 분석·광고 측정), 행태정보와 쿠키, 카카오톡 공유(이름·생년월일·태어난 시각은 공유하지 않음), 권리 행사, 만 14세 미만, 안전성 조치, 보호책임자(값이 있을 때만), 신고 기관을 담는다. 변경은 적용일 7일 전부터 서비스 화면 위쪽의 공지로 알린다.

**문의처**: 약관·처리방침 본문과 결제 내역·비밀번호 찾기 화면 모두 서버 `SUPPORT_EMAIL`(`GET /config` 의 `supportEmail`)을 먼저 쓰고, 없으면 `VITE_BIZ_EMAIL` 을 쓴다. 둘 다 없으면 약관 본문은 "서비스 안의 문의 안내"라고 쓴다. 처리방침 보호책임자 줄의 이메일도 같은 규칙이다.

**면책 고지**: `/legal/disclaimer` 는 i18n 의 `disclaimer.full`·`health`·`finance`·`ai` 문구를 이어 보여 준다. 웹·토스 빌드가 같은 문구를 쓴다.

## 주의사항 / 알려진 이슈

1. **사업자 정보가 비어 있다**: 그래서 약관·처리방침에 사업자 정보 줄이 없고, 처리방침의 개인정보 보호책임자 항목(12번)도 통째로 빠진다. 보호책임자 지정·공개는 처리방침의 필수 항목이므로 출시 전에 채운다. 남김(외부 작업): 실제 값은 운영자가 gitignore 된 `apps/web/.env` 에만 넣는다. 문의처는 서버 `SUPPORT_EMAIL` 만 넣어도 약관·처리방침·결제 내역·비밀번호 찾기에 모두 나온다.
2. **법무 검토 전이다**: 남김(외부 작업). `legal.ts` 머리 주석도 초안이라고 적는다.
3. 해결(2026-11-26): **결제 동의 문구에 약관 링크가 없던 문제**. 결제 시트와 상점이 `TermsConsent` 를 써서 "이용약관(제5조 청약 철회와 환불 포함)" 부분을 `/legal/terms` 링크로 건다.
4. 해결(2026-11-26): **약관 본문 문의처가 `SUPPORT_EMAIL` 을 반영하지 않던 문제**. `LegalPage` 가 `GET /config` 의 `supportEmail` 을 `webLegalDocs` 에 넘기고, 약관·처리방침의 문의처와 보호책임자 이메일이 서버 값을 먼저 쓴다. 웹 화면들과 ENV_KEYS §7 의 규칙이 같아졌다.
5. 해결(2026-11-26): **약관 변경을 알릴 수단이 없던 문제**. 서버 `SERVICE_NOTICES` 를 `GET /config` 의 `notices` 로 내보내고, 웹·앱·토스 화면 위쪽의 `NoticeBar` 가 띄운다. 약관 제13조와 처리방침 끝 문장을 "서비스 화면 위쪽의 공지로 알린다"로 실제 통로에 맞췄다. 시행일은 여전히 `VITE_BIZ_EFFECTIVE_DATE`(없으면 코드 상수 `2026-11-25`)이고, 약관을 바꿀 때 공지와 함께 이 값을 새 시행일로 바꿔 다시 배포한다. 이메일 등 개별 통지 수단은 없다.
6. 해결(2026-11-26): **처리방침 위탁·국외 이전 목록이 앱 기능을 다 담지 않던 문제**. 5번 위탁에 Google LLC(Firebase Cloud Messaging, AdMob)를 따로 적고, 6번 국외 이전에 FCM(푸시 토큰, 대표 사주의 이름·별명과 오늘의 운세 한 줄)과 AdMob(광고 식별자, 회원 번호)을 넣었다. 거부 방법(알림 끄기, 보상형 광고 보지 않기)도 적었다.
7. 해결(2026-11-26): **탈퇴 즉시 삭제 약속과 다른 데이터가 있던 문제**. 탈퇴(`deleteAccount`)가 요청 ID 선점 기록(꿈풀이 결과 포함)과 토스 날짜 열기 기록을 같은 묶음 안에서 지운다. 남은 선점 기록도 2일 뒤 정리된다. AdMob 보상 기록에는 사용자 ID 를 남기지 않고 30일 뒤 지운다([ops.md](ops.md)). 결제 웹훅 기록(결제사 원문)은 결제 분쟁 대응을 위해 180일 보관한다.
8. 해결(2026-11-26): **토스 문서가 사업자 정보를 따로 받던 문제**. `apps/web/src/toss/legal.ts` 가 `.env` 의 `VITE_BIZ_*` 를 함께 읽어 웹과 같은 값을 한 번만 넣으면 되고, `VITE_TOSS_BIZ_*` 는 토스에서만 다를 때 덮어쓰는 용도로 남겼다. 둘 다 비면 `(출시 전 입력)` 자리표시자를 보이는 것은 의도된 동작으로 유지한다(토스 심사에 사업자 정보가 필요해 비어 있음을 드러내고, `check-toss-bundle.mjs` 가 경고한다).
9. 해결(2026-11-26): **카카오톡 공유 고지가 실제보다 좁던 문제**. 공유 문구에서 프로필 이름과 일주를 빼고([ads-analytics.md](ads-analytics.md)), 처리방침 8번을 "결과 제목(사주 풀이의 별칭 등)·요약·링크, 이름과 생년월일·태어난 시각은 공유하지 않음"으로 고쳤다.
