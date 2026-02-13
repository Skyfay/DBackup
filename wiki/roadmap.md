# Roadmap

This page outlines planned features and improvements for DBackup. Features are subject to change based on community feedback and priorities.

## 🚨 Release Blockers

These items must be resolved before moving from beta to stable release.

### Automatic Database Migrations
- Ensure Prisma migrations run without data loss on upgrades
- Rollback mechanism for failed migrations
- Migration tests in CI pipeline
- Freeze and stabilize the database schema

### Runner Resilience & Error Recovery
- **Retry Logic**: Exponential backoff for transient errors (network timeouts, storage hiccups)
- **Partial Failure Handling**: If 1 of 5 databases fails in a multi-DB backup, save the successful ones
- **Dead Letter Queue**: Move repeatedly failing jobs to a separate status for investigation

### Graceful Shutdown
- Cleanly abort running jobs when the container is stopped
- Set execution status to "Cancelled" instead of leaving "Running" orphans
- Clean up temporary files on shutdown

### Startup Recovery
- Detect jobs stuck in "Running" status from a previous crash and mark as "Failed"
- Clean up orphaned temp files on startup
- Re-initialize the queue manager

### Robust Health Check Endpoint
- Verify database connectivity
- Check queue manager status
- Monitor available disk space (critical for local storage backups)



## 🔐 Security & Stability (Pre-Release)

### Encryption Key Rotation
- Mechanism to rotate the `ENCRYPTION_KEY` without downtime
- Re-encrypt all stored secrets (DB passwords, SSO client secrets) with the new key
- Rotation guide in documentation

### Configurable Rate Limiting
- Move hardcoded rate limits to SystemSettings
- Allow admins to adjust limits per endpoint category via the UI

### Audit Log Performance
- Ensure pagination and lazy loading for large audit log tables
- Add database indices on frequently filtered columns
- Implement log archival or auto-cleanup for old entries



## 🚀 Planned Features

### Quick Setup Wizard
Guided first-run experience to configure your first backup:
1. Add database source
2. Configure storage destination
3. Create backup job
4. Test and schedule

### User Invite Flow
- Email-based user invitations
- Force password change on first login
- Integration with SMTP notification adapter

### Self-Service Profile
Allow users to edit their own profile regardless of strict RBAC permissions.

### Backup Verification & Integrity Checks
- Periodic "test restore" as a scheduled task
- Alert if backup size deviates significantly from previous runs (anomaly detection)

### Backup Tags & Annotations
- Manually tag backups (e.g., "pre-migration", "before-upgrade")
- Pin backups to protect them from automatic retention policy deletion
- Filter and search by tags in Storage Explorer



## 📊 Dashboard & Monitoring

### Backup Calendar View
- Visual overview of when backups ran (similar to GitHub contribution graph)
- Color-coded status (success, failed, skipped)

### Backup Size Trend Analysis
- Track backup sizes over time per job
- Detect unusual growth patterns in databases

### Prometheus Metrics Endpoint
- Expose `/metrics` endpoint for Prometheus scraping
- Metrics: backup count, duration, size, success rate, queue depth
- Grafana dashboard template



## 📦 Planned Storage Adapters

### Rsync
Efficient incremental backups using rsync protocol.

### Cloud Providers (OAuth-based)
- **Google Drive** - Personal and Google Workspace storage
- **Dropbox** - Dropbox Business and personal accounts
- **OneDrive** - Microsoft 365 and personal OneDrive



## 🔔 Planned Notification Adapters

### Slack
Webhook notifications for Slack workspaces.

### Microsoft Teams
Teams channel notifications for enterprise users.

### Generic Webhook
- Send JSON payloads to any HTTP endpoint
- Customizable payload templates
- Supports PagerDuty, Ntfy, Gotify, Uptime Kuma, and more



## 🧪 Testing & Quality

### End-to-End Test Suite
- Playwright or Cypress tests for critical user flows
- Login → Create job → Run backup → Restore → Verify
- Run in CI pipeline

### Stress Testing Tools
- Scripts to generate large test datasets (1GB+)
- Performance benchmarking for backup/restore operations



## 📚 Documentation (Pre-Release)

### API Reference
- OpenAPI / Swagger documentation for all API endpoints
- Interactive API explorer

### Disaster Recovery Runbook
- Step-by-step guide for recovering from total system failure
- How to restore DBackup itself from a config backup

### Upgrade Guide
- Version-by-version migration instructions
- Breaking change highlights per release



## 🛠 Database Management & Playground

### Direct SQL Execution
- Connect directly to configured database sources
- Execute custom SQL queries from the web UI
- Query result visualization

### Query Library
- Pre-built templates for common tasks:
  - User permission management
  - Database creation
  - Table maintenance
- Quick-action buttons in the UI



## 🎨 Nice-to-Have (Post-Release)

### Internationalization (i18n)
- Multi-language UI support
- Community-contributed translations

### Mobile Responsive UI
- Optimized layouts for tablet and mobile devices
- Status monitoring on the go

### Backup Size Limits & Alerts
- Warning when backups are unexpectedly large or small
- Configurable thresholds per job

### Dark Mode Refinement
- Systematic review of all components for dark mode consistency
- High-contrast accessibility mode



## ✅ Recently Completed

For a full list of completed features, see the [Changelog](/changelog).

### Highlights
- ✅ PostgreSQL restore improvements (v0.9.1 - TAR architecture with per-DB custom format dumps)
- ✅ Multi-database support (MySQL, PostgreSQL, MongoDB, SQLite, MSSQL, Redis)
- ✅ AES-256-GCM backup encryption with Vault
- ✅ GZIP and Brotli compression
- ✅ S3, SFTP, Local, WebDAV, SMB, and FTP/FTPS storage adapters
- ✅ Discord and Email notifications
- ✅ Cron-based scheduling with GVS retention
- ✅ RBAC permission system
- ✅ SSO/OIDC authentication (Authentik, PocketID, Generic)
- ✅ TOTP and Passkey 2FA
- ✅ Live backup progress monitoring
- ✅ System configuration backup
- ✅ Audit logging
- ✅ Centralized logging system with custom error classes (v0.9.4)
- ✅ wget/curl download links for all backups (v0.9.4)
- ✅ Redis database support with restore wizard (v0.9.3)
- ✅ Type-safe adapter configurations (v0.9.4)
- ✅ Token-based public downloads (v0.9.3)
- ✅ User preferences system (v0.9.3)
- ✅ SHA-256 checksum verification with integrity check system (v0.9.5)
- ✅ Interactive dashboard with charts and analytics (v0.9.5)
- ✅ Smart type filters for sources, destinations, and notifications (v0.9.5)
- ✅ Storage usage analytics and per-destination breakdown (v0.9.5)



## 💡 Feature Requests

Have an idea for a new feature? Open an issue on [GitLab](https://gitlab.com/Skyfay/dbackup/-/issues) or [GitHub](https://github.com/Skyfay/dbackup/issues).
