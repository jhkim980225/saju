# 출시 전 보안·로직 리뷰 결과와 조치

QA팀(보안·로직 리뷰어)이 인메모리 API 재현으로 확인한 15개 항목과 팀장 조치 내역입니다.
회귀 테스트: `apps/api/test/security.test.ts`, `apps/api/test/rewards.test.ts`, `apps/api/test/api.test.ts`(웹훅 위조·금액 검증).

| # | 심각도 | 항목 | 조치 | 상태 |
|---|---|---|---|---|
| 1 | Critical | 동시 결제 승인·웹훅 경쟁으로 중복 지급 | `settle()` — 한 트랜잭션에서 `pending/failed → paid` 조건부 UPDATE(`changes === 1`)일 때만 지급. 실패 표시도 `pending` 조건부. 동시 5건 승인 → 1회 지급 테스트 | ✅ |
| 2 | High | 프로필 출생정보 수정으로 구매 권한을 다른 사람에게 재사용 | 해당 프로필에 `report:*` 권한이 있으면 출생정보 변경 409 (이름·관계 변경은 허용) | ✅ |
| 3 | High | 잠긴 궁합 응답의 `result.factors` 로 유료 섹션 내용 노출 | 잠김 상태에선 긍정 요인 2개(무료 요약 범위)만 응답 | ✅ |
| 4 | High | 규칙 기반 AI 상담이 잠긴 섹션 본문을 무료·무차감으로 제공 | 상담 답변은 사용자의 열람 권한(`reports.access`) 안의 섹션만 사용, 잠긴 주제는 안내 문구 | ✅ |
| 5 | Medium | `X-Forwarded-For` 위조로 rate limit 우회, 429 대신 500 | `TRUST_PROXY_HOPS`(기본 0) 로 프록시 홉만 신뢰, 429 응답 수정, 인증 경로 별도 제한(`AUTH_RATE_LIMIT_PER_MIN`), 관리자 경로 제한, 관리자 토큰 `timingSafeEqual` | ✅ |
| 6 | Medium | 환불 후에도 생성된 리포트 열람, 질문권 사용량과 무관한 전액 환불 | 리포트 열람·목록 시 권한 재확인(없으면 402), 질문권 팩은 미사용 유상분 비율만큼 부분 취소(전부 사용 시 환불 불가) | ✅ |
| 7 | Medium | 계정당 1회 상품을 주문 여러 개로 중복 구매 | 승인·웹훅 복구·IAP 검증 트랜잭션에서 구매 한도 재확인, 초과 시 결제 취소 + 주문 `canceled` | ✅ |
| 8 | Medium | 동시 요청으로 AI 비용 부풀리기 | 상담은 AI 호출 **전** 질문권 선차감(실패 시 무상 환급), 리포트는 동일 조건 생성 요청 in-flight 병합 | ✅ (리포트 병합은 단일 인스턴스 기준 — 다중 인스턴스 시 DB 유니크 키 권장) |
| 9 | Medium | 다중 탭에서 refresh 토큰 재사용 탐지로 강제 로그아웃 | 웹: `storage` 이벤트로 탭 간 세션 동기화, 갱신 직전 저장소 재로드 | ✅ |
| 10 | Medium | AdMob SSV 가 광고 단위를 검증하지 않음, 키 재조회 증폭 | `ADMOB_REWARDED_AD_UNITS` 허용 목록(운영에서 비면 지급 거부), 미지의 key_id 재조회 최소 10분 간격 | ✅ |
| 11 | Low | 포트원 결제 통화 미검증 | 원화가 아니면 즉시 취소 + `CURRENCY_MISMATCH` | ✅ |
| 12 | Low | 웹훅을 처리 전에 기록 → 처리 중 오류 시 재전송 무시 | 중복 판정을 `processedAt` 기준으로 변경 | ✅ |
| 13 | Low | 해외 시간대 + 경도 미입력 시 서울 경도로 보정 | 그 해 표준시 오프셋 ÷ 4 로 대표 경도 추정(뉴욕 −75°) | ✅ |
| 14 | Low | 운세 `date` 에 존재하지 않는 날짜 허용 | 1900~2100 실제 날짜만 허용(400) | ✅ |
| 15 | Low | 게스트 데이터: 기존 계정 로그인 시 유실 / 공용 기기 | 로그인·소셜 로그인 시 게스트 프로필·리포트·상담을 계정으로 병합 후 게스트 정리(같은 기기의 다음 게스트는 새 계정). 공용 기기에서 **가입 전** 게스트 데이터는 기기에 남는 특성은 게스트 모드의 한계로 문서화 | ✅ / 한계 고지 |

> **Cloudflare Workers 전환(2026-11) 뒤 바뀐 구현** — 조치 내용(무엇을 막는지)은 같고 수단만 바뀌었다.
> - 5번: 요청 수 제한은 Cloudflare Rate Limiting 바인딩으로, Cloudflare 가 붙이는 접속 IP(`cf-connecting-ip`) 기준이다. `TRUST_PROXY_HOPS`·`AUTH_RATE_LIMIT_PER_MIN` 은 없앴고, 인증·관리자 경로 별도 제한은 `wrangler.jsonc` 의 `ratelimits`(인증 60초 10회, 관리자 60초 20회)로 옮겼다. 운영 모드에서만 켜진다.
> - 1·7번: D1 에는 대화형 트랜잭션이 없어, 읽고 판단한 뒤 쓰기를 batch 하나로 실행하고 batch 맨 앞의 조건 확인 문장(guard — "주문이 아직 pending", "구매 횟수 < 한도")이 깨지면 batch 전체를 취소하고 다시 실행한다(`apps/api/src/db/atomic.ts`, [`ARCHITECTURE.md`](./ARCHITECTURE.md) DB 절).
> - 8번: 리포트 중복 생성은 DB 유니크 인덱스 `reports_target_uq` 로 막는다(인스턴스 수와 무관).
> - 회귀 테스트는 같고, 실제 D1 에서도 돈다(`TEST_D1=1`).

## 후속 조치 — 앱의 토큰 저장 위치 (2026-10-15)
- 앱(Capacitor): 세션(access·refresh 토큰 + 사용자)을 평문 Preferences(UserDefaults / SharedPreferences) 대신 **iOS Keychain**(`afterFirstUnlockThisDeviceOnly`, iCloud 동기화 없음) / **Android Keystore** AES-GCM 키로 암호화한 저장소에 둔다(`@aparajita/capacitor-secure-storage`).
- 기존 설치의 평문 세션(Preferences, 첫 실행의 웹뷰 localStorage)은 보안 저장소 기록 성공 후 삭제 — 업데이트로 로그아웃되지 않음. 값이 바뀌거나 로그아웃하면 남은 평문 사본도 삭제(회전 전 refresh 토큰 재사용 → 전체 세션 폐기 방지).
- 보안 저장소 오류(기기 복원 후 Keystore 키 유실 등)는 세션 없음으로 처리해 재로그인으로 복구, 앱은 중단되지 않음. 암호문 파일은 Android 클라우드 백업·기기 이전에서 제외, 재설치 시 iOS Keychain 잔여 세션은 버림.
- 웹은 변경 없음(localStorage). 상세: [APP_PORTING.md §0.3](./APP_PORTING.md), 테스트: `apps/web/src/native/__tests__/storage.test.ts`

## 리뷰에서 문제없음으로 확인된 항목
- `next` 파라미터 오픈 리다이렉트 — 라우터가 외부 URL 로 이동하지 않음
- XSS — `dangerouslySetInnerHTML` 미사용
- 타 사용자의 주문·프로필·리포트 접근 — 소유자 검증
- 결제건 재사용 — `(provider, providerPaymentKey)` 유니크 인덱스
- 토스 웹훅 위조 — 결제 재조회로 검증
- 사주 엔진 경계 입력 85,246건 퍼징 — 500 으로 새는 예외 0건

## 인앱결제 서명 검증·스토어 환불 알림 (2026-10-15, 결제)
회귀 테스트: `apps/api/test/store-notifications.test.ts`, `apps/api/test/payments.providers.test.ts`(Apple).

| 위협 | 조치 | 상태 |
|---|---|---|
| Apple JWS 를 서명 검증 없이 디코드 — 위조 알림·변조 응답으로 지급/회수 조작 | `appleJws.ts`: x5c 3장, 중간 인증서를 **내장 Apple Root CA - G3**(SHA-256 지문 고정, 로드 시 대조)로 검증 — x5c 의 루트는 믿지 않음, 중간·루트 CA 여부, 리프가 CA 아님, 세 인증서 유효기간, Apple 표식 OID(중간 `1.2.840.113635.100.6.2.1`, 리프 `…6.11.1`), 리프 키 ES256 서명. App Store Server API 응답·알림·알림 안의 거래/갱신 정보 모두 적용 | ✅ |
| 다른 앱·다른 환경의 진짜 Apple 서명 데이터 재사용 | bundleId 대조, 거래 environment 가 응답 엔드포인트·알림 환경과 같은지, `APPLE_IAP_ENVIRONMENTS` 밖의 알림은 무시 | ✅ |
| 스토어에서 환불받고 리포트·질문권 계속 사용 | App Store Server Notifications V2(`REFUND`/`REVOKE`)와 Google RTDN(`voidedPurchaseNotification`)으로 관리자 환불과 같은 `revokeOrder` 실행 | ✅ |
| 알림 재전송·중복으로 이중 회수 | 알림 ID(notificationUUID / Pub/Sub messageId) 멱등 + `revokeOrder`를 `paid` 조건부 UPDATE 로 변경(관리자 환불·웹훅과 경쟁해도 1회) | ✅ |
| 앱 검증 전에 환불 → 나중에 검증해 지급받기 | 무효화된 거래 ID 를 표시해 두고 `/payments/iap/verify`에서 402 `REVOKED` | ✅ |
| Pub/Sub 푸시 엔드포인트 위조 호출 | OIDC 토큰을 Google 공개키로 검증 + iss·aud(`GOOGLE_PLAY_RTDN_AUDIENCE`) + **서비스 계정 이메일**(`GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT`, email_verified) 대조 — 누구나 임의 audience 의 Google ID 토큰을 만들 수 있어 이메일 대조가 핵심. `packageName` 대조 | ✅ |
| 거부 사유 노출로 검증 우회 탐색 | 응답은 고정 문장, 사유는 서버 로그(`스토어 알림 거부`)에만 | ✅ |
| Apple 인증서 폐기(OCSP) 미확인 | 체인·OID·유효기간·서명만 확인. Apple 리프 키 유출 시 폐기 반영이 늦을 수 있음 | 수용(문서화) |

## 운영 점검 (2026-11-25, daldalsaju.com)

운영 사이트에 실제 요청을 보낸 바깥 점검과 코드 검토를 함께 했다. 만든 시험 계정은 탈퇴로 지웠다.

**바깥 점검에서 문제없음:** `.env`·`.git`·설정 파일은 SPA 대체 HTML 로만 나간다. 소스맵은 빌드에서 뺐다. CORS 는 허용 목록 밖의 출처에 `Access-Control-Allow-Origin` 을 주지 않는다. 권한 우회 32항목(다른 계정의 프로필·풀이·궁합·상담·타로, 게스트 결제, 가격 필드 주입, 결제 확인·그로블/토스/mock 웹훅 위조, 관리자 API 무단 호출, JWT 본문 변조·`alg=none`·refresh 토큰을 access 로, refresh 재사용, 깨진 JSON·긴 입력)이 모두 막혔다. 500 응답에 내부 정보가 없다.

| 심각도 | 항목 | 조치 |
|---|---|---|
| High(실측) | Cloudflare Rate Limiting 바인딩이 매우 느슨하다(한도 5회 시험 Worker 에 42회 중 3회만 차단). 로그인 68회 실패가 막히지 않았다 | 계정(이메일 해시) 단위 실패 제한: 15분에 10회(`modules/auth/loginThrottle.ts`, `login_failures` 테이블, 없는 이메일도 같게). IP 기준은 WAF Rate limiting rule 을 대시보드에서 추가하기를 권장 |
| Medium | zod 4.6.5 의 큰 배열 검증 메모리 고갈(GHSA-mrhx-c7xc-m3w5) + 오류 이슈 전체를 응답 → 940KB 요청에 응답 19MB·힙 +195MB | zod 4.6.7, 응답 details 는 앞 20개(`lib/validate.ts`) |
| Low | 그로블 환불 알림이 결제 완료보다 먼저 오면 환불된 결제가 나중에 지급됨 | 못 찾은 전액 환불의 결제 키를 무효로 표시, 완료 처리 때 지급하지 않고 `REFUNDED_BEFORE_PAID` |
| Low | AI 실패가 반복되면 유료 타로(Sonnet)·택일 상세를 열 때마다 다시 호출, 거절 유도로 상담·꿈풀이 질문권 환급 반복 | 결과당 최대 3회·10분 간격(조건부 갱신으로 인스턴스 간 1회), 거절은 차감·장애만 환급, 환급은 하루 5회 |
| Low | 비밀번호 변경 뒤 다른 기기 세션 유지 | 변경 시 전체 세션 폐기, 현재 기기에 새 토큰 |
| Low | 남의 푸시 토큰 해제 가능 | 자기 계정 토큰만 해제 |
| Low | DB 오류 로그에 쿼리 값(개인정보) | `lib/log.ts` 의 safeErrorText 로 params·SQL 제거 |
| Low | 택일 결과 무료 무제한 저장 | 사용자당 하루 30건, 중복 판정은 식 인덱스로 |
| Low | 응답 시간으로 가입 여부 노출(로그인·비밀번호 찾기) | 없는 계정도 더미 해시 비교, 재설정 메일은 응답 뒤(waitUntil) |
| Low | 운영에서 관리자 토큰 길이 미검사, 토스 로그인의 개발용 고정 키 | 32자 미만이면 관리자 API 끔, 운영에서 토스 키 없으면 토스 로그인 끔 |
| Info | 타로 덱 토큰에 셔플 시드 평문 | 토큰에는 nonce 만, 시드는 서버 비밀 HMAC |
| Info | CSP 없음, 개인 응답 캐시 헤더 없음 | 기본 CSP(`object-src`·`base-uri`·`frame-ancestors`·`form-action`), 로그인 요청 응답 `private, no-store` |
| 회귀 | 같은 날 고친 게스트 병합의 `db.run(sql)` 이 D1 batch 에서 500 | 쿼리 빌더 두 문장으로 바꿈, `TEST_D1=1` 전체 통과 |

**수용(문서화):**
- scrypt N=2^14 유지 — OWASP 권장 N=2^17 은 128MB 로 Workers isolate 한도를 넘는다. 값은 해시에 함께 저장돼 나중에 올릴 수 있다.
- 게스트 deviceId 는 폐기할 수 없는 자격 증명 — `crypto.randomUUID()` 라 추측 불가, 유출에는 XSS·기기 접근이 필요하고 그때는 토큰도 함께 유출된다.
- 가입 시 "이미 가입된 이메일" 안내(사용성).

**운영자 할 일(대시보드):** SSL/TLS → Edge Certificates → Minimum TLS Version 을 TLS 1.2 로(지금 1.0·1.1 접속 가능). Security → WAF → Rate limiting rules 에 `/api/v1/auth/` IP 기준 규칙 1개.

## 멱등성 점검 (2026-11-25)

같은 요청·알림이 두 번(재전송, 두 번 누름, 두 탭, 응답 유실 뒤 재시도) 들어오는 경우를 코드에서 찾아 고치고 `test/idempotency.test.ts` 로 확인했다. 새 테스트는 수정 전 코드에서 4건 실패, 수정 후 SQLite·D1(`TEST_D1=1`) 모두 497건 통과. 배포 f8ed12e4, 마이그레이션 0003(`refresh_tokens.replaced_by`).

| 심각도 | 문제 | 조치 |
|---|---|---|
| Medium | refresh 토큰을 두 탭이 동시에 쓰거나 응답이 유실돼 같은 토큰으로 다시 요청하면 "재사용 = 탈취"로 판정해 **모든 기기에서 로그아웃** | 회전할 때 이어 받은 토큰 행(`replaced_by`)을 적고, 30초 안의 재사용이며 이어 받은 토큰이 살아 있으면 새 토큰을 준다. 로그아웃·비밀번호 변경으로 끊긴 세션은 이어 받은 토큰도 폐기돼 있어 봐주지 않는다 |
| Medium | 같은 결제창 링크로 두 번 결제하면 두 번째 결제가 기록 없이 무시됨(돈은 받고 운영자는 모름) | 지급하지 않고 `DUPLICATE_PAYMENT` 로 기록 + 경고 로그(PAYMENTS.md §2.1) |
| Low | 결제 완료와 환불 웹훅이 동시에 처리되면 환불된 결제가 지급된 채로 남을 수 있음 | 지급 묶음이 실행 시점에 무효 표시를 확인, 환불 쪽은 표시 뒤 다시 확인해 회수 |
| Low | 게스트에서 가입 요청이 겹치면 가입 보너스가 두 번 지급될 수 있음 | 게스트 전환을 "아직 게스트일 때만" 조건부로 바꾸고, 바뀐 경우에만 보너스 |
| Low | 게스트로 기존 계정에 로그인이 겹치면 게스트 질문권이 두 번 옮겨질 수 있음(게스트 잔액 음수) | 병합 전체를 atomic 하나로 묶고 게스트 상태·잔액을 실행 시점에 확인 |
| Low | 소셜 첫 로그인이 겹치면 두 번째 요청이 500 | 유니크 충돌 시 먼저 만든 계정으로 로그인 |
| Low | 광고 보상 토큰 여러 개로 동시에 요청하면 하루 한도를 넘을 수 있음 | `grantDailyCapped` — 한도를 지급 묶음 실행 시점에 확인. 지급 실패 시 거래 기록을 지워 재전송 때 지급 |
| Low | 금액 불일치 처리가 그사이 지급된 주문을 failed 로 덮어쓸 수 있음 | pending/failed 일 때만 바꾼다 |

이미 멱등이었던 것(테스트로 재확인): 같은 웹훅 재전송, 결제 승인 동시 요청, 인앱결제 같은 거래 재검증, 질문권 동시 차감, 리포트 동시 생성(`reports_target_uq`), 오늘의 타로 같은 요청, AdMob 같은 거래, 비밀번호 재설정 링크 재사용, 같은 이메일 동시 가입.

운영 확인(배포 뒤): 같은 refresh 토큰 동시 3회 → 모두 200·서로 다른 토큰, 다른 기기 세션 유지, 응답 유실 재요청 200, 로그아웃 토큰 401, 게스트 가입 동시 2회 → 201·409, 게스트 병합 로그인 동시 3회 → 모두 200·프로필 1개, 오늘의 타로 동시 2회 → 같은 결과. 시험 계정은 삭제.

### 2차 (같은 날) — 중복 결제를 결제 전에 막기, 요청 ID

그로블 문서 확인 결과 같은 ref 의 두 번째 결제를 막는 장치(멱등 키·일회용 링크·1인 1회 제한·결제/환불 API)가 없다. 그래서 결제창으로 보내기 전에 막는다(PAYMENTS.md §2.1).

| 심각도 | 문제 | 조치 |
|---|---|---|
| Medium | 결제 확인을 기다리다 구매 버튼을 다시 누르면 새 주문으로 한 번 더 결제할 수 있음. 리포트면 돈만 두 번 나가고 받는 것은 같음(기록도 없음) | 같은 상품·대상의 미결 주문이 30분 안에 있으면 409 `PAYMENT_IN_PROGRESS` → 결제 확인 화면, "결제하지 않았어요"면 같은 주문으로 결제창. 두 탭 동시 주문도 하나만 |
| Medium | 이미 산 리포트를 같은 사주로 다시 결제할 수 있음 | 주문 단계에서 409 `ALREADY_OWNED`, 웹훅 단계에서도 `failed(ALREADY_OWNED)` + 기록 |
| Low | 질문권 팩 중복 결제를 환불 대상으로만 남김 | 새 주문으로 지급(환불 불필요) |
| Low | 운영자가 환불할 결제를 로그를 봐야만 알 수 있음 | `OPS_ALERT_WEBHOOK_URL` 운영 알림(결제 키마다 1회, 개인정보 없음) |
| Low | AI 상담·꿈풀이를 같은 요청으로 두 번 보내면 두 번 차감 | `requestId` — 처음 요청만 처리하고 다시 오면 처음 답을 돌려줌(처리 중이면 409). 실패하면 선점을 풀어 다시 보낼 수 있음 |

테스트: `test/duplicate-payment.test.ts`(20건) 추가, 웹 결제 확인 화면·startCheckout 테스트 6건 추가. 전체 882건 통과(서버는 SQLite·D1 모두 515건). 배포 0f250a3d. 운영 확인: 같은 상품 재주문 409·이어서 결제는 같은 주문·같은 링크, 리포트 동시 주문 3회 → 1건, 다른 사주는 주문 가능, 잘못된 요청 ID 400, 질문권 부족으로 실패한 요청 ID 재사용 가능.

남는 경우: 결제를 마친 뒤 브라우저 뒤로 가기로 그로블 결제창에 돌아가 다시 결제하는 것은 막을 수 없다(그로블 화면). 질문권 팩은 지급, 그 밖의 상품은 운영 알림으로 환불한다.

## 남은 권장 사항 (출시 후 개선)
- Apple 인증서 OCSP 폐기 확인, Google Voided Purchases API 정기 대조(Pub/Sub 보관 기간을 넘는 장애 대비)
- Google Play 구매의 서버 측 acknowledge
- ~~다중 API 인스턴스 운영 시: 리포트 생성 중복 방지를 DB 유니크 키로, 푸시 스케줄러는 1대만~~ — 완료: `reports_target_uq` 유니크 인덱스, 푸시는 Cloudflare Cron Trigger 가 하루 한 번 실행
