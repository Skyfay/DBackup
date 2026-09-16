/**
 * Data Retention Service
 *
 * Reads and updates the retention settings defined in `@/lib/core/data-retention` and runs the
 * cleanup behind the "Clean Old Data" system task.
 */

import prisma from "@/lib/prisma";
import {
    DATA_RETENTION_SETTINGS,
    DataRetentionId,
    RETENTION_NEVER,
    getDataRetentionSetting,
    parseRetentionDays,
} from "@/lib/core/data-retention";
import { ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { auditService } from "@/services/audit-service";
import { healthCheckService } from "@/services/system/healthcheck-service";
import { cleanOldNotificationLogs } from "@/services/notifications/notification-log-service";
import { deleteOldExecutions, purgeExecutionLogs } from "./execution-retention";

const log = logger.child({ service: "DataRetentionService" });

export type DataRetentionValues = Record<DataRetentionId, number>;

export interface DataRetentionOverview {
    values: DataRetentionValues;
    /** Records currently stored per setting, shown next to each option. */
    counts: Record<DataRetentionId, number>;
}

/** Cleaned-up records per setting. Null when that cleanup failed or is set to never. */
export type DataRetentionResult = Record<DataRetentionId, number | null>;

export async function getDataRetentionValues(): Promise<DataRetentionValues> {
    const rows = await prisma.systemSetting.findMany({
        where: { key: { in: DATA_RETENTION_SETTINGS.map((s) => s.key) } },
    });
    const stored = new Map(rows.map((row) => [row.key, row.value]));

    const values = {} as DataRetentionValues;
    for (const setting of DATA_RETENTION_SETTINGS) {
        values[setting.id] = parseRetentionDays(stored.get(setting.key), setting);
    }
    return values;
}

export async function getDataRetentionOverview(): Promise<DataRetentionOverview> {
    const values = await getDataRetentionValues();
    const [executionLogs, executionHistory, auditLog, notificationHistory, storageUsage, healthChecks] = await Promise.all([
        prisma.execution.count({ where: { logsPurgedAt: null } }),
        prisma.execution.count(),
        prisma.auditLog.count(),
        prisma.notificationLog.count(),
        prisma.storageSnapshot.count(),
        prisma.healthCheckLog.count(),
    ]);
    return {
        values,
        counts: { executionLogs, executionHistory, auditLog, notificationHistory, storageUsage, healthChecks },
    };
}

export async function updateDataRetentionSetting(id: string, days: number): Promise<void> {
    const setting = getDataRetentionSetting(id);
    if (!setting) {
        throw new ValidationError(`Unknown retention setting "${id}"`, { field: "id" });
    }
    if (!setting.choices.includes(days)) {
        throw new ValidationError(`${days} is not an allowed value for ${setting.label}`, { field: "days" });
    }

    await prisma.systemSetting.upsert({
        where: { key: setting.key },
        update: { value: String(days) },
        create: { key: setting.key, value: String(days), description: `Retention in days for ${setting.label}` },
    });
}

const CLEANUPS: Record<DataRetentionId, (days: number) => Promise<number>> = {
    // History runs before the log purge so rows about to be deleted are not rewritten first.
    executionHistory: (days) => deleteOldExecutions(days),
    executionLogs: (days) => purgeExecutionLogs(days),
    auditLog: async (days) => (await auditService.cleanOldLogs(days)).count,
    notificationHistory: (days) => cleanOldNotificationLogs(days),
    storageUsage: async (days) => {
        // Imported lazily, the dashboard service pulls in every storage adapter.
        const { cleanupOldSnapshots } = await import("@/services/dashboard-service");
        return cleanupOldSnapshots(days);
    },
    healthChecks: (days) => healthCheckService.cleanOldLogs(days),
};

/**
 * Applies every retention setting. A failing cleanup is logged and does not stop the others.
 */
export async function runDataRetention(): Promise<DataRetentionResult> {
    const values = await getDataRetentionValues();
    const result = {} as DataRetentionResult;

    for (const [id, cleanup] of Object.entries(CLEANUPS) as [DataRetentionId, (days: number) => Promise<number>][]) {
        const days = values[id];
        if (days === RETENTION_NEVER) {
            result[id] = null;
            continue;
        }
        try {
            const count = await cleanup(days);
            result[id] = count;
            if (count > 0) log.info("Data retention cleanup completed", { setting: id, retentionDays: days, deletedCount: count });
        } catch (error: unknown) {
            result[id] = null;
            log.error("Data retention cleanup failed", { setting: id, retentionDays: days }, wrapError(error));
        }
    }
    return result;
}
