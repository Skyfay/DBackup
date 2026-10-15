# Shared Databases

Give single databases of one shared server to the customers they belong to, so each customer sees and restores the backups of its own database.

## Why

A hosting company runs one MySQL server with a database for every customer, and one job backs them all up. The server, the job, its destinations and its keys belong to the [tenant](/user-guide/admin/tenants) of the hosting company. Its customers, each a tenant of their own, would see nothing of it.

Shared databases close that gap. The tenant of the server says which database belongs to which customer, by hand, by rules or through the API. The customer then sees the backups of exactly that database from the time it was theirs, downloads its dump and restores it. The server, the job, the destinations, the keys and the other databases stay hidden.

Only the servers of the home tenant, the one of the hosting company, give databases away. A customer who brings a server of their own adds it in their tenant and backs it up and restores it like any other connection, without sharing it, and never sees the names of the other tenants.

## Giving Databases Away

The [page of a database server](/user-guide/features/database-explorer#the-page-of-a-server) in the **Database Explorer**, and the page of the database connection, show **Databases and tenants**: the databases DBackup last read from the server, the tenant each belongs to now, how it got there and how many backups it has. Quick filters show all, the given ones or the ones only you see. Seeing it needs `sources:view`, changing it `sources:write`, both in the home tenant. Every other tenant can get a database.

### By Hand

The column **Tenant** holds a picker in every row: **Nobody else**, then the tenants with what each holds, and when it starts. The customer's backups start now, or on an earlier day that you pick, so the backups from before show too. Today is the latest start, an assignment never starts in the future. Tick several databases to **Give to tenant** or **Take back** all of them at once.

Giving the database to another tenant ends the current assignment and starts a new one. Taking it back ends it, and the database belongs to the tenant of the server alone from then on. Either way the backups made before stay with the customer who had it then.

### By Rules

A rule gives every database whose name matches a pattern to a tenant, so a naming scheme like `shop_*` or `cust42_*` needs no click per database.

| A rule has | What it does |
| :--- | :--- |
| A pattern | A glob of up to 100 characters: `*` for any text, `?` for one character, `[ab]` for one of a set. Upper and lower case count |
| A tenant | Who the matching databases belong to |
| A priority | From -1000 to 1000, 0 by default. When several rules match a name, the highest priority wins, and of equal ones the oldest rule |
| A start | The day from which the rule gives the backups, today unless you pick an earlier one. A rule never starts in the future |

An assignment by hand beats every rule, so rules cover the scheme and assignments the exceptions. The rules sit beside the table, each with the databases it gives now. **New rule** opens its form right there, with a preview of the databases it would give and those that stay where they are.

::: warning Removing a rule takes the backups along
A rule has no end, so removing it takes its databases and every backup of them away from the customer, the ones made before included. To leave those backups with the customer, give the databases to them by hand with the start of the rule before you remove it.
:::

### Through the API

A hosting panel that creates a database for a customer can give it away in the same step. `PUT /api/adapters/{id}/database-assignments` takes up to 500 databases of the server `{id}` at once, with an [API key](/user-guide/features/api-keys) made in the tenant of the server that holds `sources:write`:

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

The answer counts the databases whose owner changed, as `{ "success": true, "data": { "changed": 2 } }`. A database that belongs to the tenant already stays as it is, its start included. The name may be one DBackup has not read from the server yet, like a database the panel just created. A start in the future, a server outside the home tenant, the tenant of the server itself or a tenant that does not exist answers `400`, a server of another tenant `404`.

`GET` on the same address needs `sources:view` and answers with the databases of the server and their owner now, every assignment with its start and end, the rules, and the tenants a database can go to under `customers`. The IDs of the tenants for the `PUT` come from there.

```bash
curl -s "${BASE_URL}/api/adapters/${SERVER_ID}/database-assignments" \
  -H "Authorization: Bearer ${API_KEY}" | jq '.data.customers'
```

Rules are made on the page of the server only. Every change writes an entry to the [audit log](/user-guide/admin/audit-log) of the server's tenant.

## The Time Window

A backup belongs to whoever had its database when the backup was made, never to whoever holds the name now.

- **A backdated start** shows older backups too. It never reaches back before the end of the previous assignment of the name, DBackup moves it up to there, so no backup belongs to two customers.
- **An ended assignment** keeps the backups made until then with its customer.
- **A name used again**, after another customer had it, stays with whoever had it at the time of each backup.
- **A renamed database** has a new name, which belongs to nobody until it is given away again or a rule matches it.

### Who Held Each Database

**Who held each database** draws a line per database over the last 12 months or from the start, with a stretch for every tenant that held it. A click on a stretch says who held it, from when to when, how it began and ended, and how many backups of that time are still kept.

## Moving and Deleting a Server

**Move to another server** in the menu of a database moves it to another server of the same engine in the home tenant, under the same name or a new one. Its tenant keeps it as one database: the backups from the old server stay in their list, each saying where it was made, and a restore of one of them goes into the database at its new place. On the old server no rule gives the name to anyone from the move on, only a new assignment by hand does. The column **How** and the timeline show the move.

Deleting the connection of a server that gives databases away warns first. Its tenants keep their backups, marked **Server deleted**, and download them, but restore none, unless the database moved to another server before. Restoring the connection from [Recently deleted](/user-guide/admin/recently-deleted) brings the restores back.

## Backups on Demand

**Backups on demand** in the menu of a database, or of a rule, lets the tenant start a backup of that one database itself, 1 to 24 times a day, 3 by default. A day starts at midnight in the time zone of the instance, and with a rule every database counts on its own.

The backup runs the job of the server that backs up the database, an enabled one first, for that database alone. It belongs to the home tenant like every run of that job, shows in its History with the tenant and the person as the trigger, and sends the notifications of the job. Retention judges these backups apart from the full backups of the job, under the same policy, so they never push a full backup out.

## What the Customer Sees

Once a database is given to a tenant, its **Backups** page gets the tab **Shared with you**. It looks and works like the tab **Backups**: a table, a timeline and cards on a phone, a search, filters by database, server and state, and a panel for the backup picked. The numbers above it count the shared databases, the backups from their time and the newest dumps together, and name who runs the server.

Every row is one backup of one database, made while the database was theirs, however many destinations hold a copy. It shows the database, the server without its address, who provides it, when the backup was made, the size of that database's dump, the integrity check and whether it is encrypted. The customer never sees the destinations, the keys, the other databases or the size of the database on the server. A database that is theirs no longer shows as **Former** with the backups of its time.

| Action | Does | Needs in the customer's tenant |
| :--- | :--- | :--- |
| See the databases and backups | | `storage:read` |
| **Download** | The dump of that one database, decrypted and unpacked. The key stays with the tenant of the server | `storage:download` |
| **Restore** | Puts the dump back into the same database on its server, while the database is theirs. No other server or database can be picked | `storage:restore` |
| **Back up now** | A backup of that database alone, while the home tenant allows it | `jobs:execute` |

**Back up now** in the menu of a row and in its panel starts a backup of that database when the home tenant allows backups on demand for it. It needs `jobs:execute` in the customer's tenant. The panel says how many are left today and that a backup runs, and the new backup shows when it is done. It is refused over the limit, while the job runs anyway, and for a database that is theirs no longer or whose server is gone.

**Restore** asks for nothing but a confirmation: the backup is the row picked, the target is the same database, shown as fixed, and the dialog says that only this database is overwritten. A database that is theirs no longer keeps its backups for download only, since a restore would write over a database that belongs to someone else by now.

A restore shows in the History of the customer's tenant, and every download and restore in its audit log. The run names the database alone, never the archive or the destination of the server, and the other databases of the backup are never read.

::: info Backups of DBackup 3.4 and later
Only an archive with an index lets one database out without the others. That is every backup of DBackup 3.4 or later. Older backups hold all databases in one piece and stay with the tenant of the server.
:::

## Troubleshooting

### A Database Shows No Backups

The backups are older than its start, or older than DBackup 3.4, or the job of the server leaves the database out. A backdated start shows older backups, as far back as the previous assignment of the name allows.

### The Customer Has No Shared Databases

No database of another tenant's server was given to the tenant yet, or the group of the customer lacks `storage:read`.

### A Rule Does Not Take a Database

An assignment by hand of that name wins over every rule, and of several rules the highest priority wins. The card lists only the databases DBackup last read from the server, so a new database shows once the list of the server is read again.

## Next Steps

- [Tenants](/user-guide/admin/tenants) - customers, platform admins and invitations
- [Restore](/user-guide/features/restore) - how a restore of a database runs
- [API Keys](/user-guide/features/api-keys) - a key for the hosting panel
