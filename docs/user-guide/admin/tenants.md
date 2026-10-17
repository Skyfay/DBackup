# Tenants

Run one DBackup for several customers, each with its own connections, jobs, backups, keys and people.

## What a Tenant Is

A tenant is a customer of the instance and the boundary of its data. Its connections, jobs, runs, encryption keys, saved logins, templates, API keys, notification log, Recently deleted and audit log belong to it alone, and its people see nothing of the other tenants. That suits a managed service provider, a reseller or an agency that backs up the databases of its customers from one DBackup. Every tenant sees the same DBackup with the same login page, there is no white labeling.

Every installation has the **home tenant**, named **Default**. After the update from an earlier version it holds everything the instance held before. It also holds what the platform owns, like the runs of the system tasks and the sign-ins in the audit log, and it cannot be deleted.

::: info One tenant changes nothing
With only the home tenant, DBackup looks and works as before: the head of the sidebar names DBackup, and every group does what it did. Whoever may see the tenants opens a menu from the head with **Manage tenants**, and whoever may create one also finds **New tenant** there, to create the second one.
:::

## Platform Admins

A platform admin opens every tenant, member or not, and passes every permission check there. After the update the members of the SuperAdmin group of earlier versions are platform admins, and the first account of a new installation becomes one. The pages show it as the built-in platform group **Platform admin**, which nobody edits or deletes. Another platform admin is made by picking that group for the account under **Platform → Users & Groups**.

Only a platform admin:

- Makes someone a platform admin or takes it back
- Changes the account of a platform admin
- Adds, changes and deletes [sign-in providers](/user-guide/admin/sso), since a provider signs in as anyone of its emails
- Restores a [configuration backup](/user-guide/features/system-backup), which brings back every tenant
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

Nobody makes, changes or gives a platform group that may do more than they may themselves, on the platform or in the tenants of its scope. The account of someone in a platform group is changed only by a platform admin, or by someone with `platform-accounts:write` who may give that platform group, never by the admin of a tenant. An API key of someone in a platform group gets its rights in the tenants, never the ones on the platform, but for **Sharing** in a key of a tenant that shares with customers, see [API Keys](#api-keys).

## Switching Tenants

The head of the sidebar, at the very top left, always names where you work. Someone who may open two tenants or more clicks it to switch:

| Who | The head says |
| :--- | :--- |
| Anyone, while there is one tenant | DBackup, or the name under Settings → General, with the version |
| Someone in All tenants | **All tenants** and how many there are |
| Someone in one of several tenants they may open | The tenant and its place, like **Tenant 3 of 14** |
| A customer with one tenant to open | Their tenant and **Your backups** |

The menu has a search **Find a tenant** and lists the tenants. For whoever may see the tenants each tenant also shows its jobs and databases and a dot when the newest backup of one of its jobs failed (red) or missed a copy (amber). Whoever may open All tenants finds it at the top. Whoever may see the tenants finds **Manage tenants** at the bottom, and **New tenant** above it while they may create tenants.

Inside a tenant the breadcrumb of the header starts with its name. The pick holds for the session and so for every tab of the browser: when one tab switches, the other tabs load their page again in the new tenant. A tenant deleted meanwhile says so when picked and leaves the list. A platform admin, and a platform group that opens All tenants, start in All tenants while there is more than one tenant, anyone else in the home tenant, or in the first tenant they joined when they are no member of the home tenant. A switch on the page of one record, like a run or a database server, leads to the Overview, since the next tenant does not hold that record.

## All Tenants

All tenants is the view of a platform admin, or of a platform group of all tenants, over every tenant at once. The Overview, Connections, Jobs, Backups, the Database Explorer, History and the search of the header show the records of every tenant, each with its tenant in a column you can filter by.

All tenants only reads. Opening a record, or changing it, first switches into its tenant and says so, so a job never links to the destination or key of another customer. **New** asks which tenant the new record belongs to and lists only the tenants where you may add that kind of record. Without one it does not show. The Vault, Templates, Quick Setup, the tenant settings and the Users & Groups of a tenant belong to one tenant, so in All tenants they ask for the tenant to open.

## The Sections Administration and Platform

With more than one tenant, the sidebar keeps the instance and the tenant apart:

| Section | Holds | Who sees it |
| :--- | :--- | :--- |
| **Administration** | The Vault, Templates, Users & Groups and Settings of the open tenant, with its Recently deleted | Everyone with the permissions in that tenant |
| **Platform** | Tenants, Users & Groups with every account of the instance, the groups of every tenant and the sign-in providers, and the Settings of the instance | Platform admins, in every view, and each page to whoever holds its right of the platform. Its Settings and sign-in providers also whoever holds `settings:read` through the home tenant |

Inside a customer tenant a platform admin sees under Administration exactly what the admin of that customer sees. The breadcrumb of a Platform page starts with **Platform**. With one tenant there is no Platform section, and Administration is as before.

## Managing Tenants

Tenants are managed under **Platform → Tenants**, which **Manage tenants** in the menu of the sidebar head opens too. Seeing it needs `platform-tenants:read`, changing anything `platform-tenants:write`. Someone of a platform group changes the members, the name, the sharing, what it may add or the delete only of the tenants their platform group reaches, never of one they are merely a member of. The list shows every tenant with its members, connections, databases and jobs, and a dot when one of its newest backups failed, the home tenant first. **You work here** marks the tenant you have open, and **Shares with customers** a tenant of the MSP that gives databases, destinations and channels to customers. **Columns** hides and orders the columns, which stay as you left them. Three more columns:

| Column | Shows |
| :--- | :--- |
| **Provided to it** | The destinations and channels other tenants share with it. A tenant that gets none but shares some itself shows what it gives in gray, like **Gives 2 destinations** |
| **Backups on demand** | How many backups a day a customer may start of each database given to it, and how many databases and rules set their own, see [Backups on Demand](/user-guide/admin/shared-databases#backups-on-demand) |
| **May add itself** | **Everything**, or a tag like **No own destinations, channels** or **Adds nothing itself**, see [What It May Add](#what-it-may-add) |

The menu of a tenant, also on a right click, holds **Open**, **Edit** and **Delete**. A click on a tenant opens **Edit**, and someone who may only see the tenants gets **View** in its place.

### Create a Tenant

1. Click **New tenant**. It shows to a platform admin, and to a platform group of all tenants with `platform-tenants:write`, since a group of some tenants would never reach the new one
2. Enter a name of at most 60 characters that no other tenant has
3. Tick **Shares with customers** for a tenant of the MSP that gives single databases, destinations and notification channels to other tenants, see [Share with Customers](#share-with-customers)
4. Click **Create tenant**

A new tenant starts with the built-in templates: the retention policies **Keep All**, **Simple - 14 Days** and **Smart GVS (7/4/12/2)**, the naming template **Standard**, five schedule presets and the exclude preset **System Junk Files**. Nobody works in it yet, so **Edit** opens next on its members.

### Edit a Tenant

**Edit** holds every setting of a tenant in one dialog, its parts listed on the left:

| Part | Holds |
| :--- | :--- |
| **General** | The name, at most 60 characters that no other tenant has. Its people see a new one at once |
| **Members** | Who works there with which group, see [Members](#members) |
| **Sharing** | **Shares with customers**, see [Share with Customers](#share-with-customers) |
| **What it may add** | A switch per kind, see [What It May Add](#what-it-may-add). Not for the home tenant |
| **Backups on demand** | How many backups a day it may start of each database given to it. Not for the home tenant |

**Save changes** saves the name, the sharing, what it may add and the backups on demand together, and the foot says what changed. A change of the members and **Follow** of backups on demand count at once. When the server refuses one part, like sharing that is still in use, the dialog opens that part and keeps the rest of what is not saved yet.

### Members

**Members** in **Edit** lists who works there with which group.

- **Add member** picks an account and its group in this tenant. It lists every account to a platform admin. Someone of a platform group sees every account with `platform-accounts:read`, else the people of the tenants their platform group reaches, and never a platform admin or themselves, whose memberships a platform admin changes.
- The group of a member changes as soon as it is picked. Someone of a platform group gives and takes only a group that may do no more than they may in that tenant.
- The menu of a member offers **Remove from** the tenant. The account and its other tenants stay, and its sessions that worked in the tenant pick another one. A platform admin also finds **Make platform admin** or **No platform admin any more** there, never on their own row.

A tenant keeps someone who manages its members. The last member whose group holds `users:write` cannot be removed from the tenant or moved to a group without it until someone else gets that right. A platform admin may, since they manage every tenant anyway, so a tenant can be left without any member.

::: tip Let the customer invite its own people
Add one person of the customer with a group that may manage users. They invite everyone else with a link, see [Invitations](#invitations).
:::

### Open, Delete

**Open** switches you into the tenant.

**Delete** removes the tenant with everything it holds: its connections with their health history, its jobs with their runs and logs, its encryption keys and saved logins, its templates, API keys, invitations and logs, its groups and sign-in providers, its notification settings and the storage alerts of its destinations. The databases of shared servers given to it end with it, and the backups of its time belong to nobody from then on, see [Shared Databases](/user-guide/admin/shared-databases#the-time-window). Its backups on destinations another tenant shares with it are deleted after the tenant is gone. A tenant that shares destinations or channels takes them from its customers first, whose backups stay on the storage. Nothing of it waits in Recently deleted. What stays:

- **The backups at its own destinations.** DBackup does not touch them. The encryption keys are gone with the tenant, so its encrypted backups only open with a [recovery kit](/user-guide/security/recovery-kit).
- **The accounts.** They only lose their place in the tenant. An account that worked there alone belongs to no tenant afterwards and shows in the home tenant with **No group**.

The dialog lists what goes and waits for the tick **I have the recovery kits of its keys, or do not need its backups**. The home tenant and the tenant you work in cannot be deleted.

Ticked tenants go together with **Delete** above the list, as long as they are empty: no connections, no jobs and nobody working in them. A tenant that holds any of it is deleted on its own, where the dialog asks first.

### Share with Customers

**Shares with customers** under **Sharing** in **Edit** lets a tenant give single databases of its servers, its destinations and its notification channels to other tenants, for a tenant of the MSP. Off again is refused while it gives anything away. The home tenant shares from the start. The connections of a tenant that does not share with customers are never shared, whoever holds the right to share. When a switch is refused and what it changes, see [Shared Databases](/user-guide/admin/shared-databases#tenants-that-share), and for destinations and channels [Shared Destinations and Channels](/user-guide/admin/shared-connections).

### What It May Add

**Backups on demand** in **Edit** of a customer decides how many backups a day it may start of each database given to it, see [Backups on Demand](/user-guide/admin/shared-databases#backups-on-demand).

**What it may add** in **Edit** of a tenant decides what the tenant adds itself, with a switch each for **Database connections**, **Directory sources**, **Destinations**, **Channels** and **API keys**, all on for a new tenant. The home tenant holds what the platform owns and is never limited.

Off stops new ones only. Its Connections page shows a note that they come from the platform in place of **New**, Clone and Quick Setup add none, and the server refuses one with `<tenant> adds no destinations of its own. <home tenant> decides that, ask them for one.` What it has keeps working and stays its own. **API keys** are the exception: off, no key of the tenant works any more, a request with one answers `API keys are switched off for this tenant`, nobody makes a new one, and **New API key** shows **API keys are off**. On again, the keys work as before. A tenant without destinations of its own writes to those a tenant of the MSP shares with it, which the dialog lists under **Provided to it**, see [Shared Destinations and Channels](/user-guide/admin/shared-connections).

Every change goes into the audit log of the home tenant and of the tenant itself.

::: warning The server DBackup runs on belongs to the platform
A connection that reaches the server DBackup runs on is added in the home tenant only, whatever a tenant may add. That server holds the key of every secret and the database of every tenant. Such a connection is:

- **Local Filesystem**, which a customer does not even find among the types
- **Docker Volumes** without SSH, which talks to the Docker of that server
- **SQLite** without SSH, and a database server reached through a socket path in its host
- **Additional options** of a database in direct mode, since its dump tools run on that server
- Rsync options beyond those that only change how files move, and an Rsync or SSH login through the keys or the agent of that server

A customer's save, test or run of such a connection is refused with a message that says why. The file browser of a local path answers only in the home tenant.
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

When a tenant leaves the group, or the group is deleted, and people hold it there, it asks too:

- **Remove it**: the group is gone there, its members move to the group picked for that tenant, or to none, which takes them out of the tenant.
- **Keep it** as a group of that tenant: its members keep their rights, and the tenant changes and deletes it from then on.

A group nobody holds goes without a question. Every change goes into the audit log of the platform, and what happened to its group into the log of each tenant. A new tenant starts with **Admin** and every group for all tenants, so a **Viewer** or a **Client** made once for all tenants is there from the start. A tenant made before keeps the Viewer it started with.

## People in a Tenant

Someone whose group in the tenant holds `users:write` manages its people:

- **New user** creates an account that joins the open tenant with the group picked. Outside the home tenant the group is required, since an account without one would belong to no tenant and show only in the home tenant.
- **Change group** gives someone of the tenant another group. **No group** takes them out of the tenant, the account stays. The people of a tenant are its members, and in the home tenant also the accounts of no tenant. Anyone else joins with an [invitation](#invitations) or through **Platform → Tenants**.
- The account itself, its password, second factor, sessions, name, email or the delete of it, changes only when it works in this tenant alone. An account belongs to every tenant it works in, so an account that also works in another tenant is changed by a platform admin or by whoever holds `platform-accounts:write`. The account of a platform admin is changed by a platform admin only, and an account of a platform group as [Platform Groups](#platform-groups) says. The Users tab counts both as working elsewhere.

Nobody gives a group that may do more than they may, and nobody takes one away from someone whose group may do more than they may. The group lists leave such groups out.

An email that has an account already cannot get a second one. Invite that person instead, they join with the account they have.

An email whose domain the [sign-in provider](/user-guide/admin/sso#providers-of-a-tenant) of another tenant claims is refused, since that provider would sign in to the account. A provider of the platform counts as one of the home tenant. Only a platform admin or someone with `platform-accounts:write` gives an account such an email. This holds for New user, Edit, the own profile, an invitation that makes an account, and a restore from Recently deleted under a new email.

## Invitations

An invitation is a link that lets one person join the tenant with a group, with the account they have or a new one. You never type an email.

1. Go to **Users & Groups → Users** and click **Invite**. It needs `users:write`
2. Pick the **Group** they join with. Only groups that may do no more than you may are listed
3. Add a **Note** of up to 100 characters about who it is for, if you like. Only the list of open invitations shows it
4. Set how many days it **Works for**, from 1 to 30, 7 by default
5. Click **Create link** and copy it. DBackup keeps only a hash of it and shows the link this once

The link works once, for whoever opens it first:

- **Signed in**, they see the tenant and the group and click **Join** with the name of the tenant, which opens it. Someone who is a member already keeps their group, and the link is used up.
- **Not signed in**, they sign in and open the link again, or create an account right there while password sign-in is on. The password follows [Settings → Passwords](/user-guide/admin/settings#passwords), and they sign in on the login page afterwards.
- With `DISABLE_EMAIL_LOGIN=true` a new person signs in through a [sign-in provider](/user-guide/admin/sso) first, then opens the link again.

After five failed attempts to create an account with one link, like with an email that has an account already or one whose domain another tenant claims, the link stops working and you make a new one. The link is used up before the account is made, so two requests at once make one account.

A link works only while whoever made it may still give its group in the tenant. When they lose that right or leave the tenant, their open links stop working. A tenant has at most 100 open links at once.

The links nobody used yet show in a banner above the list of users, with their group, note, who made them and when they run out. **Revoke** takes one back. A link that was used, ran out or was revoked tells whoever opens it to ask for a new one.

## API Keys

An API key belongs to the tenant it was made in and acts only there, whichever tenant its owner opens later. The API keys tab lists the keys of the open tenant. A key never does more than its owner may in that tenant, and never carries what a platform group gives on the platform, the settings of the instance included. A key made in a tenant that [shares with customers](#share-with-customers) may hold **Sharing** while its owner does, for a hosting panel, see [Shared Databases](/user-guide/admin/shared-databases#through-the-api) and [API Keys](/user-guide/features/api-keys).

## Audit Log

Every tenant has its own audit log, read by its people with `audit:read`. What belongs to the platform goes into the log of the home tenant, whichever tenant the admin works in: sign-ins, sign-outs and failed sign-ins, the changes of tenants, platform admins, platform groups and sign-in providers, and every change of the settings of the instance, like the system tasks, data retention, the certificate, the login image, the configuration backup and its restore, and the download and optimize of the database. The changes of a group, the members added or removed through **Platform → Tenants**, and the invitations of a tenant show in the log of that tenant.

The system notifications of **Settings → Notifications** belong to the platform as well, whichever tenant an event comes from. The integrity check records a run in the History of each tenant with something to check, with that tenant's copies alone, the home tenant first.

## Before Updating

The update to this version moves the whole instance into the home tenant:

- Everything DBackup holds becomes the tenant **Default**.
- Every user with a group becomes a member of Default with that group. A user without a group stays without one.
- The SuperAdmin group becomes **Admin**, the group with every permission, and its members become platform admins. When a group named Admin exists already, it becomes **Admin (was SuperAdmin)**.
- The names of saved logins and templates only need to be unique within a tenant from now on.

A database migration cannot be taken back. A start that is about to apply one first keeps a copy of the database beside it in `/data/db`, named `dbackup.db.before-migrate-<time>`, like `dbackup.db.before-migrate-2026-10-15T08-30-00-000Z`. The three newest copies stay, older ones are deleted. A start without a migration to apply copies nothing.

::: warning Take a backup as well
When the copy fails, for example on a full volume, the log of the start says so and the migrations run anyway. Take a [configuration backup](/user-guide/features/system-backup) or [download the database](/user-guide/admin/data-retention#download-the-database) before the update.
:::

### Going Back

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

### Someone Signs In but Sees Nothing

They work in no tenant, for example after **No group** or after the delete of their only tenant. Their Overview says **You work in no tenant yet** and leads to their profile. Add them under **Platform → Tenants → Members**, or send them an invitation.

## Next Steps

- [Shared Databases](/user-guide/admin/shared-databases) - give single databases of one server to several customers
- [Shared Destinations and Channels](/user-guide/admin/shared-connections) - give a destination or a channel to customers
- [Groups & Permissions](/user-guide/admin/permissions) - what a group lets its members do
- [User Management](/user-guide/admin/users) - accounts, passwords and second factors
