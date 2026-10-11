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

`pnpm lab` shows every command in a menu, like `pnpm toolbox`. Picked there, a command asks for what it would otherwise take as an argument. `pnpm lab <command>` and `pnpm lab:<command>` run one directly.

| Command | Does |
| :--- | :--- |
| `pnpm lab:status` | Checks everything and says what to run next, see [Status](#status) |
| `pnpm lab:up [--full]` | Starts the lab on its Docker host and loads the test data once. Prints one line per part and one per service that did not come up |
| `pnpm lab:down [--volumes]` | Stops the containers. `--volumes` also removes their data |
| `pnpm lab:seed [--history]` | Adds the lab to the database of this checkout. `--history` adds 30 days of runs and storage snapshots |
| `pnpm lab:check [--run]` | Runs Test connection on every lab connection. `--run` also runs every lab job once and waits for it |
| `pnpm lab:reset [--empty] [--history]` | A new `dev.db` from the migrations, then the seed. `--empty` leaves it without a user, for the first start and the configuration restore |
| `pnpm lab:clean <workspace>` | Removes the backups of a workspace from every destination |
| `pnpm lab:provision <name>` | Sets up a native server: its databases from the packages, the test data and an OpenSSH login, see [A Native Server](#a-native-server) |
| `pnpm lab:init [--email] [--name] [--storage <folder>]` | Writes your config with a generated password, unless it exists |
| `pnpm test:e2e` | The end-to-end tests: the image of this checkout beside the lab, see [Testing](/developer-guide/reference/testing#end-to-end-tests) |

The seed can run as often as you like. It creates the first user only while there is none, finds every other record by its name and brings it up to date.

## Status

`pnpm lab:status` takes a few seconds and looks at everything the lab needs:

| Part | Shows |
| :--- | :--- |
| Every service | Its state and address, whether a database holds the test data, and why a container stopped, like a CPU without the AVX that MongoDB 5 and later need |
| Native servers | Whether OpenSSH answers and which database services run |
| Dev database | Whether `dev.db` exists, is migrated and seeded, and whether its destinations point at the folders of this workspace |
| Client tools | The version of every tool DBackup runs when it backs up from this machine, and where the Docker image ships another |
| Port 3000 | Whether DBackup answers there, and from which checkout |

It ends with the commands that fix what it found, and exits with 1 while anything failed.

## What It Contains

| Part | Services |
| :--- | :--- |
| Databases | MySQL 5.7 and 9, MariaDB 10.4 and 11.8, PostgreSQL 12 and 18, MongoDB 4.4 and 8.0, SQL Server 2017 and 2022, Redis 6 and 8, Valkey 7.2 and 8, Firebird 3 and 5. `--full` adds the versions between |
| Storage | S3 (SeaweedFS), an OpenSSH host for SFTP and rsync, WebDAV, Samba and FTP |
| Notifications | Mailpit, ntfy, Gotify and a webhook echo |

Every database holds the same `shop` and `inventory` databases: Unicode, NULLs, binary data, decimals and dates, plus what the engine adds, like routines and events in MySQL or schemas and sequences in PostgreSQL. The SSH host reaches the databases by name, so a few sources also come in SSH mode, and it holds a SQLite database.

All of it is one Compose project, `dbackup-lab`, made of `lab/compose/databases.yml`, `storage.yml` and `notify.yml`. `e2e.yml` adds DBackup itself, a customer server with the databases of Ubuntu and a second FTP server under the profile `e2e`, which only the [end-to-end tests](/developer-guide/reference/testing#end-to-end-tests) start. The versions, ports and test credentials of each engine are in its file under `lab/src/engines/`, the storage servers and receivers in `lab/src/catalog.ts`. Mailpit shows every mail at port 8025.

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
    "docker": { "context": "lab-server", "address": "192.168.1.20", "ssh": { "user": "root", "password": "env:LAB_ROOT_PASSWORD" } },
    "native": {
        "customer": {
            "address": "192.168.1.30",
            "ssh": { "user": "root" },
            "login": { "user": "dbackup", "port": 2222, "password": "env:LAB_NATIVE_PASSWORD" }
        }
    }
}
```

| Field | Description | Default |
| :--- | :--- | :--- |
| `admin` | The first user. A password of `env:NAME` is read from that environment variable. It has to follow the Standard password rules of DBackup | |
| `storageRoot` | Folder of this machine for the Local destination, the local SQLite database and the files of the directory backup | `.lab-storage` in the repository |
| `profile` | `core` for the oldest and newest version of each engine, `full` for every version | `core` |
| `docker` | The Docker host of the whole lab: its [docker context](https://docs.docker.com/engine/manage-resources/contexts/), the address DBackup reaches its ports under, and an `ssh` login for SQL Server, see [A Remote Docker Host](#a-remote-docker-host) | this machine |
| `native` | Servers without Docker by name: their address, an `ssh` login that may run the setup as root, and the `login` of their sources, see [A Native Server](#a-native-server) | none |

Every field is checked, and one the lab does not know is refused, so a typo does not go unnoticed.

## A Remote Docker Host

The whole lab runs on one Docker host. A remote one needs nothing but Docker and a docker context pointing at it:

```bash
docker context create lab-server --docker "host=ssh://root@192.168.1.20"
```

The Compose files mount nothing from this machine, and the test data goes in through the clients of the containers, so the same files run there unchanged. Prefer an IPv4 address in the config, host names may resolve to IPv6 first.

SQL Server writes its backups into a folder of the Docker host. With the databases on this machine DBackup reads that folder, on a remote host it fetches the files over SFTP, with the `ssh` login of the host. Without one the seed leaves SQL Server out.

## A Native Server

Most servers DBackup backs up run their databases from the packages of their distribution, not in containers. A server under `native` stands for one of those. `pnpm lab:provision <name>` sets up a plain Ubuntu 24.04 as root, over its `ssh` login and the ssh client of this machine:

- PostgreSQL 16, MySQL 8.0, Redis and MongoDB 8 from the packages, with the test data, and a SQLite database in the home folder of the login.
- One login for OpenSSH and every database, with the user and password of `login`. MySQL keeps `auth_socket` for root, as Ubuntu installs it.
- OpenSSH on an extra port, 2222 by default, where a wrong password fails like on any server. Use that port in `login` when port 22 of the server is not OpenSSH.

The seed then adds every database of the server as a source in SSH mode. The end-to-end tests do not need such a server: the container `customer` of `lab/compose/e2e.yml` installs the same packages and stands in for it. Ubuntu has no `mariadb-dump`, so the MySQL source also covers the fallback to `mysqldump`.

MongoDB 5 and later need a CPU with AVX. A virtual machine with a generic CPU model has none, so give it the CPU type of its host, or MongoDB 8.0 does not start there, in a container or from the packages.

## Adding an Engine or Version

Everything the lab knows about an engine is in its file under `lab/src/engines/`: the versions with their services and ports, the login, the clients in the container, the dataset with how to check for it and load it, the config of a source, and how its tools read a database and drop one again. The catalog, the dataset loader, the seed, `lab:status` and the tests all read it from there.

1. A service in `lab/compose/databases.yml` with a port of its own, a volume and a healthcheck.
2. The version with the same service and port in the engine file. `tests/unit/lab/lab-parts.test.ts` checks that both agree.
3. For a new engine: a dataset in `lab/datasets/` and an engine file, added to `ENGINES` in `lab/src/engines/index.ts`.
4. The family of the engine in `e2e/support/targets.ts`, so the end-to-end tests back it up and restore it, then `pnpm lab:up && pnpm lab:seed && E2E_FAMILIES=<family> pnpm test:e2e`.
