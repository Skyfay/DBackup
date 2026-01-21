# PostgreSQL Adapter Guide

Comprehensive guide for the PostgreSQL database adapter, including version-specific compatibility handling and binary version matching.

---

## Table of Contents

1. [Overview](#overview)
2. [The Cross-Version Compatibility Problem](#the-cross-version-compatibility-problem)
3. [Solution: Version-Matched Binaries](#solution-version-matched-binaries)
4. [Architecture](#architecture)
5. [Implementation Details](#implementation-details)
6. [Development Setup](#development-setup)
7. [Testing](#testing)
8. [Troubleshooting](#troubleshooting)

---

## Overview

The PostgreSQL adapter supports:
- **Single-database backups** using `pg_dump` (Custom format, compressed)
- **Multi-database backups** using `pg_dumpall` (Plain SQL format)
- **Selective/mapped restore** with database renaming
- **Cross-version compatibility** (PostgreSQL 12-17+)
- **Version-matched binary selection** to prevent format incompatibilities

---

## The Cross-Version Compatibility Problem

### The Root Cause

PostgreSQL backups created with a **newer client version** can contain syntax that **older servers don't understand**.

**Example Scenario:**
```bash
# System has pg_dump 17 installed (latest via Homebrew)
$ which pg_dump
/opt/homebrew/bin/pg_dump

$ pg_dump --version
pg_dump (PostgreSQL) 17.0

# User backs up a PostgreSQL 16.11 server
$ pg_dump -h localhost -U user -d mydb > backup.sql
```

**What happens:**
- `pg_dump 17` creates a dump with **PostgreSQL 17 syntax**
- Includes features like `SET transaction_timeout = 0;` (introduced in PG 17)
- The dump file header shows format version `1.17`

**Restore Failures:**

| Target Server | Result | Reason |
|---------------|--------|--------|
| PostgreSQL 17 | ✅ Success | Server understands PG17 syntax |
| PostgreSQL 16 | ❌ **ERROR: unrecognized configuration parameter "transaction_timeout"** | PG16 doesn't have this parameter |
| PostgreSQL 14 | ❌ **ERROR: unsupported version (1.17) in file header** | pg_restore 14 can't read PG17 dump format |

### Why This Happens

1. **`pg_dump` uses its OWN version syntax**, not the server's version
2. PostgreSQL **doesn't enforce backward compatibility** in dump formats
3. Each major version adds new:
   - Configuration parameters (`transaction_timeout`, `vacuum_failsafe_age`)
   - SQL syntax features
   - Dump format changes

### Real-World Impact

- **PG 14 → PG 14 restore fails** if backed up with `pg_dump 17`
- **PG 16 → PG 16 restore fails** if backed up with `pg_dump 17`
- **PG 16 → PG 17 restore works** (forward compatible only)

This is **unacceptable** for a backup system!

---

## Solution: Version-Matched Binaries

### Core Principle

> **Use the SAME PostgreSQL client version as the target server.**

If the target server is **PostgreSQL 16.11**, we must use:
- `pg_dump 16` for backups
- `pg_restore 16` for restores

### How It Works

```typescript
// 1. Detect server version
const testResult = await adapter.test(config);
// → { version: "PostgreSQL 16.11 on x86_64..." }

// 2. Find version-matched binary
const pgDumpBinary = await getPostgresBinary('pg_dump', testResult.version);
// → /opt/homebrew/opt/postgresql@16/bin/pg_dump

// 3. Use correct binary
spawn(pgDumpBinary, args, { ... });
```

### Benefits

✅ **Backward Compatibility**: PG16 backups work on PG16
✅ **Forward Compatibility**: PG16 backups work on PG17
✅ **No Syntax Errors**: Dumps only contain supported syntax
✅ **No Format Errors**: Dump format matches restore tool

---

## Architecture

### Directory Structure

```
src/lib/adapters/database/postgres/
├── index.ts                    # Adapter registration
├── connection.ts               # test(), getDatabases() - includes VERSION detection
├── dump.ts                     # Backup implementation (uses version-matched binary)
├── restore.ts                  # Restore implementation (uses version-matched binary)
├── version-utils.ts            # Binary path resolution (NEW)
└── dialects/
    ├── index.ts                # Dialect factory (getDialect)
    ├── postgres-base.ts        # Base dialect (common logic)
    ├── postgres-14.ts          # PostgreSQL 14-specific flags
    ├── postgres-16.ts          # PostgreSQL 16-specific flags
    └── postgres-17.ts          # PostgreSQL 17-specific flags
```

### Component Responsibilities

| Component | Purpose |
|-----------|---------|
| **connection.ts** | Detects server version via `SELECT version()` |
| **version-utils.ts** | Finds version-specific binaries on filesystem |
| **dialects/** | Provides version-specific `pg_dump` flags |
| **dump.ts** | Calls `getPostgresBinary()` before spawning |
| **restore.ts** | Calls `getPostgresBinary()` before spawning |

---

## Implementation Details

### 1. Version Detection (`connection.ts`)

```typescript
export async function test(config: any): Promise<{ success: boolean; version?: string }> {
    const args = ['-h', config.host, '-p', String(config.port), '-U', config.user, '-d', 'postgres', '-t', '-c', 'SELECT version()'];
    const { stdout } = await execFileAsync('psql', args, { env });

    // Clean up: "PostgreSQL 16.1 on x86_64-apple-darwin..."
    const version = stdout.trim().split('on')[0].trim();

    return { success: true, version };
}
```

**Output Example:**
```
PostgreSQL 16.11
```

### 2. Binary Path Resolution (`version-utils.ts`)

```typescript
export async function getPostgresBinary(
    tool: 'pg_dump' | 'pg_restore' | 'psql',
    targetVersion?: string
): Promise<string> {
    if (!targetVersion) return tool; // Fallback to PATH

    const majorVersion = targetVersion.match(/(\d+)\./)?.[1]; // "16.11" → "16"

    // Check candidate paths in order
    const candidates = [
        `/opt/homebrew/opt/postgresql@${majorVersion}/bin/${tool}`,     // macOS Homebrew
        `/usr/lib/postgresql/${majorVersion}/bin/${tool}`,              // Linux (Debian/Ubuntu)
        `/opt/pg${majorVersion}/bin/${tool}`,                           // Alpine Docker
        `/usr/libexec/postgresql${majorVersion}/${tool}`,               // Alpine direct
        // ... more paths ...
    ];

    for (const path of candidates) {
        try {
            const { stdout } = await execFileAsync(path, ['--version']);
            if (stdout.includes(`${majorVersion}.`)) {
                return path; // Verified!
            }
        } catch {
            continue;
        }
    }

    console.warn(`Could not find ${tool} v${majorVersion}, using default from PATH`);
    return tool;
}
```

**Example Resolution:**
```
Input:  getPostgresBinary('pg_dump', 'PostgreSQL 16.11')
Output: /opt/homebrew/opt/postgresql@16/bin/pg_dump
```

### 3. Backup with Version-Matched Binary (`dump.ts`)

```typescript
export async function dump(config: any, destinationPath: string, ...): Promise<BackupResult> {
    const dialect = getDialect('postgres', config.detectedVersion);
    const args = dialect.getDumpArgs(config, databases);

    // Use version-matched binary
    const pgDumpBinary = await getPostgresBinary('pg_dump', config.detectedVersion);
    log(`Using ${pgDumpBinary} for PostgreSQL ${config.detectedVersion}`, 'info');

    const dumpProcess = spawn(pgDumpBinary, args, { env });
    // ...
}
```

**Log Output:**
```
Using /opt/homebrew/opt/postgresql@16/bin/pg_dump for PostgreSQL 16.11
Starting single-database dump (custom format)
```

### 4. Restore with Version-Matched Binary (`restore.ts`)

```typescript
export async function restore(config: any, sourcePath: string, ...): Promise<BackupResult> {
    // Detect target server version FIRST
    if (adapter.test) {
        const testResult = await adapter.test(config);
        if (testResult.version) {
            config.detectedVersion = testResult.version;
            log(`Target server version: ${testResult.version}`, 'info');
        }
    }

    // Use version-matched binary
    const pgRestoreBinary = await getPostgresBinary('pg_restore', config.detectedVersion);
    log(`Using ${pgRestoreBinary} for PostgreSQL ${config.detectedVersion}`, 'info');

    const restoreProcess = spawn(pgRestoreBinary, args, { env });
    // ...
}
```

**Log Output:**
```
Target server version: PostgreSQL 16.11
Using /opt/homebrew/opt/postgresql@16/bin/pg_restore for PostgreSQL 16.11
```

### 5. Dialect Selection (`dialects/index.ts`)

```typescript
export function getDialect(adapterId: string, version?: string): DatabaseDialect {
    if (!version) return new PostgresBaseDialect();

    const lowerV = version.toLowerCase();

    if (lowerV.includes('17.')) return new Postgres17Dialect();
    if (lowerV.includes('16.') || lowerV.includes('15.')) return new Postgres16Dialect();
    if (lowerV.includes('14.') || lowerV.includes('13.') || lowerV.includes('12.')) return new Postgres14Dialect();

    return new Postgres16Dialect(); // Default
}
```

**Version-Specific Flags:**

| Dialect | Flags | Reason |
|---------|-------|--------|
| `Postgres14Dialect` | `--no-sync` | Compatibility with PG12-14 |
| `Postgres16Dialect` | `--no-sync` | Standard flags |
| `Postgres17Dialect` | `--no-sync`, `--encoding=UTF8` | PG17 optimizations |

### 6. Integration Points

**Backup Flow (`src/lib/runner/steps/02-dump.ts`):**
```typescript
// BEFORE dump() call:
const sourceConfigWithVersion = {
    ...sourceConfig,
    detectedVersion: ctx.metadata?.engineVersion // From test() result
};

await sourceAdapter.dump(sourceConfigWithVersion, tempFile, ...);
```

**Restore Flow (`src/services/restore-service.ts`):**
```typescript
// BEFORE restore() call:
if (sourceAdapter.test) {
    const testResult = await sourceAdapter.test(dbConf);
    if (testResult.version) {
        dbConf.detectedVersion = testResult.version;
    }
}

await sourceAdapter.restore(dbConf, tempFile, ...);
```

---

## Development Setup

### Prerequisites

You need **strategic PostgreSQL client versions** installed simultaneously.

#### Why Not All Versions?

**Good News:** You don't need to install PostgreSQL 12, 13, 14, 15, 16, 17, AND 18!

**Reason:** PostgreSQL clients have **backward compatibility**:
- `pg_dump 14` can backup servers 12, 13, 14
- `pg_dump 16` can backup servers 15, 16
- `pg_dump 18` can backup servers 17, 18

**The fallback logic:**
```typescript
// Server is PG 13, but no pg_dump 13 installed
// → Uses pg_dump 14 (next higher version)
// → Works perfectly! PG 14 client understands PG 13 servers
```

#### macOS (Homebrew)

```bash
# Install strategic versions (covers all 12-18)
brew install postgresql@14  # Covers PG 12, 13, 14
brew install postgresql@16  # Covers PG 15, 16
brew install postgresql@18  # Covers PG 17, 18 (latest)

# Add to PATH (order matters: newest first for best compatibility)
export PATH="/opt/homebrew/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/opt/postgresql@14/bin:$PATH"

# Make permanent
echo 'export PATH="/opt/homebrew/opt/postgresql@18/bin:/opt/homebrew/opt/postgresql@16/bin:/opt/homebrew/opt/postgresql@14/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**Verify Installation:**
```bash
/opt/homebrew/opt/postgresql@14/bin/pg_dump --version
# → pg_dump (PostgreSQL) 14.x

/opt/homebrew/opt/postgresql@16/bin/pg_dump --version
# → pg_dump (PostgreSQL) 16.x

/opt/homebrew/opt/postgresql@18/bin/pg_dump --version
# → pg_dump (PostgreSQL) 18.x
```

**Version Coverage Matrix:**

| Server Version | Binary Used | Status |
|----------------|-------------|--------|
| PostgreSQL 12 | pg_dump 14 | ✅ Works (backward compatible) |
| PostgreSQL 13 | pg_dump 14 | ✅ Works (backward compatible) |
| PostgreSQL 14 | pg_dump 14 | ✅ Perfect match |
| PostgreSQL 15 | pg_dump 16 | ✅ Works (backward compatible) |
| PostgreSQL 16 | pg_dump 16 | ✅ Perfect match |
| PostgreSQL 17 | pg_dump 18 | ✅ Works (backward compatible) |
| PostgreSQL 18 | pg_dump 18 | ✅ Perfect match |

**How Fallback Works:**
```typescript
// Example: Server is PostgreSQL 13.5
const pgDumpBinary = await getPostgresBinary('pg_dump', 'PostgreSQL 13.5');

// Search order:
// 1. Look for /opt/homebrew/opt/postgresql@13/bin/pg_dump → Not found
// 2. Look for /opt/homebrew/opt/postgresql@14/bin/pg_dump → FOUND! ✅
// 3. Return: /opt/homebrew/opt/postgresql@14/bin/pg_dump

// Result: PG 14 client dumps PG 13 server → Works perfectly!
```

#### Linux (Debian/Ubuntu)

```bash
# Add PostgreSQL APT repository
sudo apt install postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh

# Install strategic client versions (covers all 12-18)
sudo apt install postgresql-client-14  # Covers PG 12-14
sudo apt install postgresql-client-16  # Covers PG 15-16
sudo apt install postgresql-client-18  # Covers PG 17-18
```

**Binary Locations:**
```
/usr/lib/postgresql/14/bin/pg_dump
/usr/lib/postgresql/16/bin/pg_dump
/usr/lib/postgresql/18/bin/pg_dump
```

**Optional: Install more versions for production:**
```bash
# If you need exact version matching in production:
sudo apt install postgresql-client-12 postgresql-client-13 \
  postgresql-client-15 postgresql-client-17
# But this is usually NOT necessary due to backward compatibility!
```

#### Docker (Alpine)

The `Dockerfile` automatically installs multiple versions:

```dockerfile
RUN apk add --no-cache \
    postgresql-client \
    postgresql14-client \
    postgresql15-client \
    postgresql16-client
```

---

## Testing

### Test Scenario 1: Same-Version Compatibility

```bash
# Backup PostgreSQL 16 server with PG16 client
# Expected: Uses /opt/homebrew/opt/postgresql@16/bin/pg_dump
```

**Log Output:**
```
Detected engine version: PostgreSQL 16.11
Using /opt/homebrew/opt/postgresql@16/bin/pg_dump for PostgreSQL 16.11
```

**Restore to PG 16:**
```
Target server version: PostgreSQL 16.11
Using /opt/homebrew/opt/postgresql@16/bin/pg_restore for PostgreSQL 16.11
✅ Success - No errors
```

### Test Scenario 2: Cross-Version Compatibility

**Backup PG 14 → Restore PG 17:**
```
Backup:  Uses pg_dump 14 → PG14 format
Restore: Uses pg_restore 17 → ✅ Can read PG14 format (backward compatible)
```

**Backup PG 17 → Restore PG 14:**
```
Backup:  Uses pg_dump 17 → PG17 format
Restore: Uses pg_restore 14 → ❌ WOULD FAIL if not using version-matching
                             → ✅ WORKS NOW because backup uses PG14 binary!
```

### Test Scenario 3: Multi-Database Backup

```bash
# Multiple databases selected
# Expected: Uses pg_dumpall with correct version
```

**Log Output:**
```
Dumping multiple databases using pg_dumpall: db1, db2, db3
Using /opt/homebrew/opt/postgresql@16/bin/pg_dumpall for PostgreSQL 16.11
Note: Using plain SQL format for multi-database support
```

---

## Troubleshooting

### Issue: "Could not find pg_dump for version X"

**Symptom:**
```
[PostgreSQL] Could not find pg_dump for version 16, using default from PATH
```

**Cause:** PostgreSQL 16 client not installed.

**Solution:**
```bash
# macOS
brew install postgresql@16

# Linux
sudo apt install postgresql-client-16
```

### Issue: "unsupported version (1.17) in file header"

**Symptom:**
```
pg_restore: error: unsupported version (1.17) in file header
```

**Cause:** Backup was created with a **newer** `pg_dump` version than the `pg_restore` version.

**Solution:** Re-create the backup with the system now properly configured (it will auto-select the correct binary).

### Issue: "transaction_timeout" errors STILL appear

**Symptom:**
```
pg_restore: error: could not execute query: ERROR: unrecognized configuration parameter "transaction_timeout"
```

**Cause:** You're restoring an **old backup** created before version-matching was implemented.

**Solution:**
1. Create a **NEW backup** (will use version-matched binary)
2. Restore the new backup (no more errors)

### Issue: Wrong binary selected

**Symptom:**
```
Using /usr/bin/pg_dump for PostgreSQL 16.11
```
(Should be using `/opt/homebrew/opt/postgresql@16/bin/pg_dump`)

**Cause:** Version-specific binary not found, falling back to system PATH.

**Solution:**
```bash
# Verify installation
ls -la /opt/homebrew/opt/postgresql@16/bin/pg_dump

# If missing, install
brew install postgresql@16

# Verify PATH priority
echo $PATH | tr ':' '\n'
# Should show versioned paths BEFORE /usr/bin
```

---

## Multi-Database Support

### Backup Format Selection

| Scenario | Tool | Format | Reason |
|----------|------|--------|--------|
| Single DB | `pg_dump` | Custom (binary, compressed) | Efficient, fast restore |
| Multiple DBs | `pg_dumpall` | Plain SQL | Required for selective restore with SQL filtering |

### Selective Restore with Mapping

**Example: Restore only `db1` and rename to `db1_copy`**

```typescript
databaseMapping: [
    { originalName: 'db1', targetName: 'db1_copy', selected: true },
    { originalName: 'db2', targetName: 'db2', selected: false }
]
```

**Implementation:**
1. **Custom Format**: Uses `pg_restore -d targetDb` (single DB only)
2. **Plain SQL**: Uses `psql` with Transform stream to filter/rename SQL statements

**SQL Filtering Logic:**
```typescript
// Detects CREATE DATABASE, \connect statements
// Renames databases on-the-fly
// Skips non-selected databases
```

---

## Best Practices

### ✅ DO

- Always install multiple PostgreSQL client versions
- Test backups after creating them
- Monitor logs for "Using .../postgresql@X/bin/pg_dump" messages
- Re-create old backups if you encounter format errors

### ❌ DON'T

- Don't manually specify `pg_dump` paths in config
- Don't skip version detection (always call `test()` first)
- Don't assume forward/backward compatibility without version-matching
- Don't use `--no-comments` flag unless absolutely necessary (loses metadata)

---

## Future Enhancements

### Potential Improvements

1. **Binary Download**: Auto-download missing PostgreSQL client versions
2. **Format Detection**: Detect dump format and auto-convert if needed
3. **Version Warnings**: Show UI warning when backup version > restore target
4. **Incremental Backups**: Use `pg_basebackup` for physical backups
5. **Parallel Dumps**: Use `pg_dump --jobs` for faster large DB backups

---

## References

- [PostgreSQL Documentation: pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)
- [PostgreSQL Documentation: pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html)
- [PostgreSQL Release Notes](https://www.postgresql.org/docs/release/)
- [Database Adapter Guide](./database-adapter-guide.md)

---

**Last Updated:** January 22, 2026
**PostgreSQL Versions Tested:** 12.x, 14.x, 16.x, 17.x
