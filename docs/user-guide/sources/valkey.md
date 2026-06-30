# Valkey

Valkey is an open-source, Redis-compatible in-memory data store maintained by the Linux Foundation. DBackup supports Valkey using the same RDB snapshot mechanism as Redis.

## Supported Versions

| Versions |
| :--- |
| 7.2+ |

## Configuration

Valkey uses the same configuration fields as Redis. See the [Redis source guide](/user-guide/sources/redis) for the complete field reference - all settings, connection modes, and SSH options apply identically.

::: info Same adapter, different label
Valkey is protocol-compatible with Redis. The Valkey source type exists so version tracking shows the correct Valkey version (e.g., "Valkey 8.1.x") instead of the Redis compatibility alias (e.g., "Redis 7.2.x") that Valkey reports for backward compatibility.
:::

## Connection Modes

| Mode | Description |
| :--- | :--- |
| **Direct** | DBackup connects via TCP and runs `redis-cli` locally |
| **SSH** | DBackup connects via SSH and runs `redis-cli` on the remote host |

## How It Works

DBackup uses `redis-cli --rdb` to download a consistent RDB snapshot from the Valkey server. The backup includes all configured databases in a single file and works with both standalone and Sentinel deployments.

## Migrating from Redis Sources

If you previously configured a Redis source pointing to a Valkey server, it will continue to work without changes. Create a new Valkey source to get accurate version labels and version history tracking.

## Required CLI Tools

`redis-cli` must be available (Valkey also ships `valkey-cli`, but `redis-cli` from the `redis-tools` package works with Valkey servers). See the [Redis guide](/user-guide/sources/redis#required-cli-tools) for installation instructions per platform.

## Next Steps

- [Redis source guide](/user-guide/sources/redis) - Full configuration reference
- [Encryption](/user-guide/security/encryption) - Encrypting your backups
- [Retention Policies](/user-guide/features/retention) - Managing backup storage
