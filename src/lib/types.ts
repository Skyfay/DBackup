export type EngineType = "postgres" | "mysql" | "mongo" | "mariadb" | "sqlserver";

export type StorageLocationType = "s3" | "gcs" | "azure-blob" | "local";

export type NotificationChannelType = "email" | "discord" | "webhook";

export type BackupStatus = "healthy" | "warning" | "error" | "pending";

export interface StorageLocation {
  id: string;
  name: string;
  type: StorageLocationType;
  endpoint: string;
  bucket?: string;
  path?: string;
  region?: string;
  encryption: "aes256" | "none";
}

export interface NotificationChannel {
  id: string;
  type: NotificationChannelType;
  target: string;
  description?: string;
  enabled: boolean;
}

export interface BackupTarget {
  id: string;
  name: string;
  engine: EngineType;
  host: string;
  database: string;
  schedule: string;
  storageLocationId: string;
  notificationChannelIds: string[];
  lastRun: string | null;
  status: BackupStatus;
  retentionDays: number;
}

export interface BackupRun {
  id: string;
  backupTargetId: string;
  startedAt: string;
  finishedAt: string | null;
  status: BackupStatus;
  sizeMb: number | null;
  storageLocationId: string;
}

export interface BackupTargetInput {
  name: string;
  engine: EngineType;
  host: string;
  database: string;
  schedule: string;
  storageLocationId: string;
  notificationChannelIds: string[];
  retentionDays: number;
}

export interface StorageLocationInput {
  name: string;
  type: StorageLocationType;
  endpoint: string;
  bucket?: string;
  path?: string;
  region?: string;
  encryption: "aes256" | "none";
}

export interface NotificationChannelInput {
  type: NotificationChannelType;
  target: string;
  description?: string;
  enabled: boolean;
}
