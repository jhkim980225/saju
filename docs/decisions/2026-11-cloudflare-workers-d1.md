# 운영 환경을 Cloudflare Workers 하나와 D1 로 옮긴다

- 날짜: 2026-11-11 (PostgreSQL 전환은 2026-10-21)
- 상태: 채택 (2026-10-21 의 PostgreSQL·Supabase 구성은 이 결정으로 대체되었다)
- 관련 커밋:
  - `16b03ba` 운영 배포 구성: Caddy HTTPS, 운영 compose, 매일 백업(2026-10-19)
  - `8a3bc23` API DB 를 SQLite 에서 PostgreSQL 로 전환: 운영 Supabase, 개발·테스트 PGlite(2026-10-21)
  - `2a4b0b8` 배포를 Cloudflare 로 전환: Workers(Hono) 하나로 웹·API, DB 는 D1(2026-11-11)
  - `4f1eff8` D1 database_id 연결, 요청 제한 namespace_id 를 계정의 다른 Worker 와 겹치지 않게(2026-11-11)
- 관련 문서: [architecture.md](../architecture.md) §5, [DEPLOY.md](../DEPLOY.md), [SECURITY_REVIEW.md](../SECURITY_REVIEW.md), [COSTS.md](../COSTS.md) §1, [features/ops.md](../features/ops.md)

## 맥락

첫 커밋의 API 는 Fastify 와 better-sqlite3(SQLite 파일)였고, 문서는 "트래픽이 늘면 PostgreSQL 전환 절을 따른다"고 적었다. 2026-10-19 에 서버 한 대에 Caddy, nginx, API 컨테이너를 올리는 구성을 만들었고, 2026-10-21 에 DB 를 PostgreSQL 로 바꿔 운영은 Supabase, 개발과 테스트는 PGlite 를 쓰게 했다. 동시성은 사용자 행 `FOR UPDATE`, 조건부 UPDATE, 유니크 인덱스로 처리했다. 이전 구성은 Lightsail 서버와 Docker·Caddy·nginx·PostgreSQL 이었다(DEPLOY.md §5).

## 결정

- Cloudflare Worker `dalbit-saju` 하나가 웹 정적 파일과 API(`/api/*`, `/health`)를 같은 주소에서 낸다. API 프레임워크는 Fastify 에서 Hono 로 바꾸고 라우트와 서비스 로직은 유지한다.
- DB 는 D1(SQLite)이다. 리포트 AI 다듬기는 Queues, 매일 푸시와 운영 작업은 Cron Triggers, 요청 수 제한은 Rate Limiting 바인딩으로 옮긴다.
- D1 에는 BEGIN…COMMIT 대화형 트랜잭션이 없으므로 `apps/api/src/db/atomic.ts` 의 `atomic()` 으로 낙관적 동시성 제어를 한다. 먼저 읽고 판단한 뒤 모든 쓰기를 batch 하나로 실행한다. batch 맨 앞에 판단의 전제를 다시 확인하는 guard 문장(`atomic_guards` 에 조건이 깨졌을 때만 NULL 을 넣는 문장)을 두어, 전제가 깨졌으면 batch 전체가 취소되고 처음부터 다시 실행한다(최대 12번, 넘으면 409).
- 잔액은 상대 SQL(`credits = credits + ?`)로 갱신하고, 중복 생성은 유니크 인덱스와 `ON CONFLICT DO NOTHING` 으로 막는다.
- Docker, Caddy, compose, 백업 스크립트(`deploy/`)는 지운다.

## 근거

- architecture.md 는 Cloudflare 운영 구성의 이유를 "서버 관리가 없고, 계정당 월 $5(Workers Paid) 플랜 안에서 돈다. 웹과 API 가 같은 출처"로 적는다. 같은 계정의 다른 프로젝트도 이 플랜을 함께 쓴다(COSTS.md §1).
- 개발은 `wrangler dev` 의 로컬 D1, 테스트는 libSQL 인메모리 SQLite 라 DB 설치가 필요 없다.
- SQLite 에서 PostgreSQL 로, 다시 Supabase 에서 D1 으로 옮긴 직접적인 이유는 커밋과 문서에 없다. TODO: 확인 필요.

## 결과와 영향

얻은 것:
- 운영 서버와 인증서, 백업 작업을 직접 관리하지 않는다. D1 Time Travel 로 최근 30일 안의 시점으로 복구한다.
- 웹과 API 가 같은 출처라 웹에는 CORS 가 필요 없다.

감수한 것:
- 트랜잭션 대신 guard 와 재시도를 쓰므로 쓰기 코드가 복잡하다. drizzle 의 D1 batch 가 인자 있는 `db.run(sql)` 을 실행하지 못하는 버그 때문에 batch 안의 쓰기는 쿼리 빌더로만 쓴다. 이 제약을 놓쳐 2026-11-25 에 고친 게스트 병합 코드가 D1 batch 에서 500 을 내는 회귀가 있었다.
- 요청마다 다른 Worker 인스턴스가 받을 수 있어 리포트 다듬기의 진행률과 담당 기한을 메모리가 아닌 DB 컬럼에 둔다.
- Rate Limiting 바인딩이 매우 느슨하다는 것이 실측으로 확인되었다(한도 5회 시험에서 42회 중 3회만 차단). 로그인은 계정 단위 실패 제한을 따로 만들었다.
- Workers isolate 메모리 한도 때문에 비밀번호 해시 scrypt 는 OWASP 권장 N=2^17 대신 N=2^14 를 쓴다(SECURITY_REVIEW.md 수용 항목).
- 테스트를 libSQL 과 실제 D1(Miniflare, `TEST_D1=1`)에서 두 번 돌린다. drizzle-kit 이 식 유니크 인덱스 `reports_target_uq` 를 잘못 만들어 첫 마이그레이션을 손으로 고쳤고, 다시 생성할 때 확인해야 한다.
- 개발용 SQLite·PGlite 데이터는 옮기지 않았다.

남은 일:
- Cloudflare 대시보드에서 최소 TLS 버전을 1.2 로 올리고, `/api/v1/auth/` 에 IP 기준 WAF Rate limiting 규칙을 추가한다(SECURITY_REVIEW.md 운영자 할 일).
