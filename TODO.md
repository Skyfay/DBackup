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
    - [x] Refactor User Logic to Service Layer


## � Security & Encryption
- [x] **Vault / Encryption Profiles**
    - [x] Database Schema for Profiles
    - [x] UI for Managing Keys
    - [x] Server Actions & Service Layer
- [x] **Backup Encryption**
    - [x] Implement AES-256-GCM Streaming
    - [x] Integrate with Backup Runner
    - [x] Job Configuration UI
- [x] **Restore Decryption**
    - [x] Detect Encrypted Backups (.enc / .meta.json)
    - [x] Decrypt Stream on Restore/Download
## 🗜️ Compression & Optimization
- [x] **Backup Compression**
    - [x] Database Schema (Job config)
    - [x] UI Configuration (Gzip, Brotli)
    - [x] Streaming Pipeline Integration
    - [x] Decompression in Restore
    - [x] Progress Tracking for Compression/Encryption
## �📦 Deployment & Maintenance
- [ ] **Containerization**
    - [ ] Dockerfile optimization
    - [ ] docker-compose setup
- [ ] **Meta-Backup**
    - [ ] Export/Import App Configuration- [ ] **Version Management**
    - [ ] Display current version in Settings/Footer
    - [ ] Check for updates (GitLab/GitHub API) & UI Notification
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
- [x] **Notification Conditions** (Success only / Failed only)

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
    - [x] Retention Policies (Smart rotation: Keep last X days/weeks)
        - [x] **Step 1: Database**: Add `retention` JSON field to `Job` model
        - [x] **Step 2: Core Logic**: Create `src/services/retention-service.ts` for GVS algorithm
        - [x] **Step 3: Unit Tests**: Write comprehensive tests for the GVS algorithm
        - [x] **Step 4: Runner**: Implement `stepRetention` in the backup pipeline
        - [x] **Step 5: UI**: Add Retention Configuration to `JobForm` component
- [x] **Theme Support**
    - [x] Dark / Light / System Mode
    - [x] Auto-detection & Settings Toggle
- [x] **UX Improvements**
    - [x] Standardize Delete Confirmation Modal (Replace browser native confirm)
    - [x] Refactor Listings to DataTables (Vault, Adapters, Jobs)
    - [x] Standardize Page Headers & Cards
- [x] **History & Logs**
    - [x] List past executions
    - [x] View detailed logs per execution
    - [ ] Download backup artifact (if local/accessible)
- [x] **Storage Explorer & Restore**
    - [x] List backups per Destination
    - [x] Metadata / Sidecar file support
    - [x] Download backup artifacts
    - [x] Restore workflow (Select Source, Type-Check, Rename)
    - [x] Version Conflict Safeguard (Prevent Restore of new -> old)
    - [x] Filtering (Size, Source, Job)
    - [x] Manual Lock/Unlock (Prevent Retention Deletion)
- [ ] **Dashboard Home**
    - [X] Real statistics (Success rate, Total size)
    - [X] Recent activity feed
- [ ] **Quick Setup Wizard**
    - [ ] Combined flow (Source -> Destination -> Job)

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
    - [X] TOTP for 2FA
    - [X] Passkey only or 2FA
    - [X] Multi-User Setup
    - [x] **User Permissions (RBAC)**
    - [x] **Database Schema**: Create `Group` model (Permissions as JSON) & add relation to `User`.
    - [x] **UI Restructure**: Convert `dashboard/users` to Tab-View (Users | Groups).
    - [x] **Group Management**: CRUD for Groups + Permission definitions.
    - [x] **User Assignment**: Assign users to specific groups.
    - [x] **Access Control**: Implement permission guards (Server Actions & Components).
    - [x] Administrator manage other user (eg. reset 2FA)
    - [ ] **UX & Refinement**:
        - [ ] Show 2FA Status (Active/Inactive) in User Table
        - [ ] Invite Flow (Email link) or Force Password Change on first login (with SMTP combined)
        - [ ] "Self-Service" Concept (Allow users to edit own profile regardless of strict permissions)
- [ ] **Audit & Compliance**
    - [ ] **Audit Logs**: Track sensitive user actions (Login, Create/Delete User, Change Permissions)
- [ ] **Data Security**
    - [ ] Backup Encryption (Encrypt resulting artifacts)
    - [X] Credential Encryption (Encrypt DB passwords in database at rest via AES)

## 📡 Live Monitoring & Testing
- [ ] **Live Backup Progress**
    - [ ] Real-time file size updates during "Dump" phase
    - [ ] UI Polling/Socket to show progress bar to user
- [ ] **Stress Testing**
    - [ ] Script to generate 1GB+ Dummy Data (Postgres/MySQL)

## ✅ Refactoring & Quality Assurance
- [x] **Codebase Security Audit**
    - [x] Automated Permissions Check (ensure all Actions verify RBAC)
    - [x] Secure sensitive Server Actions
- [x] **Testing Infrastructure**
    - [x] Modernize Adapter Tests (Switch to Dialect-based testing)
    - [x] Verify supported database versions
