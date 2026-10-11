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
- **lab**: The integration tests against single containers are replaced by `pnpm test:lab`, which checks every connection and destination of the dev lab and restores every source with its content compared.

### 🔧 CI/CD

- **lab**: A dev lab starts every database engine, storage server and notification receiver in Docker, also on remote hosts, and fills the dev database with the first user, all connections and sample jobs. It also sets up a plain Ubuntu server with its databases from the packages.
- **scripts**: The Multipass test VM, the old test containers with their seed scripts and four unused one-off scripts are removed.
