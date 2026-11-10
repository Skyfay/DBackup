# Tenants

Run one DBackup for several customers, each with its own connections, jobs, backups, keys and people.

## What a Tenant Is

A tenant is a customer of the instance and the boundary of its data. Its connections, jobs, runs, encryption keys, saved logins, templates, API keys, notification log, Recently deleted and audit log belong to it alone, and its people see nothing of the other tenants. That suits a managed service provider, a reseller or an agency that backs up the databases of its customers from one DBackup. Every tenant sees the same DBackup with the same login page, there is no white labeling.

Every installation has the **home tenant**, named **Default**. After the update from an earlier version it holds everything the instance held before. It also holds what the platform owns, like the runs of the system tasks and the sign-ins in the audit log, and it cannot be deleted.

::: info One tenant changes nothing
With only the home tenant, DBackup looks as before: the head of the sidebar names DBackup. Some permissions check more than they did, see [Before Updating](#before-updating). Whoever may see the tenants opens a menu from the head with **Manage tenants**, and whoever may create one also finds **New tenant** there, to create the second one.
:::

## Platform Admins

A platform admin opens every tenant, member or not, and passes every permission check there. After the update the members of the SuperAdmin group of earlier versions are platform admins, and the first account of a new installation becomes one. The pages show it as the built-in platform group **Platform admin**, which nobody edits or deletes. Another platform admin is made by picking that group for the account under **Platform → Users & Groups**.

::: warning The Admin group is no platform admin
Someone added to **Admin**, the group with every permission, of the home tenant or any other tenant may do everything in that tenant, and in the home tenant change the settings of the instance, but is no platform admin. What only a platform admin does stays refused to them until the group **Platform admin** is picked for their account.
:::

Only a platform admin:

- Makes someone a platform admin or takes it back
- Changes the account of a platform admin
- Adds, changes and deletes [sign-in providers](/user-guide/admin/sso), since a provider signs in as anyone of its emails
- Sets up, starts and restores the [configuration backup](/user-guide/features/system-backup), whose file holds every secret of the instance and brings back every tenant
- [Downloads the database](/user-guide/admin/data-retention#download-the-database)

Everything else of the platform, like the tenants, the accounts and the sharing with customers, a [platform group](#platform-groups) can give to other people of the MSP too, and it shows the sign-in providers. Nobody changes their own platform admin role, and the last platform admin stays one. An API key never acts as a platform admin, whoever owns it.

A platform admin and someone of a platform group work across tenants, so no tenant decides over their accounts. The admin of a tenant changes neither their password, second factor, sessions, name nor email, and gives a platform admin no group. In the audit log of a customer's tenant their address and browser stay hidden while they are no member there.

## Platform Groups

A platform group gives the people of the MSP rights without making them platform admins. It is made under **Platform → Users & Groups → Platform groups**, beside the tab **Tenant groups**. A platform group has two parts:

| Part | Holds |
| :--- | :--- |
| **On the platform** | The settings of the instance, the tenants, the accounts with the platform groups and the sharing with customers, each with a level like See or Change, and the sign-in providers to see |
| **In the tenants** | The same areas as the group of a tenant, in **All tenants**, the ones made later included, or in **Selected tenants** |

Someone holds at most one platform group, picked with **Runs the platform** in **New user**, in **Edit** or in the panel of the account, and changes their own profile through it, also without a group in any tenant. In a tenant of its scope they may do what their group there gives plus what the platform group gives there, it never takes anything away, and they open such a tenant without being a member. A platform group of all tenants that sees something there also opens [All tenants](#all-tenants). The section **Platform** of the sidebar shows them only what their rights on the platform open.

Two rights on the platform count only in the tenants of its scope as well. **Share with customers** gives databases, destinations and channels to the tenants a platform group of selected tenants reaches, takes them only from those and changes only their rules and backups on demand. It counts only while you work in a tenant of its scope, so someone whose platform group reaches only one customer never gives away the databases, destinations or channels of a tenant they are merely a member of. See [Shared Databases](/user-guide/admin/shared-databases#giving-databases-away) and [Shared Destinations and Channels](/user-guide/admin/shared-connections#who-may-share). **See the sign-in providers** shows the providers of the platform and of those tenants, see [SSO](/user-guide/admin/sso). A platform group of all tenants and a platform admin reach every tenant.

The accounts count only in the tenants of its scope as well. With a platform group of selected tenants, **See the accounts** lists the people who work in one of them, each with only those of its tenants, the accounts of no tenant while the home tenant is one of them, and the own account. The members of the platform groups show as far as it sees their accounts. **Manage the accounts** changes an account only while every tenant it works in is one of them, an account of no tenant counting as one of the home tenant. It gives a platform group only to such an account and makes a new account only in those tenants. An account that **Runs the platform** in no tenant counts as one of the home tenant too, so a platform admin makes it, and someone whose platform group reaches the home tenant. Beyond its tenants someone makes and changes accounts only as the admin of a tenant, and changes only one that works in that tenant alone.

Nobody makes, changes or gives a platform group that may do more than they may themselves, on the platform or in the tenants of its scope. Someone of a platform group of selected tenants changes or deletes a platform group only while they may change the account of each of its members. The account of someone in a platform group is changed only by a platform admin, or by someone with `platform-accounts:write` who may give that platform group and reaches its tenants, never by the admin of a tenant. An API key of someone in a platform group gets its rights in the tenants, and of the ones on the platform only **Tenants** and **Accounts** in a key of the home tenant and **Sharing** in a key of a tenant that shares with customers and that the platform group reaches, see [API Keys](#api-keys).

## Switching Tenants

The head of the sidebar, at the very top left, always names where you work. Someone who may open two tenants or more clicks it to switch:

| Who | The head says |
| :--- | :--- |
| Anyone, while there is one tenant | DBackup, or the name under Settings → General, with the version |
| Someone in All tenants | **All tenants** and how many there are |
| Someone in one of several tenants they may open | The tenant and its place, like **Tenant 3 of 14** |
| A customer with one tenant to open | Their tenant and **Your backups** |

The menu has a search **Find a tenant** and lists the tenants. For whoever may see the tenants each tenant also shows its jobs and databases, how many databases of other tenants it holds as **shared**, and a dot when the newest backup of one of its jobs failed (red) or missed a copy (amber). Whoever may open All tenants finds it at the top. Whoever may see the tenants finds **Manage tenants** at the bottom, and **New tenant** above it while they may create tenants.

Inside a tenant the breadcrumb of the header starts with its name. The pick holds for the session and so for every tab of the browser: when one tab switches, the other tabs load their page again in the new tenant. A tenant deleted meanwhile says so when picked and leaves the list. A platform admin, and a platform group that opens All tenants, start in All tenants while there is more than one tenant, anyone else in the home tenant, or in the first tenant they joined when they are no member of the home tenant. A switch on the page of one record, like a run or a database server, leads to the Overview, since the next tenant does not hold that record.

A link in a mail or a chat message of DBackup, like **Open run** or **Open job**, names the tenant of its record. Opening it switches into that tenant first, when you may open it, and then opens the record. All tenants opens it right there.

## All Tenants

All tenants is the view of a platform admin, or of a platform group of all tenants, over every tenant at once. The Overview, Connections, Jobs, Backups, the Database Explorer, History and the search of the header show the records of every tenant, each with its tenant in a column you can filter by. A person you opened from the search shows among the entries you opened last only where you found them, in that tenant or in All tenants.

All tenants only reads. Opening a record, or changing it, first switches into its tenant and says so, so a job never links to the destination or key of another customer. **New** asks which tenant the new record belongs to and lists only the tenants where you may add that kind of record. Without one it does not show. The Vault, Templates, Quick Setup, the tenant settings and the Users & Groups of a tenant belong to one tenant, so in All tenants their entry in the sidebar asks for the tenant right away, like **New**, and opens the page there. Switching to All tenants on one of these pages leads to the Overview.

**Backups** in All tenants shows each destination as its own tenant sees it. The backups a customer keeps on a destination another tenant shares with it show once that customer's tenant is open. **Storage by destination** on the Overview counts the backups of every tenant on a destination together and names the tenant of the destination.

## The Sections Administration and Platform

With more than one tenant, the sidebar keeps the instance and the tenant apart:

| Section | Holds | Who sees it |
| :--- | :--- | :--- |
| **Administration** | The Vault, Templates, Users & Groups and Settings of the open tenant, with its Recently deleted | Everyone with the permissions in that tenant |
| **Platform** | Tenants, Users & Groups with every account of the instance, the groups of every tenant and the sign-in providers, and the Settings of the instance | Platform admins, in every view, and each page to whoever holds its right of the platform. Its Settings and sign-in providers also whoever holds `settings:read` through the home tenant |

Inside a customer tenant a platform admin sees under Administration exactly what the admin of that customer sees. The breadcrumb of a Platform page starts with **Platform**. With one tenant there is no Platform section, and Administration is as before.

## Managing Tenants

Tenants are managed under **Platform → Tenants**, which **Manage tenants** in the menu of the sidebar head opens too. Seeing it needs `platform-tenants:read`, changing anything `platform-tenants:write`. Someone of a platform group changes the members, the name, the sharing, what it may add, the network or the delete only of the tenants their platform group reaches, never of one they are merely a member of. The list shows every tenant with its members, connections, databases and jobs, and a dot when one of its newest backups failed, the home tenant first. **You work here** marks the tenant you have open, and **Shares with customers** a tenant of the MSP that gives databases, destinations and channels to customers. **Columns** hides and orders the columns, which stay as you left them. Four more columns:

| Column | Shows |
| :--- | :--- |
| **Provided to it** | The destinations and channels other tenants share with it. A tenant that gets none but shares some itself shows what it gives in gray, like **Gives 2 destinations** |
| **Backups on demand** | How many backups a day a customer may start of each database given to it, and how many databases and rules set their own, see [Backups on Demand](/user-guide/admin/shared-databases#backups-on-demand) |
| **May add itself** | **Everything**, or a tag like **No own destinations, channels** or **Adds nothing itself**, see [What It May Add](#what-it-may-add) |
| **Local network** | **Blocked**, with the number of ranges it reaches anyway, or a tag **Reaches it**, see [Network](#network) |

The menu of a tenant, also on a right click, holds **Open**, **Edit** and **Delete**. A click on a tenant opens **Edit**, and someone who may only see the tenants gets **View** in its place.

### Create a Tenant

1. Click **New tenant**. It shows to a platform admin, and to a platform group of all tenants with `platform-tenants:write`, since a group of some tenants would never reach the new one
2. Enter a name of at most 60 characters that no other tenant has
3. Tick **Shares with customers** for a tenant of the MSP that gives single databases, destinations and notification channels to other tenants, see [Share with Customers](#share-with-customers)
4. Click **Create tenant**

A new tenant starts with the built-in templates: the retention policies **Keep All**, **Simple - 14 Days** and **Smart GFS (7/4/12/2)**, the naming template **Standard**, five schedule presets and the exclude preset **System Junk Files**. Nobody works in it yet, so **Edit** opens next on its members.

### Edit a Tenant

**Edit** holds every setting of a tenant in one dialog, its parts listed on the left:

| Part | Holds |
| :--- | :--- |
| **General** | The name, at most 60 characters that no other tenant has. Its people see a new one at once |
| **Members** | Who works there with which group, see [Members](#members) |
| **Sharing** | **Shares with customers**, see [Share with Customers](#share-with-customers) |
| **What it may add** | A switch per kind, see [What It May Add](#what-it-may-add). Not for the home tenant |
| **Network** | **Block the local network** and the ranges it reaches anyway, see [Network](#network). Not for the home tenant |
| **Backups on demand** | How many backups a day it may start of each database given to it, the home tenant too when another tenant shares with it |

**Save changes** saves the name, the sharing, what it may add, the network and the backups on demand together, and the foot says what changed. A change of the members and **Follow** of backups on demand count at once. When the server refuses one part, like sharing that is still in use, the dialog opens that part and keeps the rest of what is not saved yet.

### Members

**Members** in **Edit** lists who works there with which group.

- **Add member** picks an account and its group in this tenant. It lists every account to a platform admin. Someone of a platform group sees the people of the tenants their platform group reaches, every account with a platform group of all tenants, and never a platform admin or themselves, whose memberships a platform admin changes. An account of no tenant whose email the sign-in provider of another tenant claims joins this tenant only from a platform admin or someone whose platform group reaches that other tenant.
- The group of a member changes as soon as it is picked. Someone of a platform group gives and takes only a group that may do no more than they may in that tenant.
- The menu of a member offers **Remove from** the tenant. The account and its other tenants stay, and its sessions that worked in the tenant pick another one. A platform admin also finds **Make platform admin** or **No platform admin any more** there, never on their own row.
- Nobody takes an account out of a tenant when it would then work only in tenants where they manage the users, since they could then change its password and sign in as it. A platform admin, or someone who may already change the account, like someone with `platform-accounts:write` whose platform group reaches all of its tenants, takes it out instead. The last tenant of an account is left only where the account stays one of that tenant, since its sign-in provider claims its email, or by someone who manages the users of the tenant it then belongs to, mostly the home tenant. The admin of a customer deletes such an account instead. The same holds for **No group** on the Users tab and for deleting a group without a group for its members.

A tenant keeps someone who manages its members. The last member whose group holds `users:write` cannot be removed from the tenant or moved to a group without it until someone else gets that right. A platform admin may, since they manage every tenant anyway, so a tenant can be left without any member.

::: tip Let the customer invite its own people
Add one person of the customer with a group that may manage users. They invite everyone else with a link, see [Invitations](#invitations).
:::

### Open, Delete

**Open** switches you into the tenant.

**Delete** removes the tenant with everything it holds: its connections with their health history, its jobs with their runs and logs, its encryption keys and saved logins, its templates, API keys, invitations and logs, its groups and sign-in providers, its notification settings and the storage alerts of its destinations. The databases of shared servers given to it end with it, and the backups of its time belong to nobody from then on, see [Shared Databases](/user-guide/admin/shared-databases#the-time-window). Its backups on destinations another tenant shares with it are deleted after the tenant is gone, and the hourly refresh of the storage tries again where the storage did not answer. A tenant that shares destinations or channels takes them from its customers first, whose backups stay on the storage. Nothing of it waits in Recently deleted. What stays:

- **The backups at its own destinations.** DBackup does not touch them. The encryption keys are gone with the tenant, so its encrypted backups only open with a [recovery kit](/user-guide/security/recovery-kit).
- **The accounts.** They only lose their place in the tenant. An account that worked there alone belongs to no tenant afterwards and shows in the home tenant with **No group**. One whose email has a domain the sign-in provider of another tenant claims counts as one of that tenant, so the admins of the home tenant never change it, see [Users](/user-guide/admin/users).

The dialog lists what goes and waits for the tick **I have the recovery kits of its keys, or do not need its backups**. The home tenant and the tenant you work in cannot be deleted. Neither can a tenant while one of its runs waits or runs, so cancel the run or delete the tenant once it ended.

Ticked tenants go together with **Delete** above the list, as long as they are empty: no connections, no jobs, nobody working in them, no encryption keys, no API keys and nothing in Recently deleted. A tenant that holds any of it is deleted on its own, where the dialog asks first.

### Through the API

Everything of this page has a route, for an MSP that creates its customers from a script. The rights are the same: `platform-tenants:read` to read, `platform-tenants:write` to change, and only the tenants the caller reaches. A key holds these rights only when it was made in the home tenant by someone who holds them, see [Platform Keys](/user-guide/features/api-keys#platform-keys).

| Route | Does |
| :--- | :--- |
| `GET /api/tenants`, `GET /api/tenants/{id}` | The tenants with the numbers and settings of this list |
| `POST /api/tenants` | **New tenant**, for a platform admin and a platform group of all tenants |
| `PATCH /api/tenants/{id}` | **Edit**: `name`, `sharesWithCustomers`, `allowances`, `onDemandPerDay` and `network`, saved one after the other. The first refusal stops and the answer names what was saved before it |
| `DELETE /api/tenants/{id}` | **Delete**. A tenant that holds anything needs `?confirmed=true`, and without it the answer lists what would go |
| `GET`, `POST /api/tenants/{id}/members`, `PATCH`, `DELETE /api/tenants/{id}/members/{userId}` | **Members**: list, add an account with a group, change the group, remove |
| `GET`, `POST /api/tenants/{id}/invitations`, `DELETE /api/tenants/{id}/invitations/{invitationId}` | The open [invitations](#invitations), a new link with its token once, and **Revoke** |

The members and the invitations of a tenant also answer a session or a key of that tenant itself with `users:read` or `users:write`, with the rules of its Users tab: a group only for its own people, nobody of another tenant, who joins by an invitation. Every change goes into the audit log like in the browser, with the API key that made it. The routes are described in the [API Reference](/user-guide/features/api-reference).

### Share with Customers

**Shares with customers** under **Sharing** in **Edit** lets a tenant give single databases of its servers, its destinations and its notification channels to other tenants, for a tenant of the MSP. Off again is refused while it gives anything away. The home tenant shares from the start. The connections of a tenant that does not share with customers are never shared, whoever holds the right to share. When a switch is refused and what it changes, see [Shared Databases](/user-guide/admin/shared-databases#tenants-that-share), and for destinations and channels [Shared Destinations and Channels](/user-guide/admin/shared-connections).

### What It May Add

**Backups on demand** in **Edit** of a customer decides how many backups a day it may start of each database given to it, see [Backups on Demand](/user-guide/admin/shared-databases#backups-on-demand).

**What it may add** in **Edit** of a tenant decides what the tenant adds itself, with a switch each for **Database connections**, **Directory sources**, **Destinations**, **Channels** and **API keys**, all on for a new tenant. The home tenant holds what the platform owns and is never limited.

Off stops new ones only. Its Connections page shows a note that they come from the platform in place of **New**, Clone and Quick Setup add none, and the server refuses one with `<tenant> adds no destinations of its own. <home tenant> decides that, ask them for one.` What it has keeps working and stays its own. **API keys** are the exception: off, no key of the tenant works any more, a request with one answers `API keys are switched off for this tenant`, nobody makes a new one, and **New API key** shows **API keys are off**. On again, the keys work as before. A tenant without destinations of its own writes to those a tenant of the MSP shares with it, which the dialog lists under **Provided to it**, see [Shared Destinations and Channels](/user-guide/admin/shared-connections).

Every change goes into the audit log of the home tenant and of the tenant itself.

### Connections to the Server DBackup Runs On

A connection that works on the server DBackup runs on itself, with its files, its Docker or the tools it runs there, belongs to the platform. That server holds the key of every secret and the database of every tenant. Such a connection is:

- **Local Filesystem**, as a destination or a directory source
- **Docker Volumes** without SSH, which talks to the Docker of that server
- **SQLite** without SSH, and a database server reached through a socket path in its host
- **Extra options** of a database in direct mode, since its dump tools run on that server, and a MongoDB connection URI
- **SQL Server** with a shared folder, which moves its `.bak` files through a folder of that server
- Rsync options beyond those that only change how files move, and an Rsync or SSH login through the keys or the agent of that server

Only a **platform admin signed in with a session**, in the home tenant, adds, changes, copies, tests or browses such a connection, and restores one from Recently deleted. An API key never does, not even one of a platform admin. The connection form offers these types and modes to a platform admin alone, marks the modes **Platform admin only** for anyone else, and opens such a connection read-only with the reason. The file browser of a local path answers a platform admin alone.

The other members of the home tenant still pick such a connection in their jobs, and its runs work for them. In the tenant of a customer nobody adds one, a platform admin neither, and a run of a customer refuses one.

No run reads or writes DBackup's own data, whoever saved the connection, a platform admin too: the folder of its database with its copies, the folder of its TLS certificate, its temporary folder, the folder of the configuration backup, `/proc`, which shows its keys in the environment of its process, and the files `ENCRYPTION_KEY_FILE` and `BETTER_AUTH_SECRET_FILE` name, also through a symbolic link and also as the folder of a job below a destination. So a job never puts the database, a decrypted copy or the configuration backups into an archive anyone may download. A Local Filesystem path never leads out of its folder through a symbolic link, and a restore lays no link whose target is absolute or leaves the folder it writes into.

This covers what DBackup does on the server itself, not what it reaches over the network. A connection to an address of the server, like `127.0.0.1`, or to another server of its network is a matter of [Network](#network), which blocks it for a tenant made from now on and lets a tenant made before reach it until the platform blocks it.

### Network

**Network** in **Edit** of a customer decides whether its connections reach the local network of the server DBackup runs on. With **Block the local network** on, no connection of the tenant reaches an address of:

| Range | What it is |
| :--- | :--- |
| `127.0.0.0/8`, `::1` | Loopback, the server DBackup runs on itself |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7` | Private networks |
| `169.254.0.0/16`, `fe80::/10` | Link-local, the metadata services of the clouds among them |
| `100.64.0.0/10` | Shared address space, which VPN overlays like NetBird and Tailscale use |
| `198.18.0.0/15` | Benchmarking, which networks also use inside |
| `64:ff9b:1::/48` | Local-use NAT64 |
| `0.0.0.0/8`, `::`, `224.0.0.0/4`, `ff00::/8`, `240.0.0.0/4`, `fec0::/10` | This network, multicast, reserved and broadcast |

An IPv4 address written as IPv6, like `::ffff:10.0.0.5`, `::10.0.0.5` or `64:ff9b::a00:5`, counts as its IPv4. DBackup checks every address a host of the connection resolves to: the server of a database or a destination, the S3 endpoint and the host of the bucket on it, the URL of a webhook, of Gotify or of ntfy, the SMTP host of an email channel. Amazon S3, the cloud drives, Telegram and Twilio have public endpoints of their own and need no check.

- **Over SSH** only the SSH server counts. The database behind it, `127.0.0.1` of that server too, is reached from there and never from the server DBackup runs on.
- **Allowed ranges** let the tenant reach parts of the local network anyway, like `10.10.10.0/24` for the servers of the customer behind a VPN of the MSP, or `fd00:1::/64`. A single address is `10.0.0.5/32`, or just `10.0.0.5`. The field checks a range as you type, **Add** puts it into the list, and the button at the end of a row takes it out. They count while the block is on. A tenant has at most 50 of them, a wider range covers more.
- Saving, **Test connection**, a browse of folders and every run check it. A connection saved before the block that reaches a blocked address stops working at its next run, with a message like `Acme reaches no address of the local network, db.internal is 10.0.0.5. The platform allows ranges for it under Platform, Tenants.`
- A destination or a channel another tenant shares follows the setting of that tenant, not the one of its customer.
- A host that does not resolve, or not within 5 seconds, is refused, since nothing says where it leads.
- The connection dials the address the check found, checked once more when it connects, so a name whose DNS answer changes in between reaches no blocked address either. MySQL and MariaDB with TLS on are the exception, their client checks the certificate against the name and takes no address beside it, so they dial the name the check resolved just before.
- A host counts the way the client of the connection reads it: an empty host of MySQL, MariaDB, PostgreSQL, MongoDB or Firebird as `127.0.0.1`, every host of a PostgreSQL or MongoDB list, `host\INSTANCE` of SQL Server and `host/port` of Firebird by the host, and `user@host` of rsync by the part after the last `@`. An SMB address must read `//server/share` or `\\server\share` with a plain server name or address, and its login names no Kerberos realm with `@`.
- **MongoDB** connects to one server only, its host and port. A seed list, an SRV name like the one of Atlas, or a connection URI is refused, since the tools connect to the members the server announces, which no check sees beforehand. Connect over SSH for a replica set.
- **SQL Server** follows a routing redirect only to a host the check lets through, and never out of the SSH tunnel.
- **SMB servers** are looked up in DNS only, never by a NetBIOS broadcast, which the check cannot see. Enter a DNS name or an IP address for a server that only answers to its NetBIOS name. The home tenant and a tenant without the block keep the lookup of Samba, NetBIOS names included.
- **Test** of an SSH login checks the SSH server before it logs in. A webhook, Gotify, ntfy or WebDAV server that answers with a redirect to another host fails instead of being followed, so enter the final address. The share a file server names for a shadow copy is checked like the configured one.

A new tenant starts with the block on. A tenant made before the setting existed keeps reaching the local network until the platform switches it on. The home tenant is the platform and reaches what its server reaches, so it has no Network part. Every change goes into the audit log of the home tenant and of the tenant itself.

::: info A guard, not a firewall
The check holds the clients of DBackup to the addresses it checked, and stops what it knows the servers send a client on to. A DFS referral of an SMB share still sends smbclient to another server, since smbclient has no switch to turn them off, and the lookup of a named SQL Server instance without a port goes out to the name once more. What must never be reached belongs behind the firewall of the server.
:::

## Groups in Tenants

Every tenant has groups of its own. A new tenant starts with **Admin**, which may do everything in the tenant, and every [group for all tenants](#groups-for-tenants). Whoever holds `groups:write` in the tenant adds, changes and deletes its groups, and a group never gets a permission its maker does not hold there. A person holds one group per tenant they work in, like **Admin** in one and **Operators** in another.

The **Settings** of the instance (`settings:read`, `settings:write`) count only from the group someone holds in the home tenant or from a platform group, so the admin of a customer never reaches them. **Tenant settings** (`tenant-settings:read`, `tenant-settings:write`) count in each tenant: the name, the logo and the notifications of the tenant, and its Recently deleted. The own profile (`profile:*`) counts from any group someone holds.

::: info After the update
Every group of an earlier version belongs to the home tenant. A group that could change the settings may also change the tenant settings, so Recently deleted works as before.
:::

### Groups for Tenants

A group the platform needs in many tenants, like **Client** for the people of every customer, is made once under **Platform → Users & Groups → Tenant groups** with **New group for tenants**. It needs `platform-accounts:write`. It starts as **Custom**, as a copy of another group for tenants, or as a preset for a common use:

| Preset | A member in a tenant |
| :--- | :--- |
| **Client** | Sees the databases of the tenant and their backups, backs them up on demand, downloads and restores them, changes nothing else |
| **Viewer**, **Operator**, **Backup admin**, **Auditor**, **User admin** | The same as the [templates of a new group](/user-guide/admin/permissions#create-a-group), without the settings of the instance |

It has a name, the permissions a member gets in a tenant, and **Where**: **All tenants**, the ones made later too, or **Selected tenants**. The list shows it above the own groups of the tenants, marked **For tenants**, with the tenants it reaches and everyone who holds it. **Admin** heads the list once, built in, with everyone who holds the Admin of a tenant. The menu at the end of a row, also on a right click, holds **Edit**, **Duplicate** and **Delete**, and **Delete** of the selection removes several groups for tenants nobody holds at once.

Each tenant it reaches gets a real group by that name, marked **From** and the name of the home tenant. Its admins give it to their people like any group, but only the platform changes, renames or deletes it, and a change counts in every tenant at once. A group of a tenant cannot take its name. Someone of a platform group gives such a group no permission and no tenant beyond what their own platform group gives.

A name is used once inside a tenant, everything else goes by the id of a group. When a tenant to reach has a group of its own by the name, saving asks per tenant:

- **Take over** that group: its members keep it, its permissions become the ones of the platform, which the dialog lists.
- **Leave the tenant out**: it keeps its own group, and once the name is free, it can be picked again.

A group with every permission is never taken over. Someone of a platform group cannot take over a group that may do more than they may in its tenant either, it shows **May do more than you** and the tenant stays out.

When a tenant leaves the group, or the group is deleted, and people hold it there, it asks too:

- **Remove it**: the group is gone there, its members move to the group picked for that tenant, or to none, which takes them out of the tenant. A sign-in provider that starts new people in it starts them in the group picked, or in none, and a provider of the tenant then adds nobody. The audit log of the platform keeps that change of the provider.
- **Keep it** as a group of that tenant: its members keep their rights, and the tenant changes and deletes it from then on.

Where a platform admin holds it, only a platform admin removes it, anyone else keeps it in that tenant. Where you hold it yourself, you keep it in that tenant, and someone else removes it. Someone of a platform group takes nobody out of a tenant who would afterwards work only in tenants where they manage the users, since they could then change that account, so they pick a group for its members there or keep it. Unless a platform admin saves, a tenant never loses the last people who manage its members, neither by removing the group, nor by moving its members to a group without that right, nor by a change or a take-over that takes the right away.

A group nobody holds goes without a question. Every change goes into the audit log of the platform, and what happened to its group into the log of each tenant. A new tenant starts with **Admin** and every group for all tenants, so a **Viewer** or a **Client** made once for all tenants is there from the start.

## People in a Tenant

Someone whose group in the tenant holds `users:write` manages its people:

- **New user** creates an account that joins the open tenant with the group picked. Outside the home tenant the group is required, since an account without one would belong to no tenant and show only in the home tenant.
- **Change group** gives someone of the tenant another group. **No group** takes them out of the tenant, the account stays. The people of a tenant are its members, and in the home tenant also the accounts of no tenant. Anyone else joins with an [invitation](#invitations) or through **Platform → Tenants**.
- The account itself, its password, second factor, sessions, name, email or the delete of it, changes only when it works in this tenant alone. An account belongs to every tenant it works in, so an account that also works in another tenant is changed by a platform admin or by whoever holds `platform-accounts:write` through a platform group that reaches all of its tenants. The account of a platform admin is changed by a platform admin only, and an account of a platform group as [Platform Groups](#platform-groups) says. The Users tab counts both as working elsewhere. Nobody but a platform admin changes an account whose group in one of its tenants may do more than they may there, like the **Admin** of the tenant, since whoever sets its password signs in as it.

Nobody gives a group that may do more than they may, and nobody takes one away from someone whose group may do more than they may. The group lists leave such groups out.

An email that has an account already cannot get a second one. Invite that person instead, they join with the account they have. **New user** says that the account exists only to a platform admin and to someone who sees it, like one of the people of the tenant. Anyone else reads that the email cannot get a new account here, whichever tenant the account works in, and after five such answers within an hour **New user** refuses them every email until the hour is over. The same holds wherever an email is set: Edit of a user, the own profile and an account restored from Recently deleted under a new email answer that the email cannot be given to this account, and their answers count toward the same five.

An email whose domain the [sign-in provider](/user-guide/admin/sso#providers-of-a-tenant) of another tenant claims is refused, since that provider would sign in to the account. A provider of the platform counts as one of the home tenant. Only a platform admin or someone with `platform-accounts:write` gives an account such an email, someone of a platform group of selected tenants only one whose domain the provider of one of those tenants claims. This holds for New user, also for an account that **Runs the platform** in no tenant, Edit, the own profile, an invitation that makes an account, and an account restored from Recently deleted, under its own email or a new one. An account of a platform group signs in through no provider of a tenant, but an account of no tenant without one joins the tenant of that provider on its first sign-in there. So only a platform admin or someone whose platform group reaches that tenant takes the platform group from such an account, or deletes the platform group it is in.

The pictures of the people show beside their names only to those who reach them. In a tenant you see the pictures of its people, of the people of the platform who open it, of anyone with an API key there, and with `audit:read` of anyone with an entry in its audit log. Someone of a platform group who may see the tenants, the accounts or the sign-in providers also sees the people of the tenants their platform group reaches. A platform admin, All tenants, a platform group of all tenants with one of these rights and whoever reads the settings through the home tenant without a platform group see every picture.

## Invitations

An invitation is a link that lets one person join the tenant with a group, with the account they have or a new one. You never type an email.

1. Go to **Users & Groups → Users** and click **Invite**. It needs `users:write`
2. Pick the **Group** they join with. Only groups that may do no more than you may are listed
3. Add a **Note** of up to 100 characters about who it is for, if you like. The list of open invitations shows it, and the audit log of the tenant keeps it with the creation and the revoke of the link
4. Set how many days it **Works for**, from 1 to 30, 7 by default
5. Click **Create link** and copy it. DBackup keeps only a hash of it and shows the link this once

The link works once, for whoever opens it first:

- **Signed in**, they see the tenant and the group and click **Join** with the name of the tenant, which opens it. Someone who is a member already keeps their group, and the link is used up.
- **Not signed in**, they click **Sign in**, and once they signed in the link opens again for **Join**. Or they create an account right there while password sign-in is on. The password follows [Settings → Passwords](/user-guide/admin/settings#passwords), and they sign in on the login page afterwards. They picked the email themselves, so a [sign-in provider](/user-guide/admin/sso#new-people) never links that account by its email, only from **Profile** while signed in.
- With `DISABLE_EMAIL_LOGIN=true` a new person signs in through a [sign-in provider](/user-guide/admin/sso) from **Sign in** and comes back to the link the same way.

An email that has an account already, or one whose domain another tenant claims, gets the same answer: the email cannot get a new account through this invitation, sign in with it instead or pick another email. The password is checked first, so a weak one reads the same for every email. After five failed attempts to create an account with one link the link stops working and you make a new one. An email that has an account also counts toward the five answers of **New user** of whoever made the link, across all of their links. Once those are spent, their links make no new account for an hour, whatever the email, while someone with an account still joins. DBackup counts the attempts in memory, so a restart starts the count again. The link is used up before the account is made, so two requests at once make one account.

A link works only while whoever made it still manages the people of the tenant, with `users:write` there or `platform-tenants:write` of a platform group that reaches it, and may still give its group. When they lose either or leave the tenant, their open links stop working. Whoever made a link, also through an API key of theirs, cannot join with it, since nobody gives themselves a group. A tenant has at most 100 open links at once, and one person makes at most 20 links within an hour, used and revoked ones included.

The links nobody used yet show in a banner above the list of users, with their group, note, who made them and when they run out. **Revoke** takes one back, only for someone who may give its group, like making it. A link that was used, ran out or was revoked tells whoever opens it to ask for a new one.

## API Keys

An API key belongs to the tenant it was made in and acts only there, whichever tenant its owner opens later. The API keys tab lists the keys of the open tenant. A key never does more than its owner may in that tenant, and never carries the settings of the instance through a platform group.

Rights of the platform go into a key in two places only, and only while its owner holds them:

- A key of the **home tenant** may hold **Tenants** and **Accounts**, for the automation of an MSP, see [Through the API](#through-the-api). It manages the tenants the platform group of its owner reaches, every tenant for a key of a platform admin.
- A key of a tenant that [shares with customers](#share-with-customers) may hold **Sharing** while the platform group of its owner reaches that tenant, for a hosting panel, and gives to and takes from only the tenants the platform group of its owner reaches, see [Shared Databases](/user-guide/admin/shared-databases#through-the-api) and [Shared Destinations and Channels](/user-guide/admin/shared-connections#through-the-api).

A key of a customer manages its own members and invitations with `users:read` and `users:write`, never another tenant. See [Platform Keys](/user-guide/features/api-keys#platform-keys).

## Audit Log

Every tenant has its own audit log, read by its people with `audit:read`. What belongs to the platform goes into the log of the home tenant, whichever tenant the admin works in: sign-ins, sign-outs and failed sign-ins, the changes of tenants, platform admins, platform groups and sign-in providers, and every change of the settings of the instance, like the system tasks, data retention, the certificate, the login image, the configuration backup and its restore, and the download and optimize of the database. The changes of a group and the invitations of a tenant show in the log of that tenant. The members added or removed through **Platform → Tenants** show in the log of that tenant and in the log of the home tenant.

Someone whose platform group reaches some tenants only reads in the log of the home tenant what concerns those tenants: the entries of their people, and of the entries about a tenant, like its rename or delete, only those about a tenant they reach. The panel of a user lists the same. The notice of a failed integrity check in the notification log tells them only how many other tenants had copies that failed.

A change of an account, your own included, like its password, second factor, sessions, name, email, picture, sign-in accounts, its delete and its restore from Recently deleted, goes into the log of the tenant you work in while the account is one of its people. A change of an account of another tenant, or one made in All tenants, goes into the log of the home tenant, so a customer never reads what someone did to an account of another tenant. Those entries show under **Users & Groups → Audit log** while the home tenant is open. In All tenants, **Users & Groups** asks for a tenant first, so pick the home tenant there.

The system notifications of **Settings → Notifications** belong to the platform as well, whichever tenant an event comes from. Their links open a run or a job in its own tenant, but their notification log, the one of the home tenant, keeps the run of a message only for a run of the home tenant, so **Open run** shows there only for those. The integrity check records a run in the History of each tenant with something to check, with that tenant's copies alone, the home tenant first.

## Before Updating

The update to this version moves the whole instance into the home tenant:

- Everything DBackup holds becomes the tenant **Default**.
- Every user with a group becomes a member of Default with that group. A user without a group stays without one.
- The SuperAdmin group becomes **Admin**, the group with every permission, and its members become platform admins. A group already named Admin is renamed **Admin (before update)** and keeps its members and permissions. A configuration backup from before the update still brings its Admin back into that group.
- Every API key belongs to Default and keeps its permissions. A key with `settings:read` or `settings:write` also gets `tenant-settings:read` or `tenant-settings:write`, like the groups, so a key that could delete for good still can.
- Every sign-in provider becomes a provider of the platform. Only platform admins add, change, switch and delete providers, as only the SuperAdmin group did before. Seeing them still needs `settings:read`, and from a browser only, no API key reads them any more.
- The names of saved logins and templates only need to be unique within a tenant from now on.
- An account whose owner set its current email themselves, and no admin changed it later, counts as one with an email it picked, as the audit log tells. No [sign-in provider](/user-guide/admin/sso#new-people) links it by that email any more. Its owner links the provider with **Link** under **Profile** while signed in.
- Sessions, passwords, passkeys, second factors and the settings of the instance stay as they are, so nobody has to sign in again.

Some permissions check more than before, with the home tenant alone too. Look at these before you update:

- **Groups.** Nobody makes, edits, gives or takes a group that may do more than they may. Let a member of **Admin** or a platform admin do it, or give the group of whoever does it what it lacks.
- **API keys of others.** Only the owner of an API key and a platform admin rotate it, enable it again, change its permissions or let it run longer. Anyone else with `api-keys:write` only renames it, lets it run out sooner, disables or deletes it.
- **Accounts.** Nobody but a platform admin sets the password, resets the second factor, ends the sessions, changes the name or email of, or deletes an account whose group may do more than they may, like a member of **Admin**. Let a platform admin do it.
- **Keys and templates.** `settings:read` no longer lists the encryption keys and the templates. Give a group that needs them `vault:read` or `templates:read`.
- **Test connection** needs the right to change connections of the kind (`sources:write`, `destinations:write` or `notifications:write`), no longer the right to see them.
- **Storage alerts** of a destination need `destinations:write` instead of `settings:write`.
- **Configuration backup.** Only a platform admin sets it up, switches it, runs it and restores one, no longer whoever holds `settings:write`. Make whoever does it a platform admin.
- **Redirects.** Webhook, Slack, Discord, Teams, Gotify and ntfy channels and WebDAV destinations follow a redirect only on the same host. Enter the final address of a server that sends DBackup on to another host.
- **Admin.** Someone added to **Admin** after the update may do everything in the tenant but is no platform admin, unlike a new member of SuperAdmin before. Pick **Platform admin** for their account under **Platform → Users & Groups** where they need it.
- **Connections to the server DBackup runs on.** Local Filesystem, SQLite in local mode, Docker Volumes without SSH, a database in direct mode with **Extra options**, SQL Server with a shared folder and the other connections of [Connections to the Server DBackup Runs On](#connections-to-the-server-dbackup-runs-on) are added, changed, copied, tested and browsed by a platform admin with a session alone, no longer by whoever holds the right to change connections of the kind. Their jobs keep running. The file browser of a local path needs a platform admin too, `settings:read` no longer opens it.
- **SQL Server shared folder.** It counts as a folder of the server DBackup runs on, also when a source saved earlier names none and uses `/tmp`. A customer's source in that mode stops working, switch it to **Over SSH** first.
- **Local paths.** No run writes into or reads from DBackup's temporary folder (`TMPDIR`, `/tmp` by default) any more, and a Local Filesystem path no longer follows a symbolic link out of its folder. A job whose Local Filesystem destination, folder source or SQLite source reaches the folder of the database, the certificates or the configuration backup fails as well, also for a platform admin, and a job called `config-backups` stops until it is renamed. Move a destination or a directory source that lies there, or that reaches its data through a link, to a folder of its own.
- **Links in a file restore.** A restore no longer lays a symbolic link whose target is absolute or climbs out of the folder it writes into, it names it in the log instead. Download the files as `.tar.gz` to get such links back.
- **Job names.** A name with a `.` or `..` folder, like `shop/../nightly`, a folder that starts with a hyphen, like `-nightly`, or one of slashes alone is refused, and a job that has one stops with a message until it is renamed.
- **Folders of directory sources.** The folder of a directory source in a job stays inside the folder its connection is set to, a folder with `..` is refused on save, and a job saved with one earlier stops with a message until the folder is changed.
- **SSH agent logins.** A saved SSH login with the authentication **SSH agent** is created or changed by a platform admin alone. A login saved that way earlier keeps working.
- **Folders of such connections.** Browsing the folders of a saved Local Filesystem or the volumes of Docker Volumes without SSH needs `jobs:write` or `storage:restore` beside `destinations:read`.
- **Restoring files.** A restore into Docker Volumes without SSH is for a platform admin alone. Any other place than the folder or volume the backup read needs `destinations:write` in the tenant of the connection it writes into. A target folder with `..` is refused, and only a platform admin restores a `.meta.json`, a file named like a backup or its index (`.tar`, `.enc`, `.index`) into a backup destination or a file into a `config-backups` folder or named `config_backup_*` into a storage. Download such files as `.tar.gz` instead.
- **Docker volumes.** A restore into Docker Volumes names the one volume it writes into, a target of `/` that left the volume to the backup is refused. Restore a backup of several volumes one volume at a time.
- **Configuration backups at a destination.** The configuration restore opens only an encrypted file there. Download an unencrypted file of an older version and upload it under **Settings → Configuration backup** to restore it.
- **Vault.** The Credentials tab and `GET /api/vault/credentials` need `vault:read` beside `credentials:read`, like the search. Give a group or key that reads saved logins there `vault:read` too.
- **Passwords in a connection.** Changing the host, port, SSH server or URL of a connection no longer keeps a password, key or token saved in the connection itself. Type it again with the change, or pick a saved login.
- **API.** The answers of the API name `viewerPlatformAdmin` instead of `viewerSuperAdmin`, the recovery kit is requested with `POST /api/vault/recovery-kit`, and cancelling a restore run needs `storage:restore`. Change a script that uses them.
- **Connections saved through the API.** A connection has to fit the fields of its type, with every port a whole number from 1 to 65535. A MySQL or MariaDB password with a line break is refused, also in a saved login.
- **SMB logins.** A user name or domain with a `%` is refused, change it on the server or use another login.
- **SMB paths.** A folder, path or address with a semicolon, a double quote or a control character is refused. Such files in an SMB folder source are left out, and a job whose name has one stops until it is renamed.
- **Client tools outside the Docker image.** A MySQL or MariaDB restore in direct mode needs a client that can turn off the commands of a dump: MariaDB 10.5.25, 10.6.18, 10.11.8, 11.4.2 or newer, or MySQL 8.0.40 or 8.4.3 or newer. Redis needs redis-cli 5 or newer, MongoDB the Database Tools 100.3.0 or newer and rsync a local rsync that takes `--no-links`, like GNU rsync 3. The Docker image ships all of them.

A database migration cannot be taken back. A start that is about to apply one first keeps a copy of the database beside it in `/data/db`, named `dbackup.db.before-migrate-<time>`, like `dbackup.db.before-migrate-2026-10-15T08-30-00-000Z`. The three newest copies stay, older ones are deleted. A start without a migration to apply copies nothing, and neither does a start after a migration that failed half way, so restarts of a container that cannot finish its migrations never push the copy from before them out.

::: warning Take a backup as well
When the copy fails, for example on a full volume, the log of the start says so and the migrations run anyway. Take a [configuration backup](/user-guide/features/system-backup) or [download the database](/user-guide/admin/data-retention#download-the-database) before the update.
:::

### Going Back

::: danger Put the copy in place first
Start the older version only on the copy from before the update. The older version finds no migration of its own left to apply on a migrated database and starts as if all were well, so switching only the image tag back breaks once it reads or writes the tables that changed.
:::

1. Stop DBackup
2. In `/data/db`, move `dbackup.db` and its `-wal` and `-shm` files away
3. Copy `dbackup.db.before-migrate-<time>` to `dbackup.db`. It is a single file with nothing in a write-ahead log
4. Start the image of the version you ran before, like `skyfay/dbackup:v4.0.2`

Everything done since the update is lost. Starting the new version again on that copy migrates it again.

## Troubleshooting

### "This account also works in other tenants"

The account works in another tenant too, or holds a platform group, so only a platform admin or someone who manages the accounts of the platform changes its password, second factor, sessions, name or email, or deletes it. Changing its group in your tenant still works while it is a member there.

### The Admin of a Customer Has No Settings of the Instance

The settings of the instance count only from the group in the home tenant or from a platform group. A customer manages its people, groups, connections, jobs and its own tenant settings, and the platform keeps the settings of the instance.

### "Acme reaches no address of the local network"

The tenant blocks the local network and a host of the connection resolves into it, like `db.internal is 10.0.0.5`. Connect over a public address or over SSH through a server of the customer, or let the platform allow the range under **Platform → Tenants → Edit → Network**, see [Network](#network).

### Someone Signs In but Sees Nothing

They work in no tenant, for example after **No group** or after the delete of their only tenant. Their Overview says **You work in no tenant yet** and leads to their profile. Add them under **Platform → Tenants → Members**, or send them an invitation.

## Next Steps

- [Shared Databases](/user-guide/admin/shared-databases) - give single databases of one server to several customers
- [Shared Destinations and Channels](/user-guide/admin/shared-connections) - give a destination or a channel to customers
- [Groups & Permissions](/user-guide/admin/permissions) - what a group lets its members do
- [User Management](/user-guide/admin/users) - accounts, passwords and second factors
