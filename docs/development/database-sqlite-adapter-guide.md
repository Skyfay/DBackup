# SQLite Adapter Guide

The SQLite adapter supports both **Local Files** and **Remote SSH** connections. It differs significantly from server-based adapters (MySQL, Postgres) because it operates directly on files.

## Architecture

- **Identifier**: `sqlite`
- **Dialect**: Not currently used (SQLite version differences don't typically affect `.dump` compatibility in ways that need abstraction yet).
- **Core Logic**: `src/lib/adapters/database/sqlite/`

## Configuration

The adapter schema (`SQLiteSchema`) includes:
- `path`: Absolute path to the `.db` file (e.g., `/var/lib/data/app.db`).
- `sshConfig` (Optional): If provided, operations are performed over SSH.
  - `host`, `port`, `username`
  - `authType`: `password`, `key`, or `agent`
  - `privateKey`, `passphrase` or `password`

## Dump Strategy

### Local
Uses the `sqlite3` CLI directly:
```bash
sqlite3 /path/to/db ".dump"
```
This produces a SQL text stream compatible with `sqlite3` restore.

### Remote (SSH)
Executes the command on the remote server via SSH:
```bash
sqlite3 /remote/path/to/db ".dump"
```
The output is streamed back through the SSH channel to our local backup pipeline.

## Restore Strategy ("Clean Slate")

SQLite `.dump` output contains `CREATE TABLE` and `INSERT` statements. If run against an existing database, it will likely fail with `UNIQUE constraint failed` or `Table already exists` errors because it appends data.

To solve this, the adapter implements a **Clean Slate** strategy:

1. **Backup Existing Target** (Safety net - *Not yet implemented, potentially dangerous to auto-delete without*)
   - *Current Implementation*: Rely on the backup we are restoring from.
2. **Delete Target File**:
   - **Local**: `fs.unlinkSync(path)`
   - **Remote**: `sshClient.execCommand('rm -f /path/to/db')`
3. **Stream Restore**:
   - Pipe the SQL dump into `sqlite3 /path/to/db`.
   - Result: A pristine database identical to the backup.

### "Restore as New Database"

The `RestoreService` handles path rewriting for SQLite:
- If `targetDatabaseName` is provided (e.g., `restored_copy`), it replaces the filename in the path.
- Example: Source `/data/app.db` + Target Name `test` → `/data/test.db`.

## Remote File Browser

Because users need to select paths on remote servers, we expose a stateless API:
`POST /api/system/filesystem/remote`

- Accepts temporary credentials (from the unsaved form form).
- Connects, runs `ls -la`, and returns directory structure.
- Used by the `RemoteFileBrowser` component.

## Key Files

- `src/lib/adapters/database/sqlite/index.ts`: Adapter entry point.
- `src/lib/adapters/database/sqlite/dump.ts`: SSH vs Local dump logic.
- `src/lib/adapters/database/sqlite/restore.ts`: Delete-then-Restore logic.
- `src/lib/adapters/database/sqlite/ssh-client.ts`: Shared SSH connection helper.
