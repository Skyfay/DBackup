import type { MessageKey } from "@/i18n/translate";

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
  /** The name of the product, the same in every language. */
  label: string;
  /** A name that is not a product and reads differently in every language. */
  labelKey?: MessageKey;
  beta?: true;
  /** A storage adapter that files are read from but backups are never written to. */
  sourceOnly?: true;
}

/** The name of an adapter in the language of the page. */
export function adapterName(item: AdapterItem, t: (key: MessageKey) => string): string {
  return item.labelKey ? t(item.labelKey) : item.label;
}

/** The name of an adapter with "(Beta)" behind it while it is in beta. */
export function adapterLabel(item: AdapterItem, t: (key: MessageKey) => string): string {
  return item.beta ? `${adapterName(item, t)} (${t("adapters.beta")})` : adapterName(item, t);
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
  { id: "azure-sql", label: "Azure SQL Database", beta: true },
  { id: "firebird", label: "Firebird", beta: true },
];

export const STORAGE_ADAPTERS: AdapterItem[] = [
  { id: "local-filesystem", label: "Local Filesystem", labelKey: "adapters.localFilesystem" },
  { id: "s3-aws", label: "Amazon S3" },
  { id: "s3-generic", label: "S3 Compatible", labelKey: "adapters.s3Compatible" },
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
  { id: "docker-volume", label: "Docker Volumes", labelKey: "adapters.dockerVolumes", beta: true, sourceOnly: true },
];

/** The storage adapters a backup can be written to. */
export const DESTINATION_COUNT = STORAGE_ADAPTERS.filter((item) => !item.sourceOnly).length;

export const NOTIFICATION_CHANNELS: AdapterItem[] = [
  { id: "discord", label: "Discord" },
  { id: "slack", label: "Slack" },
  { id: "teams", label: "Microsoft Teams" },
  { id: "telegram", label: "Telegram" },
  { id: "gotify", label: "Gotify" },
  { id: "ntfy", label: "ntfy" },
  { id: "generic-webhook", label: "Webhook" },
  { id: "twilio-sms", label: "SMS (Twilio)" },
  { id: "email", label: "Email (SMTP)", labelKey: "adapters.email" },
];

/** The questions of the FAQ in order, shared by the section and the structured data of the home page. */
export const FAQ_KEYS: { q: MessageKey; a: MessageKey }[] = [
  { q: "faq.q1", a: "faq.a1" },
  { q: "faq.q2", a: "faq.a2" },
  { q: "faq.q3", a: "faq.a3" },
  { q: "faq.q4", a: "faq.a4" },
  { q: "faq.q5", a: "faq.a5" },
  { q: "faq.q6", a: "faq.a6" },
  { q: "faq.q7", a: "faq.a7" },
  { q: "faq.q8", a: "faq.a8" },
];
