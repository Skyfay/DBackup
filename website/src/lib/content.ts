export const TAGLINE =
  "Self-hosted database backup automation with encryption, compression, and smart retention.";

export const GITHUB_REPO = "Skyfay/DBackup";
export const DOCS_URL = "https://docs.dbackup.app";
export const API_DOCS_URL = "https://api.dbackup.app";
export const DISCORD_URL = "https://discord.com/invite/YvgPyky";
export const GETTING_STARTED_URL = `${DOCS_URL}/user-guide/getting-started`;

export const STATS = [
  { value: "8", label: "Database Engines" },
  { value: "13", label: "Storage Adapters" },
  { value: "9", label: "Notification Channels" },
  { value: "GPL-3.0", label: "Open Source" },
];

export const FEATURES = [
  {
    title: "Database Backup",
    description:
      "8 database engines, selective per-database backup, multi-database jobs with a unified TAR format, AES-256-GCM encryption, GZIP/Brotli compression, and SSH remote execution.",
  },
  {
    title: "Storage & Destinations",
    description:
      "13 storage adapters, multi-destination jobs for redundancy, a Storage Explorer to browse and download backups, and alerts for usage spikes or missing backups.",
  },
  {
    title: "Restore & Recovery",
    description:
      "One-click restore, database remapping, version compatibility checks, SHA-256/MD5 integrity verification, and a Recovery Kit for restoring without DBackup itself.",
  },
  {
    title: "Monitoring & Visibility",
    description:
      "Live progress tracking, an interactive dashboard, a GitHub-style backup calendar, a Database Explorer, and full execution history.",
  },
  {
    title: "Notifications",
    description:
      "9 notification channels, per-job notification settings, system event notifications, and configurable reminder intervals.",
  },
  {
    title: "Scheduling & Retention",
    description:
      "Cron-based scheduling with a visual picker, reusable GFS retention policy templates, naming templates, and automated config backups.",
  },
  {
    title: "Access Control & Security",
    description:
      "SSO/OIDC, RBAC with granular permissions, 2FA and passkeys, a credential vault, and HTTPS by default.",
  },
  {
    title: "API & Automation",
    description:
      "A full REST API, fine-grained API keys with expiration, and ready-made cURL, Bash, and Ansible examples.",
  },
  {
    title: "Designed for Simplicity",
    description:
      "Configure almost everything from the UI instead of environment variables - a guided setup for beginners, deep configurability for power users.",
  },
];

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

export const QUICK_START_SNIPPET = `# docker-compose.yml
services:
  dbackup:
    image: skyfay/dbackup:latest
    container_name: dbackup
    restart: always
    ports:
      - "3000:3000"
    environment:
      - ENCRYPTION_KEY=       # openssl rand -hex 32
      - BETTER_AUTH_URL=https://localhost:3000
      - BETTER_AUTH_SECRET=   # openssl rand -base64 32
    volumes:
      - ./data:/data
      - ./backups:/backups`;

export const FAQS = [
  {
    question: "What happens if DBackup becomes unavailable - can I still restore?",
    answer:
      "Yes. Every backup is a standard database dump encrypted with open AES-256-GCM. With the key from your Recovery Kit and a standalone Node.js script, you can decrypt and restore without DBackup running at all.",
  },
  {
    question: "Which databases are supported?",
    answer:
      "MySQL, MariaDB, PostgreSQL, MongoDB, SQLite, Redis, Valkey, and Microsoft SQL Server, with more engines added regularly.",
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
