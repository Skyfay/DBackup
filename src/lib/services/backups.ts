import { createId } from "@/lib/id";
import {
  BackupStatus,
  BackupTarget,
  BackupTargetInput,
  NotificationChannel,
  StorageLocation,
} from "@/lib/types";

export function createBackupTarget(
  current: BackupTarget[],
  input: BackupTargetInput
): { next: BackupTarget[]; created: BackupTarget } {
  const created: BackupTarget = {
    id: createId("backup"),
    ...input,
    status: "pending",
    lastRun: null,
  };

  return { next: [created, ...current], created };
}

export function updateBackupStatus(
  current: BackupTarget[],
  id: string,
  status: BackupStatus,
  lastRun: string | null = null
): BackupTarget[] {
  return current.map((backup) =>
    backup.id === id
      ? {
          ...backup,
          status,
          lastRun: lastRun ?? backup.lastRun,
        }
      : backup
  );
}

export function runBackupOnce(
  current: BackupTarget[],
  id: string,
  storageLocations: StorageLocation[],
  notificationChannels: NotificationChannel[]
): { next: BackupTarget[]; message: string } {
  const backup = current.find((item) => item.id === id);
  if (!backup) {
    return { next: current, message: "Backup target not found." };
  }

  const storage = storageLocations.find(
    (store) => store.id === backup.storageLocationId
  );
  const notifiers = notificationChannels.filter((channel) =>
    backup.notificationChannelIds.includes(channel.id)
  );

  const finishedAt = new Date().toISOString();
  const updated = updateBackupStatus(current, id, "healthy", finishedAt);

  const notificationSummary = notifiers.length
    ? `Notifications: ${notifiers
        .map((n) => `${n.type}→${n.target}`)
        .join(", ")}`
    : "Notifications: none";

  return {
    next: updated,
    message: `Backup ${backup.name} stored on ${storage?.name ?? "unknown"}. ${notificationSummary}`,
  };
}

export function backupHealthSnapshot(backups: BackupTarget[]) {
  const total = backups.length;
  const healthy = backups.filter((b) => b.status === "healthy").length;
  const warning = backups.filter((b) => b.status === "warning").length;
  const error = backups.filter((b) => b.status === "error").length;
  const pending = backups.filter((b) => b.status === "pending").length;

  return { total, healthy, warning, error, pending };
}
