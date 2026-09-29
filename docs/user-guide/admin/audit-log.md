# Audit Log

The audit log records who signed in, who changed what, and who revealed secrets, downloaded or restored backups, from which address and browser.

## The Audit Log Tab

Open **Users & Groups → Audit log**. It needs the `audit:read` permission.

The strip above the list covers the last 30 days:

| Cell | Counts |
| :--- | :--- |
| **Entries** | Everything written, and how many days the log keeps |
| **Sign-ins** | Sign-ins, by how many people, and how many came from a new place |
| **Changes** | Records created, changed or deleted, and the areas changed most |
| **Sensitive** | Revealed secrets and keys, downloads and restores |
| **Failed sign-ins** | Turned down passwords, with the address of the last one |

Every entry shows as a sentence, like "Changed the group **Operators**", with who did it, the area, and the browser and address the request came from. A second line says what changed, like "Backups See to Use". A sign-in from a network the person never signed in from before is marked **New place**.

### Filters

- **Search** finds names inside the entries, like a job or a file, people, email addresses and IP addresses.
- **Who** filters by person or API key. A person means what they did themselves, their API keys are listed on their own.
- **Area** and **Action** pick one or several values, each counted under the other filters.
- The period reaches back 24 hours, 7, 30 or 90 days, or over everything the log keeps.
- **All**, **Changes**, **Sign-ins** and **Sensitive** are quick filters. Sensitive is marked amber while it holds entries.

### An Entry Opened

A click opens the entry in a panel:

- **What changed** lists every field before and after. A group or an API key shows the level of each area with the permissions it added or removed. A secret shows that it changed, never its value.
- **Who** names the person with the sign-in the change came from, or the API key and its owner.
- **Earlier entries of this record** lists what happened to the same record before, and **Every entry of this record** narrows the list to it.
- A sign-in shows its address, its browser, when the session ended and everything the person did until then. **Sign out everywhere** ends every session of that person, for someone who may manage users.
- **Stored details** shows the entry as it was written.

### The Timeline

The view switch shows the timeline above the list: a row per person and API key, a column per day, as many days as fit. A bar shows how many entries someone wrote that day, its amber part the sensitive ones. Failed sign-ins have a row of their own. A click on a person, a day or a bar shows those entries in the list, and the arrows and the date button move through the days. A phone always gets the list as cards.

### Export

**Export CSV** downloads the entries the filters keep, at most 50,000, newest first. The export itself is written to the audit log.

## What Is Recorded

| Area | Entries |
| :--- | :--- |
| Sign-in | Sign-ins with a password, a passkey, a second factor or single sign-on, sign-ups through a sign-in provider, sign-outs, failed password sign-ins, linked and unlinked sign-in accounts, sign-in providers |
| Connections | Created, changed, cloned and deleted connections, storage alerts |
| Jobs | Created, changed, cloned and deleted jobs, runs started by hand or through the API, cancelled runs |
| Backups | Downloads, download links, restores, restored files, locked and deleted backups |
| Vault | Encryption keys, revealed keys and secrets, recovery kits, credential profiles |
| Templates | Created, changed and deleted templates |
| Users, Groups, API keys | Every change, set passwords, reset second factors, ended sessions, rotated keys |
| Settings | Every settings page, system tasks, the configuration backup and its restore, the database download |

A change keeps what it changed from and to. An entry keeps the name of the person who wrote it, so it still names them after the person is deleted. A request made with an API key names the key and its owner.

::: tip
The address comes from the `X-Forwarded-For` or `X-Real-IP` header of the reverse proxy in front of DBackup. Without one, every entry shows the address of the proxy.
:::

## How Long Entries Stay

The log keeps 90 days by default. Change it under **Settings → Data Retention**, see [Data Retention](/user-guide/admin/data-retention).

## Next Steps

- [Groups & Permissions](/user-guide/admin/permissions) - who may read the audit log
- [API Keys](/user-guide/features/api-keys) - what a key may do and how its requests show here
- [Data Retention](/user-guide/admin/data-retention) - how long the log keeps its entries
