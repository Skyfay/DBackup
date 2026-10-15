# Tenants

Run one DBackup for several customers, each with its own connections, jobs, backups, keys and people.

## What a Tenant Is

A tenant is a customer of the instance and the boundary of its data. Its connections, jobs, runs, encryption keys, saved logins, templates, API keys, notification log, Recently deleted and audit log belong to it alone, and its people see nothing of the other tenants. That suits a managed service provider, a reseller or an agency that backs up the databases of its customers from one DBackup. Every tenant sees the same DBackup with the same login page, there is no white labeling.

Every installation has the **home tenant**, named **Default**. After the update from an earlier version it holds everything the instance held before. It also holds what the platform owns, like the runs of the system tasks and the sign-ins in the audit log, and it cannot be deleted.

::: info One tenant changes nothing
With only the home tenant, DBackup looks and works as before: the head of the sidebar names DBackup, and every group does what it did. Only a platform admin opens a menu from the head, with **New tenant** and **Manage tenants**, to create the second one.
:::

## Platform Admins

A platform admin opens every tenant, member or not, and passes every permission check there. After the update the members of the SuperAdmin group of earlier versions are platform admins, and the first account of a new installation becomes one. The pages show it as the built-in platform group **Platform admin**, which nobody edits or deletes. Another platform admin is made by picking that group for the account under **Platform → Users & Groups**.

Only a platform admin:

- Makes someone a platform admin or takes it back
- Changes the account of a platform admin
- Adds, changes and deletes [sign-in providers](/user-guide/admin/sso), since a provider signs in as anyone of its emails
- Restores a [configuration backup](/user-guide/features/system-backup), which brings back every tenant
- [Downloads the database](/user-guide/admin/data-retention#download-the-database)

Everything else of the platform, like the tenants, the accounts and the shared databases, a [platform group](#platform-groups) can give to other people of the MSP too, and it shows the sign-in providers. Nobody changes their own platform admin role, and the last platform admin stays one. An API key never acts as a platform admin, whoever owns it.

## Platform Groups

A platform group gives the people of the MSP rights without making them platform admins. It is made under **Platform → Users & Groups → Groups**, where a switch shows the platform groups or the groups of every tenant. A platform group has two parts:

| Part | Holds |
| :--- | :--- |
| **On the platform** | The settings of the instance, the tenants, the accounts with the platform groups and the shared databases, each with a level like See or Change, and the sign-in providers to see |
| **In the tenants** | The same areas as the group of a tenant, in **All tenants**, the ones made later included, or in **Selected tenants** |

Someone holds at most one platform group, picked in the panel of the account, and changes their own profile through it, also without a group in any tenant. In a tenant of its scope they may do what their group there gives plus what the platform group gives there, it never takes anything away, and they open such a tenant without being a member. A platform group of all tenants that sees something there also opens [All tenants](#all-tenants). The section **Platform** of the sidebar shows them only what their rights on the platform open.

Nobody makes, changes or gives a platform group that may do more than they may themselves, on the platform or in the tenants of its scope. An API key of someone in a platform group gets its rights in the tenants, never the ones on the platform.

## Switching Tenants

The head of the sidebar, at the very top left, always names where you work. Someone who may open two tenants or more clicks it to switch:

| Who | The head says |
| :--- | :--- |
| Anyone, while there is one tenant | DBackup, or the name under Settings → General, with the version |
| A platform admin in All tenants | **All tenants** and how many there are |
| Someone in one of several tenants they may open | The tenant and its place, like **Tenant 3 of 14** |
| A customer with one tenant to open | Their tenant and **Your backups** |

The menu has a search **Find a tenant** and lists the tenants. For a platform admin each tenant also shows its jobs and databases and a dot when the newest backup of one of its jobs failed (red) or missed a copy (amber). A platform admin also finds **All tenants** at the top and **New tenant** and **Manage tenants** at the bottom.

Inside a tenant the breadcrumb of the header starts with its name. The pick holds for the session. A platform admin starts in All tenants while there is more than one tenant, anyone else in the home tenant, or in the first tenant they joined when they are no member of the home tenant. A switch on the page of one record, like a run or a database server, leads to the Overview, since the next tenant does not hold that record.

## All Tenants

All tenants is the view of a platform admin over every tenant at once. The Overview, Connections, Jobs, Backups, the Database Explorer, History and the search of the header show the records of every tenant, each with its tenant in a column you can filter by.

All tenants only reads. Opening a record, or changing it, first switches into its tenant and says so, so a job never links to the destination or key of another customer. **New** asks which tenant the new record belongs to. The Vault, Templates, Quick Setup, the tenant settings and the Users & Groups of a tenant belong to one tenant, so in All tenants they ask for the tenant to open.

## The Sections Administration and Platform

With more than one tenant, the sidebar keeps the instance and the tenant apart:

| Section | Holds | Who sees it |
| :--- | :--- | :--- |
| **Administration** | The Vault, Templates, Users & Groups and Settings of the open tenant, with its Recently deleted | Everyone with the permissions in that tenant |
| **Platform** | Tenants, Users & Groups with every account of the instance, the groups of every tenant and the sign-in providers, and the Settings of the instance | Platform admins, in every view. Its Settings also whoever holds `settings:read` through the home tenant |

Inside a customer tenant a platform admin sees under Administration exactly what the admin of that customer sees. The breadcrumb of a Platform page starts with **Platform**. With one tenant there is no Platform section, and Administration is as before.

## Managing Tenants

Tenants are managed under **Platform → Tenants**, which **Manage tenants** in the menu of the sidebar head opens too and only a platform admin sees. The list shows every tenant with its members, connections, databases and jobs, and a dot when one of its newest backups failed, the home tenant first. **You work here** marks the tenant you have open.

### Create a Tenant

1. Click **New tenant**
2. Enter a name of at most 60 characters that no other tenant has
3. Click **Create tenant**

A new tenant starts with the built-in templates: the retention policies **Keep All**, **Simple - 14 Days** and **Smart GVS (7/4/12/2)**, the naming template **Standard**, five schedule presets and the exclude preset **System Junk Files**. Nobody works in it yet, so its members open next.

### Members

A click on a tenant, or **Members** in its menu, lists who works there with which group.

- **Add member** picks any account of the instance and its group in this tenant.
- The group of a member changes as soon as it is picked.
- The menu of a member offers **Make platform admin** or **No platform admin any more**, never on your own row, and **Remove from** the tenant. The account and its other tenants stay.

A tenant keeps someone who manages its members. The last member whose group holds `users:write` cannot be removed from the tenant or moved to a group without it until someone else gets that right. A platform admin may, since they manage every tenant anyway, so a tenant can be left without any member.

::: tip Let the customer invite its own people
Add one person of the customer with a group that may manage users. They invite everyone else with a link, see [Invitations](#invitations).
:::

### Open, Rename, Delete

**Open** switches you into the tenant. **Rename** gives it a new name, which its people see at once.

**Delete** removes the tenant with everything it holds: its connections with their health history, its jobs with their runs and logs, its encryption keys and saved logins, its templates, API keys, invitations and logs, and the databases of shared servers given to it. Nothing of it waits in Recently deleted. What stays:

- **The backups at its destinations.** DBackup does not touch them. The encryption keys are gone with the tenant, so its encrypted backups only open with a [recovery kit](/user-guide/security/recovery-kit).
- **The accounts.** They only lose their place in the tenant. An account that worked there alone belongs to no tenant afterwards and shows in the home tenant with **No group**.

The dialog lists what goes and waits for the tick **I have the recovery kits of its keys, or do not need its backups**. The home tenant and the tenant you work in cannot be deleted.

## Groups in Tenants

Every tenant has groups of its own. A new tenant starts with **Admin**, which may do everything in the tenant, and **Viewer**, which sees everything and changes nothing. Whoever holds `groups:write` in the tenant adds, changes and deletes its groups, and a group never gets a permission its maker does not hold there. A person holds one group per tenant they work in, like **Admin** in one and **Operators** in another.

The **Settings** of the instance (`settings:read`, `settings:write`) count only from the group someone holds in the home tenant, so the admin of a customer never reaches them. **Tenant settings** (`tenant-settings:read`, `tenant-settings:write`) count in each tenant: the name, the logo and the notifications of the tenant, and its Recently deleted. The own profile (`profile:*`) counts from any group someone holds.

::: info After the update
Every group of an earlier version belongs to the home tenant. A group that could change the settings may also change the tenant settings, so Recently deleted works as before.
:::

## People in a Tenant

Someone whose group in the tenant holds `users:write` manages its people:

- **New user** creates an account that joins the open tenant with the group picked. Outside the home tenant the group is required, since an account without one would belong to no tenant and show only in the home tenant.
- **Change group** gives someone of the tenant another group. **No group** takes them out of the tenant, the account stays.
- The account itself, its password, second factor, sessions, name, email or the delete of it, changes only when it works in this tenant alone. An account belongs to every tenant it works in, so an account that also works in another tenant is changed by a platform admin only. The account of a platform admin is never changed by anyone else.

Nobody gives a group that may do more than they may, and nobody takes one away from someone whose group may do more than they may. The group lists leave such groups out.

An email that has an account already cannot get a second one. Invite that person instead, they join with the account they have.

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

After five failed attempts to create an account with one link, like with an email that has an account already, the link stops working and you make a new one.

The links nobody used yet show in a banner above the list of users, with their group, note, who made them and when they run out. **Revoke** takes one back. A link that was used, ran out or was revoked tells whoever opens it to ask for a new one.

## API Keys

An API key belongs to the tenant it was made in and acts only there, whichever tenant its owner opens later. The API keys tab lists the keys of the open tenant. A key never does more than its owner may in that tenant, see [API Keys](/user-guide/features/api-keys).

## Audit Log

Every tenant has its own audit log, read by its people with `audit:read`. What belongs to the platform goes into the log of the home tenant: sign-ins, sign-outs and failed sign-ins, and the changes of groups, of tenants and of platform admins. The members a platform admin adds or removes, and the invitations of a tenant, show in the log of that tenant.

The settings, the system tasks and the system notifications of **Settings → Notifications** belong to the platform as well, whichever tenant an event comes from. A run of the integrity check shows in the History of the home tenant.

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

The account works in another tenant too, so only a platform admin changes its password, second factor, sessions, name or email, or deletes it. Changing its group in your tenant still works.

### The Admin of a Customer Has No Settings of the Instance

The settings of the instance count only from the group in the home tenant or from a platform group. A customer manages its people, groups, connections, jobs and its own tenant settings, and the platform keeps the settings of the instance.

### Someone Signs In but Sees Nothing

They work in no tenant, for example after **No group** or after the delete of their only tenant. Add them under **Platform → Tenants → Members**, or send them an invitation.

## Next Steps

- [Shared Databases](/user-guide/admin/shared-databases) - give single databases of one server to several customers
- [Groups & Permissions](/user-guide/admin/permissions) - what a group lets its members do
- [User Management](/user-guide/admin/users) - accounts, passwords and second factors
