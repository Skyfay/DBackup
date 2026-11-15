### 🐛 Bug Fixes

- **MySQL**: Backups of MySQL 26 and later with stored procedures and functions no longer fail on `SHOW PACKAGE STATUS`. DBackup now writes the routines of these servers itself, since the bundled `mariadb-dump` takes them for MariaDB. ([#203](https://github.com/Skyfay/DBackup/issues/203))

### 🔄 Changed

- **Notifications**: The title of a backup notification, the email subject included, starts with the outcome again, like `Backup Successful: <job>`, `Backup Partial: <job>` and `Backup Failed: <job>`. The heading inside the email stays as it is. ([#209](https://github.com/Skyfay/DBackup/issues/209))

### 🧪 Tests

- **lab**: The dev lab and the end-to-end tests now include MySQL 26, and the MySQL dataset has a stored function beside its procedure.
