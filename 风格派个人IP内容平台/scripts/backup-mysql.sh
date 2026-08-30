#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_DB_HOST:?PROJECT_DB_HOST is required}"
: "${PROJECT_DB_NAME:?PROJECT_DB_NAME is required}"
: "${PROJECT_DB_USER:?PROJECT_DB_USER is required}"
: "${PROJECT_DB_PASSWORD:?PROJECT_DB_PASSWORD is required}"

backup_dir="${PROJECT_DB_BACKUP_DIR:-./backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="${backup_dir}/${PROJECT_DB_NAME}-${timestamp}.sql.gz"

mkdir -p "${backup_dir}"
MYSQL_PWD="${PROJECT_DB_PASSWORD}" mysqldump \
  --host="${PROJECT_DB_HOST}" \
  --port="${PROJECT_DB_PORT:-3306}" \
  --user="${PROJECT_DB_USER}" \
  --single-transaction \
  --quick \
  --no-tablespaces \
  --routines \
  --triggers \
  "${PROJECT_DB_NAME}" | gzip -c > "${backup_file}"

chmod 600 "${backup_file}"
