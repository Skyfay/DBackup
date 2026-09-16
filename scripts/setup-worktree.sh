#!/usr/bin/env bash
set -e

# Resolve the primary checkout: prefer Orca's variable, fall back to git
ROOT="${ORCA_ROOT_PATH:-$(git worktree list --porcelain | head -n1 | sed 's/^worktree //')}"
TARGET="${ORCA_WORKTREE_PATH:-$(pwd)}"

if [ "$ROOT" = "$TARGET" ]; then
  echo "Running in the primary checkout, nothing to copy."
  exit 0
fi

# Clone a file using APFS copy-on-write on macOS, fall back to a regular copy elsewhere
clone() {
  cp -c "$1" "$2" 2>/dev/null || cp "$1" "$2"
}

# Copy a single file if it exists in the primary checkout and not yet in the worktree
copy_file() {
  if [ -f "$ROOT/$1" ] && [ ! -f "$TARGET/$1" ]; then
    clone "$ROOT/$1" "$TARGET/$1"
    echo "Copied: $1"
  fi
}

# Copy the SQLite database together with its WAL and shared-memory files.
# These files must always be copied as a set, otherwise data in the WAL is lost
# or the database may become corrupt.
copy_sqlite() {
  local db="$1"

  if [ ! -f "$ROOT/$db" ]; then
    echo "No database found at $db, skipping."
    return
  fi

  # Never overwrite an existing worktree database
  if [ -f "$TARGET/$db" ]; then
    echo "Database already exists in worktree, skipping: $db"
    return
  fi

  # Warn if the database is currently in use (e.g. pnpm dev running in the primary checkout)
  if command -v lsof >/dev/null 2>&1 && lsof "$ROOT/$db" >/dev/null 2>&1; then
    echo "Warning: $db is currently in use. The copy may be inconsistent."
  fi

  # Remove stale sidecar files in the worktree that do not belong to the new copy
  rm -f "$TARGET/$db-wal" "$TARGET/$db-shm"

  for suffix in "" "-wal" "-shm"; do
    if [ -f "$ROOT/$db$suffix" ]; then
      clone "$ROOT/$db$suffix" "$TARGET/$db$suffix"
      echo "Copied: $db$suffix"
    fi
  done
}

copy_file .env
copy_sqlite prisma/dev.db

cd "$TARGET"
pnpm install