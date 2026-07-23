# Changelog

All notable changes to DBackup are documented here.

## vNEXT
*Release: In Progress*

> ⚠️ **Breaking:** Combined (database + directory source) backups now use a new seekable archive format. Compression and encryption are applied to each entry inside the archive instead of to the archive as a whole, which is what makes it possible to restore a single file without downloading and decrypting the entire backup. Restoring such a backup requires this version or newer. Database-only backups are unaffected and keep their existing format.
>
> ⚠️ **Breaking:** Combined backups now write a third sidecar file next to the backup (`<backup>.index`) on every destination, alongside the existing `.meta.json`. It holds the archive's file index. Retention and storage tooling that assumes exactly two files per backup needs updating.
>
> ⚠️ **Breaking:** Jobs using the new incremental mode store their backups in one folder per chain, named `<job>/chain-<timestamp>/`, with a `full-` or `inc-` filename prefix. Jobs in the default full-backup mode keep the existing flat layout.

### ✨ Features

- **jobs**: Backup jobs can now include one or more directory sources (SFTP, SMB, WebDAV, Rsync, or Local Filesystem) alongside or instead of a database source, backed up into a single combined archive per execution. Configure them in the new "Sources" tab of the job form. Storage adapters can be flagged as directory backup sources in addition to backup destinations, shown as a new "Directory Sources" section on the Sources page and as role badges on the Destinations page.
- **restore**: Combined database + directory archives can be restored in one pass from the same restore dialog - select which databases and directory sources to restore, each with its own restore target and a conflict check against existing files at the destination path.
- **jobs**: Added an explicit "Backup Type" selector (Database Only / Directories Only / Database + Directories) to the Sources tab, replacing reactive disabled-button hints with upfront guidance.
- **jobs**: Creating and editing a backup job now opens a dedicated full page instead of a modal, giving the Sources tab room for the new folder tree.
- **storage**: Directory sources can now be picked via an always-visible Synology-style checkbox folder tree (Local, SFTP, Rsync, Google Drive, Dropbox, OneDrive), editable at any time directly in the Sources tab instead of a one-shot picker dialog.
- **templates**: Added Exclude Pattern Presets, reusable templates of glob patterns that can be linked to any directory source - editing a preset later retroactively applies to every source that references it, same as naming templates and schedule presets.
- **jobs**: The directory source folder browser now reflects every row already configured for that adapter, no matter which row's "Browse" button opened it - checking a new folder adds a row, unchecking one removes it, instead of only ever appending rows.
- **jobs**: Added a "Back up everything" option to the directory source folder browser, backing up an entire adapter's root as a single source instead of requiring one row per folder.
- **templates**: A directory source can now link multiple Exclude Pattern Presets at once, matching the multi-template picker already used for notifications.
- **backup**: Combined database + directory backups now use a seekable archive format that compresses and encrypts each entry individually, so a single file can be read out of a large backup without downloading or decrypting the rest.
- **backup**: Combined backups now write a `<backup>.index` sidecar listing every file's path, size, modification time and checksum, so browsing a backup's contents no longer downloads the archive.
- **backup**: Encrypted combined archives derive a fresh key per archive and use counter-based nonces, making nonce reuse impossible by construction.
- **backup**: Small files in encrypted combined archives are packed into shared bundles, removing the per-file overhead and compression-ratio penalty of backups with many small files.
- **storage**: Backups with directory sources can now be browsed file by file in the Storage Explorer, and individual files or folders restored on their own - as a `.tar.gz` download, back to their original location, or into any configured destination.
- **storage**: Storage adapters can now serve byte ranges, so a single-file restore transfers only that file instead of the whole backup. Implemented for S3, SFTP, WebDAV, Google Drive, OneDrive, FTP, Dropbox and the local filesystem, with an automatic fallback for SMB and Rsync.
- **vault**: The Recovery Kit now also ships `restore_archive.js`, which lists and extracts file backups offline with nothing but Node.js.
- **jobs**: Directory sources can now be backed up incrementally, storing only files that changed since the last run. Opt-in per job, with a configurable full-backup interval, and a mode that detects changes by content instead of timestamps.
- **storage**: The Storage Explorer now shows incremental snapshots with their complete size and a Full/Incremental badge, and offers a download that assembles the complete snapshot out of its chain.
- **restore**: The restore page now shows a file tree per directory source, so a restore can cover everything, single folders or individual files - with a per-selection size summary and a `.tar.gz` download option.
- **restore**: Directory restore targets can now be picked with a folder browser, and a one-click "Use original location" fills in where the files were originally collected from.
- **restore**: Clicking Restore on a backup that contains both databases and directory sources now offers a choice between restoring everything, only the databases or only the files, instead of always opening the page with both halves.
- **smb**: Directory sources on SMB shares can now be read from a VSS shadow copy instead of the live share, so open files are readable and the backup reflects a single point in time. Uses MS-FSRVP, needs no agent on the file server, and the switch only unlocks once the server has confirmed it can deliver one. A run whose snapshot turns out to be unavailable fails rather than silently backing up the live share.
- **destinations**: Added a "Create as Directory Source" action (and its reverse on the Sources page) that copies a storage adapter into the opposite role including its credentials, so the same server can serve both purposes without being set up twice by hand.

### 🐛 Bug Fixes

- **jobs**: Fixed a crash when expanding a directory source's exclude-pattern filter while editing an existing job.
- **jobs**: Fixed linked Exclude Pattern Presets being silently dropped when creating or updating a job, so the link never actually applied.
- **jobs**: Fixed external compression being force-disabled for combined jobs whenever PostgreSQL native compression was active, even when the job also had directory sources whose files should still be compressed.
- **backup**: Fixed the storage listing cache update after an upload being fired without awaiting it, which left its failures unhandled and could let it outlive the backup run that produced it.
- **backup**: Fixed the archive index sidecar being counted as a backup file by retention, the Storage Explorer, integrity checks and storage statistics, which could cause retention to delete real backups prematurely.
- **storage**: Deleting a backup now removes every sidecar belonging to it, instead of leaving orphaned index files behind.
- **retention**: Incremental chains are now retained and deleted as a unit, so a snapshot can never lose the archives it depends on.
- **restore**: Fixed restoring only directories out of a database + directory backup being blocked until a database and target server were selected.
- **local-filesystem**: Fixed restore targets written with a leading slash (such as the suggested `/restore`) being rejected as path traversal - a leading slash means the adapter's own root, as it already did for every other adapter.
- **restore**: Fixed the progress view getting stuck on "Downloading" for backups with directory sources, and reporting a download that never happens for them.
- **storage**: Fixed the Storage Explorer serving listing rows cached by an older version, which left new columns and actions (backup type, restore scope choice) missing until the cache happened to expire. Outdated caches are now rebuilt on first load after an update.
- **jobs**: Fixed the toggle in the Incremental backups and Skip Verification rows overlapping their description text, which pushed the switch under the last line on narrower dialogs.
- **backup**: Fixed incremental backups treating a file as unchanged when its modification time moved backwards at an unchanged size, which silently kept the stale version. Any timestamp difference now counts as a change, matching rsync.
- **storage**: Fixed directory sources appearing wherever backup destinations are listed - the Storage Explorer (where their files were shown as backups, delete button included), the Destinations page, Storage Usage on the dashboard, and the config backup target picker.
- **storage**: Fixed storage alerts treating directory sources as destinations, which made "Missing Backup" fire indefinitely for a location that never receives one.
- **system-tasks**: Fixed the hourly storage cache warmup and the destination-wide integrity check walking directory sources, which can hold no backups.
- **destinations**: Fixed cloning a storage adapter losing its role, so a cloned directory source came back as a backup destination.
- **jobs**: Fixed backup destinations never being validated, which allowed a job to write its backups into a directory source it also reads from.
- **restore**: Fixed "Files Only" failing outright and "Databases Only" finishing as Partial when restoring from a backup that contains both. The restore request now states which half it covers, instead of the untouched half being read as "restore all of it".

### 🔒 Security

- **backup**: File paths, database names and content checksums no longer appear in cleartext anywhere in an encrypted combined backup, including its archive member names and index sidecar.
- **local-filesystem**: Tightened the path containment check, which accepted a sibling directory whose name merely started with the configured base path.

### 🎨 Improvements

- **retention**: The retention log now names the backups that survive only because their incremental chain is still in use, so a destination holding more backups than its policy allows is explainable instead of looking like the policy is being ignored. The job form points this out on incremental jobs.

- **adapters**: Dropped the Role column from the adapter tables. Both storage pages now list a single role, so the column repeated the same value in every row.

- **storage**: The Storage Explorer's backup count badge now reflects combined database + directory archives (e.g. "2 DBs + 2 Dirs") instead of a misleading database-only count.
- **restore**: Restoring from a seekable archive no longer downloads the whole backup - only the selected databases and files are transferred on destinations that support byte ranges.
- **storage**: Every backup now records whether it is full or incremental, so the Storage Explorer's Type column is filled for database-only backups too instead of showing a dash.

### 🔄 Changed

- **navigation**: Sources, Destinations and Notifications are now one page, **Connections**, with a tab per kind: Databases, Directory Sources, Backup Destinations and Notifications. Adapters are grouped by what they are rather than by the direction a job happens to use them in, which is what made a database "a source" even when restoring into it. The old routes redirect to the matching tab, and the active tab lives in the URL (`?tab=`) so links and bookmarks keep working. Each tab keeps its own table, because they differ in columns, actions and the permission that governs them.
- **destinations**: A storage adapter now has one exclusive role instead of two independent toggles. The two role switches in the adapter form are a single Role choice, and the Destinations and Sources pages each list only their own. The roles cannot be combined because a destination writes job and chain folders into its configured path while a source reads folders out of it - one adapter doing both would let a job back up its own archives.

### 🗑️ Removed

- **storage**: Removed the separate "Browse files" button and dialog from the Storage Explorer - browsing and per-file restore now live on the restore page.

### 📝 Documentation

- **wiki**: Added an Archive Format reference documenting the seekable archive layout, key derivation and index format byte by byte, so backups stay recoverable independently of DBackup.
- **wiki**: Updated the Recovery Kit and Storage Explorer guides for file-level browsing and restore.
- **wiki**: Added a Backup Modes guide covering incremental backups, chain storage, retention behaviour and when DBackup falls back to a full backup.
- **api**: Documented the restore endpoint's new `scope` parameter, and corrected `targetSourceId` from unconditionally required to required only when the restore includes a database.
- **wiki**: Documented the destination/directory-source roles on both overview pages, including how to use one server for both.
- **wiki**: Updated every navigation instruction in the user guide for the new Connections page and its tabs.
- **wiki**: Documented shadow copies for SMB directory sources - what they solve, the server-side requirements, and the deliberate hard failure when one cannot be taken.
- **wiki**: Documented how retention and incremental chains interact, with a worked example and the amplifying effect GFS slots have on chain storage.
- **wiki**: Rewrote the "Detect changes by content" section to separate the transfer decision from the storage decision, name the cases that actually need it, and point out that a full backup re-checks everything.
- **api**: Documented `storageRole` on the adapter schemas and the new `role` query parameter of the adapter listing endpoint.

### 🧪 Tests

- **restore**: Added unit tests for the restore scope rules - when a combined backup asks what to restore, and how the restore page interprets the resulting parameter.
- **destinations**: Added tests for the adapter role - the listing filter, the guard that refuses a role change while a job depends on it, and the clone keeping or flipping the role.
- **smb**: Added tests for the FSRVP exchange - parsing rpcclient's output against Samba's own format strings, the mandatory recovery-complete call, password scrubbing, and the release path on success, failure and cancellation.
- **retention**: Added tests for the chain-kept report - which backups it names, and that it stays empty for standalone backups and for chains the policy keeps on its own.
- **backup**: Added a test for an incremental run re-reading a file whose timestamp moved backwards at an unchanged size.
- **jobs**: Added tests for the new destination-role validation, covering a destination pointing at a directory source and at an adapter that does not exist.
- **lint-guards**: Added a guard that fails the build when new code enumerates storage adapters for backup purposes without filtering by role, with an explicit allow-list for the health check and the listing endpoint.
- **lint-guards**: Added a guard that fails the build when anything links to the retired `/dashboard/sources`, `/dashboard/destinations` or `/dashboard/notifications` routes, and that checks their redirect stubs are still in place.

### 🐳 Docker

- **Image**: `skyfay/dbackup:vNEXT`
- **Also tagged as**: `latest`, `vNEXT`
- **CI Image**: `skyfay/dbackup:ci`
- **Platforms**: linux/amd64, linux/arm64


## v2.10.1 - Webhook GET/HEAD Support, SSO Improvements, and Multiple Bug Fixes
*Released: July 18, 2026*

### ✨ Features

- **webhooks**: Generic Webhook notification channels now support `GET` and `HEAD` HTTP methods, for compatibility with heartbeat/push-monitoring services like Uptime Kuma and Healthchecks.io. Thanks @Shlok-Zanwar ([#123](https://github.com/Skyfay/DBackup/issues/123))
- **SSO**: Added a new Profile > SSO tab where users can view, disconnect, and manually connect their linked identity provider accounts.

### 🐛 Bug Fixes

- **notifications**: Fixed webhook and notification deliveries being logged as "Success" even when the adapter failed to send (e.g. DNS errors, timeouts). Thanks @Shlok-Zanwar ([#123](https://github.com/Skyfay/DBackup/issues/123))
- **explorer**: Fixed Database Explorer UI not updating when navigating with the browser's back/forward buttons. Thanks @Shlok-Zanwar ([#126](https://github.com/Skyfay/DBackup/issues/126))
- **SSO**: Fixed dashboard-created users failing to link to a matching SSO identity on first login, shown as "Unknown Error". ([#128](https://github.com/Skyfay/DBackup/issues/128))
- **SSO**: Deleting an identity provider now also removes every user's linked account for it, instead of leaving a permanently stale "Provider no longer available" connection behind.

### 🔒 Security

- **dependencies**: Updated `adm-zip` to v0.6.0, fixing a high-severity vulnerability where a crafted ZIP file could trigger a 4GB memory allocation ([GHSA-xcpc-8h2w-3j85](https://github.com/advisories/GHSA-xcpc-8h2w-3j85)).
- **vault**: The Dropbox, Google Drive, and OneDrive OAuth token validation endpoints now require the `credentials:read` permission, closing a gap where any authenticated API key could probe the validity of a stored OAuth credential profile.

### 🎨 Improvements

- **SSO**: Deleting an identity provider now warns how many users are connected and lists which of them have no other login method and would be locked out entirely.

### 🔄 Changed

- **deps**: Bumped minor/patch versions across app, website, and docs, including `better-auth`, `@better-auth/sso`, `@better-auth/passkey`, `next`, `react`, `react-dom`, `nodemailer`, `tailwindcss`, `@tailwindcss/postcss`, `vitest`, `@vitest/coverage-v8`, `vue`, `dropbox` (v10.37.1), `mongodb` (v7.5.0), `mssql` (v12.7.0), `@aws-sdk/client-s3` and `@aws-sdk/lib-storage` (v3.1090.0), `node-cron` (v4.6.0), `radix-ui` (v1.6.2), `react-hook-form` (v7.82.0), `googleapis` (v173.0.0), `rate-limiter-flexible` (v11.2.0), `react-day-picker` (v10.0.1), `next-mdx-remote` (v6.0.0), `vitepress-plugin-tabs` (v0.9.1), `lucide-react` (v1.25.0), and 16 `@radix-ui/react-*` packages.

### 📝 Documentation

- **api-docs**: Synced the standalone API reference deployment with the in-app spec, which was missing the entire Credentials/Vault section, and documented 8 previously-undocumented endpoints (version history, database table browsing, dashboard calendar, storage verification, and cloud storage OAuth authorization).

### 🧪 Tests

- **SSO**: Updated the `deleteProvider()` unit test to match the transactional delete (provider + linked accounts) introduced alongside the SSO provider deletion warning.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.10.1`
- **Also tagged as**: `latest`, `v2`
- **CI Image**: `skyfay/dbackup:ci`
- **Platforms**: linux/amd64, linux/arm64


## v2.10.0 - Firebird Support, New Website, and Multiple Bug Fixes
*Released: July 12, 2026*

### ✨ Features

- **Firebird**: Added Firebird (3.x/4.x/5.x) as a supported database source, with direct and SSH connection modes. Marked as Beta in the source type picker.
- **website**: Launched a new website at dbackup.app with a blog, roadmap page, and product tour.

### 🐛 Bug Fixes

- **Redis**: Database Explorer now shows a key count per database instead of always blank.
- **rsync**: Fixed SSH private-key destinations failing with "Too many authentication failures" when the local SSH agent has other keys loaded.
- **vault**: Recovery Kit downloads now include `decrypt_backup.js` instead of a missing-script warning. Thanks @jpb0418 ([#120](https://github.com/Skyfay/DBackup/issues/120))

### 🔧 CI/CD

- **scripts**: `generate-stress-data.sh` now also populates Redis and Firebird test containers.
- **scripts**: Added `test-vm-up.sh` / `test-vm-down.sh` / `seed-ssh-test-config.ts` and a `test:vm:delete` shortcut to test SSH-mode adapters against a real remote host via a Multipass VM.
- **scripts**: `test-vm-up.sh` now starts one container per database family instead of the full test matrix, to reduce VM memory usage.
- **scripts**: `test-vm-up.sh`/`seed-ssh-test-config.ts` now install MongoDB's client tools and seed MongoDB and Firebird SSH sources, MSSQL is left out for now as the heaviest container.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.10.0`
- **Also tagged as**: `latest`, `v2`
- **CI Image**: `skyfay/dbackup:ci`
- **Platforms**: linux/amd64, linux/arm64


## v2.9.0 - Valkey Support, Storage Alert Fix, and Multiple Improvements
*Released: July 4, 2026*

### ✨ Features

- **Valkey**: Added Valkey as a supported database source. Uses the same RDB backup mechanism as Redis with correct version display.

### 🐛 Bug Fixes

- **storage alerts**: Fixed "Missing Backup" alert firing incorrectly when a retention policy keeps the file count stable, making the alert appear even though backups were completing successfully.

### 🎨 Improvements

- **dashboard**: The Storage Usage widget now shows the adapter-specific brand icon for each destination (matching the Destinations page) instead of a generic hard drive icon.
- **adapter form**: The add/edit dialog is now scrollable when configuration fields exceed the available screen height, with action buttons always pinned at the bottom.
- **system tasks**: Health check log cleanup now runs once a day via the "Clean Old Data" task instead of on every health check run, reducing unnecessary database load.
- **system tasks**: Removed a redundant hourly storage snapshot cleanup that duplicated the daily "Clean Old Data" cleanup.
- **database**: The internal SQLite database now runs in WAL mode with a busy timeout, so readers no longer block writers and concurrent writes wait briefly instead of failing instantly with "database is locked". Configurable via the new `SQLITE_WAL_MODE` environment variable (default: `true`).

### 📝 Documentation

- **Redis**: Updated supported version documentation from `6.x` to `2.8+` to reflect actual compatibility.
- **installation**: Documented the `-wal`/`-shm` companion files created by the internal database's WAL mode.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.9.0`
- **Also tagged as**: `latest`, `v2`
- **CI Image**: `skyfay/dbackup:ci`
- **Platforms**: linux/amd64, linux/arm64


## v2.8.0 - Notification Templates, Per-Job Event Filters, and Multiple Bug Fixes
*Released: June 28, 2026*

> ⚠️ **Breaking:** The per-job notification configuration has been replaced by Notification Templates, and existing job notification settings are **not** migrated automatically. After updating, every backup job loses its notification setup and must be reconfigured: create a Notification Template under **Templates -> Notification Templates** (assign channels and pick the Success/Partial/Failed events per channel), then assign it to each job via the job edit form. You can mark one template as the default so it is pre-selected for new jobs.

### ✨ Features

- **notifications**: Job notification triggers redesigned - select any combination of Success, Partial, and Failed outcomes per job instead of a fixed preset. ([#117](https://github.com/Skyfay/DBackup/issues/117))
- **notifications**: Added Notification Templates - reusable templates with per-channel event filters (Success/Partial/Failed) that can be assigned to multiple backup jobs, replacing the per-job flat channel configuration.

### 🐛 Bug Fixes

- **users**: Fixed "Create Group" and "Create API Key" dialogs where the footer buttons were rendered inside the scroll area instead of being fixed at the bottom, and scrolling was broken. Added missing `DialogDescription` to resolve the `aria-describedby` accessibility warnings.
- **jobs**: Fixed "API Trigger" dialog where scrolling was broken due to an ineffective `grid-rows` class on the flex-based `DialogContent`.
- **dashboard**: Fixed Backup Calendar "Last 12 months" view missing today's backups when the server runs in a non-UTC timezone.
- **notifications**: Fixed "Skipping notifications" not being logged when the event filter excludes the current backup status (legacy path).
- **jobs**: Fixed cloning a job crashing when the source job has no notification templates assigned.
- **notifications**: Fixed email preview not showing the logo because the URL pattern used for local replacement did not match the current `docs.dbackup.app` domain.

### 🎨 Improvements

- **notifications**: New backup jobs now pre-select the default notification template (if one is marked as default), so it no longer has to be added manually each time. The selection can still be removed before saving.
- **history**: Notification results (sent/failed per channel) are now shown directly in the execution log dialog, with a clickable pill per channel that opens the full notification preview.
- **history**: Uploading step in the execution log viewer now shows orange instead of red for partial backup executions.

### 🧪 Tests

- **coverage**: Raised overall unit test coverage from 84% to 92% (statements) / 94% (lines) by adding 270+ new tests across notification templates, SSH key conversion, restore pipeline, backup dump, dashboard service, storage adapters (SFTP, S3/R2/Hetzner, Google Drive, OneDrive, FTP), SSH client PKCS#8 path, integrity service, encryption service, job service, and runner initialization steps.
- **lint**: Fixed 5 ESLint errors - renamed unused variables (`wrapError`, `mockLog`, `callCount`, `capturedCallback`) to underscore-prefixed equivalents, and removed stale `no-throw-literal` disable comment (rule was renamed to `only-throw-error` in newer typescript-eslint).
- **types**: Fixed 7 TypeScript errors - replaced incorrect `as Parameters<typeof generateKeyPairSync>[1]` casts with `as any` for RSA/EC key generation, added `as unknown as string` for Ed25519 `privateKey` cast, and wrapped four Prisma `mockImplementation` async functions with `as any` to satisfy `Prisma__SystemSettingClient` return type.
- **test-infra**: Reduced active test containers in `docker-compose.test.yml` to oldest + newest version per database family (MySQL 5.7+9.1, MariaDB 10+11, PostgreSQL 12+17, MongoDB 4.4+8.0, MSSQL 2019+2022, Redis 6+8). Middle versions are commented out and can be re-enabled on demand.
- **test-infra**: Updated `tests/integration/test-configs.ts` to match - middle versions commented out, `multiDbTestConfigs` updated to use the newest active containers (MySQL 9, PG 17, MongoDB 8). Azure SQL Edge entry commented out alongside its container.
- **test-infra**: Updated `scripts/generate-stress-data.sh` container references to the remaining active containers (MySQL 9.1, PostgreSQL 17, MongoDB 8.0).
- **test-infra**: Updated `scripts/setup-mssql-testdb.sh` to skip the disabled `mssql-edge` container.
- **test-infra**: `scripts/seed-test-sources.ts` now cleans up previously seeded but now-disabled adapter configs from the dev DB on the next `pnpm test:seed` run (MySQL 8.0, PG 13-16, MongoDB 5-7, Redis 7, Azure SQL Edge).

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.8.0`
- **Also tagged as**: `latest`, `v2`
- **CI Image**: `skyfay/dbackup:ci`
- **Platforms**: linux/amd64, linux/arm64


## v2.7.2 - Multiple Bug Fixes, S3 Connection Stability Improvements, and Security Updates
*Released: June 22, 2026*

### 🐛 Bug Fixes

- **dashboard**: Fixed React "missing key prop" console warning on the dashboard bottom grid.
- **S3**: Fixed intermittent `ECONNRESET` errors on S3 uploads caused by HTTP connections not being closed after each operation. ([#115](https://github.com/Skyfay/DBackup/issues/115))

### 🔒 Security

- **nodemailer**: Updated to v9.0.1 to address an arbitrary file read and SSRF vulnerability via the `raw` message option ([GHSA-p6gq-j5cr-w38f](https://github.com/advisories/GHSA-p6gq-j5cr-w38f)).
- **vite**: Updated to v7.3.5 to address a `server.fs.deny` bypass on Windows via alternate paths ([GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff)).
- **deps**: Patched 7 transitive dependency vulnerabilities (`shell-quote` critical, `form-data`, `undici`, `js-yaml`, `esbuild`, `@babel/core`, `dompurify`) via pnpm overrides.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.7.2`
- **Also tagged as**: `latest`, `v2`
- **CI Image**: `skyfay/dbackup:ci`
- **Platforms**: linux/amd64, linux/arm64


## v2.7.1 - Backup Calendar Heatmap, Partial Integrity Status, and Multiple Improvements
*Released: June 20, 2026*

### ✨ Features

- **dashboard**: Added a Backup Calendar Heatmap - a 12-month GitHub-style contribution graph showing daily backup outcomes (success, partial, failed, or no backup).
- **integrity**: Integrity check executions now finish with a "Partial" status when some files fail verification, instead of "Success", making partial failures visible across the System Tasks list and Jobs Activity chart.
- **integrity**: System notifications are now sent when an integrity check (scheduled or manual) finds one or more checksum mismatches. ([#94](https://github.com/Skyfay/DBackup/issues/94))

### 🐛 Bug Fixes

- **storage**: Periodic health checks no longer write test files to storage destinations, preventing file accumulation on storage with governance or object-lock retention policies. ([#113](https://github.com/Skyfay/DBackup/issues/113))
- **audit**: Fixed Audit Log table resetting to page 1 after every page navigation.
- **audit**: Reduced Audit Log load time by skipping filter-stats queries on page changes and parallelizing the underlying DB queries.

### 🎨 Improvements

- **jobs**: The edit job dialog now scrolls on small screens instead of clipping content below the fold.
- **storage**: Manual connection test files are now isolated to a `.dbackup/test/` subfolder with the adapter name and timestamp in the filename, and are excluded from the Storage Explorer and backup count statistics. ([#113](https://github.com/Skyfay/DBackup/issues/113))
- **dashboard**: Latest Jobs widget now fills the same height as the right column and shows as many entries as fit. Added an "Integrity Check" filter option covering both IntegrityCheck and Verification types.
- **dashboard**: Jobs Activity chart and Job Status donut now include "Partial" executions with an orange indicator.

### 📝 Documentation

- **wiki**: Overhauled the developer guide - corrected 50+ inaccuracies across all pages and added three new pages covering the Integrity Check system, Storage Alert system, and Credential Profiles.
- **wiki**: Audited and updated the user guide - corrected factual errors (PostgreSQL dump format, permissions reference, Redis credential requirement), added 8 missing system notification events, documented the pgCompression job option and Database Explorer feature, and filled minor config table gaps across Telegram, MongoDB, and job settings.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.7.1`
- **Also tagged as**: `latest`, `v2`
- **CI Image**: `skyfay/dbackup:ci`
- **Platforms**: linux/amd64, linux/arm64


## v2.7.0 - Backup Integrity Verification, Storage Explorer Caching, and Multiple Improvements
*Released: June 14, 2026*

### ✨ Features

- **integrity**: Added backup file integrity verification. The Storage Explorer shows SHA-256/MD5 checksums and last verification result per file, with a Verify Now button that runs as a tracked async execution with live progress and cancel support.
- **integrity**: Native checksum verification for S3/R2/Hetzner (SHA-256 via object metadata), Google Drive (MD5 via API), OneDrive (SHA-256 via Graph API), and local filesystem - no download required. Both checksums are stored in `.meta.json` at upload time.
- **integrity**: Post-upload verification is now opt-in for all storage destinations via system settings (local filesystem always verifies).
- **integrity**: Scheduled integrity checks support two scan modes - **Jobs** (default, only verifies files linked to backup jobs) and **All Files** (full storage scan) - plus configurable filters (skip already-passed, max age, max file size). Jobs and storage destinations can individually opt out via a "Skip Verification" toggle.
- **storage**: Storage Explorer file listings are now cached in SQLite for instant repeat visits. Cache is invalidated on backup create, delete, verify, and lock changes.
- **history**: Execution logs can now be copied to the clipboard or downloaded as a `.log` file directly from the log dialog. Sensitive data (IPs, credentials, connection strings) is automatically redacted before export.

### 🐛 Bug Fixes

- **storage**: Google Drive, OneDrive, and Dropbox now live-validate their stored OAuth token when the Connection tab is opened, showing an expiry warning with a Re-authorize button instead of a misleading green "authorized" status.

### 🎨 Improvements

- **dev**: `pnpm dev` now automatically applies pending Prisma migrations and regenerates the Prisma client on startup.
- **storage**: Storage Explorer cache uses surgical updates - create, delete, lock, and verify each patch only the affected cache entry instead of invalidating the full cache.
- **storage**: A new "Pre-warm Storage Cache" system task (enabled by default, hourly) reconciles caches against remote storage and pre-populates the cache for adapters not yet visited.
- **storage**: Stale cache entries trigger a background reconciliation via `adapter.list()` to detect files deleted outside DBackup without re-reading sidecars.
- **storage**: Long backup names in the Storage Explorer are truncated with a tooltip showing the full name on hover.
- **integrity**: Manual system task runs auto-redirect to the live execution history when "Auto-redirect on job start" is enabled.
- **ui**: All data tables (Storage, Jobs, Sources, Destinations, Notifications) now support horizontal scrolling when columns overflow.
- **explorer**: Database version history now detects and visually distinguishes downgrades - the change log shows an orange downward arrow for downgrades vs. green upward arrow for upgrades, and downgrade notifications are sent with a distinct "Downgrade" label and warning color.
- **explorer**: Database Explorer table list now supports searching by name and sorting by Name, Type, Rows, or Size via clickable column headers.

### 🧪 Tests

- **tests**: Updated unit tests for integrity service, upload step, storage service, and system task service to match the refactored verification interfaces.
- **tests**: Fixed integrity service tests to use destinations scan mode explicitly and added `skipVerification` field to job service create test.
- **tests**: Added unit tests for `VerificationService` (all verification code paths), `SystemTaskRunner` (execution lifecycle), `logs/sanitize` (credential and IP redaction), and `logs/format` (log text export). Extended `IntegrityService` tests to cover the jobs-mode scan path.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.7.0`
- **Also tagged as**: `latest`, `v2`
- **CI Image**: `skyfay/dbackup:ci`
- **Platforms**: linux/amd64, linux/arm64


## v2.6.0 - Security Update, Vault Credential Profiles, OAuth Improvements, and Multiple Bug Fixes
*Released: June 6, 2026*

> 🔒 **Security Update:** This release fixes a security vulnerability in DBackup's own code ([GHSA-cj5h-46h6-72wc](https://github.com/skyfay/DBackup/security/advisories/GHSA-cj5h-46h6-72wc)). Update as soon as possible.

> ⚠️ **Breaking:** OAuth storage destinations (Dropbox, Google Drive, OneDrive) and token-based notification channels (Discord, Slack, Teams, Generic Webhook, Twilio) no longer store secrets inline - they require a Vault credential profile to function. After updating, create a matching `OAUTH`, `WEBHOOK`, or `TOKEN` profile in the Security Vault and assign it to each affected adapter via the edit form. Adapters without an assigned profile will fail connection tests and backup/notification jobs until migrated.

### ✨ Features

- **credentials**: Credential profiles now support `WEBHOOK` (Discord, Slack, Teams, Generic Webhook), `OAUTH` (Dropbox, Google Drive, OneDrive), and `TOKEN` (Twilio) types, allowing notification and storage secrets to be stored in the vault and resolved server-side.
- **OAuth**: OAuth authorization flows (Dropbox, Google Drive, OneDrive) now require an assigned credential profile. Tokens are stored in the vault and the credential picker refreshes automatically after authorization.
- **OAuth**: Authorization dialogs now open in a popup window instead of redirecting the current page.

### 🔒 Security

- **SMB**: Passwords are now redacted from error messages and logs when SMB connections fail.
- **adapters**: All adapter endpoints (list, create, update, clone) now return a safe DTO that strips all sensitive fields and replaces them with a `secretStatus` map - decrypted secrets are no longer serialized to API responses. Thanks @YHalo-wyh ([GHSA-cj5h-46h6-72wc](https://github.com/skyfay/DBackup/security/advisories/GHSA-cj5h-46h6-72wc))
- **adapters**: Notification webhook URLs and tokens (`webhookUrl`, `botToken`, `authToken`, `authHeader`, `appToken`, `accessToken`) and SSH keys (`sshPassword`, `sshPrivateKey`, `sshPassphrase`) added to `SENSITIVE_KEYS` and redacted in all DTO and strip operations. Thanks @YHalo-wyh ([GHSA-cj5h-46h6-72wc](https://github.com/skyfay/DBackup/security/advisories/GHSA-cj5h-46h6-72wc))
- **OAuth**: Refresh tokens for Dropbox, Google Drive, and OneDrive are now stored exclusively in credential profiles instead of adapter configs.
- **adapters**: Adapter update (PUT) now preserves existing secrets via `mergeSecrets` - re-saving an adapter form without changing secret fields no longer overwrites stored credentials with empty values.

### 🎨 Improvements

- **adapters**: Secret fields in the adapter form show a "saved - leave blank to keep" placeholder when a value is already stored.
- **credentials**: Credential profile dialog extended to support creating `WEBHOOK` and `OAUTH` profile types.
- **encryption**: The key resolution dialog now automatically switches to the raw key tab when no vault profiles are available.

### 🧪 Tests

- **adapters**: Added audit tests verifying no sensitive fields are returned by any adapter API endpoint.
- **adapters**: Added DTO unit tests verifying that notification secrets (Telegram `botToken`, Discord `webhookUrl`) are redacted and `secretStatus` flags are set correctly.
- **crypto**: Added unit tests for `stripSecrets`, `mergeSecrets`, and `getSecretStatus`.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.6.0`
- **Also tagged as**: `latest`, `v2`
- **CI Image**: `skyfay/dbackup:ci`
- **Platforms**: linux/amd64, linux/arm64


## v2.5.1 - Security Update, Smart Recovery Improvements, and Multiple Bug Fixes
*Released: June 2, 2026*

> 🔒 **Security Update:** This release fixes a security vulnerability in DBackup's own code ([GHSA-h929-x237-c5h2](https://github.com/skyfay/DBackup/security/advisories/GHSA-h929-x237-c5h2)). Update as soon as possible.

### ✨ Features

- **encryption**: Added a "Key Required" fallback dialog for decrypted downloads and offline config restore. When Smart Recovery cannot find a matching key, users can manually select a vault profile or paste a raw hex key to complete the operation.

### 🐛 Bug Fixes

- **ftp**: Fixed GFS retention on FTP servers without MLSD support by falling back to dates extracted from backup filenames when server-provided modification times are unavailable.
- **encryption**: Smart Recovery (try-all-keys) is now applied during offline config backup restore and decrypted file downloads from the Storage Explorer - both previously failed with "Encryption Profile not found" when the profile ID changed after a key reimport. ([#108](https://github.com/Skyfay/DBackup/issues/108))
- **encryption**: Smart Recovery key-match heuristic now correctly identifies SQLite (`.db`) and Redis RDB (`.rdb`) backup files - previously both binary formats were misidentified as "wrong key" because they are not GZIP/PGDMP/TAR/plain-SQL.
- **restore**: Fixed "Restore as New Database" mode silently ignoring the typed target name - switching back to "Overwrite Existing" after typing cleared the name without any indication.
- **sqlite**: Fixed restore ignoring the target filename set in the database mapping table, causing the backup to overwrite the original file instead of creating a new one.

### 🔒 Security

- **adapters**: Adapter connection-test and access-check routes now fail closed - permission checks deny access by default instead of falling through when the check is inconclusive. Thanks @endscene665 ([GHSA-h929-x237-c5h2](https://github.com/skyfay/DBackup/security/advisories/GHSA-h929-x237-c5h2))

### 🎨 Improvements

- **retention**: GFS retention calculations now use the configured system timezone for day/week/month/year bucketing instead of always using UTC.

### 🧪 Tests

- **retention**: Added comprehensive GFS retention unit tests with realistic multi-month backup sets.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.5.1`
- **Also tagged as**: `latest`, `v2`
- **CI Image**: `skyfay/dbackup:ci`
- **Platforms**: linux/amd64, linux/arm64


## v2.5.0 - Version History & General Improvements
*Released: May 31, 2026*

### ✨ Features

- **Jobs Table**: Added "Last Run" and "Next Run" columns to the Backup Jobs table. "Last Run" shows the start time of the most recent execution. "Next Run" is computed from the job's cron schedule using the system timezone and displayed in the user's configured timezone and date/time format.
- **Clone Modal**: Cloning a Job, Source, Destination, or Notification now opens a confirmation dialog where the name for the clone can be customized before it is created. The default name is pre-filled as "Original Name (Copy)".
- **Database Explorer**: Added a new "Version History" tab per source showing the current engine version, a step-line timeline chart of detected version changes over time, and a change log table (previous version → new version, edition, detected at). History entries are persisted to a new `DbVersionHistory` table.
- **System Tasks**: The hourly "Update Database Versions" task now records a new `DbVersionHistory` entry whenever the detected server engine version (or edition for MSSQL) changes since the last check. The first observation per source is stored as a baseline.
- **Notifications**: Added a new `db_version_changed` system notification event that fires when a database server's engine version changes between two consecutive checks. The initial baseline observation does not trigger a notification.

### 🐛 Bug Fixes

- **mssql**: Fixed Database Explorer showing "No tables found" for databases that use non-dbo schemas - tables in all schemas are now returned and displayed with a `schema.table` prefix for non-dbo objects.
- **mssql**: Fixed "Total Size" showing "undefined" in the Database Explorer General tab - BIGINT size values returned as strings by the database driver are now converted to numbers.

### 🔒 Security

- **deps**: Updated `better-auth`, `@better-auth/passkey`, `@better-auth/sso` 1.6.9 → 1.6.13 (GHSA-34r5-q4jw-r36m SAML XML injection, passkey replay attack). Added pnpm overrides: `fast-xml-builder` → `^1.2.0` (GHSA-5wm8-gmm8-39j9 HIGH + GHSA-45c6-75p6-83cc, via `webdav`), `brace-expansion@5` → `5.0.6` (GHSA-jxxr-4gwj-5jf2, via `eslint-config-next`), `qs` → `^6.15.2` (GHSA-q8mj-m7cp-5q26, via `googleapis`), `uuid` → `^11.1.1` (GHSA-w5hq-g745-h8pq, via `mssql > tedious > @azure/msal-node`).

### 🎨 Improvements

- **storage**: SFTP, FTP, SMB, Rsync, and OneDrive adapters now reuse a single connection for the metadata sidecar (`.meta.json`) and the backup file upload per job. Previously each upload performed a full connect/auth/disconnect cycle, doubling the SSH/FTP handshake and OneDrive OAuth token requests. Introduced an optional `openSession()` method on the `StorageAdapter` interface, adapters without it transparently fall back to the previous stateless behavior, so S3, WebDAV, Dropbox, Google Drive, and local filesystem remain unchanged.

### 🔧 CI/CD

- **deps**: Updated `next` + `eslint-config-next` 16.2.4 → 16.2.6, `react` + `react-dom` 19.2.5 → 19.2.6, `mssql` 12.5.0 → 12.5.5, `nodemailer` 8.0.7 → 8.0.10, `basic-ftp` 6.0.0 → 6.0.1, `zod` 4.4.1 → 4.4.3, `vitest` + `@vitest/coverage-v8` 4.1.5 → 4.1.7, `@types/react` 19.2.14 → 19.2.15, `vue` (docs) 3.5.28 → 3.5.35, `@aws-sdk/client-s3` + `@aws-sdk/lib-storage` 3.1039.0 → 3.1057.0, `@hookform/resolvers` 5.2.2 → 5.4.0, `date-fns` 4.1.0 → 4.4.0, `lucide-react` 1.14.0 → 1.17.0, `react-hook-form` 7.74.0 → 7.77.0, `tailwind-merge` 3.5.0 → 3.6.0, `tailwindcss` + `@tailwindcss/postcss` 4.2.4 → 4.3.0.
- **deps**: Added pnpm override `kysely` → `0.28.17` to work around a bug in `@better-auth/kysely-adapter@1.6.13` that imports the removed `DEFAULT_MIGRATION_LOCK_TABLE` export from `kysely@0.29.x`, which Turbopack now catches as a hard build error.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.5.0`
- **Also tagged as**: `latest`, `v2`
- **CI Image**: `skyfay/dbackup:ci`
- **Platforms**: linux/amd64, linux/arm64


## v2.4.1 - Multiple Bug Fixes across MSSQL, SMB, Retention, and Storage Adapters
*Released: May 27, 2026*

### 🐛 Bug Fixes

- **mssql**: Fixed backup abort and missing remote cleanup when SSH-transferring more than ~10 databases due to SSH channel exhaustion - the SFTP session is now cached and reused instead of opening a new channel per operation.
- **mssql**: Fixed "Arithmetic overflow" crash in Database Explorer and Restore for databases larger than ~2 GB.
- **smb**: Fixed `.connection-test-*` probe files not being deleted when `sendFile` throws after the remote file was already created.
- **retention**: Fixed SMART/GFS tier overlap that incorrectly mapped multiple tiers to the same backup, causing over-aggressive deletion. ([#101](https://github.com/Skyfay/DBackup/issues/101))
- **storage**: Fixed file descriptor leak causing deleted `.tar` temp files to hold disk blocks until container restart, affecting S3, SFTP, FTP, OneDrive, and tar-utils streams. ([#100](https://github.com/Skyfay/DBackup/issues/100))

### 🎨 Improvements

- **retention**: Corrected the retention algorithm abbreviation from "GVS" to "GFS" across UI, documentation, and the built-in retention template.
- **history**: Retention execution logs now include the applied retention template name.

### 🧪 Tests

- **notifications**: Updated `events.test.ts` event count assertions to reflect the new `db_version_changed` event - `NOTIFICATION_EVENTS` now has 15 keys (was 14) and `EVENT_DEFINITIONS` now has 13 entries (was 12).
- **smb**: Added unit tests for `finally`-block cleanup when `sendFile` throws and for cleanup retry when the delete itself fails.
- **retention**: Added regression tests for GFS non-overlapping tier selection and template-name visibility in retention history. ([#101](https://github.com/Skyfay/DBackup/issues/101))
- **ftp/sftp**: Fixed broken upload unit tests by adding missing `destroy: vi.fn()` to the `createReadStream` mock - the adapter calls `fileStream.destroy()` in the `finally` block, which threw a TypeError without this mock method.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.4.1`
- **Also tagged as**: `latest`, `v2`
- **CI Image**: `skyfay/dbackup:ci`
- **Platforms**: linux/amd64, linux/arm64


## v2.4.0 - Database Explorer Browser, Drill-down Data Viewer, and Bug Fixes
*Released: May 25, 2026*

### ✨ Features

- **Database Explorer**: Added drill-down table and data viewer with server-side pagination, search, schema inspection, and deep-link URL support for all 7 database adapters. ([#92](https://github.com/Skyfay/DBackup/issues/92))
- **sources**: Added an "Exclude from Restore" toggle to database source settings. Sources marked as excluded are hidden from the restore target dropdown - backups can still be created from them. Thanks @iberlob ([#97](https://github.com/Skyfay/DBackup/pull/97))

### 🐛 Bug Fixes

- **Naming Templates**: Fixed date tokens (e.g. `mm` for minutes, `dd` for day) being incorrectly expanded inside job or database names. Job names containing these substrings (e.g. "Immich" containing "mm", "Grimmory" containing "mm") no longer produce corrupted filenames. Date tokens are now resolved before job/db names are substituted. ([#90](https://github.com/Skyfay/DBackup/issues/90))
- **DatabasePicker**: Fixed the backup job edit dialog becoming unusable when a large number of databases are selected. The trigger button now shows at most 8 database badges and collapses the rest into a "+N more" indicator. ([#91](https://github.com/Skyfay/DBackup/issues/91))
- **Queue**: Fixed scheduled backup jobs remaining stuck as "Pending" indefinitely after a restore operation completes. The restore pipeline now triggers `processQueue()` in its `finally` block, mirroring the behaviour of the backup runner. ([#95](https://github.com/Skyfay/DBackup/issues/95))

### 🧪 Tests

- **Database Browser**: Added unit tests for all 6 `browser.ts` adapter modules (MySQL, PostgreSQL, MongoDB, MSSQL, Redis, SQLite). Covers `getTables` and `getTableData` including parser logic, type mapping, TTL formatting, and search modes. 36 tests total.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.4.0`
- **Also tagged as**: `latest`, `v2`
- **CI Image**: `skyfay/dbackup:ci`
- **Platforms**: linux/amd64, linux/arm64


## v2.3.3 - Multiple Bug Fixes across MSSQL, Redis, Email, and Storage Adapters
*Released: May 19, 2026*

### 🐛 Bug Fixes

- **MSSQL**: Fixed Database Explorer showing "No user databases found" on production instances. Databases in non-ONLINE states (e.g. RESTORING, Availability Group replicas) are now included, and connection errors are surfaced to the UI instead of silently returning an empty list.
- **Redis**: Fixed `A credential profile is required but none is assigned` error when connecting to a Redis instance without authentication. The credential profile is now optional for Redis - when no profile is assigned, the structural config fields (inline password if any) are used directly, allowing Redis instances without ACL/password to work without a credential profile. ([#86](https://github.com/Skyfay/DBackup/issues/86))
- **email**: Fixed automated email (SMTP) notifications failing with `A credential profile is required but none is assigned` during backup/restore job runs and system health checks. The v2.3.2 fix only covered the test-connection path; the runner pipeline still used a stricter resolver that threw unconditionally when no profile was assigned. The credential profile is now consistently optional in all code paths - when no profile is assigned, the structural config (host, port, from, to, inline user/password if any) is used directly. ([#87](https://github.com/Skyfay/DBackup/issues/87))
- **Storage**: Fixed orphaned `.connection-test-*` / `.dbackup-test-*` files accumulating on remote storage destinations. All 10 storage adapters (FTP/FTPS, SMB, SFTP, WebDAV, S3/R2/Hetzner/AWS, Local, Rsync, Dropbox, Google Drive, OneDrive) placed the remote file deletion inside the `try` block without a `finally` guard. If the delete call threw (network hiccup, server-side error, permission edge case), the test file was left behind permanently. Every adapter now uses a `remoteFileCreated` flag and a `finally` block to guarantee a best-effort cleanup even when the delete itself fails.
- **Storage**: Fixed false "-100% change" spike notifications still triggering for users with a **Local Filesystem** destination. The v2.3.2 fix updated all 9 cloud/network adapters but missed the Local adapter: its `list()` catch block returned `[]` on any I/O error (e.g. a temporarily unmounted fstab disk) instead of throwing. This caused a 0-byte snapshot to be saved and a spike alert to fire, identical to the original bug. The inner `fs.access` wrapper is removed so the original error code propagates; the outer catch now throws on all errors except ENOENT on non-root sub-paths (legitimate "no backups for this job yet" scenario). ([#82](https://github.com/Skyfay/DBackup/issues/82))
- **Storage**: Fixed the same class of bug in the **SMB** and **FTP** adapters. Both use an inner `walk()` helper that silently swallowed listing errors via `catch { return; }`. Because the SMB share connection is not established until the first `client.list()` call (unlike FTP/cloud adapters which connect upfront), any SMB authentication or network failure was silently turned into an empty list. The inner catch now re-throws when `currentDir === startDir` (root listing = connection/auth failure) and continues silently only for sub-directory errors (e.g. one folder with restricted permissions). ([#82](https://github.com/Skyfay/DBackup/issues/82))

### 🎨 Improvements

- **Storage**: Improved UX for S3 Glacier and Deep Archive storage classes. The file list now surfaces the storage class of each object from the AWS ListObjectsV2 response. In the Storage Explorer, Glacier and Deep Archive objects are labeled with an orange "Glacier" or "Deep Archive" badge. Download and Restore action buttons are disabled for archived objects with a tooltip explaining that the object must be restored via the AWS Console first. The S3 download function now throws a descriptive error (instead of returning a generic failure) when AWS returns `InvalidObjectState`, so the message is surfaced to the user in the UI. The "Storage Class" field description in the adapter configuration form now includes a warning that GLACIER and DEEP_ARCHIVE prevent direct download and restore. ([#88](https://github.com/Skyfay/DBackup/issues/88))

### 🧪 Tests

- Updated Local Filesystem adapter `list()` tests: replaced "returns empty array on unexpected error" with three new assertions - throws on unexpected readdir errors, throws when the root path (`remotePath = ""`) is inaccessible (ENOENT), and throws on non-ENOENT access errors on sub-paths (EACCES).
- Updated **SMB** adapter `list()` tests: replaced the incorrect "returns empty array on list error" assertion (expected `[]`, now expects throw) with "throws when root directory listing fails"; added "continues when a subdirectory listing fails" to document the intentional silent-skip behavior for non-root walk errors.
- Updated **FTP** adapter `list()` tests: added "throws when initial directory listing fails after connection" covering the case where `connectFTP` succeeds but the first `client.list()` call fails (e.g. path does not exist or permission denied). The existing subdirectory-continue test is unchanged.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.3.3`
- **Also tagged as**: `latest`, `v2`
- **CI Image**: `skyfay/dbackup:ci`
- **Platforms**: linux/amd64, linux/arm64


## v2.3.2 - Backup Trigger Metadata, Job Trigger Locking, and Notification Improvements
*Released: May 17, 2026*

### ✨ Features

- **Backup Metadata**: The trigger source (type and actor) is now stored in each backup's `.meta.json` sidecar file. The `trigger.type` field records how the backup was initiated (`Manual`, `Scheduler`, or `Api`). The `trigger.actor` field records the username or API key name - this can be disabled via the new Privacy settings tab. ([#81](https://github.com/Skyfay/DBackup/issues/81))
- **Settings**: A new "Privacy" tab has been added to System Settings. It currently contains a toggle to opt out of storing the trigger actor (username or API key name) in unencrypted backup metadata files. The setting is enabled by default.
- **Storage Explorer**: A new "Triggered by" column shows who or what initiated each backup, using the same badge style as the Activity Log (blue for Manual, violet for Scheduler, teal for API). The column is populated from the backup's metadata sidecar and only appears for backups created after this update.
- **Job Trigger API**: The `POST /api/jobs/{id}/run` endpoint now accepts an optional JSON body with a `lock` boolean field. When `lock: true` is set, the created backup is immediately written with `locked: true` in its `.meta.json` sidecar - excluding it from all retention policies. The CI container image (`skyfay/dbackup:ci`) supports this via a new `DBACKUP_AUTO_LOCK=1` environment variable. ([#80](https://github.com/Skyfay/DBackup/issues/80))

### 🐛 Bug Fixes

- **Notifications**: The "Test Connection" button for Email (SMTP) connectors now sends an actual test email to the configured recipient instead of only verifying the SMTP handshake. The success toast shows the recipient address ("Test email sent to …"). If the send fails the error is shown instead of always returning success. ([#79](https://github.com/Skyfay/DBackup/issues/79))
- **Notifications**: The "Test Connection" endpoint now enforces a 10-second timeout. Previously a wrong host or unreachable port caused the loading spinner to spin indefinitely. The user now receives a clear timeout error message instead.
- **Notifications**: Fixed email (SMTP) notifications failing with `No credential profile assigned to the primary slot` when no credential profile is set. The credential profile is now truly optional for the email adapter - if no profile is assigned the structural config (host, port, from, to, inline user/password if any) is used directly, which allows unauthenticated relays and connectors with embedded SMTP credentials to work. ([#79](https://github.com/Skyfay/DBackup/issues/79))
- **Notifications**: Backup and restore jobs no longer hang indefinitely when a notification channel (e.g. an unresponsive SMTP server) does not respond. A 30-second timeout is now enforced on every `send()` call in the runner pipeline and in the system notification service. A timed-out send is treated as a delivery failure and logged accordingly - the job is never blocked. ([#79](https://github.com/Skyfay/DBackup/issues/79))
- **Notifications**: The "Test" button in Settings / Notifications now correctly reports when delivery failed. Previously the action always returned `"Test notification sent"` even when every channel errored out internally. It now returns an explicit error when all channels failed, or a partial warning when some failed. ([#79](https://github.com/Skyfay/DBackup/issues/79))
- **Storage**: Fixed false "-100% change" spike notifications. All 10 storage adapters (Local, S3, SFTP, FTP, SMB, WebDAV, Rsync, Dropbox, Google Drive, OneDrive) were silently returning an empty file list on any connection or access error instead of throwing. This caused a 0-byte snapshot to be saved and triggered a -100% spike alert. Two changes were made: (1) all storage adapter `list()` functions now throw on error instead of returning `[]`, so the existing DB fallback in the stats cache is correctly triggered; (2) storage snapshots and spike checks are skipped for any adapter that fell back to DB estimation, preventing unreliable data from creating false alert history. ([#82](https://github.com/Skyfay/DBackup/issues/82))

### 🧪 Tests

- Updated unit tests for all 9 cloud/network storage adapters (`S3`, `SFTP`, `FTP`, `SMB`, `WebDAV`, `Rsync`, `Dropbox`, `Google Drive`, `OneDrive`) to expect `list()` to throw on connection/access errors, matching the behavior introduced by the #82 bug fix.
- Fixed missing `prisma.systemSetting` mock in the multi-destination upload step tests.
- Updated `executeJob` and `runJob` call assertions to include the third `options` argument introduced with the `lock` feature.
- Fixed 5 system-notification-service test assertions from `.toBeUndefined()` to `.toBeDefined()` to match the updated `notify()` return type.
- Fixed missing `@/lib/prisma` mock in `tests/unit/runner/steps/03-upload.test.ts` causing 10 `PrismaClientInitializationError` failures in CI (no `DATABASE_URL` available).
- Fixed TypeScript build errors: non-nullable trigger type access in `03-upload.ts`; `notify()` return type updated to allow `undefined`; null-check guard added in `notification-settings.ts`.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.3.2`
- **Also tagged as**: `latest`, `v2`
- **CI Image**: `skyfay/dbackup:ci`
- **Platforms**: linux/amd64, linux/arm64


## v2.3.1 - General Improvements, MySQL/MariaDB SSH Mode Fixes and SSH Key Conversion
*Released: May 11, 2026*

### 🎨 Improvements

- **Activity Logs**: Restore executions now record the initiating user in the "Trigger" column, showing a "Manual" badge with the user's name - the same badge style used for manually triggered backup jobs.

### 🐛 Bug Fixes

- **SSH**: Passphrase-protected private keys in PKCS#8 encrypted format (`-----BEGIN ENCRYPTED PRIVATE KEY-----`) now work natively without any manual conversion. The keys are transparently decrypted in-memory via Node.js `crypto` before being passed to the SSH library, which means Ed25519 and other key types with a passphrase are fully supported. This covers the SSH tunnel path (all database adapters), the SFTP storage adapter, and the MSSQL SSH transfer. The Vault credential dialog now shows a helpful amber hint when this format is detected, indicating that the passphrase field must be filled in.
- **MySQL/MariaDB SSH mode**: Removed `--protocol=tcp` from remote command arguments. On HestiaCP and other setups where MariaDB uses the `unix_socket` auth plugin, forcing TCP caused ERROR 1698 ("Access denied") even with correct credentials. Remote commands now let MariaDB choose the connection method.
- **MySQL/MariaDB SSH mode**: Fixed a false positive in the "Test Connection" check. A `SELECT 1` step is now run after `mysqladmin ping` - if authentication actually fails (e.g. ERROR 1045), the test correctly returns failure with the error message instead of a misleading "version unknown" success.
- **MySQL/MariaDB SSH mode**: `getDatabasesWithStats` now falls back to a plain `SHOW DATABASES` query (returning 0 for size/table count) when the `information_schema` stats query fails due to restricted permissions. This prevents a hard error in the Database Explorer on restricted setups.

### 🔄 Changed

- **MySQL/MariaDB SSH mode**: Passwords are no longer passed via `MYSQL_PWD` (silently ignored by MariaDB 11.4+). Credentials are now written to a temporary `.my.cnf` file locally, uploaded to the remote server via SFTP binary transfer (never visible in process lists or shell history), used with `--defaults-file` (which reads only the temp file, bypassing any system-level `/etc/mysql/my.cnf` or `~/.my.cnf` that could conflict), and deleted immediately after the command completes.
- **MySQL/MariaDB Direct mode**: Passwords are no longer passed via `MYSQL_PWD` for consistency and to support MariaDB 11.4+ client binaries. A temporary `.my.cnf` file (mode 0600) is now written locally and passed via `--defaults-file`, then deleted in a `finally` block.

### 📝 Documentation

- **MySQL/MariaDB source guide**: Updated SSH mode description to reflect the SFTP-based password delivery. Added SFTP requirement note (enabled by default on OpenSSH, no extra config needed), clarified SSH user permissions (write to `/tmp`, no `sudo` required), added troubleshooting entries for HestiaCP `unix_socket` auth and disabled SFTP subsystem.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.3.1`
- **Also tagged as**: `latest`, `v2`
- **CI Image**: `skyfay/dbackup:ci`
- **Platforms**: linux/amd64, linux/arm64


## v2.3.0 - CI Image, Activity Log Trigger and General Improvements
*Released: May 10, 2026*

### ✨ Features

- **Activity Logs**: Executions now record the trigger source. The history table shows a new "Trigger" column with a colored badge indicating how the job was started - "Manual" (Web UI, with the user's name), "Scheduler" (cron-based), or "Api" (with the API key name). Existing executions without trigger data gracefully show a dash. ([#72](https://github.com/Skyfay/DBackup/issues/72))
- **Instance Name**: Added an optional "Instance Name" field under Settings - General. When set, the browser tab title changes to "DBackup | {name}" (e.g. "DBackup | Production"), making it easy to distinguish multiple instances at a glance. The sidebar branding remains unchanged. ([#73](https://github.com/Skyfay/DBackup/issues/73))
- **Date Format**: Added "European (14/01/2026)" (`dd/MM/yyyy`) as a new date format option in Profile settings. The existing European dot format label was updated to "European (14.01.2026)" for clarity.
- **CI Image**: Added `skyfay/dbackup:ci` - a lightweight Ubuntu-based helper image for triggering DBackup jobs from CI/CD pipelines (GitHub Actions, GitLab CI, Azure DevOps). The image contains only `bash`, `curl`, and `jq`. Thanks @stewieoO ([#71](https://github.com/Skyfay/DBackup/pull/71))
- **API Trigger Dialog**: GitHub Actions, GitLab CI, and new Azure DevOps tabs now use the `skyfay/dbackup:ci` container image. Pipeline examples are simplified to a single `run: /backup/execute.sh` step.

### 🔄 Changed

- **Codecov**: Set `informational: true` on the patch coverage check so the Codecov status check never blocks a PR, even when patch coverage is below the target.

### 📝 Documentation

- **webhook-triggers**: Replaced the old manual GitHub Actions curl/jq example with a full CI/CD section covering GitHub Actions, GitLab CI, and Azure DevOps using the `skyfay/dbackup:ci` container image.
- **sqlite**: Fixed Docker mount instructions - changed from file-level bind mount to directory-level mount. The Online Backup API (`.backup`) requires access to WAL/SHM companion files; file-level mounts caused "attempt to write a readonly database" errors. Updated Backup Process section to document the `.backup` command instead of the old `.dump` approach.

### 🔧 CI/CD

- **release.yml**: Added `build-ci-image` job that builds and pushes `skyfay/dbackup:ci` (GHCR + Docker Hub) automatically on every release, running in parallel with the main image build.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.3.0`
- **Also tagged as**: `latest`, `v2`
- **CI Image**: `skyfay/dbackup:ci`
- **Platforms**: linux/amd64, linux/arm64


## v2.2.1 - Scheduler Timezone Fixes, Smart Recovery Improvements, and more Bug Fixes
*Released: May 9, 2026*

### ✨ Features

- **profile**: Added an "Auto (Browser Timezone)" option to the timezone selector in Profile. New users now default to Auto instead of UTC - timestamps automatically follow the browser's detected timezone without any manual configuration.

### 🐛 Bug Fixes

- **SQLite**: Fixed a silent data-loss bug where backup jobs produced SQL text files instead of valid binary databases. The dump command now uses the SQLite Online Backup API (`.backup`) producing a proper `.db` file, fixing WAL-mode databases that previously produced near-empty output. The restore pipeline now uses `.restore` instead of SQL-via-stdin.
- **Timezone**: Schedule picker preview now shows the correct time in the Scheduler Timezone (from Settings - General). The timezone name is appended to the description (e.g. `Runs every day at 03:00 (Europe/Berlin)`). ([#66](https://github.com/Skyfay/DBackup/issues/66))
- **Timezone**: Dashboard activity chart now groups executions by day using the Scheduler Timezone. Jobs running near midnight are now assigned to the correct day. ([#65](https://github.com/Skyfay/DBackup/issues/65))
- **Timezone**: History table "Started At" column now displays timestamps in each user's own profile timezone instead of forcing the scheduler timezone on everyone.
- **Timezone**: Health history tooltip now uses the user's profile timezone for timestamps.
- **Smart Recovery**: Fixed Smart Recovery failing for single-DB backups after a key delete and re-import. The content heuristic now checks GZIP magic bytes unconditionally (catches pipeline GZIP and MongoDB `--gzip` archives without pipeline compression), and adds detection for the PostgreSQL custom dump format (`PGDMP` magic at offset 0). Previously, only multi-DB TAR archives and plain-text SQL were recognized - all PostgreSQL single-DB backups (which always use `pg_dump -Fc` binary format) and MongoDB single-DB gzip archives fell through with no match and Smart Recovery always failed. ([#58](https://github.com/Skyfay/DBackup/issues/58))

### 📝 Documentation

- **Roadmap**: Added Restic storage backend as a planned feature. ([#68](https://github.com/Skyfay/DBackup/issues/68))
- **Timezones guide**: Added a new [Timezones](https://docs.dbackup.app/user-guide/features/timezones) page explaining the two-timezone model (Scheduler Timezone vs. User Display Timezone), configuration, and troubleshooting.
- **Scheduling guide**: Updated the Time Zone section to refer to the Scheduler Timezone UI setting instead of the `TZ` environment variable.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.2.1`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.2.0 - Templates System, Docker Image Update and Bug Fixes
*Released: May 7, 2026*

> ⚠️ **Breaking:** All existing per-destination inline retention configurations have been migrated to "Keep All (Unlimited)". The new Templates System requires retention to be configured by assigning a named **Retention Policy** to each job destination. Existing retention rules must be re-configured via **Templates -> Retention Policies**. You can also mark one policy as the system-wide default so it applies automatically to any destination that has no explicit policy assigned.

### ✨ Features

- **Templates System**: Added a dedicated **Templates** page under Administration (`/dashboard/templates`) with three tabs: **Retention Policies** (reusable named retention rules assignable per destination, with a "Set as Default" option - the default policy is used automatically when no policy is assigned to a destination), **Naming Templates** (custom backup file name patterns with token insertion, one can be set as system default), and **Schedule Presets** (named cron expressions usable as quick-fill presets or as live-linked schedules that automatically apply to all linked jobs when updated). ([#61](https://github.com/Skyfay/DBackup/issues/61))
- **Jobs**: Destinations in the Job form now use a Retention Policy picker (instead of inline retention config tabs) to assign a named retention policy per destination. Legacy per-destination retention JSON is still respected as a fallback.
- **Jobs**: The Advanced tab of the Job form now includes a Naming Template picker to override the system default file name pattern for that specific job.
- **Jobs**: The Schedule field in the Job form now includes a Preset toggle that opens a searchable dropdown of saved Schedule Presets, selecting one auto-fills the cron expression.
- **Jobs**: Added a "Browse Backups" button (`FolderOpen` icon) to the Actions column in the Jobs table, positioned after the Run button. It navigates directly to the Storage Explorer with the destination pre-selected and the job name filter automatically applied (if backups for that job exist). When a job has multiple destinations, a dropdown appears to select which one to open. ([#59](https://github.com/Skyfay/DBackup/issues/59))
- **Naming Templates - Extended Token Set**: Added `{job_name}` as the canonical job-name token (replaces `{name}`, which remains supported for backward compatibility). Added `MMM` (short month name, e.g. `Jan`) and `MMMM` (full month name, e.g. `January`) date tokens. Arbitrary literal text can now be used freely in any pattern without escaping (e.g. `prod_{db_name}-yyyy-MM-dd`). The template engine was rewritten to perform direct token substitution instead of delegating the full pattern string to `date-fns` format, eliminating silent misinterpretation of literal characters as format tokens. Token chips in the dialog now insert at the current cursor position, are grouped by category (Job Info, Date, Time), and show a tooltip with a description on hover.
- **Storage Explorer - Default sort**: The file list in the Storage Explorer now defaults to sorting by "Last Modified" in descending order so the latest backups are always shown first. ([#59](https://github.com/Skyfay/DBackup/issues/59))

### 🐛 Bug Fixes

- **MySQL `caching_sha2_password`**: Fixed authentication failure when connecting to MySQL 8 servers using the `caching_sha2_password` auth plugin. The Docker base image has been migrated from Alpine (`node:24-alpine`) to Debian Slim (`node:24-slim`). The Debian package `mariadb-client` ships with `libmariadb3 3.3.x`, which supports `caching_sha2_password` natively - the Alpine MariaDB client was too old to handle this auth method. ([#48](https://github.com/Skyfay/DBackup/issues/48))
- **SQLite backups**: Fixed missing `sqlite3` CLI tools in the Docker image, which caused SQLite backup jobs to fail when the database was mounted locally inside the container. ([#62](https://github.com/Skyfay/DBackup/issues/62))
- **Smart Recovery**: Fixed a bug where restoring after a key delete and re-import always failed, even when the correct key was available. The content heuristic incorrectly rejected uncompressed TAR archives (multi-DB backups) because their headers consist mostly of null-byte padding - Smart Recovery now also detects POSIX TAR magic bytes (`ustar` at offset 257). ([#58](https://github.com/Skyfay/DBackup/issues/58))

### 🗑️ Removed

- **Telegram MarkdownV2**: Removed the `MarkdownV2` parse mode option from Telegram notification adapters. It caused silent delivery failures while the UI incorrectly reported success. Use `HTML` or `Markdown` instead. ([#57](https://github.com/Skyfay/DBackup/issues/57))

### 🧪 Tests

- Improved unit test coverage across multiple services and adapters.
- **Naming Template Engine**: Added missing test cases - empty pattern, plain-text passthrough, date-token-in-job-name edge case (documented behavior), and timezone day-boundary shift. Total engine tests: 16.
- **Naming Template Service**: Test for `getNamingTemplate` updated to verify the returned value (was only checking the call, not the result).

### 🔧 CI/CD

- **Docker base image**: Migrated from `node:24-alpine` to `node:24-slim` (Debian bookworm). The Debian package `mariadb-client` ships with `libmariadb3 3.3.x`, which supports the `caching_sha2_password` authentication plugin natively - fixing the Alpine limitation where the bundled MariaDB client was too old. `su-exec` replaced with `gosu`. MongoDB Database Tools bumped to `100.16.1` via direct CDN download (MongoDB ships no Debian 12 arm64 packages - arm64 uses the `ubuntu2204-arm64` build, which is compatible with Debian bookworm).
- **Healthcheck**: Fixed healthcheck failing when the `PORT` environment variable was set to a non-default value. The check now uses `${PORT:-3000}` and correctly follows the configured port.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.2.0`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.1.1 - Docker Secrets support and SSH Credential Profile fixes
*Released: May 5, 2026*

### ✨ Features

- **Docker Secrets**: Added `_FILE` convention support for `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` - set `ENCRYPTION_KEY_FILE=/run/secrets/encryption_key` to load the value from a file instead of passing it as a plaintext environment variable. Docker Swarm secrets and any file-based secrets manager (Vault Agent, Kubernetes secrets mounted as files) are now supported without a custom entrypoint wrapper. ([#53](https://github.com/Skyfay/DBackup/issues/53))

### 🎨 Improvements

- **Storage Explorer**: The "Source" column now shows the database-specific adapter icon (MySQL, PostgreSQL, MongoDB, SQLite, etc.) instead of the generic database icon, matching the icon style used on the Sources page.

### 🐛 Bug Fixes

- **sources**: Fixed "SSH username is required" error when testing an SSH connection for a SQLite source that uses an SSH Credential Profile. The SQLite SSH test button now correctly passes `adapterId` and `sshCredentialId` to the `test-ssh` route so the credential profile is resolved server-side. The route also normalizes SQLite's unprefixed SSH fields (`username`, `authType`, etc.) to the standard `ssh*`-prefixed convention expected by `extractSshConfig`. Fixed the same credential-profile issue for the remote file browser ("Select Remote Path") in the Configuration tab - `sshCredentialId` is now forwarded through `FieldList` and `SchemaField` to `FileBrowserDialog` and resolved in the `filesystem/remote` API route before connecting via SFTP. ([#55](https://github.com/Skyfay/DBackup/issues/55))

### 📝 Documentation

- **Docker Secrets**: Added "Docker Secrets (`_FILE` convention)" section to the Installation Guide with full setup examples for Docker Swarm and Docker Compose. Added the same convention to the Environment Variables developer reference, including error handling behavior and a link to the install guide.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.1.1`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.1.0 - Backup Notification Subjects, Telegram Topic Support, and 2FA Setup UX
*Released: May 5, 2026*

### ✨ Features

- **System Tasks**: Each task row in Settings - System Tasks now shows a "Last run" timestamp and a "Next run" timestamp. Both are displayed in the system timezone (Scheduler Timezone setting) and respect the user's configured date and time format.
- **Notifications**: Backup notification subjects (email, Discord, Slack, etc.) now include the job name (e.g. "Backup Successful: Production DB" / "Backup Failed: Production DB"), making it easy to identify which job triggered the notification without opening it. ([#46](https://github.com/Skyfay/DBackup/issues/46))
- **Telegram**: Added optional Topic/Thread ID field (`messageThreadId`) to the Telegram notification adapter, enabling notifications to be sent to a specific topic in Telegram forum groups. Leave the field empty to send to the main chat (fully backwards-compatible). ([#45](https://github.com/Skyfay/DBackup/issues/45))
- **2FA**: The TOTP setup dialog now has a tab switcher between "QR Code" and "Manual Key". The secret key is hidden by default and can be revealed with the eye icon, supporting manual entry in authenticator apps even without clipboard access (e.g. over plain HTTP). ([#39](https://github.com/Skyfay/DBackup/issues/39))

### 🐛 Bug Fixes

- **System Configuration Backup**: Credential Profiles (Vault) were missing from config backup export and import. The export now includes all credential profiles (with encrypted `data` decrypted to plaintext inside the backup, re-encrypted on import). The import restores credential profiles before adapters (required by FK constraint) and correctly remaps `primaryCredentialId`/`sshCredentialId` on adapters when IDs differ between systems. Invalid credential references are now silently nulled out with a warning instead of causing a transaction failure.

### 🔒 Security

- **Dependencies**: Updated `webdav` to `5.10.0` to pull in `fast-xml-parser >= 5.7.0`, fixing an XML Comment/CDATA injection vulnerability (GHSA-gh4j-gqv2-49f6).
- **Dependencies**: Added `pnpm overrides` to force `dompurify >= 3.4.0` (fixes 9 XSS/prototype-pollution CVEs in the `monaco-editor` transitive dependency) and `postcss >= 8.5.10` (fixes XSS via unescaped `</style>` in Next.js transitive dependency, GHSA-qx2v-qp2m-jg93).

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.1.0`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.0.1 - SSH Connection Fix with new Credential Profiles
*Released: May 3, 2026*

### 🐛 Bug Fixes

- **sources**: Fixed "SSH username is required" error when testing an SSH database source connection that uses an SSH Credential Profile. The test-ssh route now resolves the credential profile before validating the username, matching the behavior of the main test-connection route.
- **sources**: Fixed missing placeholder text for SSH Host and SSH Port fields in the SSH Connection tab - added generic `sshHost`, `sshPort`, `sshUsername`, and `sshPrivateKey` entries to `PLACEHOLDERS` in `form-constants.ts`.

### 🧪 Tests

- **update-service**: Fixed 3 failing unit tests that hardcoded `'2.0.0'` as `currentVersion` - tests now import `version` dynamically from `package.json` so they stay correct after every version bump.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.0.1`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v2.0.0 - Credential Profiles, Naming Template, Cloning, and Major Refactor
*Released: May 3, 2026*

> ⚠️ **Breaking:** Existing Sources, Destinations and Notifications that store credentials inline will require a Credential Profile to be assigned before they come back online. Create the matching profiles in the Security Vault, then assign them to each adapter via the edit form. This has to be done manually for each adapter, so take some time before upgrading. The new Credential Profile system is a critical security improvement that centralizes and encrypts all secrets in the Vault, but it does require some manual migration effort for existing adapters. New adapters created after the update will require credential profiles from the start.

### ✨ Features

- **credentials**: Added the Generic Credential Profile System - reusable, AES-256-GCM encrypted credential profiles (Username/Password, SSH Key, Access Key, Token, SMTP) that adapters reference instead of storing secrets inline. Profiles are managed in the Security Vault, assigned via a searchable picker in the adapter form, and automatically merged into every backup, restore, health check, and notification at runtime.
- **setup**: Added Credential Profile picker to the Quick Setup Wizard Source, Destination, and Notification steps - the picker now renders identically to the standalone "Add Source/Destination/Notification" dialogs, including SSH credential support. The selected profile IDs are included in the adapter creation payload.
- **ui**: Added clone (copy) button to Sources, Destinations, Notifications, and Backup Jobs - cloning creates a duplicate with the name suffix "(Copy)" and carries over all settings including Vault credential references. Cloned jobs start as disabled to prevent accidental execution. Resolves [#34](https://github.com/Skyfay/DBackup/issues/34)
- **storage**: Added `jurisdiction` field to the Cloudflare R2 adapter (`Standard`, `EU`, `FedRAMP`) - EU-jurisdiction buckets require the `*.eu.r2.cloudflarestorage.com` endpoint, without this setting they return "Access Denied" or "bucket does not exist"
- **website**: Added a new Website https://dbackup.app
- **scheduler**: Added a UI setting in Settings > General to configure the scheduler timezone without changing the `TZ` environment variable. When set, the DB value takes explicit priority over `TZ` for all cron jobs. Thanks @iberlob ([#41](https://github.com/Skyfay/DBackup/pull/41))
- **backup**: Added a configurable filename pattern for backup files. Patterns support tokens (`{name}`, `{db_name}`, `yyyy`, `MM`, `dd`, `HH`, `mm`, `ss`) with a live preview and clickable token chips in Settings > General. Thanks @iberlob ([#41](https://github.com/Skyfay/DBackup/pull/41))
- **2fa**: Added a "Can't scan? Copy the secret key" button to the 2FA setup dialog so users who cannot scan the QR code can manually enter the TOTP secret into their authenticator app. ([#39](https://github.com/Skyfay/DBackup/issues/39))

### 🐛 Bug Fixes

- **storage**: Fixed FTP/FTPS adapter uploading to a doubled path when the job folder contains subdirectories - `basic-ftp`'s `ensureDir` changes the working directory to the created directory, causing the subsequent `uploadFrom` call to resolve the relative path against the new CWD instead of root, resulting in a 553 Permission denied error from the server. A `cd("/")` is now called after `ensureDir` to reset the working directory before the upload.
- **notifications**: Fixed Email (SMTP) `From` and `To` fields appearing in both the Connection and Configuration tabs - removed `from` and `to` from `NOTIFICATION_CONNECTION_KEYS` so they only render in the Configuration tab
- **storage**: Fixed Google Drive, OneDrive, and Dropbox OAuth redirect URIs using `req.nextUrl.origin` (resolves to `0.0.0.0:3000` internally) instead of `BETTER_AUTH_URL` when deployed behind a reverse proxy, causing OAuth failures - Thanks @garrettstoupe
- **jobs**: Fixed pipeline Compression selector being permanently disabled for all adapter types on the job form - `isNativeCompressionActive` now only evaluates to true when a PostgreSQL source is selected and a native compression algorithm (Legacy, Gzip, LZ4, ZSTD) is active. Non-PostgreSQL adapters can always choose a compression algorithm.

### 🔒 Security

- **deps**: Updated `next` from `16.2.2` to `16.2.4` - fixes DoS with Server Components (GHSA-q4gf-8mx6-v5v3)
- **deps**: Updated `@scalar/api-reference-react` from `0.9.18` to `0.9.31` - resolves critical `protobufjs` arbitrary code execution (GHSA-xq3m-2v4x-88gg) via transitive dependency update
- **deps**: Updated `better-auth` and `@better-auth/sso` from `1.5.6` to `1.6.9` - resolves `drizzle-orm` SQL injection (GHSA-gpj5-g38j-94v9) and 4 `@xmldom/xmldom` XML injection/DoS vulnerabilities via transitive dependency updates
- **deps**: Added `vite@^7.3.2` as direct devDependency - fixes 3 high-severity path traversal and arbitrary file read vulnerabilities in dev server (GHSA-v2wj-q39q-566r, GHSA-p9ff-h696-f583, GHSA-4w7w-66w2-5vf9)
- **deps**: Updated `nodemailer` from `7.0.13` to `8.0.7` - fixes SMTP command injection via CRLF in transport name and envelope size (GHSA-vvjj-xcjg-gr5g, GHSA-c7w3-x93f-qmm8)

### 🎨 Improvements

- **history**: Replaced native browser scrollbar with Shadcn `ScrollArea` in the Notification Log preview dialog, consistent with the Activity Log dialog
- **jobs**: Renamed "Security" tab to "Advanced" in the backup job form - the tab contains both Compression and Encryption settings, so "Advanced" is more accurate
- **refactor**: Major codebase reorganization - split three oversized files (`config-service.ts`, `restore-service.ts`, `adapters/definitions.ts`) into focused sub-modules via the Facade Pattern, and grouped all loose files in `src/lib/` (20 files into 6 folders), `src/services/` (19 files into 9 folders), and `src/app/actions/` (14 files into 5 folders) into a clear directory structure. Also consolidated `src/types.ts` into `src/types/index.ts`, all ~600 import paths across source, tests, and docs were updated and public APIs remain unchanged

### 🔄 Changed

- **docs**: Renamed `wiki/` folder to `docs/` and moved documentation domain from `dbackup.app` to `docs.dbackup.app` across all configuration files, app source code, CI/CD workflows, and docs content
- **deps**: Bumped minor/patch versions for `react`, `react-dom`, `tailwindcss`, `@tailwindcss/postcss`, `eslint-config-next`, `vitest`, `basic-ftp`, `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `jsdom`, `mongodb`, `mssql`, `tar-stream`, `zod`, `react-hook-form`, `lucide-react` - no breaking changes

### 📝 Documentation

- **SSO**: Fixed incorrect SSO callback URL in all provider setup guides - the correct path is `/api/auth/sso/callback/{provider-id}`, not `/api/auth/callback/{provider-id}`.
- **credentials**: Added a new user-guide page `security/credential-profiles.md` documenting types, slots, inline creation flow, reference tracking, REVEAL semantics, and the REST surface, added a top-of-page note to `security/encryption.md` clarifying that the Vault now hosts both an Encryption tab and a Credentials tab, added the page to the security sidebar in `.vitepress/config.mts`
- **api**: Documented the full `/api/credentials` REST surface in `public/openapi.yaml` under the `Vault` tag, including a `CredentialType` enum and per-type `data` schemas (`UsernamePasswordData`, `SshKeyData`, `AccessKeyData`, `TokenData`, `SmtpData`), plus a new `BadRequest` shared response
- **api**: Added missing `POST /jobs/{id}/clone`, `POST /adapters/{id}/clone`, and `POST /executions/{id}/cancel` endpoints to both `public/openapi.yaml` and `api-docs/openapi.yaml`. Fixed `ExecutionStatus` schema to include the `Cancelled` value. Extended `/adapters/test-connection` request body with optional `primaryCredentialId` and `sshCredentialId` fields. Synced Vault tag description between both files.
- **adapters**: Updated all database source guides (MySQL, PostgreSQL, MongoDB, Redis, MSSQL, SQLite) to replace inline credential fields with Credential Profile pickers (`USERNAME_PASSWORD` or `SSH_KEY` type). Added `::: info Credential Profile required` boxes with links to the credential-profiles page.
- **adapters**: Updated all destination guides (SFTP, FTP, SMB, WebDAV, rsync, Amazon S3, S3-Compatible, Cloudflare R2, Hetzner Object Storage) to replace inline credential fields with Credential Profile pickers (`SSH_KEY`, `USERNAME_PASSWORD`, or `ACCESS_KEY` type). Added setup guide steps to create the credential profile first. Added Jurisdiction field and EU jurisdiction warning to R2 guide.
- **adapters**: Updated Email (SMTP) notification guide to replace inline User/Password fields with `SMTP` credential profile picker.
- **jobs**: Added "Filename Pattern" section to `jobs/index.md` documenting the configurable filename pattern setting (Settings → General), all supported tokens (`{name}`, `{db_name}`, date/time tokens), live preview, and clickable token chips.
- **first-steps**: Updated Quick Setup "Advanced tab" reference (renamed from "Security" in v2.0.0) and revised Manual Setup Step 2 (MySQL example) to reference creating a `USERNAME_PASSWORD` credential profile before adding the source.
- **profile-settings**: Added note about "Can't scan? Copy the secret key" button in the 2FA setup dialog.

### 🗑️ Removed

- **dead-code**: Removed unused `checkPermission as _checkPermission` alias imports from `actions/backup/encryption.ts` and `actions/backup/upload.ts` - the symbol was never called in either file
- **dead-code**: Removed 43-line developer thought-stream comment block from `uploadAvatar()` in `actions/backup/upload.ts`, along with a redundant `await getUserPermissions()` call that served no authorization purpose

### 🧪 Tests

- **coverage**: Massively expanded the unit test suite across the entire codebase - added hundreds of new tests covering all database adapters (MySQL, PostgreSQL, MSSQL, MongoDB, Redis, SQLite), all storage adapters, notification adapters, the backup pipeline steps, services, auth, crypto, OIDC, and core utilities, bringing the majority of source files to 100% statement and line coverage.

### 🐳 Docker

- **Image**: `skyfay/dbackup:v2.0.0`
- **Also tagged as**: `latest`, `v2`
- **Platforms**: linux/amd64, linux/arm64


## v1.4.8 - Scheduler, Runner & TLS Fixes
*Released: April 24, 2026*

### 🐛 Bug Fixes

- **scheduler**: Fixed a race condition where concurrent `scheduler.refresh()` calls (e.g. saving a job while config-backup settings are updated simultaneously) could create orphaned `node-cron` tasks that are never stopped. These ghost tasks could cause scheduled jobs to fire more than once per cron interval
- **scheduler**: Fixed the scheduler singleton not being stored on `globalThis` in production mode (`NODE_ENV=production`). If the module was re-imported in a fresh module scope (a known Next.js standalone behavior), a second independent `BackupScheduler` instance with its own cron tasks was created
- **runner**: Fixed a TOCTOU race condition in `performExecution` that caused duplicate backup files when two or more jobs are scheduled at the same cron minute. Both `processQueue()` calls ran concurrently, both found the same `Pending` execution, and both ran the full backup pipeline. The execution is now claimed atomically via a conditional `updateMany` (`status: "Pending" → "Running"`), the call that gets `count=0` back exits immediately without running the backup ([#32](https://github.com/Skyfay/DBackup/issues/32))
- **tls**: Fixed self-signed certificate not including the hostname from `BETTER_AUTH_URL` as a SubjectAltName (SAN). Browsers like Brave (and per RFC, all browsers) block `fetch()` API calls when the SAN does not match the accessed hostname, even after manually accepting the certificate warning for the page itself. The generated SAN now includes the hostname/IP extracted from `BETTER_AUTH_URL` in addition to `localhost` and `127.0.0.1`. On startup, if an existing self-signed cert is missing the configured hostname, it is automatically regenerated. The "Regenerate" button in Settings also benefits from this fix

### 🎨 Improvements

- **scheduler**: `scheduler.refresh()` is now fire-and-forget at all call sites (job create/update/delete, config-backup settings save, system-task API). The DB write completes and the response is returned to the browser immediately, the scheduler rebuilds its task list in the background. This eliminates the UI hang that some users noticed when saving settings

### 🔧 CI/CD

- **docker**: Added a BuildKit cache mount (`--mount=type=cache,target=/app/.next/cache`) to the builder stage in the Dockerfile. Combined with the existing `type=gha,mode=max` layer cache in the release workflow, Next.js reuses its webpack/SWC artefacts for unchanged modules between releases - cutting image build times significantly

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.4.8`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v1.4.7 - PostgreSQL Compression, MSSQL Dump Fixes & Docker Metadata
*Released: April 22, 2026*

### ✨ Features

- **postgresql**: Added per-job native PostgreSQL dump compression. Jobs with a PostgreSQL source now expose an "Algorithm" selector (Legacy Gzip-6, None, Gzip, LZ4, ZSTD) and a "Level" input under the Security tab. The selection maps directly to `pg_dump -Z`, allowing e.g. `-Z zstd:3` or `-Z lz4:1` without modifying the source adapter config ([#24](https://github.com/Skyfay/DBackup/issues/24))

### 🐛 Bug Fixes

- **postgresql**: Fixed hardcoded `-Z 6` in the PostgreSQL dump adapter. Previously, `pg_dump` always ran with Gzip level 6 regardless of the job's compression setting, resulting in silent double-compression when pipeline Gzip or Brotli was enabled. The adapter now derives the `-Z` flag from the job's `pgCompression` setting (legacy jobs are unaffected) ([#24](https://github.com/Skyfay/DBackup/issues/24))
- **mssql**: Fixed `Dump failed: No database specified for backup` when no databases were selected in the job. The MSSQL adapter now auto-discovers all user databases (matching the behavior of MySQL/PostgreSQL adapters) instead of aborting ([#30](https://github.com/Skyfay/DBackup/issues/30))
- **backup**: Fixed all database adapters (MySQL, PostgreSQL, MSSQL, etc.) only backing up one database when no explicit selection was made in the job config. The source config's default `database` field was leaking through and overriding the intended "backup all" behavior ([#30](https://github.com/Skyfay/DBackup/issues/30))

### 🔧 CI/CD

- **docker**: Added `lz4` and `zstd` Alpine packages to the base image so that `pg_dump` (postgresql18-client) can use LZ4 and ZSTD native compression at runtime
- **docker**: Added OCI standard labels to Docker image (`title`, `description`, `url`, `source`, `version`, `revision`, `created`, `licenses`, `vendor`) via `docker/metadata-action@v5` for better registry compatibility and dependency bot integration ([#27](https://github.com/Skyfay/DBackup/pull/27)) - Thanks @Erwan-loot
- **codecov**: Added Codecov integration - `codecov.yml`, `@vitest/coverage-v8`, `test:coverage` script, lcov reporter in `vitest.config.ts`, and coverage upload step in `validate.yml` using OIDC (no token secret required)

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.4.7`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v1.4.6 - Issue Templates and extension corrections
*Released: April 19, 2026*

### 🔄 Changed

- **backup**: Multi-database backups now use `.tar` file extension instead of the adapter-specific extension (e.g. `.sql`), correctly reflecting the TAR archive format ([#25](https://github.com/Skyfay/DBackup/issues/25))

### 🔧 CI/CD

- **github**: Added GitHub Issue templates for Bug Reports, Feature Requests, Questions/Support, and Documentation Issues

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.4.6`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v1.4.5 - SSH Backup Fixes with single database selection
*Released: April 19, 2026*

### 🐛 Bug Fixes

- **postgres**: Fixed single-database backups via SSH running `pg_dump` locally instead of on the remote server, causing "Connection refused" errors ([#22](https://github.com/Skyfay/DBackup/issues/22))
- **mongodb**: Fixed same SSH bypass bug for single-database `mongodump` backups

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.4.5`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v1.4.4 - HTTPS Redirect Loop Fix
*Released: April 18, 2026*

### 🐛 Bug Fixes

- **auth**: Fixed infinite redirect loop (ERR_TOO_MANY_REDIRECTS) after login in Docker/HTTPS mode caused by middleware not recognizing the `__Secure-` cookie prefix that browsers set for HTTPS sessions

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.4.4`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v1.4.3 - TypeScript Migration, Prisma Upgrade & Security Fixes
*Released: April 5, 2026*

### 🎨 Improvements

- **server**: Converted `custom-server.js` to TypeScript (`custom-server.ts`) for consistent type safety across the codebase - compiled to JS during Docker build via dedicated `tsconfig.server.json`

### 🔄 Changed

- **database**: Upgraded Prisma ORM from v5 to v6 (v6.19.3) for continued security patches and bug fixes
- **SSO**: Migrated SSO credential decryption from deprecated `$use` middleware to `$extends` query extension API
- **auth**: Upgraded better-auth from v1.4.17 to v1.5.6 with SSO hardening, Prisma adapter fixes, and security improvements
- **dependencies**: Updated all patch/minor dependencies - Next.js, React, Tailwind CSS, Zod, AWS SDK, Vitest and 20+ other packages

### 🗑️ Removed

- **auth**: Removed deprecated `@better-auth/cli` package (replaced by `npx auth` CLI)

### 🔧 CI/CD

- **Docker**: Prisma CLI version in Dockerfile is now dynamically read from `package.json` at build time instead of being hardcoded, ensuring automatic version sync

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.4.3`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v1.4.2 - Security Fixes
*Released: April 2, 2026*

### 🔒 Security

- **OneDrive**: Fixed polynomial ReDoS vulnerability (CWE-1333) in folder path sanitization by replacing regex with iterative string trimming
- **CI/CD**: Added explicit `permissions: contents: read` to `sync-gitlab.yml` and `validate.yml` workflows to restrict default `GITHUB_TOKEN` privileges (CWE-275)
- **Google Drive**: Fixed incomplete string escaping in query builder - backslashes are now escaped before single quotes to prevent query injection (CWE-20, CWE-116)
- **API Keys**: Upgraded hash from SHA-256 to scrypt (N=16384, r=8, p=1) with automatic migration for existing keys (CWE-916)
- **Filesystem API**: Expanded blocked-prefix list for sensitive system paths - now covers Linux (`/proc`, `/sys`, `/dev`), macOS (`/System`, `/Library/Keychains`), and Windows WSL paths with dedicated `sanitizePath()` validation (CWE-22)
- **TAR Extraction**: Added Zip Slip protection in multi-DB TAR extraction using `path.basename()` validation (CWE-22)
- **MSSQL Restore**: Added Zip Slip protection in MSSQL TAR extraction using `path.basename()` validation (CWE-22)
- **TLS Server**: Removed environment-derived path from log output to prevent clear-text logging of sensitive directory info (CWE-532)

### 🧪 Tests

- **Lint Guards**: Fixed incomplete regex escaping in glob-to-regex conversion for `no-console` and `no-config-any` test helpers (CWE-116)
- **API Keys**: Added unit tests for scrypt hashing, deterministic hash output, SHA-256 legacy migration path, and scrypt-is-not-SHA-256 verification

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.4.2`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v1.4.1 - PostgreSQL Client Cleanup
*Released: April 2, 2026*

### 🎨 Improvements

- **PostgreSQL**: Restore warning for PostgreSQL ≤ 16 now explains that `SET transaction_timeout` is a cosmetic pg_restore 18 issue and does not affect the restore
- **codebase**: Replaced all em dashes with hyphens across source code, docs, and config files for typographic consistency

### 🗑️ Removed

- **PostgreSQL**: Removed multi-version pg_dump/pg_restore strategy (PG 14, 16, 17, 18) - only PostgreSQL 18 client is now installed, which is backward compatible with all supported server versions (12–18)

### 🔧 CI/CD

- **Docker**: Simplified Dockerfile by removing postgresql14/16/17-client packages and multi-version symlink setup, reducing image size

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.4.1`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v1.4.0 - Live History Redesign
*Released: March 31, 2026*

### ✨ Features

- **logging**: Pipeline stage system for backups (Queued → Initializing → Dumping → Processing → Uploading → Verifying → Retention → Notifications → Completed) and restores (Downloading → Decrypting → Decompressing → Restoring Database → Completed) with automatic progress calculation and duration tracking per stage
- **ui**: LogViewer redesign with pipeline stage grouping, duration badges, pending stage placeholders, and auto-expanding latest stage during execution
- **ui**: Real-time speed (MB/s) and byte progress display for all backup and restore operations - dump, compress, encrypt, upload, download, decrypt, decompress, and SFTP transfer

### 🎨 Improvements

- **logging**: MongoDB adapter now buffers stderr output and emits it as a single structured log entry instead of flooding the log with individual lines
- **logging**: SQLite adapter logs now use typed log levels for consistent display
- **storage**: Google Drive adapter now reports intermediate upload progress instead of only 100% at completion
- **storage**: Download progress tracking added to S3, SFTP, Google Drive, OneDrive, WebDAV, and FTP adapters for restore operations
- **restore**: MySQL/MariaDB SSH restore now shows SFTP upload progress with real-time byte tracking

### 🐛 Bug Fixes

- **storage**: Fixed local filesystem adapter logging "Preparing local destination" twice per upload

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.4.0`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v1.3.0 - SSH Remote Execution
*Released: March 29, 2026*

### ✨ Features

- **ssh**: SSH remote execution mode for MySQL, MariaDB, PostgreSQL, MongoDB and Redis - database tools (mysqldump, pg_dump, mongodump, redis-cli) run directly on the remote host via SSH instead of requiring a local client or SSH tunnel
- **ssh**: New shared SSH infrastructure (`src/lib/ssh/`) with reusable client, shell escaping, remote binary detection, and per-adapter argument builders
- **ssh**: Generic SSH connection test endpoint - "Test SSH" button now works for all SSH-capable adapters, not just MSSQL
- **ui**: SSH configuration tab in the source editor for all SSH-capable database adapters (MySQL, MariaDB, PostgreSQL, MongoDB, Redis) with connection mode selector
- **sqlite**: Added "Test SSH Connection" button to the SQLite SSH configuration tab, matching all other SSH-capable adapters

### 🐛 Bug Fixes

- **backup**: MySQL, PostgreSQL, and MongoDB backup jobs with no database selected now auto-discover all databases at runtime - MySQL no longer fails with "No database specified", PostgreSQL no longer defaults to the username as database name, and MongoDB SSH listing was fixed by switching `mongosh --eval` to single quotes to prevent bash `!` history expansion from silently corrupting the command, backup metadata is now correctly populated for restore mapping.
- **restore**: Restore page no longer shows SQLite-style "Overwrite / Restore as New" UI for server-based adapters - now shows a target database name input when database names are unknown, and auto-discovers database names in backup metadata for future backups
- **ssh**: Fixed MySQL/MongoDB SSH restore not consuming stdout, which could cause backpressure and hang/crash the remote process
- **restore**: Fixed MySQL SSH restore crashing the Node.js process with OOM (16 GB heap) when restoring large databases - stderr log output is now rate-limited (max 50 messages, 500 chars each) to prevent unbounded memory growth
- **restore**: Fixed MySQL restore via SSH failing with "Server has gone away" on large dumps - `mysql` client now uses `--max-allowed-packet=64M` to handle large legacy INSERT statements
- **backup**: Fixed MySQL dump producing huge INSERT statements that cause OOM kills on remote servers during restore - `mysqldump` now uses `--net-buffer-length=16384` to limit each INSERT to ~16 KB, and `mysql` client `--max-allowed-packet` reduced from 512M to 64M to minimize client memory allocatione
- **ui**: Fixed Download Link modal overflowing the viewport when a link is generated - dialog now has a max height and scrollable body
- **ui**: Fixed Job Status donut chart legend breaking to multiple lines with uneven layout when 3+ statuses (e.g. Completed, Failed, Cancelled) are shown - legend items now flow naturally and stay centered

### 🔒 Security

- **ssh**: Fixed database passwords (MYSQL_PWD, PGPASSWORD) being exposed in execution logs when a remote process is killed by OOM or signal - `remoteEnv()` now uses `export` statements instead of inline env var prefix, and the MySQL stderr handler redacts known secrets from all output

### 🎨 Improvements

- **ui**: Redesigned source form for SSH-capable adapters - Connection Mode selector now appears first (like SQLite), SSH Connection tab is shown first in SSH mode so users configure SSH before database credentials
- **ui**: Restore page now shows skeleton loading while target databases are fetched via SSH - version compatibility, database mapping, and action buttons are blocked until loading completes
- **ui**: Sources and Destinations pages now auto-refresh every 10 seconds to keep health status up to date
- **sqlite**: Refactored SQLite SSH client into shared SSH module for code reuse across all database adapters
- **sqlite**: SQLite SSH connection test now uses `remoteBinaryCheck()` from the shared SSH library instead of manual binary checks, `try/finally` pattern ensures SSH connections are always closed, exit code null handling fixed in dump

### 📝 Documentation

- **wiki**: Updated all database source guides (MySQL, MariaDB, PostgreSQL, MongoDB, Redis) with SSH mode configuration, prerequisites, setup guides, and troubleshooting
- **wiki**: New "Connection Modes" overview section on the Sources index page explaining Direct vs SSH mode and shared SSH config fields
- **wiki**: Added SSH remote execution architecture section to the Developer Guide (database adapters, adapter system, architecture)
- **wiki**: Each adapter guide now lists required CLI tools for the remote host with installation commands per OS

### 🧪 Tests

- **ssh**: Added 60 unit tests for shared SSH utilities covering shell escaping, environment variable export, SSH mode detection, config extraction, and argument builders for MySQL, PostgreSQL, MongoDB, and Redis

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.3.0`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v1.2.1 - Execution Cancellation, MSSQL Progress & Dashboard Polish
*Released: March 26, 2026*

### ✨ Features

- **execution**: Cancel running or pending executions from the live log dialog - a "Cancel" button now appears in the execution header when a backup or restore is in progress
- **execution**: New `Cancelled` status for executions - cancelled jobs are cleanly marked with proper log entries instead of showing as failed

### 🐛 Bug Fixes

- **mssql**: Fixed Database Explorer and Restore page showing 0 databases for MSSQL sources - replaced global singleton connection pool (`sql.connect()`) with independent per-operation pools (`new ConnectionPool()`) to prevent concurrent requests from closing each other's connections
- **mssql**: Fixed large database backups/restores hanging and timing out - `BACKUP DATABASE` and `RESTORE DATABASE` queries now run without request timeout (previously limited to 5 minutes, causing failures on databases >5 GB)
- **explorer**: Fixed Database Explorer not displaying server version - removed broken parallel `test-connection` call and now uses version info returned by `database-stats` endpoint

### 🎨 Improvements

- **mssql**: SQL Server progress messages (e.g. "10 percent processed") are now streamed to the execution log in real-time instead of only appearing after the backup/restore completes
- **dashboard**: All dashboard widgets (activity chart, job status donut, latest jobs list) now display the `Cancelled` status with a neutral gray color

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.2.1`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v1.2.0 - HTTPS by Default, Certificate Management & Per-Adapter Health Notifications
*Released: March 25, 2026*

> ⚠️ **Breaking:** Volume mounts have changed. Replace `./db:/app/db` and `./storage:/app/storage` with a single `./data:/data` mount. Then move the current data to the new structure after first startup. Update `BETTER_AUTH_URL` to `https://` - HTTPS is now the default protocol. Set `DISABLE_HTTPS=true` if you use a TLS-terminating reverse proxy but its not recommended in terms of security.

### ✨ Features

- **notifications**: Per-adapter health check notification opt-out - sources and destinations can individually disable offline/recovery alerts via a toggle in the Configuration tab while health checks continue running
- **security**: Built-in HTTPS support - DBackup now defaults to HTTPS with an auto-generated self-signed certificate on first start, protecting all traffic including database passwords, encryption keys, and session cookies
- **security**: Certificate management UI - new "Certificate" tab in System Settings to view certificate details (issuer, expiry, fingerprint), upload custom PEM certificates, or regenerate self-signed certs
- **security**: HSTS header - when accessed via HTTPS, DBackup now sends `Strict-Transport-Security` to enforce future HTTPS connections in the browser
- **security**: Auto-renewal for self-signed certificates - expired self-signed certs are automatically regenerated on container start, custom certificates are never replaced, only a warning is logged

### 🔄 Changed

- **server**: Default protocol changed from HTTP to HTTPS - set `DISABLE_HTTPS=true` to use plain HTTP (e.g. behind a TLS-terminating reverse proxy)
- **docker**: Consolidated volume mounts into single `/data` directory - replaces separate `/app/db`, `/app/storage` mounts with one `./data:/data` mount containing `db/`, `storage/`, and `certs/` subdirectories. `/backups` remains a separate optional mount for local backups

### 🎨 Improvements

- **ui**: Edit Configuration dialog now uses Shadcn ScrollArea instead of native browser overflow for consistent scrollbar styling

### 🧪 Tests

- **security**: Added 21 unit tests for `certificate-service` covering certificate info parsing, upload validation (PEM format, cert-key matching, temp file cleanup), self-signed regeneration, and HTTPS toggle

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.2.0`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v1.1.0 - Notification System Expansion & UI Improvements
*Released: March 24, 2026*

### ✨ Features

- **notifications**: New "Connection Offline" system notification event - sends an alert when a source or destination becomes unreachable after repeated health check failures, with configurable repeat reminder (default 24h)
- **notifications**: New "Connection Recovered" system notification event - sends an alert when a previously offline source or destination becomes reachable again, including downtime duration

### 🎨 Improvements

- **ui**: Empty state on Settings → Notifications now links directly to the Notifications page to create an adapter
- **ui**: Redesigned permission picker for API Key and Group dialogs - replaced cramped scroll area with a spacious 3-column category card grid, global select/deselect all, and per-category count badges for much better overview

### 📝 Documentation

- **docs**: Added "No Vendor Lock-In" messaging to README and Wiki - highlights that backups are standard dumps, decryptable offline with the Recovery Kit and a standalone script

### 🧪 Tests

- **notifications**: Updated event count assertions to match new health check events (14 event types, 12 system event definitions, added `health` category)
- **runner**: Fixed "Closing rpc while fetch was pending" CI failure in notification-logic tests - added missing mocks for `dashboard-service` and `notification-log-service` to prevent unresolved dynamic imports during test teardown

### 🔧 CI/CD

- **pipeline**: Added Wiki Build stage to validate workflow - ensures the VitePress documentation builds without errors on every PR

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.1.0`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v1.0.7 - PostgreSQL Version Mismatch Fix & Docker Build Validation
*Released: March 22, 2026*

### 🐛 Bug Fixes

- **PostgreSQL**: Fixed pg_dump version mismatch in Docker container - PostgreSQL 17 backups failed because `postgresql17-client` and `postgresql18-client` were not installed, causing fallback to pg_dump 16

### 🔧 CI/CD

- **Docker**: Added build-time validation for all pg_dump versions - Docker build now fails immediately if any PostgreSQL client binary is missing or has the wrong version

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.0.7`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v1.0.6 - Quick Setup fix & Developer Tooling
*Released: March 22, 2026*

### ✨ Features

- **UI**: Documentation menu in the profile dropdown now expands into a submenu with three options: Dokumentation (external docs), API Docs Local (`/docs/api`), and API Docs Remote (`api.dbackup.app`)
  > **Note**: Dokumentation link updated to `docs.dbackup.app` in this release

### 🐛 Bug Fixes

- **quick-setup**: Added missing database selection picker to the job step for adapters that support it (MySQL, MariaDB, PostgreSQL, MongoDB, MSSQL)

### 📝 Documentation

- **README**: Replaced static dashboard screenshot with demo video showcasing backup and restore workflow
- **README**: Redesigned Features section with categorized subsections, icons, and unique selling points (selective DB backup, live progress, system notifications, UI simplicity)
- **wiki**: Added demo video to the documentation homepage
- **API Docs**: Fixed DBackup Support link - now points to community support page instead of non-functional email

### 🔧 CI/CD

- **scripts**: Added `sync-version.sh` script and `pnpm version:sync` / `pnpm version:bump <patch|minor|major>` commands to sync version across all files automatically

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.0.6`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64

## v1.0.5 - Docker Permissions & Environment Variables
*Released: March 20, 2026*

### ✨ Features

- **Docker**: Configurable `PUID`/`PGID` environment variables (default: `1001`) - the entrypoint adjusts the runtime user at startup to match host volume permissions

### 🎨 Improvements

- **Dockerfile**: Dedicated `docker-entrypoint.sh` replaces inline CMD - validates `PUID`/`PGID`, conditionally chowns `/pnpm` only when ownership differs, and runs `node` as PID 1 for proper signal handling
- **Dockerfile**: Global Prisma CLI pinned to exact version (`5.22.0`) matching `package.json` to prevent version drift
- **Dockerfile**: Merged Prisma generate and Next.js build into a single layer, consistent `--chown=1001:1001` on all COPY directives

### 📝 Documentation

- **wiki**: Documented `PUID`/`PGID` environment variables in the environment reference

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.0.5`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64

## v1.0.4 - Hotfix Release
*Released: March 20, 2026*

### 🐛 Bug Fixes

- **Dockerfile**: Fixed container crash on startup (`Can't write to @prisma/engines`) caused by globally installed Prisma being owned by root instead of the runtime user

### 🔧 CI/CD

- **pipeline**: Added build verification job to release workflow - starts the built image and polls `/api/health` before publishing, catching runtime permission and startup failures

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.0.4`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64

## v1.0.3 - Docker Optimization & MSSQL Improvements
*Released: March 19, 2026*

### 🐛 Bug Fixes

- **MSSQL**: Backup and restore errors now show the actual SQL Server cause instead of only "terminating abnormally" by extracting preceding error messages
- **MSSQL**: Database Explorer now correctly shows table counts by querying each database individually instead of using a broken cross-database `INFORMATION_SCHEMA` subquery

### 🎨 Improvements

- **Dockerfile**: Global Prisma install switched from `npm` to `pnpm` for consistency and smaller image size
- **Dockerfile**: corepack activated in the base stage so all build stages inherit pnpm without reinstalling
- **Dockerfile**: Build now uses `pnpm run build` and `pnpm prisma generate` consistently instead of `npm`/`npx`
- **Dockerfile**: Combined base-stage RUN layers (corepack + PG symlinks), added `COPY --link` for layer-independent caching, merged runner RUN layers, and added pnpm store mount-cache for faster dependency installs
- **Dockerfile**: `.dockerignore` extended to exclude `wiki/`, `api-docs/`, `README.md`, and `LICENSE` to reduce build context size

### 🛠 CI/CD

- **pipeline**: GitHub Releases are now auto-generated from `wiki/changelog.md` on every version tag push - no manual copy-paste required
- **pipeline**: Removed QEMU from Docker builds - amd64 and arm64 now build natively on their respective GitHub runners
- **pipeline**: Switched Docker layer cache from GHCR registry to GitHub Actions cache for faster cache hits
- **Dockerfile**: Fixed ARM64 build failure (`invalid user index: -1`) by using numeric UID/GID (`1001:1001`) instead of user/group names in `COPY --link --chown` directives

### 📝 Documentation

- **wiki**: New user guide article - [Encryption Key](https://docs.dbackup.app/user-guide/security/encryption-key): explains what `ENCRYPTION_KEY` protects, what happens when the key is lost or mismatched, and recovery options

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.0.3`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64

## v1.0.2 - Cleanup & File Extension Fix
*Released: March 17, 2026*

### 🐛 Bug Fixes

- **backup**: Backup files now use adapter-specific extensions (`.bak`, `.archive`, `.rdb`, `.db`) instead of always `.sql`
- **restore**: "Existing Databases" panel now scrolls correctly when the target server has many databases

### 🎨 Improvements

- **codebase**: Removed unused components, dead exports, stale commented-out code, and empty directories
- **codebase**: Removed unused `ServiceResult` pattern file and its advisory lint test
- **ui**: API Trigger dialog "Overview" tab now shows the correct `success` field in the trigger and poll JSON examples

### 🛠 CI/CD

- **pipeline**: Migrated CI/CD from GitLab CI to GitHub Actions with parallel lint, type-check, and unit test jobs
- **pipeline**: Multi-arch Docker builds (amd64/arm64) now push to GHCR and Docker Hub with identical tag strategy
- **GitLab**: Added GitHub Action to mirror all branches and tags to GitLab for commit activity sync

### 📝 Documentation

- **wiki**: Complete overhaul of all adapter guides - unified structure, 4-column config tables verified against code, and collapsible provider examples
- **wiki**: Rewrote all 13 destination guides, 6 source guides, and 9 notification guides with accurate default values and required fields

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.0.2`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v1.0.1 - Hotfix Release & API Documentation
*Released: March 14, 2026*

### 🐛 Bug Fixes

- **ui**: Mouse wheel now works in all `CommandList`-based dropdowns (Radix ScrollArea bypass)
- **MSSQL**: Backup failures now include actual SQL Server error messages instead of only "terminating abnormally"
- **performance**: Resolved multiple patterns causing app hangs - parallel health checks with 15s timeout, async MySQL CLI detection, async file I/O, adaptive history polling

### 🔧 CI/CD

- **pipeline**: Added `validate` stage running lint, type-check, and tests in parallel before Docker builds
- **pipeline**: Split single `docker buildx` into parallel amd64/arm64 jobs, combined via `imagetools create`
- **Docker Hub**: Automatically pushes README to Docker Hub on release with absolute image URLs

### 📝 Documentation

- **API**: Full OpenAPI 3.1 spec with interactive Scalar reference at `/docs/api` and [api.dbackup.app](https://api.dbackup.app)
- **user guide**: Getting Started rewritten and expanded into multi-page User Guide (Getting Started, First Steps, First Backup)
- **README**: Revised feature list, added Community & Support section with Discord, GitLab Issues, and contact emails

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.0.1`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v1.0.0 - First Stable Release
*Released: March 10, 2026*

🎉 **DBackup 1.0.0 - the first stable release.** Stabilizes the platform after the beta phase with quality-of-life fixes, stale execution recovery, update notifications, and dashboard polish.

> ⚠️ **Breaking:** All Prisma migrations squashed into a single `0_init` migration. Existing beta databases are **not compatible**. Export your config via Settings → Config Backup before upgrading, then re-import after `npx prisma migrate deploy`.

### ✨ Features

- **sessions**: Configurable session lifetime (1h–90d), sessions tab in profile with browser/OS icons, revoke individual or all other sessions
- **backup**: Stale execution recovery - on startup, detects executions stuck in `Running`/`Pending` and marks them as `Failed`
- **notifications**: Update notifications when a new version is detected, with deduplication and configurable reminder intervals (default: 7 days)
- **notifications**: Storage alerts and update notifications support repeat intervals (Disabled / 6h / 12h / 24h / 2d / 7d / 14d)
- **jobs**: Multi-destination fan-out - upload to unlimited storage destinations per job with per-destination retention policies and `Partial` status
- **jobs**: Database selection moved from Source config to Job form with multi-select `DatabasePicker`
- **config backup**: Enhanced import with statistics toggle, smart encryption recovery, name-based deduplication, and FK remapping
- **validation**: Sources, Jobs, Encryption Profiles, and Groups enforce unique names with HTTP 409 and descriptive toasts

### 🔒 Security

- **auth**: Fixed middleware matcher to correctly apply rate limiting to authentication endpoints
- **adapters**: Strict Zod schemas reject shell metacharacters in adapter config fields (command injection prevention)
- **MSSQL**: Database name identifiers now properly escaped with bracket notation (SQL injection prevention)
- **SSO**: `clientId` and `clientSecret` encrypted at rest with AES-256-GCM

### 🎨 Improvements

- **scheduler**: New dual-mode schedule picker with Simple Mode (frequency pills + dropdowns) and Cron Mode with human-readable descriptions
- **jobs**: Form restructured into 4 tabs (General, Destinations, Security, Notify) with database picker and inline retention
- **ui**: Replaced orange pulsing update indicator with muted blue styling

### 🐛 Bug Fixes

- **Redis**: Replaced incorrect multi-select database picker with 0–15 dropdown
- **ui**: Fixed database icon showing red instead of yellow for `Pending` executions
- **API**: Bash trigger script checks `success: true` before parsing, documented `history:read` requirement
- **auth**: Split rate limit module into Edge-safe and server-only to avoid `node:crypto` import in Edge Runtime
- **config backup**: Fixed 7 issues including missing Zod field, download crash, meta format detection, and FK violations

### 🐳 Docker

- **Image**: `skyfay/dbackup:v1.0.0`
- **Also tagged as**: `latest`, `v1`
- **Platforms**: linux/amd64, linux/arm64


## v0.9.9-beta - Storage Alerts, Notification Logs & Restore Improvements
*Released: February 22, 2026*

### ✨ Features

- **restore**: Backup compatibility matrix - pre-restore version check with green/orange/red banners and MSSQL edition guard
- **MSSQL**: SSH test button - tests SSH connectivity, backup path access, and write permissions
- **restore**: Dedicated restore page with 2-column layout, file details, database mapping, privileged auth, and version checks
- **storage**: Explorer with tabs (Explorer, History, Settings), side-by-side charts, and trend indicators
- **storage**: Three alert types (Usage Spike, Storage Limit, Missing Backup) with per-destination config and notification integration
- **settings**: Data retention settings - separate retention periods for Audit Logs and Storage Snapshots (7d–5y)
- **notifications**: Notification log history with adapter-specific previews (Discord, Email, Slack, Telegram, Teams) and filterable table

### 🎨 Improvements

- **email**: Template redesign - Shadcn/UI style card layout with zinc palette, color-coded status badges, and dark mode support
- **restore**: Rich notification context with database type, storage name, backup filename, duration, and failure details
- **backup**: Selective TAR extraction - multi-database restores extract only selected databases, reducing I/O
- **ui**: Skeleton loading placeholders across Storage Explorer, History, and Database Explorer
- **storage**: Tab-aware refresh - refresh button reloads the active tab instead of always refreshing the file list
- **ui**: Database Explorer matches Storage Explorer's visual style with empty state cards

### 🔄 Changed

- **ui**: Replaced Radix ScrollArea with native browser scrollbars across all components

### 🐛 Bug Fixes

- **setup**: Fixed "Please select an adapter type first" error in Quick Setup adapter selection
- **setup**: Test Connection button now works in all Quick Setup steps

### 🐳 Docker

- **Image**: `skyfay/dbackup:v0.9.9-beta`
- **Also tagged as**: `beta`
- **Platforms**: linux/amd64, linux/arm64


## v0.9.8-beta - Notification Adapters Expansion & Quick Setup Wizard
*Released: February 20, 2026*

### ✨ Features

- **Slack**: Incoming Webhooks with Block Kit formatting, color-coded attachments, channel override, and custom bot identity
- **Teams**: Power Automate Workflows with Adaptive Cards v1.4 and color mapping
- **webhook**: Generic webhook adapter - universal HTTP POST/PUT/PATCH with custom JSON templates, auth headers, and custom headers
- **Gotify**: Self-hosted push notifications with configurable priority levels and Markdown formatting
- **ntfy**: Topic-based push notifications (public or self-hosted) with priority escalation and emoji tags
- **Telegram**: Bot API with HTML formatting, flexible targets (chats, groups, channels), and silent mode
- **Twilio**: SMS alerts with concise formatting optimized for message length and E.164 phone numbers
- **setup**: Quick Setup Wizard - 7-step guided first-run (Source → Destination → Vault → Notification → Job → Run)
- **navigation**: Grouped sidebar organized into General, Backup, Explorer, and Administration groups

### 📝 Documentation

- **notifications**: Per-channel setup guides for all 9 notification channels

### 🐛 Bug Fixes

- **scheduler**: Enabling/disabling automated config backup now takes effect immediately without restart
- **ui**: Storage History button and Health History popover now respect user permissions
- **API**: Health History endpoint accepts either `sources:read` or `destinations:read`

### 🐳 Docker

- **Image**: `skyfay/dbackup:v0.9.8-beta`
- **Also tagged as**: `beta`
- **Platforms**: linux/amd64, linux/arm64


## v0.9.7-beta - API Keys, Webhook Triggers, Adapter Picker & Brand Icons
*Released: February 20, 2026*

### ✨ Features

- **ui**: Visual adapter picker - two-step create flow with card grid, search bar, and category tabs
- **ui**: Brand icons - multi-colored SVG logos via Iconify for all adapters, bundled offline for self-hosted deployments
- **MSSQL**: SSH/SFTP file transfer for accessing `.bak` files on remote SQL Server hosts with automatic cleanup
- **MSSQL**: Encryption and self-signed certificate toggles exposed in the UI
- **restore**: Database stats section showing target server databases with sizes, table counts, and conflict detection
- **explorer**: Database Explorer - standalone page to browse databases on any source with server overview and sortable stats
- **auth**: API key management - fine-grained permissions, expiration dates, secure storage, full lifecycle
- **API**: Webhook triggers - trigger backups via `POST /api/jobs/:id/run` with cURL, Bash, and Ansible examples
- **auth**: Unified auth system - all API routes support both session cookies and API key Bearer tokens
- **Docker**: Health check - polls `/api/health` every 30s returning app status, DB connectivity, and memory usage
- **auth**: Configurable rate limits - per-category limits (Auth, API Read, API Write) with auto-save UI
- **backup**: Graceful shutdown - waits for running backups, freezes queue, stops scheduler, cleans up pending jobs
- **storage**: Grouped destination selector - adapters grouped into Local, Cloud Storage, Cloud Drives, and Network categories
- **adapters**: `getDatabasesWithStats()` - all adapters expose database size and table/collection count
- **ui**: Default port placeholders for MSSQL (1433), Redis (6379), and MariaDB (3306)
- **config**: Zod-based startup validation for environment variables with clear error messages

### 🐛 Bug Fixes

- **ui**: Fixed `cmdk` intercepting mouse wheel scroll events in dropdowns
- **ui**: Fixed conditional form fields appearing before their controlling dropdown is selected

### 📝 Documentation

- **wiki**: API Reference, API Keys, Webhook Triggers, and Rate Limits guides

### 🐳 Docker

- **Image**: `skyfay/dbackup:v0.9.7-beta`
- **Also tagged as**: `beta`
- **Platforms**: linux/amd64, linux/arm64


## v0.9.6-beta - Cloud Storage, Rsync & Notification System
*Released: February 15, 2026*

### ✨ Features

- **notifications**: System notification framework for user logins, account creation, restore results, and system errors with per-event toggles
- **email**: Multi-recipient tag/chip input with paste support for comma/semicolon-separated lists
- **Google Drive**: OAuth 2.0 with encrypted refresh tokens, visual folder browser, and resumable uploads
- **Dropbox**: OAuth 2.0 with visual folder browser and chunked uploads for files > 150 MB
- **OneDrive**: OAuth 2.0 for personal and organizational accounts with smart upload strategy
- **rsync**: Delta transfer via rsync over SSH with Password, Private Key, or SSH Agent auth
- **storage**: Usage history - area charts showing storage size over time (7d–1y) with automatic hourly snapshots

### 🔒 Security

- **OAuth**: Refresh tokens and client secrets encrypted at rest with AES-256-GCM
- **rsync**: Passwords passed via `SSHPASS` env var, never as CLI arguments

### 🎨 Improvements

- **dashboard**: Cached storage statistics served from DB cache instead of live API calls, auto-refreshed hourly
- **storage**: All storage adapters queried in parallel instead of sequentially

### 🐛 Bug Fixes

- **dashboard**: Fixed Job Status chart stretching when many destinations are configured
- **ui**: Fixed missing adapter details for OneDrive, MariaDB, and MSSQL in tables

### 🐳 Docker

- **Image**: `skyfay/dbackup:v0.9.6-beta`
- **Also tagged as**: `beta`
- **Platforms**: linux/amd64, linux/arm64


## v0.9.5-beta - Dashboard Overhaul, Checksums & Visual Analytics
*Released: February 13, 2026*

### ✨ Features

- **backup**: SHA-256 checksum verification - end-to-end integrity with checksums on backup, verification on restore, and optional weekly integrity check
- **dashboard**: Interactive dashboard with activity chart, job status donut, 7 KPI cards, latest jobs widget, and smart auto-refresh
- **ui**: Smart type filters - faceted filters on Sources, Destinations, and Notifications pages
- **WebDAV**: Nextcloud, ownCloud, Synology, and any WebDAV server support
- **SMB**: Windows servers and NAS devices with configurable protocol version and domain auth
- **FTP**: FTP/FTPS servers with optional TLS encryption
- **storage**: Per-destination overview widget with backup count and total size from live file scanning

### 🐛 Bug Fixes

- **backup**: File size now reflects actual compressed/encrypted size instead of raw dump size
- **ui**: Fixed crash with relative date formatting in DateDisplay component

### 🐳 Docker

- **Image**: `skyfay/dbackup:v0.9.5-beta`
- **Also tagged as**: `beta`
- **Platforms**: linux/amd64, linux/arm64


## v0.9.4-beta - Universal Download Links & Logging System
*Released: February 6, 2026*

### ✨ Features

- **backup**: wget/curl download links - temporary links with countdown timer, encrypted/decrypted format selection
- **logging**: Centralized logger with child loggers, `LOG_LEVEL` env control, colored dev output (JSON in production)
- **errors**: Custom error class hierarchy (`DBackupError`, `AdapterError`, `ServiceError`, etc.) with `wrapError()` utilities
- **logging**: API request middleware logging with method, path, duration, and anonymized IP

### 🎨 Improvements

- **adapters**: Type-safe adapter configs - all adapters use exported TypeScript types instead of `config: any`
- **MongoDB**: Connection test uses native `mongodb` npm package instead of `mongosh` (Docker compatibility)

### 🗑️ Removed

- **backup**: Legacy multi-DB code - removed `pg_dumpall`, MySQL `--all-databases`, and MongoDB multi-DB parsing (replaced by TAR in v0.9.1)

### 📝 Documentation

- **wiki**: Download tokens, Storage Explorer, and Logging System developer documentation

### 🐳 Docker

- **Image**: `skyfay/dbackup:v0.9.4-beta`
- **Also tagged as**: `beta`
- **Platforms**: linux/amd64, linux/arm64


## v0.9.3-beta - Redis Support, Restore UX & Smart File Extensions
*Released: February 2, 2026*

### ✨ Features

- **Redis**: RDB snapshot backups for Redis 6/7/8 with Standalone & Sentinel mode, ACL auth, TLS, and database index selection
- **Redis**: 6-step restore wizard with secure download links (5-min expiry) and platform-specific instructions
- **backup**: Smart file extensions - adapter-specific extensions: `.sql`, `.bak`, `.archive`, `.rdb`, `.db`
- **backup**: Token-based downloads - secure, single-use download links (5-min expiry) for wget/curl without session cookies
- **settings**: User preferences - auto-redirect toggle for disabling automatic History page redirection on job start
- **Docker Hub**: Published at `skyfay/dbackup` with sensible `DATABASE_URL` default, `TZ` and `TMPDIR` support
- **config**: `TRUSTED_ORIGINS` env var for multiple access URLs (comma-separated)

### 🐛 Bug Fixes

- **auth**: Auth client correctly uses browser origin instead of hardcoded URL

### 📝 Documentation

- **wiki**: Consolidated installation guide with Docker Compose/Run tab switcher and environment variables audit

### 🐳 Docker

- **Image**: `skyfay/dbackup:v0.9.3-beta`
- **Also tagged as**: `beta`
- **Platforms**: linux/amd64, linux/arm64


## v0.9.2-beta - Branding & Documentation
*Released: February 1, 2026*

### ✨ Features

- **branding**: Official DBackup logo with multi-resolution favicon support and brand integration (login, sidebar, browser tab)
- **docs**: Documentation portal launched at [docs.dbackup.app](https://docs.dbackup.app) with in-app link and Discord community
- **SEO**: Meta tags, Open Graph, Twitter Cards, and structured data

### 🐳 Docker

- **Image**: `skyfay/dbackup:v0.9.2-beta`
- **Also tagged as**: `beta`
- **Platforms**: linux/amd64, linux/arm64


## v0.9.1-beta - Unified Multi-DB TAR Architecture
*Released: February 1, 2026*

> ⚠️ **Breaking:** Multi-database backups now use TAR archives instead of inline SQL/dump streams. **Old multi-DB backups cannot be restored with v0.9.1+.** Single-database backups are not affected.

### ✨ Features

- **backup**: Unified TAR multi-DB format - all adapters use the same TAR format with `manifest.json`, enabling selective restore and database renaming

### 🎨 Improvements

- **PostgreSQL**: Uses `pg_dump -Fc` per database instead of `pg_dumpall` for smaller, parallel-ready backups
- **MongoDB**: True multi-DB support with `--nsFrom/--nsTo` renaming on restore

### 🧪 Tests

- **integration**: 84 integration tests - multi-DB tests, MSSQL test setup, Azure SQL Edge ARM64 skip

### 🐳 Docker

- **Image**: `skyfay/dbackup:v0.9.1-beta`
- **Also tagged as**: `beta`
- **Platforms**: linux/amd64, linux/arm64


## v0.9.0-beta - Microsoft SQL Server & Self-Service Security
*Released: January 31, 2026*

### ✨ Features

- **MSSQL**: Full adapter with auto-detection of edition/version, multi-DB TAR backups, server-side compression, and parameterized queries
- **auth**: Password change from profile settings with audit logging

### 🧪 Tests

- **testing**: Stress test data generator, dedicated `testdb` container, and MSSQL `/tmp` cleanup

### 🐳 Docker

- **Image**: `skyfay/dbackup:v0.9.0-beta`
- **Also tagged as**: `beta`
- **Platforms**: linux/amd64, linux/arm64


## v0.8.3-beta - Meta-Backups & System Task Control
*Released: January 30, 2026*

### ✨ Features

- **config backup**: Self-backup of app configuration (Users, Jobs, Settings) to storage adapters with full restore flow
- **encryption**: Profile portability - export/import secret keys for server migration with Smart Recovery
- **settings**: System task management - admins can enable/disable background tasks, config backup moved into standard scheduler

### 🐳 Docker

- **Image**: `skyfay/dbackup:v0.8.3-beta`
- **Also tagged as**: `beta`
- **Platforms**: linux/amd64, linux/arm64


## v0.8.2-beta - Keycloak, Encryption Imports & Database Reset
*Released: January 29, 2026*

> ⚠️ **Breaking:** Database schema consolidated into a single init migration. **Delete existing `dev.db` and let the app re-initialize.** Data cannot be migrated automatically.

### ✨ Features

- **SSO**: Keycloak adapter - dedicated OIDC adapter with HTTPS enforcement
- **encryption**: Profile import for disaster recovery on fresh instances

### 🎨 Improvements

- **auth**: 2-step email-first login flow with tabbed SSO configuration UI

### 🐳 Docker

- **Image**: `skyfay/dbackup:v0.8.2-beta`
- **Also tagged as**: `beta`
- **Platforms**: linux/amd64, linux/arm64


## v0.8.1-beta - SQLite Support & Remote File Browsing
*Released: January 26, 2026*

### ✨ Features

- **SQLite**: Backup local and remote (via SSH tunnel) SQLite databases with safe restore cleanup
- **ui**: Remote file browser for browsing local and SSH filesystems, integrated into adapter forms
- **SFTP**: Distinct Password and Private Key authentication options

### 🐳 Docker

- **Image**: `skyfay/dbackup:v0.8.1-beta`
- **Also tagged as**: `beta`
- **Platforms**: linux/amd64, linux/arm64


## v0.8.0-beta - The First Beta
*Released: January 25, 2026*

🚀 First official Beta with enterprise-ready features.

### ✨ Features

- **SSO**: Full OpenID Connect with Authentik, PocketID, and Generic providers including account linking and auto-provisioning
- **S3**: AWS S3 and compatible providers (MinIO, R2, etc.) via AWS SDK
- **SFTP**: Secure backup offloading to remote servers with connection testing
- **audit**: Comprehensive action tracking with IP, User Agent, change diffs, configurable retention, and faceted filtering
- **MariaDB**: Dedicated adapter with dialect handling
- **adapters**: Auto-detection of database version and dialect (MySQL 5.7 vs 8.0, etc.)
- **system**: Update checker - notifies admins when new versions are available
- **adapters**: Visual health history grid and badges for all adapters

### 🔒 Security

- **MySQL**: Password handling switched to `MYSQL_PWD` environment variable

### 🧪 Tests

- **testing**: Unit and integration tests for backup/restore pipelines, storage, notifications, and scheduler

### 🐳 Docker

- **Image**: `skyfay/dbackup:v0.8.0-beta`
- **Also tagged as**: `beta`
- **Platforms**: linux/amd64, linux/arm64


## v0.5.0-dev - RBAC System, Encryption Vault & Core Overhaul
*Released: January 24, 2026*

### ✨ Features

- **auth**: RBAC system - user groups with granular permissions, management UI, and protected SuperAdmin group
- **encryption**: Recovery kits - offline recovery kits for emergency decryption with master key reveal dialog
- **backup**: Native compression support integrated into UI and pipeline
- **backup**: Live progress tracking with indeterminate progress bars for streaming
- **auth**: API and authentication endpoint rate limiting
- **auth**: 2FA administration - admins can reset 2FA for locked-out users

### 🎨 Improvements

- **backup**: Pipeline architecture - job runner refactored into modular steps with dedicated service layer
- **queue**: Max 10 concurrent jobs with optimized MySQL/PostgreSQL streaming
- **ui**: DataTables with faceted filtering, Command-based Popovers, and Recovery Kit card UI
