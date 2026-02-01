# MongoDB

Configure MongoDB databases for backup.

## Supported Versions

| Versions |
| :--- |
| 4.x, 5.x, 6.x, 7.x, 8.x |

DBackup uses `mongodump` from MongoDB Database Tools.

## Configuration

### Basic Settings

| Field | Description | Default |
| :--- | :--- | :--- |
| **Connection URI** | Full MongoDB URI (overrides other settings) | Optional |
| **Host** | Database server hostname | `localhost` |
| **Port** | MongoDB port | `27017` |
| **User** | Database username | Optional |
| **Password** | Database password | Optional |
| **Auth Database** | Authentication database | `admin` |
| **Database** | Database name(s) to backup | All databases |

### Advanced Options

| Field | Description |
| :--- | :--- |
| **Additional Options** | Extra `mongodump` flags |

## Connection Methods

### Using Connection URI (Recommended)

For complex setups (replica sets, Atlas, SRV records):

```
mongodb+srv://user:password@cluster.mongodb.net/mydb?retryWrites=true
```

### Using Host/Port

For simple setups:
- **Host**: `mongodb.example.com`
- **Port**: `27017`
- **User**: `backup_user`
- **Password**: `your_password`
- **Auth Database**: `admin`

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

DBackup uses `mongodump` which creates a binary BSON dump:

- Consistent point-in-time backup
- Includes indexes and collection options
- Supports oplog for replica set backups

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

## Additional Options Examples

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

For replica sets, use the connection URI:

```
mongodb://user:pass@rs1.example.com:27017,rs2.example.com:27017,rs3.example.com:27017/mydb?replicaSet=myRS
```

Or set read preference:
```bash
# Additional Options
--readPreference=secondaryPreferred
```

## Sharded Cluster Configuration

For sharded clusters, connect to a `mongos` router:

```
mongodb://user:pass@mongos1.example.com:27017,mongos2.example.com:27017/admin
```

::: warning Sharded Cluster Backup
For production sharded clusters, consider using MongoDB's native backup solutions (Cloud Backup, Ops Manager) for consistent snapshots.
:::

## Authentication

### SCRAM Authentication (Default)

Works automatically when you provide user/password.

### x.509 Certificate

```bash
# Additional Options
--ssl --sslCAFile=/path/to/ca.pem --sslPEMKeyFile=/path/to/client.pem
```

### LDAP Authentication

```
mongodb://ldapuser:ldappass@host:27017/mydb?authMechanism=PLAIN&authSource=$external
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
4. For SRV records, ensure DNS is accessible

### Insufficient Permissions

```
not authorized on admin to execute command
```

**Solution**: Grant backup role:
```javascript
db.grantRolesToUser("dbackup", [{ role: "backup", db: "admin" }])
```

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

## Best Practices

1. **Use `backup` role** instead of `root` for backup user
2. **Enable oplog** for point-in-time recovery with replica sets
3. **Schedule during low-traffic periods**
4. **Use secondary read preference** for replica sets
5. **Test restores regularly** to verify backup integrity
6. **Monitor backup duration** for performance tuning
7. **Consider compression** (enabled by default in mongodump 100.x)
