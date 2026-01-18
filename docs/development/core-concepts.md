# Core Architecture & Concepts

This document outlines the architectural logic behind the Database Backup Manager, focusing on the decoupling of resources, job logic, and storage access.

## 1. Design Philosophy: Decoupled Resources

The system is designed around the principle that **Backup Artifacts are independent of the Scheduler Configuration**. Deleting a Job should never punish the user by making previous backups inaccessible or identifying the origin impossible.

### The Entity Chain

1.  **Adapters (Sources & Destinations)**:
    *   These are **Infrastructure Definitions**.
    *   *Example:* "Production Postgres DB" or "Company S3 Bucket".
    *   They contain connection strings and credentials.
    *   They are reusable across multiple Jobs (n:m relationship).
2.  **Jobs**:
    *   These are **Business Logic / Automation Rules**.
    *   *Example:* "Daily Backup at 3 AM".
    *   A Job ties a *Source* to a *Destination* and defines a *Schedule*.
3.  **Executions**:
    *   These are **Audit Logs**.
    *   They record success/failure, logs, and timing of a specific Job run.
4.  **Storage / Backup Files**:
    *   These are **Physical Artifacts** residing on the Destination.
    *   **Crucial**: The Storage Explorer reads *directly* from the destination adapter, not from the local database execution history. This ensures that even if the app database is wiped, backups are still visible as long as the Destination is configured.

## 2. The "Storage Explorer" Pattern

The Storage Explorer (`src/app/api/storage`) acts as a file browser for your destinations.

### Problem: Context Loss
If a Job is deleted, we lose the link between a file (e.g., `backup_2024.sql.gz`) and its origin configuration.

### Solution: Sidecar Metadata
To maintain context without relying on the app database, we use the **Sidecar Pattern**. When a backup is created, two files are written:
1.  `my-backup.sql.gz` (The data)
2.  `my-backup.sql.gz.meta.json` (The context)

**The Metadata contains:**
*   Original Source Name
*   Database Type (Postgres, MySQL, etc.)
*   Original Job Name (frozen at time of backup)
*   Timestamp

The Storage Explorer reads the `.meta.json` files to enrich the UIs file list. This makes the Storage Explorer the **Single Source of Truth** for restoration.

## 3. Codebase Map

Where to find the logic for each part of the chain:

### Data Layer (`src/lib/core`)
*   **Interfaces**: [`src/lib/core/interfaces.ts`](../../src/lib/core/interfaces.ts) - Defines what an `Adapter`, `DatabaseAdapter`, and `StorageAdapter` must implement.
*   **Registry**: [`src/lib/core/registry.ts`](../../src/lib/core/registry.ts) - The singleton that holds loaded adapter implementations.

### Logic Layer (`src/services`)
*   **CRUD Operations**:
    *   [`src/services/adapter-service.ts`](../../src/services/adapter-service.ts): Managing Sources/Destinations.
    *   [`src/services/job-service.ts`](../../src/services/job-service.ts): Managing Job definitions.
*   **Execution Logic**:
    *   [`src/lib/runner/scheduler.ts`](../../src/lib/runner/scheduler.ts): Triggers jobs based on cron expressions.

### Pipeline Layer (`src/lib/runner`)
The actual backup process is a pipeline of steps:
1.  **Initialize**: Load configs, create execution record. ([`src/lib/runner/steps/01-initialize.ts`](../../src/lib/runner/steps/01-initialize.ts))
2.  **Dump**: Use Source Adapter to stream DB to local temp. ([`src/lib/runner/steps/02-dump.ts`](../../src/lib/runner/steps/02-dump.ts))
3.  **Compress**: Gzip/Zip the stream (if enabled).
4.  **Upload**: Use Destination Adapter to move temp file to storage.
5.  **Metadata**: Generate and upload the sidecar JSON.
6.  **Notify**: Send alerts via Notification Adapter.

### UI Layer (`src/app/dashboard`)
*   **Storage Explorer**: [`src/app/dashboard/storage`](../../src/app/dashboard/storage) - The client-side view for browsing files.
*   **API Route**: [`src/app/api/storage/[id]/files/route.ts`](../../src/app/api/storage/[id]/files/route.ts) - The server-side logic that lists files and parses metadata.

## 4. UI Patterns & Shared Components

To ensure a consistent user experience, we use shared UI patterns across the dashboard.

### Smart Data Tables (`src/components/ui/data-table.tsx`)
Our `DataTable` component is enhanced with "Faceted Filters" (similar to linear.app or Jira).

*   **Capabilities**:
    *   **Filtering**: Supports single/multi-select filtering.
    *   **Faceting**: Filter options show count badges (e.g., "MySQL (5)").
    *   **Dynamic sorting**: Options with active matches float to the top.
    *   **Visual cues**: Empty options are visually dimmed but accessible.

*   **Implementation Details**:
    *   A generic `filterableColumns` prop allows pages to inject specific filter logic.
    *   Used in **Storage Explorer** (filtering by Backup Source Type, Job Name) and **History** (filtering by Status).
    *   Component: [`src/components/ui/data-table-faceted-filter.tsx`](../../src/components/ui/data-table-faceted-filter.tsx).
