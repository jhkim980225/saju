# 운영 배포 절차 — 웹 (서버 1대, Docker)

구성: `Caddy(HTTPS 자동 발급) → web(nginx: 정적 파일 + /api 프록시) → api(Fastify + SQLite)`. 파일은 모두 `deploy/` 에 있다.

## 0. 준비할 것

| 항목 | 내용 |
|---|---|
| 서버 | Ubuntu 22.04/24.04, 2 vCPU · 2 GB RAM 이상, 공개 IP. 80·443 포트 열림 |
| 도메인 | A 레코드 `@` 와 `www` → 서버 IP. (전파에 몇 분~몇 시간) |
| 키 | `deploy/api.prod.env` 에 넣을 값 — 필수: JWT 시크릿 2개, 관리자 토큰, 그로블 웹훅 시크릿·결제창 링크. 선택: Anthropic, Resend(메일), 소셜 로그인. 목록은 [`ENV_KEYS.md`](./ENV_KEYS.md) |

## 1. 서버 한 번만 설정

```bash
# Docker 설치 (공식 스크립트)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# 코드 받기
sudo mkdir -p /opt/saju && sudo chown $USER /opt/saju
git clone https://github.com/jhkim980225/saju.git /opt/saju
cd /opt/saju

# 운영 env 만들기
cp deploy/api.prod.env.example deploy/api.prod.env
openssl rand -base64 48   # → JWT_ACCESS_SECRET
openssl rand -base64 48   # → JWT_REFRESH_SECRET (다른 값)
openssl rand -hex 24      # → ADMIN_API_TOKEN
nano deploy/api.prod.env  # 위 값과 그로블 키 등 채우기
```

## 2. 올리기

```bash
cd /opt/saju
export DOMAIN=dalbitsaju.kr          # 실제 도메인
docker compose -f deploy/docker-compose.prod.yml up -d --build
docker compose -f deploy/docker-compose.prod.yml logs -f api   # '미설정 연동:' 줄로 어떤 키가 빠졌는지 확인
```

첫 기동 때 Caddy 가 Let's Encrypt 인증서를 받는다(1분 안팎). `https://도메인` 이 열리고 `https://도메인/health` 가 `ok` 면 끝.
DB 마이그레이션과 상품 시드는 api 기동 시 자동이다.

## 3. 확인 목록 (오픈 전)

- [ ] `https://도메인` 첫 화면, `https://www.도메인` → 본 도메인으로 이동
- [ ] 비회원 사주 입력 → 결과, 오늘의 운세, 띠별·별자리·꿈해몽 페이지 열림
- [ ] 이메일 가입·로그인, (키 있으면) 카카오 로그인
- [ ] 그로블 결제 1건: 결제창 → 결제 → 웹훅 수신 → 상품 열림 ([`PAYMENTS.md`](./PAYMENTS.md) §3.5). 환불 1건까지
- [ ] `https://도메인/sitemap.xml`, `/robots.txt` 열림 → 네이버 서치어드바이저·구글 서치콘솔에 등록
- [ ] 약관·개인정보처리방침에 사업자 정보가 들어갔는지
- [ ] 백업 cron 등록 (아래)

## 4. 운영

**코드 갱신**
```bash
cd /opt/saju && git pull
export DOMAIN=dalbitsaju.kr
docker compose -f deploy/docker-compose.prod.yml up -d --build
```
빌드 중에도 기존 컨테이너가 돌다가 새 이미지로 교체되므로 끊김은 몇 초다.

**백업** — SQLite 파일을 매일 새벽 4시에 복사(7일 보관). 다른 곳(스토리지·다른 서버)에 한 번 더 옮기는 걸 권장.
```bash
chmod +x /opt/saju/deploy/backup.sh
(crontab -l 2>/dev/null; echo "0 4 * * * DOMAIN=dalbitsaju.kr /opt/saju/deploy/backup.sh >> /var/log/saju-backup.log 2>&1") | crontab -
```
복구: `docker compose -f deploy/docker-compose.prod.yml stop api` → `gunzip -c 백업.db.gz > saju.db` → `docker compose cp saju.db api:/data/saju.db` → `start api`.

**로그·상태**
```bash
docker compose -f deploy/docker-compose.prod.yml ps
docker compose -f deploy/docker-compose.prod.yml logs --tail 200 api
```

**환경 변수 바꾼 뒤**: `docker compose -f deploy/docker-compose.prod.yml up -d api` (api 만 재시작).

## 5. 주의

- `deploy/api.prod.env` 는 저장소에 올리지 않는다(.gitignore). 서버에만 둔다.
- `TRUST_PROXY_HOPS=2`(Caddy → nginx → api)라 레이트리밋이 실제 방문자 IP 기준으로 돈다. 앞에 Cloudflare 같은 프록시를 하나 더 두면 3으로 올린다.
- 그로블 웹훅 주소는 `https://도메인/api/v1/payments/webhooks/groble` 이다(`PAYMENTS.md` §3.5). 그로블에 등록한 주소와 도메인이 다르면 결제가 확정되지 않는다.
- 서버 1대 구성이라 `DAILY_PUSH_ENABLED` 는 앱 출시 뒤 이 서버에서만 `true` 로 켠다.
- 트래픽이 늘면 [`ARCHITECTURE.md`](./ARCHITECTURE.md) 의 PostgreSQL 전환 절을 따른다.
