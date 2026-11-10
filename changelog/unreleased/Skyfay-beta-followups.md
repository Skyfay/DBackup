### 🐛 Bug Fixes

- **auth**: Two accounts made at the same moment on a new instance no longer leave it without a platform admin.
- **ui**: History and the Database Explorer lead to the Overview for someone without the right to see them, instead of an error page.

### 🔒 Security

- **auth**: Without `BETTER_AUTH_URL`, the session cookie is marked `Secure` while DBackup serves HTTPS itself, and the start warns when `BETTER_AUTH_URL` is missing or uses plain HTTP for another host.
- **auth**: An account whose newest email change in the audit log was its own links a sign-in provider only from its own session, like one that changes its email from now on.
- **cloud storage**: The page after authorizing Dropbox, Google Drive or OneDrive shows only DBackup's own messages, never text from the address.
- **connections**: A connection of a kind someone may not see answers like one that does not exist.
- **encryption**: A backup that its run recorded as encrypted is no longer restored or downloaded when the file at the destination is not encrypted.
- **restore**: Restores, downloads and checks of backups keep their temporary files in a folder only DBackup reads.
- **SSH**: The passwords of PostgreSQL, Firebird and Redis no longer show in the process list of a server reached over SSH.
- **uploads**: Avatars, the login image and configuration backups are refused past their size limit also when they arrive without a length.

### 🎨 Improvements

- **templates**: The built-in templates of older installations keep their dates as numbers like every other row.

### 🔄 Changed

- **auth**: An instance without `BETTER_AUTH_URL` that serves HTTPS itself gives the session cookie a new name, so everyone signs in once more after the update.
- **auth**: Switching passkey sign-in off refuses a passkey as the first factor on the server, not only on the login page. A passkey as second factor still works.
