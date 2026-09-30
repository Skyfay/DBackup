/**
 * The model of the Settings page: every part read at once, so the navigation shows the state of
 * each and a part opens without loading.
 */

import prisma from "@/lib/prisma";
import { getAdapterOptions } from "@/lib/adapters/dto";
import { isEmailLoginDisabled } from "@/lib/auth/env-flags";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { getRateLimitConfig } from "@/lib/rate-limit/server";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getNotificationsModel } from "@/services/notifications/notification-settings-service";
import { getConfigBackupSettings } from "@/services/config/config-backup-settings";
import { getCertificateInfo } from "./certificate-service";
import { getDatabaseInfo } from "./database-service";
import { getDataRetentionOverview } from "./data-retention-service";
import { SYSTEM_TASKS } from "./system-task-definitions";
import { systemTaskService } from "./system-task-service";
import { getIntegritySettings, getSystemTaskRows } from "./system-task-settings";
import { getGeneralSettings, getPrivacySettings, getSignInSettings, passkeyIsLastWayIn } from "./system-settings-service";
import type { SettingsModel } from "./settings-types";

const log = logger.child({ service: "SettingsModel" });

/** Reads what a part needs without taking the page down when one of them fails. */
async function orNull<T>(what: string, read: () => Promise<T> | T): Promise<T | null> {
    try {
        return await read();
    } catch (error: unknown) {
        log.warn(`Failed to read ${what}`, {}, wrapError(error));
        return null;
    }
}

export async function getSettingsModel(viewer: { canManage: boolean; isSuperAdmin: boolean }): Promise<SettingsModel> {
    const general = await getGeneralSettings();
    const [signIn, lastWayIn, providers, privacy, retention, database, configBackup, storage, keys, configRun, rateLimits, certificate, tasks, integrity, notifications] =
        await Promise.all([
            getSignInSettings(),
            passkeyIsLastWayIn(),
            prisma.ssoProvider.findMany({ select: { name: true, adapterId: true, enabled: true }, orderBy: { name: "asc" } }),
            getPrivacySettings(),
            getDataRetentionOverview(),
            // Size figures come from the file system. A failure there should not take the whole page down.
            orNull("database info", getDatabaseInfo),
            getConfigBackupSettings(),
            getAdapterOptions("storage"),
            prisma.encryptionProfile.findMany({
                select: { id: true, name: true, description: true, _count: { select: { jobs: true } } },
                orderBy: { name: "asc" },
            }),
            systemTaskService.getTaskLastRun(SYSTEM_TASKS.CONFIG_BACKUP),
            getRateLimitConfig(),
            orNull("certificate info", getCertificateInfo),
            getSystemTaskRows(general.timezone),
            getIntegritySettings(),
            getNotificationsModel(),
        ]);

    return {
        ...viewer,
        general,
        signIn: { ...signIn, emailLoginDisabledByEnv: isEmailLoginDisabled(), providers, passkeyIsLastWayIn: lastWayIn },
        privacy,
        retention,
        database,
        configBackup: {
            settings: configBackup,
            // The config backup is written somewhere, so only destinations qualify.
            destinations: storage.filter((option) => option.storageRole === STORAGE_ROLES.DESTINATION),
            keys: keys.map((key) => ({ id: key.id, name: key.name, description: key.description, jobCount: key._count.jobs })),
            lastRun: configRun,
            running: systemTaskService.isRunning(SYSTEM_TASKS.CONFIG_BACKUP),
        },
        rateLimits,
        certificate,
        tasks,
        integrity,
        notifications,
    };
}
