# Recently Deleted

A deleted encryption key, saved login, connection, job or user is not gone at once. It waits under **Settings → Recently deleted** for 30 days, where it can be restored with everything that belonged to it or deleted for good.

## What a Delete Keeps

Every delete dialog of these five says where the record goes and until when it can come back. The record moves there with what belonged to it:

| Record | Comes back with |
| :--- | :--- |
| **Encryption key** | Its key, so the backups it encrypted open again |
| **Saved login** | Its secret |
| **Connection** | Its settings, its login links and the versions a database server ran |
| **Job** | Its destinations with their retention, its folders, its notifications and the link of its runs in History |
| **User** | Their password, second factor, passkeys, API keys and preferences |

What only belongs to the moment stays gone: a user's sessions end with the delete, and a connection starts its health checks and storage history anew.

A delete that other records still depend on is refused as before, like a key a job encrypts with or a login a connection uses.

### Delete Permanently

Someone who may change the settings sees **Delete it permanently now** in the delete dialog, to skip Recently deleted, like for a key or a login that leaked. The dialog turns red and names what is lost. A key deleted this way leaves every backup it encrypted unreadable unless a [recovery kit](/user-guide/security/recovery-kit) holds it. Everyone else deletes into Recently deleted only.

### Undo

After a delete a message offers **Undo** for a few seconds, which brings back what was just deleted. It works for several records deleted together as well. Undo brings back only your own delete of the last 5 minutes, anything else is restored from the list.

## The List

Go to **Settings → Recently deleted**. Every row names the record, what it was, who deleted it and when, and when it is gone. A record with 3 days or less left is marked in amber. The chips above the list show one kind at a time.

Only the kinds you may change show here:

| Kind | Needs |
| :--- | :--- |
| **Encryption key** | `vault:write` |
| **Saved login** | `credentials:delete` |
| **Connection** | Write access to its kind: `sources:write`, `destinations:write` or `notifications:write` |
| **Job** | `jobs:write` |
| **User** | `users:write`, and a SuperAdmin for a SuperAdmin's account |

The page needs `settings:read`, which shows the list without its buttons. **Restore** and **Delete permanently** need `settings:write` as well, like every change under Settings.

### Restore

**Restore** brings a record back under its own id, so jobs, backups and links that name it find it again. Tick several rows to restore them together.

- **A name taken meanwhile.** A key, login, connection or job whose name another one took, or a user whose email another account took, opens **Restore** with a field for another name or email.
- **Links that are gone.** A record whose links point to something deleted meanwhile comes back without them, and the message after the restore names each:

| Gone meanwhile | What the restore does |
| :--- | :--- |
| The encryption key of a job | The job comes back paused, since it would back up unencrypted |
| A destination or folder source of a job | The job comes back without it |
| The retention policy of a destination | The destination keeps every backup until a policy is picked again |
| The naming template or schedule preset of a job | The job uses the default file names or its own schedule |
| The login of a connection | The connection comes back without it, pick one again before it connects |
| The group of a user | The user comes back without a group and sees nothing until they get one |

### Delete for Good

**Delete permanently** in the menu of a row, or for several ticked rows, removes records before their time is up. It asks first and cannot be undone.

## How Long Records Stay

The time is **Deleted items** under [Data retention](/user-guide/admin/data-retention), 30 days by default. The **Clean old data** system task removes what stayed longer, every night.

## Audit Log

A delete into Recently deleted, a permanent delete, a restore and a removal from the list each write an entry, like "Deleted the job Shop nightly permanently" or "Restored the user Jana Keller from Recently deleted".

## API

The delete endpoints move a record to Recently deleted as well. Add `?permanently=true` to a single delete, or `"permanently": true` to the body of a bulk delete, to delete at once. That needs `settings:write` on top of the right to delete, or the request is refused with `403`:

```bash
curl -s -X DELETE "${BASE_URL}/api/jobs/${JOB_ID}?permanently=true" \
  -H "Authorization: Bearer ${API_KEY}"
```

This applies to `DELETE /api/jobs/{id}`, `/api/adapters/{id}` and `/api/credentials/{id}`, and to `POST /api/jobs/bulk`, `/api/adapters/bulk` and `/api/credentials/bulk`. Restoring works in the browser only.

## Next Steps

- [Data Retention & Database](/user-guide/admin/data-retention): how long every kind of record stays
- [Encryption](/user-guide/security/encryption): what a deleted key means for its backups
- [System Backup](/user-guide/features/system-backup): rebuild the whole configuration after a loss
