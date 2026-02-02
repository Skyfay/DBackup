# Changelog

All notable changes to DBackup are documented here.

## v0.9.3-beta - Redis Support, Docker Deployment & Auth Improvements
*Released: February 2, 2026*

This release adds Redis as a new supported database type and improves the Docker deployment experience.

### ✨ New Features

#### 🗄️ Redis Database Support
- **New Adapter**: Added Redis adapter for backing up Redis databases via RDB snapshots
- **Standalone & Sentinel Mode**: Support for standalone Redis servers and Sentinel high-availability setups
- **Redis 6+ ACL Support**: Optional username/password authentication for Redis 6+ Access Control Lists
- **TLS Support**: Secure connections via `--tls` flag
- **Database Selection**: Support for Redis database indices (0-15)

::: warning Redis Restore Limitations
- **Restore requires server access**: Redis RDB restore cannot be performed remotely. The backup file must be copied to the server's data directory and Redis must be restarted
- **Full server backup only**: RDB snapshots contain all databases (0-15), not individual databases
- **Cluster mode not yet supported**: Only standalone and Sentinel modes are available
:::

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
- Centralized temp directory handling in `src/lib/temp-dir.ts`
- Updated all files using `os.tmpdir()` to use the new `getTempDir()` utility
- Auth client `baseURL` changed to empty string for proper origin detection

---

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

---

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

---

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

---

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

---

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

---

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

---

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

---

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
