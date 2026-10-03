# Groups & Permissions

Decide what people may see and do in DBackup through the group they are in.

## Overview

- A **group** holds a set of permissions
- Every **user** is in one group, or in none
- A user may do exactly what the permissions of their group allow, there are no deny rules

The built-in **SuperAdmin** group passes every check. It cannot be edited or deleted, and only a SuperAdmin can make someone a SuperAdmin.

### What Only a SuperAdmin Does

Some tasks decide who is a SuperAdmin or who signs in as whom, so no permission is enough for them:

- Make someone a SuperAdmin, and change the group of a SuperAdmin, set their password, reset their second factor, sign them out or delete them
- Add, change, switch and delete sign-in providers, see [SSO / OIDC](/user-guide/admin/sso)
- Restore a configuration backup, which brings back users and groups

Nobody changes or deletes the group they are in, since that would hand them any permission.

::: warning No Group = No Access
A user without a group signs in but sees and does nothing until someone picks a group. The Users tab counts them above the list.
:::

## The Groups Tab

Go to **Users & Groups → Groups**. Each group shows what its members may do in one sentence, its members, how many of the 39 permissions it holds and when it last changed. The numbers above the list name the groups that may delete backups or reveal secrets and the groups nobody is in.

The switch beside the tabs shows the groups as a table or as cards with a bar of the level of every area. Phones always get the cards.

A click on a group opens its details: what its members may do in words, the level of every area, the members, and its changes from the audit log. With the right to change users, **Move** sends a member to another group and **Add people** moves people into this one.

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
| **Own profile** | | | `profile:update_name`, `profile:update_email`, `profile:update_password`, `profile:manage_2fa`, `profile:manage_passkeys`, `profile:manage_sso` | |

`dashboard:read` belongs to History but stands beside its levels. It lets an API key read the totals of the overview through `GET /api/dashboard/stats` without access to jobs, history or storage. The overview page itself needs no permission.

`sources:read` browses the tables and rows of a database in the Database Explorer, `credentials:reveal` shows the secret of a saved login and is written to the audit log.

`settings:write` also restores from [Recently deleted](/user-guide/admin/recently-deleted), deletes for good there and offers **Delete it permanently now** in every delete, each together with the right to change the record. Without it a delete always goes to Recently deleted.

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

**Duplicate** opens the editor with a copy of a group and nobody in it. The group you are in has no **Edit**, another admin changes it.

## Delete a Group

**Delete** asks first. A group with members asks which group they move to, or **No group**, and the button waits for the pick. Nobody loses access by surprise, and the audit log keeps the group and who was in it.

Several empty groups can be ticked and deleted together. A group with members is left out of that and deleted on its own. You cannot delete the group you are in.

::: tip Keep groups small
Start from the template closest to the work, lower what it does not need, and name the group after the work, like "Backup Operators". The **Can delete backups** and **Can reveal secrets** numbers above the list show where the sensitive permissions are.
:::

## Troubleshooting

### A User Sees Nothing

The user has no group. Open the user on the Users tab and click **Change group**, or use **Add people** on a group.

### A Button Is Missing

The group of the user lacks the permission. Open the group and check the level of the area in its details. Some tasks are for a SuperAdmin only whatever the group holds, see [What Only a SuperAdmin Does](#what-only-a-superadmin-does).

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

API keys hold a list in the same form and never use more than the group of their owner allows. See [API Keys](/user-guide/features/api-keys#what-a-key-may-do).

## Next Steps

- [User Management](/user-guide/admin/users) - Manage user accounts
- [SSO/OIDC](/user-guide/admin/sso) - Enterprise authentication
