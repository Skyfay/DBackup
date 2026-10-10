# MongoDB

Configure MongoDB databases for backup.

## Supported Versions

| Versions |
| :--- |
| 4.x, 5.x, 6.x, 7.x, 8.x |

DBackup uses `mongodump` and `mongorestore` from MongoDB Database Tools.

## Connection Modes

| Mode | Description |
| :--- | :--- |
| **Direct** | DBackup connects to the database port and runs `mongodump` itself |
| **Over SSH** | DBackup logs into a server over SSH and runs `mongodump` there. Marked **Beta** in the form |

## Prerequisites

### Direct Mode

The DBackup server needs `mongodump` and `mongorestore`. The Docker image ships both. The connection test, the database list and the [Database Explorer](/user-guide/features/database-explorer) use the MongoDB driver built into DBackup, so `mongosh` is not needed.

### SSH Mode

DBackup runs every step on the SSH server, so the tools have to be installed there:

| Tool | Used for |
| :--- | :--- |
| `mongodump` | Backups |
| `mongorestore` | Restores |
| `mongosh`, or the legacy `mongo` shell | Connection test, database list, Database Explorer |

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

See the official docs for other platforms: [MongoDB Database Tools](https://www.mongodb.com/docs/database-tools/installation/installation-linux/) and [mongosh](https://www.mongodb.com/docs/mongodb-shell/install/).

</details>

## Configuration

::: info Credential Profile required
MongoDB needs a [Credential Profile](/user-guide/security/credential-profiles). Create a `USERNAME_PASSWORD` profile in **Vault → Credentials** before saving the source. Without one the source cannot connect, even to a server that runs without authentication, so create a user there as well. Over SSH also needs an `SSH_KEY` profile.
:::

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **How DBackup connects** | **Direct** or **Over SSH** | - | ✅ |
| **Host** | Hostname, a `mongodb+srv://` host or a comma-separated seed list. See [Connection Methods](#connection-methods) | `localhost` | ✅ |
| **Port** | MongoDB port, unused with SRV | `27017` | ✅ |
| **Login** | `USERNAME_PASSWORD` credential profile | - | ✅ |
| **Authentication database** | Database the login is defined in, under **Options** | `admin` | ❌ |
| **Extra options** | Extra `mongodump` flags, under **Options** | - | ❌ |

The databases are picked in the job, not on the source. **All databases** asks the server with `listDatabases` and leaves out `admin`, `config` and `local`, and **Some databases** never offers them either. Users and roles stored in `admin` are therefore not part of a backup.

### SSH Mode Fields

These fields appear in the **SSH server** part when **How DBackup connects** is set to **Over SSH**:

| Field | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| **SSH host** | SSH server hostname or IP | - | ✅ |
| **Port** | SSH server port | `22` | ❌ |
| **SSH login** | `SSH_KEY` credential profile (username + key or password) | - | ✅ |

::: tip Host in SSH Mode
The **Host** field in the **Database** part is the MongoDB hostname **as seen from the SSH server**. If MongoDB runs on the same machine, use `127.0.0.1`.
:::

## Connection Methods

DBackup builds the connection string from **Host**, **Port** and the Login. There is no separate URI field. A connection string pasted into **Host** is reduced to its hosts: its credentials and its query parameters such as `?tls=true` or `replicaSet=` are dropped.

### MongoDB Atlas and Other SRV Clusters

Put the cluster hostname in **Host** and nothing else, for example `cluster0.ab12c.mongodb.net`. Any host under `mongodb.net` is connected with `mongodb+srv://`, which brings TLS with it. For a self-hosted cluster that publishes its own SRV record, write the scheme out: `mongodb+srv://mongo.example.com`.

With SRV the **Port** field is ignored, because the SRV record names a port for every host and a connection string that also carries one is rejected. Outside SRV, DBackup connects without TLS.

### Replica Sets and Sharded Clusters

List the members in **Host**, separated by commas. Members without their own port use the **Port** field:

```
rs1.example.com:27017,rs2.example.com:27017,rs3.example.com:27017
```

For a sharded cluster, list the `mongos` routers the same way. For production sharded clusters, MongoDB's own backup tools give consistent snapshots across shards.

## Setting Up a Backup User

Create a dedicated user with the `backup` role, and add `restore` if DBackup should restore into this server:

```javascript
use admin

db.createUser({
  user: "dbackup",
  pwd: "secure_password_here",
  roles: [
    { role: "backup", db: "admin" },
    { role: "restore", db: "admin" }
  ]
})
```

The Login authenticates with SCRAM against the **Authentication database**. x.509, LDAP and Kerberos are not supported, since **Extra options** reach `mongodump` only and not the connection test or `mongorestore`.

::: tip MongoDB Atlas
For Atlas clusters, create the database user in the Atlas UI and give it read access to every database DBackup should back up.
:::

## How It Works

For every database of the job, DBackup runs:

```bash
mongodump <connection> --db <name> --archive=<file> --gzip [Extra options]
```

- Each database becomes one gzip-compressed mongodump archive, stored in the job's backup as `databases/<name>.archive`, under an opaque name when the backup is encrypted. DBackup does not compress it a second time. See [Archive Format](/developer-guide/reference/archive-format) for the layout.
- Collections are dumped one after another, and `--oplog` cannot be combined with `--db`. Writes made while the dump runs can therefore be caught in part.
- Over SSH, `mongodump` writes the archive to a temporary file on the SSH server. DBackup fetches it over SFTP, or with `cat` where SFTP is not available, and deletes it afterwards.

**Extra options** apply to every database of the job. Useful flags:

```bash
--excludeCollection=logs --excludeCollection=sessions
--readPreference=secondaryPreferred
--numParallelCollections=4
```

## Restore

Restore a backup from the **Backups** page, see [Restore](/user-guide/features/restore). For every database DBackup runs:

```bash
mongorestore <connection> --archive=<file> --gzip --drop --nsInclude '<name>.*'
```

A database restored under a new name gets `--nsFrom '<old>.*' --nsTo '<new>.*'` instead of `--nsInclude`. `--drop` replaces every collection the backup holds, and collections that exist only on the server stay. In direct mode DBackup first checks that the Login may create a collection in each target database.

A database downloaded from the Backups page is the same archive and restores by hand with `mongorestore --archive=<file> --gzip`.

## Troubleshooting

### Authentication Failed

```
Connection failed: Authentication failed.
```

**Solution:** Check the username and password of the Login, that the **Authentication database** is the one the user was created in (usually `admin`), and that the user has the `backup` role.

### Connection Timeout

```
Connection failed: Server selection timed out after 10000 ms
```

**Solution:** Check the hostname, port and firewall rules. For a cloud cluster, add the DBackup server's IP to the provider's access list.

### Host Not Found or Refused

```
Connection failed: getaddrinfo ENOTFOUND cluster0.ab12c.mongodb.net
Connection failed: connect ECONNREFUSED 144.2.71.216:27017
```

DBackup did not recognise the cluster as an SRV one and tried to reach it directly.

**Solution:**
1. Put the cluster **hostname** in **Host**, never an IP address. An IP cannot carry an SRV record.
2. Put nothing else in the field, so no `https://`, no trailing slash and no database name.
3. For a self-hosted SRV cluster outside `mongodb.net`, write the host as `mongodb+srv://your.host`.
4. Otherwise check that DBackup's own DNS can resolve the name, which in Docker means the container's DNS rather than the host's.

### Databases Cannot Be Listed

```
Could not list the databases on this server (...). Select the databases to back up in the job, or grant the backup user the right to list databases.
```

**Solution:** Give the Login the `backup` role, which includes the right to list databases.

### SSH: Binary Not Found

```
None of the following binaries were found on ssh://user@host:22: mongodump
```

**Solution:** Install MongoDB Database Tools on the SSH server, see [Prerequisites](#ssh-mode).

## Next Steps

- [Create a Backup Job](/user-guide/jobs/)
- [Enable Encryption](/user-guide/security/encryption)
- [Configure Retention](/user-guide/jobs/retention)
