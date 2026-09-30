/**
 * The settings of the configuration backup: where it goes, the key it is encrypted with, when it
 * runs and what it holds. The system task Configuration backup follows its switch and schedule.
 */

import prisma from "@/lib/prisma";
import { isValidCron } from "@/lib/core/cron";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { includesHistory } from "@/services/config/database-copy";
import { SYSTEM_TASKS } from "@/services/system/system-task-definitions";
import { systemTaskService } from "@/services/system/system-task-service";

const log = logger.child({ service: "ConfigBackupSettings" });

export interface ConfigBackupSettings {
    enabled: boolean;
    /** The destination, empty while none is picked. */
    storageId: string;
    /** The encryption key, empty for none. */
    profileId: string;
    schedule: string;
    /** Puts the runs, logs, audit log and storage history into the file. */
    includeStatistics: boolean;
    /** How many files stay at the destination. */
    retention: number;
}

export const MAX_CONFIG_BACKUPS_KEPT = 365;

const KEYS = {
    storageId: "config.backup.storageId",
    profileId: "config.backup.profileId",
    includeStatistics: "config.backup.includeStatistics",
    retention: "config.backup.retention",
} as const;

export async function getConfigBackupSettings(): Promise<ConfigBackupSettings> {
    const [rows, enabled, schedule] = await Promise.all([
        prisma.systemSetting.findMany({ where: { key: { in: Object.values(KEYS) } }, select: { key: true, value: true } }),
        systemTaskService.getTaskEnabled(SYSTEM_TASKS.CONFIG_BACKUP),
        systemTaskService.getTaskConfig(SYSTEM_TASKS.CONFIG_BACKUP),
    ]);
    const stored = new Map(rows.map((row) => [row.key, row.value]));
    const retention = Number.parseInt(stored.get(KEYS.retention) ?? "", 10);
    return {
        enabled,
        storageId: stored.get(KEYS.storageId) ?? "",
        profileId: stored.get(KEYS.profileId) ?? "",
        schedule: schedule ?? "0 3 * * *",
        includeStatistics: includesHistory(stored.get(KEYS.includeStatistics)),
        retention: Number.isFinite(retention) && retention >= 1 ? retention : 10,
    };
}

/** Why the settings cannot be saved as they are, or null when they can. */
async function problemOf(next: ConfigBackupSettings): Promise<{ field: keyof ConfigBackupSettings; message: string } | null> {
    if (next.enabled && !next.storageId) return { field: "storageId", message: "Pick a destination to back up the configuration." };
    if (next.enabled && !next.profileId) return { field: "profileId", message: "Pick an encryption key. The file holds every login, so it is always encrypted." };
    if (!isValidCron(next.schedule)) return { field: "schedule", message: "The scheduler cannot read this schedule." };
    if (next.storageId) {
        const destination = await prisma.adapterConfig.findUnique({ where: { id: next.storageId }, select: { type: true, storageRole: true } });
        if (destination?.type !== "storage" || destination.storageRole !== STORAGE_ROLES.DESTINATION) {
            return { field: "storageId", message: "The destination no longer exists." };
        }
    }
    if (next.profileId && !(await prisma.encryptionProfile.findUnique({ where: { id: next.profileId }, select: { id: true } }))) {
        return { field: "profileId", message: "The encryption key no longer exists." };
    }
    return null;
}

export async function saveConfigBackupSettings(next: ConfigBackupSettings): Promise<void> {
    const problem = await problemOf(next);
    if (problem) throw new ValidationError(problem.message, { field: problem.field });

    const upsert = (key: string, value: string) =>
        prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
    await prisma.$transaction([
        upsert(KEYS.storageId, next.storageId),
        upsert(KEYS.profileId, next.profileId),
        upsert(KEYS.includeStatistics, String(next.includeStatistics)),
        upsert(KEYS.retention, String(next.retention)),
    ]);
    // Through the task, whose switch and schedule are these two.
    await systemTaskService.setTaskConfig(SYSTEM_TASKS.CONFIG_BACKUP, next.schedule);
    await systemTaskService.setTaskEnabled(SYSTEM_TASKS.CONFIG_BACKUP, next.enabled);

    import("@/lib/server/scheduler")
        .then(({ scheduler }) => scheduler.refresh())
        .catch((e: unknown) => log.error("Scheduler refresh failed after the config backup settings changed", {}, wrapError(e)));
}
