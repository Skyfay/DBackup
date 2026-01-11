import { BackupTarget, NotificationChannel, StorageLocation } from "@/lib/types";

export const mockStorageLocations: StorageLocation[] = [
  {
    id: "store-s3-primary",
    name: "S3 Primary",
    type: "s3",
    endpoint: "s3.amazonaws.com",
    bucket: "backups-primary",
    region: "eu-central-1",
    encryption: "aes256",
  },
  {
    id: "store-gcs-archive",
    name: "GCS Archive",
    type: "gcs",
    endpoint: "storage.googleapis.com",
    bucket: "db-archive",
    region: "europe-west3",
    encryption: "aes256",
  },
  {
    id: "store-local",
    name: "Local NAS",
    type: "local",
    endpoint: "10.0.0.42:/mnt/nas/backups",
    path: "/mnt/nas/backups",
    encryption: "none",
  },
];

export const mockNotificationChannels: NotificationChannel[] = [
  {
    id: "notif-discord-core",
    type: "discord",
    target: "https://discord.com/api/webhooks/...",
    description: "#db-alerts",
    enabled: true,
  },
  {
    id: "notif-email-ops",
    type: "email",
    target: "ops@datacorp.io",
    description: "Operations on-call",
    enabled: true,
  },
  {
    id: "notif-webhook-statuspage",
    type: "webhook",
    target: "https://status.internal/api/hooks/backups",
    description: "Status page pings",
    enabled: false,
  },
];

export const mockBackupTargets: BackupTarget[] = [
  {
    id: "pg-orders",
    name: "Orders Postgres",
    engine: "postgres",
    host: "10.0.2.21:5432",
    database: "orders",
    schedule: "0 */6 * * *",
    storageLocationId: "store-s3-primary",
    notificationChannelIds: ["notif-discord-core", "notif-email-ops"],
    lastRun: "2026-01-11T09:05:00Z",
    status: "healthy",
    retentionDays: 14,
  },
  {
    id: "mysql-users",
    name: "Users MySQL",
    engine: "mysql",
    host: "10.0.2.33:3306",
    database: "users",
    schedule: "30 */12 * * *",
    storageLocationId: "store-gcs-archive",
    notificationChannelIds: ["notif-email-ops"],
    lastRun: "2026-01-11T07:15:00Z",
    status: "warning",
    retentionDays: 7,
  },
  {
    id: "mongo-events",
    name: "Events Mongo",
    engine: "mongo",
    host: "10.0.3.10:27017",
    database: "events",
    schedule: "15 */4 * * *",
    storageLocationId: "store-local",
    notificationChannelIds: ["notif-discord-core", "notif-webhook-statuspage"],
    lastRun: "2026-01-10T23:50:00Z",
    status: "error",
    retentionDays: 30,
  },
];
