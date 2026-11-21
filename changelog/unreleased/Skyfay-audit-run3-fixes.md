> ⚠️ **Before updating:** `TRUSTED_PROXIES` trusts only a reverse proxy on the same machine by default. A proxy in a Docker network or the LAN needs its address or `private` in `TRUSTED_PROXIES`, or every request counts as one from the address of the proxy.

### 🔒 Security

- **rsync**: A connection config can no longer set the address ssh dials or the options of the host key check itself, which could run a command on the DBackup server. Fields of that kind are refused when a connection is saved or tried.
- **Azure SQL**: A stored config can no longer move the connection into an SSH mode the adapter does not have.
- **Database Explorer**: The table browser of a connection form dials the checked address of a tenant that blocks the local network, like every other read.
- **tenants**: The saved login of a destination shared with customers no longer signs in at a host named in the test, SSH test, database list or snapshot check of a form.
- **tenants**: A write through the view of a customer fails once the destination is no longer shared with it, so a restore that outlives the share leaves nothing in the folder of the provider.
- **tenants**: Deleting a tenant also locks the accounts of no tenant whose email its sign-in provider claims. A new user whose group is deleted while it is made is removed again.
- **audit**: The entry of a bulk delete of users names the tenants of the accounts, so a view that does not reach them hides it.
- **config restore**: A configuration file from before the tenants no longer makes an existing account that is no platform admin one, and leaves it out with a note instead.
- **config backup**: A key the configuration backup was encrypted with before stays locked like the current one once another key is picked.
- **restore**: A restore to the original folder counts only when the index of the backup is the one its run recorded. A backup made before this record goes back there for a platform admin alone.
- **setup**: A configuration backup uploaded at the first start unpacks to at most 2 GB, and only the last one checked is held.
- **Recovery Kit**: The recovery script reads link paths with backslashes the way Linux and macOS do, and removes a link it laid that points out of the output folder.
- **file backups**: Exclude patterns with braces count every pattern they expand to, and one list stands for at most 256 patterns with a slash, brackets or braces. A restore takes only exclude patterns a save would take.
- **backup**: A run that takes longer than the longest a run may take fails, also while it still reports progress, so one slow source cannot hold the runs of every tenant. The time is one day by default and set in Settings > General.
- **server**: Without `TRUSTED_PROXIES` only a reverse proxy on the same machine is trusted, so a device of the local network can no longer name its own address for the rate limits and the audit log.
- **SSO**: A provider of the platform links an account of no tenant whose email the provider of a customer claims only from the profile of that account.
- **SSO**: A sign-in through a provider no longer marks an email the owner of the account set themselves as verified, so the provider links no other identity to that account by its email.
- **SSO**: The fetches of a sign-in through the provider of a tenant that blocks the local network dial only checked addresses. An issuer with a wildcard or a user part is refused and never trusted.
- **SSH**: A private key with a passphrase is unlocked once per process instead of at every connect, so a key that is slow to unlock no longer holds up the server at every health check.
- **Firebird**: Backups and reads attach without the triggers of the database where the login may skip them, so a trigger a customer writes on a shared server never runs with the login of the provider.
- **PostgreSQL**: Queries of the catalog inside a database run with the catalog alone on the search path, so the owner of a database cannot hand functions of their own to the login of the provider.
- **audit**: The CSV export quotes a cell with a semicolon or a tab, so no spreadsheet starts a formula from it.
- **storage**: The PowerShell command of a download link escapes typographic quotes in the file name.
- **storage**: At most two checks of a backup download it at once, and a check of a known size first makes sure the temporary folder has the space free.
- **restore**: Trying a key on a backup waits for its share of memory like every other read of the index, so many tries at once no longer fill the memory of the server.
- **Docker Volumes**: A run without SSH reads no volume that holds the folder of a Local Filesystem destination shared with customers.
- **tenants**: A customer gets only the backups of a shared server that a run in the History of its tenant wrote, never a file at the destination by its sidecar alone.

### 🔄 Changed

- **file backups**: A run leaves out an exclude pattern that is too slow to match, saved before this version, with a warning in its log instead of failing the backup.

### 🐛 Bug Fixes

- **storage**: A backup takes the job, server and lock of the sidecar beside it, also when a backup of the same name lies in another folder.
- **rate limits**: The limits saved in Settings count from the next request on, also when DBackup serves HTTPS with its own certificate, where the defaults applied before.
