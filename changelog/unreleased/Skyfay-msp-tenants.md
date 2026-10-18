> ⚠️ **Before updating:** This version moves everything an installation holds into its first tenant. The first start after the update keeps a copy of the database from before, and going back to an earlier version means starting it on that copy, see [Before Updating](https://docs.dbackup.app/user-guide/admin/tenants#before-updating).

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

### 🐛 Bug Fixes

- **backups**: The Destinations timeline of the Backups page follows the search and the filters of the list.
- **api**: Changing a job through the API keeps its notification channels when the request leaves them out, and checks the destinations it names. Starting a job that does not exist answers 404 instead of 500.
- **SSO**: Someone who may only see the settings opens the sign-in providers again.
- **storage**: SMB, FTP, Dropbox, OneDrive and Rsync list a folder that does not exist yet as empty instead of failing. Google Drive no longer creates a folder by listing it.
- **history**: The long name of an archive in the page of a restore run breaks inside its card instead of running out of it.
- **ui**: A button in a toast, like Open the run or Undo, works while a dialog or a side panel is open.
- **restore**: A restore that fails in the restore tool or restores no entry of an archive sends the Restore failed notification.
- **api**: Routes answer 403 instead of 500 when a permission is missing, cancelling a run among them.
- **audit**: Cancelling a restore, verifying a backup and switching the passkey as second factor are written to the audit log.
- **dashboard**: Latest executions names each run like the History does instead of showing Manual Action for a restore.
- **startup**: An ENCRYPTION_KEY with a character other than 0 to 9 and a to f stops the start with a clear message instead of failing at the first secret it encrypts.
- **dashboard**: Pages that read 1000 or more jobs or connections, like Backups and the Database Explorer, load instead of failing with an error of the database.
- **scheduler**: Saving a job or a setting no longer keeps the replaced schedules in memory.
- **system tasks**: A scheduled system task that still runs is not started a second time.
- **vault**: Downloading a recovery kit is written to the audit log once it succeeded, with the names of its keys.
- **storage**: SFTP, FTP and Dropbox list their backups right when their folder is written with a leading `./`, double slashes or another case.

### 🔒 Security

- **connections**: Testing a connection or its SSH login, checking its access or its snapshots and reading databases, tables or rows from the fields of a form need the right to change that kind of connection.
- **storage**: A configuration backup on a destination is downloaded, opened and restored file by file only by a platform admin who is signed in, and never through a link.
- **storage**: Connecting Google Drive, Dropbox or OneDrive finishes only for the person and the login that started it.
- **storage**: Deleting in the Storage Explorer refuses the root folder of a destination.
- **storage**: A download link opened without signing in only serves a file that was shared as a link.
- **auth**: The own name and email change only as far as the profile permissions allow, also for someone who may change users. The own second factor is reset under Profile only.
- **uploads**: A picture for a profile or the login page that is larger than allowed is refused before it is read.
- **api**: Creating a connection through the API with an unknown kind or an adapter of another kind is refused instead of skipping the permission check.
- **MySQL**: A restore no longer runs shell commands or sends local files that a dump asks for. MariaDB clients use their sandbox and MySQL clients turn their system command off.

### 🎨 Improvements

- **api**: Pages, Server Actions and API routes read the database only through the services.
- **docker**: A start that applies database migrations first keeps a copy of the database beside it. The three newest copies stay.
- **dashboard**: The Overview, the Timeline, the schedule picker, the History and the Connections page load much faster with many jobs and connections.
- **auth**: A link into the dashboard opened while signed out leads back to its page after signing in.
- **history**: The Summary of a restore run tells each step like a backup does, with where it read from and how much, and a row for every database and folder it restored. A database row opens to its command and the lines of its tool.

### 🔄 Changed

- **storage**: Changing the alerts of a destination needs the right to manage destinations instead of the right to change the settings.
- **auth**: The right to see the settings no longer lists the encryption keys and the templates.
- **auth**: The SuperAdmin group became the group Admin with every permission, and its members became platform admins. Only platform admins manage the sign-in providers, restore a configuration and download the database.
- **auth**: Restoring from Recently deleted and deleting for good need the new permission Tenant settings. Groups that could change the settings get it with the update.
- **api**: GET /api/sso-providers answers a signed-in person only and refuses API keys.
- **api**: GET /api/users and GET /api/groups answer viewerPlatformAdmin in place of viewerSuperAdmin.

### 📝 Documentation

- **docs**: New guides for tenants, shared databases and shared destinations and channels, for admins and for developers. The guides of users, groups, permissions, API keys, SSO and the audit log describe platform admins and tenants.

### 🧪 Tests

- **lint**: Lint guards keep direct database queries out of the routes and Next.js out of the services.
- **tenants**: Tests against a real database prove that no tenant reads, changes or deletes the rows of another. Invitation links, shared databases and shared destinations and channels have tests of their own.
