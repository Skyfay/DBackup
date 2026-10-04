import { DOCS_URL, GITHUB_REPO } from "@/lib/content";

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
    slug: "dbackup-agent",
    title: "DBackup Agent",
    description:
      "A small container on the target host that DBackup talks to instead of opening an SSH session, for hosts where SSH access is not an option. Dumps still stream back to DBackup for compression and encryption, so the encryption key and the storage credentials never leave it.",
    status: "planned",
    category: "backup-engine",
  },
  {
    slug: "sync-jobs",
    title: "Sync Jobs",
    description:
      "A second kind of job next to backups: keep a target in step with a source on its own schedule. Copy a file or database backup onto another host, or replicate one database into another, without building a backup and restoring it by hand every time.",
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
    status: "idea",
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
  version?: string;
  releaseDate: string;
  changelogAnchor?: string;
  link?: { href: string; label: string };
  star?: boolean;
}

export const SHIPPED_ITEMS: ShippedItem[] = [
  {
    slug: "redesigned-interface",
    title: "Redesigned Interface",
    description:
      "Every page is rebuilt in a new design that also works on phones and tablets, with a search across all jobs, connections, backups and runs. New pages for the backups, the databases and the history of each run, a Quick Setup that adds the first backup in one place, and notification emails in the same look.",
    version: "v4.0.0",
    releaseDate: "2026-10-04",
    changelogAnchor: "v4-0-0-redesigned-interface-global-search-air-gapped-destinations-and-recently-deleted",
  },
  {
    slug: "single-database-restores-downloads",
    title: "Single Database Restores & Downloads",
    description:
      "Restore or download one database out of a multi-database backup, reading only that database from the destination. Old execution logs and history entries can be cleaned up automatically, and Settings shows and optimizes the size of the DBackup database.",
    version: "v3.4.0",
    releaseDate: "2026-09-16",
    changelogAnchor: "v3-4-0-single-database-restores-and-downloads-data-retention-improvement-and-bug-fixes",
  },
  {
    slug: "300-github-stars",
    title: "300 GitHub Stars",
    description: "DBackup crossed 300 stars on GitHub, thanks to everyone in the community.",
    releaseDate: "2026-08-25",
    link: { href: `https://github.com/${GITHUB_REPO}/stargazers`, label: "View on GitHub" },
    star: true,
  },
  {
    slug: "azure-sql-database-support",
    title: "Azure SQL Database Support",
    description:
      "Azure SQL Database as a new source in beta, backed up through a BACPAC export, plus an hourly tier for Smart (GFS) retention policies.",
    version: "v3.3.0",
    releaseDate: "2026-08-15",
    changelogAnchor: "v3-3-0-azure-sql-database-support-s3-upload-rework-and-general-improvements",
  },
  {
    slug: "docker-volume-backups",
    title: "Docker Volume Backups",
    description:
      "Docker volumes as a backup source (beta), listed from the target host the way databases already are, so you pick them instead of typing paths. Containers using a selected volume are stopped for the export and started again afterwards, which you can turn off per source when the data is safe to copy live.",
    version: "v3.2.0",
    releaseDate: "2026-08-08",
    changelogAnchor: "v3-2-0-docker-volumes-backup-ssh-key-generation-mongodb-atlas-support-and-bug-fixes",
  },
  {
    slug: "file-folder-backups",
    title: "File & Folder Backups",
    description:
      "Directory and file sources with a seekable, per-entry encrypted archive format, incremental backup chains, byte-range restores, and a completely rebuilt Recovery Kit.",
    version: "v3.0.0",
    releaseDate: "2026-07-26",
    changelogAnchor: "v3-0-0-file-folder-backups-incremental-chains-and-general-improvements-fixes",
  },
  {
    slug: "200-github-stars",
    title: "200 GitHub Stars",
    description: "DBackup crossed 200 stars on GitHub, thanks to everyone in the community.",
    releaseDate: "2026-07-14",
    link: { href: `https://github.com/${GITHUB_REPO}/stargazers`, label: "View on GitHub" },
    star: true,
  },
  {
    slug: "firebird-support",
    title: "Firebird Support",
    description:
      "Firebird (3.x/4.x/5.x) as a supported database source, with direct and SSH connection modes.",
    version: "v2.10.0",
    releaseDate: "2026-07-12",
    changelogAnchor: "v2-10-0-firebird-support-new-website-and-multiple-bug-fixes",
  },
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
    slug: "100-github-stars",
    title: "100 GitHub Stars",
    description: "DBackup crossed 100 stars on GitHub.",
    releaseDate: "2026-05-04",
    link: { href: `https://github.com/${GITHUB_REPO}/stargazers`, label: "View on GitHub" },
    star: true,
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
    slug: "500-github-stars",
    title: "500 GitHub Stars",
    description: "Help DBackup reach its next community milestone.",
    target: 500,
    unit: "stars",
    liveSource: "github-stars",
    fallbackCurrent: 0,
  },
];

/** Where a shipped entry links to: its own link, its changelog section or the changelog. */
export function shippedHref(item: ShippedItem): string {
  if (item.link) return item.link.href;
  return item.changelogAnchor ? `${DOCS_URL}/changelog#${item.changelogAnchor}` : `${DOCS_URL}/changelog`;
}

export function issueHref(issueNumber: number): string {
  return `https://github.com/${GITHUB_REPO}/issues/${issueNumber}`;
}
