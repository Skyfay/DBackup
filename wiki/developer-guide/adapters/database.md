# Database Adapters

Database adapters handle the dump and restore operations for different database systems.

## Available Adapters

| Adapter | ID | CLI Tools Required |
| :--- | :--- | :--- |
| MySQL | `mysql` | `mysql`, `mysqldump` |
| MariaDB | `mariadb` | `mysql`, `mysqldump` |
| PostgreSQL | `postgresql` | `psql`, `pg_dump`, `pg_restore` |
| MongoDB | `mongodb` | `mongodump`, `mongorestore` |
| SQLite | `sqlite` | None (file copy) |
| MSSQL | `mssql` | `sqlcmd` |

## Interface

```typescript
interface DatabaseAdapter {
  id: string;
  type: "database";
  name: string;
  icon?: string;
  configSchema: ZodSchema;

  // Core operations
  dump(config: unknown, destinationPath: string, streams?: Transform[]): Promise<BackupResult>;
  restore(config: unknown, sourcePath: string): Promise<BackupResult>;

  // Connection test
  test(config: unknown): Promise<TestResult>;

  // Optional: List databases
  getDatabases?(config: unknown): Promise<string[]>;

  // Optional: Version detection
  getVersion?(config: unknown): Promise<string>;
}
```

## MySQL Adapter

### Configuration Schema

```typescript
const MySQLSchema = z.object({
  host: z.string().default("localhost"),
  port: z.coerce.number().default(3306),
  username: z.string().min(1),
  password: z.string().min(1),
  database: z.string().optional(),
  databases: z.array(z.string()).optional(),
  sslMode: z.enum(["disabled", "required", "verify-ca"]).default("disabled"),
  sslCa: z.string().optional(),
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
const PostgreSQLSchema = z.object({
  host: z.string().default("localhost"),
  port: z.coerce.number().default(5432),
  username: z.string().min(1),
  password: z.string().min(1),
  database: z.string().optional(),
  databases: z.array(z.string()).optional(),
  sslMode: z.enum(["disable", "require", "verify-ca", "verify-full"]).default("disable"),
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
  connectionString: z.string().optional(),
  host: z.string().default("localhost"),
  port: z.coerce.number().default(27017),
  username: z.string().optional(),
  password: z.string().optional(),
  database: z.string().optional(),
  authSource: z.string().default("admin"),
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

SQLite is unique—it's just a file copy:

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

## Version Detection

Used for restore compatibility checks:

```typescript
async getVersion(config): Promise<string> {
  const validated = MySQLSchema.parse(config);

  const { stdout } = await execAsync(
    `mysql -h${validated.host} -P${validated.port} ` +
    `-u${validated.username} --password=${validated.password} ` +
    `-e "SELECT VERSION()" -N`
  );

  return stdout.trim(); // e.g., "8.0.35"
}
```

## Adding a New Database Adapter

1. **Create schema** in `src/lib/adapters/definitions.ts`
2. **Create adapter** in `src/lib/adapters/database/`
3. **Register** in `src/lib/adapters/index.ts`
4. **Add tests** in `tests/integration/adapters/`
5. **Add container** to `docker-compose.test.yml` if needed

## Multi-Database TAR Format

When backing up multiple databases, all adapters use a unified TAR archive format:

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

## Related Documentation

- [Adapter System](/developer-guide/core/adapters)
- [Storage Adapters](/developer-guide/adapters/storage)
- [Supported Versions](/developer-guide/reference/versions)
