# Microsoft OneDrive

Store backups in Microsoft OneDrive using OAuth 2.0 authentication. Supports both personal Microsoft accounts and organizational (Microsoft 365 / Azure AD) accounts.

## Overview

OneDrive integration provides:

- ☁️ Cloud backup storage with 5 GB free tier (personal) or 1 TB+ (Microsoft 365)
- 🔐 OAuth 2.0 — one-click browser authorization via Microsoft Identity Platform
- 🔄 Automatic token refresh — no manual re-authorization
- 📁 Visual folder browser — browse and select target folders directly in the UI
- 📦 Large file support — chunked upload sessions for files > 4 MB (10 MB chunks)

## Prerequisites

::: warning Azure App Registration Required
To use OneDrive as a storage destination, you need an **Azure App Registration** with Microsoft Graph API permissions configured.

This is a one-time setup that takes about 5–10 minutes. Follow the steps carefully — several settings must be configured correctly for both personal and organizational accounts.
:::

### Step 1: Create an Azure Account (if needed)

If you already have an Azure account, skip to Step 2.

1. Go to [Azure Portal](https://portal.azure.com/)
2. Sign in with your Microsoft account (e.g., `you@outlook.com`, `you@hotmail.com`)
3. If prompted, complete the free Azure registration

::: danger Personal Accounts Need Azure Registration
Even with a personal Microsoft account (Outlook, Hotmail, Live), you **must register once** at the Azure Portal to create App Registrations. Simply having a Microsoft account is not sufficient — you need an Azure tenant.

If you see **"No Azure Tenant found"** or are asked to select a directory but none exists, visit [Azure Portal](https://portal.azure.com/) and complete the one-time setup wizard. This creates a default directory (tenant) linked to your personal account.
:::

### Step 2: Create an App Registration

1. Go to [Azure App Registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click **New registration**
3. Fill in:
   - **Name**: `DBackup` (or your preferred name)
   - **Supported account types**: Select **"Accounts in any organizational directory and personal Microsoft accounts"**
   - **Redirect URI**:
     - Platform: **Web**
     - URL: `https://your-dbackup-domain.com/api/adapters/onedrive/callback`
     - For local development: `http://localhost:3000/api/adapters/onedrive/callback`
4. Click **Register**

::: danger Correct Account Type Is Critical
You **must** select **"Accounts in any organizational directory and personal Microsoft accounts"** (the third option). Do **not** select:
- ❌ "Accounts in this organizational directory only" — won't work for personal accounts
- ❌ "Personal Microsoft accounts only" — may cause `userAudience` errors

If you already created the app with the wrong option, you can fix it:
1. Go to **Manifest** in the left sidebar
2. Find `"signInAudience"` and change it to `"AzureADandPersonalMicrosoftAccount"`
3. Click **Save**

Alternatively, delete the app registration and create a new one with the correct setting.
:::

### Step 3: Configure API Permissions

1. In your App Registration, go to **API permissions** in the left sidebar
2. Click **Add a permission**
3. Select **Microsoft Graph**
4. Select **Delegated permissions**
5. Search for and add:
   - `Files.ReadWrite.All` — Read and write all files
   - `User.Read` — Sign in and read user profile (usually pre-added)
   - `offline_access` — Maintain access to data (for refresh tokens)
6. Click **Add permissions**

::: info Admin Consent
For personal accounts, no admin consent is required. For organizational accounts, an admin may need to click **"Grant admin consent for [Organization]"**.
:::

### Step 4: Create a Client Secret

1. In your App Registration, go to **Certificates & secrets** in the left sidebar
2. Click **New client secret**
3. **Description**: `DBackup` (or any label)
4. **Expires**: Choose an expiration period (recommended: 24 months)
5. Click **Add**

::: danger Copy the Secret Value Immediately!
After clicking **Add**, the secret value is shown **only once**. You **must copy it immediately**.

The secrets table shows two values — make sure you copy the right one:

| Column | What it is | Use in DBackup? |
| :--- | :--- | :--- |
| **Value** (Wert) | The actual secret string | ✅ **Yes — copy this!** |
| **Secret ID** (Geheime ID) | A UUID identifier for the secret | ❌ No — this is just an internal ID |

If the Value column shows `***` (masked), you can **no longer retrieve it**. You must create a new secret.
:::

### Step 5: Copy Your Credentials

You need two values for DBackup:

| What | Where to find it |
| :--- | :--- |
| **Client ID** | App Registration → **Overview** → **Application (client) ID** |
| **Client Secret** | The **Value** you copied in Step 4 |

::: warning Don't Confuse the IDs!
The Overview page shows three different IDs:

| Field | Description | Use in DBackup? |
| :--- | :--- | :--- |
| **Application (client) ID** | Your app's unique identifier | ✅ **Yes — this is the Client ID** |
| **Directory (tenant) ID** | Your Azure tenant identifier | ❌ No |
| **Object ID** | Internal object reference | ❌ No |

Copy the **Application (client) ID** — not the Directory ID or Object ID.
:::

## Configuration

| Field | Description | Default |
| :--- | :--- | :--- |
| **Name** | Friendly name for this destination | Required |
| **Client ID** | Application (client) ID from Azure Portal | Required |
| **Client Secret** | Client secret **value** from Azure Portal | Required |
| **Folder Path** | Target folder path (e.g., `/Backups/DBackup`) | Optional (root) |

### Folder Browser

After authorizing OneDrive, you can use the **visual folder browser** to select a target folder:

1. Go to the **Configuration** tab in the adapter dialog
2. Click the **📂 Browse** button next to the Folder Path field
3. A dialog opens showing your OneDrive folder structure
4. **Single-click** a folder to select it
5. **Double-click** a folder to navigate into it
6. Use the **breadcrumb navigation**, **Home**, and **Up** buttons to navigate
7. Click **Select Folder** to set the path

The selected folder path is automatically filled in. Leave the field empty to use the root of your OneDrive.

## OAuth Authorization

After saving your OneDrive destination with Client ID and Client Secret:

1. The UI shows an **amber authorization status** — "Authorization required"
2. Click **Authorize with Microsoft**
3. Your browser opens Microsoft's consent screen
4. Sign in with your Microsoft account
5. Review the requested permissions and click **Accept**
6. Microsoft redirects back to DBackup
7. A **green success toast** confirms authorization
8. The status changes to **green** — "Authorized"

::: tip Re-Authorization
You can re-authorize at any time by clicking the **Re-authorize** button. This is useful if you want to switch Microsoft accounts or if tokens become invalid.
:::

## How It Works

### Authentication Flow

```
User clicks "Authorize"
    → DBackup generates Microsoft OAuth URL (/common/ endpoint)
    → Browser opens Microsoft consent screen
    → User grants access
    → Microsoft redirects with authorization code
    → DBackup exchanges code for refresh token
    → Refresh token stored encrypted in database
    → Access tokens generated on-the-fly (never stored)
```

### File Operations

- **Upload**: Simple PUT for files ≤ 4 MB, upload sessions with 10 MB chunks for larger files
- **Download**: Streaming download via `@microsoft.graph.downloadUrl`
- **List**: Lists all backup files in the target folder recursively
- **Delete**: Permanently removes files from OneDrive
- **Read**: Reads small files (e.g., `.meta.json` sidecar files) as text

### Upload Strategy

DBackup automatically chooses the optimal upload method:

| File Size | Method | Details |
| :--- | :--- | :--- |
| ≤ 4 MB | Simple PUT | Single request via Graph API |
| > 4 MB | Upload Session | Chunked upload with 10 MB chunks, progress tracking |

For upload sessions, the chunk size (10 MB) is a multiple of 320 KiB as required by the Microsoft Graph API.

### Folder Structure

DBackup creates a folder hierarchy matching your job names:

```
OneDrive/
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
| Client ID | Encrypted in database (AES-256-GCM) |
| Client Secret | Encrypted in database (AES-256-GCM) |
| Refresh Token | Encrypted in database (AES-256-GCM) |
| Access Token | Never stored — generated on-the-fly |

### Token Management

- **Refresh tokens** are stored encrypted using your `ENCRYPTION_KEY`
- **Access tokens** have a ~1-hour lifetime and are auto-refreshed
- Revoking access in [Microsoft Account App Permissions](https://account.live.com/consent/Manage) invalidates all tokens
- **Client secrets** have an expiration date — set a reminder to rotate them before they expire

### Microsoft Graph API Scopes

| Scope | Purpose |
| :--- | :--- |
| `Files.ReadWrite.All` | Read, create, update, delete files in OneDrive |
| `offline_access` | Obtain a refresh token for unattended access |
| `User.Read` | Read basic profile info (used during authorization) |

## Storage Limits

| Plan | Storage |
| :--- | :--- |
| Microsoft Account (free) | 5 GB |
| Microsoft 365 Basic | 100 GB |
| Microsoft 365 Personal | 1 TB |
| Microsoft 365 Family | 1 TB per person (up to 6) |
| Microsoft 365 Business | 1 TB – unlimited |

## Troubleshooting

### "Authorization required" after save

You need to complete the OAuth flow after saving the adapter. Click **Authorize with Microsoft** to start.

### "No Azure Tenant found" / Cannot access App Registrations

**Problem**: Your personal Microsoft account doesn't have an Azure tenant yet.

**Solution**: Go to [Azure Portal](https://portal.azure.com/) and complete the free registration. This creates a default directory (tenant) linked to your account. No payment is required — Azure App Registrations are free.

### AADSTS700025 / `userAudience` error

**Problem**: Your App Registration is configured for the wrong account type.

**Solution**:
1. Go to your App Registration in Azure Portal
2. Click **Manifest** in the left sidebar
3. Find `"signInAudience"` — it should be `"AzureADandPersonalMicrosoftAccount"`
4. If it's set to `"PersonalMicrosoftAccount"` or `"AzureADMyOrg"`, change it
5. Click **Save**

Alternatively, create a new App Registration and select **"Accounts in any organizational directory and personal Microsoft accounts"**.

### AADSTS7000215 / `invalid_client` error

**Problem**: The Client Secret is wrong or you copied the wrong value.

**Common mistakes**:
1. **Copied the Secret ID instead of the Value**: The secrets table has two columns. Use the **Value** column, not the **Secret ID** (UUID) column.
2. **Secret Value was truncated**: After creation, the Value is only shown once. If you navigate away and come back, it's masked (`***`). Create a new secret and copy the full value immediately.
3. **Wrong Client ID**: Make sure you're using the **Application (client) ID**, not the Directory (tenant) ID or Object ID.
4. **Secret expired**: Check the expiration date of your client secret in Azure Portal.

**Solution**: Create a new client secret, copy the full **Value** immediately, and update both Client ID and Client Secret in DBackup.

### "redirect_uri_mismatch" or consent screen doesn't redirect

**Problem**: The redirect URI in Azure doesn't match your DBackup URL.

**Solution**: In your App Registration → **Authentication** → **Web** → **Redirect URIs**, ensure you have:
```
https://your-domain.com/api/adapters/onedrive/callback
```
For local development:
```
http://localhost:3000/api/adapters/onedrive/callback
```

The URI must match exactly, including the protocol (`http` vs `https`) and any trailing slashes.

### Token expired / invalid after re-authorization

Click **Re-authorize** in the adapter settings. Microsoft may invalidate tokens if:
- You revoked access in [Microsoft Account App Permissions](https://account.live.com/consent/Manage)
- The client secret expired
- The App Registration was modified

### Client Secret Expiration

Azure client secrets have an expiration date (max 24 months). When a secret expires:
1. OneDrive backups will start failing with authentication errors
2. Go to Azure Portal → App Registrations → Certificates & secrets
3. Create a new client secret
4. Update the Client Secret in DBackup
5. Re-authorize with Microsoft

::: tip Set a Reminder
Set a calendar reminder before your client secret expires. Azure does not send expiration notifications for client secrets on personal accounts.
:::

### Empty folder browser

If the folder browser shows "No subfolders found":
- Ensure the `Files.ReadWrite.All` permission is granted in Azure Portal
- Check that you completed the OAuth authorization flow
- Try creating a folder manually in OneDrive first

### Upload failures for large files

DBackup automatically uses upload sessions for files larger than 4 MB. If uploads still fail:
- Check your OneDrive storage quota
- Ensure the `Files.ReadWrite.All` permission is granted
- Very large files (> 250 GB) are not supported by OneDrive

## Limitations

- **File size**: Up to 250 GB per file (OneDrive limit)
- **Client secret expiration**: Max 24 months — must be rotated periodically
- **Free storage**: 5 GB (Microsoft personal account)
- **No server-side encryption**: Use DBackup's built-in encryption profiles for end-to-end encryption
- **Path length**: OneDrive has a 400-character path length limit
