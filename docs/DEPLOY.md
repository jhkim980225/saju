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
- 웹 빌드는 빌드 시점의 값을 읽는다. 사전 렌더링(`apps/web/scripts/prerender.mts`)의 canonical·og·`sitemap.xml` 주소는 `PUBLIC_WEB_URL` 환경 변수(없으면 `https://dalbitsaju.kr`)를 쓴다. 광고·분석·Firebase 같은 공개 키(`VITE_*`)는 `apps/web/.env` 에서 읽는다. `VITE_API_BASE_URL` 은 비워 둔다(같은 Worker 의 `/api/v1`).

배포가 끝나면 Custom Domain 을 붙인다.

1. Cloudflare 대시보드 → Workers & Pages → `dalbit-saju` → Settings → Domains & Routes → Add → Custom Domain
2. 도메인을 입력한다(도메인이 Cloudflare DNS 에 있어야 한다). DNS 레코드와 인증서는 Cloudflare 가 만든다.

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

**설정 바꾼 뒤**
- 시크릿: `npx wrangler secret put 이름` — 따로 배포하지 않아도 반영된다.
- vars·요청 수 제한·Cron: `wrangler.jsonc` 를 고친 뒤 `npm run deploy`.

## 5. 주의

- 시크릿은 Cloudflare 에만 둔다. 로컬 `apps/api/.env` 는 저장소에 올리지 않는다(.gitignore).
- 요청 수 제한은 Cloudflare Rate Limiting 바인딩으로, 접속 IP(`cf-connecting-ip`) 기준이고 운영 모드에서만 켜진다. API 전체 60초에 120회, 인증 경로(게스트·가입·로그인·토큰 갱신·비밀번호) 60초에 10회, 관리자 경로 60초에 20회. 값은 `wrangler.jsonc` 의 `ratelimits` 에서 바꾼다.
- 그로블 웹훅 주소는 `https://도메인/api/v1/payments/webhooks/groble` 이다(`PAYMENTS.md` §3.5). 그로블에 등록한 주소와 도메인이 다르면 결제가 확정되지 않는다.
- 오늘의 운세 푸시는 Cron Trigger(`0 23 * * *` = 08:00 KST)가 하루 한 번 실행한다. `DAILY_PUSH_ENABLED=true` 이고 FCM 키가 있을 때만 보내므로, 앱 출시 전에는 FCM 키를 넣지 않으면 된다.
- 이전 구성(Lightsail 서버 + Docker·Caddy·nginx·PostgreSQL, `deploy/` 폴더)은 삭제했다. 개발용 SQLite·PGlite 데이터는 옮기지 않았다.
- DB 구조·동시성 처리: [`ARCHITECTURE.md`](./ARCHITECTURE.md) 의 DB 절.
