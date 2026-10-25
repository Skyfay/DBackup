# Shared Databases

Give single databases of one shared server to the customers they belong to, so each customer sees and restores the backups of its own database.

## Why

A hosting company runs one MySQL server with a database for every customer, and one job backs them all up. The server, the job, its destinations and its keys belong to the [tenant](/user-guide/admin/tenants) of the hosting company. Its customers, each a tenant of their own, would see nothing of it.

Shared databases close that gap. The tenant of the server says which database belongs to which customer, by hand, by rules or through the API. The customer then sees the backups of exactly that database from the time it was theirs, downloads its dump and restores it. The server, the job, the destinations, the keys and the other databases stay hidden.

Only the servers of a [tenant that shares with customers](#tenants-that-share), like the one of the hosting company, give databases away. A customer who brings a server of their own adds it in their tenant and backs it up and restores it like any other connection, without sharing it, and never sees the names of the other tenants.

## Engines That Can Be Shared

A database goes to a customer alone only where a backup holds each database as a dump of its own and a restore writes that one database back. That is the case for **MySQL**, **MariaDB**, **PostgreSQL**, **MongoDB**, **Microsoft SQL Server**, **Azure SQL Database**, **SQLite** and **Firebird**.

**Redis** and **Valkey** cannot be shared. Their backup is one snapshot of every logical database of the server, and a restore writes that snapshot back whole, so a customer given one database would download and restore all of them. Their servers show no **Databases and tenants**, and giving one of their databases away, a rule, a move or a database given through the API is refused with:

```
Redis keeps every database of a server in one snapshot, which a backup and a restore never split, so no database of it goes to a tenant alone.
```

A database of such a server that was given away before this check stays recorded, but its customer sees nothing of it: no backup, no download, no restore and no **Back up now**. Take it back through the API, with `tenantId: null` for the database or `DELETE` on its rule, see [Through the API](#through-the-api).

## Tenants That Share

A tenant of the MSP shares with customers, a customer does not. The home tenant shares from the start, any other tenant once the platform switches it on: **Shares with customers** under **Sharing** in **Edit** of the tenant under **Platform → Tenants**, or the tick **Shares with customers** in **New tenant**. The list marks such a tenant with **Shares with customers**. The same switch lets it share its destinations and channels, see [Shared Destinations and Channels](/user-guide/admin/shared-connections). Switching needs `platform-tenants:write`, someone of a platform group switches only the tenants their platform group reaches, and every switch goes into the audit log of the home tenant.

- **A tenant that shares can also get databases** of another tenant that shares. It never passes them on, a database it gets is no server of its own.
- **Stop sharing with customers** is refused while the servers of the tenant give databases away, or while it shares a destination or a channel. Take them back and end its rules first, so no customer loses anything by the switch. What a server whose connection was deleted gave away holds nothing back, it ends with the switch.
- **A customer's own servers never share**, whoever holds **Share with customers**. That is what the switch tells apart.

## Giving Databases Away

The [page of a database server](/user-guide/features/database-explorer#the-page-of-a-server) in the **Database Explorer**, and the page of the database connection, show **Databases and tenants**: the databases DBackup last read from the server, the tenant each belongs to now, how it got there and how many backups it has. Quick filters show all, the given ones or the ones only you see. It shows in a tenant that shares with customers while there is another tenant, to whoever holds **See what is shared** (`platform-sharing:read`), and changing it needs **Share with customers** (`platform-sharing:write`). Both are rights of the platform in the area **Sharing**, which a [platform group](/user-guide/admin/tenants#platform-groups) gives and a platform admin holds, never the group of a tenant. Every other tenant can get one, also one that shares with customers itself.

Someone of a platform group of selected tenants gives databases to those tenants only and takes them only from them. A database another tenant holds, by name or by a rule, shows its tenant with a lock and stays as it is: it is neither taken back, given to another tenant, moved nor changed in its backups on demand. The rules of such a tenant stay as they are too, and a new rule that would rank above one of them for a database of the server is refused. The pickers offer only the tenants they reach, and so does their [API key](#through-the-api). A platform group of all tenants and a platform admin reach every tenant.

### By Hand

The column **Tenant** holds a picker in every row: **Nobody else**, then the tenants with what each holds, and when it starts. The customer's backups start now, or on an earlier day that you pick, so the backups from before show too. Today is the latest start, an assignment never starts in the future. Tick several databases to **Give to tenant** or **Take back** all of them at once.

Giving the database to another tenant ends the current assignment and starts a new one. **Nobody else** takes it back, also from a rule that gives it: the database belongs to the tenant of the server alone from then on, and no rule gives it again until it is given by name. Taking back what nobody holds changes nothing. Either way the backups made before stay with the customer who had it then.

### By Rules

A rule gives every database whose name matches a pattern to a tenant, so a naming scheme like `shop_*` or `cust42_*` needs no click per database.

| A rule has | What it does |
| :--- | :--- |
| A pattern | A glob of up to 100 characters: `*` for any text, `?` for one character, `[ab]` for one of a set. Upper and lower case count |
| A tenant | Who the matching databases belong to |
| A priority | From -1000 to 1000, 0 by default. When several rules match a name, the highest priority wins, and of equal ones the oldest rule |
| A start | The day from which the rule gives the backups, today unless you pick an earlier one. A rule never starts in the future |

An assignment by hand beats every rule, so rules cover the scheme and assignments the exceptions. The rules sit beside the table, each with the databases it gives now. **New rule** opens its form right there, with a preview of the databases it would give and those that stay where they are.

Removing a rule ends it. The customer keeps the backups made while the rule gave the databases, like after an ended assignment, and gets no new ones. The card lists the rules that give now, the timeline also the ended ones.

### Through the API

A hosting panel that creates a database for a customer can give it away in the same step. `PUT /api/adapters/{id}/database-assignments` takes up to 500 databases of the server `{id}` at once, with an [API key](/user-guide/features/api-keys) that holds **Share with customers** (`platform-sharing:write`), made in the tenant of the server. The key editor offers the area **Sharing** in a tenant that shares with customers while there is another tenant, and a key holds it only while its owner does:

```bash
curl -s -X PUT "${BASE_URL}/api/adapters/${SERVER_ID}/database-assignments" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "assignments": [
      { "database": "shop_acme", "tenantId": "cm2x8k1q40000acme", "validFrom": "2026-10-01" },
      { "database": "shop_old", "tenantId": null }
    ]
  }'
```

| Field | What it does |
| :--- | :--- |
| `database` | The name of the database on the server |
| `tenantId` | The tenant it belongs to, or `null` to take it back |
| `validFrom` | An ISO date or time the customer's backups start, now when left out |

The answer counts the databases whose owner changed, as `{ "success": true, "data": { "changed": 2 } }`. A database that belongs to the tenant already stays as it is, its start included. The name may be one DBackup has not read from the server yet, like a database the panel just created. A start in the future, a server of a tenant that does not share with customers (taking back included), a server of an [engine that cannot be shared](#engines-that-can-be-shared), the tenant of the server itself or a tenant that does not exist answers `400`, and so does a database given to or taken from a tenant the platform group of the owner of the key does not reach. Nothing changes then. A server of another tenant answers `404`.

`GET` on the same address needs `platform-sharing:read` or `platform-sharing:write` and answers with the databases of the server and their owner now, every assignment and rule with its start and end, the tenants a database can go to under `customers`, those the owner of the key reaches, and every other tenant under `tenants`. The IDs of the tenants for the `PUT` come from `customers`.

```bash
curl -s "${BASE_URL}/api/adapters/${SERVER_ID}/database-assignments" \
  -H "Authorization: Bearer ${API_KEY}" | jq '.data.customers'
```

The rules have addresses of their own, with the same keys and rights:

| Request | Does | Needs |
| :--- | :--- | :--- |
| `GET /api/adapters/{id}/database-assignments/rules` | Every rule of the server, the ended ones too | `platform-sharing:read` or `platform-sharing:write` |
| `POST /api/adapters/{id}/database-assignments/rules` | Adds a rule, answers `201` with it | `platform-sharing:write` |
| `DELETE /api/adapters/{id}/database-assignments/rules/{ruleId}` | Ends the rule, its backups stay with the customer | `platform-sharing:write` |

```bash
curl -s -X POST "${BASE_URL}/api/adapters/${SERVER_ID}/database-assignments/rules" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{ "pattern": "acme_*", "tenantId": "cm2x8k1q40000acme", "priority": 10 }'
```

A new rule takes `pattern`, `tenantId`, and optionally `priority`, `validFrom` and `onDemandPerDay`, with the limits of [By Rules](#by-rules). It answers `400` for the same reasons as the `PUT` above, and for a rule that would rank above a rule of a tenant the owner of the key does not reach. Ending a rule that is gone or ended already answers `404`.

Every change writes an entry to the [audit log](/user-guide/admin/audit-log) of the server's tenant.

## The Time Window

A backup belongs to whoever had its database when the backup was made, never to whoever holds the name now.

- **A backdated start** shows older backups too, but only of times nobody else held the database. It never reaches back before the end of the previous assignment of the name, DBackup moves it up to there, and the backups a rule gave another customer stay with that customer. No backup belongs to two customers.
- **A new rule** with a start in the past, or with a higher priority, never takes the backups of another customer's time either.
- **An ended assignment** keeps the backups made until then with its customer.
- **A name used again**, after another customer had it, stays with whoever had it at the time of each backup.
- **A renamed database** has a new name, which belongs to nobody until it is given away again or a rule matches it.
- **A deleted tenant** keeps its assignments and rules as ended ones. The backups of its time belong to nobody from then on and never fall to another tenant's rule. A database it held by name goes back to the tenant of the server, like with **Nobody else**, so no rule gives it away until it is given by name again.

### Who Held Each Database

**Who held each database** draws a line per database over the last 12 months or from the start, with a stretch for every tenant that held it. A click on a stretch says who held it, from when to when, how it began and ended, and how many backups of that time are still kept.

## Moving and Deleting a Server

**Move to another server** in the menu of a database moves it to another server of the same engine in the same tenant, under the same name or a new one. Its tenant keeps it as one database: the backups from the old server stay in their list, each saying where it was made, and a restore of one of them goes into the database at its new place. On the old server no rule gives the name to anyone from the move on, only a new assignment by hand does. The column **How** and the timeline show the move.

A Microsoft SQL Server database restored on another server than the one its backup was made on, like after a move under the same name, puts its files into the data folder of the new server instead of the paths the backup names. A Firebird database restores into the path of its alias on the server.

## Restoring the Server Over Customers' Databases

The [restore page](/user-guide/features/restore) of the tenant of the server marks every database a customer holds now with the customer, **Acme holds it**, or **A customer holds it** for whoever may not see what is shared. Before such a restore starts, the confirmation asks for a tick at **Overwrite the databases of** the customers. The server refuses the restore without it:

```
The restore would overwrite databases that customers hold now: shop_acme. Confirm overwriting them to restore.
```

Through the API the request confirms it with `"overwriteCustomerDatabases": true` in the body of `POST /api/storage/{id}/restore`. A request without a database mapping restores every database of the backup, so it asks for the confirmation as soon as a customer holds any database of the server. A copy beside the database under a free name overwrites nothing and asks nothing.

The customers' History shows nothing of such a restore. The entry in the audit log of the tenant of the server names the customers whose databases it overwrote.

Deleting the connection of a server that gives databases away warns first, and names its tenants to whoever may see what is shared, the others learn how many there are. Its tenants keep their backups, marked **Server deleted**, and download them, but restore none, unless the database moved to another server before. Restoring the connection from [Recently deleted](/user-guide/admin/recently-deleted) brings the restores back.

## Backups on Demand

How many backups a customer may start of each of its databases, 1 to 24 a day, is set once per customer: **Backups on demand** in **Edit** of the tenant under **Platform → Tenants**, which needs `platform-tenants:write`. A new tenant starts at none. The column **Backups on demand** of the list shows the number and how many databases and rules set their own.

**Backups on demand** in the menu of a database, or of a rule, on the server page of the Database Explorer decides it for that database, or for every database of the rule:

| Choice | The tenant may start |
| :--- | :--- |
| **As** the tenant | The number of the tenant, also when it changes. What every database starts with |
| **A number of its own** | 1 to 24 a day, whatever the tenant has |
| **Off for** the database | None, whatever the tenant may for its other databases |

The **How** column says it under each database, like **Backups on demand, 3 a day · as Acme** or **· set here**, and **Backups on demand off here**. **Backups on demand** in **Edit** of the tenant lists the databases and rules that set their own, each with **Follow** to let it follow the tenant again. Someone of a platform group sees a tenant that shares beyond its reach as **Another tenant** there, and cannot let its databases and rules follow. The menu of a database, also on a right click, holds **Who held it**, **Move to another server** while a tenant holds the database, **Backups on demand** only for a database given by name (one a rule gives takes it from the menu of the rule), and **Take back**. A day starts at midnight in the time zone of the instance, and with a rule every database counts on its own.

The backup runs the job of the server that backs up the database, an enabled one first, for that database alone. It belongs to the tenant of the server like every run of that job, shows in its History with the tenant and the person as the trigger, and sends the notifications of the job. Retention judges these backups apart from the full backups of the job, under the same policy, so they never push a full backup out. Such a run counts toward no usual length, neither of the job nor of its steps.

The customer gets a short run of its own in its History, **Backup of** the database **on** the server, started by the person. It waits while the backup waits, follows its steps (Initializing, Dumping Databases, Uploading) with their times and ends with it, a backup that reached only some destinations as done. It says the size of the dump of that database and nothing else of the run: no job, destination, command or other database. A failed one says that the tenant of the server sees the full run in its History. **Cancel** in either History stops the backup. The scheduled runs of the job never show in the History of a customer, its backups do in the list.

## What the Customer Sees

Once a database is given to a tenant, it shows in two places the tenant knows already:

- **Connections → Databases** lists its server beside the tenant's own servers, one row per server however many of its databases the tenant got. The row shows **From** and the tenant that runs the server, **Address hidden**, the column **Databases** with the databases given to the tenant (or the name rule that gives them), who backs them up, the last backup and how many there are. The menu of the row has **Back up now** for each of these databases, with how many are left today, and **Show its backups**. The panel of the server lists the tenant's databases on it, each with its last backup, **Back up now**, and a menu to restore or download its newest backup, with a search once there are more than six. Edit, test and delete stay with the tenant of the server, and its other databases stay hidden. The quick filter **Provided** shows it with the other things another tenant gives.
- **Backups** lists its backups between the tenant's own, with **Shared** at the name, the server and the tenant that runs it below, **Database** as the type and that tenant under **Stored at**. The quick filters **All**, **Yours** and **Shared with you** after the filters narrow the list, the filter **Job** names the shared databases, **Destination** the tenant that runs them, and **Started by** says whether their job or a **Back up now** of a person of the tenant made a backup. The timeline shows each shared database as a row of its own, its days dashed. The numbers on top count the shared backups among the backups and leave them out of what is stored.

Every row is one backup of one database, made while the database was theirs, however many destinations hold a copy. It shows the database, the server without its address, who provides it, when the backup was made, the size of that database's dump, the integrity check and whether it is encrypted. The customer never sees the destinations, the keys, the other databases or the size of the database on the server. A database that is theirs no longer shows as **Former** with the backups of its time, and only in **Backups**.

A tenant that has no database connection or directory source of its own and may add none, or has nowhere to write backups to, has nothing for a job of its own. Its **Overview** then says which tenant backs up its databases, how many there are on how many servers, and links to their backups, instead of asking for a first job. **Quick Setup** and the **Database Explorer**, which only reads the tenant's own database connections, leave its sidebar.

A right click on a shared backup offers only what the customer may do with it: **Restore into** the database, **Download the dump** and **Back up now**. Verify, lock and delete stay with the tenant of the server, and a shared backup is never picked for an action of several backups. An own backup keeps its whole menu.

| Action | Does | Needs in the customer's tenant |
| :--- | :--- | :--- |
| See the databases and backups | | `storage:read` |
| **Download** | The dump of that one database, decrypted and unpacked. The key stays with the tenant of the server | `storage:download` |
| **Restore** | Puts the dump back into the same database on its server, while the database is theirs. No other server or database can be picked | `storage:restore` |
| **Back up now** | A backup of that database alone, while the tenant of the server allows it | `jobs:execute` |

**Back up now** for a database in the menu of its server under **Connections → Databases**, in the panel of the server, and in the menu of one of its backups starts a backup of that database when the tenant of the server allows backups on demand for it. The customer needs no job of its own for it. It needs `jobs:execute` in the customer's tenant. The panel says how many are left today and that a backup runs, and the new backup shows when it is done. It is refused over the limit, while the job runs anyway, and for a database that is theirs no longer or whose server is gone.

**Restore** asks for nothing but a confirmation: the backup is the row picked, the target is the same database, shown as fixed, and the dialog says that only this database is overwritten. A database that is theirs no longer keeps its backups for download only, since a restore would write over a database that belongs to someone else by now.

A restore shows in the History of the customer's tenant, and every download and restore in its audit log. The run names the database alone, never the address, port or user of the server, every host of a list and the name of a MongoDB replica set, an account the server names with its host, another host of its domain, the name of its Sentinel master, the data folder of SQL Server, the archive, the destination or another database of the backup or the server, and the other databases of the backup are never read. The restore notifications to the customer's channels name the database instead of the archive, without the destination, and a failure with a general message. A download goes through an address that holds a token alone, never the destination. When the first destination of a backup does not answer, a download or restore takes the next copy.

The tenant of the server sees every restore of a customer too. Its History gets a run of the same restore, **Restore onto** the server with **Restore of** the database **for** the customer below it, started by the customer and the person, like *Acme · Sara*. That run holds the whole log, with the archive, the commands and the errors of the server's tools, and ends with the same status as the customer's run. **Cancel** in either History stops the restore. Its audit log keeps the restore as well, with the database, the server and the customer. When a restore fails, the customer's run ends with a line that says the tenant of the server sees the full run in its History, so the customer knows whom to ask.

A restore the checks before the start refuse, like a backup of a newer version than the server, a local network the tenant of the server blocks, or a database the server will not prepare, leaves both runs as well, failed at once. The customer reads **The restore was refused:** with the reason in the words of its run, the version by its number and nothing of the server, and the run that says it. The provider's run holds the whole reason.

The customer's run names the version of the server by its number alone, like `8.0.36` for `8.0.36-0ubuntu0.22.04.1`, without the build and the system it runs on.

The customer's short run of a backup and the provider's run of a restore each follow another run. When that run is gone or ended without them, the [Stuck run watchdog](/user-guide/jobs/#stuck-job-timeout), while it is on, ends them 10 minutes later with the outcome of that run, or as failed when it is gone.

::: info Backups of DBackup 3.4 and later
Only an archive with an index lets one database out without the others. That is every backup of DBackup 3.4 or later. Older backups hold all databases in one piece and stay with the tenant of the server.
:::

## Troubleshooting

### A Database Shows No Backups

The backups are older than its start, or older than DBackup 3.4, or the job of the server leaves the database out. A backdated start shows older backups, as far back as the previous assignment of the name allows.

### The Server Shows No Databases and Tenants

```
The servers of this tenant give no databases to other tenants. The platform switches it on for a tenant of the MSP.
```

The tenant of the server does not share with customers, so the card stays hidden and every change is refused. Switch it on under **Platform → Tenants** when it is a tenant of the MSP, see [Tenants That Share](#tenants-that-share). With one tenant the card does not show either.

### The Customer Has No Shared Databases

No database of another tenant's server was given to the tenant yet, or the group of the customer lacks `storage:read`.

### A Rule Does Not Take a Database

An assignment by hand of that name wins over every rule, **Nobody else** included, and of several rules the highest priority wins. A new rule never takes the backups made before it while another customer held the database. The card lists only the databases DBackup last read from the server, so a new database shows once the list of the server is read again.

## Next Steps

- [Tenants](/user-guide/admin/tenants) - customers, platform admins and invitations
- [Shared Destinations and Channels](/user-guide/admin/shared-connections) - give a destination or a channel to customers
- [Restore](/user-guide/features/restore) - how a restore of a database runs
- [API Keys](/user-guide/features/api-keys) - a key for the hosting panel
