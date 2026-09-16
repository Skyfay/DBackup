# Azure SQL Database

Azure SQL Database is Microsoft's managed PaaS database. DBackup backs it up by exporting a BACPAC with SqlPackage, which ships inside the DBackup container image.

::: warning This is not a native backup
Azure SQL Database has no `BACKUP DATABASE` statement, so a native `.bak` cannot be produced from it. A BACPAC is a schema and data export, and Microsoft states it is not intended as a backup and restore mechanism. Azure's own automated point-in-time restore remains your primary recovery path. Use this adapter for what Azure does not give you: a copy that lives outside Azure, in a format you control.
:::

## Which product this covers

| Engine | Supported | Use instead |
| :--- | :--- | :--- |
| Azure SQL Database (single database, elastic pool) | ✅ | - |
| Azure SQL Managed Instance | ❌ | Not supported by DBackup |
| SQL Server 2017/2019/2022, Azure SQL Edge | ❌ | [Microsoft SQL Server](/user-guide/sources/mssql) |
| Azure Synapse Analytics | ❌ | Not supported by DBackup |

Both source types accept the same connection, so a wrong choice is easy to make. Each one detects the engine and refuses with a message naming what it actually found.

## Prerequisites

- A SQL login on the logical server. Microsoft Entra authentication is not supported by this adapter.
- A firewall rule allowing the IP address DBackup connects from. Under **Networking** on the logical server in the Azure portal.
- To restore, a login that can create databases: a member of `dbmanager` in `master`, or the server administrator.

No tooling to install. SqlPackage is part of the DBackup image on both `linux/amd64` and `linux/arm64`.

## Configuration

::: info Credential Profiles
A `USERNAME_PASSWORD` credential profile is required. This adapter has no SSH mode: Azure SQL Database is a public endpoint, and the export runs inside the DBackup container rather than on any host in between.
:::

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Host** | Logical server name, e.g. `myserver.database.windows.net` | - | ✅ |
| **Port** | Server port | `1433` | ✅ |
| **Primary Credential** | `USERNAME_PASSWORD` credential profile | - | ✅ |
| **Request Timeout** | Timeout in ms for catalog queries. The export itself is never timed out. | `300000` | ❌ |

Encryption is always on and the server certificate is always verified. Neither is configurable, because Azure presents a valid certificate on every connection.

## Backup file format

Each database is exported to its own `.bacpac`, which is a ZIP containing `model.xml` and the table data, and stored as one entry of the backup's seekable archive. Because a BACPAC is already compressed, DBackup stores it as-is and skips its own compression. The archive's index lets the restore screen list the databases without downloading the backup, and a single database can be restored or downloaded without reading the others.

Backups written by earlier versions store a single database as a plain `.bacpac` and several databases as a `.tar` of BACPACs with a manifest. Both remain restorable.

## Consistency

A BACPAC export runs as ordinary queries against a live database. It is **not** a point-in-time snapshot, and Microsoft documents that an export taken while the database is being written to can be internally inconsistent, in a way that only surfaces when the import later fails.

DBackup writes this caveat into the run log of every backup. To get a guaranteed-consistent export, either pause writes for the duration, or export from a copy you make yourself:

```sql
CREATE DATABASE myapp_snapshot AS COPY OF myapp;
```

Point the DBackup source at the copy, and drop it when the backup finishes.

::: warning Ledger tables
If a database uses [Ledger](https://learn.microsoft.com/azure/azure-sql/database/ledger-overview), a BACPAC cannot capture its history tables or its generated-always columns. The tamper evidence Ledger exists to provide is therefore **not** part of the backup. DBackup raises this as a warning in the run log when it detects one.
:::

## Restore

::: danger Restoring over a database drops it first
A BACPAC import always creates the database and has no overwrite mode. Restoring onto an existing name therefore **drops that database** before importing, which is how every other source in DBackup behaves on a restore. Everything in it is gone, including any data written since the backup.

Azure keeps a dropped database recoverable through **Deleted databases** on the logical server, for the retention window of its own automated backups. That is a safety net, not a plan.

Pick **Restore to a new database** in the restore dialog if you want the existing one left alone.
:::

A backup taken from Azure SQL Database can only be restored to an Azure SQL Database source. Restoring it into a Microsoft SQL Server source is blocked, even though a BACPAC would technically import into on-premises SQL Server.

The new database is created at the service tier the import defaults to. Check and adjust it in the Azure portal afterwards if the tier matters for your workload.

::: info A restore takes minutes regardless of size
Most of the time goes into Azure creating the database, not into moving your data. A measured restore of a 3 KB BACPAC took just over two minutes, of which 113 seconds were spent on `Updating database` before a single row was written. That cost is roughly constant, so a large database takes about the same two minutes plus the time its data actually needs.
:::

## Troubleshooting

### Client with IP address is not allowed to access the server

Azure's firewall rejected the connection before authentication. Add a rule for the address DBackup connects from, under **Networking** on the logical server. In a container this is the public address of the Docker host, not the container's own address.

### Login failed for user

The login exists on the server but not in the database being exported, or the password is wrong. A login that can connect to `master` still needs a user in each database it is meant to export.

### The first export after a quiet period takes minutes

The first connection to a serverless database resumes it from auto-pause, and the schema extraction runs many small catalog queries against a database that is still warming up. A cold export measured just under four minutes where the warm one took six seconds. On Basic and low-tier Standard databases the export stays throttled by the service tier itself.

### Restore failed and the target database is gone

The drop succeeded and the import did not. Recover the database through **Deleted databases** on the logical server in the Azure portal, then read the run log for why the import failed before trying again.

### Export fails on a large table

Microsoft documents export failures on large tables that have no clustered index with non-null values. Adding one, or exporting from a copy taken during a quiet period, is the usual fix.

## See Also

- [Restore Guide](/user-guide/features/restore) - General restore documentation
- [Encryption](/user-guide/security/encryption) - Encrypting your backups
- [Microsoft SQL Server](/user-guide/sources/mssql) - For SQL Server and Azure SQL Edge
