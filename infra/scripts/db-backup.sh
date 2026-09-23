#!/usr/bin/env bash
# Dump the rushsite Postgres database from the compose stack.
# Keeps BACKUP_RETENTION_DAYS of local dumps and optionally copies each dump to S3.
#
# Cron example, daily at 04:15:
#   15 4 * * * /srv/rushsite/infra/scripts/db-backup.sh >> /var/log/rushsite-backup.log 2>&1
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/rushsite}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}"
POSTGRES_USER="${POSTGRES_USER:-rushsite}"
POSTGRES_DB="${POSTGRES_DB:-rushsite}"

COMPOSE=(docker compose -f docker-compose.yml)
if [[ -f docker-compose.prod.yml && "${NODE_ENV:-}" == "production" ]]; then
  COMPOSE+=(-f docker-compose.prod.yml)
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/${POSTGRES_DB}-${stamp}.dump"
tmp="$out.partial"

echo "[$(date -u +%FT%TZ)] dumping $POSTGRES_DB to $out"
# Custom format is compressed and restores with pg_restore.
"${COMPOSE[@]}" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=6 --no-owner \
  > "$tmp"

if [[ ! -s "$tmp" ]]; then
  echo "backup is empty, aborting" >&2
  rm -f "$tmp"
  exit 1
fi
mv "$tmp" "$out"
chmod 600 "$out"
echo "wrote $(du -h "$out" | cut -f1)"

if [[ -n "$BACKUP_S3_BUCKET" ]]; then
  if command -v aws >/dev/null 2>&1; then
    endpoint_args=()
    if [[ -n "${S3_ENDPOINT:-}" ]]; then
      endpoint_args=(--endpoint-url "$S3_ENDPOINT")
    fi
    AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-}" \
    AWS_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-}" \
    AWS_DEFAULT_REGION="${S3_REGION:-us-east-1}" \
      aws "${endpoint_args[@]}" s3 cp "$out" "s3://$BACKUP_S3_BUCKET/db/$(basename "$out")"
    echo "uploaded to s3://$BACKUP_S3_BUCKET/db/"
  else
    echo "BACKUP_S3_BUCKET is set but aws cli is missing, skipping upload" >&2
  fi
fi

find "$BACKUP_DIR" -name "${POSTGRES_DB}-*.dump" -type f -mtime "+$BACKUP_RETENTION_DAYS" -print -delete

# Restore with:
#   docker compose exec -T postgres pg_restore -U rushsite -d rushsite --clean --if-exists < file.dump
