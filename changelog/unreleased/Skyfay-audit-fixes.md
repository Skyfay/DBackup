> ⚠️ **Before updating:** A reverse proxy that sends only `X-Real-IP` and no `X-Forwarded-For` now needs `TRUSTED_PROXY_HEADER=x-real-ip`, otherwise the audit log and the rate limits see the address of the proxy.

### 🔒 Security

- **Docker**: A job's source names exactly one Docker volume, so a path like `/etc` no longer reaches folders of the host. A backup never stops the container DBackup runs in.
- **templates**: A naming pattern names one file, so a slash or a leading dot in it no longer writes or deletes files outside the folder of the run.
- **restore**: A configuration backup at a destination opens only with the key of the configuration backup or a key the admin picks, never with any other key of the Vault. A restore that brings back no account is refused.
- **auth**: Adding a passkey needs a recent sign-in, and Reset 2FA also removes the passkeys of the account. Turning off a passkey as the second factor asks for the current password.
- **auth**: The current password can no longer be checked from the browser outside the settings that ask for it, and showing the authenticator secret needs the right to manage it.
- **SSO**: The link that ends connecting a provider in the profile only accepts a token DBackup made, so a crafted link no longer signs someone out.
- **notifications**: The generic webhook escapes names and messages for the Content-Type of its template, so a name can no longer change the payload. Teams shows names as plain text, never as links.
- **notifications**: The custom headers of the generic webhook are stored encrypted and are no longer shown to someone who may only see the channel.
- **restore**: A restore never writes through a link that already stands at a file's name or in a folder below the restore folder.
- **auth**: The address of the client only counts when DBackup runs on its own server, so a client can no longer choose the address of the rate limits and the audit log.

### 🔄 Changed

- **server**: `TRUSTED_PROXY_HEADER` names the header the trusted proxy writes, `x-forwarded-for` by default or `x-real-ip`, and the other header is ignored.
- **server**: `pnpm start` runs the server of the Docker image instead of `next start`.

### 🎨 Improvements

- **restore**: A restore of an older whole-file backup stops when the temp folder runs out of space instead of filling it, and large archive indexes are read one at a time.

### 🔧 CI/CD

- **Docker**: The image takes the Prisma CLI from the lockfile, pins SqlPackage and keeps everything root runs out of reach of the app's user. The build leaves out every `.env` file except `.env.example`, and the build caches of TypeScript.
