import { DOCS_URL, GITHUB_REPO } from "@/lib/content";
import type { Messages } from "@/i18n/translate";

export type RoadmapStatus = "idea" | "planned" | "in-progress";

export type RoadmapCategory =
  | "backup-engine"
  | "storage"
  | "monitoring-dashboard"
  | "database-tools"
  | "security-access"
  | "developer-experience";

/** The categories in order. Their names live in the messages under roadmap.category. */
export const ROADMAP_CATEGORIES: RoadmapCategory[] = [
  "backup-engine",
  "storage",
  "monitoring-dashboard",
  "database-tools",
  "security-access",
  "developer-experience",
];

// The title and the description of an entry live in the messages under
// roadmap.items.<slug>, roadmap.shipped.<slug> and roadmap.milestones.<slug>,
// so a slug without them does not compile.
type ItemSlug = keyof Messages["roadmap"]["items"];
type ShippedSlug = keyof Messages["roadmap"]["shipped"];
type MilestoneSlug = keyof Messages["roadmap"]["milestones"];

export interface RoadmapItem {
  slug: ItemSlug;
  status: RoadmapStatus;
  category: RoadmapCategory;
  issueNumber?: number;
}

export const ROADMAP_ITEMS: RoadmapItem[] = [
  {
    slug: "dbackup-agent",
    status: "planned",
    category: "backup-engine",
  },
  {
    slug: "sync-jobs",
    status: "planned",
    category: "backup-engine",
  },
  {
    slug: "stream-based-backup-pipeline",
    status: "idea",
    category: "backup-engine",
    issueNumber: 76,
  },
  {
    slug: "runner-resilience",
    status: "idea",
    category: "backup-engine",
  },
  {
    slug: "restic-storage-backend",
    status: "idea",
    category: "storage",
    issueNumber: 68,
  },
  {
    slug: "encryption-key-rotation",
    status: "idea",
    category: "security-access",
  },
  {
    slug: "user-invite-flow",
    status: "idea",
    category: "security-access",
  },
  {
    slug: "backup-tags-annotations",
    status: "idea",
    category: "backup-engine",
  },
  {
    slug: "backup-anomaly-detection",
    status: "idea",
    category: "monitoring-dashboard",
  },
  {
    slug: "prometheus-metrics-endpoint",
    status: "idea",
    category: "monitoring-dashboard",
  },
  {
    slug: "backup-size-limits-alerts",
    status: "idea",
    category: "monitoring-dashboard",
  },
  {
    slug: "backup-drift-detection",
    status: "idea",
    category: "database-tools",
  },
  {
    slug: "server-health-dashboard",
    status: "idea",
    category: "database-tools",
  },
  {
    slug: "direct-sql-execution",
    status: "idea",
    category: "database-tools",
  },
  {
    slug: "query-library",
    status: "idea",
    category: "database-tools",
  },
  {
    slug: "user-privileges-viewer",
    status: "idea",
    category: "database-tools",
  },
  {
    slug: "storage-trend-graph",
    status: "idea",
    category: "database-tools",
  },
  {
    slug: "e2e-test-suite",
    status: "idea",
    category: "developer-experience",
  },
  {
    slug: "internationalization",
    status: "idea",
    category: "developer-experience",
  },
  {
    slug: "high-contrast-mode",
    status: "idea",
    category: "developer-experience",
  },
  {
    slug: "oracle-support",
    status: "idea",
    category: "backup-engine",
  },
  {
    slug: "influxdb-support",
    status: "idea",
    category: "backup-engine",
  },
];

export interface ShippedItem {
  slug: ShippedSlug;
  version?: string;
  releaseDate: string;
  changelogAnchor?: string;
  /** Where a community milestone links to, labelled "View on GitHub". */
  link?: string;
  /** The star count of a community milestone. */
  stars?: number;
}

export const SHIPPED_ITEMS: ShippedItem[] = [
  {
    slug: "redesigned-interface",
    version: "v4.0.0",
    releaseDate: "2026-10-04",
    changelogAnchor: "v4-0-0-redesigned-interface-global-search-air-gapped-destinations-and-recently-deleted",
  },
  {
    slug: "single-database-restores-downloads",
    version: "v3.4.0",
    releaseDate: "2026-09-16",
    changelogAnchor: "v3-4-0-single-database-restores-and-downloads-data-retention-improvement-and-bug-fixes",
  },
  {
    slug: "300-github-stars",
    releaseDate: "2026-08-25",
    link: `https://github.com/${GITHUB_REPO}/stargazers`,
    stars: 300,
  },
  {
    slug: "azure-sql-database-support",
    version: "v3.3.0",
    releaseDate: "2026-08-15",
    changelogAnchor: "v3-3-0-azure-sql-database-support-s3-upload-rework-and-general-improvements",
  },
  {
    slug: "docker-volume-backups",
    version: "v3.2.0",
    releaseDate: "2026-08-08",
    changelogAnchor: "v3-2-0-docker-volumes-backup-ssh-key-generation-mongodb-atlas-support-and-bug-fixes",
  },
  {
    slug: "file-folder-backups",
    version: "v3.0.0",
    releaseDate: "2026-07-26",
    changelogAnchor: "v3-0-0-file-folder-backups-incremental-chains-and-general-improvements-fixes",
  },
  {
    slug: "200-github-stars",
    releaseDate: "2026-07-14",
    link: `https://github.com/${GITHUB_REPO}/stargazers`,
    stars: 200,
  },
  {
    slug: "firebird-support",
    version: "v2.10.0",
    releaseDate: "2026-07-12",
    changelogAnchor: "v2-10-0-firebird-support-new-website-and-multiple-bug-fixes",
  },
  {
    slug: "valkey-support",
    version: "v2.9.0",
    releaseDate: "2026-07-04",
    changelogAnchor: "v2-9-0-valkey-support-storage-alert-fix-and-multiple-improvements",
  },
  {
    slug: "notification-templates",
    version: "v2.8.0",
    releaseDate: "2026-06-28",
    changelogAnchor: "v2-8-0-notification-templates-per-job-event-filters-and-multiple-bug-fixes",
  },
  {
    slug: "backup-integrity-verification",
    version: "v2.7.0",
    releaseDate: "2026-06-14",
    changelogAnchor: "v2-7-0-backup-integrity-verification-storage-explorer-caching-and-multiple-improvements",
  },
  {
    slug: "vault-credential-profiles-extended",
    version: "v2.6.0",
    releaseDate: "2026-06-06",
    changelogAnchor:
      "v2-6-0-security-update-vault-credential-profiles-oauth-improvements-and-multiple-bug-fixes",
  },
  {
    slug: "database-explorer-version-history",
    version: "v2.5.0",
    releaseDate: "2026-05-31",
    changelogAnchor: "v2-5-0-version-history-general-improvements",
  },
  {
    slug: "database-explorer-drill-down",
    version: "v2.4.0",
    releaseDate: "2026-05-25",
    changelogAnchor: "v2-4-0-database-explorer-browser-drill-down-data-viewer-and-bug-fixes",
  },
  {
    slug: "templates-system",
    version: "v2.2.0",
    releaseDate: "2026-05-07",
    changelogAnchor: "v2-2-0-templates-system-docker-image-update-and-bug-fixes",
  },
  {
    slug: "100-github-stars",
    releaseDate: "2026-05-04",
    link: `https://github.com/${GITHUB_REPO}/stargazers`,
    stars: 100,
  },
  {
    slug: "credential-profile-system",
    version: "v2.0.0",
    releaseDate: "2026-05-03",
    changelogAnchor: "v2-0-0-credential-profiles-naming-template-cloning-and-major-refactor",
  },
  {
    slug: "live-history-redesign",
    version: "v1.4.0",
    releaseDate: "2026-03-31",
    changelogAnchor: "v1-4-0-live-history-redesign",
  },
  {
    slug: "ssh-remote-execution",
    version: "v1.3.0",
    releaseDate: "2026-03-29",
    changelogAnchor: "v1-3-0-ssh-remote-execution",
  },
  {
    slug: "https-by-default",
    version: "v1.2.0",
    releaseDate: "2026-03-25",
    changelogAnchor:
      "v1-2-0-https-by-default-certificate-management-per-adapter-health-notifications",
  },
  {
    slug: "first-stable-release",
    version: "v1.0.0",
    releaseDate: "2026-03-10",
    changelogAnchor: "v1-0-0-first-stable-release",
  },
];

export interface Milestone {
  slug: MilestoneSlug;
  target: number;
  liveSource?: "github-stars";
  fallbackCurrent: number;
}

export const MILESTONES: Milestone[] = [
  {
    slug: "500-github-stars",
    target: 500,
    liveSource: "github-stars",
    fallbackCurrent: 0,
  },
];

/** Where a shipped entry links to: its own link, its changelog section or the changelog. */
export function shippedHref(item: ShippedItem): string {
  if (item.link) return item.link;
  return item.changelogAnchor ? `${DOCS_URL}/changelog#${item.changelogAnchor}` : `${DOCS_URL}/changelog`;
}

export function issueHref(issueNumber: number): string {
  return `https://github.com/${GITHUB_REPO}/issues/${issueNumber}`;
}
