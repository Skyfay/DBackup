### 🐛 Bug Fixes

- **SMB**: uploads now create nested destination directories and report directory creation failures before transferring files. Paths beginning with a slash remain relative to the share. [#184](https://github.com/Skyfay/DBackup/issues/184)
