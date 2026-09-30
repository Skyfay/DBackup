# System Backup (Meta-Backup)

Back up DBackup itself for disaster recovery.

## Overview

The configuration backup is a copy of the whole database of DBackup, compressed and encrypted with a key of the Vault. After a lost server it brings everything back as it was, including whatever a later version of DBackup adds to its database.

::: tip One deleted record
A restore always replaces the whole database, including what was added since the backup. To bring back a single deleted key, login, connection, job or user, use [Recently deleted](/user-guide/admin/recently-deleted) instead.
:::

## What's Included

| Data | Included |
| :--- | :--- |
| Connections, jobs with their destinations and folders, all templates | ✅ |
| Encryption keys and saved logins | ✅ |
| Users with their second factor and passkeys, groups, API keys | ✅ |
| Sign-in providers and settings | ✅ |
| The `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` of the instance | ✅ so a new server needs neither |
| Run history, audit log, notification and storage history | Only with **Include the history** |
| Sign-ins and caches | ❌ everyone signs in again after a restore |
| The backups themselves | ❌ they stay at their destinations |

## Configuration

### Automated System Backup

1. Go to **Settings → Configuration backup**
2. Switch on **Back up the configuration**
3. Pick:
   - **Destination**: where the file goes, into its folder `config-backups`
   - **Encryption key**: the file holds every login, so it is always encrypted
   - **Schedule**: when it runs, every day at 03:00 by default, picked like the schedule of a job
   - **Keeps**: how many files stay at the destination, 10 by default
   - **Include the history**: runs, logs, the audit log and the storage history, on by default
4. Click **Save changes** in the bar at the foot

The system task **Configuration backup** follows this switch and this schedule, so both are set in one place. The top of the part shows when the configuration was last backed up and where to, or why it failed.

::: warning Keep the key apart
Keep the [recovery kit](/user-guide/security/recovery-kit) of the key somewhere else than the backup. A lost server takes the Vault with it, and without the key the file cannot be opened.
:::

### A Backup Right Now

Click **Back up now** in the head of the part. It uses the saved settings, so save a change first. The backup shows on the Backups page as soon as it is uploaded, with you under **Started by**.

### The File

```
config-backups/config_backup_2026-09-29T03-00-00-000Z.db.gz.enc
config-backups/config_backup_2026-09-29T03-00-00-000Z.db.gz.enc.meta.json
```

The `.meta.json` beside it names the key and holds what its decryption needs. The Backups page lists both files of every destination under **Config backups**, and **Started by** says **Schedule**, the person behind **Back up now** or the API key that started it. **Name who started a backup in its metadata** under **Settings → Privacy** leaves out the name.

## Restore Process

Only a SuperAdmin restores a configuration, since it brings back users, groups and sign-in providers. The one exception is the sign-up page of a new DBackup, see [On a New Server](#on-a-new-server).

### What Happens

1. DBackup opens the file with the key its metadata names, or any key of the Vault that fits, and asks for one when none does
2. It checks the file: a database of DBackup, not damaged, and not from a newer version
3. It shows what the backup holds, then **Replace and restart** starts the restore
4. DBackup ends, and its container starts it again. The restored copy replaces the database before the migrations run, which bring an older copy up to date
5. Everyone signs in again, with an account of the backup

The database of before stays beside it as `dbackup.db.before-restore` in `/data/db`. A backup or restore that runs right now keeps the restore waiting until it has ended, since the restart would stop it. The restart needs a restart policy on the container, like `restart: always` in the compose file of the [installation](/user-guide/installation).

A backup made by a DBackup with another `ENCRYPTION_KEY` or `BETTER_AUTH_SECRET` works too: its logins and second factors are encrypted again for this one.

### From a Destination

1. Open **Backups** and find the backup under **Config backups**
2. Open it. DBackup reads it on the server, so its size does not matter
3. Check what it holds and click **Replace and restart**

### From a File

1. Go to **Settings → Configuration backup**
2. Click **Restore from a file**
3. Pick the backup file and its `.meta.json`
4. Check what it holds and click **Replace and restart**

The file can be up to 10 MB. A bigger one, for example with the history, is restored from its destination.

### On a New Server

1. Install a new DBackup. New values for `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` are fine
2. On the sign-up page, use **Or restore from a backup** instead of creating an account
3. Pick the backup file and its `.meta.json`, and paste the key from its recovery kit
4. Check what it holds, click **Restore and restart**, then sign in with an account of the backup

This works only while nobody has an account yet. For a file over 10 MB, create an account first, add the destination as a connection, and restore from the **Backups** page.

### Files of Older Versions

Files named `config_backup_*.json.gz.enc` come from DBackup versions before the copy of the database. They still restore, in parts from the **Backups** page or as a whole from a file. Restoring in parts exists for these files only and gets no new parts, since keeping it in step with every table cost more than it was worth. Such a restore adds and overwrites and never deletes: a record with the same ID, or the same name, is overwritten and keeps its ID here, and everything that links to it follows.

These files hold no templates, no folders of file jobs and no second factors. A restore drops what links to them, says so afterwards, and does this:

| The backup had | After the restore |
| :--- | :--- |
| A retention policy on a job destination | The destination keeps every backup until you pick a policy again |
| A file name template or a schedule preset on a job | The job uses the default file names or its own schedule |
| An encryption key on a job that is neither in the file nor in the Vault | The job is paused, so it does not back up unencrypted |
| Folders in a file backup job | The job backs up no folders until it gets them again |
| Two-factor sign-in for a user | It is off for that user until they set it up again |
| A job destination or an API key whose connection or user is missing | It is left out |

## Troubleshooting

### DBackup Does Not Come Back After a Restore

**Cause**: The container has no restart policy, so it stays stopped after DBackup ends.

**Solution**: Start the container. The restore waits for that and runs on the next start. Set `restart: always` or `unless-stopped` for the next time.

### The Backup Comes From a Newer DBackup

**Cause**: The copy knows database changes this version does not.

**Solution**: Update this DBackup to the version of the backup or later, then restore it.

### Cannot Decrypt Config

**Causes**: Wrong key, a key deleted from the Vault, or the `.meta.json` is missing.

**Solutions**:
1. Pick the `.meta.json` together with the backup
2. Paste the key from the recovery kit when DBackup asks for one

### Going Back to the Database Before a Restore

Stop DBackup. In `/data/db`, move the restored `dbackup.db` and its `-wal` and `-shm` files away, then rename `dbackup.db.before-restore` to `dbackup.db`, and its `-wal` and `-shm` files to `dbackup.db-wal` and `dbackup.db-shm` when they are there. Start DBackup again.

### Jobs Paused After a Restore of an Older File

**Cause**: Their encryption key was neither in the file nor in the Vault, and they would have backed up unencrypted.

**Solution**: Import the key under **Vault**, or pick another one in the job, then switch the job on again.

## Next Steps

- [Encryption Vault](/user-guide/security/encryption) - Manage encryption keys
- [Recovery Kit](/user-guide/security/recovery-kit) - Emergency decryption
- [Installation](/user-guide/installation) - Fresh deployment
