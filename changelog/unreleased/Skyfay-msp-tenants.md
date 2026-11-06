> ⚠️ **Before updating:** This version moves everything an installation holds into its first tenant. The first start after the update keeps a copy of the database from before, and going back to an earlier version means starting it on that copy, see [Before Updating](https://docs.dbackup.app/user-guide/admin/tenants#before-updating).

> ⚠️ **Breaking:** For API users the group SuperAdmin is now Admin, `viewerSuperAdmin` is now `viewerPlatformAdmin` and `GET /api/sso-providers` refuses API keys. Nobody makes, gives or takes a group that may do more than they may, or changes the account of someone in such a group, and the right to see the settings no longer covers the encryption keys and the templates. Testing a connection and the other checks of a connection form need the right to change that kind of connection, and changing the alerts of a destination needs the right to change destinations. The configuration backup with its destination, logins and key, the configuration restore and the database download are for a platform admin signed in to DBackup only, never for an API key. Changing the host, port, SSH server or URL of a connection no longer keeps a password, key or token saved in the connection itself, which has to be typed again or come from a saved login. Only the owner of an API key and a platform admin rotate it, enable it again, change its permissions or let it run longer. The recovery kit is requested with `POST /api/vault/recovery-kit`, cancelling a restore run needs `storage:restore` and `GET /api/vault/credentials` needs `vault:read` beside `credentials:read`. SMB refuses a folder, path or address with a semicolon, a double quote or a control character, such files in an SMB folder source are left out, and a job whose name has one stops until it is renamed. Adding, changing, copying, testing and browsing a Local Filesystem connection, SQLite without SSH, Docker volumes without SSH, a database in direct mode with extra options or SQL Server with a shared folder is for a platform admin signed in to DBackup only, and a job name with a `.` or `..` folder or a folder that starts with a hyphen is refused. Saving an SSH agent login, restoring into Docker Volumes without SSH and restoring a `.meta.json`, into `config-backups/` or a file named like a backup into a backup destination need a platform admin, a file restore into another place than the one the backup read needs `destinations:write`, a Docker Volumes source without SSH fails when it reads the volume of DBackup's own data or DBackup cannot tell which that is, and the configuration restore opens only encrypted files at a destination. A job whose Local Filesystem destination, folder source or SQLite source reaches the folder of the database, the certificates, the temporary folder or the configuration backup fails, also for a platform admin, and a job called config-backups stops until it is renamed. An SMB login with a `%` in its user name or domain is refused. A restore into Docker Volumes names its volume. Outside the Docker image a MySQL restore in direct mode needs a client that can turn off the commands of a dump, and a directory source folder with `..` stops its job. A connection saved through the API has to fit the fields of its type, with every port a whole number, and a MySQL password with a line break is refused. Webhook channels and WebDAV no longer follow a redirect to another host, and a new member of the group Admin is no platform admin. [Before Updating](https://docs.dbackup.app/user-guide/admin/tenants#before-updating) says what to do about each.

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
- **tenants**: Connections that reach the server DBackup runs on, like Local Filesystem, SQLite without SSH or extra options of a dump tool in direct mode, are added and changed by a platform admin of the home tenant only.
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
- **audit**: Cancelling a restore, verifying a backup, switching the passkey as second factor, testing a connection, reading the databases of a source and sending a test notification are written to the audit log.
- **audit**: Turning on the second factor no longer writes a sign-in to the audit log.
- **MSSQL**: A restore of an older backup format no longer leaves its .bak files in the shared folder or overwrites a file there of the same name.
- **storage**: Two checks of backups in the same millisecond no longer overwrite each other's result.
- **backup**: A configuration backup that the destination did not store fails instead of reporting success.
- **restore**: Two restores or listings of the same backup at once no longer share a temporary file.
- **vault**: Recovering a key the Vault already holds is written to the audit log when the key now opens the backups of another key too.
- **backup**: A job called config-backups no longer deletes configuration backups with its retention, and such a name is refused. The own retention of the configuration backup counts only its own files.
- **backup**: A configuration backup whose destination settings cannot be read fails instead of uploading with an empty configuration.
- **api**: An API key whose stored permissions are broken holds no permission instead of failing its requests with an error.
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
- **users**: Changing the email of a user to one another account holds shows a plain sentence instead of the error of the database.
- **api**: A disabled or expired API key is answered with 401 and its reason on every route instead of a 500.
- **audit**: Tables and rows read in the Database Explorer from All tenants are logged in the tenant of the source.
- **restore**: A backup whose index holds a damaged line no longer takes the server down while it is read.
- **restore**: A failed decryption or decompression of an older whole-file backup no longer leaves a half written file in the temp folder.
- **backup**: A file that grew between the listing and the transfer is recorded with its real size, so it restores whole.
- **restore**: An index that points several files at one stored file is refused as damaged instead of restoring only the first of them.
- **MSSQL**: A second log file of a restore under a new name is called `<name>_log2.ldf`, so it no longer shares the name of the log of a database called `<name>_2`. A restore refuses to place a file onto a file of another database.
- **Docker**: Names in the run log of a volume backup are shown escaped.
- **storage**: Listing a WebDAV, SMB, SFTP, FTP, S3, Google Drive, OneDrive or Dropbox destination ends when a folder lists itself or a folder above it, or when the server repeats its pages.

### 🔒 Security

- **users**: Saving a user checks the name, email, time zone and date formats before storing them.
- **backup**: Only a platform admin signed in to DBackup changes, schedules or starts the configuration backup, which an API key and a group with the right to change the settings no longer do.
- **backup**: Only a platform admin changes or deletes the destination of the configuration backup, reveals, changes or signs in elsewhere with its saved logins, restores files into it and reveals or exports its key. A key is no longer tried on a configuration backup file by anyone else.
- **adapters**: A password, key or token saved with a connection is no longer sent to a new host, port, SSH server or URL by Test connection, the folder browse, the database list or a save. A connection pointed elsewhere needs the secret typed again or a saved login.
- **API keys**: Only the owner of an API key and a platform admin rotate it, enable it again, change its permissions or let it run longer. Anyone else who may change API keys only renames, disables or deletes it or lets it run out sooner.
- **templates**: Seeing which jobs and destinations a retention policy reaches, with the times of their backups, needs the right to see jobs.
- **storage**: The OAuth callbacks and token checks of Google Drive, Dropbox and OneDrive show a fixed sentence instead of the error text of the provider or the server.
- **auth**: Confirming the authenticator app with a code needs the permission to manage the second factor, like turning it on.
- **auth**: Turning off the passkey as second factor no longer turns off an authenticator app.
- **auth**: Turning off the authenticator app no longer turns off the passkey as second factor.
- **auth**: Switching the passkey as second factor on or off, or deleting the last passkey while it is one, also needs the right to manage the second factor when no authenticator app is set up.
- **auth**: Deleting a group with members also needs the right to change users, since its members move.
- **history**: Cancelling a run needs the right that starts it, so a restore needs `storage:restore` and only a platform admin cancels a configuration restore. The History pages offer Cancel only on runs the viewer may cancel.
- **adapters**: The database lists, table reads, snapshot check and SFTP folder picker of a connection form answer only what the server said, never an error message of DBackup itself.
- **SMB**: A path, folder or file name with a semicolon, a double quote or a control character is refused before smbclient runs, so no name can run another smbclient command.
- **SMB**: Shadow copies refuse a server, share or id that rpcclient would split into more than one command or read as an option.
- **storage**: Local Filesystem no longer follows a symbolic link out of its folder when it writes, reads, lists or deletes.
- **restore**: A file restore refuses a target folder that leaves its connection with `..` or a part a storage reads as one.
- **restore**: A restore into Docker Volumes without SSH is for a platform admin alone. A file restore into another place than the folder or volume the backup read needs the right to change the connection it writes into.
- **restore**: Only a platform admin restores a `.meta.json`, a file into a config-backups folder or named like a configuration backup, or a file named like a backup or its index into a backup destination.
- **backup**: A configuration backup at a destination restores only when it is encrypted.
- **credentials**: Only a platform admin saves an SSH login that uses the SSH agent of the server.
- **storage**: Listing the folders of a Local Filesystem connection or the volumes of Docker without SSH needs the right to change jobs or to restore.
- **vault**: Trying a key on a backup to bring it into the Vault also needs the right to read the destinations.
- **restore**: A file restore no longer lays a symbolic link whose target is absolute or leads out of the folder it restores into, nor anything below another link of the same backup, and names each one in the log instead.
- **connections**: Test connection keeps the server version with a saved connection only when it tested that connection.
- **api**: The database list and the folder browse of a saved connection answer a fixed sentence for a failure of DBackup itself instead of its error text.
- **connections**: A failed SSH test answers a fixed sentence instead of the words of an error inside DBackup.
- **auth**: The page a sign-in provider link returns to no longer signs out whoever opens it without a link of their own.
- **adapters**: Only a platform admin points a Local Filesystem or a SQLite file at the folder of the database of DBackup, its TLS certificate or the configuration backup, and no backup run reads or writes there.
- **SSO**: Linking a sign-in provider to the own account from the browser needs the right to manage the own sign-in providers and always goes into the audit log.
- **auth**: The own password changes only through the Profile page, which ends the other sessions.
- **auth**: Nobody but a platform admin sets the password, resets the second factor, ends the sessions, changes the name or email of, or deletes an account whose group may do more than they may. The Users tab locks such an account with the reason.
- **auth**: Nobody makes, edits, gives or takes a group that may do more than they may.
- **auth**: Setting a password, resetting the second factor, ending sessions and deleting or changing another account answer with a fixed sentence when they fail, never with the words of the database.
- **api**: A route, action or row of a bulk action that fails answers a fixed sentence and keeps the error itself for the log.
- **auth**: The browser can no longer unlink a sign-in provider or the password, or switch the passkey as second factor, around the profile permissions and the audit log.
- **api**: The rate limits under `/api/internal/rate-limit-config` answer only the middleware of the server itself.
- **api**: Creating, importing and recovering an encryption key, the configuration restore from a destination, the template dialogs, the switches of a sign-in provider and the own preferences check their input before anything is stored.
- **connections**: Testing a connection or its SSH login, checking its access or its snapshots and reading databases, tables or rows from the fields of a form need the right to change that kind of connection.
- **storage**: A configuration backup on a destination is downloaded, opened and restored file by file only by a platform admin who is signed in, and never through a link.
- **PostgreSQL**: The tools get a database name of a job, a restore or the table browser always as a name, so a name that reads like a connection string no longer connects to another server.
- **storage**: Connecting Google Drive, Dropbox or OneDrive finishes only for the person and the login that started it.
- **storage**: Deleting in the Storage Explorer refuses the root folder of a destination.
- **storage**: A download link opened without signing in only serves a file that was shared as a link.
- **auth**: The own name and email change only as far as the profile permissions allow, also for someone who may change users. The own second factor is reset under Profile only.
- **uploads**: A picture for a profile or the login page that is larger than allowed is refused before it is read.
- **api**: Creating a connection through the API with an unknown kind or an adapter of another kind is refused instead of skipping the permission check.
- **MySQL**: A restore no longer runs shell commands or reads, writes or sends local files that a dump asks for. In direct mode a client that cannot turn these off is refused with its version.
- **MySQL**: A restore target whose name holds a backtick is quoted as one name when the database is created, and the client gets the target as `--database`.
- **restore**: A database name of a job, a restore target or a mapping that starts with a hyphen is refused, so no tool reads it as an option.
- **SQLite**: A restore under a new name always lands in the folder of the source.
- **rsync**: A username with `:`, `/`, spaces or a leading hyphen is refused when the connection or its saved login is saved and before any command runs.
- **notifications**: Discord, Slack, Teams, Generic Webhook, Gotify and ntfy follow a redirect only to the same host. A send redirected to another host fails with a message naming where it led.
- **WebDAV**: A redirect to another host is no longer followed.
- **storage**: Local Filesystem no longer lays a symbolic link whose target leads out of its folder.
- **rsync**: A folder or job name that starts with a hyphen is no longer read as an option of a command on the server.
- **storage**: The backup routes no longer list, download, delete, lock or verify files of a directory source.
- **storage**: Deleting or locking a backup refuses a path that leaves the destination, like a `..` folder or a leading slash.
- **auth**: A code of the second factor no longer marks the browser as trusted, so every sign-in with a password asks for the second factor.
- **api**: Starting the authorization of a Dropbox, Google Drive or OneDrive login is refused to API keys.
- **audit**: Folder and volume reads of saved connections, restore folder checks, token checks of cloud drives and Check now are written to the audit log.
- **jobs**: The folder of a directory source can no longer leave the folder its connection is set to. A job saved with such a folder fails its run until the folder is changed.
- **storage**: The backup routes and the folder check of a restore refuse a path that leaves the destination through backslashes or percent escapes.
- **storage**: Downloads stage their file in the temporary folder of DBackup under a random name.
- **MySQL**: A password with a line break or a NUL character is refused on save and before every run. Without a password the client tools read no option file of the DBackup server, and no client call sends local files to the server.
- **rsync**: The host and port of an rsync destination are checked before they reach ssh, so a stored value can no longer add ssh options or turn the transfer into a local copy.
- **Firebird**: The host and port of a Firebird source are checked before they go into the connection string of gbak and isql.
- **connections**: A connection is checked against the fields of its type before it is saved, also through the API, and every port must be a whole number from 1 to 65535.
- **storage**: The folder browser of an SFTP, FTP or SMB connection no longer lists folders above the folder the connection is set to.
- **Redis**: The password reaches redis-cli as `REDISCLI_AUTH` instead of `-a`, so it shows in no process list and in no command over SSH. This needs redis-cli 5 or newer.
- **FTP**: FTPS checks the certificate of the server unless the new switch Trust the server certificate is on. Connections saved earlier keep accepting every certificate until the switch is turned off.
- **storage**: The connection tests and reads of SMB and Rsync write their temporary files into a private folder under a random name. FTP writes none at all anymore.
- **MongoDB**: mongodump and mongorestore read the password or the connection string from a temporary `--config` file instead of their arguments. This needs the MongoDB Database Tools 100.3.0 or newer.
- **restore**: Older multi-database backups and incremental chains no longer take a name stored in the backup as a path. A tampered backup can no longer write or read files outside the restore folder.
- **Recovery Kit**: Symbolic links that lead out of the output folder or lie inside another link of the backup are skipped instead of laid.
- **Firebird**: A restore no longer replaces a file named only by the backup. A database that is no alias of the target source needs a path picked for it.
- **SMB**: The password reaches smbclient and rpcclient through the environment instead of their command line, where other users of the machine could read it.
- **storage**: Temporary files of downloads, restores and the configuration backup get names nobody can guess, and a temporary file is never written through an existing file or link.
- **backups**: Locking a backup, trying a key on one, deleting several and restoring a configuration backup from a destination refuse a path that leaves the destination.
- **SSO**: Checking a sign-in provider answers a fixed sentence instead of the words of the failed request and writes an entry to the audit log.
- **backup**: A directory source can no longer pack a file of the DBackup server into a backup through a crafted name or a link in its listing. Such entries are left out and named in the run log, and the run ends as Partial.
- **SMB**: A user name or domain with a `%` is refused, since smbclient reads what follows it as the password. Names a share lists with a slash, a backslash or of dots alone are left out of a directory source.
- **restore**: A restore stops reading a backup that inflates past what DBackup ever writes and reports it as damaged. This covers bundles, entries that lie about their size, indexes far larger than their stored size and older whole-file backups.
- **restore**: Restored files never get setuid, setgid or the sticky bit, and they get their owner back only in the place the backup was read from.
- **restore**: A download of restored files names every entry inside one plain folder of its source.
- **SSH**: Temporary files on a remote host are created exclusively, so a file or link left under the same name fails the write instead of receiving a login.
- **Docker Volumes**: A restore into Docker Volumes needs a named volume and no longer takes the volume from the backup.
- **SSO**: Deleting a group writes an audit entry for every sign-in provider whose default group it changes.
- **storage**: Reading the metadata and the index of a backup stops at a size limit instead of loading whatever the destination sends. A listing leaves an oversized `.meta.json` out with a log line and reads the sidecars a few at a time.
- **restore**: A destination that ignores byte ranges or sends more than a read asked for fails the read as a damaged backup.
- **backup**: Small files are bundled by the size they arrived with, never by the size the source listed.
- **restore**: An older multi-database backup whose manifest is larger than 16 MB is refused as damaged before it is read.
- **restore**: A restore checks the free space of the temporary folder before it starts, and the index of a backup is no longer downloaded to that folder.
- **backup**: A directory source fails with a clear message when it lists more than 10 million entries, a name longer than 32 KB or names that add up to more than 2 GB.
- **rsync**: A directory source no longer copies devices, pipes, owners, groups or links of the server, and links are still backed up as links.
- **rsync**: Downloading or reading a backup no longer recreates a symbolic link of the remote server on the DBackup server, and the local rsync must take `--no-links`. A download from any destination that leaves anything but a regular file fails.
- **restore**: A restore whose destination fails ranged reads downloads the backup once, however many reads failed at the same moment, and removes that copy at the end.
- **rsync**: Downloading or reading a backup transfers one file at most, so a path that is a folder on the server fails instead of copying the folder.
- **storage**: Downloading an older encrypted backup with its metadata builds the ZIP as a stream without compression and no longer holds up the server while it does.
- **storage**: Listing a WebDAV folder stops reading the answer of the server past 256 MB.
- **storage**: A download to a client that reads slowly no longer holds the whole file in the memory of the server.
- **S3**: Listing a bucket stops reading one page of the answer past 16 MB instead of loading whatever the server sends.
- **backup**: A file index whose fields hold values of another type than DBackup writes is refused as damaged.
- **S3**: Error answers and answers without content from an S3 server are read only up to 1 MB.

### 🎨 Improvements

- **audit**: A change of the group of a user names the user and the group. The entries of a new password, a reset second factor, ended sessions, a changed account, an unlinked sign-in provider and bulk changes, also of the alerts of several destinations, name what they changed.
- **audit**: Changes of the own second factor, backup codes and passkeys, the old and new end of an edited API key and tests of an SSH login are written to the audit log.
- **audit**: Ending the own sessions on the Profile page goes into the audit log.
- **audit**: Browsing the folders of a connection form or of the server DBackup runs on, and the snapshot check, write an entry into the audit log.
- **audit**: A wrong code of the second factor and a passkey that was turned down go into the audit log as failed sign-ins.
- **audit**: The bulk actions of the API on jobs, connections and credential profiles name the records they changed, and reading the tables or rows of a database writes an entry.
- **api**: Deleting a job over the API logs a failure and answers a refusal with its own status.
- **api**: Pages, Server Actions and API routes read the database only through the services.
- **docker**: A start that applies database migrations first keeps a copy of the database beside it. The three newest copies stay.
- **dashboard**: The Overview, the Timeline, the schedule picker, the History and the Connections page load much faster with many jobs and connections.
- **dashboard**: The Jobs page and the Database Explorer load their lists a page at a time from the server, so they open quickly with many thousands of jobs and databases.
- **auth**: A link into the dashboard opened while signed out leads back to its page after signing in.
- **history**: The Summary of a restore run tells each step like a backup does, with where it read from and how much, and a row for every database and folder it restored. A database row opens to its command and the lines of its tool.
- **audit**: A key tried on a backup is written to the audit log also when it does not open the backup or matches a key the Vault holds already.
- **backup**: Bundles of small files are compressed without blocking the server.
- **storage**: A destination listing reads only the `.meta.json` files beside its backups and keeps only the fields it shows.

### 🔄 Changed

- **storage**: Changing the alerts of a destination needs the right to manage destinations instead of the right to change the settings.
- **auth**: The right to see the settings no longer lists the encryption keys and the templates.
- **auth**: The SuperAdmin group became the group Admin with every permission, and its members became platform admins. Only platform admins manage the sign-in providers, restore a configuration and download the database.
- **auth**: Restoring from Recently deleted and deleting for good need the new permission Tenant settings. Groups that could change the settings get it with the update.
- **api**: GET /api/sso-providers answers a signed-in person only and refuses API keys.
- **api**: GET /api/users and GET /api/groups answer viewerPlatformAdmin in place of viewerSuperAdmin.
- **SMB**: The share address must have the form `//server/share` or `\\server\share` with a server name, an IPv4 address or an IPv6 address without brackets. In a tenant that blocks the local network smbclient looks the server up in DNS only, never by a NetBIOS broadcast.
- **SSO**: The sign-in providers list the linked people only to a platform admin and to whoever may see the accounts of the platform.
- **MongoDB**: A connection to a single host talks to that host alone and no longer to the members of a replica set it announces.
- **restore**: A full restore refuses a directory source without a target folder instead of writing into a folder named after the source.
- **api**: The recovery kit is requested with `POST /api/vault/recovery-kit` and the ids of the encryption profiles in the body.
- **queue**: Runs at the same time counts only backups, so a running restore or check of copies no longer holds a backup back.
- **vault**: The Credentials tab of the Vault needs the right to see the Vault as well as the saved logins, like the search.

### 📝 Documentation

- **docs**: New guides for tenants, shared databases and shared destinations and channels, for admins and for developers. The guides of users, groups, permissions, API keys with platform keys, SSO and the audit log describe platform admins and tenants.
- **API keys**: Fixed the length of a key and the path of its service in the developer guide.
- **docs**: The permissions guide explains that changing a retention policy removes backups without the right to delete them.

### 🧪 Tests

- **SSH**: The test of a new ed25519 key that ssh2 writes a byte short no longer fails now and then.
- **restore**: The Smart Recovery test that tries every profile no longer fails now and then.
- **connections**: The tests of the connection form no longer leave an error behind now and then.
- **e2e**: A run trims the build cache of the Docker host to 10 GB after it built the image.
- **lint**: Lint guards keep direct database queries out of the routes and Next.js out of the services.
- **e2e**: End-to-end tests walk an MSP through its customers, an invitation, a shared database with its download and restore, a shared destination and channel, Recently deleted of a customer and a platform group of selected tenants. They also cover the network block, All tenants and the delete of a tenant.
- **tenants**: Tests against a real database prove that no tenant reads, changes or deletes the rows of another. Invitation links, shared databases and shared destinations and channels have tests of their own.

### 🔧 CI/CD

- **lab**: `pnpm lab:seed` adds two customer tenants with a person each, a database, destination and channel shared with one of them and a platform group of both. `pnpm lab:status` shows what of it exists.
- **build**: The type check of the image build, the CI and the pnpm scripts runs with a heap of 6 GB, since the default of Node no longer fits.
- **lab**: The customer server of the end-to-end tests starts again after it was stopped hard, instead of restarting for good.
