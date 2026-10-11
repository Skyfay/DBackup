# Dev Lab

Containers to develop and test DBackup against: every database engine with test data, a server for every self-hostable destination and a receiver for every notification channel, plus a seed that fills the local database of DBackup with all of it and the first user.

```bash
pnpm lab:init --email you@example.com
pnpm lab:up
pnpm lab:seed
pnpm dev
```

`pnpm lab` shows every command in a menu, `pnpm lab:status` what runs and what is missing.

The whole guide, with every command and the config: [docs/developer-guide/reference/dev-lab.md](../docs/developer-guide/reference/dev-lab.md).

| Folder | Holds |
| :--- | :--- |
| `compose/` | One Compose file per part, all of them one project: databases, storage, notify, what only the end-to-end tests start, and the images of the SSH host and the customer server |
| `datasets/` | The test data of each engine, loaded once by `lab:up` |
| `provision/` | The setup of a native server, run by `lab:provision <name>` |
| `src/` | The commands, the status, the catalog of the storage servers and receivers, and the seed |
| `src/engines/` | One file per database engine: versions, ports, login, dataset, source config and fingerprint |

The end-to-end tests in `e2e/` run DBackup itself against the lab, `pnpm test:e2e`.
