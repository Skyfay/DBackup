# Job Runner & Scheduler Architecture

This document details the core engine of the Backup Manager: The system responsible for executing backups, handling retries, and managing the lifecycle of a job context.

## 1. The Singleton Scheduler (`src/lib/runner/scheduler.ts`)

To avoid race conditions and double-executions (especially in serverless or development environments with HMR), the Scheduler is implemented as a global **Singleton**.

*   **Responsibility**:
    *   Loads active Jobs from DB on startup.
    *   Uses `node-cron` to schedule ticks.
    *   Maintains a generic `Map<JobId, CronTask>` to track active timers.
*   **Safety**: Ensure `initScheduler()` is only called once in `instrumentation.ts`.

## 2. The Runner Pipeline Pattern

We avoid "God Functions". The execution of a job (`src/lib/runner.ts`) is broken down into discrete steps using a **Pipeline Pattern**. A `RunnerContext` object is passed through these steps.

### The `RunnerContext`
State object containing:
*   `job`: The configuration.
*   `logs`: In-memory array of log lines.
*   `tempFile`: Path to local temporary artifact.
*   `metadata`: Statistics (DB counts, sizes).
*   `status`: Current execution state.

### Execution Steps (`src/lib/runner/steps/`)

1.  **`01-initialize.ts`**
    *   Creates the database entry (`Execution` with status="Running").
    *   Decrypts credentials.
    *   Validates connection to Source.

2.  **`02-dump.ts`**
    *   Resolves the correct `DatabaseAdapter` implementation.
    *   Streams the database dump to a temporary file (`os.tmpdir()`).
    *   Calculates metadata (e.g., "5 databases dumped").

3.  **`03-upload.ts`**
    *   Resolves the `StorageAdapter`.
    *   Uploads the artifact.
    *   **Crucial**: Generates and uploads the `.meta.json` sidecar file for the Storage Explorer.

4.  **`04-completion.ts`** (Clean & Finalize)
    *   Deletes local temp files.
    *   Updates `Execution` row in DB with "Success"/"Failed" and end time.
    *   Sends Notifications (Discord/Email) via `NotificationAdapter`.

## 3. Error Handling Strategy

*   **Try/Catch Wrapper**: The main `runJob` function wraps the entire pipeline in a try/catch.
*   **Failure State**: Only if an error bubbles up to the main runner is the job marked as "Failed".
*   **Logs**: All errors are caught, logged into the `Execution` log JSON, and then re-thrown to trigger the failure state.
*   **Zombie Protection**: If the server crashes mid-job, the execution remains "Running". *Future Improvement: Startup routine to mark stale running jobs as failed.*

## 4. Adapters

The runner is agnostic to the underlying technology. It simply calls generic methods defined in `src/lib/core/interfaces.ts`.

*   `adapter.dump(config, path)`
*   `adapter.upload(config, localPath, remotePath)`

To add a new database support (e.g. SQLite), you only need to write a new Adapter, register it in `registry.ts`, and the Runner supports it automatically.
