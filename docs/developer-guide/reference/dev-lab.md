# Dev Lab

The dev lab is a set of containers to develop and test DBackup against: every supported database engine with test data, a server for every self-hostable destination, and a receiver for every notification channel. One command fills the local database of DBackup with all of it, including the first user, so a fresh checkout can be signed into and backs up right away.

Everything lives in `lab/` of the repository. It needs Docker and the client tools of [Project Setup](/developer-guide/setup).

## Quick Start

```bash
pnpm lab:init --email you@example.com   # writes ~/.config/dbackup/lab.json with a new password
pnpm lab:up                             # starts the containers and loads the test data
pnpm lab:seed                           # fills prisma/dev.db: user, connections, Vault key, jobs
pnpm dev
```

Sign in with the email and the password `lab:init` printed. They stay in `~/.config/dbackup/lab.json`.

## Commands

| Command | Does |
| :--- | :--- |
| `pnpm lab:init [--email] [--name] [--storage <folder>]` | Writes your config with a generated password, unless it exists |
| `pnpm lab:up [--full]` | Starts every part on the host the config places it on, and loads the test data once |
| `pnpm lab:down [--volumes]` | Stops the containers. `--volumes` also removes their data |
| `pnpm lab:status` | Every service with its state and address |
| `pnpm lab:seed [--history]` | Adds the lab to the database of this checkout. `--history` adds 30 days of runs and storage snapshots |
| `pnpm lab:check [--run]` | Runs Test connection on every lab connection. `--run` also runs every lab job once and waits for it |
| `pnpm test:lab` | The automated tests against the lab, with a database of their own, see [Testing](/developer-guide/reference/testing#against-real-servers) |
| `pnpm lab:reset [--empty] [--history]` | A new `dev.db` from the migrations, then the seed. `--empty` leaves it without a user, for the first start and the configuration restore |
| `pnpm lab:provision <host>` | Sets up a native host: its databases from the packages, the test data and an OpenSSH login, see [A Native Server](#a-native-server) |
| `pnpm lab:clean <workspace>` | Removes the backups of a workspace from every destination |

The seed can run as often as you like. It creates the first user only while there is none, finds every other record by its name and brings it up to date.

## What It Contains

| Part | Services |
| :--- | :--- |
| Databases | MySQL 5.7 and 9, MariaDB 10.4 and 11.8, PostgreSQL 12 and 18, MongoDB 4.4 and 8.0, SQL Server 2017 and 2022, Redis 6 and 8, Valkey 7.2 and 8, Firebird 3 and 5. `--full` adds the versions between |
| Storage | S3 (SeaweedFS), an OpenSSH host for SFTP and rsync, WebDAV, Samba and FTP |
| Notifications | Mailpit, ntfy, Gotify and a webhook echo |

Every database holds the same `shop` and `inventory` databases: Unicode, NULLs, binary data, decimals and dates, plus what the engine adds, like routines and events in MySQL or schemas and sequences in PostgreSQL. The SSH host reaches the databases by name, so a few sources also come in SSH mode, and it holds a SQLite database.

The ports, versions and test credentials are listed in `lab/src/catalog.ts`. Mailpit shows every mail at port 8025.

## Workspaces

Every checkout writes its backups into a folder of its own on each destination, named after the checkout: `main` for the primary one, the folder name for a git worktree. Two checkouts sharing one folder would see each other's backups and delete them with their retention.

`scripts/setup-worktree.sh` copies `.env` and `dev.db` of the primary checkout into a new worktree. With a lab config of your own it also runs `pnpm lab:seed`, which points the destinations at the folders of the new worktree.

## The Config

The lab reads the first config it finds: the file in `DBACKUP_LAB_CONFIG`, then `~/.config/dbackup/lab.json`, then `lab/lab.config.example.json`, which runs everything on this machine.

```json
{
    "admin": { "name": "Dev", "email": "you@example.com", "password": "env:LAB_ADMIN_PASSWORD" },
    "storageRoot": "/srv/dbackup-lab",
    "profile": "core",
    "hosts": {
        "lab": { "docker": "lab-server", "address": "192.168.1.20", "ssh": { "user": "root", "password": "env:LAB_ROOT_PASSWORD" } },
        "customer": {
            "address": "192.168.1.30",
            "ssh": { "user": "root" },
            "native": { "ssh": { "user": "dbackup", "port": 2222, "password": "env:LAB_NATIVE_PASSWORD" } }
        }
    },
    "place": { "databases": "lab", "storage": "lab", "notify": "local" }
}
```

| Field | Description | Default |
| :--- | :--- | :--- |
| `admin` | The first user. A password of `env:NAME` is read from that environment variable. It has to follow the Standard password rules of DBackup | |
| `storageRoot` | Folder of this machine for the Local destination, the local SQLite database and the files of the directory backup | `.lab-storage` in the repository |
| `profile` | `core` for the oldest and newest version of each engine, `full` for every version | `core` |
| `hosts` | Hosts by name: the [docker context](https://docs.docker.com/engine/manage-resources/contexts/) of a Docker host, the address DBackup reaches it under, an `ssh` login and a `native` part for a server without Docker. `local` always exists | `local` |
| `place` | Which host runs the databases, the storage servers and the notification receivers | `local` |

## A Remote Docker Host

A remote host needs nothing but Docker and a docker context pointing at it:

```bash
docker context create lab-server --docker "host=ssh://root@192.168.1.20"
```

The Compose files mount nothing from this machine, and the test data goes in through the clients of the containers, so the same files run there unchanged. Prefer an IPv4 address in the config, host names may resolve to IPv6 first.

SQL Server writes its backups into a folder of the Docker host. With the databases on this machine DBackup reads that folder, on a remote host it fetches the files over SFTP, with the `ssh` login of the host. Without one the seed leaves SQL Server out.

## A Native Server

Most servers DBackup backs up run their databases from the packages of their distribution, not in containers. A host with a `native` part stands for one of those. `pnpm lab:provision <host>` sets up a plain Ubuntu 24.04 as root, over the `ssh` login of the host and the ssh client of this machine:

- PostgreSQL 16, MySQL 8.0, Redis and MongoDB 8 from the packages, with the test data, and a SQLite database in the home folder of the login.
- One login for OpenSSH and every database, with the user and password of `native.ssh`. MySQL keeps `auth_socket` for root, as Ubuntu installs it.
- OpenSSH on an extra port, 2222 by default, where a wrong password fails like on any server. Use that port in `native.ssh` when port 22 of the host is not OpenSSH.

The seed then adds every database of the host as a source in SSH mode. Ubuntu has no `mariadb-dump`, so the MySQL source also covers the fallback to `mysqldump`.

MongoDB 5 and later need a CPU with AVX. A virtual machine with a generic CPU model has none, so give it the CPU type of its host, or MongoDB 8.0 does not start there, in a container or from the packages.

## Adding an Engine or Version

1. A service in `lab/compose/databases.yml` with a port of its own, a volume and a healthcheck.
2. The same service with its port in `DATABASES` of `lab/src/catalog.ts`. `tests/unit/lab/lab-parts.test.ts` checks that both agree.
3. For a new engine: a dataset in `lab/datasets/`, a loader in `lab/src/datasets.ts`, the login in `DATABASE_LOGINS`, the source config in `lab/src/seed/connections.ts`, and a fingerprint and a drop in `tests/lab/support/places.ts`, so the round trip can read a restore.
4. `pnpm lab:up && pnpm lab:seed && pnpm test:lab`.
