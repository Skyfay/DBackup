> ⚠️ **Before updating:** An email channel set to STARTTLS no longer falls back to an unencrypted connection, so a mail server that offers no STARTTLS needs the setting None.

> ⚠️ **Before updating:** Every SSH connection now pins the host key of its server on the first connect after the update. A server that is reinstalled later is refused until its new key is trusted in the connection.

### ✨ Features

- **SSH**: DBackup pins the host key of an SSH server on the first connect and refuses a server that presents another one, for SFTP, rsync, databases in SSH mode and Docker Volumes over SSH. Each connection shows the pinned key and has a switch to turn the check off.

### 🔒 Security

- **Database Explorer**: The MySQL and MariaDB client of the table browser no longer runs commands of its own, so a table or column name cannot start a program beside DBackup. The SQLite and MongoDB browsers search and sort only by real columns.
- **Recovery Kit**: The recovery script refuses an index that names a folder outside the output folder and never writes through a link.
- **SSH**: A private key that asks for an excessive cost to unlock it is refused instead of holding up the server.
- **file backups**: An exclude pattern that would take very long to match is refused when it is saved and before a run reads it.
- **restore**: A restore to the original folder needs a backup that a run of the job recorded, and anything else needs the right to change the target connection. A restore over rsync or FTP no longer writes through a link in a folder below the restore folder.
- **storage**: Only a platform admin downloads or restores a file that is encrypted with the key of the configuration backup.
- **email**: A channel set to STARTTLS refuses a server that does not offer it instead of sending the login unencrypted.
- **notifications**: The generic webhook encodes the fields of a form body and escapes XML bodies. Discord and ntfy no longer take markup or line breaks from a name in a title.
- **settings**: An uploaded TLS certificate is checked in full and against its key before it replaces the one the server starts with.
- **SSO**: The link that ends connecting a provider in the profile only works in the browser that started it.
- **auth**: Deleting a passkey asks for the current password while a passkey is the second factor. The codes of an authenticator app are limited to five tries in 15 minutes for a signed-in account.
- **backup**: An incremental backup starts a full one when the index of the previous backup was changed at the destination.

### 🐛 Bug Fixes

- **backup**: A dump that stopped growing no longer counts as alive, so the check for stuck runs ends it and frees its slot.
- **retention**: A file without a backup record in the folder of a job no longer counts as a backup, so restored files cannot push real backups out. Retention never deletes such a file.

### 🔄 Changed

- **API**: The job routes answer 400 for a field of the wrong type, like an object where an id belongs.
- **server**: The log warns once when a forwarded header arrives from a private address while `TRUSTED_PROXIES` is unset.
- **Docker**: The compose file of the quick start sets `TRUSTED_PROXIES=none`, for an install without a reverse proxy in front.
