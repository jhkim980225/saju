#!/usr/bin/env bash
# SQLite DB 백업 — 실행 중인 api 컨테이너 안에서 sqlite 의 온라인 백업으로 사본을 만들고, 7일치만 남긴다.
# 서버 crontab 예: 0 4 * * * /opt/saju/deploy/backup.sh >> /var/log/saju-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
OUT=${BACKUP_DIR:-/opt/saju-backups}
mkdir -p "$OUT"
STAMP=$(date +%Y%m%d-%H%M)
# better-sqlite3 의 backup() 은 쓰기 중에도 일관된 사본을 만든다
docker compose -f docker-compose.prod.yml exec -T api node -e "
const Database = require('better-sqlite3');
new Database(process.env.DATABASE_PATH, { readonly: true }).backup('/data/backup.db').then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
"
docker compose -f docker-compose.prod.yml cp api:/data/backup.db "$OUT/saju-$STAMP.db"
docker compose -f docker-compose.prod.yml exec -T api rm -f /data/backup.db
gzip -f "$OUT/saju-$STAMP.db"
find "$OUT" -name 'saju-*.db.gz' -mtime +7 -delete
echo "backup ok: $OUT/saju-$STAMP.db.gz"
