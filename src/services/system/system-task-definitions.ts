/**
 * The system tasks DBackup runs by itself, with their defaults and the words the Settings page
 * gives them. Kept apart from the service, so the page and the audit log read them without
 * pulling in every adapter.
 */

export const SYSTEM_TASKS = {
    UPDATE_DB_VERSIONS: "system.update_db_versions",
    HEALTH_CHECK: "system.health_check",
    CLEAN_OLD_LOGS: "system.clean_audit_logs",
    CHECK_FOR_UPDATES: "system.check_for_updates",
    SYNC_PERMISSIONS: "system.sync_permissions",
    CONFIG_BACKUP: "system.config_backup",
    INTEGRITY_CHECK: "system.integrity_check",
    REFRESH_STORAGE_STATS: "system.refresh_storage_stats",
    WARMUP_STORAGE_CACHE: "system.warmup_storage_cache",
    STUCK_EXECUTION_CHECK: "system.stuck_execution_check",
    OPTIMIZE_DATABASE: "system.optimize_database",
} as const;

export type SystemTaskId = (typeof SYSTEM_TASKS)[keyof typeof SYSTEM_TASKS];

/** A setting of another part of the Settings page that switches a task on and off. */
export interface TaskFollows {
    /** The part of the Settings page that holds the setting. */
    part: "general" | "config-backup";
    /** The setting as that part names it. */
    setting: string;
}

export interface SystemTaskDefinition {
    interval: string;
    runOnStartup: boolean;
    enabled: boolean;
    label: string;
    description: string;
    follows?: TaskFollows;
}

export const DEFAULT_TASK_CONFIG: Record<SystemTaskId, SystemTaskDefinition> = {
    [SYSTEM_TASKS.HEALTH_CHECK]: {
        interval: "*/1 * * * *",
        runOnStartup: false,
        enabled: true,
        label: "Health checks",
        description: "Pings every source and destination for its state and response time.",
    },
    [SYSTEM_TASKS.STUCK_EXECUTION_CHECK]: {
        interval: "*/5 * * * *",
        runOnStartup: false,
        enabled: true,
        label: "Stuck run watchdog",
        description: "Fails a backup or restore that stopped reporting, after the time set under General.",
        follows: { part: "general", setting: "Fail a run that stops reporting after" },
    },
    [SYSTEM_TASKS.UPDATE_DB_VERSIONS]: {
        interval: "0 * * * *",
        runOnStartup: true,
        enabled: true,
        label: "Database versions",
        description: "Reads the version and the databases of every source for the Database Explorer.",
    },
    [SYSTEM_TASKS.REFRESH_STORAGE_STATS]: {
        interval: "0 * * * *",
        runOnStartup: true,
        enabled: true,
        label: "Storage statistics",
        description: "Counts the files and sizes of every destination for the dashboard. It also runs after each backup.",
    },
    [SYSTEM_TASKS.WARMUP_STORAGE_CACHE]: {
        interval: "0 * * * *",
        runOnStartup: true,
        enabled: true,
        label: "Backups page cache",
        description: "Keeps the lists of the Backups page in step with the destinations.",
    },
    [SYSTEM_TASKS.CLEAN_OLD_LOGS]: {
        interval: "0 0 * * *",
        runOnStartup: true,
        enabled: true,
        label: "Clean old data",
        description: "Removes records past their retention under Data retention. Backup files stay.",
    },
    [SYSTEM_TASKS.CHECK_FOR_UPDATES]: {
        interval: "0 0 * * *",
        runOnStartup: true,
        enabled: true,
        label: "Check for updates",
        description: "Asks GitHub for the newest release and reports a new version.",
        follows: { part: "general", setting: "Look for new versions" },
    },
    [SYSTEM_TASKS.SYNC_PERMISSIONS]: {
        interval: "0 0 * * *",
        runOnStartup: true,
        enabled: true,
        label: "SuperAdmin permissions",
        description: "Gives the SuperAdmin group every permission there is.",
    },
    [SYSTEM_TASKS.CONFIG_BACKUP]: {
        interval: "0 3 * * *",
        runOnStartup: false,
        // Off until someone picks a destination for it.
        enabled: false,
        label: "Configuration backup",
        description: "Backs up connections, jobs, users and settings to the destination of Configuration backup.",
        follows: { part: "config-backup", setting: "Back up the configuration" },
    },
    [SYSTEM_TASKS.INTEGRITY_CHECK]: {
        interval: "0 4 * * 0",
        runOnStartup: false,
        // Off by default, it downloads every backup it checks.
        enabled: false,
        label: "Integrity check",
        description: "Downloads backups and compares their SHA-256 with the one saved at the backup.",
    },
    [SYSTEM_TASKS.OPTIMIZE_DATABASE]: {
        // The first of the month, after Clean old data freed the space and the configuration backup.
        interval: "0 5 1 * *",
        runOnStartup: false,
        enabled: true,
        label: "Optimize the database",
        description: "Rebuilds the database of DBackup without its unused space once a fifth of it is unused. Runs that start meanwhile wait until it is done.",
    },
};

/** The order of the Settings page: what runs often first, the heavy ones last. */
export const TASK_ORDER: readonly SystemTaskId[] = [
    SYSTEM_TASKS.HEALTH_CHECK,
    SYSTEM_TASKS.STUCK_EXECUTION_CHECK,
    SYSTEM_TASKS.UPDATE_DB_VERSIONS,
    SYSTEM_TASKS.REFRESH_STORAGE_STATS,
    SYSTEM_TASKS.WARMUP_STORAGE_CACHE,
    SYSTEM_TASKS.CLEAN_OLD_LOGS,
    SYSTEM_TASKS.CHECK_FOR_UPDATES,
    SYSTEM_TASKS.SYNC_PERMISSIONS,
    SYSTEM_TASKS.CONFIG_BACKUP,
    SYSTEM_TASKS.INTEGRITY_CHECK,
    SYSTEM_TASKS.OPTIMIZE_DATABASE,
];

export function isSystemTaskId(value: unknown): value is SystemTaskId {
    return typeof value === "string" && value in DEFAULT_TASK_CONFIG;
}
