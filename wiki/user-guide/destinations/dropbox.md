# Dropbox

Store backups in Dropbox using OAuth 2.0 authentication. Dropbox provides a reliable cloud storage platform with generous free storage and simple setup.

## Overview

Dropbox integration provides:

- ☁️ Cloud backup storage with 2 GB free tier
- 🔐 OAuth 2.0 — one-click browser authorization
- 🔄 Automatic token refresh — no manual re-authorization
- 📁 Visual folder browser — browse and select target folders directly in the UI
- 📦 Large file support — chunked uploads for files > 150 MB

## Prerequisites

::: warning Dropbox App Console Required
To use Dropbox as a storage destination, you need a **Dropbox App** with an App Key and App Secret configured in the [Dropbox App Console](https://www.dropbox.com/developers/apps).

This is a one-time setup that takes about 3 minutes.
:::

### Step 1: Create a Dropbox App

1. Go to [Dropbox App Console](https://www.dropbox.com/developers/apps)
2. Click **Create app**
3. Choose **Scoped access**
4. Choose access type:
   - **App folder** — DBackup can only access its own folder (recommended for isolation)
   - **Full Dropbox** — DBackup can access your entire Dropbox (required if you want to choose a custom folder)
5. **Name your app**: `DBackup` (or your preferred name)
6. Click **Create app**

### Step 2: Configure Permissions

1. Go to the **Permissions** tab of your app
2. Enable the following scopes:
   - `files.metadata.read` — List folder contents
   - `files.metadata.write` — Create folders
   - `files.content.read` — Download backup files
   - `files.content.write` — Upload backup files
   - `account_info.read` — Verify connection
3. Click **Submit** to save permissions

::: info Permission Changes
If you change permissions after a user has already authorized, they need to re-authorize for the new scopes to take effect.
:::

### Step 3: Configure OAuth Redirect URI

1. Go to the **Settings** tab of your app
2. Scroll to **OAuth 2** section
3. Under **Redirect URIs**, add your DBackup callback URL:
   ```
   https://your-dbackup-domain.com/api/adapters/dropbox/callback
   ```
   For local development:
   ```
   http://localhost:3000/api/adapters/dropbox/callback
   ```
4. Copy the **App Key** and **App Secret** from the Settings page

## Configuration

| Field | Description | Default |
| :--- | :--- | :--- |
| **Name** | Friendly name for this destination | Required |
| **App Key** | Dropbox App Key (Client ID) from App Console | Required |
| **App Secret** | Dropbox App Secret from App Console | Required |
| **Folder Path** | Target folder path (e.g. `/backups`) | Optional (root or app folder) |

### Folder Browser

After authorizing Dropbox, you can use the **visual folder browser** to select a target folder:

1. Go to the **Configuration** tab in the adapter dialog
2. Click the **📂 Browse** button next to the Folder Path field
3. A dialog opens showing your Dropbox folder structure
4. **Single-click** a folder to select it
5. **Double-click** a folder to navigate into it
6. Use the **breadcrumb navigation**, **Home**, and **Up** buttons to navigate
7. Click **Select Folder** to set the path

The selected folder path is automatically filled in. Leave the field empty to use the root of your Dropbox (or app folder, depending on access type).

## OAuth Authorization

After saving your Dropbox destination with App Key and App Secret:

1. The UI shows an **amber authorization status** — "Authorization required"
2. Click **Authorize with Dropbox**
3. Your browser opens Dropbox's consent screen
4. Sign in and grant DBackup access
5. Dropbox redirects back to DBackup
6. A **green success toast** confirms authorization
7. The status changes to **green** — "Authorized"

::: tip Re-Authorization
You can re-authorize at any time by clicking the **Re-authorize** button. This is useful if you want to switch Dropbox accounts or if tokens become invalid.
:::

## How It Works

### Authentication Flow

```
User clicks "Authorize"
    → DBackup generates Dropbox OAuth URL
    → Browser opens Dropbox consent screen
    → User grants access
    → Dropbox redirects with authorization code
    → DBackup exchanges code for refresh token
    → Refresh token stored encrypted in database
    → Access tokens generated on-the-fly via SDK (never stored)
```

### File Operations

- **Upload**: Creates files in the configured folder (simple upload up to 150 MB, chunked session upload for larger files)
- **Download**: Downloads files by resolving the full Dropbox path
- **List**: Lists all backup files in the target folder recursively
- **Delete**: Permanently removes files from Dropbox
- **Read**: Reads small files (e.g., `.meta.json` sidecar files) as text

### Folder Structure

DBackup creates a folder hierarchy matching your job names:

```
Dropbox/
└── Your Folder (or Root)/
    └── job-name/
        ├── backup_2024-01-15T12-00-00.sql
        ├── backup_2024-01-15T12-00-00.sql.meta.json
        ├── backup_2024-01-16T12-00-00.sql.gz.enc
        ├── backup_2024-01-16T12-00-00.sql.gz.enc.meta.json
        └── ...
```

## Security

### Credential Storage

| Credential | Storage |
| :--- | :--- |
| App Key (Client ID) | Encrypted in database (AES-256-GCM) |
| App Secret | Encrypted in database (AES-256-GCM) |
| Refresh Token | Encrypted in database (AES-256-GCM) |
| Access Token | Never stored — auto-refreshed by SDK |

### Token Management

- **Refresh tokens** are stored encrypted using your `ENCRYPTION_KEY`
- **Access tokens** are short-lived and auto-refreshed by the Dropbox SDK
- Revoking access in [Dropbox Connected Apps](https://www.dropbox.com/account/connected_apps) immediately invalidates all tokens

## Storage Limits

| Plan | Storage |
| :--- | :--- |
| Dropbox Basic (free) | 2 GB |
| Dropbox Plus | 2 TB |
| Dropbox Professional | 3 TB |
| Dropbox Business | 5 TB+ |

## Troubleshooting

### "Authorization required" after save

You need to complete the OAuth flow after saving the adapter. Click **Authorize with Dropbox** to start.

### "redirect_uri_mismatch" or similar redirect error

The redirect URI in your Dropbox App Console doesn't match your DBackup URL. Ensure you've added:
```
https://your-domain.com/api/adapters/dropbox/callback
```

### Token expired / invalid

Click **Re-authorize** in the adapter settings. Dropbox may invalidate tokens if:
- You revoked access in Dropbox Connected Apps settings
- The app permissions were changed

### Empty folder browser

If the folder browser shows "No subfolders":
- With **App folder** access: The browser only shows the app's dedicated folder
- With **Full Dropbox** access: Ensure the `files.metadata.read` permission is enabled

### Upload failures for large files

DBackup automatically uses chunked session uploads for files larger than 150 MB. If uploads still fail:
- Check your Dropbox storage quota
- Ensure `files.content.write` permission is enabled

## Limitations

- **File size**: Up to 350 GB per file (with chunked upload)
- **Free storage**: 2 GB (Dropbox Basic)
- **App folder mode**: Can only access the app's dedicated folder, not your entire Dropbox
- **No server-side encryption**: Use DBackup's built-in encryption profiles for end-to-end encryption
