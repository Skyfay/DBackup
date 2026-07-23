# Microsoft OneDrive

Store backups in Microsoft OneDrive using OAuth 2.0 authentication. Supports personal Microsoft accounts and Microsoft 365 (organizational) accounts.

## Prerequisites

You need an Azure App Registration to enable the Microsoft Graph API (one-time setup):

1. Go to [Azure App Registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click **New registration**
3. Set **Supported account types** to **"Accounts in any organizational directory and personal Microsoft accounts"**
4. Set **Redirect URI** (Platform: Web):
   ```
   https://your-dbackup-url/api/adapters/onedrive/callback
   ```
5. Under **API permissions**, add Microsoft Graph delegated permissions:
   `Files.ReadWrite.All`, `User.Read`, `offline_access`
6. Under **Certificates & secrets**, create a new client secret and **copy the Value immediately** (shown only once)
7. Copy the **Application (client) ID** from the Overview page

::: danger Don't Confuse the IDs
The Overview page shows three IDs - use **Application (client) ID** only. Do not use Directory (tenant) ID or Object ID. For secrets, copy the **Value** column, not the Secret ID.
:::

<details>
<summary>Personal account? Azure tenant required</summary>

Even with an Outlook/Hotmail account, you must register once at [Azure Portal](https://portal.azure.com/) to create a tenant. If you see "No Azure Tenant found", complete the free setup wizard first. No payment required.

</details>

<details>
<summary>AADSTS700025 / userAudience error</summary>

Your App Registration has the wrong account type. Fix it:
1. Go to App Registration → **Manifest**
2. Set `"signInAudience"` to `"AzureADandPersonalMicrosoftAccount"`
3. Save

Or recreate the App Registration with the correct setting (third option).

</details>

## Configuration

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **Name** | Friendly name for this destination | - | ✅ |
| **Client ID** | Application (client) ID from Azure Portal | - | ✅ |
| **Client Secret** | Client secret **Value** from Azure Portal | - | ✅ |
| **Folder Path** | Target folder path (e.g. `/Backups/DBackup`) | Root | ❌ |

## Setup Guide

1. Go to **Connections** → **Backup Destinations** → **Add New** → **Microsoft OneDrive**
2. Enter Client ID and Client Secret → **Save**
3. Click **Authorize with Microsoft** - you'll be redirected to Microsoft
4. Sign in and accept the requested permissions
5. After redirect, the status changes to **green** ("Authorized")
6. (Optional) Use the **Folder Browser** (📂) to select a subfolder
7. Click **Test** to verify the connection

## How It Works

- **OAuth tokens** refresh automatically - no manual re-authorization needed
- Files ≤ 4 MB use simple PUT upload; larger files use upload sessions (10 MB chunks)
- All credentials (Client ID, Client Secret, Refresh Token) are stored AES-256-GCM encrypted
- Access tokens are short-lived (~1 hour) and never stored - refreshed on-the-fly

::: warning Client Secret Expiration
Azure client secrets expire (max 24 months). Set a calendar reminder - Azure does not send expiration notifications for personal accounts. When expired, create a new secret in Azure Portal and update DBackup.
:::

## Troubleshooting

### "redirect_uri_mismatch"

The redirect URI in Azure doesn't match your DBackup URL exactly. Check in App Registration → **Authentication** → **Redirect URIs**. Protocol (`http` vs `https`) and trailing slashes must match.

### AADSTS7000215 / invalid_client

Common causes:
- Copied the **Secret ID** instead of the **Value** - recreate the secret and copy the correct column
- Secret expired - check expiration date in Azure Portal
- Wrong Client ID - ensure you're using Application (client) ID

### Token Expired / Invalid

Click **Re-authorize** in DBackup. Tokens may be invalidated if you revoked access in [Microsoft Account Permissions](https://account.live.com/consent/Manage) or if the client secret expired.

### Empty Folder Browser

Ensure `Files.ReadWrite.All` permission is granted, the OAuth authorization is complete, and for organizational accounts that admin consent was given.

## Next Steps

- [Enable Encryption](/user-guide/security/encryption)
- [Configure Retention](/user-guide/jobs/retention)
- [Storage Explorer](/user-guide/features/storage-explorer)
