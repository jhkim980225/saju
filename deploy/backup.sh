#!/usr/bin/env bash
# PostgreSQL 백업 — 실행 중인 db 컨테이너에서 pg_dump(쓰기 중에도 일관된 스냅샷)로 사본을 만들고, 7일치만 남긴다.
# 서버 crontab 예: 0 4 * * * /opt/saju/deploy/backup.sh >> /var/log/saju-backup.log 2>&1
# 복구: gunzip -c 백업.sql.gz | docker compose -f deploy/docker-compose.prod.yml exec -T db psql -U saju -d saju
set -euo pipefail
cd "$(dirname "$0")"
OUT=${BACKUP_DIR:-/opt/saju-backups}
mkdir -p "$OUT"
STAMP=$(date +%Y%m%d-%H%M)
FILE="$OUT/saju-$STAMP.sql.gz"
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U saju -d saju --clean --if-exists --no-owner | gzip > "$FILE.part"
mv "$FILE.part" "$FILE"
find "$OUT" -name 'saju-*.sql.gz' -mtime +7 -delete
echo "backup ok: $FILE"
