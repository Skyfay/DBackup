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
- [ ] **PostgreSQL Adapter** (`pg_dump`)
- [ ] **MongoDB Adapter** (`mongodump`)

### Storage Destinations
- [x] **Local Filesystem Adapter**
- [ ] **S3 Compatible Storage Adapter** (AWS, MinIO, Cloudflare R2)
- [ ] **FTP / SFTP Adapter**
- [ ] **Cloud Providers** (Google Drive, Dropbox, OneDrive) - *Optional/Later*

### Notifications
- [ ] **Discord Webhook**
- [ ] **Email (SMTP)**
- [ ] **Slack / Teams**

## 🖥 Dashboard & Features
- [ ] **Sources Management**
    - [ ] List all sources
    - [ ] Create/Edit source configuration
    - [ ] Test connection
- [ ] **Destinations Management**
    - [ ] List all destinations
    - [ ] Create/Edit destination configuration
    - [ ] Test connection
- [ ] **Jobs Management**
    - [ ] List all backup jobs
    - [ ] Job Editor (Select Source, Destination, Schedule)
    - [ ] Manual Trigger Button
- [ ] **History & Logs**
    - [ ] List past executions
    - [ ] View detailed logs per execution
    - [ ] Download backup artifact (if local/accessible)
- [ ] **Dashboard Home**
    - [ ] Real statistics (Success rate, Total size)
    - [ ] Recent activity feed

## ⚙️ Backend Engine
- [ ] **Backup Runner**
    - [ ] Implement orchestration logic (Dump -> Compress -> Upload -> Notify)
    - [ ] Error handling & Retries
- [ ] **Scheduler**
    - [ ] Implement Cron scheduler (e.g., `node-cron` or similar)
    - [ ] Manage active jobs
