# Google Drive

Store backups in Google Drive using OAuth 2.0 authentication. DBackup is the first to support a native cloud provider with browser-based authorization — no API keys or service accounts required.

## Overview

Google Drive integration provides:

- ☁️ Cloud backup storage with 15 GB free tier
- 🔐 OAuth 2.0 — one-click browser authorization
- 🔄 Automatic token refresh — no manual re-authorization
- 📁 Optional folder targeting — store in specific Drive folders
- 🔒 Scoped access — DBackup can only access files it created (`drive.file` scope)

## Prerequisites

::: warning Google Cloud Console Required
To use Google Drive as a storage destination, you need a **Google Cloud Console project** with the Drive API enabled and OAuth 2.0 credentials configured.

This is a one-time setup that takes about 5 minutes.
:::

### Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Navigate to **APIs & Services → Library**
4. Search for **Google Drive API** and click **Enable**

### Step 2: Configure OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. Select **External** (or Internal for Workspace users)
3. Fill in required fields:
   - **App name**: `DBackup` (or your preferred name)
   - **User support email**: Your email
   - **Developer contact**: Your email
4. Click **Save and Continue**
5. **Scopes**: Add `https://www.googleapis.com/auth/drive.file`
6. **Test users**: Add the Google account(s) that will authorize DBackup
7. Click **Save and Continue**

::: info Test Mode vs Production
While your app is in "Testing" status, only users you add as test users can authorize. For personal use this is fine — you don't need to publish the app.
:::

### Step 3: Create OAuth Credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Select **Web application**
4. **Name**: `DBackup`
5. **Authorized redirect URIs**: Add your DBackup callback URL:
   ```
   https://your-dbackup-domain.com/api/adapters/google-drive/callback
   ```
   For local development:
   ```
   http://localhost:3000/api/adapters/google-drive/callback
   ```
6. Click **Create**
7. Copy the **Client ID** and **Client Secret**

## Configuration

| Field | Description | Default |
| :--- | :--- | :--- |
| **Name** | Friendly name for this destination | Required |
| **Client ID** | OAuth 2.0 Client ID from Google Cloud Console | Required |
| **Client Secret** | OAuth 2.0 Client Secret from Google Cloud Console | Required |
| **Folder ID** | Target Google Drive folder ID | Optional (root) |

### Finding a Folder ID

To store backups in a specific folder:

1. Open the folder in Google Drive in your browser
2. The URL looks like: `https://drive.google.com/drive/folders/1ABC123xyz...`
3. Copy the ID after `/folders/` — that's your Folder ID

Leave empty to store backups in the root of your Google Drive.

## OAuth Authorization

After saving your Google Drive destination with Client ID and Client Secret:

1. The UI shows an **amber authorization status** — "Authorization required"
2. Click **Authorize with Google**
3. Your browser opens Google's consent screen
4. Sign in and grant DBackup access to manage its own files
5. Google redirects back to DBackup
6. A **green success toast** confirms authorization
7. The status changes to **green** — "Authorized"

::: tip Re-Authorization
You can re-authorize at any time by clicking the **Re-authorize** button. This is useful if you want to switch Google accounts or if tokens become invalid.
:::

## How It Works

### Authentication Flow

```
User clicks "Authorize"
    → DBackup generates Google OAuth URL
    → Browser opens Google consent screen
    → User grants access
    → Google redirects with authorization code
    → DBackup exchanges code for refresh token
    → Refresh token stored encrypted in database
    → Access tokens generated on-the-fly (never stored)
```

### File Operations

- **Upload**: Creates files in the configured folder (or Drive root) using resumable media upload
- **Download**: Downloads files by resolving the folder path and filename
- **List**: Lists all backup files in the target folder recursively
- **Delete**: Permanently removes files from Google Drive
- **Read**: Reads small files (e.g., `.meta.json` sidecar files) as text

### Folder Structure

DBackup creates a folder hierarchy matching your job names:

```
Google Drive/
└── Your Folder (or Root)/
    └── job-name/
        ├── backup_2024-01-15T12-00-00.sql
        ├── backup_2024-01-15T12-00-00.sql.meta.json
        ├── backup_2024-01-16T12-00-00.sql.gz.enc
        ├── backup_2024-01-16T12-00-00.sql.gz.enc.meta.json
        └── ...
```

## Security

### Scoped Access

DBackup requests the `drive.file` scope, which means:
- ✅ Can create, read, modify, and delete **files it created**
- ❌ Cannot access your personal files, documents, or photos
- ❌ Cannot see files created by other apps

### Credential Storage

| Credential | Storage |
| :--- | :--- |
| Client ID | Encrypted in database (AES-256-GCM) |
| Client Secret | Encrypted in database (AES-256-GCM) |
| Refresh Token | Encrypted in database (AES-256-GCM) |
| Access Token | Never stored — generated on-the-fly |

### Token Management

- **Refresh tokens** are stored encrypted using your `ENCRYPTION_KEY`
- **Access tokens** have a 1-hour lifetime and are auto-refreshed
- Revoking access in [Google Account Settings](https://myaccount.google.com/permissions) immediately invalidates all tokens

## Storage Limits

| Plan | Storage |
| :--- | :--- |
| Free (Google) | 15 GB (shared with Gmail, Photos) |
| Google One 100 GB | 100 GB |
| Google One 200 GB | 200 GB |
| Google One 2 TB | 2 TB |
| Google Workspace | 30 GB – unlimited |

::: warning Shared Storage
The 15 GB free tier is shared across Gmail, Google Drive, and Google Photos. Check your storage usage at [one.google.com/storage](https://one.google.com/storage).
:::

## Troubleshooting

### "Authorization required" after save

You need to complete the OAuth flow after saving the adapter. Click **Authorize with Google** to start.

### "redirect_uri_mismatch" error

The redirect URI in your Google Cloud Console doesn't match your DBackup URL. Ensure you've added:
```
https://your-domain.com/api/adapters/google-drive/callback
```

### "access_denied" error

- Check that you've added your Google account as a **test user** in the OAuth consent screen
- Or publish your OAuth app for production use

### Token expired / invalid

Click **Re-authorize** in the adapter settings. Google may revoke tokens if:
- The app has been unused for 6 months
- You revoked access in Google Account Settings
- The OAuth consent screen is in testing mode and the 7-day test token expired

### Quota exceeded

Google Drive API has a default quota of 20,000 requests per 100 seconds. This is more than sufficient for backup operations. If you hit quota limits, check your Google Cloud Console quotas page.

## Limitations

- **File size**: Google Drive supports up to 5 TB per file
- **API quotas**: 20,000 requests per 100 seconds per project (default)
- **Test mode tokens**: Expire after 7 days if OAuth app is not published
- **Shared storage**: Free tier shares 15 GB with other Google services
- **No server-side encryption**: Use DBackup's built-in encryption profiles for end-to-end encryption
