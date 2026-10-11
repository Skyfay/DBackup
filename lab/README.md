# Dev Lab

Containers to develop and test DBackup against: every database engine with test data, a server for every self-hostable destination and a receiver for every notification channel, plus a seed that fills the local database of DBackup with all of it and the first user.

```bash
pnpm lab:init --email you@example.com
pnpm lab:up
pnpm lab:seed
pnpm dev
```

The whole guide, with every command and the config: [docs/developer-guide/reference/dev-lab.md](../docs/developer-guide/reference/dev-lab.md).

| Folder | Holds |
| :--- | :--- |
| `compose/` | One Compose file per part: databases, storage, notify, and the image of the SSH host |
| `datasets/` | The test data of each engine, loaded once by `lab:up` |
| `provision/` | The setup of a native server, run by `lab:provision <host>` |
| `src/` | The commands, the catalog of every service with its port and credentials, and the seed |

The tests against the lab live in `tests/lab/` and run with `pnpm test:lab`.
