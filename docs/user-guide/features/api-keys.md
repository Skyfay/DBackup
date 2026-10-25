# API Keys

API keys let scripts, CI/CD pipelines and monitoring tools call the DBackup API without a browser session.

## Overview

- A key starts with `dbackup_`, followed by 60 hex characters. DBackup stores only a scrypt hash of it and shows the key once, right after it was created or rotated.
- A key **acts as its owner**, the user who created it. It never gets more than its owner may do, checked at every request.
- A key **belongs to the tenant** it was made in and acts only there, whichever [tenant](/user-guide/admin/tenants) its owner opens later.
- A new key **runs out after 90 days** unless you pick another end or Never.
- A key can be disabled and enabled again, rotated to a new secret, or deleted.

## The API Keys Tab

**Users & Groups → API keys** lists every key of the open tenant. The strip above the list counts the keys and names the ones that run out within two weeks, were never used, may do more than read, and who owns them.

- Search finds a key by its name or by the start of its secret, like `dbackup_4f1a9c0e`.
- **All**, **Active**, **Runs out soon**, **Disabled** and **Expired** filter by state, **Owner** by the user who created it. **Runs out soon** is marked amber while a key runs out within two weeks.
- The view switch shows the keys as a table or as cards. A phone always gets the cards.
- A key that runs out within two weeks is marked amber, an expired one red.

Click a key to open its panel: what it may do in words and by area, when it was last used and runs out, whose permissions it uses, when it was last rotated, the last runs it started and a first request with the key read from `$DBACKUP_KEY`.

## Create an API Key

1. Open **Users & Groups → API keys** and click **New API key**. In a tenant whose API keys the platform switched off, it shows **API keys are off** instead and no key of the tenant works, see [What It May Add](/user-guide/admin/tenants#what-it-may-add)
2. Pick what the key is for (step 1 of 2):
   - **Custom** starts with no permission
   - A **task** starts with exactly the permissions its calls need, see below
   - **Copy a key** starts with what an existing key may do
3. In step 2, set the **Name**, when it **Runs out** (Never, 30d, 90d, 1y or a date) and its permissions area by area
4. Click **Create key**
5. **Copy the key.** DBackup shows it only this once, with a first request to try it

A key gets exactly what is ticked. Unlike a group, ticking a permission does not tick what it needs in the web interface, since a script calls the API directly. Every key needs at least one permission, and two keys never share a name, since a run names the key that started it.

For a script that starts one job, the **Setup** of the job's API trigger dialog opens the same editor with the CI/CD task and fills the new key into its examples. See [Webhook Triggers](/user-guide/features/webhook-triggers#the-api-trigger-dialog).

### Tasks

| Task | Permissions | Made for |
| :--- | :--- | :--- |
| **Run jobs from CI/CD** | `jobs:execute`, `history:read` | `POST /api/jobs/{id}/run`, then polling the run |
| **Dashboard widget** | `dashboard:read` | `GET /api/dashboard/stats` for Homepage, Homarr or Grafana |
| **Monitoring** | `jobs:read`, `storage:read`, `history:read` | `GET /api/history/runs` for Uptime Kuma or a script |
| **Download backups** | `destinations:read`, `storage:read`, `storage:download` | `POST /api/storage/{id}/download-url` |
| **Restore from a script** | `sources:view`, `storage:read`, `storage:restore`, `history:read` | `POST /api/storage/{id}/restore` |
| **Read only** | `sources:view`, `destinations:read`, `notifications:read`, `jobs:read`, `storage:read`, `history:read`, `dashboard:read`, `templates:read` | Every list, nothing that changes a thing |

A task the group of your account does not allow shows why and cannot be picked.

## What a Key May Do

- **Never more than its owner.** The permissions of a key are cut to what its owner may do in the tenant of the key at every request. A key of a platform admin can hold any permission, a key of a user without a group there can do nothing.
- **It follows the group.** When the group of the owner loses a permission, the key loses it too. The panel lists it as paused, and the key may use it again once the group allows it.
- **Nobody hands out more than they may do.** Creating a key or giving an existing one a new permission needs your own group to allow it too. What a key holds already stays when someone else edits its name or end.
- **No platform admin bypass.** A key only ever uses the permissions it holds, even when its owner is a platform admin, and never does what only a platform admin may, like restoring a configuration backup or downloading the database.
- **Rights of the platform only where they belong.** With [tenants](/user-guide/admin/tenants), a key carries what a platform group gives on the platform only as listed under [Platform Keys](#platform-keys), never the settings of the instance through it, the sign-in providers or what only a platform admin does. The settings of the instance the owner's group in the home tenant gives still count in a key of the home tenant, as before tenants, and never in a key of a customer's tenant, which keeps the tenant settings of its own tenant.

## Platform Keys

An MSP automates its tenants with keys of its own. Two kinds of rights of the platform can go into a key, each only in one place:

| Area | Permissions | Offered in | For |
| :--- | :--- | :--- | :--- |
| **Tenants** | `platform-tenants:read`, `platform-tenants:write` | The home tenant | Listing, creating, renaming and deleting tenants, their settings, members and invitations, see [Managing Tenants through the API](/user-guide/admin/tenants#through-the-api) |
| **Accounts** | `platform-accounts:read`, `platform-accounts:write` | The home tenant | The accounts of the tenants the owner reaches |
| **Sharing** | `platform-sharing:read`, `platform-sharing:write` | A tenant that [shares with customers](/user-guide/admin/shared-databases#tenants-that-share), while there is another tenant | Giving databases, destinations and channels to customers, see [Shared Databases](/user-guide/admin/shared-databases#through-the-api) |

- The editor offers **Tenants** and **Accounts** only in the home tenant and only to an owner who holds one of their rights, a platform admin or someone whose [platform group](/user-guide/admin/tenants#platform-groups) gives it. What the owner does not hold stays locked.
- The list marks such a key **Platform**, in its row, on its card and in its panel.
- A key never gets more than its owner, also here. When the owner loses the right, or their platform group, the key loses it at its next request.
- A key **reaches what its owner reaches.** The key of someone whose platform group reaches some tenants manages those tenants only, every other one reads as gone, and creates no tenant, exactly like its owner on **Platform → Tenants**. The key of a platform admin reaches every tenant.
- A key made in a customer's tenant never carries a right on the tenants or the accounts, whatever it stores. It may manage the members and invitations of its own tenant with `users:read` and `users:write`.
- The pages under **Platform**, the sign-in providers, the configuration restore and the database download stay for a signed-in person and answer every key with `403`.

::: warning
A platform key changes customers. Give it only the area it needs, a short end, and rotate it when the person who made it leaves.
:::

## Manage Keys

Every action sits in the menu at the end of a row, in the right click menu and in the panel of a key.

- **Edit** changes the name, the end and the permissions. The secret stays, so scripts keep working, and the change applies to the next request.
- **Rotate** gives the key a new secret and shows it once. The old secret stops working at once. The dialog warns when the key was used within the last hour. Only the owner, or someone whose group may do everything the key may do, can rotate a key, since the new secret hands out its permissions.
- **Disable** and **Enable** switch a key off and on. An expired key cannot be enabled, edit it to give it a new end.
- **Delete** removes a key for good. The runs it started stay in History.

Select several keys in the table to enable, disable or delete them together.

## Authentication

Send the key in the `Authorization` header:

```bash
curl -X POST "https://backup.example.com/api/jobs/JOB_ID/run" \
  -H "Authorization: Bearer $DBACKUP_KEY"
```

| Status | Reason |
| :--- | :--- |
| `401 Unauthorized` | Unknown, disabled or expired key |
| `403 Forbidden` | The key, or the group of its owner, lacks the permission |

## Audit Trail

The **Audit log** records who created, edited, rotated, enabled, disabled or deleted a key. An edit lists the permissions it added and removed, a new key the task it started from.

A request made with a key that changes something, starts a job or downloads a backup writes an entry that names the key and its owner, and History shows the key as **Started by** of a run it started. Requests that only read are not logged. See [Audit Log](/user-guide/admin/audit-log).

::: tip
Give each script its own key with the task it needs. A key that leaks then does only that, and you can rotate it without touching the others.
:::

## Next Steps

- [Groups & Permissions](/user-guide/admin/permissions) - every permission by area
- [Webhook Triggers](/user-guide/features/webhook-triggers) - start a job from a script
- [API Reference](/user-guide/features/api-reference) - the endpoints a key can call
