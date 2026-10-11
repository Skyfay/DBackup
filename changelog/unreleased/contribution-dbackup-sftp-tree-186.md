### 🐛 Bug Fixes

- **SFTP**: Source directory scans reuse one SSH connection with at most eight directory reads in flight and close failed connections. [#186](https://github.com/Skyfay/DBackup/issues/186)
