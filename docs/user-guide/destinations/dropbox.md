# Dropbox

Store backups in Dropbox using OAuth 2.0 authentication.

## Prerequisites

You need a Dropbox App to enable API access (one-time setup):

1. Go to [Dropbox App Console](https://www.dropbox.com/developers/apps)
2. Click **Create app** → **Scoped access** → **App folder** (recommended)
3. Under **Permissions**, enable: `files.metadata.read`, `files.metadata.write`, `files.content.read`, `files.content.write`, `account_info.read`
4. Under **Settings** → **OAuth 2** → **Redirect URIs**, add:
   ```
   https://your-dbackup-url/api/adapters/dropbox/callback
   ```
5. Copy the **App Key** and **App Secret** from the Settings page

::: info App Folder Mode
Apps with "App folder" access can only read/write within their own folder (`/Apps/YourAppName/`). Choose "Full Dropbox" if you need custom folder paths.
:::

## Configuration

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Name** | Friendly name for this destination | - | ✅ |
| **App Key** | Dropbox App Key (Client ID) | - | ✅ |
| **App Secret** | Dropbox App Secret (Client Secret) | - | ✅ |
| **Folder Path** | Target folder within app folder | Root | ❌ |

## Setup Guide

1. Go to **Connections** → **Backup Destinations** → **Add New** → **Dropbox**
2. Enter App Key and App Secret → **Save**
3. Click **Authorize with Dropbox** - you'll be redirected to Dropbox
4. Sign in and grant DBackup access
5. After redirect, the status changes to **green** ("Authorized")
6. (Optional) Use the **Folder Browser** (📂) to select a subfolder
7. Click **Test** to verify the connection

## How It Works

- **OAuth tokens** refresh automatically - no manual re-authorization needed
- Files < 150 MB use simple upload; larger files use chunked upload (8 MB chunks)
- All credentials (App Key, App Secret, Refresh Token) are stored AES-256-GCM encrypted
- Access tokens are short-lived and never stored - refreshed on-the-fly

## Troubleshooting

### "redirect_uri_mismatch" Error

The redirect URI in your Dropbox App Console doesn't match your DBackup URL. Ensure it's set to `https://your-domain.com/api/adapters/dropbox/callback` exactly.

### Token Expired / Invalid

Click **Re-authorize** in the adapter settings. Tokens may be invalidated if you revoked access in [Dropbox Connected Apps](https://www.dropbox.com/account/connected_apps) or changed app permissions.

### Empty Folder Browser

With **App folder** access, the browser only shows the app's dedicated folder. With **Full Dropbox** access, ensure `files.metadata.read` permission is enabled.

### Insufficient Space

Dropbox free tier is 2 GB. Use [Retention Policies](/user-guide/jobs/retention) to auto-delete old backups, or upgrade your plan.

## Next Steps

- [Enable Encryption](/user-guide/security/encryption)
- [Configure Retention](/user-guide/jobs/retention)
- [Storage Explorer](/user-guide/features/storage-explorer)
