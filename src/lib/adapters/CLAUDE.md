# Adapter System

Plugin architecture for databases, storage destinations, and notification channels. Contracts in `src/lib/core/interfaces.ts`, registration in `src/lib/core/registry.ts`.

```typescript
DatabaseAdapter      -> dumpOne(), restoreOne(), restore(), test(), ping(), getDatabases()
StorageAdapter       -> upload(), download(), list(), delete(), ping()
NotificationAdapter  -> send()

registry.register(MySQLAdapter);
registry.get("mysql");
```

Every database adapter method takes an `ExecutionHost` after its mandatory arguments. See [Transport](#transport-execution-host).

Run `ls src/lib/adapters/{database,storage,notification}/` for the current adapter list. Never rely on a list written in a doc.

## Adding an adapter - the full checklist

A complete adapter touches 8 to 11 files. Missing one produces a "half-registered adapter" that looks fine in code review and breaks at runtime or renders with a fallback icon. Work through every line:

1. **`{database|storage|notification}/<name>.ts`** - implement the interface. Use `<name>/index.ts` if the adapter needs sub-modules. Database adapters take `host: ExecutionHost` and run everything through it - see [Transport](#transport-execution-host).
2. **`definitions/{database|storage|notification}.ts`** - the Zod config schema (`NewAdapterSchema`).
3. **`definitions/index.ts`** - an entry in `ADAPTER_DEFINITIONS` with `id`, `type`, `name`, `configSchema`, and `group` for storage.
4. **`index.ts`** - import the class and call `registry.register(...)` inside `registerAdapters()`.
5. **`src/lib/core/credential-requirements.ts`** - an entry in `ADAPTER_CREDENTIAL_REQUIREMENTS[id]` if the adapter supports credential profiles.
6. **`src/components/adapter/utils.ts`** - add to `ADAPTER_ICON_MAP` (and `ADAPTER_COLOR_MAP` where applicable). Skipping this leaves a generic fallback icon in the UI.
7. **`src/components/adapter/form-constants.ts`** - field keys in the relevant `*_CONNECTION_KEYS` / `*_CONFIG_KEYS`, plus `PLACEHOLDERS`, if the adapter needs custom form grouping.
8. **`src/lib/runner/steps/dump-databases.ts`** - database adapters only: an entry in `DB_FORMAT_BY_ADAPTER`, and `hasNativeCompression` if the dump is already compressed. The adapter itself implements `dumpOne()` and `restoreOne()`, plus `listDumpEntries()` when its snapshot cannot be split per database. `archive-capabilities.test.ts` fails without them.
9. **Tests**, if the adapter is testable in CI: a service in `docker-compose.test.yml` and entries in `tests/integration/test-configs.ts` (`testDatabases`, `CLI_REQUIREMENTS`).
10. **Docs**: a page under `docs/user-guide/{sources|destinations|notifications}/<name>.md` following the template in [docs/CLAUDE.md](../../../docs/CLAUDE.md), plus a row in the matching `docs/developer-guide/adapters/*.md` table.
11. **Changelog**: one `### ✨ Features` entry, component prefix is the adapter name.

## Transport (execution host)

A database adapter describes **what** runs. An `ExecutionHost` from `@/lib/transport` decides **how** and **where**. There is one code path, and `direct` / `ssh` are interchangeable implementations behind it. Never branch on the transport yourself.

```typescript
export async function dump(config: MySQLConfig, destPath: string, host: ExecutionHost, onLog?) {
    const binary = await host.which("mysqldump", "mariadb-dump");   // resolves in THIS host's PATH
    const argv = [binary, ...buildConnectionArgs(config, host), config.database];

    const result = await host.exec(argv, { env: { MYSQL_PWD: config.password } });
    if (result.code !== 0) throw new AdapterError(...);             // exec never throws on non-zero
}
```

Rules:

- **Build raw argv arrays. Never escape anything.** `shellEscape` is internal to `SshHost`. An adapter that escapes produces a double-escaped argument that fails only over SSH, only at runtime.
- **`exec` returns a `code`, it does not throw on non-zero.** Check `result.code !== 0` explicitly. Code relying on a rejected promise silently stops iterating instead.
- **Secrets go in `options.env`, never in argv.** `SshHost` renders them into an `export` prefix, which keeps them out of the process table and out of OOM kill reports.
  - **One named exception: `database/azure-sql/exporter/sqlpackage.ts`.** SqlPackage has no environment route and rejects `/SourceConnectionString:@file`, so the connection string has to be an argument. The exception holds only because that adapter has no SSH mode at all - its schema carries no `connectionMode`, so `standardTransport` always returns a DirectHost, the argv array never reaches a shell, and the exposure is the process table of the container that already holds the password in memory. Adding an SSH mode there invalidates this and the secret handling has to be reworked first. A unit test asserts the argv so the exception cannot be quietly removed or quietly widened.
- **Never call `spawn` / `execFile` directly**, and never open your own connection. Use `host.spawn`, `host.exec`, `host.connect`, `host.forwardPort`.
- **File movement uses host primitives**: `withTempFile`, `stageInput`, `captureOutput`, `putFile`, `getFile`. They are no-ops in direct mode and SFTP transfers over SSH, so one call covers both.
- Spread `...sshFields` into the config schema. If the field layout differs, declare a `transport` resolver on the adapter instead of reading `connectionMode` in adapter code. **Zod defaults do not run at runtime** (`resolveAdapterConfig` returns decrypted JSON), so default `undefined` to direct in code.

Callers get a host from `withHost(adapter, config, fn)`, which disposes it, or from `runConnectivityCheck()` for registry-typed values. One host is shared across a whole job run.

Tests use `createFakeHost` from `@/lib/testing/fake-host` and assert on argv arrays. Most suites collapse to `describe.each(["direct", "ssh"])` with identical expectations.

`tests/unit/lint-guards/adapter-transport.test.ts` enforces all of this. Full reference: [docs/developer-guide/adapters/database.md](../../../docs/developer-guide/adapters/database.md).

## Connectivity methods

| Method | Behavior | Used by |
| :--- | :--- | :--- |
| `test()` | Full write and delete verification, roughly 15 s timeout | Manual "Test connection" in the UI |
| `ping()` | Lightweight reachability check, writes nothing | Health check system (every minute) |

`ping()` is optional. The health check falls back to `test()` when it is missing - but a `test()` running every minute against every adapter is expensive, so implement `ping()` for anything that can answer cheaply.

## Backup format

Every backup is a seekable archive (`src/lib/archive/`). The runner calls `dumpOne()` once per database and stores each dump as its own entry, and a restore hands a single dump back to `restoreOne()`. Both throw on failure rather than returning a result.

- `dumpOne()` writes exactly one database to a plain local file. No TAR, no manifest, no compression of its own beyond what the engine does natively.
- `restoreOne()` restores one such file into a named target. The temp file carries the extension of the dump format, and `originalDbName` is passed for adapters that rewrite embedded names.
- Never put a database name into a local path. The runner numbers dump files, and `src/lib/archive/dump-names.ts` sanitizes names wherever they become filenames.

### Older backups (read only)

Database-only jobs used to write a single dump file, or a TAR with `manifest.json` plus one dump per database (`database/common/tar-utils.ts`, `database/common/types.ts`). No job writes these anymore, but every adapter's `restore()` must keep reading them, so existing backups stay restorable. Do not remove that branch from an adapter.

## Security

Adapters handle decrypted credentials and build shell commands for external CLI tools (`mysqldump`, `pg_dump`, `mongodump`).

- Never interpolate user-controlled values into a shell string. Pass arguments as an array to `spawn`, not a concatenated command to `exec`.
- Never log a config object - it holds decrypted secrets. Log specific non-secret fields only.
- Sanitize file paths from user input in storage adapters. Backup and restore paths are a path-traversal surface.
- Adapter errors throw `AdapterError` from `@/lib/logging/errors` so the runner can attribute the failure.

## Config decryption

Adapter configs are stored encrypted. `decryptConfig(obj)` from `@/lib/crypto` recursively decrypts before the adapter receives them. Adapters receive plaintext config and must never write it back or forward it anywhere.
