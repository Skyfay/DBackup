#!/bin/sh
# Checks ENCRYPTION_KEY before docker-entrypoint.sh keeps a copy of the database and runs the
# migrations. Node checks it again at startup (src/lib/server/env-validation.ts), but by then the
# migrations have run and cannot be undone, so an update with a missing or bad key would leave a
# migrated database behind an app that refuses to start. The sentences match env-validation.ts.

fail() {
  echo "Error: ENCRYPTION_KEY: $1"
  echo "DBackup did not start and left the database untouched."
  exit 1
}

if [ -z "${ENCRYPTION_KEY:-}" ]; then
  fail "ENCRYPTION_KEY is required. Generate with: openssl rand -hex 32"
fi

if [ "${#ENCRYPTION_KEY}" -ne 64 ]; then
  fail "ENCRYPTION_KEY must be a 64-character hex string (32 bytes)"
fi

case "$ENCRYPTION_KEY" in
  *[!0-9a-fA-F]*) fail "ENCRYPTION_KEY must hold hex characters only (0-9, a-f). Generate with: openssl rand -hex 32" ;;
esac

exit 0
