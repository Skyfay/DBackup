# Database Adapters

Database adapters handle the dump and restore operations for different database systems.

## Available Adapters

| Adapter | ID | CLI Tools Required | SSH Mode | Dump Format |
| :--- | :--- | :--- | :--- | :--- |
| MySQL | `mysql` | `mysql`, `mysqldump` | ✅ | `sql` |
| MariaDB | `mariadb` | `mysql`, `mysqldump` | ✅ | `sql` |
| PostgreSQL | `postgres` | `psql`, `pg_dump`, `pg_restore` | ✅ | `custom` |
| MongoDB | `mongodb` | `mongodump`, `mongorestore` | ✅ | `archive` |
| SQLite | `sqlite` | None (file copy) | ✅ | `sqlite` |
| MSSQL | `mssql` | None (TDS protocol) | ✅ (TDS tunnelled) | `bak` |
| Azure SQL Database | `azure-sql` | `sqlpackage` | ❌ (public PaaS endpoint) | `bacpac` |
| Redis | `redis` | `redis-cli` | ✅ | `rdb` |
| Firebird | `firebird` | `gbak`, `isql` | ✅ | `fbk` |

## Backup Format

Every backup is a seekable archive (see the [Archive Format reference](/developer-guide/reference/archive-format)). The runner calls `dumpOne()` once per database, and each dump becomes its own entry, compressed and encrypted on its own. That is what lets a restore or a download read a single database by byte range.

Each adapter declares the format of its dump in `DB_FORMAT_BY_ADAPTER` in `src/lib/runner/steps/dump-databases.ts`. The format decides the extension the dump carries inside the archive, in a download and in the temp file a restore hands to the engine's tools:

| Format | Extension | Adapters | Stored as-is |
|--------|-----------|----------|--------------|
| `sql` | `.sql` | MySQL, MariaDB | |
| `custom` | `.dump` | PostgreSQL | ✅ unless compression is `NONE` |
| `archive` | `.archive` | MongoDB | ✅ (`--gzip`) |
| `bak` | `.bak` | MSSQL | |
| `bacpac` | `.bacpac` | Azure SQL Database | ✅ (a ZIP) |
| `rdb` | `.rdb` | Redis, Valkey | |
| `sqlite` | `.sqlite` | SQLite | |
| `fbk` | `.fbk` | Firebird | |

"Stored as-is" means the dump is already compressed, so the job's compression is not applied to it again.

Adapters whose snapshot cannot be split per database implement `listDumpEntries()` to say what one backup consists of. Redis and Valkey return a single entry, because one RDB holds every logical database. SQLite returns the file's name.

## Interface

```typescript
interface DatabaseInfo {
  name: string;
  sizeInBytes?: number;  // Total size in bytes (data + index)
  tableCount?: number;   // Number of tables/collections
}

interface TableInfo {
  name: string;
  rowCount?: number;
  sizeInBytes?: number;
}

interface DatabaseAdapter {
  id: string;
  type: "database";
  name: string;

  // Optional: builds a TransportSpec from the config.
  // Omit for the standard `connectionMode` convention.
  transport?: TransportResolver;

  // Core operations
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

  // One database at a time, for the seekable archive. Both throw on failure.
  dumpOne?(config: unknown, dbName: string, destinationPath: string, host: ExecutionHost, onLog?): Promise<{ size: number }>;
  restoreOne?(config: unknown, filePath: string, targetDbName: string, host: ExecutionHost, onLog?, onProgress?, originalDbName?: string): Promise<void>;
  // Optional: the entries a backup consists of, for sources that cannot be split per database
  listDumpEntries?(config: unknown, selected: string[], host: ExecutionHost): Promise<string[]>;

  // Connection tests
  test?(config: unknown, host: ExecutionHost): Promise<TestResult>;  // Full write/delete test (~15 s timeout)
  ping?(config: unknown, host: ExecutionHost): Promise<TestResult>;  // Lightweight connectivity check

  // Optional: database discovery
  getDatabases?(config: unknown, host: ExecutionHost): Promise<string[]>;
  getDatabasesWithStats?(config: unknown, host: ExecutionHost): Promise<DatabaseInfo[]>;

  // Optional: restore helpers
  prepareRestore?(config: unknown, databases: string[], host: ExecutionHost): Promise<void>;
  analyzeDump?(sourcePath: string): Promise<string[]>;  // Reads a local file, needs no host

  // Optional: table/data inspection (Database Explorer UI)
  getTables?(config: unknown, database: string, host: ExecutionHost): Promise<TableInfo[]>;
  getTableData?(config: unknown, options: TableDataOptions, host: ExecutionHost): Promise<TableDataResult>;
}
```

::: info No `configSchema` on the adapter
The Zod schema for an adapter's configuration lives in `src/lib/adapters/definitions/database.ts` (or `storage.ts` / `notification.ts`), registered in `ADAPTER_DEFINITIONS`. It is not a property on the adapter instance itself.
:::

::: warning `host` is required and positional
It sits after the mandatory arguments and before the optional callbacks. That position is deliberate: `AdapterConfig` is `any`, so a misplaced argument next to it would be swallowed silently. Next to a typed parameter, forgetting the host is an arity error the compiler cannot suppress.
:::

## Database Stats (`getDatabasesWithStats`)

Each database adapter can optionally return size and table count information. This is used in the Restore dialog to show existing databases on the target server.

### Implementation per Adapter

| Adapter | Size Source | Table Count Source |
| :--- | :--- | :--- |
| **MySQL/MariaDB** | `information_schema.tables` (`data_length + index_length`) | `COUNT(table_name)` from `information_schema.tables` |
| **PostgreSQL** | `pg_database_size(datname)` | `COUNT(*)` from `information_schema.tables` (excl. system schemas) |
| **MongoDB** | Native `sizeOnDisk` from `listDatabases` command | `listCollections().length` per database |
| **MSSQL** | `sys.master_files` (`SUM(size) * 8 * 1024`) | `COUNT(*)` from `INFORMATION_SCHEMA.TABLES` |
| **Azure SQL Database** | `sys.database_files` (`SUM(size) * 8 * 1024`, data files only), one connection per database | `COUNT(*)` from `sys.tables`, same connection |
| **SQLite** | Not supported | Not supported |
| **Redis** | Not supported | Not supported |

### API Endpoint

`POST /api/adapters/database-stats`

Accepts either a saved source ID or raw adapter config:

```json
// By source ID (loads config from database)
{ "sourceId": "clxyz..." }

// By raw config
{ "adapterId": "mysql", "config": { "host": "localhost", ... } }
```

Returns:

```json
{
  "success": true,
  "databases": [
    { "name": "myapp", "sizeInBytes": 52428800, "tableCount": 24 },
    { "name": "analytics", "sizeInBytes": 1073741824, "tableCount": 8 }
  ]
}
```

If `getDatabasesWithStats()` is not implemented, falls back to `getDatabases()` and returns names only (without size/table count).

## Transport Architecture (`src/lib/transport/`)

An adapter describes **what** runs. An `ExecutionHost` decides **how** and **where** it runs. Adapters have exactly one code path, and `direct`, `ssh` (and later an agent) are interchangeable implementations behind it.

In SSH mode this is **not** a tunnel for the database protocol: `mysqldump` and friends execute on the remote host and their stdout is streamed back. The one exception is MSSQL, described below.

### The `ExecutionHost` interface

```typescript
interface ExecutionHost {
  readonly kind: "direct" | "ssh";
  readonly label: string;   // loggable target, never contains secrets
  readonly tmpDir: string;

  exec(argv: string[], options?: ExecOptions): Promise<ExecResult>;
  spawn(argv: string[], options?: SpawnOptions): Promise<HostProcess>;
  which(...candidates: string[]): Promise<string>;   // first match in this host's PATH, memoized

  withTempFile<T>(options: TempFileOptions, fn: (path: string) => Promise<T>): Promise<T>;
  stageInput<T>(localPath: string, options, fn: (hostPath: string) => Promise<T>): Promise<T>;
  captureOutput<T>(localPath: string, options, fn: (hostPath: string) => Promise<T>): Promise<T>;

  putFile(localPath: string, hostPath: string, options?): Promise<void>;
  getFile(hostPath: string, localPath: string, options?): Promise<void>;
  removeFile(hostPath: string): Promise<void>;
  stat(hostPath: string): Promise<{ size: number; isDirectory: boolean } | null>;

  connect(remoteHost: string, remotePort: number): Promise<Duplex>;    // TCP as seen by this host
  forwardPort(remoteHost: string, remotePort: number): Promise<PortForward>;

  dispose(): Promise<void>;   // idempotent
}
```

Two rules carry the whole design:

- **`exec` never throws on a non-zero exit.** It returns `code`. Several adapters treat specific non-zero exits as success (`pg_restore` warnings) or probe a list of candidate databases until one answers. Throwing would break both, so always check `result.code !== 0` explicitly.
- **`argv: string[]`, never a shell string.** `shellEscape` is an implementation detail of `SshHost` with one test suite, instead of an injection surface at every call site.

`exec()` is implemented once in `BaseHost` on top of `spawn()`, so a new transport only needs `spawn`, `which`, the file operations and `connect`.

### Resolving the transport

```typescript
type TransportSpec =
  | { kind: "direct" }
  | { kind: "ssh"; ssh: SshConnectionConfig }
  | { kind: "composite"; exec: TransportSpec; files: TransportSpec };

type TransportResolver = (config: Record<string, unknown>) => TransportSpec;
```

Most adapters need no resolver. `standardTransport` reads `connectionMode` plus the prefixed `sshHost` / `sshUsername` fields from `sshFields`. Adapters that deviate declare their own `transport` and keep the knowledge next to the adapter:

| Adapter | Why it needs a resolver |
| :--- | :--- |
| `sqlite` | Uses `mode` and unprefixed `host` / `username`, because its credential slot has no primary and `config-resolver.ts` writes unprefixed keys. |
| `mssql` | Combines `connectionMode` with the legacy `fileTransferMode`, see the truth table below. |

::: danger Zod defaults do not apply at runtime
`resolveAdapterConfig` returns decrypted JSON without ever running the schema, so `z.enum([...]).default("direct")` never fires. A resolver must default `undefined` to direct **in code**. Stored rows predating a new field have no value for it.
:::

Resolution is per adapter on purpose. `RedisSchema` already has an unrelated `mode` field (`standalone` / `sentinel`), so a generic reader sniffing for `config.mode === "ssh"` would be one careless edit away from misfiring.

### Lifecycle

Creating a host is synchronous and does no I/O. `SshHost` memoizes a `Promise<Client>` and connects on first use. Lazy connection is not an optimization: `test()` must keep returning `{ success: false, message }` when a handshake fails, rather than throwing out of the wrapper and turning a HTTP 200 into a 500.

Use the scope helper, which always disposes:

```typescript
import { withHost } from "@/lib/transport";

const databases = await withHost(adapter, config, async (host) => {
  return adapter.getDatabases!(config, host);
});
```

**One connection per job run.** The scope wraps several adapter calls, so a backup of N databases performs one handshake instead of N+2. Scopes live in `runner/steps/dump-databases.ts`, the restore pipeline, and `services/restore/archive-restore-databases.ts`. The dump scope ends **before** the upload step, so no SSH connection hangs open during a multi-hour upload.

For code holding a `BaseAdapter` from the registry (health checks, connection-test routes), use the helpers in `transport/adapter-invoke.ts`:

```typescript
import { runConnectivityCheck } from "@/lib/transport";

const result = await runConnectivityCheck(adapter, config, { timeoutMs: 15_000 });
```

::: warning Timeouts belong inside the scope
`runConnectivityCheck` applies its timeout **inside** `withHost`. Wrapping from outside means a timeout that fires mid-handshake skips the `finally` and leaks the socket, once per minute per offline source.
:::

There is no pooling. Two parallel jobs against the same server open two connections.

### Adding a new adapter

1. Take `host: ExecutionHost` as the parameter after your mandatory arguments.
2. Call `host.which("mysqldump", "mariadb-dump")` instead of probing a binary yourself.
3. Build **raw argv arrays**. Never escape anything.
4. Pass secrets through `options.env`, never in argv. `SshHost` renders them into an `export` prefix so they stay out of the process table and out of OOM kill reports.
5. Spread `...sshFields` into the schema, or declare a `transport` resolver if the field layout differs.
6. Add the credential requirement entry with `ssh: "SSH_KEY"`.

```typescript
export async function dump(config: MySQLConfig, destPath: string, host: ExecutionHost, onLog?) {
  const binary = await host.which("mysqldump", "mariadb-dump");
  const argv = [binary, ...buildConnectionArgs(config, host), "--single-transaction", config.database];

  return host.captureOutput(destPath, {}, async () => {
    const proc = await host.spawn(argv, { env: { MYSQL_PWD: config.password } });
    // ... pipe proc.stdout, await proc.exit()
  });
}
```

The same function serves both transports. There is no SSH branch to write.

### MSSQL: TDS through an SSH tunnel

MSSQL is the exception, because a `.bak` file must live on the SQL Server host. Its `dump` and `restore` still contain no transport branches, but its resolver encodes three cases:

| `connectionMode` | `fileTransferMode` | TDS / exec | File transfer |
| :--- | :--- | :--- | :--- |
| `"ssh"` | *ignored* | SSH, TDS via `forwardPort` | Same SSH connection |
| `undefined` / `"direct"` | `"ssh"` | direct | SSH |
| `undefined` / `"direct"` | `"local"` | direct | direct (shared mount) |

Row 2 is served by `CompositeHost`, a decorator that delegates execution to a `DirectHost` and file operations to an `SshHost`. Row 1 opens a local TCP listener on port 0 and pipes it through `forwardOut`. All connection pools go through `withPool()`, which sets `options.serverName` to the real hostname so certificate validation still passes through the tunnel, and caps `pool.max` because every pooled TDS connection is its own SSH channel.

### Testing

Use `createFakeHost` from `src/lib/testing/fake-host.ts`. It is structurally typed as `ExecutionHost`, so extending the interface breaks every fake at compile time.

```typescript
import { createFakeHost } from "@/lib/testing/fake-host";

describe.each(["direct", "ssh"] as const)("dump (%s)", (kind) => {
  it("passes --single-transaction", async () => {
    const host = createFakeHost(kind, { onWhich: () => "/usr/bin/mysqldump" });
    await dump(config, "/tmp/out.sql", host);
    expect(host.calls.exec[0]).toContain("--single-transaction");
  });
});
```

Assert on **argv arrays**, not on substrings of a rendered command. Most adapter suites collapse to a single `describe.each` with identical expectations for both transports, which is the point.

### Lint guard

`tests/unit/lint-guards/adapter-transport.test.ts` rejects the patterns this architecture exists to remove: `isSSHMode`, `connectionMode ===` outside a resolver, `host.kind ===`, `shellEscape`, raw `spawn` / `execFile` in a database adapter, a `new sql.ConnectionPool` bypassing `withPool`, and a hardcoded `DirectHost` where a resolved one belongs.

Exceptions live in a per-rule allow list and each carries a written justification. A structural check additionally asserts that every adapter offering an SSH credential resolves a transport, which catches a half-wired adapter that a regex cannot see.

### Test SSH Endpoint

`POST /api/adapters/test-ssh` provides a generic SSH connectivity test:

```json
{
  "adapterId": "mysql",
  "config": {
    "sshHost": "192.168.1.10",
    "sshPort": 22,
    "sshUsername": "deploy",
    "sshAuthType": "password",
    "sshPassword": "..."
  }
}
```

For most adapters it runs a trivial command over the resolved host. For MSSQL it additionally verifies that the backup path is readable and writable, since a problem there otherwise only surfaces as a missing `.bak` halfway through a backup.

## MySQL Adapter

### Configuration Schema

```typescript
const MySQLSchema = z.object({
  host: z.string().default("localhost"),
  port: z.coerce.number().default(3306),
  user: z.string().min(1, "User is required"),
  password: z.string().optional(),
  database: z.union([z.string(), z.array(z.string())]).default(""),
  options: z.string().optional().describe("Additional mysqldump options"),
  disableSsl: z.boolean().default(false).describe("Disable SSL"),
  ...sshFields,
});
```

### Dump Implementation

```typescript
async dump(config, destinationPath, streams = []) {
  const validated = MySQLSchema.parse(config);

  const args = [
    `-h${validated.host}`,
    `-P${validated.port}`,
    `-u${validated.username}`,
    `--password=${validated.password}`,
    "--single-transaction",
    "--routines",
    "--triggers",
  ];

  // Single database or all
  if (validated.database) {
    args.push(validated.database);
  } else if (validated.databases?.length) {
    args.push("--databases", ...validated.databases);
  } else {
    args.push("--all-databases");
  }

  // Execute mysqldump
  const { stdout, stderr } = await execAsync(
    `mysqldump ${args.join(" ")}`
  );

  // Write through stream pipeline
  await pipeline(
    Readable.from(stdout),
    ...streams,
    createWriteStream(destinationPath)
  );

  return {
    success: true,
    size: (await stat(destinationPath)).size,
    logs: stderr ? [stderr] : [],
  };
}
```

### Restore Implementation

```typescript
async restore(config, sourcePath) {
  const validated = MySQLSchema.parse(config);

  const args = [
    `-h${validated.host}`,
    `-P${validated.port}`,
    `-u${validated.username}`,
    `--password=${validated.password}`,
  ];

  if (validated.database) {
    args.push(validated.database);
  }

  const { stderr } = await execAsync(
    `mysql ${args.join(" ")} < "${sourcePath}"`
  );

  return {
    success: true,
    size: 0,
    logs: stderr ? [stderr] : ["Restore completed"],
  };
}
```

## PostgreSQL Adapter

### Configuration Schema

```typescript
const PostgresSchema = z.object({
  host: z.string().default("localhost"),
  port: z.coerce.number().default(5432),
  user: z.string().min(1, "User is required"),
  password: z.string().optional(),
  database: z.union([z.string(), z.array(z.string())]).default(""),
  options: z.string().optional().describe("Additional pg_dump options"),
});
```

### Environment-Based Authentication

PostgreSQL uses environment variables for password:

```typescript
async dump(config, destinationPath) {
  const validated = PostgreSQLSchema.parse(config);

  const env = {
    ...process.env,
    PGPASSWORD: validated.password,
  };

  const args = [
    `-h`, validated.host,
    `-p`, validated.port.toString(),
    `-U`, validated.username,
    `-F`, "c", // Custom format (compressed)
  ];

  if (validated.database) {
    args.push(`-d`, validated.database);
  }

  args.push(`-f`, destinationPath);

  await execAsync(`pg_dump ${args.join(" ")}`, { env });

  return {
    success: true,
    size: (await stat(destinationPath)).size,
    logs: [],
  };
}
```

## MongoDB Adapter

### Configuration Schema

```typescript
const MongoDBSchema = z.object({
  uri: z.string().optional().describe("DEPRECATED — use host/port + a credential profile instead"),
  host: z.string().default("localhost"),
  port: z.coerce.number().default(27017),
  user: z.string().optional(),
  password: z.string().optional(),
  authenticationDatabase: z.string().default("admin").optional(),
  database: z.union([z.string(), z.array(z.string())]).default(""),
  options: z.string().optional().describe("Additional mongodump options"),
});
```

### Dump Implementation

```typescript
async dump(config, destinationPath) {
  const validated = MongoDBSchema.parse(config);

  let args: string[] = [];

  if (validated.connectionString) {
    args.push(`--uri="${validated.connectionString}"`);
  } else {
    args.push(
      `--host=${validated.host}`,
      `--port=${validated.port}`,
    );

    if (validated.username) {
      args.push(
        `--username=${validated.username}`,
        `--password=${validated.password}`,
        `--authenticationDatabase=${validated.authSource}`,
      );
    }
  }

  if (validated.database) {
    args.push(`--db=${validated.database}`);
  }

  // Output as archive
  args.push(`--archive=${destinationPath}`);

  await execAsync(`mongodump ${args.join(" ")}`);

  return {
    success: true,
    size: (await stat(destinationPath)).size,
    logs: [],
  };
}
```

## SQLite Adapter

SQLite is unique-it's just a file copy:

```typescript
async dump(config, destinationPath) {
  const validated = SQLiteSchema.parse(config);

  // Use .dump command for SQL output
  const { stdout } = await execAsync(
    `sqlite3 "${validated.path}" .dump`
  );

  await writeFile(destinationPath, stdout);

  return {
    success: true,
    size: (await stat(destinationPath)).size,
    logs: ["SQLite database dumped"],
  };
}

// Alternative: Binary copy (faster, smaller)
async dumpBinary(config, destinationPath) {
  const validated = SQLiteSchema.parse(config);
  await copyFile(validated.path, destinationPath);
}
```

## Redis Adapter

Redis is an in-memory key-value store. Backups use the **RDB snapshot** format.

### Configuration Schema

```typescript
const RedisSchema = z.object({
  mode: z.enum(["standalone", "sentinel"]).default("standalone"),
  host: z.string().default("localhost"),
  port: z.coerce.number().default(6379),
  username: z.string().optional(), // Redis 6+ ACL
  password: z.string().optional(),
  database: z.coerce.number().min(0).max(15).default(0),
  tls: z.boolean().default(false),
  sentinelMasterName: z.string().optional(),
  sentinelNodes: z.string().optional(),
  options: z.string().optional(),
});
```

### Dump Implementation

Redis backups download the RDB snapshot directly from the server:

```typescript
async dump(config, destinationPath, onLog) {
  const validated = RedisSchema.parse(config);

  const args = [
    "-h", validated.host,
    "-p", validated.port.toString(),
  ];

  if (validated.password) {
    args.push("-a", validated.password);
  }

  if (validated.tls) {
    args.push("--tls");
  }

  // Download RDB snapshot
  args.push("--rdb", destinationPath);

  // Log command with collapsible details (password masked)
  const maskedArgs = args.map(a => a === validated.password ? "******" : a);
  const command = `redis-cli ${maskedArgs.join(" ")}`;
  onLog?.("Executing redis-cli", "info", "command", command);

  await execAsync(`redis-cli ${args.join(" ")}`);

  return {
    success: true,
    size: (await stat(destinationPath)).size,
    logs: ["RDB snapshot downloaded"],
  };
}
```

::: tip Collapsible Command Logs
Use the fourth parameter (`details`) of `onLog()` to show commands in a collapsible format. This keeps the log clean while making the full command available on click:
```typescript
onLog("Executing backup", "info", "command", fullCommandString);
```
:::
```

### Restore Limitations

::: warning Important
Redis does **not** support remote RDB restore. The RDB file must be:
1. Copied to the server's data directory
2. Server must be restarted to load the new RDB

The restore function provides instructions but cannot perform the actual restore without server filesystem access.
:::

### Key Differences from Other Adapters

| Aspect | Other Databases | Redis |
|--------|-----------------|-------|
| Database Selection | Named databases | Numbered (0-15) |
| Backup Scope | Single/Multiple DBs | Always full server |
| Restore Method | Stream via TCP | File replacement + restart |
| Authentication | User/Password | Optional ACL (Redis 6+) |

## MSSQL Adapter

MSSQL is unique among database adapters - it uses the **TDS protocol** (via the `mssql` npm package) instead of CLI tools, and writes native `.bak` files to the server filesystem. A separate file transfer mechanism is needed to access these files.

### Configuration Schema

```typescript
const MSSQLSchema = z.object({
  host: z.string().default("localhost"),
  port: z.coerce.number().default(1433),
  user: z.string().min(1, "User is required"),
  password: z.string().optional(),
  database: z.union([z.string(), z.array(z.string())]).default(""),
  encrypt: z.boolean().default(true),
  trustServerCertificate: z.boolean().default(false),
  backupPath: z.string().default("/var/opt/mssql/backup"),
  fileTransferMode: z.enum(["local", "ssh"]).default("local"),
  localBackupPath: z.string().default("/tmp").optional(),
  sshHost: z.string().optional(),
  sshPort: z.coerce.number().default(22).optional(),
  sshUsername: z.string().optional(),
  sshAuthType: z.enum(["password", "privateKey", "agent"]).default("password").optional(),
  sshPassword: z.string().optional(),
  sshPrivateKey: z.string().optional(),
  sshPassphrase: z.string().optional(),
  requestTimeout: z.coerce.number().default(300000),
  options: z.string().optional(),
});
```

### File Transfer Architecture

SQL Server writes `.bak` files to its own filesystem. DBackup needs to access these files, which is handled by two transfer modes:

#### Local Mode

Used when DBackup and SQL Server share a filesystem (Docker volumes, NFS):

```
SQL Server writes .bak → /var/opt/mssql/backup/file.bak (backupPath)
DBackup reads from    → /mssql-backups/file.bak          (localBackupPath)
                        ↑ Same directory via Docker volume mount
```

#### SSH Mode

Used when SQL Server runs on a remote host without shared filesystem:

```
Backup:
  SQL Server writes .bak → backupPath on server
  DBackup connects SSH   → Downloads .bak via SFTP
  DBackup processes      → Compress/encrypt → Upload to storage
  Cleanup                → Delete remote .bak via SSH

Restore:
  DBackup downloads      → Backup from storage
  DBackup connects SSH   → Uploads .bak via SFTP to backupPath
  SQL Server restores    → RESTORE DATABASE from backupPath
  Cleanup                → Delete remote .bak via SSH
```

### SSH Transfer Utility

The `MssqlSshTransfer` class (`src/lib/adapters/database/mssql/ssh-transfer.ts`) handles all SSH/SFTP operations:

```typescript
import { MssqlSshTransfer, isSSHTransferEnabled } from "./ssh-transfer";

// Check if SSH mode is enabled
if (isSSHTransferEnabled(config)) {
  const transfer = new MssqlSshTransfer();
  await transfer.connect(config);

  // Download .bak from server
  await transfer.download(remotePath, localPath);

  // Upload .bak to server
  await transfer.upload(localPath, remotePath);

  // Check if file exists
  const exists = await transfer.exists(remotePath);

  // Delete remote file
  await transfer.deleteRemote(remotePath);

  // Disconnect
  transfer.end();
}
```

### Key Differences from Other Adapters

| Aspect | Other Databases | MSSQL |
|--------|-----------------|-------|
| Protocol | CLI tools (mysqldump, pg_dump) | TDS via `mssql` npm package |
| Backup Format | SQL text / archive | Native `.bak` binary |
| File Access | Direct stdout/stdin | Server writes to filesystem, then file transfer |
| Connection Security | SSL/TLS optional | `encrypt` + `trustServerCertificate` options |
| Remote Support | Direct connection | Requires SSH transfer or shared volume |

## Testing Database Connections

All adapters implement a `test()` method:

```typescript
async test(config): Promise<TestResult> {
  const validated = MySQLSchema.parse(config);

  try {
    // Try a simple query
    await execAsync(
      `mysql -h${validated.host} -P${validated.port} ` +
      `-u${validated.username} --password=${validated.password} ` +
      `-e "SELECT 1"`
    );

    return {
      success: true,
      message: "Connection successful",
    };
  } catch (error) {
    return {
      success: false,
      message: `Connection failed: ${error}`,
    };
  }
}
```

## Listing Databases

The `getDatabases()` method enables the UI to show available databases:

```typescript
async getDatabases(config): Promise<string[]> {
  const validated = MySQLSchema.parse(config);

  const { stdout } = await execAsync(
    `mysql -h${validated.host} -P${validated.port} ` +
    `-u${validated.username} --password=${validated.password} ` +
    `-e "SHOW DATABASES" -N`
  );

  return stdout
    .split("\n")
    .filter(db => !["information_schema", "performance_schema", "sys"].includes(db));
}
```

## Adding a New Database Adapter

1. **Create schema** in `src/lib/adapters/definitions/database.ts`
2. **Create adapter** in `src/lib/adapters/database/`, including `dumpOne()` and `restoreOne()`. Every backup needs both, and `tests/unit/adapters/database/archive-capabilities.test.ts` fails without them.
3. **Declare the dump format** in `DB_FORMAT_BY_ADAPTER` (`src/lib/runner/steps/dump-databases.ts`), and mark it natively compressed there if it is
4. **Register** in `src/lib/adapters/index.ts`
5. **Add tests** in `tests/integration/adapters/`
6. **Add container** to `docker-compose.test.yml` if needed

## Multi-Database TAR Format (older backups)

No job writes this format anymore, but backups made by earlier versions use it and every adapter's `restore()` still reads it. When those versions backed up multiple databases, all adapters used a unified TAR archive format:

### TAR Archive Structure

```
backup.tar
├── manifest.json        # Metadata about contained databases
├── database1.sql        # MySQL: SQL dump
├── database2.sql
├── database1.dump       # PostgreSQL: Custom format
├── database1.archive    # MongoDB: Archive format
└── ...
```

### Manifest Format

```typescript
interface TarManifest {
  version: 1;
  createdAt: string;        // ISO 8601 timestamp
  sourceType: string;       // 'mysql' | 'postgres' | 'mongodb' | 'mssql'
  engineVersion?: string;   // e.g., '8.0.35'
  totalSize: number;        // Total bytes of all dumps
  databases: DatabaseEntry[];
}

interface DatabaseEntry {
  name: string;             // Original database name
  filename: string;         // File in archive (e.g., 'mydb.sql')
  size: number;             // Size in bytes
  format?: string;          // 'sql' | 'custom' | 'archive' | 'bak'
}
```

### Using TAR Utilities

```typescript
import {
  createMultiDbTar,
  extractMultiDbTar,
  isMultiDbTar,
  readTarManifest,
  shouldRestoreDatabase,
  getTargetDatabaseName,
} from "../common/tar-utils";

// Check if backup is Multi-DB TAR
const isTar = await isMultiDbTar(sourcePath);

// Extract and restore
if (isTar) {
  const { manifest, files } = await extractMultiDbTar(sourcePath, tempDir);

  for (const dbEntry of manifest.databases) {
    if (!shouldRestoreDatabase(dbEntry.name, mapping)) continue;

    const targetDb = getTargetDatabaseName(dbEntry.name, mapping);
    await restoreSingleDatabase(path.join(tempDir, dbEntry.filename), targetDb);
  }
}
```

### Selective Restore

Users can select which databases to restore and rename them:

```typescript
const mapping = [
  { originalName: 'production', targetName: 'staging_copy', selected: true },
  { originalName: 'users', targetName: 'users_test', selected: true },
  { originalName: 'logs', targetName: 'logs', selected: false }, // Skip
];
```

## Custom Restore UI

Some databases need a restore of their own. The restore page checks the `sourceType` of the backup and renders that instead of the database step:

```typescript
// src/app/dashboard/storage/restore/restore-client.tsx
if (isRedis) {
    body = <RedisGuide file={file} destinationId={destinationId} engine={type === "valkey" ? "Valkey" : "Redis"} canDownload={canDownload} />;
}
```

### Redis restore guide

Redis cannot load an RDB snapshot over the network. The file has to be placed in the data folder of the server and the server restarted, so `RedisGuide` in `src/components/dashboard/storage/restore/redis-guide.tsx` writes the commands for it:

- `redis-guide-script.ts` builds the script, the manual steps and the commands for an append only file from where Redis runs (`docker`, `compose`, `service` or `windows`), the target, the data folder, whether Redis asks for a password and the download link. The Bash commands live in `redis-guide-bash.ts` and the PowerShell ones in `redis-guide-powershell.ts`. All of it is pure, so the unit tests read the commands directly, and each block carries the marks the `CodeBlock` tints.
- A script runs as one block, a subshell of a function in Bash and `& { }` in PowerShell, so a pasted script is read in full before its password prompt, and a failed check ends the block instead of the shell. PowerShell names its functions with a verb and a noun, since a short name like `Cli` is also the alias of `Clear-Item`, which wins over the function.
- The script checks `PING`, `CONFIG GET appendonly`, `dir` and `dbfilename` before it downloads or stops anything. It compares the answers, since `redis-cli` exits with 0 even when Redis replies with an error.
- The password reaches `redis-cli` as `REDISCLI_AUTH`, which `valkey-cli` reads as well, and `docker exec -e REDISCLI_AUTH` passes it on without writing it into the command.
- `use-download-link.ts` makes the one-time link with `POST /api/storage/{id}/download-url` and counts down its five minutes, so the page marks a link that ran out.

### Token-Based Public Downloads

For wget/curl access (where session cookies aren't available), the app generates temporary download tokens:

```typescript
// src/lib/download-tokens.ts
import { generateDownloadToken, consumeDownloadToken } from "@/lib/auth/download-tokens";

// Generate (5-min TTL, single-use)
const token = generateDownloadToken(storageConfigId, filePath, decrypt);

// wget example
`wget "${baseUrl}/api/storage/public-download?token=${token}" -O backup.rdb`

// Consume (returns null if invalid/expired)
const data = consumeDownloadToken(token);
```

The public download endpoint (`/api/storage/public-download`) validates the token and streams the file without requiring session authentication.

For the reusable UI component (`DownloadLinkModal`), see [Download Tokens](/developer-guide/core/download-tokens).

## Related Documentation

- [Adapter System](/developer-guide/core/adapters)
- [Storage Adapters](/developer-guide/adapters/storage)
- [Supported Versions](/developer-guide/reference/versions)
