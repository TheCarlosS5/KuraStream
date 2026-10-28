#!/usr/bin/env bash
# Restores a KuraStream database backup (the .sql.gz files the worker and the admin panel create).
#
#   scripts/restore_backup.sh backups/kurastream-20261005-031500.sql.gz --yes
#
# It reads the same variables as the app (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS; a .env file in the project
# root is used when they are not set). Before touching anything it saves the CURRENT database next to the backup
# (pre-restore-<time>.sql.gz), so a wrong file can be undone. Tables in the backup replace the ones with the same name.
#
# Docker:  docker compose exec -T app sh -c 'cd /app && scripts/restore_backup.sh /backups/<file>.sql.gz --yes'
# (the "app" image has the mariadb client; the backup volume is mounted at /backups).
set -euo pipefail

usage() { echo "Uso: $0 <respaldo.sql.gz> --yes" >&2; exit 2; }
[ $# -ge 1 ] || usage
FILE="$1"; shift
CONFIRMED=0
for arg in "$@"; do [ "$arg" = "--yes" ] && CONFIRMED=1; done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$ROOT/.env" ]; then
  # Only the DB_* lines, and only for variables that are not already set
  while IFS='=' read -r key value; do
    case "$key" in DB_HOST|DB_PORT|DB_NAME|DB_USER|DB_PASS) [ -z "${!key:-}" ] && export "$key=${value//\"/}";; esac
  done < <(grep -E '^DB_(HOST|PORT|NAME|USER|PASS)=' "$ROOT/.env" || true)
fi
: "${DB_HOST:=127.0.0.1}" "${DB_PORT:=3306}" "${DB_NAME:?DB_NAME no está definido}" "${DB_USER:?DB_USER no está definido}"
export MYSQL_PWD="${DB_PASS:-}"

[ -f "$FILE" ] || { echo "No existe el archivo: $FILE" >&2; exit 1; }
gzip -t "$FILE" 2>/dev/null || { echo "El archivo no es un .gz válido (¿descarga incompleta?): $FILE" >&2; exit 1; }
# A real mysqldump ends with this marker; a truncated file does not.
gzip -dc "$FILE" | tail -c 400 | grep -q 'Dump completed' || { echo "El respaldo está incompleto (le falta el final del volcado): $FILE" >&2; exit 1; }
[ "$CONFIRMED" = 1 ] || { echo "Esto reemplaza las tablas de '$DB_NAME' en $DB_HOST con el contenido de $FILE. Repite con --yes para continuar." >&2; exit 2; }

DUMP="$(command -v mysqldump || command -v mariadb-dump || true)"
CLIENT="$(command -v mysql || command -v mariadb || true)"
[ -n "$DUMP" ] && [ -n "$CLIENT" ] || { echo "Hace falta el cliente de MySQL/MariaDB (mysql y mysqldump)." >&2; exit 1; }

SAFETY="$(dirname "$FILE")/pre-restore-$(date +%Y%m%d-%H%M%S).sql.gz"
echo "Guardando el estado actual en $SAFETY ..."
"$DUMP" --single-transaction --quick --no-tablespaces --skip-lock-tables -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" | gzip -6 > "$SAFETY"

echo "Restaurando $FILE en $DB_NAME ..."
gzip -dc "$FILE" | "$CLIENT" -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME"
echo "Listo. Reinicia el servicio para limpiar cachés si hace falta."
