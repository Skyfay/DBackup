export const TAGLINE =
  "Self-hosted database backup automation with encryption, compression, and smart retention.";

export const GITHUB_REPO = "Skyfay/DBackup";
export const DOCS_URL = "https://docs.dbackup.app";
export const API_DOCS_URL = "https://api.dbackup.app";
export const DISCORD_URL = "https://discord.com/invite/YvgPyky";
export const GETTING_STARTED_URL = `${DOCS_URL}/user-guide/getting-started`;

export const STATS = [
  { value: "8", label: "Database Engines" },
  { value: "13+", label: "Storage Adapters" },
  { value: "9", label: "Notification Channels" },
  { value: "GPL-3.0", label: "Open Source" },
];

export const FEATURES = [
  {
    emoji: "🗄️",
    title: "Database Backup",
    description:
      "8 database engines, selective per-database backup, multi-database jobs with a unified TAR format, AES-256-GCM encryption, GZIP/Brotli compression, and SSH remote execution.",
  },
  {
    emoji: "☁️",
    title: "Storage & Destinations",
    description:
      "13+ storage adapters, multi-destination jobs for redundancy, a Storage Explorer to browse and download backups, and alerts for usage spikes or missing backups.",
  },
  {
    emoji: "🔄",
    title: "Restore & Recovery",
    description:
      "One-click restore, database remapping, version compatibility checks, SHA-256/MD5 integrity verification, and a Recovery Kit for restoring without DBackup itself.",
  },
  {
    emoji: "📊",
    title: "Monitoring & Visibility",
    description:
      "Live progress tracking, an interactive dashboard, a GitHub-style backup calendar, a Database Explorer, and full execution history.",
  },
  {
    emoji: "🔔",
    title: "Notifications",
    description:
      "9 notification channels, per-job notification settings, system event notifications, and configurable reminder intervals.",
  },
  {
    emoji: "⏰",
    title: "Scheduling & Retention",
    description:
      "Cron-based scheduling with a visual picker, reusable GFS retention policy templates, naming templates, and automated config backups.",
  },
  {
    emoji: "👥",
    title: "Access Control & Security",
    description:
      "SSO/OIDC, RBAC with granular permissions, 2FA and passkeys, a credential vault, and HTTPS by default.",
  },
  {
    emoji: "🔗",
    title: "API & Automation",
    description:
      "A full REST API, fine-grained API keys with expiration, and ready-made cURL, Bash, and Ansible examples.",
  },
  {
    emoji: "🎨",
    title: "Designed for Simplicity",
    description:
      "A clean, modern UI, a guided setup wizard, and deep configurability without getting in your way.",
  },
];

export const DATABASES = [
  "MySQL",
  "MariaDB",
  "PostgreSQL",
  "MongoDB",
  "SQLite",
  "Redis",
  "Valkey",
  "Microsoft SQL Server",
];

export const STORAGE_ADAPTERS = [
  "Local Filesystem",
  "Amazon S3",
  "S3 Compatible",
  "Cloudflare R2",
  "Hetzner Object Storage",
  "Google Drive",
  "Dropbox",
  "Microsoft OneDrive",
  "SFTP",
  "FTP/FTPS",
  "WebDAV",
  "SMB/Samba",
  "Rsync",
];

export const NOTIFICATION_CHANNELS = [
  "Discord",
  "Slack",
  "Microsoft Teams",
  "Telegram",
  "Gotify",
  "ntfy",
  "Webhook",
  "SMS (Twilio)",
  "Email (SMTP)",
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
