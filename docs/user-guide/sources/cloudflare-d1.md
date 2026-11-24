# Cloudflare D1

Backs up the D1 databases of a Cloudflare account through the API of Cloudflare, with an API token and nothing to install.

## Supported Versions

| Database | Supported | Note |
| :--- | :--- | :--- |
| D1 databases of the current storage backend (`version: production`) | ✅ | Every database since D1 left its alpha |
| D1 databases of the alpha backend | ❌ | Cloudflare offers no export for them |
| Databases with a virtual table (FTS5, R*Tree) | ❌ | Cloudflare refuses to export them, see [Troubleshooting](#cannot-export-databases-with-virtual-tables) |

The connection is a whole Cloudflare account. A job picks one, several or all of its D1 databases, like the databases of a server.

## Prerequisites

An API token of the account with the permission **D1 Edit**:

1. In the Cloudflare dashboard, open the account and go to **Manage Account > Account API Tokens**.
2. **Create Token**, then **Custom Token**.
3. Under **Permissions**, add **Account > D1 > Edit**. Nothing else is needed.
4. Optionally limit the token to the IP address DBackup connects from and give it an expiry date.

::: warning D1 Read is not enough
Cloudflare allows the export of a database only with **D1 Edit**, even though a backup never writes. A token with **D1 Read** passes Test connection and fails at the first backup. Cloudflare also has no way to limit a D1 token to single databases: the token can change every D1 database of the account.
:::

## Configuration

::: info Credential Profiles
A `TOKEN` [credential profile](/user-guide/security/credential-profiles) holds the API token. Create one in **Vault > Credentials** before saving the source.
:::

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Account ID** | The 32 hex characters on the overview of the account in the Cloudflare dashboard | - | ✅ |
| **Login** | `TOKEN` credential profile with the API token | - | ✅ |
| **Check the values before each backup** | Warns in the run log about values Cloudflare's export or import cannot carry, see [below](#values-cloudflare-cannot-carry) | On | ❌ |
| **Location of new databases** | Where a restore under a new name creates the database: **Automatic**, a jurisdiction (EU, FedRAMP) or a location hint | Automatic | ❌ |

## Setup Guide

1. Create the API token as described under [Prerequisites](#prerequisites).
2. In **Vault > Credentials**, add a profile of the type **Token** with the token.
3. In **Connections**, add a source of the type **Cloudflare D1**, enter the account ID and pick the profile.
4. **Test connection** lists the databases of the account.
5. Create a job and pick the databases to back up.

## How It Works

Each database is exported by Cloudflare as a SQL dump, the same file `wrangler d1 export` writes. DBackup starts the export, polls it until Cloudflare is done, downloads the dump from R2 and stores it as one `.sql` entry of the backup's archive, unchanged.

::: warning The database is locked during the export
Cloudflare answers queries on a database with errors while its export runs. A small database takes a second or two, one of about 120 MB around 10 seconds. Schedule the backup for a quiet time. Cancelling a run does not stop an export that has started, so the database stays locked until Cloudflare finishes it.
:::

Databases are picked by name and looked up on every run, so a database that was deleted and created again under the same name is backed up under its new ID.

::: info Rows read count against the account
Cloudflare bills rows read to the account. Besides the export, the check of the values reads every table once per backup, and the [Database Explorer](/user-guide/features/database-explorer) counts the rows of every table it lists and reads the rows of each page it shows. On the free plan these count against the daily limit.
:::

### Values Cloudflare cannot carry

Two kinds of values do not survive Cloudflare's export and import. DBackup takes the export as it is and cannot work around either:

- **Integers beyond 2^53** (9,007,199,254,740,991). SQLite stores integers with 64 bits, but the export writes them through JavaScript numbers. A larger one lands in the dump rounded, and one near 2^63 comes back from a restore as a floating point number. It mostly concerns IDs like those of Discord or Twitter stored as `INTEGER`. Store them as `TEXT` to keep them exact.
- **Values too long for one statement.** The export writes each row as one `INSERT`, and the import of D1 takes no statement over 100 KB. A row with a text over about 100 KB or a BLOB over about 50 KB is in the backup, but a restore into D1 fails on it, and the target stays as it was.

With **Check the values before each backup** on, DBackup reads every table once before the export and names each column that holds such a value in the run log. The backup runs either way. The check counts against the rows read of the account, so a connection with large databases can turn it off.

A text with a NUL character is restored correctly. The export writes it raw into the dump, where Cloudflare's import would stop reading without an error, so DBackup writes it as `char(0)` on the way to the import.

## Restore

Restoring onto an existing database **replaces its tables, views and triggers** with those of the backup, like every other source. The database itself stays, with its ID, so the Workers bound to it keep working. The drops and the dump run as one import, which Cloudflare runs in one transaction: if the import fails, the database is left exactly as it was.

Before it replaces anything, the restore writes the current [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) bookmark of the database into its log, with the command that goes back to it:

```bash
wrangler d1 time-travel restore <name> --bookmark=<bookmark>
```

Restoring under a new name creates a new database. With **Location of new databases** on **Automatic**, it gets the jurisdiction of the database the backup came from while that one still exists, otherwise Cloudflare picks the location. The log names the ID of the new database, which a Worker needs as its `database_id`.

Like the export, an import locks the database while it runs. A database of about 120 MB took around 25 seconds to restore under a new name and around 35 seconds to restore over itself.

After the import DBackup checks that Cloudflare ran all of it, since Cloudflare can report an import complete that stopped early. A restore that did not run to the end fails with a message, and one into a database it created deletes that database again.

## Troubleshooting

### Cloudflare refused the export. The API token needs the permission D1 Edit

The token has **D1 Read** only. Edit the token in the Cloudflare dashboard and change the permission to **D1 Edit**.

### Cannot export databases with virtual tables

```
D1 Export error: cannot export databases with virtual tables (like FTS5)
```

**Solution:** Cloudflare cannot export a database that holds a virtual table, like an FTS5 search index. Drop the virtual tables before the backup and create them again afterwards, for example in the Worker that uses them, or leave this database out of the job.

### Cloudflare refused the API token

The token is wrong, expired, limited to other IP addresses, or belongs to another account than the account ID. Check it under **Account API Tokens**, and that the account ID is the one of the same account.

## Next Steps

- [Restore Guide](/user-guide/features/restore) - General restore documentation
- [Encryption](/user-guide/security/encryption) - Encrypting your backups
- [Database Explorer](/user-guide/features/database-explorer) - Browsing the tables of a D1 database
