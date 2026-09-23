# MongoDB

Configure MongoDB databases for backup.

## Supported Versions

| Versions |
| :--- |
| 4.x, 5.x, 6.x, 7.x, 8.x |

DBackup uses `mongodump` from MongoDB Database Tools.

## Connection Modes

| Mode | Description |
| :--- | :--- |
| **Direct** | DBackup connects via TCP and runs `mongodump` locally |
| **Over SSH** | DBackup connects via SSH and runs `mongodump` on the remote host |

## Configuration

::: info Credential Profiles
A [Credential Profile](/user-guide/security/credential-profiles) is **optional** for MongoDB — instances without authentication can connect without one. If your MongoDB requires login credentials, create a `USERNAME_PASSWORD` profile in **Settings → Vault → Credentials** first. SSH mode requires an `SSH_KEY` profile.
:::

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **How DBackup connects** | **Direct** or **Over SSH** | - | ✅ |
| **Host** | Database server hostname, or a comma-separated seed list | `localhost` | ✅ |
| **Port** | MongoDB port | `27017` | ✅ |
| **Login** | `USERNAME_PASSWORD` credential profile (username + password) | - | ❌ |
| **Authentication database** | Authentication database | `admin` | ❌ |
| **Database** | Database name(s) to backup | All databases | ❌ |
| **Extra options** | Extra `mongodump` flags | - | ❌ |

### SSH Mode Fields

These fields appear in the **SSH server** part when **How DBackup connects** is set to **Over SSH**:

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **SSH host** | SSH server hostname or IP | - | ✅ |
| **Port** | SSH server port | `22` | ❌ |
| **SSH login** | `SSH_KEY` credential profile (username + key or password) | - | ✅ |

## Prerequisites

### Direct Mode

The DBackup server needs `mongodump`, `mongorestore`, and `mongosh` CLI tools installed.

**Docker**: Already included in the DBackup image.

### SSH Mode

The **remote SSH server** must have the following tools installed:

```bash
# Required for backup
mongodump

# Required for restore
mongorestore

# Required for connection testing and database listing
mongosh
```

**Install on the remote host:**

<details>
<summary>Debian/Ubuntu - MongoDB Database Tools + mongosh</summary>

Add the official MongoDB repository first:
```bash
# Import MongoDB GPG key
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | \
  gpg --dearmor -o /usr/share/keyrings/mongodb-server-8.0.gpg

# Add repository (Debian 12 / Ubuntu 24.04 example)
echo "deb [signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg] https://repo.mongodb.org/apt/debian bookworm/mongodb-org/8.0 main" | \
  tee /etc/apt/sources.list.d/mongodb-org-8.0.list

# Install tools
apt-get update
apt-get install mongodb-database-tools mongodb-mongosh
```

See the official docs for other distro versions:
- [MongoDB Database Tools](https://www.mongodb.com/docs/database-tools/installation/installation-linux/)
- [mongosh](https://www.mongodb.com/docs/mongodb-shell/install/)

</details>

```bash
# macOS
brew install mongodb-database-tools
brew install mongosh
```

::: danger Important
In SSH mode, the MongoDB tools must be installed on the remote server. DBackup executes them remotely via SSH and streams the output back.
:::

## Connection Methods

DBackup builds the connection string from the **Host** and **Port** fields plus the credential profile. There is no separate URI field.

### Single Server

- **Host**: `mongodb.example.com`
- **Port**: `27017`
- **Login**: a `USERNAME_PASSWORD` profile
- **Authentication database**: `admin`

### MongoDB Atlas and Other SRV Clusters

Put the cluster hostname in **Host** and nothing else:

```
cluster0.ab12c.mongodb.net
```

DBackup recognises it, connects with `mongodb+srv://` and leaves the **Port** field unused. TLS comes with that scheme, so it needs no separate setting. Any host under `mongodb.net` is recognised automatically. For a self-hosted cluster that publishes its own SRV record, write the scheme out to ask for the same treatment:

```
mongodb+srv://mongo.example.com
```

::: info Why the port is ignored here
An SRV record names a port for every host it points at, so a connection string that also carries one is rejected. This is also why the plain hostname of an Atlas cluster resolves to nothing.
:::

### Replica Sets

List the members in **Host**, separated by commas. Members without their own port use the **Port** field:

```
rs1.example.com:27017,rs2.example.com:27017,rs3.example.com:27017
```

## Setting Up a Backup User

Create a dedicated user with the `backup` role:

```javascript
// Connect to admin database
use admin

// Create backup user
db.createUser({
  user: "dbackup",
  pwd: "secure_password_here",
  roles: [
    { role: "backup", db: "admin" }
  ]
})

// For restore operations, also add:
db.grantRolesToUser("dbackup", [
  { role: "restore", db: "admin" }
])
```

::: tip MongoDB Atlas
For Atlas clusters, create a user with "Backup Admin" role in the Atlas UI.
:::

## Backup Process

### Direct Mode

DBackup uses `mongodump` which creates a binary BSON dump:

- Consistent point-in-time backup
- Includes indexes and collection options
- Supports oplog for replica set backups

### SSH Mode

In SSH mode, DBackup:

1. Connects to the remote server via SSH
2. Checks that `mongodump` is available on the remote host
3. Executes `mongodump --archive --gzip` remotely
4. Streams the archive output back over the SSH connection
5. Applies additional encryption locally
6. Uploads to the configured storage destination

::: tip Host in SSH Mode
The **Host** field refers to the MongoDB hostname **as seen from the SSH server**. If MongoDB runs on the same machine as the SSH server, use `127.0.0.1` or `localhost`.
:::

### Output Format

The backup creates a directory structure:
```
dump/
├── admin/
│   └── system.version.bson
├── mydb/
│   ├── users.bson
│   ├── users.metadata.json
│   └── orders.bson
```

This is archived and optionally compressed.

## Multi-Database Backups

When backing up multiple databases, DBackup creates a **TAR archive** containing individual `mongodump --archive` files:

```
backup.tar
├── manifest.json      # Metadata about contained databases
├── database1.archive  # Individual mongodump archive per database
├── database2.archive
└── ...
```

### Features

- **Selective Restore**: Choose which databases to restore from a multi-DB backup
- **Database Renaming**: Uses `--nsFrom/--nsTo` to restore to different database names
- **True Multi-DB**: Unlike previous versions, you can now backup any combination of databases (not just "all or one")

::: warning Breaking Change (v0.9.1)
Multi-DB backups created before v0.9.1 cannot be restored with newer versions.
:::

## Extra Options Examples

```bash
# Backup specific collection
--collection=users

# Exclude collections
--excludeCollection=logs --excludeCollection=sessions

# Include oplog (for point-in-time recovery)
--oplog

# Query filter (backup subset of data)
--query='{"createdAt":{"$gte":{"$date":"2024-01-01T00:00:00Z"}}}'

# Read preference for replica sets
--readPreference=secondary

# Parallel collections
--numParallelCollections=4
```

## Replica Set Configuration

Put the members in the **Host** field as a comma-separated list, as shown under [Connection Methods](#replica-sets). To read from a secondary instead of the primary:

```bash
# Extra options
--readPreference=secondaryPreferred
```

## Sharded Cluster Configuration

For sharded clusters, point **Host** at the `mongos` routers:

```
mongos1.example.com:27017,mongos2.example.com:27017
```

::: warning Sharded Cluster Backup
For production sharded clusters, consider using MongoDB's native backup solutions (Cloud Backup, Ops Manager) for consistent snapshots.
:::

## Authentication

### SCRAM Authentication (Default)

Works automatically when you provide user/password.

### x.509 Certificate

```bash
# Extra options
--ssl --sslCAFile=/path/to/ca.pem --sslPEMKeyFile=/path/to/client.pem
```

### LDAP Authentication

```bash
# Extra options
--authenticationMechanism=PLAIN --authenticationDatabase='$external'
```

## Troubleshooting

### Authentication Failed

```
authentication failed
```

**Solutions**:
1. Verify username/password
2. Check `authSource` is correct (usually `admin`)
3. Ensure user has required roles

### Connection Timeout

```
no reachable servers
```

**Solutions**:
1. Check network connectivity
2. Verify hostname/port
3. Check firewall rules
4. For a cloud cluster, add the DBackup server's IP to the provider's access list

### Host Not Found or Refused

```
Connection failed: getaddrinfo ENOTFOUND cluster0.ab12c.mongodb.net
Connection failed: connect ECONNREFUSED 144.2.71.216:27017
```

DBackup did not recognise the cluster as an SRV one and tried to reach it directly.

**Solutions**:
1. Put the cluster **hostname** in **Host**, never an IP address. An IP cannot carry an SRV record, so the cluster can only be found by name
2. Put nothing else in the field, so no `https://`, no trailing slash and no database name
3. For a self-hosted SRV cluster outside `mongodb.net`, write the host as `mongodb+srv://your.host`
4. Otherwise check that DBackup's own DNS can resolve the name, which in Docker means the container's DNS rather than the host's

### Insufficient Permissions

```
not authorized on admin to execute command
```

**Solution**: Grant backup role:
```javascript
db.grantRolesToUser("dbackup", [{ role: "backup", db: "admin" }])
```

### SSH: Binary Not Found

```
Required binary not found on remote server. Tried: mongodump
```

**Solution:** Install MongoDB Database Tools on the remote server. See [MongoDB Database Tools Installation](https://www.mongodb.com/docs/database-tools/installation/).

## Restore

To restore a MongoDB backup:

1. Go to **Storage Explorer**
2. Find your backup file
3. Click **Restore**
4. Select target database configuration
5. Optionally map database names
6. Confirm and monitor progress

### Restore Options

- **Drop existing data**: Clean restore
- **Preserve existing data**: Merge/upsert mode
- **Specific collections**: Restore selected collections only

## Next Steps

- [Create a Backup Job](/user-guide/jobs/)
- [Enable Encryption](/user-guide/security/encryption)
- [Configure Retention](/user-guide/jobs/retention)
