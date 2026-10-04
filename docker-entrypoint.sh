#!/bin/sh
set -e

# ─── Docker Secrets / _FILE resolution ───────────────────────
# Supports the common _FILE convention used by Docker Swarm secrets.
# If ENCRYPTION_KEY_FILE or BETTER_AUTH_SECRET_FILE is set, the content
# of that file is read and exported as the corresponding env variable.
# The file content is stripped of trailing newlines/carriage returns.
_resolve_secret() {
  var_name="$1"
  file_var="${var_name}_FILE"
  file_path=$(printenv "$file_var" || true)
  if [ -n "$file_path" ]; then
    if [ ! -r "$file_path" ]; then
      echo "Error: $file_var is set but '$file_path' is not readable"; exit 1
    fi
    secret_val=$(tr -d '\r\n' < "$file_path")
    if [ -z "$secret_val" ]; then
      echo "Error: $file_var points to an empty file '$file_path'"; exit 1
    fi
    export "$var_name=$secret_val"
    echo "Loaded $var_name from $file_var"
  fi
}

_resolve_secret ENCRYPTION_KEY
_resolve_secret BETTER_AUTH_SECRET

# ─── Configurable UID/GID ────────────────────────────────────
# Defaults match the build-time user (1001:1001).
# Override with PUID/PGID env vars to match host user permissions.
PUID=${PUID:-1001}
PGID=${PGID:-1001}

# Validate PUID/PGID are numeric and non-root
case "$PUID" in
  ''|*[!0-9]*) echo "Error: PUID must be a positive integer, got '$PUID'"; exit 1 ;;
esac
case "$PGID" in
  ''|*[!0-9]*) echo "Error: PGID must be a positive integer, got '$PGID'"; exit 1 ;;
esac
if [ "$PUID" = "0" ] || [ "$PGID" = "0" ]; then
  echo "Error: Running as root (PUID/PGID=0) is not supported"; exit 1
fi

# Adjust group ID in /etc/group if changed
if [ "$PGID" != "1001" ]; then
  sed -i "s/^nodejs:x:1001:/nodejs:x:${PGID}:/" /etc/group
fi

# Adjust user ID and/or group reference in /etc/passwd if changed
if [ "$PUID" != "1001" ] || [ "$PGID" != "1001" ]; then
  sed -i "s/^nextjs:x:1001:1001:/nextjs:x:${PUID}:${PGID}:/" /etc/passwd
fi

# ─── Fix internal directory permissions ───────────────────────
# All persistent data lives under /data (single mount point).
# Subdirectories are created automatically if missing.
DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR/db" "$DATA_DIR/certs"

chown -R "$PUID:$PGID" "$DATA_DIR"

# Only chown /pnpm if ownership doesn't match (avoids slow recursive walk on every start)
if [ "$(stat -c '%u' /pnpm 2>/dev/null)" != "$PUID" ]; then
  chown -R "$PUID:$PGID" /pnpm
fi

# ─── Ensure /tmp is writable ─────────────────────────────────
# Prisma engine needs /tmp for binary extraction at runtime.
# Some Docker layer combinations (COPY --link) may reset /tmp permissions.
chmod 1777 /tmp

# ─── Start application ───────────────────────────────────────
# A configuration restore waits beside the database until DBackup is down, swap it in first.
# Then run database migrations, which bring an older restored copy up to date, and exec node
# as PID 1 for proper signal handling
gosu "$PUID:$PGID" node /app/scripts/apply-pending-restore.js
gosu "$PUID:$PGID" prisma migrate deploy
exec gosu "$PUID:$PGID" node custom-server.js
