# 로그인은 계정 단위 실패 제한을 따로 두고, 비밀번호 해시는 scrypt N=2^14 를 받아들인다

- 날짜: 2026-11-25
- 상태: 채택
- 관련 커밋:
  - `ae6492f` 첫 커밋: 비밀번호 해시 scrypt(N=16384, r=8, p=1), 요청 수 제한은 접속 IP 기준
  - `2a4b0b8` Cloudflare 로 옮기며 요청 수 제한을 Rate Limiting 바인딩으로 바꿈(2026-11-11)
  - `bb49fd7` 보안 점검 조치: 이메일 해시 단위 15분 10회 실패 제한(`login_failures`), 없는 계정도 더미 해시와 비교, scrypt 파라미터 유지 사유를 주석으로 남김
  - `464c569` 로그인 잠금 횟수를 운영 하루 요약에 넣음
- 관련 문서: [SECURITY_REVIEW.md](../SECURITY_REVIEW.md) 「운영 점검 (2026-11-25, daldalsaju.com)」, [features/auth.md](../features/auth.md), [architecture.md](../architecture.md) §9, [2026-11-cloudflare-workers-d1.md](./2026-11-cloudflare-workers-d1.md)

## 맥락

API 를 Cloudflare Workers 로 옮긴 뒤 요청 수 제한은 Rate Limiting 바인딩이 맡았다. 인증 경로는 접속 IP 당 60초에 10회, 그 밖의 API 는 120회다. 2026-11-25 운영 점검에서 이 바인딩이 매우 느슨하다는 것이 실측으로 확인되었다. 한도 5회로 만든 시험 Worker 에 42회를 보내 3회만 차단되었고, 운영 로그인 68회 실패가 막히지 않았다. 같은 점검에서 비밀번호 해시 scrypt 의 N=2^14 가 OWASP 권장값 N=2^17 보다 낮다는 점도 나왔다. 이 값은 Node 서버를 쓰던 첫 커밋부터 같았다.

## 결정

- 같은 이메일로 15분 안에 10번 틀리면 창이 끝날 때까지 그 이메일의 로그인을 429 로 막는다(`apps/api/src/modules/auth/loginThrottle.ts`). 비밀번호를 확인하기 전에 잠금부터 본다.
- 키는 이메일 원문이 아니라 정규화한 이메일의 SHA-256 이다(`login_failures` 테이블). 가입하지 않은 이메일도 똑같이 센다.
- 계정이 없어도 더미 해시와 비교해 응답 시간으로 가입 여부가 드러나지 않게 한다. 로그인에 성공하면 기록을 지운다.
- 실패 횟수는 한 문장의 upsert 로 올려 동시 요청에도 빠지지 않게 한다.
- IP 기준 제한은 Cloudflare 대시보드의 WAF Rate limiting 규칙으로 보완하기를 권장한다.
- 비밀번호 해시는 scrypt N=2^14, r=8, p=1 을 유지한다(`apps/api/src/lib/password.ts`).

## 근거

- IP 기준 제한은 실측에서 거의 동작하지 않았고, IP 를 바꾸면 피할 수 있다. 그래서 계정 단위 잠금을 실제 방어선으로 둔다(features/auth.md).
- OWASP 권장 N=2^17 은 한 번에 128MB 가 필요해 Workers isolate 메모리 한도(128MB)를 넘는다. N=2^14 는 약 16MB 다. SECURITY_REVIEW.md 는 이를 수용 항목으로 기록했다.
- 파라미터가 해시 문자열(`scrypt$N$r$p$salt$hash`)에 함께 저장되므로, 나중에 값을 올려도 기존 해시는 그대로 검증된다.

## 결과와 영향

얻은 것:
- IP 를 바꿔 가며 한 계정의 비밀번호를 맞히는 시도를 이메일 하나당 15분에 10번으로 묶는다.
- 막히는 동작과 응답 시간으로 계정이 있는지 알 수 없다.
- 해시 라이브러리를 새로 들이지 않고 `node:crypto` 의 scrypt 를 그대로 쓴다.

감수한 것:
- 남의 이메일로 일부러 10번 틀리면 그 계정을 15분 동안 잠글 수 있다. 무차별 대입을 막기 위해 받아들인 대가다(features/auth.md).
- 로그인 요청마다 D1 을 한 번 더 읽고, 실패하면 한 번 더 쓴다.
- 비밀번호 해시가 OWASP 권장값보다 약하다. 해시가 유출되면 오프라인 대입에 드는 비용이 권장값보다 작다.
- N 을 올려도 기존 회원의 해시는 옛 값으로 남는다. 로그인할 때 새 값으로 다시 해시하는 코드는 없다.

남은 일:
- Cloudflare 대시보드에서 `/api/v1/auth/` 에 IP 기준 WAF Rate limiting 규칙을 추가한다(SECURITY_REVIEW.md 운영자 할 일).
- 소셜 로그인 콜백과 Apple form-post 경로에는 인증 경로용 요청 수 제한이 붙어 있지 않다(features/auth.md).
- Workers 메모리 한도 안에서 scrypt 대신 다른 해시 방식을 검토했는지는 기록에 없다. TODO: 확인 필요.
