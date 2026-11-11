#!/usr/bin/env bash
# Starts a throwaway Postgres + PostGIS for `npm run test:db`.
# Prefers Docker; falls back to local Postgres 16 binaries (set PGBIN to override).
# The tests create and drop their own database, so this server holds nothing of value.
set -euo pipefail

PORT="${GUPIT_TEST_PG_PORT:-54329}"
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker rm -f gupit-test-pg >/dev/null 2>&1 || true
  docker run -d --name gupit-test-pg -e POSTGRES_PASSWORD=postgres -p "${PORT}:5432" postgis/postgis:16-3.4 >/dev/null
  echo "Started Docker container gupit-test-pg on port ${PORT}."
else
  PGBIN="${PGBIN:-$(dirname "$(command -v pg_ctl || echo /usr/lib/postgresql/16/bin/pg_ctl)")}"
  DATA="${GUPIT_TEST_PG_DATA:-/tmp/gupit-test-pg}"
  RUN=""
  # Postgres refuses to run as root; use the postgres OS user when we are root.
  if [ "$(id -u)" = "0" ]; then RUN="su postgres -c"; fi
  run() { if [ -n "$RUN" ]; then $RUN "$1"; else bash -c "$1"; fi; }
  if [ ! -d "$DATA" ]; then
    mkdir -p "$DATA" && { [ -z "$RUN" ] || chown postgres "$DATA"; }
    run "$PGBIN/initdb -D $DATA -U postgres -A trust >/dev/null"
  fi
  run "$PGBIN/pg_ctl -D $DATA -o '-p ${PORT} -c listen_addresses=127.0.0.1' -l $DATA/server.log -w start"
  echo "Started local Postgres on port ${PORT} (data: $DATA)."
fi

echo "Run: DATABASE_URL=${DATABASE_URL} npm run test:db"
