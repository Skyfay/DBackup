# Project Roadmap & Todo List

## 🏗 Core Framework
- [x] **Project Initialization**
    - [x] Setup Next.js 16 (App Router)
    - [x] Configure Tailwind CSS & TypeScript
    - [x] Setup ESLint
- [x] **UI Framework**
    - [x] Install Shadcn UI
    - [x] Setup Theme / Global Styles
    - [x] Create Layout (Sidebar, Navigation)
- [x] **Database & State**
    - [x] Setup Prisma ORM
    - [x] Define Schema (AdapterConfig, Job, Execution)
    - [x] Setup SQLite (Local DB)
- [x] **Architecture**
    - [x] Define Adapter Interfaces (Database, Storage, Notification)
    - [x] Create Type Definitions

## 📦 Deployment & Maintenance
- [ ] **Containerization**
    - [ ] Dockerfile optimization
    - [ ] docker-compose setup
- [ ] **Meta-Backup**
    - [ ] Export/Import App Configuration

## 🔌 Adapters Implementation
### Database Sources
- [x] **MySQL / MariaDB Adapter** (`mysqldump`)
- [x] **PostgreSQL Adapter** (`pg_dump`)
- [x] **MongoDB Adapter** (`mongodump`)

### Storage Destinations
- [x] **Local Filesystem Adapter**
- [ ] **S3 Compatible Storage Adapter** (AWS, MinIO, Cloudflare R2)
- [ ] **FTP / SFTP Adapter**
- [ ] **Cloud Providers** (Google Drive, Dropbox, OneDrive) - *Optional/Later*

### Notifications
- [x] **Discord Webhook**
- [x] **Email (SMTP)**
- [ ] **Slack / Teams**
- [ ] **Notification Conditions** (Success only / Failed only)

## 🖥 Dashboard & Features
- [x] **Sources Management**
    - [x] List all sources
    - [x] Create/Edit source configuration
    - [x] Test connection (Auto-test on creation + Force option)
    - [x] Validate credentials & permissions
    - [x] Fetch available databases (List & Multi-Select)
- [x] **Destinations Management**
    - [x] List all destinations
    - [x] Create/Edit destination configuration
    - [ ] Test connection
- [x] **Notifications Management** (Added)
- [x] **Jobs Management**
    - [x] List all backup jobs
    - [x] Job Editor (Select Source, Destination, Schedule)
    - [x] Manual Trigger Button
    - [ ] Retention Policies (Smart rotation: Keep last X days/weeks)
- [x] **Theme Support**
    - [x] Dark / Light / System Mode
    - [x] Auto-detection & Settings Toggle
- [x] **UX Improvements**
    - [x] Standardize Delete Confirmation Modal (Replace browser native confirm)
- [x] **History & Logs**
    - [x] List past executions
    - [x] View detailed logs per execution
    - [ ] Download backup artifact (if local/accessible)
- [ ] **Storage Explorer & Restore**
    - [x] List backups per Destination
    - [x] Download backup artifacts
    - [x] Restore workflow (Select Source, Type-Check, Rename)
    - [x] Filtering (Size, Source, Job)
- [ ] **Dashboard Home**
    - [ ] Real statistics (Success rate, Total size)
    - [ ] Recent activity feed

## 🛠 Database Management & Playground
- [ ] **Direct SQL Execution**
    - [ ] Connect directly to database sources
    - [ ] Execute custom SQL queries
- [ ] **Query Library**
    - [ ] Library of standard commands (User permission management, Create DB, etc.)
    - [ ] Simple UI integration for common administrative tasks

## ⚙️ Backend Engine
- [x] **Backup Runner**
    - [x] Implement orchestration logic (Dump -> Compress -> Upload -> Notify)
    - [x] Error handling & Retries
- [x] **Scheduler**
    - [x] Implement Cron scheduler (e.g., `node-cron` or similar)
    - [x] Manage active jobs

## 🔐 Authentication & Security
- [ ] **User Management**
    - [x] Login page
    - [x] Setup Better-Auth (Clean implementation)
    - [ ] Auth via OIDC
    - [ ] Passkey only, TOTP for 2FA
    - [ ] Multi-User Setup
    - [ ] User Permissions
- [ ] **Data Security**
    - [ ] Backup Encryption (Encrypt resulting artifacts)
    - [ ] Credential Encryption (Encrypt DB passwords in database at rest via AES)