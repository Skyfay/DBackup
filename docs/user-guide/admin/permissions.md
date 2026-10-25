# Groups & Permissions

Decide what people may see and do in DBackup through the group they are in.

## Overview

- A **group** holds a set of permissions
- Every **user** is in one group per [tenant](/user-guide/admin/tenants) they work in, or in none
- A user may do exactly what the permissions of their group allow, there are no deny rules

Every tenant has groups of its own, and a change of a group applies in its tenant alone. With only one tenant, everyone has exactly one group or none, as before.

Every tenant has a group with every permission, named **Admin**, which in the home tenant is the SuperAdmin group of earlier versions. It holds each permission of a tenant, also the ones a new version adds, and cannot be edited or deleted.

### Settings Count in the Home Tenant

The **Settings** area acts on the whole instance. It counts only from the group someone holds in the home tenant or from a [platform group](/user-guide/admin/tenants#platform-groups), so the admin of a customer never reaches it through a group in the customer's tenant. Groups belong to their tenant, so `groups:read` and `groups:write` count in each tenant like every other permission, and so do the **Tenant settings**. The **Own profile** permissions count from any group someone holds.

A group never gets a permission its maker does not hold in that tenant, and a group of a customer never holds the settings of the instance.

### The Rights of the Platform

The tenants, the accounts of every tenant, the sign-in providers and the sharing with customers belong to the platform. A [platform group](/user-guide/admin/tenants#platform-groups) gives them, never the group of a tenant, not even one with every permission:

| Area | See | Change |
| :--- | :--- | :--- |
| **Tenants** | `platform-tenants:read`: every tenant and All tenants | `platform-tenants:write`: create, rename and delete tenants, decide who works in them, which of them share with customers and what each adds itself |
| **Accounts** | `platform-accounts:read`: the accounts and the platform groups, with a platform group of selected tenants the people of those tenants | `platform-accounts:write`: change any account but a platform admin's whose tenants your platform group all reaches, the account of a platform group only when you may give that platform group, give platform groups, and give an account an email whose domain the sign-in provider of a tenant you reach claims |
| **Sign-in providers** | `platform-sign-in:read`, also given by `settings:read` | A platform admin only, since a provider signs in as anyone of its emails |
| **Sharing** | `platform-sharing:read`, **See what is shared**: who holds which database, and which tenants get a destination or a channel with the space each takes | `platform-sharing:write`, **Share with customers**: give databases away, move them, allow backups on demand, share destinations and channels and delete the backups of a tenant on a shared destination, in a tenant that shares with customers |

An API key carries these rights in two places only, and only while its owner holds them: **Tenants** and **Accounts** in a key made in the home tenant, for the automation of an MSP, see [Tenants](/user-guide/admin/tenants#api-keys), and **Sharing** in a key made in a tenant that [shares with customers](/user-guide/admin/shared-databases#tenants-that-share) and that the platform group of its owner reaches, for a hosting panel, see [Shared Databases](/user-guide/admin/shared-databases#through-the-api). Such a key reaches only the tenants its owner reaches. A key never carries the settings of the instance through a platform group, nor the sign-in providers.

**Share with customers** and **See what is shared** count only in a tenant the platform group reaches. Someone whose platform group reaches some customers shares nothing of a tenant they are merely a member of.

### What Only a Platform Admin Does

A platform admin passes every check in every tenant. A few tasks are for a platform admin alone, whatever a group gives:

- Make someone a platform admin or take it back, see [Tenants](/user-guide/admin/tenants#platform-admins)
- Change the account of a platform admin
- Add, change and delete sign-in providers
- Set up or start the configuration backup, and download, open or restore one, since it holds every tenant, user and group with the keys of the instance
- Download the database
- Restore or delete for good, from Recently deleted, the account of a platform admin, of a platform group or of someone who also worked in another tenant

Nobody changes or deletes a group they hold in any tenant, since that would hand them any permission. Nobody gives a group that may do more than they may, or takes one away from someone whose group may do more than they may.

::: warning No Group = No Access
A user without a group signs in but sees and does nothing until someone picks a group. The Users tab counts them above the list.
:::

## The Groups Tab

Go to **Users & Groups → Groups**. Each group shows what its members may do in one sentence, its members in the open tenant, how many of the 41 permissions it holds and when it last changed. The numbers above the list name the groups that may delete backups or reveal secrets and the groups nobody is in.

The switch beside the tabs shows the groups as a table or as cards with a bar of the level of every area. Phones always get the cards.

A click on a group opens its details: what its members may do in words, the level of every area, its members in the open tenant, and its changes from the audit log. With the right to change users, **Move** sends a member to another group and **Add people** moves people into this one, both in the open tenant and only for its people: its members, and in the home tenant the accounts of no tenant. Someone of another tenant joins with an [invitation](/user-guide/admin/tenants#invitations).

## Areas and Levels

The permissions are grouped into areas, and each area has a level:

| Level | Means |
| :--- | :--- |
| **None** | The area stays hidden |
| **See** | Look, never change |
| **Use** | Run, browse, download or restore as well |
| **Change** | Add, edit and delete as well |
| **Full** | The rest too, like deleting backups or revealing secrets |

Not every area has every level. A group whose permissions match no level of an area shows **Custom** there.

| Area | See | Use | Change | Full |
| :--- | :--- | :--- | :--- | :--- |
| **Connections** | `sources:view`, `destinations:read`, `notifications:read` | + `sources:read` | + `sources:write`, `destinations:write`, `notifications:write` | |
| **Jobs** | `jobs:read` | + `jobs:execute` | + `jobs:write` | |
| **Backups** | `storage:read` | + `storage:download`, `storage:restore` | | + `storage:delete` |
| **History** | `history:read` | | | |
| **Templates** | `templates:read` | | + `templates:write` | |
| **Vault** | `vault:read`, `credentials:read` | | + `vault:write`, `credentials:write` | + `credentials:delete`, `credentials:reveal` |
| **Users** | `users:read`, `groups:read` | | + `users:write`, `groups:write` | |
| **API keys** | `api-keys:read` | | + `api-keys:write` | |
| **Audit log** | `audit:read` | | | |
| **Settings** | `settings:read` | | + `settings:write` | |
| **Tenant settings** | `tenant-settings:read` | | + `tenant-settings:write` | |
| **Own profile** | | | `profile:update_name`, `profile:update_email`, `profile:update_password`, `profile:manage_2fa`, `profile:manage_passkeys`, `profile:manage_sso` | |

`dashboard:read` belongs to History but stands beside its levels. It lets an API key read the totals of the overview through `GET /api/dashboard/stats` without access to jobs, history or storage. The overview page itself needs no permission.

`sources:read` browses the tables and rows of a database in the Database Explorer, `credentials:reveal` shows the secret of a saved login and is written to the audit log.

`tenant-settings:write` also restores from [Recently deleted](/user-guide/admin/recently-deleted), deletes for good there and offers **Delete it permanently now** in every delete, each together with the right to change the record. Without it a delete always goes to Recently deleted.

## Create a Group

**New group** takes two steps.

**Step 1 of 2** picks what the group starts with:

- **Custom** starts with no permission, you pick every one yourself
- A **template** fills the permissions for a common kind of work
- **Copy a group** starts from the permissions of a group you have

| Template | Group name | Starts with |
| :--- | :--- | :--- |
| **Viewer** | Viewers | Sees everything, changes nothing, never a secret |
| **Operator** | Operators | Runs jobs, downloads and restores backups, changes nothing |
| **Backup admin** | Backup admins | Everything about connections, jobs and backups, nothing about people or settings |
| **Auditor** | Auditors | Reads the audit log, the history, the users and the settings |
| **User admin** | User admins | Manages users, groups and API keys, nothing about backups |

Every template gives the members their own profile. **Change start** in the next step goes back to this choice.

**Step 2 of 2** is the editor, the same one **Edit** opens:

1. Enter the name, which no other group may have
2. Pick an area on the left, a list on a phone
3. Set its level, or tick single permissions below it. A permission that needs another ticks it along, like **Restore** with **See the backups**
4. Click **Create group** or **Save changes**

The foot names every area whose level changes. Members get a change with their next click, and the audit log keeps what changed rather than the whole list.

**Duplicate** opens the editor with a copy of a group and nobody in it. A group you hold has no **Edit**, another admin changes it.

## Delete a Group

**Delete** asks first. A group with members asks which group of the tenant they move to, only one that may do no more than you may, or **No group**, which takes them out of the tenant. The button waits for the pick. Nobody loses access by surprise, and the audit log of the tenant keeps the group and who was in it. A [sign-in provider](/user-guide/admin/sso#new-people) that adds new people to the group adds them where its members go. With **No group**, a provider of the platform adds them without a group, and a provider of a tenant stops adding people.

Several empty groups can be ticked and deleted together. A group with members is left out of that and deleted on its own. You cannot delete a group you hold.

::: tip Keep groups small
Start from the template closest to the work, lower what it does not need, and name the group after the work, like "Backup Operators". The **Can delete backups** and **Can reveal secrets** numbers above the list show where the sensitive permissions are.
:::

## Troubleshooting

### A User Sees Nothing

The user has no group in the open tenant. Open the user on the Users tab and click **Change group**, or use **Add people** on a group.

### A Button Is Missing

The group of the user lacks the permission in the open tenant. Open the group and check the level of the area in its details. The settings of the instance count only from the group in the home tenant or a platform group, see [Settings Count in the Home Tenant](#settings-count-in-the-home-tenant), and some tasks are for a platform admin only whatever the group holds, see [What Only a Platform Admin Does](#what-only-a-platform-admin-does).

### An Area Shows Custom

The group holds a mix of permissions no level has, often from before levels existed. Pick a level to tidy it up, or leave it as it is.

## API Reference

Permissions are strings in the form `{resource}:{action}`, like `jobs:execute`. A group stores them as a list:

```json
{
  "id": "uuid",
  "name": "Backup Operators",
  "permissions": ["sources:view", "destinations:read", "jobs:read", "jobs:execute", "storage:read", "history:read"]
}
```

API keys hold a list in the same form and never use more than their owner may in the tenant of the key. See [API Keys](/user-guide/features/api-keys#what-a-key-may-do).

## Next Steps

- [User Management](/user-guide/admin/users) - Manage user accounts
- [Tenants](/user-guide/admin/tenants) - Groups and people across customers
- [SSO/OIDC](/user-guide/admin/sso) - Enterprise authentication
