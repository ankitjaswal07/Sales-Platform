#!/bin/sh
# Container entrypoint.
#
# On a brand-new volume there is no database yet, so the app would correctly
# refuse to serve a workspace that has not been initialised. When
# SEED_DEMO_DATA=true we create the demo workspace once; on every later start the
# existing database is left completely alone.
set -e

DB_PATH="${DATABASE_PATH:-data/leadforge.db}"

if [ "${SEED_DEMO_DATA:-true}" = "true" ] && [ ! -f "$DB_PATH" ]; then
  echo "[entrypoint] No database at $DB_PATH — seeding the demo workspace."
  if [ -n "${SEED_PASSWORD:-}" ]; then
    echo "[entrypoint] Using SEED_PASSWORD for the demo users."
  else
    echo "[entrypoint] SEED_PASSWORD is not set, so the demo password is 'leadforge-demo'. Change it before exposing this instance."
  fi
  node --experimental-strip-types --conditions=react-server --import ./scripts/register.mjs scripts/db-seed.ts \
    || echo "[entrypoint] Seeding failed; starting anyway so the error is visible in the UI."
fi

exec "$@"
