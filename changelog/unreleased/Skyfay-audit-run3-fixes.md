### 🔒 Security

- **rsync**: A connection config can no longer set the address ssh dials or the options of the host key check itself, which could run a command on the DBackup server. Fields of that kind are refused when a connection is saved or tried.
- **Azure SQL**: A stored config can no longer move the connection into an SSH mode the adapter does not have.
- **Database Explorer**: The table browser of a connection form dials the checked address of a tenant that blocks the local network, like every other read.
- **tenants**: The saved login of a destination shared with customers no longer signs in at a host named in the test, SSH test, database list or snapshot check of a form.
- **tenants**: A write through the view of a customer fails once the destination is no longer shared with it, so a restore that outlives the share leaves nothing in the folder of the provider.
- **tenants**: Deleting a tenant also locks the accounts of no tenant whose email its sign-in provider claims. A new user whose group is deleted while it is made is removed again.
- **audit**: The entry of a bulk delete of users names the tenants of the accounts, so a view that does not reach them hides it.
- **config restore**: A configuration file from before the tenants no longer makes an existing account that is no platform admin one, and leaves it out with a note instead.

### 🐛 Bug Fixes

- **storage**: A backup takes the job, server and lock of the sidecar beside it, also when a backup of the same name lies in another folder.
