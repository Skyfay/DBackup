### 🐛 Bug Fixes

- **retention**: Retention keeps an incremental chain as a whole while the metadata of one of its backups is missing or unreadable, or its full backup is gone, so it no longer deletes a full backup that later backups still need. Other backups and complete chains go as the policy says. ([#206](https://github.com/Skyfay/DBackup/issues/206))
