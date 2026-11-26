# 운영 배포 절차 — 웹 (Cloudflare Workers)

구성: Cloudflare Worker `dalbit-saju` 하나가 웹(정적 파일 `apps/web/dist`)과 API(`/api/*`, `/health`)를 같은 주소로 낸다. DB 는 D1(`dalbit-saju`), 리포트 AI 다듬기는 Queue(`dalbit-saju-jobs`), 매일 08:00 KST 푸시는 Cron Trigger 가 맡는다. 설정은 모두 `apps/api/wrangler.jsonc` 에 있다.

## 0. 준비할 것

| 항목 | 내용 |
|---|---|
| 계정 | Cloudflare 계정 + **Workers Paid 플랜**(계정당 월 $5). 이 Worker 와 D1·Queues·Cron 은 기본 포함 사용량 안에서 이 플랜으로 충분하다. 같은 계정의 다른 프로젝트도 이 플랜을 같이 쓴다 |
| 도메인 | Cloudflare DNS 에 올라간 도메인(네임서버가 Cloudflare). Custom Domain 연결에 필요하다 |
| 키 | 필수: JWT 시크릿 2개, 관리자 토큰, 그로블 웹훅 시크릿·결제창 링크. 선택: Anthropic, Resend(메일), 소셜 로그인, FCM. 목록과 secret·vars 구분은 [`ENV_KEYS.md`](./ENV_KEYS.md) |
| 작업 PC | Node 22.13+ · npm. 저장소를 받고 `npm install` (wrangler 는 개발 의존성으로 함께 설치된다). 서버·Docker·DB 설치는 필요 없다 |

## 1. 처음 한 번

명령은 `apps/api` 에서 실행한다. 저장소 루트에서 실행할 것은 따로 적었다.

```bash
cd apps/api
npx wrangler login

# D1 만들기 → 출력된 database_id 를 wrangler.jsonc 의 d1_databases[0].database_id 에 넣는다
npx wrangler d1 create dalbit-saju --location apac

# 리포트 AI 다듬기용 큐
npx wrangler queues create dalbit-saju-jobs

# 비밀 값 — 명령마다 값을 입력받는다
openssl rand -base64 48   # → JWT_ACCESS_SECRET
openssl rand -base64 48   # → JWT_REFRESH_SECRET (다른 값)
openssl rand -hex 24      # → ADMIN_API_TOKEN
npx wrangler secret put JWT_ACCESS_SECRET
npx wrangler secret put JWT_REFRESH_SECRET
npx wrangler secret put ADMIN_API_TOKEN
npx wrangler secret put GROBLE_WEBHOOK_SECRET
npx wrangler secret put GROBLE_PRODUCT_LINKS
# 선택: ANTHROPIC_API_KEY, RESEND_API_KEY, MAIL_FROM, SUPPORT_EMAIL, FCM_*, 소셜 로그인 키 …
```

비밀이 아닌 설정은 `wrangler.jsonc` 의 `vars` 에서 고친다. 최소한 아래 세 값을 운영 도메인에 맞춘다.

| 값 | 내용 |
|---|---|
| `PUBLIC_WEB_URL` | 운영 웹 주소(https). 결제·소셜 로그인 리다이렉트, 비밀번호 재설정 메일 링크의 기준 |
| `CORS_ORIGINS` | 운영 도메인 + Capacitor 앱 오리진(`capacitor://localhost,https://localhost,http://localhost`). 웹은 같은 출처라 CORS 가 필요 없고, 앱 때문에 둔다 |
| `PAYMENT_PROVIDER` | `groble` |

운영 모드(`NODE_ENV=production`)는 JWT 시크릿이 없거나 짧으면, 또는 `PAYMENT_PROVIDER=mock` 이면 요청을 처리하지 않고 실패한다.

## 2. 올리기

```bash
# 저장소 루트에서
npm run db:migrate:remote -w @saju/api                 # D1 에 drizzle/*.sql 적용
PUBLIC_WEB_URL=https://도메인 npm run deploy            # 웹 빌드(사전 렌더링 포함) → wrangler deploy
```

- `npm run deploy` 는 `npm run build -w @saju/web`(타입검사 → Vite 빌드 → 사전 렌더링) 뒤 `apps/api` 에서 `wrangler deploy` 를 실행한다.
- 웹 빌드는 빌드 시점의 값을 읽는다. 사전 렌더링(`apps/web/scripts/prerender.mts`)의 canonical·og·`sitemap.xml` 주소는 `PUBLIC_WEB_URL` 환경 변수(없으면 `https://daldalsaju.com`)를 쓴다. 광고·분석·Firebase 같은 공개 키(`VITE_*`)는 `apps/web/.env` 에서 읽는다. `VITE_API_BASE_URL` 은 비워 둔다(같은 Worker 의 `/api/v1`).

Custom Domain 은 `wrangler.jsonc` 의 `routes`(`custom_domain: true`)에 적혀 있어서 배포할 때 함께 붙는다. 지금은 `daldalsaju.com` 과 `www.daldalsaju.com` 두 개다(2026-11-24 연결). 도메인이 같은 계정의 Cloudflare 존이어야 하고, DNS 레코드와 인증서는 Cloudflare 가 만든다. 처음 붙인 직후에는 인증서가 나올 때까지 몇 분 동안 HTTPS 접속이 실패할 수 있다.

대시보드에서 붙이려면: Workers & Pages → `dalbit-saju` → Settings → Domains & Routes → Add → Custom Domain.

`https://도메인` 이 열리고 `https://도메인/health` 가 `ok` 면 끝. 상품 카탈로그 시드는 자동이다 — Worker 인스턴스마다 첫 요청 때 `app_meta` 테이블의 카탈로그 해시(`catalog_hash`)와 비교해, 바뀌었을 때만 상품을 다시 넣는다.

마지막으로 결제사에 웹훅 주소를 등록한다.

- 그로블: `https://도메인/api/v1/payments/webhooks/groble` ([`PAYMENTS.md`](./PAYMENTS.md) §3.5)
- 앱 출시 뒤: App Store Server Notifications·Google Play RTDN 주소 ([`PAYMENTS.md`](./PAYMENTS.md) §3.3·§3.4)

## 3. 확인 목록 (오픈 전)

- [ ] `https://도메인` 첫 화면. `www` 를 쓰면 `www` 도 Custom Domain 으로 붙이거나 본 도메인으로 보내는 리디렉션을 둔다
- [ ] 비회원 사주 입력 → 결과, 오늘의 운세, 띠별·별자리·꿈해몽 페이지 열림(사전 렌더링한 `/zodiac/…` 같은 주소를 새로고침해도 열리는지)
- [ ] 이메일 가입·로그인, (키 있으면) 카카오 로그인
- [ ] 그로블 결제 1건: 결제창 → 결제 → 웹훅 수신 → 상품 열림 ([`PAYMENTS.md`](./PAYMENTS.md) §3.5). 환불 1건까지
- [ ] (AI 키 있으면) 유료 리포트 열기 → 'AI가 문장을 다듬고 있어요 n/전체' → 최종본. Queue 가 도는지 확인하는 항목이다
- [ ] `https://도메인/sitemap.xml`, `/robots.txt` 열림 → 네이버 서치어드바이저·구글 서치콘솔에 등록
- [ ] 약관·개인정보처리방침에 사업자 정보가 들어갔는지
- [ ] `npx wrangler d1 time-travel info dalbit-saju` 로 복구 지점이 나오는지 (아래)

## 4. 운영

**코드 갱신**
```bash
git pull
npm run db:migrate:remote -w @saju/api   # drizzle/ 에 새 마이그레이션이 있을 때만
PUBLIC_WEB_URL=https://도메인 npm run deploy
```
마이그레이션은 배포 전에 적용한다. 새 코드가 새 컬럼을 읽기 때문이다.

**백업·복구** — D1 Time Travel 로 최근 30일 안의 어느 시점으로든 되돌릴 수 있다(Workers Paid 플랜). 따로 백업 작업을 등록할 필요는 없다.
```bash
cd apps/api
npx wrangler d1 time-travel info dalbit-saju                                   # 현재 복구 지점(bookmark)
npx wrangler d1 time-travel restore dalbit-saju --timestamp=2026-11-11T04:00:00+09:00
npx wrangler d1 export dalbit-saju --remote --output backup.sql                # SQL 덤프를 따로 보관할 때
```

**로그·상태**
```bash
cd apps/api
npx wrangler tail          # 실시간 로그
```
대시보드 Workers & Pages → `dalbit-saju` → Logs 에서도 볼 수 있다(observability 켜 둠). 리포트 다듬기 로그는 `[ai:report]`, 실패는 `[reports]` 로 시작한다.

**운영 알림** (`OPS_ALERT_WEBHOOK_URL`, 코드는 `apps/api/src/modules/ops/service.ts`)

Discord 채널 웹훅으로 보낸다. 알림에는 이메일·이름·생년월일·질문 내용을 넣지 않고 가입 방식, 상품, 금액, 주문 번호만 적는다.

| 알림 | 언제 | 할 일 |
|---|---|---|
| 👤 새 회원 가입 | 이메일·소셜 가입, 게스트에서 회원 전환(게스트 시작은 알리지 않음) | 없음 |
| 💳 결제 완료 | 결제가 확정되어 지급했을 때(웹·인앱 모두) | 없음 |
| ↩️ 환불·결제 취소 | 결제사·스토어·관리자 API 로 환불되어 지급분을 회수했을 때(돌려준 금액으로 적는다). 부분 환불은 자동 회수하지 않고 알린다 | 부분 환불이면 회수할 질문권 확인 |
| ⚠️ 환불 필요 | 중복 결제, 이미 가진 콘텐츠 재결제, 금액·상품 불일치, 구매 한도 초과 | 그로블 판매자 화면에서 그 결제 환불 |
| ⏳ 결제 확인 지연 | 결제 확인 화면에 머물러 결제를 기다린 주문에 30분이 지나도 결제 알림이 오지 않았을 때(10분마다 확인, 알림이 전달되면 주문마다 1회, 전송이 실패하면 다음 실행에 다시) | 그로블에서 결제됐는지 확인. 결제됐으면 웹훅 설정 점검 |
| 🚫 결제 웹훅 검증 실패 | 서명이 틀린 결제 알림을 거절했을 때(30분 창에 1회) | 웹훅 시크릿이 그로블 설정과 같은지 확인 |
| 🤖 AI 장애 | Anthropic 잔액 부족·키 오류·요청 한도·서버 장애(종류별 30분 창에 1회) | 잔액 부족이면 콘솔에서 충전 |
| 🔥 서버 오류 | 처리하지 못한 500 오류(같은 주소·종류는 5분 창에 1회, 나머지는 창이 끝난 뒤 "N건 더") | 로그에서 원인 확인 |
| 📊 어제 요약 | 매일 08:00 KST | 없음 |

어제 요약에는 가입(가입 방식별)·탈퇴(회원)·전체 회원 수, 결제·환불(돌려준 금액, 부분 환불은 따로) 건수와 금액, 상품별 판매 수, 타로·AI 꿈풀이·상담 답변·리포트 수, AI 호출 수(종류별)·토큰·예상 비용(단가표와 환율 1,450원으로 어림), 오늘의 운세 푸시 결과, 로그인 잠금·검증 실패 웹훅·서버 오류 수가 들어간다. 집계는 `ops_counters` 테이블에 쌓이고 40일 뒤 지운다. 같은 정리 작업이 요청 ID 선점 기록(2일), 광고 보상 기록(30일), 결제 웹훅 기록(180일), 지난 로그인 실패 집계(1일)도 지운다([features/ops.md](./features/ops.md)).

웹훅 주소를 넣거나 바꾼 뒤에는 `npx wrangler tail` 에 `[config] OPS_ALERT_WEBHOOK_URL` 경고·오류가 없는지 본다. `https://` 로 시작하지 않는 값은 서버를 멈추지 않고 알림만 꺼지므로, 로그를 보지 않으면 알기 어렵다.

예약 실행(`wrangler.jsonc` triggers.crons): `*/10 * * * *` 결제 확인 지연·묶음 알림 정리, `0 23 * * *`(08:00 KST) 어제 요약·기록 정리·오늘의 운세 푸시·토스 환불 확인.

**설정 바꾼 뒤**
- 시크릿: `npx wrangler secret put 이름` — 따로 배포하지 않아도 반영된다.
- vars·요청 수 제한·Cron: `wrangler.jsonc` 를 고친 뒤 `npm run deploy`.

## 5. 주의

- 시크릿은 Cloudflare 에만 둔다. 로컬 `apps/api/.env` 는 저장소에 올리지 않는다(.gitignore).
- 요청 수 제한은 Cloudflare Rate Limiting 바인딩으로, 접속 IP(`cf-connecting-ip`) 기준이고 운영 모드에서만 켜진다. API 전체 60초에 120회, 인증 경로(게스트·가입·로그인·토큰 갱신·비밀번호) 60초에 10회, 관리자 경로 60초에 20회. 값은 `wrangler.jsonc` 의 `ratelimits` 에서 바꾼다.
- 그로블 웹훅 주소는 `https://도메인/api/v1/payments/webhooks/groble` 이다(`PAYMENTS.md` §3.5). 그로블에 등록한 주소와 도메인이 다르면 결제가 확정되지 않는다.
- 오늘의 운세 푸시는 Cron Trigger(`0 23 * * *` = 08:00 KST)가 하루 한 번 실행한다. `DAILY_PUSH_ENABLED=true` 이고 FCM 키가 있을 때만 보내므로, 앱 출시 전에는 FCM 키를 넣지 않으면 된다.
- 이전 구성(Lightsail 서버 + Docker·Caddy·nginx·PostgreSQL, `deploy/` 폴더)은 삭제했다. 개발용 SQLite·PGlite 데이터는 옮기지 않았다.
- DB 구조·동시성 처리: [`architecture.md`](./architecture.md) §5.
