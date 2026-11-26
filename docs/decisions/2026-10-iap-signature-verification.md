# 인앱결제는 Apple JWS 서명 체인을 직접 검증하고 스토어 환불 알림을 받되, 인증서 폐기(OCSP)는 확인하지 않는다

- 날짜: 2026-10-15
- 상태: 채택 (앱 출시 전이라 운영에서는 아직 쓰이지 않는다)
- 관련 커밋:
  - `ae6492f` 첫 커밋: 앱 결제 서버 검증(`/payments/iap/verify`). Apple JWS 는 서명 확인 없이 디코드하고 x5c 체인 검증을 TODO 로 남김
  - `6c1b661` Apple JWS 서명 체인 검증, App Store Server Notifications V2·Google RTDN 환불 알림 수신
  - `5d8355e` 테스트용 가짜 Apple 인증서의 일련번호가 0x00 으로 시작해 가끔 실패하던 문제 수정
- 관련 문서: [PAYMENTS.md](../PAYMENTS.md) §1.3·§5.1·§8, [SECURITY_REVIEW.md](../SECURITY_REVIEW.md) 「인앱결제 서명 검증·스토어 환불 알림」, [ENV_KEYS.md](../ENV_KEYS.md), [features/payments.md](../features/payments.md)

## 맥락

첫 커밋의 인앱결제 검증은 앱이 보낸 Apple JWS 에서 거래 ID 만 꺼내고, 내용은 App Store Server API 로 다시 받았다. 그 응답의 JWS 도 서명을 확인하지 않고 디코드했다. 스토어에서 환불이 일어나도 서버가 알 방법이 없었다. 인앱결제 환불은 스토어가 처리하고 관리자 환불 API 는 인앱결제 주문을 거절하므로, 사용자가 스토어에서 환불받은 뒤에도 리포트와 질문권을 계속 쓸 수 있었다.

## 결정

- `apps/api/src/modules/commerce/providers/appleJws.ts` 에서 Apple JWS 를 직접 검증한다. 순서는 Apple 공식 app-store-server-library 의 SignedDataVerifier 규칙을 따른다.
  - alg 는 ES256, x5c 는 정확히 3장이다.
  - 중간 인증서는 코드에 내장한 Apple Root CA - G3(SHA-256 지문 고정)로 검증한다. x5c 에 실린 루트는 믿지 않는다.
  - 중간·루트가 CA 인지, 세 인증서의 유효기간, Apple 표식 OID(중간 `1.2.840.113635.100.6.2.1`, 리프 `1.2.840.113635.100.6.11.1`), 리프 키의 ES256 서명을 확인한다.
- 이 검증을 App Store Server API 응답, 알림의 `signedPayload`, 알림 안의 거래·갱신 정보에 모두 적용한다. bundleId 와 environment 도 대조한다.
- 인증서 확장 OID 는 새 의존성 없이 최소 DER 파서로 읽는다.
- 환불 알림을 받는다. Apple 은 App Store Server Notifications V2, Google 은 RTDN 을 Pub/Sub 푸시로 받는다. 환불·무효화 알림은 관리자 환불과 같은 `revokeOrder` 로 지급분을 회수한다. 알림 ID(notificationUUID, Pub/Sub messageId)로 멱등 처리한다.
- 인증서 온라인 폐기 확인(OCSP)은 하지 않는다.

## 근거

- 서명 검증이 없으면 위조한 알림이나 변조한 응답으로 지급과 회수를 조작할 수 있다(SECURITY_REVIEW.md 위협 표).
- OCSP 를 하지 않는 이유로 PAYMENTS.md §8 은 "Apple 공식 라이브러리의 선택 기능"이라고 적는다. SECURITY_REVIEW.md 는 이를 수용 항목으로 기록했다.
- Google 을 Voided Purchases API 정기 조회 대신 Pub/Sub 푸시로 받는 이유는 PAYMENTS.md §5.1 에 있다. 환불 직후 몇 초 안에 회수해 환불받은 질문권으로 AI 비용이 계속 나가지 않게 하고, 어느 인스턴스가 받아도 되며, 실패하면 Pub/Sub 이 재전송한다.
- 공식 라이브러리를 쓰지 않고 직접 구현한 이유로 커밋은 "새 의존성 없음"만 적는다. 더 자세한 이유는 기록에 없다. TODO: 확인 필요.

## 결과와 영향

얻은 것:
- 위조 알림, 다른 앱이나 다른 환경의 진짜 Apple 서명 데이터 재사용을 막는다.
- 스토어 환불이 서버에 반영된다. 회수는 `paid` 상태 조건부로 바꾸므로 관리자 환불, 결제사 웹훅, 스토어 알림이 겹쳐도 한 번만 일어난다. 앱이 검증하기 전에 환불된 거래는 표시해 두고 이후 검증을 402 `REVOKED` 로 거절한다.

감수한 것:
- Apple 리프 키가 유출되어 인증서가 폐기되어도 서버는 유효기간이 끝날 때까지 그 서명을 받아들인다(SECURITY_REVIEW.md 수용 항목).
- 인증서 체인 검증과 DER 파싱 코드를 직접 유지해야 한다. Workers 에서는 `nodejs_compat` 의 `node:crypto` X509Certificate 에 의존한다(`apps/api/wrangler.jsonc`).
- 내장 Apple Root CA - G3 는 2039-04-30 에 만료된다. Apple 이 루트를 바꾸면 인증서와 지문을 함께 교체해야 한다.
- Apple `CONSUMPTION_REQUEST` 에는 회신하지 않는다. 회신에 필요한 고객 동의 절차가 앱에 없어서 기록만 한다.

남은 일:
- 출시 뒤 검토할 항목으로 OCSP 폐기 확인, Pub/Sub 보관 기간을 넘는 장애에 대비한 Google Voided Purchases API 정기 대조, Google Play 구매의 서버 측 acknowledge 가 남아 있다(SECURITY_REVIEW.md 「남은 권장 사항」).
- App Store Server Notifications V2 URL 과 RTDN Pub/Sub 푸시 구독을 등록하고 테스트 알림이 200 으로 처리되는지 확인한다(PAYMENTS.md §8).
