# First Steps

This guide walks you through your first login and setting up your first automated backup job.

## First Login

After installation, open [http://localhost:3000](http://localhost:3000) in your browser.

On first launch, you'll see a login page with a "Sign Up" option. This self-registration is **only available for the first user** and creates the administrator account.

Once logged in, you can use the **Quick Setup Wizard** (available in the sidebar under **Quick Setup**) to configure your first backup in a guided, step-by-step flow - this is the recommended approach for new users. It walks you through creating a database source, storage destination, optional encryption and notifications, and a backup job all in one place.

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
   - **Base Path**: `/backups`
5. Click **Test Connection**
6. Click **Save**

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
   - **Host**: `mysql.example.com` (or `host.docker.internal` for host machine)
   - **Port**: `3306`
   - **Primary Credential**: select the profile you created
6. Click **Test Connection**
7. Click **Save**

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
