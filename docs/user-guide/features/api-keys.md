# API Keys

API keys let scripts, CI/CD pipelines and monitoring tools call the DBackup API without a browser session.

## Overview

- A key starts with `dbackup_`, followed by 60 hex characters. DBackup stores only a scrypt hash of it and shows the key once, right after it was created or rotated.
- A key **acts as its owner**, the user who created it. It never gets more than the group of its owner may do, checked at every request.
- A new key **runs out after 90 days** unless you pick another end or Never.
- A key can be disabled and enabled again, rotated to a new secret, or deleted.

## The API Keys Tab

**Users & Groups → API keys** lists every key. The strip above the list counts the keys and names the ones that run out within two weeks, were never used, may do more than read, and who owns them.

- Search finds a key by its name or by the start of its secret, like `dbackup_4f1a9c0e`.
- **All**, **Active**, **Runs out soon**, **Disabled** and **Expired** filter by state, **Owner** by the user who created it. **Runs out soon** is marked amber while a key runs out within two weeks.
- The view switch shows the keys as a table or as cards. A phone always gets the cards.
- A key that runs out within two weeks is marked amber, an expired one red.

Click a key to open its panel: what it may do in words and by area, when it was last used and runs out, whose permissions it uses, when it was last rotated, the last runs it started and a first request with the key read from `$DBACKUP_KEY`.

## Create an API Key

1. Open **Users & Groups → API keys** and click **New API key**
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

- **Never more than its owner.** The permissions of a key are cut to what the group of its owner may do at every request. A key of a SuperAdmin can hold any permission, a key of a user without a group can do nothing.
- **It follows the group.** When the group of the owner loses a permission, the key loses it too. The panel lists it as paused, and the key may use it again once the group allows it.
- **Nobody hands out more than they may do.** Creating a key or giving an existing one a new permission needs your own group to allow it too. What a key holds already stays when someone else edits its name or end.
- **No SuperAdmin bypass.** A key only ever uses the permissions it holds, even when its owner is a SuperAdmin.

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
