### 🐛 Bug Fixes

- **MySQL**: A MySQL or MariaDB restore into a database of another name keeps binary data and text byte for byte. It replaced bytes that were no valid UTF-8 and could split a long row in two.
- **MySQL**: Turning TLS off works with every client tool. Backups and restores of MySQL 5.7 failed with the MariaDB client of the Docker image, and the client of MySQL 8.0 or later failed over SSH.
- **WebDAV**: A destination whose folder holds no backup yet no longer logs an error after every run.

### 📝 Documentation

- **wiki**: The testing guide describes the tests that exist and how to write one.
- **wiki**: A new Dev Lab page explains how to run DBackup against every database engine and destination for development.
- **website**: The answers on supported versions name the versions the test lab runs.

### 🧪 Tests

- **tests**: The tests of the configuration backup, Recently deleted and the restore at startup now run with the unit tests in CI.
- **e2e**: End-to-end tests with Playwright replace the integration tests against single containers and run the Docker image beside the servers of the dev lab. They back up and restore every database engine, a folder and to every destination with the content compared, and go through the first start and a backup in the browser.

### 🔧 CI/CD

- **lab**: A dev lab starts every database engine, storage server and notification receiver in Docker and fills the dev database with the first user, all connections and sample jobs. `pnpm lab` shows its commands in a menu, with a status that says what runs, what is missing and what to run next.
- **ci**: Validate also runs the end-to-end tests after an approval, on pull requests into main and on those into dev that touch the app or its end-to-end tests. A last job of Validate passes once every other check passed.
- **docker**: An image built from a checkout no longer contains the development database of that checkout.
- **scripts**: The Multipass test VM, the old test containers with their seed scripts and four unused one-off scripts are removed.
