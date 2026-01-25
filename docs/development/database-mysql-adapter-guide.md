# MySQL & MariaDB Adapter Guide

## Overview

The MySQL adapter (`src/lib/adapters/database/mysql`) handles backup and restore operations for both MySQL (versions 5.7, 8.0, 9.x) and MariaDB (versions 10.x, 11.x). Due to the divergent evolution of these two database systems, the adapter employs a flexible architecture dealing with dialect-specific flags and command-line tools.

## Architecture

The adapter consists of three main layers:

1.  **Adapter Entry Point** (`index.ts`): Implements the `DatabaseAdapter` interface.
2.  **Tool Abstraction** (`tools.ts`): abstracts the underlying CLI binaries (`mysql` vs `mariadb`).
3.  **Dialect Strategy** (`dialects/`): Handles version-specific SQL syntax and CLI flags.

### Command Detection & Compatibility

One of the critical challenges is supporting different environments:
*   **Docker (Alpine Linux)**: Comes with `mariadb-client` installed. The binaries are named `mariadb`, `mariadb-dump`, etc. Calling them as `mysql` works but emits "Deprecated program name" warnings or fails if aliases are removed.
*   **Dev/Test (macOS/Debian)**: Often uses Oracle's `mysql-community-client` where binaries are named `mysql`, `mysqldump`.

To ensure robustness, we implemented an **Auto-Detection Mechanism** (`tools.ts`):

```typescript
// Auto-detects the best available binary
// Priority: 'mariadb' > 'mysql'
export function getMysqlCommand(): string { ... }
export function getMysqldumpCommand(): string { ... }
```

**Why strict detection?**
- Prevents "Deprecated program name" pollution in logs on Alpine.
- Ensures forward compatibility if Alpine drops the `mysql` alias.
- Allows using specific MariaDB features (like `--skip-ssl` instead of `--ssl-mode=DISABLED`) correctly.

### SSL & Connection Modes

The adapter handles SSL flags dynamically based on the detected environment and configuration:

- **MariaDB Client (Alpine)**: Uses `--skip-ssl` when SSL is disabled.
- **MySQL Client (Standard)**: Uses `--ssl-mode=DISABLED`.

This logic is encapsulated in the `Dialect` classes (`mysql-base.ts`, `mariadb.ts`) and combined with the tool detection ensures the correct flags are sent to the correct binary.

## Restore Safety

To prevent database corruption, the adapter enforces **Strict Type Matching**:
- A backup created with `sourceType: 'mysql'` cannot be restored to a generic target unless the versions are compatible.
- **Explicit Block**: Restoring a `mysql` dump into a `mariadb` server is blocked with a specific error message, as `utf8mb4` collations and system tables differ significantly.

## Files Structure

```
src/lib/adapters/database/mysql/
├── index.ts        # Exports MySQLAdapter object
├── tools.ts        # Binary detection (getMysqlCommand)
├── connection.ts   # Ping, version check, ensureDatabase
├── dump.ts         # mysqldump driver with stream processing
├── restore.ts      # mysql restore driver
└── dialects/       # Version-specific behaviors
    ├── index.ts        # Dialect factory (getDialect)
    ├── mysql-base.ts   # Common flags
    ├── mysql-8.ts      # MySQL 8+ specifics (utf8mb4_0900 -> utf8mb4_general_ci handling)
    └── mariadb.ts      # MariaDB specifics
```

## Debugging

If you encounter issues:
1.  **Check Logs**: Look for "Command detected: mariadb" or similar debug entries.
2.  **SSL Errors**: If you see "unknown variable ssl-mode", the tool detection might be mismatching the dialect.
3.  **Permissions**: Ensure the user has `LOCK TABLES` and `PROCESS` privileges for backups.
