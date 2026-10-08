/** The title of the site in search results, with the words people search for. */
export const SITE_TITLE = "DBackup - Self-Hosted Database & File Backup Automation";

/** The description of the site in search results, at most about 160 characters. */
export const META_DESCRIPTION =
  "Self-hosted backup automation for MySQL, PostgreSQL, MongoDB, Redis, SQL Server and files, with AES-256-GCM encryption, compression and smart retention.";

export const TAGLINE =
  "Self-hosted backup automation for databases and files, with encryption, compression, and smart retention.";

export const GITHUB_REPO = "Skyfay/DBackup";
export const DOCS_URL = "https://docs.dbackup.app";
export const API_DOCS_URL = "https://api.dbackup.app";
export const DISCORD_URL = "https://discord.com/invite/YvgPyky";
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;
export const SPONSOR_URL = "https://github.com/sponsors/Skyfay";
export const CHANGELOG_URL = `${DOCS_URL}/changelog`;
export const ARCHIVE_FORMAT_URL = `${DOCS_URL}/developer-guide/reference/archive-format`;

export interface AdapterItem {
  id: string;
  label: string;
}

export const DATABASES: AdapterItem[] = [
  { id: "mysql", label: "MySQL" },
  { id: "mariadb", label: "MariaDB" },
  { id: "postgres", label: "PostgreSQL" },
  { id: "mongodb", label: "MongoDB" },
  { id: "sqlite", label: "SQLite" },
  { id: "redis", label: "Redis" },
  { id: "valkey", label: "Valkey" },
  { id: "mssql", label: "Microsoft SQL Server" },
  { id: "azure-sql", label: "Azure SQL Database (Beta)" },
  { id: "firebird", label: "Firebird (Beta)" },
];

export const STORAGE_ADAPTERS: AdapterItem[] = [
  { id: "local-filesystem", label: "Local Filesystem" },
  { id: "s3-aws", label: "Amazon S3" },
  { id: "s3-generic", label: "S3 Compatible" },
  { id: "s3-r2", label: "Cloudflare R2" },
  { id: "s3-hetzner", label: "Hetzner Object Storage" },
  { id: "google-drive", label: "Google Drive" },
  { id: "dropbox", label: "Dropbox" },
  { id: "onedrive", label: "Microsoft OneDrive" },
  { id: "sftp", label: "SFTP" },
  { id: "ftp", label: "FTP/FTPS" },
  { id: "webdav", label: "WebDAV" },
  { id: "smb", label: "SMB/Samba" },
  { id: "rsync", label: "Rsync" },
  { id: "docker-volume", label: "Docker Volumes (Beta)" },
];

export const NOTIFICATION_CHANNELS: AdapterItem[] = [
  { id: "discord", label: "Discord" },
  { id: "slack", label: "Slack" },
  { id: "teams", label: "Microsoft Teams" },
  { id: "telegram", label: "Telegram" },
  { id: "gotify", label: "Gotify" },
  { id: "ntfy", label: "ntfy" },
  { id: "generic-webhook", label: "Webhook" },
  { id: "twilio-sms", label: "SMS (Twilio)" },
  { id: "email", label: "Email (SMTP)" },
];

export const FAQS = [
  {
    question: "What happens if DBackup becomes unavailable - can I still restore?",
    answer:
      "Yes. Every backup is a standard database dump encrypted with open AES-256-GCM. With the key from your Recovery Kit and a standalone Node.js script, you can decrypt and restore without DBackup running at all.",
  },
  {
    question: "Which databases are supported?",
    answer:
      "MySQL, MariaDB, PostgreSQL, MongoDB, SQLite, Redis, Valkey, Microsoft SQL Server, Azure SQL Database (beta), and Firebird (beta), with more engines added regularly.",
  },
  {
    question: "Can DBackup back up files and folders, not just databases?",
    answer:
      "Yes. Any storage adapter can serve as a directory source - local paths, SFTP, SMB, FTP, WebDAV, S3, Google Drive, Dropbox, OneDrive, rsync over SSH, or Docker volumes read through the daemon. Files and databases can share one job, so the dump and the data directory that belongs to it land in the same archive and the same restore point. There is no agent to install: DBackup reads whatever those protocols reach. That agentless design is also its limit - a full run pulls the tree to the DBackup host and stages it there before packing, so it wants roughly twice the source size in free space and every byte crosses the network twice. It is built for the files that belong to the applications you already back up databases for, not for bulk media libraries; for those, restic or Borg run on the machine itself and are the better tool.",
  },
  {
    question: "Can DBackup back up Docker volumes?",
    answer:
      "Yes, currently in beta. Pick the volumes from a list of what the Docker daemon can see, locally through its socket or on another host over SSH, and DBackup mounts them into a short-lived helper container to read them. Containers holding a selected volume are stopped for the read and started again right afterwards, per volume rather than for the whole job, and you can switch that off for data that is safe to copy live. Restoring goes back into the same volume or into a new one, though directory permissions and empty directories are not carried back yet, which is what keeps it in beta.",
  },
  {
    question: "Does DBackup deduplicate like restic or Borg?",
    answer:
      "Not globally, and that is a deliberate trade. Incremental backups store whole changed files and reference unchanged ones in earlier archives of the same chain, so every archive stays a plain TAR you can open with tar -xf or a documented format one Node.js script reads. A chunk store would save more space but would make the backup a repository only its own tool can open - which is the lock-in DBackup exists to avoid.",
  },
  {
    question: "Is there a hosted or cloud version?",
    answer:
      "No. DBackup is self-hosted only, distributed as a single Docker image you run on your own infrastructure.",
  },
  {
    question: "What license is DBackup released under?",
    answer: "GPL-3.0. The source code is fully open and available on GitHub.",
  },
  {
    question: "Can I send one backup to multiple storage destinations?",
    answer:
      "Yes. Multi-destination jobs upload each backup to several storage adapters at once for redundancy or off-site copies.",
  },
];
