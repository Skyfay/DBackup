> ⚠️ **Before updating:** `TRUSTED_PROXIES` trusts only a reverse proxy on the same machine by default. A proxy in a Docker network, on the host in front of the container or in the LAN needs its address or `private` in `TRUSTED_PROXIES`, or every request counts as one from the address of the proxy.

### 🔒 Security

- **rsync**: A connection config can no longer set the address ssh dials or the options of the host key check itself, which could run a command on the DBackup server. Fields of that kind are refused when a connection is saved or tried.
- **Azure SQL**: A stored config can no longer move the connection into an SSH mode the adapter does not have.
- **config backup**: A key the configuration backup was encrypted with before stays locked like the current one once another key is picked.
- **setup**: A configuration backup uploaded at the first start unpacks to at most 2 GB, and only the last one checked is held.
- **Recovery Kit**: The recovery script reads link paths with backslashes the way Linux and macOS do, and removes a link it laid that points out of the output folder.
- **backup**: A backup that takes longer than the longest a run may take fails, also while it still reports progress, so one slow source cannot hold the runs of everyone else. The time is one day by default and set in Settings > General.
- **server**: Without `TRUSTED_PROXIES` only a reverse proxy on the same machine is trusted, so a device of the local network can no longer name its own address for the rate limits and the audit log.
- **SSO**: A sign-in through a provider no longer marks an email the owner of the account set themselves as verified, so the provider links no other identity to that account by its email.
- **SSO**: An issuer with a wildcard, a question mark or a user part is refused when a provider is saved and never trusted.
- **SSH**: A private key with a passphrase is unlocked once per process instead of at every connect, for SSH logins and SFTP destinations alike, so a key that is slow to unlock no longer holds up the server at every health check.
- **Firebird**: Backups and reads attach without the triggers of the database where the login may skip them, so a trigger of the database never runs with the login of DBackup.
- **PostgreSQL**: Queries of the catalog inside a database run with the catalog alone on the search path, and the Database Explorer names every function and operator of its reads in `pg_catalog`. The owner of a database cannot hand functions of their own to the login of DBackup that way.
- **audit**: The CSV export quotes a cell with a semicolon or a tab, so no spreadsheet starts a formula from it.
- **storage**: The PowerShell command of a download link escapes typographic quotes in the file name.
- **storage**: At most two checks of a backup download it at once, and a check of a known size first makes sure the temporary folder has the space free.
- **restore**: Trying a key on a backup waits for its share of memory like every other read of the index, so many tries at once no longer fill the memory of the server.

### 🧪 Tests

- **SSO**: An end-to-end test signs in through the provider of a tenant that blocks the local network, refused until the range of the provider is allowed.

### 🐛 Bug Fixes

- **storage**: A backup takes the job, server and lock of the sidecar beside it, also when a backup of the same name lies in another folder.
- **rate limits**: The limits saved in Settings count from the next request on, also when DBackup serves HTTPS with its own certificate, where the defaults applied before.
