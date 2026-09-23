# First Steps

This guide walks you through your first login and setting up your first automated backup job.

## First Login

After installation, open [http://localhost:3000](http://localhost:3000) in your browser.

On first launch, you'll see a login page with a "Sign Up" option. This self-registration is **only available for the first user** and creates the administrator account.

Once logged in, open **Quick Setup** in the sidebar to set up your first backup step by step. This is the recommended approach for new users.

## Quick Setup

The steps are listed on the left, and each one shows what it created as soon as it is done:

1. **Database** - pick the type, then fill in the same form as on the Connections page. Saving it moves on to the next step.
2. **Backup destination** - the same for the place the backups go.
3. **Encryption** (optional) - create a key in the Vault, or skip the step.
4. **Notifications** (optional) - add a channel that reports the runs, or skip the step.
5. **Backup job** - name the job, pick when it runs (every hour, every night, every week or a cron expression) and whether it backs up all databases of the server or only some.

Every step can take a connection or a key you already have instead, with **Use existing**. The times on the schedule cards are shown in your own time zone. The last page lists everything that was set up, says when the first run starts and can start it right away with **Run it now**.

The job keeps the last 10 backups, which you can change later on the job. Encryption and notifications only appear for users who may create them.

The sidebar shows **Quick Setup** while no database is set up. To keep it there afterwards, switch on **Always Show Quick Setup** in the settings.

If you prefer to configure everything manually, follow the steps below.

## Manual Setup Overview

A backup job in DBackup connects three things:

1. **Source** - The database to backup
2. **Destination** - Where to store the backup
3. **Schedule** - When to run the backup (optional)

Let's set up all three.

## Step 1: Add a Storage Destination

First, create a place to store your backups.

### Using Local Filesystem

1. Go to **Connections** in the sidebar, then the **Backup Destinations** tab
2. Click **Add New**
3. Select **Local Filesystem**
4. Configure:
   - **Name**: `Local Backups`
   - **Folder**: `/backups`
5. Click **Test connection**
6. Click **Create destination**

::: tip Docker Volume
When using Docker, `/backups` maps to your host's `./backups` folder via volume mount.
:::

## Step 2: Add a Database Source

Now add the database you want to backup.

### Example: MySQL Database

1. Create a `USERNAME_PASSWORD` credential profile in **Settings → Vault → Credentials** with your database user and password (see [Credential Profiles](/user-guide/security/credential-profiles))
2. Go to **Connections** in the sidebar, then the **Databases** tab
3. Click **Add New**
4. Select **MySQL**
5. Configure:
   - **Name**: `Production MySQL`
   - **How DBackup connects**: **Direct**
   - **Host**: `mysql.example.com` (or `host.docker.internal` for host machine)
   - **Port**: `3306`
   - **Login**: select the profile you created
6. Click **Test connection**
7. Click **Create database**

::: warning Permissions
Ensure your database user has `SELECT` and `LOCK TABLES` permissions for backup, and `CREATE` permission for restore operations.
:::

## Step 3: Create a Backup Job

Now connect source and destination in a job.

1. Go to **Jobs** in the sidebar
2. Click **Create Job**
3. In the **General** tab, configure:
   - **Name**: `Daily MySQL Backup`
   - **Source**: Select "Production MySQL"
   - **Databases**: Click **Load** to fetch available databases, then select which ones to back up - leave empty to back up all databases
4. In the **Destinations** tab, click **Add Destination** and select "Local Backups"
   - Each destination can have its own independent retention policy
   - You can add multiple destinations (e.g., local + S3) for redundancy

### Optional: Add Compression

In the **Advanced** tab: select a compression algorithm (Gzip or Brotli) from the Compression dropdown.

### Optional: Add Encryption

In the **Advanced** tab: select an Encryption Profile from the Encryption dropdown. Profiles are managed in the **Vault** (sidebar).

### Optional: Set Schedule

In the **General** tab, use the Schedule picker:
- **Simple mode**: Choose Hourly, Daily, Weekly, or Monthly and set the time
- **Cron mode**: Enter a raw cron expression (e.g., `0 2 * * *` for daily at 2:00 AM)

### Optional: Configure Retention

In the **Destinations** tab, expand a destination row and configure its retention policy:
- **Simple**: Keep last N backups
- **Smart (GFS)**: Grandfather-Father-Son rotation

## Step 4: Run Your First Backup

Time to test!

1. On the Jobs page, find your new job
2. Click the **▶ Run Now** button
3. Watch the live progress

### Monitor Progress

The execution view shows:

- **Current step** (Initialize → Dump → Upload → Complete)
- **Progress bar** with file size
- **Live logs** of the operation

### View Results

After completion:

1. Check **History** for execution details
2. Browse **Storage Explorer** to see your backup file
3. Verify the `.meta.json` sidecar file was created

## Step 5: Set Up Notifications (Optional)

Get alerted when backups complete or fail.

### Discord Webhook

1. Go to **Connections** in the sidebar, then the **Notifications** tab
2. Click **Add Notification**
3. Select **Discord Webhook**
4. Paste your webhook URL
5. Click **Test** to verify
6. Save

### Assign to Job

1. Edit your backup job
2. Go to the **Notify** tab
3. Select your notification channel from the dropdown
4. Set the **Notification Trigger** (Always, Success only, Failure only)
5. Save

## Next Steps

Congratulations! You've created your first automated backup. Now explore:

- [Encryption Vault](/user-guide/security/encryption) - Secure your backups
- [Retention Policies](/user-guide/jobs/retention) - Automatic cleanup
- [Storage Explorer](/user-guide/features/storage-explorer) - Browse and manage backups
- [Restore](/user-guide/features/restore) - Restore from backups
