# Changelog

All notable changes to DBackup are documented here.

## v0.9.5-beta - Dashboard Overhaul, Checksums & Visual Analytics
*Release: In progress*

This release introduces a completely redesigned dashboard with interactive charts, real-time statistics, and auto-refresh capabilities. It also adds SHA-256 checksum verification throughout the backup lifecycle for end-to-end data integrity. The dashboard now provides a comprehensive at-a-glance overview of backup health, job activity, and storage usage. Sources, Destinations, and Notifications pages now feature smart type filters for quick navigation.

### ✨ New Features

#### 🔒 SHA-256 Checksum Verification
- **Backup Pipeline Integration**: Every backup now calculates a SHA-256 checksum of the final file (after compression/encryption) and stores it in the `.meta.json` sidecar file
- **Post-Upload Verification (Local Storage)**: For local filesystem storage, the backup is re-downloaded and its checksum verified after upload. Remote storage (S3, SFTP, etc.) relies on transport-level integrity checks to avoid costly re-downloads of large files
- **Restore Verification**: Before decryption/decompression, the downloaded backup file's checksum is verified against the stored value — aborts restore if mismatch detected
- **Integrity Check System Task**: New periodic system task (`system.integrity_check`) that verifies all backups across all storage destinations. Runs weekly (Sunday 4 AM), disabled by default
- **IntegrityService**: New service that iterates all storage configs, downloads each backup, and verifies checksums — reports total files, verified, passed, failed, and skipped counts

#### 🔍 Smart Type Filters
- **Sources Page**: Faceted filter to narrow sources by database type (MySQL, PostgreSQL, MongoDB, Redis, etc.)
- **Destinations Page**: Faceted filter to narrow destinations by storage type (Local, S3, SFTP, etc.)
- **Notifications Page**: Faceted filter to narrow notifications by adapter type
- **Dynamic Options**: Filter only shows types that have at least one entry — no empty options cluttering the UI
- **Auto-Hide**: Filter button is hidden entirely when all entries are the same type or only one entry exists

#### 📊 Interactive Dashboard Charts
- **Activity Chart**: New stacked bar chart showing backup and restore executions over the last 14 days, grouped by status (Completed, Failed, Running, Pending)
- **Job Status Distribution**: Donut chart visualizing the status distribution of all executions in the last 30 days, with success rate percentage displayed in the center
- **Recharts Integration**: Added Recharts via the official shadcn/ui Chart component for consistent, accessible chart rendering

#### 📈 Expanded Stats Cards
- **7 KPI Cards**: Dashboard now shows Total Jobs, Active Schedules, Backups, Total Storage, Success Rate, 24h Successful, and 24h Failed at a glance
- **Visual Indicators**: Each card includes an icon and descriptive subtitle for quick orientation

#### 🗂️ Latest Jobs Widget
- **Live Activity Feed**: New widget showing recent backup and restore executions with status badges and relative timestamps
- **Type Filter**: Dropdown filter to show All, Backup-only, or Restore-only executions
- **Source Icons**: Database type icons (MySQL, PostgreSQL, MongoDB, etc.) displayed alongside job names

#### 🔄 Auto-Refresh
- **Smart Polling**: Dashboard automatically refreshes every 3 seconds while backup or restore jobs are running
- **Auto-Stop**: Polling stops automatically when all jobs complete, with one final refresh to update the view
- **Zero Config**: No user interaction needed — refresh activates and deactivates based on job state

#### 💾 Storage Overview
- **Per-Destination Breakdown**: Storage widget lists each configured storage destination with backup count and total size
- **Live File Scanning**: Storage sizes are calculated from actual files via storage adapters (not just database records)
- **Total Summary**: Aggregated total row shown when multiple storage destinations are configured

#### 🌐 WebDAV Storage Destination
- **New Storage Adapter**: Store backups on any WebDAV-compatible server — Nextcloud, ownCloud, Synology WebDAV, Apache (mod_dav), Nginx, or any other WebDAV endpoint
- **HTTPS Support**: Encrypted file transfers over standard HTTP/HTTPS — no special ports or protocols needed
- **No CLI Dependency**: Uses the `webdav` npm package directly — no system-level tools required (unlike SMB)
- **Path Prefix**: Optional subdirectory for organized backup storage
- **Full Lifecycle**: Upload, download, list, delete, and read operations for complete backup management including retention policies
- **Connection Testing**: Write/delete verification test ensures proper permissions before creating jobs

#### 📂 SMB / Samba Storage Destination
- **New Storage Adapter**: Store backups on SMB/CIFS network shares — Windows file servers, NAS devices (Synology, QNAP, TrueNAS), and Linux Samba servers
- **Protocol Support**: Configurable SMB protocol version (SMB3, SMB2, NT1) with SMB3 as default for encryption support
- **Domain Authentication**: Supports workgroup and Active Directory domain authentication
- **Path Prefix**: Optional subdirectory on the share for organized backup storage
- **Full Lifecycle**: Upload, download, list, delete, and read operations for complete backup management including retention policies
- **Connection Testing**: Write/delete verification test ensures proper permissions before creating jobs

#### 📡 FTP / FTPS Storage Destination
- **New Storage Adapter**: Store backups on any FTP server with optional TLS encryption — shared hosting, legacy infrastructure, and classic file servers
- **Explicit FTPS Support**: Optional TLS encryption (AUTH TLS on port 21) for secure file transfers — plain FTP available but not recommended for production
- **Universal Compatibility**: Works with virtually any hosting provider without CLI dependencies — uses the `basic-ftp` npm package directly
- **Anonymous & Authenticated Access**: Supports both anonymous FTP and username/password authentication
- **Path Prefix**: Optional remote directory for organized backup storage
- **Full Lifecycle**: Upload, download, list, delete, and read operations for complete backup management including retention policies
- **Connection Testing**: Write/delete verification test ensures proper permissions before creating jobs

### 🐛 Bug Fixes
- **Accurate Backup Sizes**: Fixed backup file size tracking to reflect the actual compressed and encrypted file size instead of the raw database dump size
- **DateDisplay Crash**: Fixed a crash when using relative date formatting by switching to `formatDistanceToNow` from date-fns

### 🧹 Code Cleanup
- Removed unused `getDialect` import from MongoDB restore adapter
- Removed outdated ESLint disable directive from core interfaces

### 🔧 Technical Changes
- New `src/lib/adapters/storage/webdav.ts` — WebDAV storage adapter using `webdav` npm package
- New `src/lib/adapters/storage/smb.ts` — SMB/CIFS storage adapter using `samba-client` npm package (wraps `smbclient` CLI)
- New `src/lib/adapters/storage/ftp.ts` — FTP/FTPS storage adapter using `basic-ftp` npm package
- Updated `src/lib/adapters/definitions.ts` — Added `WebDAVSchema`, `WebDAVConfig`, `SMBSchema`, `SMBConfig`, `FTPSchema`, `FTPConfig` types, and adapter definitions
- Updated `src/lib/adapters/index.ts` — Registered `WebDAVAdapter`, `SMBAdapter`, and `FTPAdapter` (renamed from `WebDAVStorageAdapter`, `SMBStorageAdapter`, `SFTPStorageAdapter` for consistency)
- Updated `src/components/adapter/form-constants.ts` — Added form field mappings and placeholders for WebDAV, SMB, and FTP
- Updated `src/components/adapter/utils.ts` — Added icon mappings for new storage adapters
- Updated `src/components/adapter/adapter-manager.tsx` — Added summary display cases for WebDAV, SMB, and FTP
- Updated `src/components/adapter/schema-field.tsx` — Added label override for `tls` field to display as "Encryption"
- Updated `Dockerfile` — Added `samba-client` Alpine package for `smbclient` CLI
- Updated `scripts/setup-dev-macos.sh` — Added `brew install samba` for local development
- New `src/lib/checksum.ts` — SHA-256 checksum utility with `calculateFileChecksum()`, `calculateChecksum()`, and `verifyFileChecksum()`
- New `src/services/integrity-service.ts` — Periodic integrity check service for all backups across all storage destinations
- New `tests/unit/lib/checksum.test.ts` — 12 unit tests covering checksum calculation, file hashing, and verification
- New `src/services/dashboard-service.ts` — Centralized server-side service for all dashboard data fetching
- New `src/components/dashboard/widgets/activity-chart.tsx` — Stacked bar chart (Client Component)
- New `src/components/dashboard/widgets/job-status-chart.tsx` — Donut chart with success rate (Client Component)
- New `src/components/dashboard/widgets/storage-volume-chart.tsx` — Storage list per destination
- New `src/components/dashboard/widgets/latest-jobs.tsx` — Filterable recent executions feed (Client Component)
- New `src/components/dashboard/widgets/dashboard-refresh.tsx` — Auto-refresh wrapper with smart polling
- Updated `src/lib/runner/steps/03-upload.ts` — File size now measured after compression/encryption pipeline; SHA-256 checksum calculated and stored in metadata; post-upload checksum verification added
- Updated `src/lib/core/interfaces.ts` — Added `checksum?: string` field to `BackupMetadata` interface
- Updated `src/services/restore-service.ts` — Pre-restore checksum verification of downloaded backup files
- Updated `src/services/system-task-service.ts` — Added `system.integrity_check` system task (weekly, disabled by default)

## v0.9.4-beta - Universal Download Links & Logging System
*Released: February 6, 2026*

This release extends the token-based download link feature (introduced for Redis restore) to all backup downloads in Storage Explorer. Additionally, it introduces a centralized logging and error handling system for better maintainability and debugging.

### ✨ New Features

#### 🔗 wget/curl Download Links for All Backups
The temporary download link feature is now available for all backup files:
- **Universal Access**: Click the Download button on any backup file and select "wget / curl Link"
- **Download Format Selection**: Choose between encrypted (.enc) or decrypted download for encrypted backups
- **Live Countdown Timer**: See exactly how much time remains before the link expires
- **Reusable Modal**: New `DownloadLinkModal` component can be integrated anywhere in the app
- **Ready-to-Use Commands**: Pre-formatted wget and curl commands with one-click copy

#### 🎯 Improved Download UX
- All files now show a dropdown menu on the Download button (not just encrypted files)
- Consistent download experience across all backup types
- wget/curl option always available regardless of encryption status

#### 📝 Centralized Logging System
Introduced a unified logging infrastructure to replace scattered `console.log` calls:
- **System Logger**: New `logger` utility (`src/lib/logger.ts`) with level-based logging (debug, info, warn, error)
- **Child Loggers**: Context-aware logging with `logger.child({ service: "ServiceName" })` for better traceability
- **Environment Control**: Configure log level via `LOG_LEVEL` environment variable
- **Output Formats**: Human-readable colored output in development, JSON format in production
- **Custom Error Classes**: New error hierarchy (`src/lib/errors.ts`) with specialized errors for adapters, services, encryption, etc.
- **Error Utilities**: `wrapError()`, `getErrorMessage()`, `isDBackupError()` for consistent error handling

#### 🌐 API Request & Security Logging
Added comprehensive logging in the Next.js middleware:
- **Request Logging**: All API requests are logged with method, path, duration, and anonymized IP
- **Rate Limit Events**: Warnings logged when clients exceed rate limits (for security monitoring)
- **IP Anonymization**: IPs are anonymized in logs for GDPR compliance (e.g., `192.168.x.x`)
- **Silent Paths**: High-frequency endpoints (`/api/health`, `/api/auth/get-session`) excluded to reduce noise

#### 🛡️ Type-Safe Error Handling
New custom error classes for better error categorization:
- `DBackupError` (base class)
- `AdapterError`, `ConnectionError`, `ConfigurationError`
- `ServiceError`, `NotFoundError`, `ValidationError`
- `PermissionError`, `AuthenticationError`
- `BackupError`, `RestoreError`, `EncryptionError`, `QueueError`

### 📚 Documentation
- Added comprehensive developer documentation for Download Tokens system
- Updated Storage Explorer user guide with wget/curl download section
- **New**: Added Logging System documentation in Developer Guide (System Logger, Custom Errors, Best Practices)

### 🧹 Code Cleanup
Removed legacy code that became obsolete after the v0.9.1 TAR architecture migration:
- **PostgreSQL Dialects**: Removed unused `pg_dumpall` branch from `getDumpArgs()` and simplified `getRestoreArgs()` to stub (restore uses `pg_restore` directly)
- **MySQL Dialects**: Removed unused multi-database branch (`--databases ...`) and `--all-databases` fallback from `getDumpArgs()`
- **MongoDB Dialects**: Simplified `getRestoreArgs()` to stub (restore builds args directly in `restore.ts`)
- **Roadmap**: Moved "PostgreSQL Restore Improvements" to completed (handled by TAR architecture)

### 🔧 Technical Changes
- New `src/lib/logger.ts` - Centralized logging utility
- New `src/lib/errors.ts` - Custom error class hierarchy
- New `src/lib/types/service-result.ts` - Type-safe service return type
- Migrated core services and adapters to use the new logging system
- Added lint-guard tests to detect `console.*` usage in source files

### 🍃 MongoDB Docker Compatibility
Replaced `mongosh` CLI dependency with native `mongodb` npm package for connection testing:
- **No CLI Dependency**: Connection test and database listing now use the native MongoDB driver instead of `mongosh`
- **Docker Compatible**: The `mongosh` shell is not available in Alpine-based Docker images, but the npm package works everywhere
- **Backup/Restore Unchanged**: `mongodump` and `mongorestore` (from `mongodb-tools`) are still used for actual backup operations
- **Cleaner Code**: Removed shell command parsing in favor of proper MongoDB client API calls

### 🔧 Type-Safe Adapter Configs
Exported TypeScript types from Zod schemas for better developer experience:
- **Inferred Types**: All adapter configs now have exported TypeScript types (e.g., `MySQLConfig`, `PostgresConfig`, `MongoDBConfig`)
- **100% Type-Safe**: All adapter functions (`dump()`, `restore()`, `test()`, `getDatabases()`) now use properly typed configs instead of `config: any`
- **Lint Guard Enforced**: New lint-guard test ensures `config: any` cannot be introduced in adapter files
- **Union Types**: Added `DatabaseConfig`, `StorageConfig`, `NotificationConfig`, `AnyDatabaseConfig` union types for generic handling
- **Extended Types**: Dump/restore functions use extended types with runtime fields (e.g., `MySQLDumpConfig`, `PostgresRestoreConfig`)
- **Better DX**: IDE autocomplete and compile-time error checking for adapter configurations

### 🎯 Interface Type Improvements
Further type safety improvements in the core interfaces:
- **AdapterConfigSchema**: `input` field now uses `z.ZodObject<z.ZodRawShape>` instead of `z.ZodObject<any>`
- **BackupMetadata**: Made extensible with index signature `[key: string]: unknown` for adapter-specific properties
- **BackupResult.metadata**: Changed to `Partial<BackupMetadata>` since adapters often return partial metadata
- **NotificationContext**: New typed interface for notification adapter context with fields like `success`, `duration`, `size`, `status`, `logs`, etc.
- **Documentation**: Added JSDoc comments explaining the type design decisions

## v0.9.3-beta - Redis Support, Restore UX & Smart File Extensions
*Released: February 2, 2026*

This release adds Redis as a new supported database type, introduces a guided restore wizard for Redis, and implements adapter-specific backup file extensions for better file identification.

### ✨ New Features

#### 🗄️ Redis Database Support
- **New Adapter**: Added Redis adapter for backing up Redis databases via RDB snapshots
- **Standalone & Sentinel Mode**: Support for standalone Redis servers and Sentinel high-availability setups
- **Redis 6, 7 & 8**: Full support and test coverage for all current Redis versions
- **ACL Support**: Optional username/password authentication for Redis 6+ Access Control Lists
- **TLS Support**: Secure connections via `--tls` flag
- **Database Selection**: Support for Redis database indices (0-15)

#### 🧙 Redis Restore Wizard
Since Redis cannot restore RDB files remotely, we've built a dedicated step-by-step wizard:
- **Guided Process**: 6-step wizard walks users through the manual restore process
- **Secure Download Links**: Generate temporary, single-use download URLs (5-minute expiry) for wget/curl
- **Copy-to-Clipboard**: All commands have one-click copy buttons
- **Platform-Specific**: Separate instructions for Systemd (Linux) and Docker deployments
- **Progress Tracking**: Visual step completion indicators

#### ⚠️ warning Redis Restore Limitations
- **Restore requires server access**: Redis RDB restore cannot be performed remotely. The backup file must be copied to the server's data directory and Redis must be restarted
- **Full server backup only**: RDB snapshots contain all databases (0-15), not individual databases
- **Cluster mode not yet supported**: Only standalone and Sentinel modes are available

#### 📁 Smart Backup File Extensions
Backup files now use appropriate extensions based on the database type:

| Database | Extension | Example |
|----------|-----------|---------|
| MySQL | `.sql` | `backup_2026-02-02.sql.gz.enc` |
| MariaDB | `.sql` | `backup_2026-02-02.sql.gz.enc` |
| PostgreSQL | `.sql` | `backup_2026-02-02.sql.gz.enc` |
| MSSQL | `.bak` | `backup_2026-02-02.bak.gz.enc` |
| MongoDB | `.archive` | `backup_2026-02-02.archive.gz.enc` |
| Redis | `.rdb` | `backup_2026-02-02.rdb.gz.enc` |
| SQLite | `.db` | `backup_2026-02-02.db.gz.enc` |

#### 🔗 Token-Based Public Downloads
- **Temporary Tokens**: Generate secure, single-use download links for backup files
- **No Auth Required**: Links work with wget/curl without session cookies
- **5-Minute Expiry**: Tokens automatically expire for security
- **Audit Trail**: Token generation is tied to authenticated users

#### ⚙️ User Preferences
- **New Preferences Tab**: Added a dedicated "Preferences" tab in the user profile settings
- **Auto-Redirect Setting**: Users can now disable automatic redirection to History page when starting backup/restore jobs
- **Instant Save**: Preference toggles save immediately without requiring a save button
- **Default Enabled**: Auto-redirect is enabled by default for new users

#### 🐳 Docker Deployment Enhancements
- **Docker Hub**: Images are now available on Docker Hub at [`skyfay/dbackup`](https://hub.docker.com/r/skyfay/dbackup) in addition to GitLab Registry. Docker Hub is now the default in all documentation
- **DATABASE_URL Default**: The Dockerfile now includes a sensible default (`file:/app/db/dbackup.db`), eliminating the need to configure this variable for standard deployments
- **TZ Variable**: Added timezone support via `TZ` environment variable (defaults to `UTC`)
- **TMPDIR Support**: New centralized `getTempDir()` utility respects the `TMPDIR` environment variable for custom temp directories (useful for tmpfs mounts)

#### 🔐 Authentication Improvements
- **Port Mapping Fix**: Fixed authentication issues when using Docker port mappings like `3001:3000`. The auth client now correctly uses the browser's current origin instead of a hardcoded URL
- **TRUSTED_ORIGINS**: New environment variable to allow multiple access URLs (e.g., both IP and domain). Accepts comma-separated list of additional trusted origins
- **Removed NEXT_PUBLIC_APP_URL**: This variable was removed as Next.js public variables are build-time only and don't work at runtime in Docker

### 📚 Documentation
- **Consolidated Installation Docs**: Docker Compose and Docker Run commands are now in a single location ([installation.md](/user-guide/installation)) with a tab switcher, eliminating duplication across pages
- **Environment Variables Audit**: Cleaned up documentation to only include actually implemented variables. Removed references to non-existent SMTP_*, LOG_*, and other placeholder variables
- **Improved Quick Start**: Streamlined the landing page and getting started guide to focus on concepts, with clear links to the installation guide for commands

#### 📅 Wiki Date Timestamps
- **Git History Fix**: VitePress build now fetches full git history on Cloudflare Pages, ensuring "Last updated" timestamps reflect actual commit dates instead of build time
- **European Date Format**: Changed date display format to DD/MM/YYYY for better international compatibility

### 🔧 Technical Changes
- Added `redis` package to Docker image for `redis-cli`
- New adapter at `src/lib/adapters/database/redis/`
- Test containers for Redis 6, 7 and 8 in `docker-compose.test.yml`
- New `backup-extensions.ts` utility for adapter-specific file extensions
- New `download-tokens.ts` for temporary public download URLs
- New `public-download` API endpoint for token-based downloads
- New `RedisRestoreWizard` component with step-by-step guidance
- Centralized temp directory handling in `src/lib/temp-dir.ts`
- New `autoRedirectOnJobStart` field in User model for redirect preference
- New `/api/user/preferences` endpoint for fetching user preferences
- New `useUserPreferences` hook for client-side preference access
- Auto-save preference toggles in profile settings (no save button needed)
- Updated all files using `os.tmpdir()` to use the new `getTempDir()` utility
- Auth client `baseURL` changed to empty string for proper origin detection
- Integration tests now skip adapters with missing CLI tools automatically

## v0.9.2-beta - Branding & Documentation
*Released: February 1, 2026*

This release focuses on improving the visual identity and accessibility of the project.

### ✨ New Features

#### 🎨 Visual Identity
- **Official Logo**: Introduced the first official DBackup logo (database with cloud and backup symbol)
- **Favicon**: Multi-resolution favicon support (16x16 to 512x512) for all browsers and devices
- **Brand Integration**: Logo now appears in the application (login page, sidebar header, browser tab)

#### 📚 Documentation & Community
- **Documentation Portal**: Launched official documentation at [https://dbackup.app](https://dbackup.app)
- **In-App Link**: Added quick access to documentation from the user menu in the sidebar
- **Discord Community**: Linked Discord server in the documentation for community support
- **SEO Optimization**: Added comprehensive meta tags, Open Graph, Twitter Cards, and structured data for better discoverability

## v0.9.1-beta - Unified Multi-DB TAR Architecture
*Released: February 1, 2026*

This release introduces a unified TAR-based backup format for multi-database backups across all database adapters. This brings consistency, reliability, and new features like selective restore.

### ⚠️ BREAKING CHANGE: Multi-DB Backup Format Changed

The backup format for **multi-database backups** has fundamentally changed from inline SQL/dump streams to TAR archives.

- **Affected**: Multi-DB backups created with MySQL, PostgreSQL, or MongoDB in versions prior to v0.9.1
- **Not Affected**: Single-database backups remain compatible
- **Action Required**: Old multi-DB backups cannot be restored with v0.9.1+. Keep a copy of v0.9.0 if you need to restore legacy backups, or re-create backups after upgrading

**Why this change?**
- Enables selective restore (choose specific databases)
- Enables database renaming during restore
- Consistent format across all database types
- Eliminates complex stream parsing that was error-prone

### ✨ New Features

#### 📦 Unified TAR Multi-DB Format
- **Consistent Architecture**: All database adapters (MySQL, PostgreSQL, MongoDB, MSSQL) now use the same TAR archive format for multi-database backups
- **Manifest File**: Each TAR archive includes a `manifest.json` with metadata about contained databases, sizes, and formats
- **Selective Restore**: Choose which databases to restore from a multi-DB backup
- **Database Renaming**: Restore databases to different names (e.g., `production` → `staging_copy`)

#### 🐘 PostgreSQL Improvements
- **Custom Format**: Multi-DB backups now use `pg_dump -Fc` (custom format) per database instead of `pg_dumpall`
- **Parallel-Ready**: Individual database dumps enable future parallel backup support
- **Smaller Backups**: Custom format includes built-in compression

#### 🍃 MongoDB Multi-DB
- **True Multi-DB Support**: MongoDB adapter now supports backing up multiple selected databases (previously only "all or one")
- **Database Renaming**: Uses `--nsFrom/--nsTo` for restoring to different database names

### 🔧 Improvements
- **Code Reduction**: PostgreSQL restore logic reduced by 53% (592 → 279 LOC) by removing complex Transform streams
- **Shared Utilities**: New `tar-utils.ts` with 18 unit tests for TAR operations
- **Cleaner Adapters**: Removed legacy multi-DB parsing code from all adapters

### 🧪 Testing & Quality
- **Multi-DB Integration Tests**: New test suites for TAR-based multi-database backup and restore
- **MSSQL Test Setup**: Automatic `testdb` database creation for MSSQL containers via `setup-mssql-testdb.sh`
- **Azure SQL Edge Skip**: Tests gracefully skip Azure SQL Edge on ARM64 Macs (limited functionality)
- **84 Integration Tests**: Full coverage across MySQL, MariaDB, PostgreSQL, MongoDB, and MSSQL

### 📚 Documentation
- **Developer Guide**: Updated database adapter documentation with TAR format details
- **User Guide**: Added Multi-DB restore workflow documentation
- **Naming Consistency**: Standardized "Microsoft SQL Server" / "MSSQL" naming throughout docs

## v0.9.0-beta - Microsoft SQL Server & Self-Service Security
*Released: January 31, 2026*

This release introduces full support for Microsoft SQL Server (MSSQL), bringing the Database Backup Manager to enterprise Windows environments. We have also added a dedicated Self-Service Password Change flow for users and hardened the application with new stress-testing tools.

### ✨ New Features

#### 🏢 Microsoft SQL Server (MSSQL) Support
- **Native Adapter**: Added a fully featured adapter for Microsoft SQL Server
- **Smart Detection**: The adapter automatically detects the SQL Server Edition (e.g., Express, Enterprise) and Version to enforce feature compatibility
- **Multi-DB Support**: Supports backing up multiple MSSQL databases in a single job by bundling them into a TAR archive
- **Server-Side Backups**: Optimized to handle local backup paths on the SQL Server host with built-in compression support
- **Security**: Implemented parameterized queries and strict timeout handling to ensure robust and secure connections

#### 👤 User Self-Service
- **Password Change UI**: Users can now securely change their own passwords directly from their profile settings
- **Audit Integration**: The audit log system has been updated to recognize and correctly tag "self-service" actions performed by users on their own accounts

### 🧪 Testing & Infrastructure
- **Stress Testing**: Introduced a new stress test data generator and npm scripts to simulate heavy load and large datasets
- **Isolation**: Refactored the testing suite to use a dedicated `testdb` container instead of shared resources, preventing flaky tests
- **Cleanup**: Improved temporary file handling (`/tmp`) for MSSQL test backups to prevent disk bloat during CI runs

### 📚 Documentation
- **MSSQL Guide**: Added comprehensive documentation covering MSSQL Editions, server-side backup permissions, and deployment strategies
- **Meta-Backup**: Finalized documentation and TODO items regarding the internal configuration backup system

## v0.8.3-beta - Meta-Backups & System Task Control
*Released: January 30, 2026*

This release introduces "Meta-Backups"—the ability for the Database Backup Manager to backup its own configuration, users, and state. This ensures that your backup infrastructure is just as resilient as the databases it protects.

### ✨ New Features

#### 🛡️ Configuration "Meta-Backups"
- **Self-Backup**: The application can now create backups of its own internal configuration, including Users, Jobs, and Settings
- **Storage Integration**: Configuration backups can be routed to your existing storage adapters, with specific filtering options
- **Disaster Recovery**: Added a full "System Config Restore" flow that allows you to rebuild the application state from a storage file
- **Sanitization**: User accounts and sensitive data are carefully sanitized and handled during the export/import process to ensure security

#### 🔑 Smart Encryption Recovery
- **Profile Portability**: You can now explicitly export and import Encryption Profile secret keys. This is critical for migrating your setup to a new server
- **Smart Detection**: The restore logic now includes "Smart Recovery" which detects if a required Encryption Profile is missing during a restore attempt and prompts/handles the situation accordingly
- **Nested Metadata**: Improved parsing logic to handle complex, nested encryption metadata structures

#### ⚙️ System Task Management
- **Task Control**: Administrators can now manually Enable or Disable specific background system tasks (e.g., Update Checks, Config Backups)
- **Unified Scheduling**: The configuration backup schedule has been moved into the standard System Task scheduler for consistent management
- **Auto-Save**: Added auto-save functionality to the Configuration Backup settings page for a smoother UX

### 🐛 Fixes & Quality of Life
- Added comprehensive documentation for exporting/importing secrets and disaster recovery procedures
- Fixed issues with metadata key consistency and folder structures (`config-backups`)
- Added new tests regarding AI transparency, scheduler logic, and config service edge-cases
- Removed the manual backup trigger from the UI in favor of the standardized system task controls

## v0.8.2-beta - Keycloak, Encryption Imports & Database Reset
*Released: January 29, 2026*

This release introduces native support for Keycloak OIDC, enhances the security of authentication flows, and adds critical functionality for importing Encryption Profiles.

### ⚠️ BREAKING CHANGE: Database Reset Required

We have consolidated the entire database schema history into a single, clean initialization migration to ensure long-term stability.

- **Action Required**: You must delete your existing `dev.db` file and allow the application to re-initialize on startup
- **Data Loss**: Existing data cannot be migrated automatically. Please ensure you have offloaded any critical backups before upgrading

### ✨ New Features

#### 🔐 Keycloak & OIDC Security
- **Keycloak Adapter**: Added a dedicated OIDC adapter and icon specifically for Keycloak integrations
- **Security Hardening**: The OIDC client now enforces HTTPS for Keycloak providers and strictly rejects mixed-content endpoints to prevent insecurity
- **Discovery Headers**: Added necessary headers to Keycloak OIDC discovery fetches to ensure reliable connection

#### 🔑 Encryption & Recovery
- **Profile Import**: You can now import Encryption Profiles directly into the system. This is critical for disaster recovery if you need to restore backups on a fresh instance using backed-up keys
- **Smart Restore**: Added logic to handle restored profiles intelligently during the import process
- **Documentation**: Enhanced the encryption documentation and recovery logs to better explain key management

#### 👤 Authentication UX
- **2-Step Login**: Refactored the login experience to use an email-first 2-step flow. This improves user experience and prepares the UI for more advanced auth methods
- **SSO Configuration**: The SSO Provider form has been split into tabs for better organization, and error handling has been significantly improved

### 🐛 Fixes & Improvements
- "Edit" buttons are now ghost-styled, and footers are right-aligned for consistency
- Fixed an issue where page count could be undefined unless manual pagination was triggered
- Added new tests for profile imports and smart recovery logic

## v0.8.1-beta - SQLite Support & Remote File Browsing
*Released: January 26, 2026*

This update introduces full support for SQLite databases, including a powerful feature to backup remote SQLite files via SSH tunneling.

### ✨ New Features

#### 🗄️ SQLite Support (Local & SSH)
- **Native SQLite Adapter**: You can now add SQLite databases as backup sources
- **Remote SSH Support**: Uniquely, this adapter supports backing up SQLite files located on remote servers by streaming them through an SSH tunnel
- **Safe Restore**: The restore logic automatically handles the cleanup of the old database file before restoring the new one to ensure a clean state

#### 📂 Remote File Browser
- **File Picker Dialog**: Added a new modal dialog that allows you to browse the filesystem directly from the UI
- **SSH Integration**: The browser works for both the local server filesystem and connected remote SSH targets
- **Smart Inputs**: Integrated the file browser into adapter forms (e.g., for selecting database paths or SSH private keys)

### ⚡ Improvements
- **SFTP Authentication**: Added a specific `authType` selector to the SFTP storage form to clearly distinguish between Password and Private Key authentication
- **Docker Compose**: Updated the example `docker-compose.yml` to use the new `beta` image tag by default

### 📚 Documentation
- Added comprehensive documentation and deployment guides for the new SQLite adapter
- Refactored and reorganized the project documentation structure for better navigability

## v0.8.0-beta - The First Beta: SSO, Audit Logs & Cloud Storage
*Released: January 25, 2026*

This release marks the first official Beta of the Database Backup Manager! 🚀 We have made a massive leap in functionality and stability. This update introduces enterprise-ready features including OIDC/SSO Authentication, S3 & SFTP Storage, a comprehensive Audit Log System, and intelligent Database Dialect Detection.

### ✨ Key New Features

#### 🔐 SSO & Identity Management
- **OIDC Support**: Full support for OpenID Connect providers (tested with Authentik, PocketID, and Generic providers)
- **Account Linking**: Existing users can link SSO providers to their accounts
- **Auto-Provisioning**: Optional automatic user creation upon successful SSO login
- **Management UI**: Dedicated admin interface to configure providers, domains, and discovery endpoints
- **Security**: Added strict rate limiting, domain verification, and 2FA administration controls

#### ☁️ Expanded Storage Options
- **S3 Support**: Native support for AWS S3 and compatible providers (MinIO, R2, etc.) using the AWS SDK
- **SFTP Support**: Securely offload backups to remote servers via SFTP
- **Connection Testing**: Added a "Test Connection" button to storage adapters to verify credentials immediately
- **Smart Cleanup**: Automatically deletes associated metadata sidecar files when a backup is removed

#### 🛡️ Audit & Compliance
- **Comprehensive Audit Logs**: Tracks all key actions (User, Group, System, Adapter changes)
- **Detailed Tracking**: Logs include User IP, User Agent, and specific diffs of changes made
- **Retention Policy**: Configurable retention settings for audit logs to manage database size
- **DataTables**: New standardized table view with faceted filtering and search for audit history

#### 💾 Database Engine Improvements
- **Dialect Detection**: Adapters now automatically detect the specific version and dialect (e.g., MySQL 5.7 vs 8.0)
- **MariaDB Support**: Added a dedicated adapter and dialect handling for MariaDB
- **PostgreSQL**: Improved restore logic to skip system databases and handle version mismatches gracefully
- **Security**: Switched MySQL adapter to use `MYSQL_PWD` environment variable for safer password handling

#### ⚙️ System & Core
- **Update Checker**: Built-in service to check for new application versions and notify admins
- **System Tasks**: Added "Run on Startup" options for maintenance tasks (e.g., permissions sync)
- **Health Checks**: Visual health history grid and badges for all adapters
- **Settings**: Implemented auto-save for system settings and improved UI layouts

### 🧪 Testing & Stability
- Massive test coverage with comprehensive Unit and Integration tests for Backup & Restore Pipelines, Storage Services, Notification Logic & Scheduler
- Enforced strict TypeScript matching in restore services and removed legacy `any` types
- Improved Docker composition for spinning up multi-database test environments

### 🐛 Bug Fixes & Refactoring
- Optimized log rendering with structured log entries and stage grouping
- Migrated all major lists (Jobs, Users, History) to the new `DataTable` component
- Resolved session handling errors during heavy load
- Fixed clipboard copying error handling
- Fixed filename handling after decryption
- Corrected "Trusted Providers" mutation issue in auth requests

## v0.5.0-dev - RBAC System, Encryption Vault & Core Overhaul
*Released: January 24, 2026*

This release represents a massive milestone for the Database Backup Manager. We have introduced a full-featured Role-Based Access Control (RBAC) system, significantly enhanced security with Recovery Kits and Rate Limiting, and completely refactored the core execution engine into a modular pipeline architecture.

### ✨ New Features

#### 🛡️ Granular RBAC System
- Introduced User Groups & Permissions
- Added full management UI for Users and Groups
- Implemented strict protection for the `SuperAdmin` group (cannot be deleted or modified)
- Added granular permission checks for API endpoints and Dashboard pages

#### 🔐 Enhanced Security & Encryption
- **Recovery Kits**: Added ability to generate and download offline recovery kits for emergency decryption
- **Master Key Reveal**: New secured UI dialog to reveal and export the master key
- **Rate Limiting**: Implemented rate limiting on API and Authentication endpoints to prevent abuse
- **MySQL Security**: Updated adapter to use `MYSQL_PWD` for safer password handling
- **2FA Administration**: Admins can now reset 2FA for users if locked out

#### 🗜️ Compression Support
- Added native support for backup compression (integration into UI and Pipelines)
- Added compression status columns to Jobs and Storage tables

#### 📊 Live Progress Tracking
- Real-time progress updates for backup and restore operations
- Visual feedback for steps, including "indeterminate" progress bars for streams where size is unknown

### ⚡ Architecture & Refactoring
- **Pipeline Pattern**: Refactored the job runner into a modular pipeline pattern with distinct steps
- **Service Layer**: Extracted business logic (Backup, Restore, User Actions) into a dedicated Service Layer for better testability and separation of concerns
- **Job Queue**: Implemented a limit of 10 max concurrent jobs to prevent system overload
- **BigInt Support**: Migrated `Execution.size` to BigInt to support massive backup files
- **Streaming**: Optimized MySQL and Postgres adapters for better streaming performance during dump and restore
- **Testing**: Added Vitest setup and unit tests for Storage Service and Adapters

### 🎨 UI/UX Improvements
- DataTables everywhere: Migrated Jobs, Configs, Logs, and Dashboard lists to a standardized `DataTable` component with faceted filtering and sorting
- Added loading skeletons for smoother page transitions
- Renamed "Users" to "Users & Groups" and improved sidebar organization
- Replaced standard Selects with Command-based Popovers for better UX
- Refactored UI to use standard Tailwind utility classes
- Revamped the "Recovery Kit" card UI in encryption profiles

### 🐛 Bug Fixes
- Fixed downloaded filenames after decryption
- Fixed session error handling and middleware logic
- Fixed clipboard copy error handling
- Resolved various TypeScript type issues throughout the codebase
- Improved Postgres adapter robustness and database selection logic

### 📚 Documentation & Misc
- Added GNU General Public License
- Updated README with new gallery and feature lists
- Added developer documentation for Core Systems and Database Adapters
- Added project coding standards and instruction guidelines
