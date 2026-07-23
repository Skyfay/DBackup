# Google Drive

Store backups in Google Drive using OAuth 2.0 authentication. Works with personal Gmail and Google Workspace accounts.

## Prerequisites

You need a Google Cloud project with the Drive API enabled (one-time setup):

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create a new project (or select existing)
2. Enable the **Google Drive API**: Go to **APIs & Services** → **Library** → search "Google Drive API" → **Enable**
3. Configure the **OAuth consent screen**: Go to **APIs & Services** → **OAuth consent screen**
   - Select **External** (or Internal for Workspace)
   - Fill in the required fields (app name, support email)
   - Add scope: `https://www.googleapis.com/auth/drive.file`
   - Add your email as a **test user** (required while app is in "Testing" status)
4. Create **OAuth credentials**: Go to **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**
   - Application type: **Web application**
   - Add **Authorized redirect URI**:
     ```
     https://your-dbackup-url/api/adapters/google-drive/callback
     ```
   - Copy the **Client ID** and **Client Secret**

::: warning Testing Mode
While your OAuth consent screen is in "Testing" mode, only users listed as test users can authorize. This is fine for self-hosted use - no need to publish the app.
:::

## Configuration

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Name** | Friendly name for this destination | - | ✅ |
| **Client ID** | Google OAuth Client ID | - | ✅ |
| **Client Secret** | Google OAuth Client Secret | - | ✅ |
| **Folder ID** | Google Drive folder ID for backups | Root | ❌ |

::: tip Finding the Folder ID
Open the target folder in Google Drive - the Folder ID is the last part of the URL:
`https://drive.google.com/drive/folders/`**`1AbCdEfGhIjKlMnOpQrStUv`**
:::

## Setup Guide

1. Go to **Connections** → **Backup Destinations** → **Add New** → **Google Drive**
2. Enter Client ID and Client Secret → **Save**
3. Click **Authorize with Google** - you'll be redirected to Google
4. Sign in and grant DBackup access to manage its files
5. After redirect, the status changes to **green** ("Authorized")
6. (Optional) Enter a **Folder ID** to store backups in a specific folder
7. Click **Test** to verify the connection

## How It Works

- **OAuth tokens** refresh automatically - no manual re-authorization needed
- Uses the `drive.file` scope - DBackup can only access files it created (not your entire Drive)
- Files ≤ 5 MB use simple upload; larger files use resumable upload
- All credentials (Client ID, Client Secret, Refresh Token) are stored AES-256-GCM encrypted

## Troubleshooting

### "redirect_uri_mismatch" Error

The redirect URI in Google Cloud Console doesn't match your DBackup URL exactly. Go to **Credentials** → your OAuth client → **Authorized redirect URIs** and ensure it's `https://your-domain.com/api/adapters/google-drive/callback`.

### "access_denied" or 403

Common causes:
- Your email is not listed as a **test user** in the OAuth consent screen
- The Drive API is not enabled for the project
- The OAuth consent screen is not configured

### Token Expired / Invalid

Click **Re-authorize** in DBackup. Tokens may be invalidated if you revoked access in [Google Account Permissions](https://myaccount.google.com/permissions) or changed the OAuth client configuration.

### Quota Exceeded

Google Drive has usage limits. Free accounts get 15 GB shared across Gmail, Drive, and Photos. Use [Retention Policies](/user-guide/jobs/retention) to auto-delete old backups.

## Next Steps

- [Enable Encryption](/user-guide/security/encryption)
- [Configure Retention](/user-guide/jobs/retention)
- [Storage Explorer](/user-guide/features/storage-explorer)
