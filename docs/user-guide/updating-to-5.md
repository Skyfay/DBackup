# Updating to 5.0

Most installations update to 5.0 without doing anything. The first start keeps a copy of the database, moves everything into the tenant **Default** and keeps every login, session, job and backup.

The table below names the setups that need a look. Skip the rows that do not match yours and read the details of the rest.

## Before You Start

1. Back up the `db` folder, see [Backup Before Updating](/user-guide/installation#backup-before-updating), or take a [configuration backup](/user-guide/features/system-backup).
2. Pull the new image and start it. Leave it running until its log shows `All migrations have been successfully applied`, since a container stopped halfway leaves a migration marked as failed.

## Does It Affect You?

| If you | What to do |
| :--- | :--- |
| run DBackup behind a reverse proxy | Name the proxy in `TRUSTED_PROXIES`, also one on the host in front of the container. [Details](#reverse-proxy) |
| connect over SSH, SFTP or rsync | Nothing, unless one host name leads to several servers with their own host keys. [Details](#ssh-host-keys) |
| send email with STARTTLS | Set the channel to **None** where the mail server offers no STARTTLS. [Details](#email-with-starttls) |
| give people a group other than SuperAdmin | Check what their group may do now, some actions are for a platform admin alone. [Details](#groups-and-permissions) |
| use the API or API keys | Check scripts that read `viewerSuperAdmin`, fetch the recovery kit or save connections. [Details](#api-and-api-keys) |
| sign in through SSO | Nothing for most. A provider links an account by an email an admin set. [Details](#single-sign-on) |
| have backups that run longer than a day | Raise **Fail a run that takes longer than** under **Settings → General**. [Details](#long-backups) |
| back up folders or Docker volumes | Check exclude patterns, restores and the folders of jobs. [Details](#folders-and-docker-volumes) |
| back up from the server DBackup runs on | Only a platform admin changes such connections from now on. [Details](#connections-to-the-server-dbackup-runs-on) |
| send notifications or write to WebDAV through a redirect | Enter the final address. [Details](#redirects) |
| use SMB | Check logins with `%` and paths with `;` or `"`. [Details](#smb) |
| run DBackup outside the Docker image | Check the versions of the client tools. [Details](#client-tools) |

## What Changes by Itself

The update moves the whole instance into the home tenant:

- Everything DBackup holds becomes the tenant **Default**, and every user with a group a member of it with that group. A user without a group stays without one.
- The SuperAdmin group becomes **Admin**, the group with every permission, and its members become platform admins. A group already named Admin is renamed **Admin (before update)** and keeps its members and permissions.
- Every API key belongs to Default and keeps its permissions. A key with `settings:read` or `settings:write` also gets `tenant-settings:read` or `tenant-settings:write`.
- Every sign-in provider becomes a provider of the platform.
- Sessions, passwords, passkeys, second factors and the settings of the instance stay as they are, so nobody has to sign in again.
- Changing the host, port, SSH server or URL of a connection asks for its password, key or token again, or a saved login.
- The configuration restore opens only an encrypted file at a destination. Download an unencrypted file of an older version and upload it under **Settings → Configuration backup** instead.

## Details

### Reverse Proxy

`TRUSTED_PROXIES` trusts only a proxy on the same machine by default, no longer every private network. A proxy in a Docker network or the LAN needs its address or `private`, and so does one on the host in front of the container, which reaches it from the gateway of the Docker network, like `172.17.0.1`. Without it every request counts as one from the address of the proxy, so everyone shares one limit of sign-in attempts and the audit log names the proxy.

A proxy that sends only `X-Real-IP` and no `X-Forwarded-For` also needs `TRUSTED_PROXY_HEADER=x-real-ip`. See [The Address of a Client](/user-guide/installation#the-address-of-a-client) for every setup.

### SSH Host Keys

Every SSH, SFTP and rsync connection pins the host key of its server on its first connect after the update and refuses another one from then on. A server reinstalled later is refused until its new key is trusted in the connection. A host name that leads to several servers with their own keys, like a cluster behind round-robin DNS, fails on every server but the first. Give each server a connection of its own, the servers the same host key, or turn **Check the host key** off for that connection, see [Host Key Check](/user-guide/destinations/sftp#host-key-check).

### Email with STARTTLS

An email channel set to STARTTLS no longer falls back to an unencrypted connection. A mail server that offers no STARTTLS needs the setting **None**.

### Groups and Permissions

Some permissions check more than before, with the home tenant alone too:

- **Groups and accounts.** Nobody makes, edits, gives or takes a group that may do more than they may. Only a platform admin sets the password, resets the second factor, ends the sessions, changes the name or email of, or deletes an account whose group may do more than they may, like a member of **Admin**.
- **Admin.** Someone added to **Admin** after the update may do everything in the tenant but is no platform admin. Pick **Platform admin** for their account under **Platform → Users & Groups** where they need it.
- **API keys of others.** Only the owner of a key and a platform admin rotate it, enable it again, change its permissions or let it run longer.
- **Configuration backup.** Only a platform admin sets it up, runs it and restores one, no longer whoever holds `settings:write`.
- **Vault, keys and templates.** `settings:read` no longer lists the encryption keys and the templates, give a group `vault:read` or `templates:read`. The Credentials tab needs `vault:read` beside `credentials:read`.
- **Connections.** **Test connection** needs the right to change connections of the kind, not to see them. Storage alerts need `destinations:write` instead of `settings:write`. Browsing the folders of a Local Filesystem or the volumes of Docker Volumes without SSH needs `jobs:write` or `storage:restore` beside `destinations:read`.
- **SSH agent logins.** A saved SSH login with **SSH agent** is created or changed by a platform admin alone. One saved earlier keeps working.

### API and API Keys

- The answers name `viewerPlatformAdmin` instead of `viewerSuperAdmin`, the recovery kit is requested with `POST /api/vault/recovery-kit`, and cancelling a restore run needs `storage:restore`.
- `GET /api/vault/credentials` needs `vault:read` beside `credentials:read`, and no API key reads the sign-in providers any more.
- A connection saved through the API has to fit the fields of its type, with every port a whole number from 1 to 65535. A MySQL or MariaDB password with a line break is refused, also in a saved login.
- An API key restores a file backup of an earlier version only with `destinations:write`, and its files then get the owner DBackup writes with, see [Restores](#folders-and-docker-volumes).

### Single Sign-On

Every provider becomes a provider of the platform, which only platform admins add, change and delete. A provider asks for the scopes `openid profile email` only. A provider links an account by its email only when an admin set that email. An account whose owner set its email themselves is linked with **Link** under **Profile** while signed in, see [New People](/user-guide/admin/sso#new-people).

### Long Backups

A backup that runs longer than a day fails, also while it still reports progress. Set a longer time or **No limit** at **Fail a run that takes longer than** under **Settings → General**. A restore or an integrity check runs as long as it takes, and an instance whose stuck run watchdog was switched off keeps it off.

### Folders and Docker Volumes

- **Exclude patterns.** A pattern that takes very long to match, or a list of more than 256 patterns with a slash, brackets or braces, is refused on save. A job saved with one earlier leaves that pattern out with a warning in the log, so the files it excluded land in the backup.
- **Folders and names of jobs.** The folder of a directory source stays inside the folder of its connection, and a folder with `..` is refused. A job name with a `.` or `..` folder, a folder that starts with a hyphen, or of slashes alone is refused. A job saved with one earlier stops with a message until it is changed.
- **Restores.** A restore into another place than the folder or volume the backup read needs `destinations:write` there. The owners of the files come back only into the folder the backup read, and for a backup of an earlier version only when a platform admin restores it while signed in. A restore lays no symbolic link whose target is absolute or leaves its folder, download the files as `.tar.gz` to get such links back.
- **Docker volumes.** A restore into Docker Volumes names the one volume it writes into, so a backup of several volumes is restored one volume at a time. A restore into Docker Volumes without SSH is for a platform admin alone.
- **Backup files.** Only a platform admin restores a file named like a backup, its index or a `.meta.json` into a backup destination, or a configuration backup. Download such files as `.tar.gz` instead.

### Connections to the Server DBackup Runs On

Local Filesystem, SQLite in local mode, Docker Volumes without SSH, a database in direct mode with **Extra options**, SQL Server with a shared folder and the other [connections to the server DBackup runs on](/user-guide/admin/tenants#connections-to-the-server-dbackup-runs-on) are added, changed, tested and browsed by a platform admin with a session alone. Their jobs keep running.

- No run reads or writes DBackup's temporary folder (`TMPDIR`, `/tmp` by default), and a Local Filesystem path no longer follows a symbolic link out of its folder. A job that reaches the folder of the database, the certificates or the configuration backup fails, and a job called `config-backups` stops until it is renamed. Move such a folder to one of its own.
- SQL Server with a shared folder counts as such a connection, also a source saved earlier that names no folder and uses `/tmp`. A customer's source in that mode stops working, switch it to **Over SSH** first.

### Redirects

Webhook, Slack, Discord, Teams, Gotify and ntfy channels and WebDAV destinations follow a redirect only on the same host. Enter the final address of a server that sends DBackup on to another host.

### SMB

A user name or domain with a `%` is refused. A folder, path or address with a semicolon, a double quote or a control character is refused, such files in an SMB folder source are left out, and a job whose name has one stops until it is renamed.

### Client Tools

The Docker image ships every tool. Outside of it, a MySQL or MariaDB restore in direct mode needs MariaDB 10.5.25, 10.6.18, 10.11.8, 11.4.2 or newer, or MySQL 8.0.40 or 8.4.3 or newer. Redis needs redis-cli 5 or newer, MongoDB the Database Tools 100.3.0 or newer, and rsync a local rsync that takes `--no-links`, like GNU rsync 3.

## Going Back

A start that is about to apply a migration first keeps a copy of the database beside it in `/data/db`, named `dbackup.db.before-migrate-<time>`. The three newest copies stay. When the copy fails, for example on a full volume, the log of the start says so and the migrations run anyway, so take your own backup as well.

::: danger Put the copy in place first
Start the older version only on the copy from before the update. On a migrated database it starts as if all were well and breaks once it reads or writes the tables that changed.
:::

1. Stop DBackup
2. In `/data/db`, move `dbackup.db` and its `-wal` and `-shm` files away
3. Copy `dbackup.db.before-migrate-<time>` to `dbackup.db`
4. Start the image of the version you ran before, like `skyfay/dbackup:v4.0.2`

Everything done since the update is lost. Starting 5.0 again on that copy migrates it again.
