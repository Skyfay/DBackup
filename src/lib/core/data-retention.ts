/**
 * Data Retention Settings
 *
 * How long DBackup keeps its own records before the daily "Clean Old Data" system task
 * removes them. One definition shared by the cleanup service, the settings action and the
 * settings card, so keys, defaults and allowed values cannot drift apart.
 *
 * None of this touches backup files on storage. Those follow the retention policy of each job.
 */

/** Stored instead of a number of days to keep records forever. */
export const RETENTION_NEVER = 0;

export type DataRetentionId =
    | "executionLogs"
    | "executionHistory"
    | "auditLog"
    | "notificationHistory"
    | "storageUsage"
    | "healthChecks";

export interface DataRetentionSetting {
    id: DataRetentionId;
    /** SystemSetting key. Existing keys predate this module and must not be renamed. */
    key: string;
    label: string;
    description: string;
    defaultDays: number;
    /** Offered values in days. `RETENTION_NEVER` keeps records forever. */
    choices: readonly number[];
}

/** How many runs per job survive execution history cleanup regardless of age. */
export const EXECUTION_HISTORY_KEEP_LATEST = 10;

export const DATA_RETENTION_SETTINGS: readonly DataRetentionSetting[] = [
    {
        id: "executionLogs",
        key: "execution.logRetentionDays",
        label: "Execution Logs",
        description: "Detailed step logs of backup, restore and system task runs. The run itself stays in History.",
        defaultDays: 90,
        choices: [7, 14, 30, 60, 90, 180, 365, 730, RETENTION_NEVER],
    },
    {
        id: "executionHistory",
        key: "execution.retentionDays",
        label: "Execution History",
        description: `Runs listed under History and counted in dashboard statistics. The newest ${EXECUTION_HISTORY_KEEP_LATEST} runs per job and every run of an active incremental chain are always kept.`,
        defaultDays: RETENTION_NEVER,
        choices: [30, 90, 180, 365, 730, 1095, 1825, RETENTION_NEVER],
    },
    {
        id: "auditLog",
        key: "audit.retentionDays",
        label: "Audit Log",
        description: "Record of user actions such as sign-ins and configuration changes.",
        defaultDays: 90,
        choices: [30, 60, 90, 180, 365, 730, 1095, 1825],
    },
    {
        id: "notificationHistory",
        key: "notification.logRetentionDays",
        label: "Notification History",
        description: "Notifications sent by DBackup, including their rendered content.",
        defaultDays: 90,
        choices: [7, 14, 30, 60, 90, 180, 365, 730, 1095, 1825],
    },
    {
        id: "storageUsage",
        key: "storage.snapshotRetentionDays",
        label: "Storage Usage History",
        description: "Hourly size measurements behind the storage charts and usage alerts. Backup files are not affected.",
        defaultDays: 90,
        choices: [7, 14, 30, 60, 90, 180, 365, 730, 1095, 1825],
    },
    {
        id: "healthChecks",
        key: "healthcheck.logRetentionDays",
        label: "Health Check History",
        description: "Connection checks against sources and destinations, recorded every minute.",
        defaultDays: 2,
        choices: [1, 2, 7, 14, 30],
    },
];

export function getDataRetentionSetting(id: string): DataRetentionSetting | undefined {
    return DATA_RETENTION_SETTINGS.find((s) => s.id === id);
}

/** "Never", "7 Days", "1 Year", "2 Years". */
export function formatRetentionDays(days: number): string {
    if (days === RETENTION_NEVER) return "Never";
    if (days % 365 === 0) {
        const years = days / 365;
        return `${years} Year${years === 1 ? "" : "s"}`;
    }
    return `${days} Day${days === 1 ? "" : "s"}`;
}

/**
 * Reads a stored value. Anything that is not a whole number of days, for example a value
 * edited by hand, falls back to the default rather than disabling or widening cleanup.
 */
export function parseRetentionDays(value: string | null | undefined, setting: DataRetentionSetting): number {
    if (value === null || value === undefined) return setting.defaultDays;
    const days = Number(value);
    return Number.isInteger(days) && days >= 0 ? days : setting.defaultDays;
}
