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

## 🖥 Dashboard & Features
- [x] **Sources Management**
    - [x] List all sources
    - [x] Create/Edit source configuration
    - [ ] Test connection
- [x] **Destinations Management**
    - [x] List all destinations
    - [x] Create/Edit destination configuration
    - [ ] Test connection
- [x] **Notifications Management** (Added)
- [x] **Jobs Management**
    - [x] List all backup jobs
    - [x] Job Editor (Select Source, Destination, Schedule)
    - [x] Manual Trigger Button
- [x] **History & Logs**
    - [x] List past executions
    - [x] View detailed logs per execution
    - [ ] Download backup artifact (if local/accessible)
- [ ] **Dashboard Home**
    - [ ] Real statistics (Success rate, Total size)
    - [ ] Recent activity feed

## ⚙️ Backend Engine
- [x] **Backup Runner**
    - [x] Implement orchestration logic (Dump -> Compress -> Upload -> Notify)
    - [x] Error handling & Retries
- [x] **Scheduler**
    - [x] Implement Cron scheduler (e.g., `node-cron` or similar)
    - [x] Manage active jobs
