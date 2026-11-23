### 🐛 Bug Fixes

- **MySQL**: Backups of MySQL 26 and later with stored procedures and functions no longer fail on `SHOW PACKAGE STATUS`. DBackup now writes the routines of these servers itself, since the bundled `mariadb-dump` takes them for MariaDB. ([#203](https://github.com/Skyfay/DBackup/issues/203))
- **SFTP**: A directory source whose connection has the folder `.` now collects hidden files like `.htaccess` in its root and applies the exclude patterns to them. ([#214](https://github.com/Skyfay/DBackup/issues/214))
- **SSO**: Sign-in providers now ask only for the scopes `openid profile email`, so Google no longer refuses the sign-in with `invalid_scope`. Providers saved before get these scopes when DBackup updates, and so do those of an older configuration file that is restored. ([#198](https://github.com/Skyfay/DBackup/issues/198))
- **storage**: A backup that a later run overwrites at the same path now shows the time, size and checks of the newest run on the Backups page. ([#201](https://github.com/Skyfay/DBackup/issues/201))
- **restore**: The warning about restoring a backup of a newer server version compares the versions part by part, so a backup of 26.9 restored onto 26.10 no longer gets it.

### 🔄 Changed

- **Notifications**: The title of a backup notification, the email subject included, starts with the outcome again, like `Backup Successful: <job>`, `Backup Partial: <job>` and `Backup Failed: <job>`. The heading inside the email stays as it is. ([#209](https://github.com/Skyfay/DBackup/issues/209))

### 🧪 Tests

- **lab**: The dev lab and the end-to-end tests now include MySQL 26, and the MySQL dataset has a stored function beside its procedure.
