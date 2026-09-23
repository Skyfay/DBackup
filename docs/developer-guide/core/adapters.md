# Adapter System

DBackup uses a **Plugin/Adapter Architecture**. The core logic doesn't know about specific technologies-it only knows about interfaces.

## Overview

```
src/lib/adapters/
├── definitions/
│   ├── index.ts       # Re-exports all definitions
│   ├── database.ts    # MySQL, PostgreSQL, MongoDB, MSSQL, SQLite, Redis, MariaDB schemas
│   ├── storage.ts     # S3, SFTP, Local, FTP, SMB, WebDAV, rsync, cloud drive schemas
│   ├── notification.ts# Discord, Email, Slack, Teams, Telegram, etc. schemas
│   └── shared.ts      # Shared field helpers (port, host, etc.)
├── index.ts           # Registration and ADAPTER_DEFINITIONS array
├── database/          # MySQL, PostgreSQL, MongoDB, etc.
│   └── common/        # Shared utilities (tar-utils.ts)
├── storage/           # Local, S3, SFTP, etc.
├── notification/      # Discord, Email, etc.
└── oidc/              # SSO providers (Authentik, PocketID, Generic)

src/lib/transport/      # Execution hosts: direct, SSH, composite
├── types.ts           # ExecutionHost, TransportSpec, TransportResolver
├── base-host.ts       # exec() over spawn(), temp files, staging
├── direct-host.ts     # Local execution
├── ssh-host.ts        # ssh2 client, SFTP session, channel limiter
├── composite-host.ts  # Local exec with remote file operations (MSSQL legacy)
├── ssh-escape.ts      # The only place that builds a remote shell command
├── port-forward.ts    # Local listener onto a forwarded TCP port
├── spec.ts            # Config to TransportSpec
├── factory.ts         # createHost(), withHost()
└── adapter-invoke.ts  # runConnectivityCheck() for registry-typed adapters
```

## Adapter Types

### DatabaseAdapter

Handles database dump and restore operations.

```typescript
interface DatabaseInfo {
  name: string;
  sizeInBytes?: number;  // Total size in bytes
  tableCount?: number;   // Number of tables/collections
}

interface DatabaseAdapter {
  id: string;                    // Unique identifier
  type: "database";
  name: string;                  // Display name

  // Optional: config to TransportSpec. Omit for the standard
  // `connectionMode` convention.
  transport?: TransportResolver;

  dump(
    config: unknown,
    destinationPath: string,
    host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    onProgress?: (percentage: number) => void
  ): Promise<BackupResult>;

  restore(
    config: unknown,
    sourcePath: string,
    host: ExecutionHost,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void,
    onProgress?: (percentage: number) => void
  ): Promise<BackupResult>;

  test(config: unknown, host: ExecutionHost): Promise<TestResult>;
  getDatabases?(config: unknown, host: ExecutionHost): Promise<string[]>;
  getDatabasesWithStats?(config: unknown, host: ExecutionHost): Promise<DatabaseInfo[]>;
  prepareRestore?(config: unknown, databases: string[], host: ExecutionHost): Promise<void>;
  analyzeDump?(sourcePath: string): Promise<string[]>;   // Local file, needs no host
}
```

Every database operation takes an `ExecutionHost` after its mandatory arguments. Callers get one from `withHost(adapter, config, fn)`, which resolves the transport from the config and disposes the host afterwards. See [Database Adapters](/developer-guide/adapters/database#transport-architecture-src-lib-transport).

### StorageAdapter

Handles file storage operations.

```typescript
interface StorageAdapter {
  id: string;
  type: "storage";
  name: string;

  upload(
    config: unknown,
    localPath: string,
    remotePath: string,
    onProgress?: (percent: number) => void,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
  ): Promise<boolean>;

  download(
    config: unknown,
    remotePath: string,
    localPath: string,
    onProgress?: (processed: number, total: number) => void,
    onLog?: (msg: string, level?: LogLevel, type?: LogType, details?: string) => void
  ): Promise<boolean>;

  list(config: unknown, path: string): Promise<FileInfo[]>;
  delete(config: unknown, path: string): Promise<boolean>;
  test(config: unknown): Promise<TestResult>;
  read?(config: unknown, path: string): Promise<string | null>;
}
```

### NotificationAdapter

Handles sending notifications.

```typescript
interface NotificationAdapter {
  id: string;
  type: "notification";
  name: string;

  send(
    config: unknown,
    message: string,
    context?: any
  ): Promise<boolean>;
  test(config: unknown): Promise<TestResult>;
}
```

## Creating an Adapter

### Step 1: Define the Schema

Add a Zod schema in `src/lib/adapters/definitions/database.ts` (or `storage.ts` / `notification.ts` for the appropriate adapter type):

```typescript
// src/lib/adapters/definitions/database.ts
export const SQLiteSchema = z.object({
  path: z.string().min(1, "Database path is required"),
  password: z.string().optional().describe("Encryption password"),
});
```

Then register it by adding an entry to the `ADAPTER_DEFINITIONS` array in `src/lib/adapters/index.ts`:

```typescript
{
  id: "sqlite",
  name: "SQLite",
  type: "database",
  schema: SQLiteSchema,
  icon: "sqlite",
}
```

### Step 2: Implement the Adapter

Create `src/lib/adapters/database/sqlite.ts`:

```typescript
import { DatabaseAdapter, BackupResult, TestResult } from "@/lib/core/interfaces";
import { SQLiteSchema } from "../definitions";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";

const execAsync = promisify(exec);

export const SQLiteAdapter: DatabaseAdapter = {
  id: "sqlite",
  type: "database",
  name: "SQLite",

  async dump(config, destinationPath): Promise<BackupResult> {
    const validated = SQLiteSchema.parse(config);
    const logs: string[] = [];

    try {
      // Copy database file (SQLite is just a file)
      await fs.copyFile(validated.path, destinationPath);

      const stats = await fs.stat(destinationPath);
      logs.push(`Dumped SQLite database: ${validated.path}`);

      return {
        success: true,
        size: stats.size,
        logs,
      };
    } catch (error) {
      return {
        success: false,
        size: 0,
        logs: [...logs, `Error: ${error}`],
      };
    }
  },

  async restore(config, sourcePath): Promise<BackupResult> {
    const validated = SQLiteSchema.parse(config);

    await fs.copyFile(sourcePath, validated.path);

    return {
      success: true,
      size: 0,
      logs: ["Database restored successfully"],
    };
  },

  async test(config): Promise<TestResult> {
    const validated = SQLiteSchema.parse(config);

    try {
      await fs.access(validated.path);
      return {
        success: true,
        message: "Database file accessible",
      };
    } catch {
      return {
        success: false,
        message: "Database file not found",
      };
    }
  },

  async getDatabases(config): Promise<string[]> {
    const validated = SQLiteSchema.parse(config);
    // SQLite is single-database, return filename
    return [validated.path.split("/").pop() || "database.db"];
  },
};
```

### Step 3: Register the Adapter

Add to `src/lib/adapters/index.ts`:

```typescript
import { SQLiteAdapter } from "./database/sqlite";

export function registerAdapters(registry: AdapterRegistry) {
  // ... existing adapters
  registry.register(SQLiteAdapter);
}
```

### Step 4: Export Types

If needed, add type exports in `src/lib/adapters/database/index.ts`:

```typescript
export { SQLiteAdapter } from "./sqlite";
```

## Adapter Registry

The registry manages all available adapters:

```typescript
// src/lib/core/registry.ts
class AdapterRegistry {
  private adapters = new Map<string, Adapter>();

  register(adapter: Adapter) {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): Adapter | undefined {
    return this.adapters.get(id);
  }

  getByType(type: "database" | "storage" | "notification"): Adapter[] {
    return [...this.adapters.values()].filter(a => a.type === type);
  }
}

export const registry = new AdapterRegistry();
```

Usage:

```typescript
import { registry } from "@/lib/core/registry";

// Get specific adapter
const mysqlAdapter = registry.get("mysql");

// Get all database adapters
const dbAdapters = registry.getByType("database");
```

## Configuration Schemas

### Schema Best Practices

Use Zod features for better UI generation:

```typescript
export const MySQLSchema = z.object({
  host: z.string()
    .default("localhost")
    .describe("Database server hostname"),

  port: z.coerce.number()
    .default(3306)
    .describe("Server port"),

  username: z.string()
    .min(1, "Username is required"),

  password: z.string()
    .min(1, "Password is required")
    .describe("Will be encrypted at rest"),

  database: z.string()
    .optional()
    .describe("Leave empty for all databases"),
});
```

### Encrypted Fields

Fields named `password`, `secret`, `key`, or `token` are automatically encrypted:

```typescript
// src/lib/crypto.ts
export function encryptConfig(config: Record<string, unknown>) {
  const encrypted = { ...config };

  for (const key of SENSITIVE_FIELDS) {
    if (encrypted[key]) {
      encrypted[key] = encrypt(encrypted[key] as string);
    }
  }

  return encrypted;
}
```

## Testing Adapters

### BackupMetadata Interface

The `BackupMetadata` interface (defined in `src/lib/core/interfaces.ts`) is used for the `.meta.json` sidecar files:

```typescript
interface BackupMetadata {
  jobId: string;
  jobName: string;
  sourceAdapter: string;
  timestamp: string;
  size: number;
  databases?: string[];
  compression?: string;
  encrypted?: boolean;
  encryptionProfileId?: string;
  iv?: string;
  authTag?: string;
  checksum?: string;       // SHA-256 hash of the final backup file (added in v0.9.5)
  multiDb?: boolean;
  locked?: boolean;
}
```

> **Note:** The `checksum` field contains the SHA-256 hash of the final backup file (after compression and encryption). It is calculated during the upload step and used for post-upload verification, pre-restore verification, and periodic integrity checks.

### Unit Tests

```typescript
// tests/unit/adapters/sqlite.test.ts
import { SQLiteAdapter } from "@/lib/adapters/database/sqlite";

describe("SQLiteAdapter", () => {
  const testConfig = {
    path: "/tmp/test.db",
  };

  it("should validate config", () => {
    const result = SQLiteAdapter.configSchema.safeParse(testConfig);
    expect(result.success).toBe(true);
  });

  it("should reject invalid config", () => {
    const result = SQLiteAdapter.configSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
```

### Integration Tests

```typescript
// tests/integration/adapters/sqlite.test.ts
import { SQLiteAdapter } from "@/lib/adapters/database/sqlite";
import fs from "fs/promises";

describe("SQLiteAdapter Integration", () => {
  const testDbPath = "/tmp/test-integration.db";
  const backupPath = "/tmp/test-backup.db";

  beforeAll(async () => {
    // Create test database
    await fs.writeFile(testDbPath, "test data");
  });

  it("should dump database", async () => {
    const result = await SQLiteAdapter.dump(
      { path: testDbPath },
      backupPath
    );

    expect(result.success).toBe(true);
    expect(result.size).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await fs.unlink(testDbPath).catch(() => {});
    await fs.unlink(backupPath).catch(() => {});
  });
});
```

## UI Integration

The UI generates the connection form from the adapter's Zod schema, so an adapter ships no form code of its own. `src/components/adapter/connection-form.tsx` splits the fields into parts, listed on the left of the dialog:

| File | What it decides |
| :--- | :--- |
| `database-form-layout.ts`, `storage-form-layout.ts`, `notification-form-layout.ts` | Which parts a type has and which fields go into each, as plain data |
| `form-constants.ts` | The key lists the storage and notification layouts read, plus `PLACEHOLDERS` |
| `connection-form-schema.ts` | The schema the form validates against, with the fields a credential profile fills in made optional |
| `*-form-sections.tsx` | How each part renders its fields |

A key of the schema that no list names still appears, in the Options or Message part, so a new field is never invisible. Labels come from the key names unless a section file names them better, and descriptions from `.describe()`.

## Related Documentation

- [Database Adapters](/developer-guide/adapters/database)
- [Storage Adapters](/developer-guide/adapters/storage)
- [Notification Adapters](/developer-guide/adapters/notification)
