### 🔒 Security

- **rsync**: A connection config can no longer set the address ssh dials or the options of the host key check itself, which could run a command on the DBackup server. Fields of that kind are refused when a connection is saved or tried.
- **Azure SQL**: A stored config can no longer move the connection into an SSH mode the adapter does not have.
