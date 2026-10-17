/**
 * Changes to the alerts of destinations, from the Edit alerts dialog and the bulk dialog of the
 * Storage Explorer. The alerts are stored with the settings of the instance, but each set belongs to
 * a destination of one tenant, which is read through the filtered client before anything is saved.
 */

import prisma from "@/lib/prisma";
import { runBulk, type BulkResult } from "@/lib/core/bulk";
import { NotFoundError } from "@/lib/logging/errors";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { getAlertConfig, saveAlertConfig, type StorageAlertConfig } from "./storage-alert-service";

/**
 * Saves the alerts of one destination and returns its name and the alerts it had before. An id that
 * is no destination of the tenant throws `NotFoundError`, a destination of another tenant included,
 * so nobody gives alerts to a destination they cannot see.
 */
export async function saveDestinationAlerts(configId: string, config: StorageAlertConfig): Promise<{ name: string; before: StorageAlertConfig }> {
    const destination = await prisma.adapterConfig.findFirst({ where: { id: configId, type: "storage", storageRole: STORAGE_ROLES.DESTINATION }, select: { name: true } });
    if (!destination) throw new NotFoundError("Destination", configId);
    const before = await getAlertConfig(configId);
    await saveAlertConfig(configId, config);
    return { name: destination.name, before };
}

/** An alert turned off, or on with its value. An alert left out stays as it is. */
export interface AlertChanges {
    usageSpike?: { enabled: boolean; percent?: number };
    storageLimit?: { enabled: boolean; bytes?: number };
    missingBackup?: { enabled: boolean; hours?: number };
}

/** The alerts of one destination with the changes applied. An alert turned off keeps its value for when it is turned on again. */
export function withAlertChanges(config: StorageAlertConfig, changes: AlertChanges): StorageAlertConfig {
    const next = { ...config };
    if (changes.usageSpike) {
        next.usageSpikeEnabled = changes.usageSpike.enabled;
        if (changes.usageSpike.percent !== undefined) next.usageSpikeThresholdPercent = changes.usageSpike.percent;
    }
    if (changes.storageLimit) {
        next.storageLimitEnabled = changes.storageLimit.enabled;
        if (changes.storageLimit.bytes !== undefined) next.storageLimitBytes = changes.storageLimit.bytes;
    }
    if (changes.missingBackup) {
        next.missingBackupEnabled = changes.missingBackup.enabled;
        if (changes.missingBackup.hours !== undefined) next.missingBackupHours = changes.missingBackup.hours;
    }
    return next;
}

/**
 * Applies the changes to every destination on its own, so one that fails leaves the others saved.
 * An id that is no destination of the tenant is turned down rather than given settings of its own.
 */
export async function applyAlertChanges(configIds: string[], changes: AlertChanges): Promise<BulkResult> {
    const known = await prisma.adapterConfig.findMany({ where: { id: { in: configIds }, type: "storage", storageRole: STORAGE_ROLES.DESTINATION }, select: { id: true, name: true } });
    const names = new Map(known.map((config) => [config.id, config.name]));
    return runBulk(
        configIds,
        async (id) => {
            if (!names.has(id)) throw new Error("This destination does not exist anymore");
            await saveAlertConfig(id, withAlertChanges(await getAlertConfig(id), changes));
        },
        (id) => names.get(id),
    );
}
