### 🐛 Bug Fixes

- **Recovery Kit**: The instructions in the kit and the help of the tool say that `--extract` writes into the folder it is given.
- **jobs**: The None option of the PostgreSQL dump compression says that DBackup compresses the dump, not the whole backup.

### 📝 Documentation

- **wiki**: The guides for PostgreSQL, MySQL, MongoDB, Redis and Valkey describe the tools, the archive and the restore of the current version, and no longer promise Sentinel, the oplog or restore options that do not exist.
- **wiki**: The pages on encryption, compression, verification, destinations and the Recovery Kit describe the archive and `dbackup-recover.js` as they work today.
