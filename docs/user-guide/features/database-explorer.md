# Database Explorer

Every database on every server DBackup reaches, with the jobs that back it up, and its tables and rows read live without a separate database client.

## Overview

The **Databases** tab lists every database of every database connection in one table:

- The server, the size and the number of tables of each database
- **Backed up by** names the enabled jobs that back it up, and **In no job** marks a database nothing backs up
- **Last backup** says when a kept backup last held it

A Redis or Valkey server is one entry with the keys of all its numbered databases, since DBackup backs it up as a whole. Its line says how many of its databases hold keys.

The numbers above the list count the databases, their size, their tables, how many are in a job and how much data no job backs up. The keys of Redis and Valkey do not count as tables.

## Where the Data Comes From

The list does not ask a server when the page opens. DBackup reads the databases of every server with their sizes once an hour, in the same run that checks the version (the **Update Database Versions** system task). The button in the top right says how old the lists are, and its **Read now** reads every server at once.

A server whose read fails keeps the list from before, and the button names it with the error. Everything else on the page comes from DBackup itself: the jobs, the backups of each database from the runs, and the versions from the version history.

Tables and rows are the only data read live, when you open them.

## Table and Timeline

The switch in the top right shows the list as a table or by day, like the Backups page.

The **timeline** groups the databases by server, with a column per day:

| Mark | Meaning |
| :--- | :--- |
| Gray cell | A backup held the database that day, with the number of runs when there were several |
| Red cell | A run that should have backed it up failed |
| Gray cell with a red dot | A run failed and another one backed it up that day |
| Dashed cell | A run the schedule plans, shown for the next 7 days with the arrow at today |
| Arrow with a version | The server runs a new version since that day, the dashed line marks the day over its databases |

A server updated on several days in a row gets a mark on each day, and several updates on one day show the newest with a count. The hover of a mark lists each change with the time it was read.

::: warning
A backup is only restored onto the same version or a newer one. The backups made after an update need a server with that version.
:::

A click on a day opens the page of the database with the runs of that day on top, each with its job, its size, where it went and a link to the run in **History**.

## The Page of a Database

A click on a database opens it as a page of its own. The arrow in the top left leads back to the list, and the field beside the name opens another database of any server.

- The numbers: tables, size, the jobs that back it up, the last backup and the version of the server with the one before
- **Open backups** shows its backups on the Backups page, **Open job** the job that backs it up
- The tables, biggest first, with a search, and the rows of the picked one beside them

On a wide screen the tables and the rows fill the window and each scrolls on its own. The picked table is part of the address, so a link opens it again.

A click on a table reads its rows from the server, 50 at a time:

- **Filter** looks through the whole table for a value in one column, as contains, is, starts with or ends with
- A click on a column head sorts by it, a second one reverses the order and a third removes it
- The columns button hides columns, and the **Columns** tab lists how the table is built
- MongoDB shows documents

### Redis and Valkey

The page of a Redis or Valkey server lists its numbered databases with their keys. The empty ones are folded into one line at the end, which a click opens.

A click on a database reads its first keys with the type and the time to live. **Filter** matches the key on the server, as contains, is, starts with or ends with. It looks through up to 50,000 keys and shows the first 200 that match. The refresh button beside **Databases** counts the keys again.

The explorer only reads. It runs no queries of its own and changes nothing.

## Required Permissions

| Permission | What it grants |
| :--- | :--- |
| `sources:view` | The page, the databases and their sizes |
| `sources:read` | The tables and rows of a database |
| `jobs:read` | The jobs of each database, its last backup and the timeline |
| `storage:read` | **Open backups** |
| `history:read` | The link from a run to **History** |

## A Login That May Only Back Up

The explorer reads with the login of the connection. For MySQL, MariaDB, PostgreSQL and MongoDB a backup login may read every row anyway, since a dump reads every table, so whoever has `sources:read` sees the data. That permission is what keeps rows private.

SQL Server with `db_backupoperator` and a Redis user limited to `+sync` and `+psync` can back up without being allowed to look inside. The explorer then lists the database with its jobs and backups, shows a dash where the size is not told, and says in place of the tables or rows why they stay closed. The backups are not affected.

## Troubleshooting

### A server is missing its databases

Open the button in the top right. It names every server whose last read failed with the error of the server. Fix the connection, then use **Read now**.

### A database shows no tables

The login of the connection may not see them. Grant it the rights to read the database, or leave it: the jobs and backups of the database still show.

### The timeline is missing

The timeline needs the `jobs:read` permission. Without it the list shows the databases without their jobs.

## Next Steps

- [Database Sources](/user-guide/sources/) - Configure and manage database connections
- [Backups](/user-guide/features/backups) - Every backup across destinations
- [Groups & Permissions](/user-guide/admin/permissions) - Assign `sources:read` and `jobs:read` to groups
