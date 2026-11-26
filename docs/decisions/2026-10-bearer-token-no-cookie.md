# 쿠키 대신 Bearer JWT 로 인증하고 앱은 토큰을 보안 저장소에 둔다

- 날짜: 2026-10-15 (Bearer 방식은 첫 커밋에 이미 들어 있다. 앱 보안 저장소 이전도 같은 날이다)
- 상태: 채택
- 관련 커밋:
  - `ae6492f` 첫 커밋: REST `/api/v1`, Bearer JWT, 쿠키 미사용
  - `2400f56` 앱 세션 토큰을 Keychain/Keystore 보안 저장소로 이전
  - `bb49fd7` 비밀번호 변경 때 다른 기기 세션 폐기, 기본 CSP, 개인 응답 `no-store`
  - `464c569` refresh token 교체 기록(`replaced_by`)으로 동시 갱신 때의 강제 로그아웃 방지
- 관련 문서: [architecture.md](../architecture.md) §1·§6, [API.md](../API.md), [SECURITY_REVIEW.md](../SECURITY_REVIEW.md), [APP_PORTING.md](../APP_PORTING.md) §0.3, [features/auth.md](../features/auth.md)

## 맥락

같은 API 를 브라우저(PWA 포함)와 Capacitor 앱(iOS·Android)이 함께 쓴다. 앱의 웹뷰는 `capacitor://localhost`, `https://localhost` 같은 출처에서 돌기 때문에 API 와 출처가 다르다(`apps/api/wrangler.jsonc` 의 `CORS_ORIGINS`). 첫 커밋의 architecture.md 는 인증 방식을 "쿠키 미사용, 앱 호환"으로 적었다. 쿠키를 썼을 때 앱에서 생기는 구체적인 문제를 검토한 기록은 없다. TODO: 확인 필요.

## 결정

- 모든 요청은 `Authorization: Bearer <accessToken>` 헤더로 인증한다. 쿠키는 쓰지 않는다.
- access token 은 1시간, refresh token 은 30일이다. refresh token 은 쓸 때마다 새로 발급하고(회전) SHA-256 해시로 저장한다. 이미 쓴 refresh token 이 다시 오면 그 사용자의 모든 세션을 끊는다(재사용 탐지).
- JWT 는 HS256 이고 운영 시크릿은 32자 이상이어야 서버가 기동한다.
- 웹은 토큰을 localStorage 에 둔다. 앱은 iOS Keychain(`afterFirstUnlockThisDeviceOnly`, iCloud 동기화 없음)과 Android Keystore AES-GCM 키로 암호화한 저장소(`@aparajita/capacitor-secure-storage`)에 둔다.

## 근거

- 웹과 앱이 같은 인증 방식과 같은 코드를 쓰게 하려는 것이 기록된 이유다(API.md 머리말: 웹·앱 공용).
- 앱은 처음에 평문 Preferences(UserDefaults, SharedPreferences)에 토큰을 두었다. `2400f56` 은 이를 보안 저장소로 옮기고, 보안 저장소 기록이 성공한 뒤에만 평문 사본을 지워 업데이트로 로그아웃되지 않게 했다.
- 평문 사본을 남기면 회전 전의 refresh token 이 다시 쓰여 재사용 탐지로 전체 세션이 끊길 수 있으므로, 값이 바뀌거나 로그아웃할 때 남은 평문 사본도 지운다(SECURITY_REVIEW.md 후속 조치 절).

## 결과와 영향

얻은 것:
- 웹과 앱이 같은 인증 흐름을 쓴다. Cloudflare 전환 뒤에는 웹과 API 가 같은 출처라 웹에는 CORS 설정이 필요 없고, `CORS_ORIGINS` 는 앱 때문에 둔다.
- 2026-11-25 운영 점검에서 JWT 본문 변조, `alg=none`, refresh token 을 access token 으로 쓰기, refresh 재사용이 모두 막혔다.

감수한 것:
- 웹은 토큰을 localStorage 에 두므로 XSS 가 생기면 토큰이 함께 유출된다(SECURITY_REVIEW.md 수용 항목). 대응으로 `dangerouslySetInnerHTML` 을 쓰지 않고, 2026-11-25 에 기본 CSP 를 넣었다.
- 재사용 탐지가 정상 사용자를 로그아웃시켰다. 여러 탭이 동시에 갱신하는 경우는 탭 사이의 `storage` 이벤트로 세션을 맞춰 해결했다(SECURITY_REVIEW.md 9번). 응답이 유실돼 같은 토큰으로 다시 요청하는 경우는 30초 안의 재사용이고 이어 받은 토큰이 살아 있으면 새 토큰을 주도록 고쳤다(마이그레이션 0003).
- 앱에서 보안 저장소 오류(기기 복원 뒤 Keystore 키 유실 등)가 나면 세션이 없는 상태로 처리해 다시 로그인하게 한다. 암호문 파일은 Android 백업과 기기 이전에서 빠지고, 재설치하면 iOS Keychain 에 남은 세션을 버린다.

남은 일:
- iOS 빌드는 출시 준비 시점으로 미뤄져 있어 Keychain 저장은 iOS 실기기에서 아직 확인하지 않았다. TODO: 확인 필요([2026-11-web-first-toss-deferred.md](./2026-11-web-first-toss-deferred.md)).
