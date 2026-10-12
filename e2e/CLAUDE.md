# End-to-End Tests

Playwright against the Docker image of this checkout. The guide for people is the section End-to-End Tests of `docs/developer-guide/reference/testing.md`.

```bash
pnpm test:e2e                          # Build the image, start what the families need, run every project
pnpm test:e2e --project ui             # One project, setup runs first by itself
E2E_FAMILIES=mysql,ui pnpm test:e2e    # Start and run only these families, ui for the browser tests
pnpm test:e2e:ui                       # Playwright UI mode
```

| Variable | Does |
| :--- | :--- |
| `E2E_FAMILIES` | Comma list of families from `support/targets.ts` and `ui`, all by default |
| `E2E_NO_BUILD=1` | Use the image `dbackup-e2e:local` built already, like CI does |
| `E2E_KEEP=1` | Leave DBackup running and the restored databases in place, to look at them |
| `E2E_PORT` | The port DBackup answers on, 3300 by default |

## How it fits together

- DBackup runs as the service `app` of `lab/compose/e2e.yml`, in the Compose project of the dev lab, on the Docker host of the lab config. It reaches every server by its service name, like a user's container does. CI runs the same project on the runner.
- `support/global-setup.ts` builds the image, starts the lab services the selected families need, loads their test data and starts DBackup from scratch. Afterwards it removes DBackup, the lab keeps running.
- Starting the services and loading their data lives in `support/services.ts`. `support/start-services.ts` runs just that, and CI starts it in the background while the image builds. The global setup repeats the steps, finds them done and reports what did not come up, so the head start never decides a run.
- In CI the tests are jobs of `.github/workflows/validate.yml`, beside lint and the unit tests. Its job Changes skips them for a pull request into `dev` that only touches paths in its `SKIP` pattern, and for the release, whose pull request into `main` ran them. A new folder the image or the tests read needs nothing there, one they never read can go into it.
- `lab/compose/e2e.yml` also holds what only the tests start: the customer server (Ubuntu with its packages, over OpenSSH) and a second FTP server that names itself for the passive mode.
- The project `setup` (`tests/first-start.setup.ts`) creates the first account through the first start page, lifts the rate limits, makes the Vault key `E2E key` and saves the session. Every other project depends on it and runs signed in.
- `ui` drives the browser. Each family of `support/targets.ts` is a project that runs the specs directly under `tests/` whose test names carry its tag, `[family]`, and a job of the CI matrix:

| Family | Specs | Covers |
| :--- | :--- | :--- |
| `postgres`, `mysql`, `mongodb`, `mssql` | `engines.spec.ts` | The containers of the engine, a few also over SSH |
| `small` | `engines.spec.ts`, `folders.spec.ts` | Redis, Valkey, Firebird, SQLite over SSH, a folder |
| `customer` | `engines.spec.ts` | The databases of the customer server over its OpenSSH |
| `storage` | `storage.spec.ts`, `notifications.spec.ts` | Every destination and every channel, with SQLite inside DBackup as the source |

- What an engine looks like, its login, its source config and how its tools read a database, comes from its file under `lab/src/engines/`. A test never repeats that.

## Rules

- Go through `support/app.ts` for the API. The routes answer in different shapes (`data` for credentials and executions, the record itself for adapters and jobs, `executionId` for a run and a restore), and it retries a 429.
- Every name a test makes comes from `unique()`. Nothing is reset between tests, and a restored database is dropped in `finally`.
- Select by role and accessible name, and pass `exact: true`: names match as substrings otherwise, so "Name" also finds "Username". Scope to the dialog. A page without records shows its New button twice, in the head and in the empty state, so take `.first()`.
- The pages show a successful run as "Done", never as "Success". The API says `Success`.
- A Vault key can only be made on its page. A test that needs one uses `E2E key` of the setup.
- Never work around the rate limits with headers. The setup lifts them in Settings like a person would.
- A bug the tests found that is not fixed yet goes into `knownBug` of its target, one sentence on what fails. Its test runs as `test.fail()`, so it turns red once the bug is gone.
- A service that does not start on this machine for a reason outside DBackup, like MongoDB 5 and later on a CPU without AVX, skips its tests through `skipWhenUnavailable`. In CI the same fails the run.
- Files inside DBackup are made through `inApp` and handed to the user DBackup runs as, a SQLite source in local mode through `sqliteInApp`.
- A new engine: a target in a family of `support/targets.ts`. A new family: also a job in the matrix of `.github/workflows/validate.yml`. `tests/unit/lab/e2e-families.test.ts` fails when an engine has no family or the matrix and the families differ.
