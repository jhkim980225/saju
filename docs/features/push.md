# 푸시 (오늘의 운세 알림)

> 기준일: 2026-11-26. `feat/cloudflare` 작업 트리의 코드를 기준으로 적었다. 이 문서는 [FEATURES.md](../FEATURES.md) §16과 §0.2·§22 중 푸시 항목을 대체한다. Firebase 프로젝트·서비스 계정·APNs 키 설정은 [AUTH_PUSH.md §6](../AUTH_PUSH.md), 앱 쪽 준비는 [APP_PORTING.md §8](../APP_PORTING.md)에 있다.

## 목적

매일 아침 대표 프로필의 오늘 한 줄을 앱 알림으로 보내 다시 들어올 이유를 만든다. 보내는 내용은 운세 안내뿐이고 상품 홍보는 넣지 않는다. 광고성 푸시는 정보통신망법 제50조에 따라 별도 수신 동의, 야간(21시~08시) 추가 동의, "(광고)" 표기가 필요하므로, 홍보 문구를 넣으려면 이 조건부터 갖춘다.

| 기능 | 운영 상태 |
|---|---|
| 오늘의 운세 푸시(매일 08:00 KST) | 키 없어 꺼짐(FCM 키 3종 없음). 받을 수 있는 곳이 앱뿐이라 앱 전용이기도 하다 |
| `DAILY_PUSH_ENABLED` | `true` 로 설정되어 있다(`wrangler.jsonc` vars) |
| 웹 푸시 | 미구현(아래 알려진 이슈 2) |

## 사용자 흐름

1. **앱 시작**: `initPush` 가 알림 권한이 이미 있으면 FCM 등록 토큰을 받아 `POST /push/tokens` 로 등록한다. 토큰이 바뀌면(`tokenReceived`), 게스트가 회원이 되거나 다른 계정으로 로그인하면 다시 등록한다. 마지막으로 등록한 `사용자 ID|플랫폼|토큰` 을 기기 저장소(`yd.native.pushToken`)에 두고, 같은 값이면 다시 보내지 않는다. 이 기기에서 알림을 끈 표시(`yd.native.pushOff`)가 있으면 어느 계정에도 등록하지 않는다.
2. **마이 화면 토글**: `/my` 의 '알림' 토글(안내 문구 "08:00")에서 켜고 끈다. 웹(플랫폼 `web`)과 토스 미니앱에서는 토글을 그리지 않는다. 토글은 앱 계층의 `native.setPush`(`setPushEnabled`)를 부른다.
   - 켜면 끈 표시를 지우고 OS 권한을 요청한 뒤, 받은 토큰을 `syncPushToken` 으로 등록하고 등록 표시를 남긴다. 권한이 없으면 토글을 다시 끄고 기기 설정에서 허용하라고 안내한다.
   - 끄면 이 기기 토큰을 `DELETE /push/tokens` 로 해제하고 등록 표시를 지우고 끈 표시를 남긴다.
   - 그다음 게스트·회원 모두 `PATCH /auth/me { pushEnabled }` 로 수신 동의를 서버에 저장하고, 응답의 사용자 정보로 세션을 갱신한다.
   - 토글의 처음 값은 서버가 준 `UserDto.pushEnabled`(값이 없으면 켜짐)이고, 이 기기에서 끈 표시가 있으면 꺼짐이다.
3. **매일 08:00 KST 발송**: 예약 실행이 대상 사용자마다 대표 프로필로 오늘의 운세를 계산해 "오늘의 한 줄이 도착했어요" 제목과 "`이름`님, `한 줄`" 본문을 보낸다. 링크는 `/today`, 데이터는 `{ kind: 'daily', profileId }` 다.
4. **알림 누름**: 앱이 `data.link` 를 읽어 그 화면으로 이동한다.
5. **로그아웃·탈퇴**: 마이 화면의 로그아웃은 등록 표시(`yd.native.pushToken`)에 있는 이 기기의 토큰을 먼저 해제(`DELETE /push/tokens`)하고 세션을 지운다. 토글로 켠 토큰도 등록 표시를 남기므로 해제된다. 끈 표시는 로그아웃 뒤에도 남아, 새 게스트 세션에 토큰을 다시 묶지 않는다. 탈퇴하면 서버가 그 사용자의 토큰을 모두 지운다.

OS 권한 팝업 앞에 무엇을·언제·얼마나 자주 보내는지 알리는 안내 화면을 먼저 보여 주고, 첫 결과를 본 뒤에 권한을 묻는다는 원칙은 [APP_PORTING.md §8](../APP_PORTING.md)에 있다.

## 관련 파일

| 구분 | 경로 |
|---|---|
| 발송·토큰 관리 | `apps/api/src/modules/push/service.ts`(`createPushService`: `register`, `unregister`, `sendToUser`, `sendDailyFortuneDigest`) |
| 라우트 | `apps/api/src/modules/push/routes.ts` |
| 아침 발송 작업 | `apps/api/src/jobs/dailyPush.ts`(`runDailyPush`, 결과를 `ops.pushResult` 로 하루 집계에 올림) |
| 예약 실행 | `apps/api/src/worker.ts`(`scheduled`, `DAILY_CRON`), `apps/api/wrangler.jsonc`(`triggers.crons`, `vars.DAILY_PUSH_ENABLED`) |
| 켜짐 조건 | `apps/api/src/config/env.ts`(`features.push`), `apps/api/src/modules/config/routes.ts`(`features.push`) |
| DB | `apps/api/src/db/schema.ts`(`pushTokens`, `users.pushEnabled`) |
| 탈퇴 정리 | `apps/api/src/modules/users/service.ts`(`deleteAccount`) |
| 앱 | `apps/web/src/native/push.ts`(`initPush`, `syncPushToken`, `requestPushToken`, `setPushEnabled`, `pushOptedOut`, `PUSH_TOKEN_KEY`, `PUSH_OFF_KEY`), `apps/web/src/native/bootstrap.ts`(브리지 `setPush`, `pushOptedOut`), `apps/web/src/lib/platform.ts`(`NativeBridge`) |
| 화면 | `apps/web/src/pages/MyPage.tsx`(`togglePush`, `logout`) |
| API 클라이언트 | `apps/web/src/lib/api.ts`(`registerPush`, `unregisterPush`) |
| 요청 스키마 | `packages/shared/src/index.ts`(`pushRegisterSchema`) |
| 테스트 | `apps/api/test/oauth-push.test.ts`('FCM 푸시 발송', '키 미설정'), `apps/web/src/native/__tests__/native.test.ts`('알림 토글') |

## API / 데이터 모델

- 엔드포인트는 `POST /push/tokens`, `DELETE /push/tokens` 둘이고 모두 로그인(게스트 토큰 포함)이 필요하다. 요청 형식은 [API.md 푸시 절](../API.md)을 본다.
- `push_tokens.token` 은 유일하다. 등록은 토큰 기준 upsert 라서, 같은 기기 토큰이 다른 계정으로 등록되면 그 계정으로 옮겨진다. 한 계정에 여러 기기 토큰을 둘 수 있다.
- `users.push_enabled` 는 기본값이 `true` 다. 계정 단위 수신 거부는 이 값으로 표현한다. 토글로 끄면 이 기기 토큰도 해제하고, 기기 저장소의 끈 표시로 같은 기기의 다음 세션에도 등록하지 않는다.
- 서버 키는 `FCM_PROJECT_ID`·`FCM_CLIENT_EMAIL`·`FCM_PRIVATE_KEY`(시크릿)다. 발급 절차는 [AUTH_PUSH.md §6-1](../AUTH_PUSH.md), 목록은 [ENV_KEYS.md §5](../ENV_KEYS.md).

## 비즈니스 규칙 & 엣지케이스

- **발송 조건**: 예약 실행은 `features.push`(FCM 키 3종이 모두 있음)와 `DAILY_PUSH_ENABLED=true` 가 둘 다 맞을 때만 `runDailyPush` 를 부른다. 그래서 앱 출시 전에는 FCM 키를 넣지 않는 것으로 발송을 막는다. 키 없이 `sendToUser`·`sendDailyFortuneDigest` 를 부르면 501 `NOT_CONFIGURED` 다.
- **대상**: 토큰이 있고, `push_enabled` 가 참이고, 탈퇴하지 않은 사용자다. 사용자마다 대표 프로필(`profiles.primary`)로 메시지를 만들고, 대표 프로필이 없거나 계산 중 예외가 나면 그 사용자를 건너뛴다(`skipped`).
- **날짜 기준**: 오늘 날짜는 발송 시각을 `Asia/Seoul` 로 바꿔 정한다.
- **예약 실행 안의 순서**: 08:00 KST 실행은 운영 하루 요약, 집계 정리, 오늘의 운세 푸시, 토스 환불 확인 순서로 돈다. 앞 작업이 실패해도 푸시는 실행된다([ops.md](ops.md)).
- **FCM 액세스 토큰**: 서비스 계정 키로 서명한 RS256 JWT 를 OAuth 토큰으로 바꿔 쓰고, 만료 1분 전까지 인스턴스 메모리에 둔다. 동시에 들어온 발급 요청은 하나로 합친다. PEM 은 `\n` 이스케이프·따옴표가 섞인 한 줄 값도 받는다.
- **발송**: 토큰마다 FCM `messages:send` 를 한 번씩 부르고, 동시에 20개까지 보낸다. 요청마다 10초 제한이다.
- **실패 처리**: 404 또는 `UNREGISTERED` 응답이면 토큰을 바로 지운다(`removed`). 400 `INVALID_ARGUMENT` 중 오류가 토큰을 가리키는 것(`fieldViolations` 의 `message.token`, 또는 "registration token" 메시지)도 형식이 틀린 토큰으로 보고 지운다. 메시지 내용 탓인 400 은 모든 토큰이 지워질 수 있으므로 지우지 않는다. 401 이면 액세스 토큰을 버리고 한 번만 다시 보낸다. 그 밖의 실패(5xx, 429, 네트워크)는 `failed` 로 세기만 하고 다시 보내지 않는다. 키 형식 오류는 첫 토큰 발급에서 예외로 드러나 `[scheduled] 오늘의 운세 푸시 실패` 로그가 남는다.
- **웹 링크**: `webpush.fcm_options.link` 는 `PUBLIC_WEB_URL` 기준 HTTPS 절대 주소일 때만 넣는다. http(로컬)이면 뺀다.
- **결과 기록**: 발송 결과 `{ users, skipped, sent, failed, removed }` 는 `[push] 오늘의 운세 푸시 발송 완료` 로그와 운영 하루 집계(`push.*`)에 남고, 다음 날 어제 요약에 한 줄로 나온다([ops.md](ops.md)).
- **토큰 해제 권한**: `DELETE /push/tokens` 는 자기 계정에 묶인 토큰만 지운다. 남의 기기 토큰 값을 알아도 해제할 수 없다(2026-11-25 보안 점검 조치).

## 주의사항 / 알려진 이슈

1. **꺼져 있다**: 운영 Worker 에 FCM 키가 없고 앱도 출시 전이다. 처리방침의 위탁·국외 이전 항목은 2026-11-26 에 FCM 을 넣었다(5번).
2. **웹 푸시는 미구현이다**: 새 기능이라 이번에 만들지 않는다. [ENV_KEYS.md §5](../ENV_KEYS.md)와 [AUTH_PUSH.md §6-1](../AUTH_PUSH.md)이 적은 `VITE_FIREBASE_*` 키는 `apps/web/.env.example` 에만 있고 코드는 읽지 않는다. `public/firebase-messaging-sw.js` 서비스 워커도 없고, 스키마의 플랫폼 값 `web` 도 쓰이지 않는다. 문서만 고침(2026-11-26): AUTH_PUSH §6-1 에 웹 푸시가 미구현이라고 적었다.
3. 문서만 고침(2026-11-26): **APP_PORTING §8 의 "팀장 확인 필요" 두 항목**. 마이 화면은 `nativePlatform()` 값으로 플랫폼을 보내고(iOS 고정 오류 없음), 로그아웃 때 등록 표시의 토큰을 해제한다. APP_PORTING §8 을 지금 동작으로 고쳤다.
4. 해결(2026-11-26): **게스트가 토글을 꺼도 서버에 저장되지 않던 문제**. 토글은 회원 여부와 관계없이 세션이 있으면 `PATCH /auth/me { pushEnabled }` 를 보내고, 응답으로 세션의 사용자 정보를 갱신해 화면을 다시 열어도 꺼짐이 유지된다. 끄면 이 기기 토큰도 해제하고 기기 저장소에 끈 표시를 남겨, 로그아웃 뒤 새 게스트 세션이 생겨도 `initPush` 가 토큰을 다시 묶지 않는다.
5. 해결(2026-11-26): **알림 본문의 프로필 이름이 처리방침에 없던 문제**. 처리방침 5번 위탁에 Google LLC(Firebase Cloud Messaging), 6번 국외 이전에 푸시 토큰과 알림 내용(대표 사주의 이름·별명과 오늘의 운세 한 줄)을 넣었다([legal.md](legal.md)). 본문에 이름이 들어가 잠금 화면에 보이는 것은 그대로다.
6. **규모 한계**: 한 번의 예약 실행이 모든 대상 사용자를 차례로 처리한다(사용자마다 대표 프로필 조회와 사주 계산, 토큰마다 FCM 요청). 사용자가 많아지면 Worker 한 번 실행의 CPU 시간·하위 요청 수 한도에 걸릴 수 있고, 나눠 보내는 장치(Queue 등)는 없다. 남김(새 기능): 앱 출시 뒤 대상 수를 보고 Queue 로 나눈다. TODO: 확인 필요(운영 플랜의 한도와 대상 수 기준).
7. 해결(2026-11-26): **깨진 토큰이 남던 문제**. FCM 400 `INVALID_ARGUMENT` 중 토큰을 가리키는 오류면 토큰을 지우고 `removed` 로 센다. 메시지 탓인 400 은 지우지 않는다.
8. 해결(2026-11-26): **토글로 등록한 토큰이 로그아웃 때 해제되지 않을 수 있던 문제**. 토글이 `api.registerPush` 를 직접 부르지 않고 앱 계층의 `setPushEnabled` → `syncPushToken` 으로 등록해, 등록 표시(`yd.native.pushToken`)가 바로 남는다.
9. 문서만 고침(2026-11-26): **문서의 링크 예시가 다르던 문제**. [AUTH_PUSH.md §6-3](../AUTH_PUSH.md) 예시와 `push/service.ts` 주석을 실제 링크 `/today` 로 고쳤다.
10. 해결(2026-11-26): **발송 결과가 운영 알림·하루 요약에 없던 문제**. 결과를 하루 집계에 올려 다음 날 요약에 나온다. 실패가 많을 때 바로 오는 알림은 없다.
