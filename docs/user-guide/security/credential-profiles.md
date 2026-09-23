# Credential Profiles

Centralize the credentials your adapters use - usernames, passwords, SSH keys,
S3 access keys, API tokens, and SMTP logins - in one reusable, audited place.

## Overview

A **Credential Profile** is a named, type-tagged secret that adapters reference
instead of storing inline credentials in their own config. The same profile can
be reused across many adapters (e.g. one SSH key shared by 12 SFTP destinations),
which makes secret rotation a single edit instead of a 12-form chore.

```
Adapter Config (host, port, database, ...)
   │
   ├── primaryCredentialId ─→  Credential Profile (USERNAME_PASSWORD)
   └── sshCredentialId     ─→  Credential Profile (SSH_KEY)
```

Profiles live in **Settings → Vault → Credentials**. Encryption profiles live
in the same vault on a separate tab.

## Credential Types

Each profile has a fixed `type` that defines its payload shape. Adapters declare
which type they accept, and the credential picker filters the list accordingly.

| Type | Payload | Used by |
|---|---|---|
| `USERNAME_PASSWORD` | `username`, `password` | MySQL, MariaDB, Postgres, MongoDB, MSSQL, Redis, FTP, SMB, WebDAV |
| `SSH_KEY` | `username`, `authType` (`password` / `privateKey` / `agent`), and `password` / `privateKey` / `passphrase` depending on `authType` | SFTP, Rsync, and the SSH tunnel slot of any DB adapter |
| `ACCESS_KEY` | `accessKeyId`, `secretAccessKey` | S3 (AWS, generic, R2, Hetzner) |
| `TOKEN` | `token` | Gotify, ntfy, Telegram, Twilio |
| `SMTP` | `user`, `password` | Email |
| `WEBHOOK` | `url`, `authHeader` (optional) | Discord, Slack, Microsoft Teams, Generic Webhook |
| `OAUTH` | `clientId`, `clientSecret`, `refreshToken` (managed automatically after authorization) | Google Drive, Dropbox, Microsoft OneDrive |

::: info
The `OAUTH` profile type is managed automatically during the OAuth authorization flow - you do not need to fill the `refreshToken` field manually. After clicking **Authorize** in the adapter form, the token is stored in the vault and the picker updates automatically.
:::

Local Filesystem adapters do not use a credential profile.

## Creating a Profile

### Standalone

1. Open **Settings → Vault** and switch to the **Credentials** tab
2. Click **Create Profile**
3. Pick a credential **type**
4. Fill the type-specific fields (the form adapts to the chosen type)
5. Optional: add a description that helps you find it later
6. Click **Create**

### Inline from an adapter form

You can create a profile without leaving the source/destination dialog:

1. Open the adapter's create or edit dialog
2. Click **New** beside the **Login** field, or **Create new profile** at the bottom of its dropdown. For cloud drives the field is called **OAuth app**, for the SSH server **SSH login**.
3. The credential dialog opens stacked on top of the adapter form
4. Fill, save - the field picks the new profile and your adapter
   form keeps everything you already entered

This is the fastest path during initial setup or when you need a fresh secret
for a single adapter.

## Generating an SSH Keypair

An `SSH_KEY` profile does not need a key made somewhere else. Set **Auth method** to **Private Key**, switch **Private key** to **Generate a new keypair**, and DBackup creates one when you save.

| Field | Description | Default |
|---|---|---|
| **Key type** | `Ed25519`, `RSA 4096`, `ECDSA P-256`, or `ECDSA P-384`. Ed25519 unless the host is too old to accept it. | `Ed25519` |
| **Comment** | Written into the public key so it stays identifiable in `authorized_keys`. | `dbackup@<profile-name>` |
| **Key passphrase** | Optional. Encrypts the private key with `bcrypt` and `aes256-ctr`, the same way `ssh-keygen` does. Stored with the key so backups still run unattended. | empty |

The key is generated on the server in OpenSSH format, so the private half never reaches a browser and is stored encrypted like any other secret. After saving, the dialog shows the public key with a copy button and a `.pub` download. Install that line in `~/.ssh/authorized_keys` on the target host before running a backup through the profile.

The public key is not a secret, so it stays available afterwards. The **key** action on the profile row shows it again, along with the `SHA256:...` fingerprint that `ssh-keygen -lf` prints for the same key. Pasted keys get the same action wherever DBackup can read the public half from them.

To rotate, edit the profile and generate again. Every adapter referencing the profile picks up the new key on its next operation, so install the new public key on the host first.

::: warning Rsync cannot use a passphrase-protected key
The Rsync destination drives the OpenSSH client with `BatchMode=yes`, which has no way to answer a passphrase prompt. This applies to pasted encrypted keys just as much as generated ones. Everywhere else, SFTP and every SSH tunnel, a passphrase works.
:::

## Slots: `primary` vs `ssh`

Every adapter has up to two slots:

- **Primary slot** - the credential the adapter uses to authenticate against
  the target system (DB user, S3 access key, SMTP login, ...)
- **SSH slot** - only present on adapters that support an SSH tunnel
  (DB adapters with SSH mode, MSSQL file-transfer over SSH). Always uses
  `SSH_KEY` profiles.

The resolver writes credential payloads to the correct field aliases per
adapter:

- `USERNAME_PASSWORD` writes both `user` and `username` so DB-style and
  storage-style adapters all see the value.
- `SSH_KEY` in the SSH slot uses `ssh*`-prefixed keys (`sshUsername`,
  `sshPassword`, `sshPrivateKey`, ...) when the adapter also has a primary
  slot - so SSH credentials never collide with the primary credentials.
- `TOKEN` writes the same value to `token`, `appToken`, `accessToken`, and
  `botToken` so all token-using notification adapters see it.

## Editing and Rotating Secrets

Click the **Edit** action on a profile row to:

- Rename the profile
- Update the description
- **Rotate the secret payload** - all adapters referencing the profile
  immediately use the new value on their next operation, no per-adapter
  reconfiguration

Rotating a profile takes effect in real time. There is no caching layer.

## Reference Tracking and Safe Deletion

Each row shows the **References** count - the number of adapters that point
to this profile (in either slot). Deleting a profile that is still in use is
blocked with a `409 Conflict`; the dialog lists the adapters you need to
detach or reassign first.

Adapters whose required primary credential is missing (e.g. you deleted a
profile by force, or imported a config without profiles) are flagged as
**OFFLINE** with `lastError = "No credential profile assigned"` and surface
in an upgrade banner on the Sources/Destinations page.

## Permissions

Credential management uses a dedicated permission group, separate from the
adapter and encryption permissions:

| Permission | Allows |
|---|---|
| `CREDENTIALS.READ` | List and view sanitized profiles (no secret payload), including the public key of an SSH profile |
| `CREDENTIALS.WRITE` | Create and update profiles, including rotating the secret |
| `CREDENTIALS.DELETE` | Delete profiles (still subject to the reference check) |
| `CREDENTIALS.REVEAL` | View the decrypted secret payload via the eye action / API |

`REVEAL` is intentionally split from `READ` so you can let operators assign
credentials to adapters without exposing the raw secrets to them. Every
reveal is recorded in the audit log.

## Encryption at Rest

Profile payloads are stored AES-256-GCM encrypted in SQLite, using the same
system master key (`ENCRYPTION_KEY` env var) that protects adapter configs.
The plaintext only ever exists in memory during a runtime resolve or an
explicit reveal call.

## API

The full REST surface is documented in the [API Reference](/user-guide/features/api-reference)
under the `Vault` tag. The endpoints are:

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/credentials` | Optional `?type=` filter |
| `POST` | `/api/credentials` | Create |
| `GET` | `/api/credentials/{id}` | Sanitized |
| `PUT` | `/api/credentials/{id}` | Update / rotate |
| `DELETE` | `/api/credentials/{id}` | `409` if referenced |
| `GET` | `/api/credentials/{id}/usage` | List adapter references |
| `GET` | `/api/credentials/{id}/reveal` | Audited, requires `CREDENTIALS.REVEAL` |

## Related

- [Encryption Vault](/user-guide/security/encryption) - Manage backup encryption
  profiles in the same vault
- [Recovery Kit](/user-guide/security/recovery-kit) - Offline decryption tools
- [API Keys](/user-guide/features/api-keys) - Authenticate against the API
