> ⚠️ **Before updating:** This version moves everything an installation holds into its first tenant. The first start after the update keeps a copy of the database from before, and going back to an earlier version means starting it on that copy, see [Before Updating](https://docs.dbackup.app/user-guide/admin/tenants#before-updating).

> ⚠️ **Breaking:** For API users the group SuperAdmin is now Admin, `viewerSuperAdmin` is now `viewerPlatformAdmin` and `GET /api/sso-providers` refuses API keys. The right to see the settings no longer covers the encryption keys and the templates, and the configuration restore, the database download and the files of a configuration backup are for a platform admin only. The configuration backup is set up, scheduled and started by a platform admin signed in to DBackup only, and `PUT /api/settings/system-tasks` answers 403 for it to every API key. Testing a connection and the other checks of a connection form need the right to change that kind of connection, also for API keys. Webhook channels no longer follow a redirect to another host, and a new member of the group Admin is no platform admin.

### ✨ Features

- **tenants**: One instance serves several tenants, each with its own connections, jobs, backups, keys, templates, API keys and audit log. People work in a tenant through a group, and the head of the sidebar switches between the tenants someone may open.
- **tenants**: Platform admins see every tenant at once in All tenants, with the jobs, connections, backups, runs and accounts of all of them. A record opens in its tenant to be changed.
- **tenants**: Every tenant has its own groups, starting with Admin, and its admins manage them.
- **tenants**: With more than one tenant the section Platform holds the tenants, every account and the settings of the instance. Administration holds the open tenant, with its own settings for its name, logo and notifications.
- **tenants**: Platform groups give the people of the MSP rights on the platform and rights in all tenants or selected ones, on top of their own groups. Platform admin is the built-in platform group with every right.
- **tenants**: A tenant admin adds people with an invitation link that works once, for an existing account or a new one.
- **SSO**: A sign-in provider can belong to a tenant. It is reached by the email domain instead of a button, and the people it adds join that tenant.
- **tenants**: Single databases of a shared server can be given to another tenant, by hand, by name patterns or through the API. That tenant finds the database under Connections and its backups in the Backups list, and downloads and restores its own database only.
- **tenants**: The platform decides which tenants share with customers, the home tenant from the start.
- **tenants**: A shared database can move to another server and keeps its older backups for its tenant. When the connection of a shared server is deleted, its tenants keep downloading their backups.
- **tenants**: The platform makes a group once for all or chosen tenants, from presets like Client, which their admins give to people and only the platform changes. A new tenant starts with Admin and every group for all tenants.
- **tenants**: The tenant of a shared database can start a backup of it alone, as often a day as the platform allows that tenant or a database or rule sets on its own. Such a backup shows in its History as a short run that names the database alone.
- **tenants**: A restore a tenant starts of a shared database also shows in the History and the audit log of the tenant of the server, with the whole log.
- **tenants**: A tenant of the MSP shares its destinations and notification channels with other tenants, which back up into a folder of their own there or name their own recipients. It sees the space each tenant takes but never its backups, and taking a destination back deletes the backups of that tenant on it.
- **tenants**: The platform decides for each tenant whether it adds database connections, directory sources, destinations, notification channels and API keys itself. Switching one off stops new ones, and for API keys also the keys the tenant has.
- **tenants**: Connections that reach the server DBackup runs on, like Local Filesystem, SQLite without SSH or extra options of a dump tool in direct mode, are added in the home tenant only.
- **tenants**: The platform blocks the connections of a tenant into the local network and allows chosen address ranges. New tenants start blocked, and a connection over SSH counts by its SSH server.
- **api**: Tenants with their settings, members and invitations, the sharing of destinations and channels and the rules of a shared server can be managed through the API. An API key of the home tenant may carry the rights on tenants and accounts its owner holds, for the tenants its owner reaches.
- **api**: GET /api/jobs/list and GET /api/databases/list read the jobs and the databases a page at a time with search, filters and their counts.

### 🐛 Bug Fixes

- **backups**: The Destinations timeline of the Backups page follows the search and the filters of the list.
- **api**: Changing a job through the API keeps its notification channels when the request leaves them out, and checks the destinations it names. Starting a job that does not exist answers 404 instead of 500.
- **storage**: SMB, FTP, Dropbox, OneDrive and Rsync list a folder that does not exist yet as empty instead of failing. Google Drive no longer creates a folder by listing it.
- **history**: The long name of an archive in the page of a restore run breaks inside its card instead of running out of it.
- **ui**: A button in a toast, like Open the run or Undo, works while a dialog or a side panel is open.
- **restore**: A restore that fails in the restore tool or restores no entry of an archive sends the Restore failed notification.
- **api**: Routes answer 403 instead of 500 when a permission is missing, cancelling a run among them.
- **audit**: Cancelling a restore, verifying a backup and switching the passkey as second factor are written to the audit log.
- **dashboard**: Latest executions names each run like the History does instead of showing Manual Action for a restore.
- **docker**: A missing or malformed ENCRYPTION_KEY stops the start of the container before the database migrations run.
- **startup**: An ENCRYPTION_KEY with a character other than 0 to 9 and a to f stops the start with a clear message instead of failing at the first secret it encrypts.
- **dashboard**: Pages that read 1000 or more jobs or connections, like Backups and the Database Explorer, load instead of failing with an error of the database.
- **scheduler**: Saving a job or a setting no longer keeps the replaced schedules in memory.
- **scheduler**: A scheduled system task that still runs is not started a second time.
- **vault**: Downloading a recovery kit is written to the audit log once it succeeded, with the names of its keys.
- **storage**: SFTP, FTP and Dropbox list their backups right when their folder is written with a leading `./`, double slashes or another case.
- **OneDrive**: A folder or file name with `#`, `?` or `%` in it is read as that name.
- **SMB**: A backup into a folder that is more than one level deep and does not exist yet no longer fails.
- **Firebird**: A restore into a configured alias writes into the file of that alias instead of a file named after the alias.
- **MSSQL**: A backup restored onto another server under its own name puts its files into the data folder of that server.
- **rsync**: A folder setting like `./backups` or `/srv//backups` no longer puts the folder in front of every listed backup.
- **restore**: A key picked to open a backup that is no longer in the Vault asks for a key again instead of failing with an error.
- **queue**: A waiting integrity check or check of backup copies is no longer started by the queue as if it were a backup.

### 🔒 Security

- **users**: Saving a user checks the name, email, time zone and date formats before storing them.
- **config backup**: Only a platform admin signed in to DBackup changes, schedules or starts the configuration backup, which an API key and a group with the right to change the settings no longer do.
- **API keys**: Pausing, resuming and deleting the key of someone else needs a group that may do all the key may do, like rotating it.
- **connections**: Testing a connection or its SSH login, checking its access or its snapshots and reading databases, tables or rows from the fields of a form need the right to change that kind of connection.
- **storage**: A configuration backup on a destination is downloaded, opened and restored file by file only by a platform admin who is signed in, and never through a link.
- **PostgreSQL**: The tools get a database name of a job, a restore or the table browser always as a name, so a name that reads like a connection string no longer connects to another server.
- **storage**: Connecting Google Drive, Dropbox or OneDrive finishes only for the person and the login that started it.
- **storage**: Deleting in the Storage Explorer refuses the root folder of a destination.
- **storage**: A download link opened without signing in only serves a file that was shared as a link.
- **auth**: The own name and email change only as far as the profile permissions allow, also for someone who may change users. The own second factor is reset under Profile only.
- **uploads**: A picture for a profile or the login page that is larger than allowed is refused before it is read.
- **api**: Creating a connection through the API with an unknown kind or an adapter of another kind is refused instead of skipping the permission check.
- **MySQL**: A restore no longer runs shell commands or sends local files that a dump asks for. MariaDB clients use their sandbox and MySQL clients turn their system command off.
- **MySQL**: A restore target whose name holds a backtick is quoted as one name when the database is created, and the client gets the target as `--database`.
- **restore**: A database name of a job, a restore target or a mapping that starts with a hyphen is refused, so no tool reads it as an option.
- **SQLite**: A restore under a new name always lands in the folder of the source.
- **rsync**: A username with `:`, `/`, spaces or a leading hyphen is refused when the connection or its saved login is saved and before any command runs.
- **notifications**: Discord, Slack, Teams, Generic Webhook, Gotify and ntfy follow a redirect only to the same host. A send redirected to another host fails with a message naming where it led.
- **WebDAV**: A redirect to another host is no longer followed.

### 🎨 Improvements

- **api**: Pages, Server Actions and API routes read the database only through the services.
- **docker**: A start that applies database migrations first keeps a copy of the database beside it. The three newest copies stay.
- **dashboard**: The Overview, the Timeline, the schedule picker, the History and the Connections page load much faster with many jobs and connections.
- **dashboard**: The Jobs page and the Database Explorer load their lists a page at a time from the server, so they open quickly with many thousands of jobs and databases.
- **auth**: A link into the dashboard opened while signed out leads back to its page after signing in.
- **history**: The Summary of a restore run tells each step like a backup does, with where it read from and how much, and a row for every database and folder it restored. A database row opens to its command and the lines of its tool.

### 🔄 Changed

- **storage**: Changing the alerts of a destination needs the right to manage destinations instead of the right to change the settings.
- **auth**: The right to see the settings no longer lists the encryption keys and the templates.
- **auth**: The SuperAdmin group became the group Admin with every permission, and its members became platform admins. Only platform admins manage the sign-in providers, restore a configuration and download the database.
- **auth**: Restoring from Recently deleted and deleting for good need the new permission Tenant settings. Groups that could change the settings get it with the update.
- **api**: GET /api/sso-providers answers a signed-in person only and refuses API keys.
- **api**: GET /api/users and GET /api/groups answer viewerPlatformAdmin in place of viewerSuperAdmin.
- **SMB**: The share address must have the form `//server/share` or `\\server\share`.
- **MongoDB**: A connection to a single host talks to that host alone and no longer to the members of a replica set it announces.
- **queue**: Runs at the same time counts only backups, so a running restore or check of copies no longer holds a backup back.

### 📝 Documentation

- **docs**: New guides for tenants, shared databases and shared destinations and channels, for admins and for developers. The guides of users, groups, permissions, API keys with platform keys, SSO and the audit log describe platform admins and tenants.
- **API keys**: Fixed the length of a key and the path of its service in the developer guide.

### 🧪 Tests

- **SSH**: The test of a new ed25519 key that ssh2 writes a byte short no longer fails now and then.
- **lint**: Lint guards keep direct database queries out of the routes and Next.js out of the services.
- **e2e**: End-to-end tests walk an MSP through its customers, an invitation, a shared database with its download and restore, a shared destination and channel, Recently deleted of a customer and a platform group of selected tenants. They also cover the network block, All tenants and the delete of a tenant.
- **tenants**: Tests against a real database prove that no tenant reads, changes or deletes the rows of another. Invitation links, shared databases and shared destinations and channels have tests of their own.

### 🔧 CI/CD

- **lab**: `pnpm lab:seed` adds two customer tenants with a person each, a database, destination and channel shared with one of them and a platform group of both. `pnpm lab:status` shows what of it exists.
