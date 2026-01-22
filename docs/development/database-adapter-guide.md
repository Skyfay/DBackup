# Database Adapter Development Guide

This guide describes how to implement a new `DatabaseAdapter` for the Database Backup Manager.
To ensure full compatibility with features like **Live Progress**, **Streaming**, and **Selective Restore**, please follow these guidelines strictly.

## 1. File Structure & The Dialect Pattern

We use the **Dialect Pattern** to support multiple database versions (e.g., MySQL 5.7 vs 8.0 or MariaDB) without duplicating core logic.

**Recommended Structure:**
```
src/lib/adapters/database/<adapter-id>/
├── index.ts          # Exports functionality as DatabaseAdapter object
├── connection.ts     # Connection testing (must return version!)
├── dump.ts           # The dump() implementation (uses Dialect)
├── restore.ts        # The restore() implementation (uses Dialect)
└── dialects/         # Folder for version-specific logic
    ├── index.ts      # Dialect Factory (getDialect)
    ├── base.ts       # Abstract Base Class
    └── v1-variant.ts # Specific implementations
```

## 2. The Dialect Interface

Instead of hardcoding CLI flags in `dump.ts` or `restore.ts`, delegate this to a Dialect class.

**Define a Dialect:**
```typescript
// src/lib/adapters/database/common/dialect.ts (Reference)
export interface DatabaseDialect {
    getDumpArgs(config: any, databases: string[]): string[];
    getRestoreArgs(config: any, targetDatabase?: string): string[];
    getConnectionArgs(config: any): string[];
}
```

**Using the Dialect in `dump.ts`:**
```typescript
import { getDialect } from "./dialects";

export async function dump(config: any, path: string, ...) {
    // 1. Get the correct dialect based on config and detected version
    const dialect = getDialect(config.type, config.detectedVersion);

    // 2. Get arguments
    const args = dialect.getDumpArgs(config, databases);

    // 3. Spawn process
    const proc = spawn('tool', args, ...);
}
```

## 3. Version Detection & Normalization

Your adapter's `test` function should detect the database version to allow the system to choose the correct dialect.

### ⚠️ CRITICAL: Version Format Normalization
**Always return ONLY the numeric version** (e.g., `"16.1"`, `"8.0.44"`), stripped of any prefix or suffix.

**Why?**
1. **Consistency**: All adapters must return versions in the same format for UI display
2. **Comparisons**: Restore pre-flight checks use `parseFloat()` to compare versions
3. **Metadata**: Version is stored in backup metadata and must be parseable

**❌ BAD Examples:**
```typescript
return { version: "PostgreSQL 16.1 on x86_64-pc-linux-gnu" }; // Too much info
return { version: "11.4.9-MariaDB-ubu2404" };                 // Suffix noise
return { version: "MongoDB 7.0.28" };                         // Prefix redundant
```

**✅ GOOD Examples:**
```typescript
return { version: "16.1" };    // PostgreSQL
return { version: "11.4.9" };  // MariaDB
return { version: "8.0.44" };  // MySQL
return { version: "7.0.28" };  // MongoDB
```

### Implementation Pattern
```typescript
export async function test(config: any) {
    // 1. Ping Test
    await execFileAsync('db_cli', ['ping', ...]);

    // 2. Fetch Raw Version
    const { stdout } = await execFileAsync('db_cli', ['version', ...]);
    const rawVersion = stdout.trim();

    // 3. Extract ONLY the numeric version
    // PostgreSQL: "PostgreSQL 16.1 on ..." → "16.1"
    const versionMatch = rawVersion.match(/PostgreSQL\s+([\d.]+)/);
    const version = versionMatch ? versionMatch[1] : rawVersion;

    // MySQL/MariaDB: "11.4.9-MariaDB-ubu2404" → "11.4.9"
    const versionMatch = rawVersion.match(/^([\d.]+)/);
    const version = versionMatch ? versionMatch[1] : rawVersion;

    return {
        success: true,
        message: "Connection successful",
        version // MUST be numeric only!
    };
}
```

### Version Storage Architecture
**Two separate storage locations:**

1. **`metadata` field (Persistent, Database)**
   - Written by: System Task (hourly) + Test Connection Button (manual)
   - Used for: Monitoring, Audit Logs, Backup Metadata (`engineVersion`)
   - Location: `AdapterConfig.metadata` (JSON string)
   - Example: `{ "engineVersion": "16.1", "lastCheck": "2026-01-22T...", "status": "Online" }`

2. **React State (Temporary, UI Only)**
   - Written by: Test Connection Button during editing
   - Used for: Immediate visual feedback (green badge)
   - Lifetime: Current dialog session only (cleared on close)
   - Purpose: Show user the test succeeded without persisting in config

## 4. Implementing `restore` (Critical for UX)

The `restore` method is the most complex part because it drives the "Live Activity" UI.

### ❌ DON'TS (Bad Practices)
- **Do NOT use `fs.readFileSync`**: Never load the whole dump into RAM. It will crash on large databases.
- **Do NOT use simple `exec`**: `exec('mysql < file.sql')` buffers all output and often hides progress.
- **Do NOT ignore `onProgress`**: The UI will appear frozen without this.

### ✅ DOs (Best Practices)

#### A. Streaming & Progress
You **must** use Node.js Streams (`createReadStream`, `pipeline` or `spawn` stdio pipes).
This ensures the backup is processed only as fast as the database can accept it.

**Pattern for piping with Progress:**
```typescript
async restore(config, sourcePath, onLog, onProgress) {
    const totalSize = (await fs.stat(sourcePath)).size;
    let processed = 0;

    // 1. Create Source Stream
    const fileStream = createReadStream(sourcePath);

    // 2. Add Progress Listener
    fileStream.on('data', (chunk) => {
        processed += chunk.length;
        if (onProgress) {
            const percent = Math.round((processed / totalSize) * 100);
            onProgress(percent);
        }
    });

    // 3. Spawn DB Process (using Dialect args)
    const dialect = getDialect(config.type, config.detectedVersion);
    const args = dialect.getRestoreArgs(config);

    const proc = spawn('db_cli', args, {
        stdio: ['pipe', 'pipe', 'pipe'] // Pipe stdin!
    });

    // 4. Connect streams
    // File -> DB Process
    fileStream.pipe(proc.stdin);

    // 5. Handle Logs
    proc.stderr.on('data', d => onLog?.(d.toString()));
}
```

#### B. Live Logging
- Redirect `stderr` (and `stdout` if relevant) from your spawned process to the `onLog` callback.
- Clean up sensitive data (passwords) from logs before emitting.

#### C. Selective Restore / Mapping (Advanced)
If your adapter supports renaming databases or restoring only specific ones from a multi-DB dump:
- You need a **Transform Stream** between the file and the database process.
- Use this stream to parse SQL on-the-fly (e.g., checking `CREATE DATABASE` lines).
- **Warning**: String manipulation in buffers is tricky. Ensure you handle chunk boundaries or use a line-aware stream reader properly.

## 5. Implementing `dump`

### Critical for Live Progress
The Backup Manager uses a "File Watcher" technique to monitor the dump progress in real-time.
1.  **Streaming is Mandatory**: You **MUST** stream the output of your database tool directly to the `destinationPath` file.
    - ✅ **Good**: `spawn('mysqldump', ...).stdout.pipe(createWriteStream(destPath))`
    - ❌ **Bad**: Buffering output in memory and writing it with `fs.writeFile` at the end. (This causes the UI to show 0MB until the job finishes).

### Method Signature
```typescript
async dump(
  config: any,
  destinationPath: string,
  onLog?: (msg: string) => void,
  onProgress?: (percent: number) => void // Optional, if tool provides %
): Promise<BackupResult>
```

### Best Practices
- **Standard Output**: Most tools (like `pg_dump`, `mongodump` --archive) write to stdout. Pipe this directly to a file write stream.
- **Error Handling**: Listen to `stderr` and pass it to `onLog`. If the process exit code is non-zero, throw an error or return `{ success: false }`.
- **Empty File Check**: After the process finishes, check `fs.stat(destinationPath).size`. If it's 0 bytes, the dump likely failed silently (e.g., authentication error).

## 6. `analyzeDump` (Optional)
To support the "Selective Restore" UI, your adapter can implement `analyzeDump`.
- **Performance**: Do NOT read the whole file.
- Use tools like `grep` (via `spawn`) to quickly find `CREATE DATABASE` statements in multi-gigabyte files without generic parsing.

## 7. Zod Schema & Configuration
Define a strict Zod schema for your adapter configuration. This schema is used for:
- **UI Form Generation**: The AdapterForm component automatically renders fields
- **Validation**: Client-side and server-side validation
- **Type Safety**: TypeScript inference from schema

### Schema Example
```typescript
// src/lib/adapters/definitions.ts
export const MySQLSchema = z.object({
    host: z.string().default("localhost"),
    port: z.coerce.number().default(3306),
    user: z.string().min(1, "User is required"),
    password: z.string().optional(),
    database: z.union([z.string(), z.array(z.string())]).default(""),
    options: z.string().optional().describe("Additional mysqldump options"),
    disableSsl: z.boolean().default(false).describe("Disable SSL (Use for self-signed development DBs)"),
});
```

### Field Descriptions
Use `.describe()` to add help text that appears below the field in the UI.

### Configuration Storage
**Two Fields in `AdapterConfig` Table:**

1. **`config` (String, Encrypted)**
   - Contains: Connection credentials, sensitive settings
   - Encrypted: Yes (via `encryptConfig()` before storage)
   - Example: `{"host":"localhost","port":3306,"user":"root","password":"***"}`
   - Modified: Every save operation

2. **`metadata` (String, Plain JSON)**
   - Contains: Non-sensitive operational data
   - Encrypted: No
   - Example: `{"engineVersion":"8.0.44","lastCheck":"2026-01-22T...","status":"Online"}`
   - Modified: System Task (hourly) + Test Connection
   - **Never store credentials here!**

## 8. Registry Registration

Your adapter must be registered in the global registry to be discoverable by the system.

### Registration File
```typescript
// src/lib/adapters/index.ts
import { registry } from "@/lib/core/registry";
import * as mysql from "./database/mysql";
import * as postgres from "./database/postgres";

export function registerAdapters() {
    registry.register('mysql', mysql);
    registry.register('postgres', postgres);
    // Add your adapter here
}
```

### Adapter Definition
```typescript
// src/lib/adapters/definitions.ts
import { MySQLSchema } from "./database/mysql/schema";

export const ADAPTER_DEFINITIONS: AdapterDefinition[] = [
    {
        id: "mysql",
        type: "database",
        name: "MySQL",
        configSchema: MySQLSchema
    },
    // Add your adapter definition here
];
```

## 9. API Integration & Permissions

### Test Connection Endpoint
When implementing a new adapter, the `/api/adapters/test-connection` endpoint will automatically work if your adapter exports a `test()` function.

**What happens during Test Connection:**
1. User clicks "Test Connection" in UI
2. API calls `adapter.test(config)` with decrypted config
3. Adapter returns `{ success: boolean, message: string, version?: string }`
4. If successful + version exists + editing existing config:
   - API updates `metadata` field with version + timestamp
   - UI shows temporary green badge
5. User saves → config is encrypted and stored

### Permission Checks
All API routes that interact with adapters **must** check permissions:

```typescript
// src/app/api/adapters/route.ts
import { checkPermission } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";

export async function POST(req: NextRequest) {
    // ... auth check ...

    if (type === 'database') {
        await checkPermission(PERMISSIONS.SOURCES.WRITE);
    } else if (type === 'storage') {
        await checkPermission(PERMISSIONS.DESTINATIONS.WRITE);
    }

    // ... proceed with operation ...
}
```

## 10. Multi-Database Support

If your adapter should support backing up multiple databases in one job (like MySQL, PostgreSQL, MongoDB):

### Schema Definition
```typescript
database: z.union([z.string(), z.array(z.string())]).default("")
```

### getDatabases() Function
Implement a `getDatabases()` function in your `connection.ts`:

```typescript
export async function getDatabases(config: any): Promise<string[]> {
    const args = [...getConnectionArgs(config), 'SHOW DATABASES'];
    const { stdout } = await execFileAsync('db_cli', args);
    return stdout.split('\n').filter(s => s.trim());
}
```

This enables the "Load" button in the UI to fetch available databases dynamically.

## 11. Testing & Validation Checklist

Before submitting your adapter, verify:

- [ ] **Version Detection**: Returns numeric-only version (e.g., `"16.1"`)
- [ ] **Streaming**: Both `dump()` and `restore()` use streams (no buffering)
- [ ] **Progress**: Live progress works via file size monitoring (dump) and chunk counting (restore)
- [ ] **Encryption**: Sensitive fields (password) are properly encrypted in `config`
- [ ] **Dialects**: Version-specific logic isolated in dialect classes
- [ ] **Error Handling**: Graceful failures with meaningful error messages
- [ ] **Empty Dumps**: Check for 0-byte files and fail explicitly
- [ ] **Logs**: All stderr/stdout properly forwarded to `onLog`
- [ ] **Permissions**: API routes check appropriate permissions
- [ ] **Registry**: Adapter registered in `src/lib/adapters/index.ts`
- [ ] **Definition**: Added to `ADAPTER_DEFINITIONS` array
- [ ] **Schema**: Zod schema exported and fields have descriptions
- [ ] **Multi-DB**: If supported, `getDatabases()` implemented
- [ ] **Test Cases**: Integration tests cover backup + restore scenarios
