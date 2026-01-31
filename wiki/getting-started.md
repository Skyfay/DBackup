# Getting Started

Welcome to DBackup. This guide will help you get the system up and running.

## Prerequisites

- Docker & Docker Compose
- Node.js 20+ (only for local development without Docker)

## Installation with Docker

The easiest way to run DBackup is using Docker Compose.

1. **Clone Repository**
   ```bash
   git clone https://github.com/database-backup-manager/database-backup-manager.git
   cd database-backup-manager
   ```

2. **Start**
   ```bash
   docker-compose up -d
   ```

3. **Access**
   Open your browser and navigate to `http://localhost:3000`.

## First Steps

1. **Create User**: On the first start, you will be prompted to create an admin account.
2. **Define Destination**: Configure a storage location under "Destinations" (e.g., Local Folder or S3).
3. **Add Database**: Add your first database under "Sources".
4. **Create Job**: Connect source and destination in a backup job under "Jobs".
