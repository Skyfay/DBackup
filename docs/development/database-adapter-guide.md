# Database Adapter Development Guide

This guide describes how to implement a new `DatabaseAdapter` for the Database Backup Manager.
To ensure full compatibility with features like **Live Progress**, **Streaming**, and **Selective Restore**, please follow these guidelines strictly.

## 1. Interface Implementation

All database adapters must implement `DatabaseAdapter` from `@/lib/core/interfaces`.

```typescript
export interface DatabaseAdapter extends BaseAdapter {
    type: 'database';

    // Core methods
    dump(config: any, destPath: string, onLog?: (msg: string) => void, onProgress?: (percentage: number) => void): Promise<BackupResult>;
    restore(config: any, sourcePath: string, onLog?: (msg: string) => void, onProgress?: (p: number) => void): Promise<BackupResult>;

    // Verification methods
    test(config: any): Promise<{ success: boolean; message: string }>;
    getDatabases(config: any): Promise<string[]>;

    // Advanced features (Optional but recommended)
    analyzeDump?(sourcePath: string): Promise<string[]>;
}
```

## 2. Implementing `restore` (Critical for UX)

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

    // 3. Spawn DB Process
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

## 3. Implementing `dump`

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

## 4. `analyzeDump` (Optional)
To support the "Selective Restore" UI, your adapter can implement `analyzeDump`.
- **Performance**: Do NOT read the whole file.
- Use tools like `grep` (via `spawn`) to quickly find `CREATE DATABASE` statements in multi-gigabyte files without generic parsing.

## 5. Zod Schema
- Define a strict Zod schema for your configuration (Host, Port, User, Password).
- Export this schema for the UI to generate the form automatically.
