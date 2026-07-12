export type RoadmapStatus = "idea" | "planned" | "in-progress";

export type RoadmapCategory =
  | "backup-engine"
  | "storage"
  | "monitoring-dashboard"
  | "database-tools"
  | "security-access"
  | "developer-experience";

export const ROADMAP_CATEGORIES: { value: RoadmapCategory; label: string }[] = [
  { value: "backup-engine", label: "Backup Engine" },
  { value: "storage", label: "Storage" },
  { value: "monitoring-dashboard", label: "Monitoring & Dashboard" },
  { value: "database-tools", label: "Database Tools" },
  { value: "security-access", label: "Security & Access" },
  { value: "developer-experience", label: "Developer Experience" },
];

export interface RoadmapItem {
  slug: string;
  title: string;
  description: string;
  status: RoadmapStatus;
  category: RoadmapCategory;
  issueNumber?: number;
}

export const ROADMAP_ITEMS: RoadmapItem[] = [
  {
    slug: "firebird-support",
    title: "Firebird Support",
    description:
      "Firebird (3.x/4.x/5.x) as a new database source, with direct and SSH connection modes.",
    status: "in-progress",
    category: "backup-engine",
  },
  {
    slug: "file-based-linked-backup-restore",
    title: "File-Based & Linked Backup and Restore",
    description:
      "Direct file-based backup and restore for engines that support file-level snapshots, with linked/incremental backups to reduce storage usage.",
    status: "planned",
    category: "backup-engine",
  },
  {
    slug: "stream-based-backup-pipeline",
    title: "Stream-based Backup Pipeline",
    description:
      "Opt-in \"Large DB Mode\" that pipes dumps directly to storage without staging on disk first, with parallel multi-destination upload and inline checksums for databases too large for local /tmp.",
    status: "idea",
    category: "backup-engine",
    issueNumber: 76,
  },
  {
    slug: "runner-resilience",
    title: "Runner Resilience",
    description:
      "Exponential backoff retry logic for transient errors, plus a dead letter queue for jobs that fail repeatedly and need investigation.",
    status: "planned",
    category: "backup-engine",
  },
  {
    slug: "restic-storage-backend",
    title: "Restic Storage Backend",
    description:
      "Restic as a storage destination with block-level deduplication and rsyncable compression, using its own repository, browsing, and retention model instead of file-based storage.",
    status: "idea",
    category: "storage",
    issueNumber: 68,
  },
  {
    slug: "encryption-key-rotation",
    title: "Encryption Key Rotation",
    description:
      "Rotate the system ENCRYPTION_KEY without downtime, re-encrypting all stored secrets with the new key.",
    status: "idea",
    category: "security-access",
  },
  {
    slug: "user-invite-flow",
    title: "User Invite Flow",
    description:
      "Email-based user invitations with a forced password change on first login, built on the existing SMTP notification adapter.",
    status: "idea",
    category: "security-access",
  },
  {
    slug: "backup-tags-annotations",
    title: "Backup Tags & Annotations",
    description:
      "Manually tag backups (e.g. \"pre-migration\"), pin them to protect against retention deletion, and filter by tag in the Storage Explorer.",
    status: "idea",
    category: "backup-engine",
  },
  {
    slug: "backup-anomaly-detection",
    title: "Backup Anomaly Detection",
    description:
      "Alert when a backup's size deviates significantly from previous runs, plus a scheduled \"test restore\" task.",
    status: "idea",
    category: "monitoring-dashboard",
  },
  {
    slug: "prometheus-metrics-endpoint",
    title: "Prometheus Metrics Endpoint",
    description:
      "A /metrics endpoint exposing backup count, duration, size, success rate, and queue depth, plus a ready-made Grafana dashboard.",
    status: "idea",
    category: "monitoring-dashboard",
  },
  {
    slug: "backup-size-limits-alerts",
    title: "Backup Size Limits & Alerts",
    description:
      "Per-job configurable thresholds that warn when a backup is unexpectedly larger or smaller than expected.",
    status: "idea",
    category: "monitoring-dashboard",
  },
  {
    slug: "backup-drift-detection",
    title: "Backup Drift Detection",
    description:
      "Compare a database's current state against its last backup and alert when it has drifted significantly (new tables, size growth, dropped objects).",
    status: "idea",
    category: "database-tools",
  },
  {
    slug: "server-health-dashboard",
    title: "Server Health Dashboard",
    description:
      "Per-adapter server health metrics (uptime, active connections, running queries, replication status) as a pre-backup health indicator.",
    status: "idea",
    category: "database-tools",
  },
  {
    slug: "direct-sql-execution",
    title: "Direct SQL Execution",
    description:
      "Run custom SQL queries against configured sources from the web UI, read-only by default with write access behind a separate permission.",
    status: "idea",
    category: "database-tools",
  },
  {
    slug: "query-library",
    title: "Query Library",
    description:
      "Pre-built query templates for common tasks like user management and table maintenance, available as quick actions in the UI.",
    status: "idea",
    category: "database-tools",
  },
  {
    slug: "user-privileges-viewer",
    title: "User & Privileges Viewer",
    description:
      "Read-only view of database users and their permissions, to verify the backup user has sufficient privileges as a security audit helper.",
    status: "idea",
    category: "database-tools",
  },
  {
    slug: "storage-trend-graph",
    title: "Storage Trend Graph",
    description:
      "Historical database size over time derived from backup metadata, with growth-rate visualization for capacity planning.",
    status: "idea",
    category: "database-tools",
  },
  {
    slug: "e2e-test-suite",
    title: "End-to-End Test Suite",
    description:
      "Playwright/Cypress coverage for critical flows - login, create job, run backup, restore, verify - running in CI.",
    status: "idea",
    category: "developer-experience",
  },
  {
    slug: "internationalization",
    title: "Internationalization (i18n)",
    description: "Multi-language UI support with room for community-contributed translations.",
    status: "idea",
    category: "developer-experience",
  },
  {
    slug: "mobile-responsive-ui",
    title: "Mobile Responsive UI",
    description: "Optimized layouts for tablet and mobile, so backup status can be checked on the go.",
    status: "idea",
    category: "developer-experience",
  },
  {
    slug: "dark-mode-refinement",
    title: "Dark Mode Refinement",
    description:
      "A systematic pass over every component for dark mode consistency, plus a high-contrast accessibility mode.",
    status: "idea",
    category: "developer-experience",
  },
  {
    slug: "oracle-support",
    title: "Oracle Support",
    description: "Oracle Database as a new supported source, using RMAN or Data Pump exports.",
    status: "idea",
    category: "backup-engine",
  },
  {
    slug: "influxdb-support",
    title: "InfluxDB Support",
    description: "InfluxDB as a new supported source for backing up time-series data.",
    status: "idea",
    category: "backup-engine",
  },
];

export interface ShippedItem {
  slug: string;
  title: string;
  description: string;
  version: string;
  releaseDate: string;
  changelogAnchor?: string;
}

export const SHIPPED_ITEMS: ShippedItem[] = [
  {
    slug: "valkey-support",
    title: "Valkey Database Support",
    description: "Valkey as a database source, using the same RDB backup mechanism as Redis.",
    version: "v2.9.0",
    releaseDate: "2026-07-04",
    changelogAnchor: "v2-9-0-valkey-support-storage-alert-fix-and-multiple-improvements",
  },
  {
    slug: "notification-templates",
    title: "Notification Templates",
    description:
      "Reusable, per-channel, event-filtered notification templates replacing flat per-job notification config.",
    version: "v2.8.0",
    releaseDate: "2026-06-28",
    changelogAnchor: "v2-8-0-notification-templates-per-job-event-filters-and-multiple-bug-fixes",
  },
  {
    slug: "backup-integrity-verification",
    title: "Backup Integrity Verification",
    description:
      "SHA-256/MD5 checksums, on-demand Verify Now, native checksum verification across adapters, and scheduled integrity checks.",
    version: "v2.7.0",
    releaseDate: "2026-06-14",
    changelogAnchor: "v2-7-0-backup-integrity-verification-storage-explorer-caching-and-multiple-improvements",
  },
  {
    slug: "vault-credential-profiles-extended",
    title: "Vault Credential Profiles for Webhooks & OAuth",
    description: "Credential vault profiles extended to WEBHOOK, OAUTH, and TOKEN types.",
    version: "v2.6.0",
    releaseDate: "2026-06-06",
    changelogAnchor:
      "v2-6-0-security-update-vault-credential-profiles-oauth-improvements-and-multiple-bug-fixes",
  },
  {
    slug: "database-explorer-version-history",
    title: "Database Explorer Version History",
    description: "An engine-version timeline and change log per database source.",
    version: "v2.5.0",
    releaseDate: "2026-05-31",
    changelogAnchor: "v2-5-0-version-history-general-improvements",
  },
  {
    slug: "database-explorer-drill-down",
    title: "Database Explorer",
    description: "A table/data viewer with pagination, search, and schema inspection across all adapters.",
    version: "v2.4.0",
    releaseDate: "2026-05-25",
    changelogAnchor: "v2-4-0-database-explorer-browser-drill-down-data-viewer-and-bug-fixes",
  },
  {
    slug: "templates-system",
    title: "Templates System",
    description:
      "A dedicated Templates page with reusable Retention Policies, Naming Templates, and Schedule Presets, assignable across jobs.",
    version: "v2.2.0",
    releaseDate: "2026-05-07",
    changelogAnchor: "v2-2-0-templates-system-docker-image-update-and-bug-fixes",
  },
  {
    slug: "credential-profile-system",
    title: "Credential Profile System",
    description:
      "Centralized, encrypted Credential Profiles that adapters reference instead of storing secrets inline, plus one-click cloning for sources, destinations, and jobs.",
    version: "v2.0.0",
    releaseDate: "2026-05-03",
    changelogAnchor: "v2-0-0-credential-profiles-naming-template-cloning-and-major-refactor",
  },
  {
    slug: "live-history-redesign",
    title: "Live History Redesign",
    description: "Pipeline-stage tracking with real-time speed and progress for every backup and restore.",
    version: "v1.4.0",
    releaseDate: "2026-03-31",
    changelogAnchor: "v1-4-0-live-history-redesign",
  },
  {
    slug: "ssh-remote-execution",
    title: "SSH Remote Execution",
    description:
      "Run backups directly on the remote database host via SSH, without a local database client.",
    version: "v1.3.0",
    releaseDate: "2026-03-29",
    changelogAnchor: "v1-3-0-ssh-remote-execution",
  },
  {
    slug: "https-by-default",
    title: "HTTPS by Default & Certificate Management",
    description: "Built-in HTTPS with auto-generated certificates by default, plus a Certificate Management UI.",
    version: "v1.2.0",
    releaseDate: "2026-03-25",
    changelogAnchor:
      "v1-2-0-https-by-default-certificate-management-per-adapter-health-notifications",
  },
  {
    slug: "first-stable-release",
    title: "First Stable Release",
    description: "The first stable release, stabilizing the platform after the beta phase.",
    version: "v1.0.0",
    releaseDate: "2026-03-10",
    changelogAnchor: "v1-0-0-first-stable-release",
  },
];

export interface Milestone {
  slug: string;
  title: string;
  description: string;
  target: number;
  unit: string;
  liveSource?: "github-stars";
  fallbackCurrent: number;
}

export const MILESTONES: Milestone[] = [
  {
    slug: "200-github-stars",
    title: "200 GitHub Stars",
    description: "Help DBackup reach its next community milestone.",
    target: 200,
    unit: "stars",
    liveSource: "github-stars",
    fallbackCurrent: 0,
  },
];
