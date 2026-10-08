# Valkey

Valkey is an open-source, Redis-compatible in-memory data store maintained by the Linux Foundation. DBackup supports Valkey using the same RDB snapshot mechanism as Redis.

## Supported Versions

| Versions |
| :--- |
| 7.2+ |

## Configuration

Valkey uses the same configuration fields as Redis. See the [Redis source guide](/user-guide/sources/redis) for the complete field reference - all settings, connection modes, and SSH options apply identically.

::: info Same adapter, different label
The Valkey source type runs the Redis adapter with the same `redis-cli` commands. It exists so the source is labelled Valkey and its restore guide uses `valkey-cli`. Both types show the Valkey version a Valkey server reports.
:::

## Connection Modes

| Mode | Description |
| :--- | :--- |
| **Direct** | DBackup connects to the Valkey port and runs `redis-cli` itself |
| **Over SSH** | DBackup logs into a server over SSH and runs `redis-cli` there. Marked **Beta** in the form |

## How It Works

DBackup uses `redis-cli --rdb` to download a consistent RDB snapshot from the Valkey server. The snapshot holds every logical database of the server in a single file. DBackup connects to the one server in **Host** and **Port**, so Sentinel and Cluster are not supported yet. Leave **Redis setup** at **Standalone**.

## Restore

A Valkey backup restores through the same guide as a Redis one, with `valkey-cli` and the `valkey` user in its commands. See [Restore in the Redis guide](/user-guide/sources/redis#restore) for the script and what to do when Valkey writes an append only file.

## Migrating from Redis Sources

A Redis source pointing to a Valkey server keeps working without changes. Create a new Valkey source to have it labelled Valkey and get the Valkey restore commands.

## Required CLI Tools

DBackup calls `redis-cli` by that name, in direct mode and over SSH. `redis-cli` from the `redis-tools` package works with Valkey servers, and a host that only has `valkey-cli` needs `redis-cli` installed as well. See the [Redis guide](/user-guide/sources/redis#required-cli-tools) for installation instructions per platform.

## Next Steps

- [Redis source guide](/user-guide/sources/redis) - Full configuration reference
- [Encryption](/user-guide/security/encryption) - Encrypting your backups
- [Retention Policies](/user-guide/jobs/retention) - Managing backup storage
