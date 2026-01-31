# Roadmap

This page outlines planned features and improvements for DBackup. Features are subject to change based on community feedback and priorities.

## 🎯 In Progress

### PostgreSQL Restore Improvements
- Enhanced error detection (parse stderr for critical errors, stop on failures)
- DB properties preservation (extract ENCODING, LC_COLLATE, TEMPLATE from CREATE DATABASE)
- Post-restore validation (optional row count comparison, integrity verification)

### Dashboard Enhancements
- Backup statistics graphs and visualizations

## 📦 Planned Storage Adapters

### FTP / FTPS
Store backups on FTP servers with optional TLS encryption.

### WebDAV
Support for Nextcloud, OwnCloud, and other WebDAV-compatible storage.

### SMB / CIFS
Windows network share support for enterprise environments.

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

## 🚀 Planned Features

### Quick Setup Wizard
Guided flow to configure your first backup:
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

## 🧪 Testing & Quality

### Stress Testing Tools
- Scripts to generate large test datasets (1GB+)
- Performance benchmarking for backup/restore operations

---

## ✅ Recently Completed

For a full list of completed features, see the [Changelog](/changelog).

### Highlights
- ✅ Multi-database support (MySQL, PostgreSQL, MongoDB, SQLite, MSSQL)
- ✅ AES-256-GCM backup encryption with Vault
- ✅ GZIP and Brotli compression
- ✅ S3, SFTP, and Local storage adapters
- ✅ Discord and Email notifications
- ✅ Cron-based scheduling with GVS retention
- ✅ RBAC permission system
- ✅ SSO/OIDC authentication (Authentik, PocketID, Generic)
- ✅ TOTP and Passkey 2FA
- ✅ Live backup progress monitoring
- ✅ System configuration backup
- ✅ Audit logging

---

## 💡 Feature Requests

Have an idea for a new feature? Open an issue on [GitLab](https://gitlab.com/Skyfay/dbackup/-/issues) or [GitHub](https://github.com/Skyfay/dbackup/issues).
