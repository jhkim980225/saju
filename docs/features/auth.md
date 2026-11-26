# 계정 · 인증

## 목적

"결과 먼저, 가입은 나중에"를 지키면서 결제한 내역은 잃지 않게 하는 것이 목적이다. 처음 온 사용자는 가입 없이 게스트 계정으로 사주 저장·상담·타로를 쓰고, 결제하려는 순간에 회원으로 바꾼다. 결제를 회원에게만 허용하는 이유는 게스트 계정이 기기 ID 에 묶여 있어서 기기를 바꾸거나 저장소를 지우면 산 것을 되찾을 길이 없기 때문이다.

토큰은 `Authorization: Bearer` 로만 주고받고 쿠키는 쓰지 않는다. 같은 API 를 웹과 Capacitor 앱이 함께 쓰기 위해서다. 전체 흐름 속 위치는 [../architecture.md](../architecture.md) 「결과 먼저, 가입은 나중에」를 본다.

| 기능 | 운영 상태 (FEATURES.md §0.2 기준, 2026-11-25) |
|---|---|
| 게스트 · 이메일 가입·로그인 · 비밀번호 변경 · 탈퇴 · 로그인 실패 잠금 | 운영 중 |
| 소셜 로그인 4종(카카오·네이버·구글·Apple) | 키 없어 꺼짐 |
| 비밀번호 재설정 메일(Resend) | 키 없어 꺼짐. 웹은 문의 안내로 대체하는데 문의 이메일도 비어 있다 |
| 앱의 토큰 보안 저장(Keychain·Keystore) · 앱 id_token 로그인 | 앱 전용(앱 출시 전) |
| 토스 로그인(`POST /auth/toss`) | 보류. [toss-miniapp.md](./toss-miniapp.md) |

## 사용자 흐름

| 화면 | 주소 | 들어오는 곳 |
|---|---|---|
| 로그인 · 가입 | `/login`, `/signup` | 첫 화면 오른쪽 위, 마이, 결제 시도(`?next=…&reason=purchase`) |
| 비밀번호 찾기 · 재설정 | `/password/forgot`, `/password/reset?token=` | 로그인 화면 링크, 메일 링크 |
| 소셜 로그인 복귀 | `/auth/callback/:provider` | 제공자 동의 화면 |
| 마이 | `/my` | 비밀번호 변경(이메일 계정만 보임)·로그아웃·탈퇴·글자 크기·화면 테마 |

1. **게스트 시작**: 탭 화면에 들어오거나 저장·오늘의 운세처럼 서버 데이터가 필요해지면 웹의 `ensureSession()` 이 기기 ID(`crypto.randomUUID`, 저장소에 보관)로 `POST /auth/guest` 를 부른다. 같은 기기 ID 는 같은 게스트를 돌려받는다. 동시에 여러 곳에서 불러도 요청은 하나로 합치고, 서버도 같은 기기의 첫 요청이 겹쳐 게스트가 둘 생기면 먼저 만든 하나만 남긴다(「게스트 시작이 겹칠 때」).
2. **가입**: 게스트 토큰을 붙인 채 가입하면 그 게스트 행을 회원으로 바꾼다. 사용자 ID 가 그대로라 저장한 사주와 기록이 남는다.
3. **기존 계정으로 로그인**: 게스트 토큰을 붙인 채 이미 있는 계정으로 로그인하면 게스트 데이터를 그 계정으로 옮기고 게스트를 정리한다(`mergeGuestInto`).
4. **결제 시도**: 회원이 아니면 웹이 결제 전에 `/login?next=…&reason=purchase` 로 보내고, 로그인 뒤 원래 화면으로 돌아온다. 결제 규칙은 [payments.md](./payments.md).
5. **소셜 로그인(웹, code 방식)**: 웹이 8자 이상 난수 `state` 를 저장소에 두고 `GET /auth/oauth/:provider/authorize` 로 받은 주소로 이동한다. 콜백 화면은 돌아온 `state` 가 저장한 값과 같을 때만 `POST /auth/oauth/:provider/callback` 을 부른다(로그인 CSRF 방지). 로그인 화면은 `/config` 의 `socialLogin` 이 켜진 제공자 버튼만 그린다.
6. **소셜 로그인(앱, id_token 방식)**: iOS Sign in with Apple 이나 Google Sign-In SDK 가 받은 `idToken` 을 콜백 본문에 넣으면 서버는 코드 교환 없이 서명·`iss`·`aud`·`exp` 만 검증한다. 공용 스키마에서 `code` 가 필수라 SDK 의 authorizationCode 나 아무 문자열을 넣는다. 카카오·네이버 SDK 의 access token 방식은 서버가 받지 않는다. 이 방식의 Apple 로그인은 Apple refresh_token 을 받지 못한다(알려진 이슈 6번).
7. **Apple 웹 로그인**: 이름·이메일을 요청하면 Apple 이 결과를 form_post 로 보내므로 서버의 `POST /auth/oauth/apple/form-post` 가 받아 웹 콜백으로 302 한다. 이름은 최초 로그인 때 한 번만 온다.
8. **비밀번호 찾기·재설정**: 메일이 켜져 있으면 이메일을 받아 30분짜리 일회용 링크를 보낸다. 메일이 꺼져 있으면 웹은 폼 대신 문의 안내를 보여 준다. 문의처는 `SUPPORT_EMAIL` 다음 `VITE_BIZ_EMAIL` 순서로 고른다.
9. **비밀번호 변경**: 마이에서 현재 비밀번호를 확인한 뒤 바꾼다. 다른 기기의 로그인은 끊기고, 지금 기기는 응답으로 받은 새 토큰으로 이어진다.
10. **로그아웃·탈퇴**: 로그아웃은 푸시 토큰 해제와 refresh token 폐기 뒤 세션을 지운다. 탈퇴는 마이 하단에서 한다(앱 심사 요건: [../APP_PORTING.md](../APP_PORTING.md) §11.2).

키 발급·콘솔 등록·Redirect URI 설정 절차는 옮기지 않는다. [../AUTH_PUSH.md](../AUTH_PUSH.md) §1~§4 와 [../ENV_KEYS.md](../ENV_KEYS.md) §4·§6 을 본다.

## 관련 파일

- 서버 라우트·서비스: `apps/api/src/modules/auth/routes.ts`, `apps/api/src/modules/auth/service.ts`(토큰 발급·회전, 재설정, 변경), `apps/api/src/modules/auth/oauth.ts`(제공자 4종), `apps/api/src/modules/auth/loginThrottle.ts`
- 사용자: `apps/api/src/modules/users/service.ts`(`createGuest`, `createEmailUser`, `upsertSocialUser`, `mergeGuestInto`, `deleteAccount`)
- 메일: `apps/api/src/modules/mail/service.ts`
- 토큰·비밀번호: `apps/api/src/lib/tokens.ts`, `apps/api/src/lib/password.ts`
- 인증 미들웨어와 요청 수 제한: `apps/api/src/app.ts`(`authenticate`, `optionalAuth`, `authLimit`), `apps/api/src/lib/http.ts`, `apps/api/wrangler.jsonc`(`ratelimits`)
- 스키마·마이그레이션: `apps/api/src/db/schema.ts`, `apps/api/drizzle/0001_login_failures.sql`, `apps/api/drizzle/0003_refresh_token_replaced_by.sql`, `apps/api/drizzle/0004_ops_alerts.sql`
- 토스 로그인(보류): `apps/api/src/modules/toss/auth.ts`
- 웹: `apps/web/src/lib/session.ts`, `apps/web/src/lib/api.ts`(401 재시도·refresh), `apps/web/src/pages/AuthPages.tsx`, `apps/web/src/pages/PasswordPages.tsx`, `apps/web/src/pages/MyPage.tsx`, `apps/web/src/hooks/usePurchase.ts`
- 앱: `apps/web/src/native/storage.ts`(세션 보안 저장)
- 테스트: `apps/api/test/login-throttle.test.ts`, `password.test.ts`, `oauth-push.test.ts`, `security.test.ts`, `idempotency.test.ts`, `concurrency.test.ts`(게스트 시작 경쟁 포함), `rate-limit.test.ts`, `apps/web/src/native/__tests__/storage.test.ts`

## API / 데이터 모델

요청·응답 형식은 [../API.md](../API.md) 「인증 · 회원」 표를 본다. 여기서는 데이터가 왜 그런 모양인지만 적는다.

- `users.provider`: `guest | email | kakao | naver | google | apple | toss`. 회원 판정은 `provider !== 'guest'` 다. `(provider, provider_user_id)` 와 `email` 은 유니크다.
- `users.provider_refresh_token`: Apple 회원 탈퇴 때 토큰 철회에 쓰는 Apple refresh_token 이다.
- `users.registered_at`: 회원이 된 시각이다. 게스트는 null 이고, 게스트에서 전환하면 전환 시각이 들어간다. 운영 요약의 가입 수를 세는 데 쓴다.
- `users.deleted_at`: 탈퇴·병합으로 정리된 행이다. 행을 지우지 않는 이유는 주문과 질문권 원장이 이 행을 참조하기 때문이다.
- `refresh_tokens`: 원문 대신 SHA-256 해시만 저장한다. `replaced_by` 는 회전할 때 이어 받은 토큰 행 ID 로, 동시 갱신과 탈취를 구분하는 데 쓴다.
- `password_resets`: 토큰 해시, 만료 시각, 사용 시각을 둔다.
- `login_failures`: 이메일 원문 대신 정규화한 이메일의 SHA-256 을 키로 실패 횟수와 집계 창 시작 시각을 둔다.
- access token 은 HS256 JWT(`iss=saju-api`, `sub`, `role`, `provider`)이고 운영에서는 시크릿이 32자 이상이어야 기동한다.

## 비즈니스 규칙 & 엣지케이스

**입력 한도**: 이메일 120자, 비밀번호 8~72자, 닉네임 1~20자, 기기 ID 8~128자다. 게스트 닉네임은 '별빛1234' 같은 임의 값이다. 이미 있는 이메일로 가입하면 409 "이미 가입된 이메일이에요" 다. 가입 여부가 드러나지만 사용성을 위해 받아들였다([../SECURITY_REVIEW.md](../SECURITY_REVIEW.md) 운영 점검의 수용 항목).

**게스트 시작이 겹칠 때**: 살아 있는 게스트의 `device_id` 에 부분 유니크 인덱스(`users_guest_device_uq`, `provider='guest' AND deleted_at IS NULL`)가 있다. 같은 기기의 첫 요청이 동시에 오면 나중 저장은 `ON CONFLICT DO NOTHING` 으로 건너뛰고, `createGuest` 가 먼저 만든 게스트를 돌려준다. 겹친 요청 모두가 같은 계정을 받는다. 게스트가 회원으로 전환되거나 병합·탈퇴되면 조건에서 빠지므로 같은 기기에서 새 게스트를 만들 수 있다.

**게스트 전환은 한 번만 일어난다**: `convertGuest` 는 "아직 게스트이고 삭제되지 않았을 때만" 조건부로 바꾸고, 바꿨을 때만 가입 보너스(`SIGNUP_BONUS_CREDITS`, 운영 0)를 준다. 가입 버튼을 두 번 눌러 요청이 겹치면 한쪽은 201, 다른 쪽은 409 다.

**소셜 계정과 이메일**: 같은 제공자·같은 사용자 ID 의 회원이 있으면 그 계정으로 로그인한다. 처음 보는 소셜 계정인데 같은 이메일의 다른 계정이 있으면 이메일을 비운 새 계정을 만들고 자동으로 합치지 않는다. 이메일은 검증된 것만 저장한다(구글 `email_verified`, 카카오 `is_email_valid`·`is_email_verified`). 같은 소셜 계정의 첫 로그인이 동시에 두 번 오면 유니크 충돌이 난 쪽이 먼저 만든 계정으로 로그인한다. 소셜 로그인 실패는 401 "카카오 로그인에 실패했어요…" 형태이고 원인은 서버 로그에만 남긴다. 외부 호출 제한 시간은 10초다.

**로그인 실패 잠금**: 같은 이메일로 15분 안에 10번 틀리면 창이 끝날 때까지 429 다. 비밀번호를 확인하기 전에 잠금부터 본다. 없는 이메일도 똑같이 세고, 계정이 없어도 더미 해시와 비교해 응답 시간으로 가입 여부가 드러나지 않게 한다. 성공하면 기록을 지운다. 이렇게 한 이유는 Cloudflare Rate Limiting 바인딩이 실측에서 매우 느슨했고(로그인 68회 실패가 막히지 않음) IP 를 바꾸면 피할 수 있기 때문이다.

의도된 동작: 남의 이메일로 일부러 10번 틀리면 그 계정을 15분 동안 잠글 수 있다. 잠금을 (이메일, IP) 단위로 바꾸면 IP 를 바꿔 가며 한 계정을 맞히는 공격을 막지 못하고, 이 서비스의 위험은 계정 탈취 쪽이 15분 로그인 불가보다 크다고 봐서 계정 단위를 유지한다. 잠겨도 이미 로그인한 기기의 세션은 그대로이고 15분 뒤 풀린다. 잠금이 몰리면 운영 알림(`loginLocked`)으로 알 수 있다.

**게스트 병합(`mergeGuestInto`)**: 이메일·소셜·토스 로그인에서 기존 계정으로 들어올 때 실행한다.

- 옮기는 것: 프로필(대표 표시는 끈다), 리포트(택일 결과 포함), 상담 기록, 타로 기록, 무상 질문권이다. 질문권은 두 원장에 각각 이동 기록(`reason=admin`)을 남긴다.
- 타로 기록은 (사용자, 날짜, 질문) 유니크라 회원이 같은 날 같은 질문을 이미 뽑았으면 회원 것을 남기고 게스트 것은 지운다.
- 옮기지 않는 것: 주문·열람 권한·유상 질문권이다. 게스트는 결제할 수 없어서 옮길 것이 없다.
- 게스트 행은 기기 ID 를 비우고 '병합된 게스트'로 삭제 처리한다. 그래서 같은 기기의 다음 게스트는 새 계정이 된다.
- 전체를 `atomic` 하나로 묶고 "게스트가 아직 그대로이고 질문권 잔액도 읽은 값과 같다"를 실행 시점에 확인한다. 로그인이 겹쳐도 질문권이 두 번 옮겨지지 않는다.
- 함정: D1 batch 는 인자가 있는 `db.run(sql)` 을 실행하지 못한다. 타로 중복 정리를 `update or ignore` 원시 SQL 로 썼다가 운영에서 500 이 났고, 쿼리 빌더 두 문장(조건부 delete 다음 update)으로 바꿨다([../architecture.md](../architecture.md) 「D1 동시성」).

**토큰 수명과 회전**: access token 1시간, refresh token 30일이다(`ACCESS_TOKEN_TTL_SEC`, `REFRESH_TOKEN_TTL_DAYS`). refresh 는 쓸 때마다 새로 바꾼다. 이미 폐기된 refresh 가 다시 오면 탈취로 보고 그 사용자의 모든 세션을 끊는다. 단, 방금(30초 안, `REFRESH_REUSE_GRACE_MS`) 회전된 토큰이고 이어 받은 토큰이 아직 살아 있으면 두 탭의 동시 갱신이나 응답 유실로 보고 새 토큰을 준다. 로그아웃·비밀번호 변경으로 끊긴 세션은 이어 받은 토큰도 폐기돼 있어서 이 유예를 받지 못한다.

의도된 동작: 유예 안에서 회전된 토큰을 다시 쓰면 탈취로 판정하지 않고 토큰을 하나 더 주므로, 그 세션은 두 갈래로 계속 유효할 수 있다. 유예가 없으면 두 탭의 동시 갱신이나 응답 유실 한 번으로 사용자의 모든 세션이 끊긴다. 탈취한 토큰을 이 30초 안에, 원래 사용자의 회전 직후에 맞춰 써야만 이득을 보므로 위험이 작다고 보고 유예를 유지한다. 비밀번호를 바꾸거나 로그아웃하면 두 갈래 모두 끊긴다. 탈퇴했거나 병합된 계정의 access token 은 `authenticate` 가 바로 401 로 막는다.

**웹의 다중 탭**: 다른 탭이 토큰을 바꾸거나 로그아웃하면 `storage` 이벤트로 따라가고, 갱신 직전에 저장소를 다시 읽어 이미 회전된 토큰을 쓴다. 갱신 요청도 탭 안에서 하나로 합친다. 401 이 오면 refresh 로 한 번만 다시 시도하고, 갱신이 실패하면 세션을 지운다.

**앱의 토큰 저장**: 앱은 세션을 평문 Preferences 대신 iOS Keychain(`afterFirstUnlockThisDeviceOnly`, iCloud 동기화 없음)과 Android Keystore 로 암호화한 저장소에 둔다. 예전 평문 사본은 보안 저장소 기록이 성공한 뒤에만 지워서 업데이트로 로그아웃되지 않는다. 값이 바뀌면 남은 평문 사본도 지우는데, 회전 전 refresh 가 다음 실행에 쓰이면 재사용 탐지로 모든 세션이 끊기기 때문이다. 보안 저장소 오류는 "세션 없음"으로 처리해 다시 로그인하게 한다. 재설치하면 iOS Keychain 에 남은 세션도 버린다. 자세한 동작: [../APP_PORTING.md](../APP_PORTING.md) §0.3.

**비밀번호 재설정**:

- 메일이 켜져 있으면 가입 여부와 관계없이 200 을 준다. 이메일 계정(`provider=email`)일 때만 32바이트 토큰을 만들어 해시를 저장하고, 같은 사용자의 이전 미사용 링크는 지운다. 소셜·게스트 계정은 조용히 끝낸다.
- 메일 발송은 응답 뒤(`waitUntil`)에 한다. 계정이 있을 때만 발송 시간이 더해져 응답 시간으로 가입 여부가 드러나는 것을 막기 위해서다.
- 메일이 꺼져 있으면 501 `NOT_CONFIGURED` 다. 웹은 `/config` 의 `features.mail=false` 를 보고 폼 대신 문의 안내를 보여 준다.
- 링크는 30분 동안 한 번만 쓸 수 있다. 같은 링크가 동시에 두 번 쓰이지 않게 "아직 쓰지 않음"을 `atomic` 의 조건으로 확인한다. 만료·사용됨·탈퇴는 400 "링크가 만료됐거나 이미 사용됐습니다…" 다.
- 재설정에 성공하면 그 사용자의 refresh token 을 모두 폐기한다. 이미 발급된 access token 은 만료(최대 1시간)까지 유효하다.
- 테스트 환경에서는 메일을 보내지 않고 `mail.outbox` 에 쌓아 테스트가 본문에서 토큰을 읽는다.

**비밀번호 변경**: 이메일 계정만 된다(그 밖은 400). 현재 비밀번호가 틀리면 400 이다. 바꾸면 그 사용자의 refresh token 을 모두 폐기하고 지금 기기에 새 토큰을 준다. 웹은 응답의 토큰으로 세션을 바꾼다.

**회원 탈퇴**:

- Apple 로그인 회원이면 저장해 둔 Apple refresh_token 으로 토큰 철회를 먼저 요청한다. 철회가 실패해도 탈퇴는 진행한다.
- 한 batch 로 프로필, 리포트(택일 포함), 상담, 타로 기록(질문 글 포함), 열람 권한, 비밀번호 재설정 기록, refresh token, 푸시 토큰을 지운다.
- 사용자 행은 이메일·비밀번호·소셜 ID·Apple 토큰·기기 ID 를 비우고 닉네임을 '탈퇴한 사용자'로 바꿔 남긴다.
- 주문·결제 기록과 질문권 원장은 전자상거래법 보존 의무(5년) 때문에 익명화된 행에 남긴다.

**요청 수 제한**: 운영 모드에서만 접속 IP 기준 60초 창으로 건다. 인증 경로(`/signup`, `/login`, `/password/*`, `/toss`, 소셜 콜백 `/oauth/:provider/callback`, Apple `/oauth/apple/form-post`)는 10회(`authLimit`)다. 게스트 시작·토큰 갱신(`/auth/guest`, `/refresh`)은 비밀번호를 맞히는 경로가 아니라 세션 제한(`sessionLimit`, 60회)을 쓰고, 그 밖의 API 는 120회다. 이 제한은 느슨하므로 계정 단위 잠금이 실제 방어선이다.

**비밀번호 해시**: scrypt N=2^14 이다. OWASP 권장 N=2^17 은 한 번에 128MB 가 필요해 Workers isolate 한도를 넘는다. 파라미터가 해시 문자열에 함께 저장되므로 나중에 올려도 기존 해시는 그대로 검증된다.

**AI**: 인증 기능은 AI 를 쓰지 않는다.

## 주의사항 / 알려진 이슈

1. 소셜 로그인 4종이 키 없이 꺼져 있다. 로그인 화면에는 이메일 로그인만 보인다(외부 작업: 키 발급).
2. 비밀번호 재설정 메일이 꺼져 있고 `SUPPORT_EMAIL`·`VITE_BIZ_EMAIL` 도 비어 있다. `/password/forgot` 에는 받는 주소가 없는 `mailto:` '문의하기' 링크만 보인다. 지금은 비밀번호를 잊은 사용자가 스스로 복구할 방법이 없다(외부 작업: Resend 키나 문의 이메일 설정).
3. 해결(2026-11-26, 문서만): 비밀번호 변경 때 "현재 세션 유지"라고 적힌 API.md·AUTH_PUSH.md §5 를 코드에 맞게 "다른 기기의 로그인은 끊기고 지금 기기는 응답의 새 토큰으로 이어진다"로 고쳤다. 예전 FEATURES.md §13 의 설명은 이 문서로 옮겨지며 없어졌다.
4. 해결(2026-11-26, 문서만): AUTH_PUSH.md §5 를 코드에 맞게 고쳤다. 소셜·이메일·토스 로그인 모두 기존 계정으로 들어오면 `mergeGuestInto` 로 게스트 데이터를 옮기고, 게스트는 결제할 수 없다(403).
5. 해결(2026-11-26, 문서만): AUTH_PUSH.md §3-2 의 "라우트가 네이버에 `state` 를 넘기지 않는다"를 지금 동작(콜백 라우트가 `state: body.state` 를 넘긴다)으로 고쳤다. AUTH_PUSH.md §3-4 7번과 APP_PORTING.md 의 "Apple 탈퇴 토큰 철회는 서버 TODO" 는 웹 code 방식은 구현됐고 앱 id_token 방식만 남았다고 고쳤다.
6. iOS 앱 출시 전에 처리할 일(지금은 Apple 로그인 꺼짐): 앱의 Apple id_token 방식 로그인은 서버가 코드 교환을 하지 않아 Apple refresh_token 을 받지 못한다. 그래서 앱에서 Apple 로 가입한 회원이 탈퇴하면 토큰 철회가 실행되지 않는다(App Store 심사 5.1.1(v) 요건). id_token 과 함께 온 authorizationCode 를 번들 ID 를 client_id 로 교환해 refresh_token 을 저장하고, 탈퇴 때 같은 client_id 로 철회해야 한다. 운영에 `APPLE_*` 키가 없고 iOS 앱도 출시 전이라 2026-11-26 사용자 결정으로 지금은 고치지 않는다.
7. 의도된 동작: 계정 단위 잠금은 남의 이메일로 일부러 10번 틀려 그 계정을 15분 동안 잠글 수 있다. 유지하는 이유는 「로그인 실패 잠금」에 적었다.
8. 의도된 동작: refresh 30초 유예 안에서는 회전된 토큰을 다시 써도 탈취로 판정하지 않고 토큰을 하나 더 준다. 유지하는 이유는 「토큰 수명과 회전」에 적었다.
9. 해결(2026-11-26): 소셜 콜백(`/auth/oauth/:provider/callback`)과 Apple form-post 경로에 인증 경로용 요청 수 제한(`authLimit`)을 붙였다. 회귀 테스트: `rate-limit.test.ts`.
10. 해결(2026-11-26): 같은 기기의 첫 게스트 요청 두 개가 동시에 오면 게스트가 둘 생기던 경쟁을 고쳤다. 부분 유니크 인덱스 `users_guest_device_uq`(마이그레이션 0005)로 DB 가 하나만 남긴다(「게스트 시작이 겹칠 때」). 회귀 테스트: `concurrency.test.ts`.
11. 해결(2026-11-26): 쓰이지 않던 공용 스키마 `signupSchema.guestToken` 을 지웠다. 게스트 데이터를 이어받으려면 게스트 토큰을 `Authorization` 헤더에 붙인 채 가입한다.
12. 죽은 코드(이번에는 유지): `UserDto.isPremium`·`premiumUntil` 과 마이 화면의 '플러스' 배지는 구독 상품이 없어 켜지지 않는다. 여러 도메인에 걸쳐 있어 따로 정리한다(FEATURES.md §22.2 11번, 결제 쪽은 [payments.md](./payments.md)).
13. 게스트 모드의 한계: 공용 기기에서 가입 전에 저장한 게스트 데이터는 그 기기에 남는다([../SECURITY_REVIEW.md](../SECURITY_REVIEW.md) 15번).
14. 해결됨: 탈퇴 때 타로 기록·열람 권한·재설정 기록도 지운다. 기존 계정 로그인 때 타로 기록과 무상 질문권도 옮긴다(FEATURES.md §22.2 12·13번).
15. 운영자 할 일: Cloudflare 대시보드에서 최소 TLS 1.2 설정과 `/api/v1/auth/` IP 기준 WAF Rate limiting rule 추가를 권장했다. TODO: 확인 필요(적용 여부).
