/**
 * Adapter configuration lifecycle.
 *
 * The reason this exists as a service rather than living in the route: deleting a
 * connection has to refuse when something still points at it, and that check has four
 * separate sources. Every caller that deletes a connection needs the identical check, and
 * a safety check that gets copied is a safety check that drifts.
 */

import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/logging/errors";
import { runBulk, emptyBulkResult, type BulkResult } from "@/lib/core/bulk";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";

const log = logger.child({ service: "AdapterService" });

/**
 * Everything that currently points at an adapter config.
 *
 * All four are blocking. `JobSource.config` and `NotificationTemplateChannel.config` are
 * `onDelete: Restrict` in the schema, so deleting past them does not cascade, it throws a
 * raw Prisma foreign key error.
 */
export interface AdapterUsage {
    /** Jobs using it as their database source. */
    jobsAsSource: string[];
    /** Jobs writing backups to it. */
    jobsAsDestination: string[];
    /** Jobs pulling files from it as a directory source. */
    jobsAsDirectorySource: string[];
    /** Notification templates delivering through it. */
    notificationTemplates: string[];
}

const EMPTY_USAGE: AdapterUsage = {
    jobsAsSource: [],
    jobsAsDestination: [],
    jobsAsDirectorySource: [],
    notificationTemplates: [],
};

/**
 * Turns a usage record into the message shown to the user, or null when nothing
 * references the adapter and it is safe to delete.
 *
 * Pure on purpose so the wording stays under test without a database.
 */
export function describeAdapterUsage(usage: AdapterUsage): string | null {
    const parts: string[] = [];

    // Source and destination read as one group because both are "used in job X".
    const inJobs = [...new Set([...usage.jobsAsSource, ...usage.jobsAsDestination])];
    if (inJobs.length > 0) {
        parts.push(`used in the following jobs: ${inJobs.join(", ")}`);
    }
    if (usage.jobsAsDirectorySource.length > 0) {
        parts.push(`used as a directory source in: ${usage.jobsAsDirectorySource.join(", ")}`);
    }
    if (usage.notificationTemplates.length > 0) {
        parts.push(`used by the following notification templates: ${usage.notificationTemplates.join(", ")}`);
    }

    if (parts.length === 0) return null;
    return `Cannot delete. This adapter is ${parts.join(", and ")}.`;
}

/**
 * Resolves usage for several adapters at once.
 *
 * Four queries total rather than four per id, because a bulk delete otherwise fans out
 * into 4N round trips for no benefit.
 */
export async function getAdapterUsageMap(ids: string[]): Promise<Map<string, AdapterUsage>> {
    const usage = new Map<string, AdapterUsage>(
        ids.map((id) => [id, { jobsAsSource: [], jobsAsDestination: [], jobsAsDirectorySource: [], notificationTemplates: [] }])
    );
    if (ids.length === 0) return usage;

    const [asSource, asDestination, asDirectorySource, inTemplates] = await Promise.all([
        prisma.job.findMany({
            where: { sourceId: { in: ids } },
            select: { name: true, sourceId: true },
        }),
        prisma.jobDestination.findMany({
            where: { configId: { in: ids } },
            select: { configId: true, job: { select: { name: true } } },
        }),
        prisma.jobSource.findMany({
            where: { configId: { in: ids } },
            select: { configId: true, job: { select: { name: true } } },
        }),
        prisma.notificationTemplateChannel.findMany({
            where: { configId: { in: ids } },
            select: { configId: true, template: { select: { name: true } } },
        }),
    ]);

    for (const job of asSource) {
        if (job.sourceId) usage.get(job.sourceId)?.jobsAsSource.push(job.name);
    }
    for (const dest of asDestination) {
        usage.get(dest.configId)?.jobsAsDestination.push(dest.job.name);
    }
    for (const source of asDirectorySource) {
        usage.get(source.configId)?.jobsAsDirectorySource.push(source.job.name);
    }
    for (const channel of inTemplates) {
        usage.get(channel.configId)?.notificationTemplates.push(channel.template.name);
    }

    return usage;
}

/** Resolves everything currently pointing at a single adapter config. */
export async function getAdapterUsage(id: string): Promise<AdapterUsage> {
    const map = await getAdapterUsageMap([id]);
    return map.get(id) ?? { ...EMPTY_USAGE };
}

/**
 * Deletes an adapter config once nothing references it.
 *
 * Throws `ConflictError` carrying the user-facing reason when something still does, so
 * the caller can pass the message straight through rather than inventing its own. Same
 * shape as `credentialService.deleteCredentialProfile`, which refuses for the same reason.
 */
export async function deleteAdapter(id: string): Promise<{ name: string }> {
    const blocked = describeAdapterUsage(await getAdapterUsage(id));
    if (blocked) throw new ConflictError(blocked);

    // StorageSnapshot has no foreign key to AdapterConfig, so it needs clearing by hand.
    await prisma.storageSnapshot.deleteMany({ where: { adapterConfigId: id } });

    const deleted = await prisma.adapterConfig.delete({ where: { id } });
    log.info("Adapter deleted", { adapterId: id });
    return { name: deleted.name };
}

/**
 * Deletes several adapters, reporting per-adapter outcomes.
 *
 * Usage is resolved for the whole batch up front, so a connection that is still in use is
 * reported with the jobs that hold it instead of aborting the rest of the selection.
 */
export async function deleteAdapters(ids: string[]): Promise<BulkResult> {
    if (ids.length === 0) return emptyBulkResult();

    const [usageMap, adapters] = await Promise.all([
        getAdapterUsageMap(ids),
        prisma.adapterConfig.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    ]);
    const names = new Map(adapters.map((adapter) => [adapter.id, adapter.name]));

    return runBulk(
        ids,
        async (id) => {
            const blocked = describeAdapterUsage(usageMap.get(id) ?? { ...EMPTY_USAGE });
            if (blocked) throw new ConflictError(blocked);

            await prisma.storageSnapshot.deleteMany({ where: { adapterConfigId: id } });
            await prisma.adapterConfig.delete({ where: { id } });
        },
        (id) => names.get(id)
    );
}

/**
 * Settings kept in an adapter's metadata that can be switched for several adapters at once.
 * The edit form writes the same keys.
 */
export interface AdapterFlagChange {
    /** Silences offline and recovery alerts. The health checks themselves keep running. */
    healthNotificationsDisabled?: boolean;
    /** Keeps a database connection out of the restore targets. */
    isRestoreExcluded?: boolean;
}

/** Only these adapter types read each flag. Setting it on another type would do nothing. */
const FLAG_TYPES: Record<keyof AdapterFlagChange, { types: string[]; refusal: string }> = {
    healthNotificationsDisabled: {
        types: ["database", "storage"],
        refusal: "Notification channels have no health checks.",
    },
    isRestoreExcluded: {
        types: ["database"],
        refusal: "Only database connections are restore targets.",
    },
};

function parseMetadata(metadata: string | null): Record<string, unknown> {
    if (!metadata) return {};
    try {
        const value = JSON.parse(metadata);
        return value && typeof value === "object" ? value : {};
    } catch {
        return {};
    }
}

/**
 * Switches metadata settings on several adapters, reporting per-adapter outcomes. An adapter
 * whose type never reads a setting is refused with the reason instead of storing it silently.
 */
export async function updateAdapterFlags(ids: string[], change: AdapterFlagChange): Promise<BulkResult> {
    if (ids.length === 0) return emptyBulkResult();

    const adapters = await prisma.adapterConfig.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, type: true, metadata: true },
    });
    const byId = new Map(adapters.map((adapter) => [adapter.id, adapter]));
    const keys = Object.keys(change) as (keyof AdapterFlagChange)[];

    return runBulk(
        ids,
        async (id) => {
            const adapter = byId.get(id);
            if (!adapter) throw new NotFoundError("Connection", id);
            for (const key of keys) {
                if (!FLAG_TYPES[key].types.includes(adapter.type)) throw new ValidationError(FLAG_TYPES[key].refusal);
            }
            // The rest of the metadata, like the detected version, stays as it is.
            const metadata = { ...parseMetadata(adapter.metadata), ...change };
            await prisma.adapterConfig.update({ where: { id }, data: { metadata: JSON.stringify(metadata) } });
        },
        (id) => byId.get(id)?.name
    );
}

/** The distinct adapter types in a selection, so the caller can check one permission per type. */
export async function getAdapterTypes(ids: string[]): Promise<string[]> {
    const adapters = await prisma.adapterConfig.findMany({
        where: { id: { in: ids } },
        select: { type: true },
        distinct: ["type"],
    });
    return adapters.map((adapter) => adapter.type);
}

/** How many connections of each kind exist, for the counts beside the Connections tabs. */
export async function getConnectionCounts(): Promise<{ databases: number; sources: number; destinations: number; notifications: number }> {
    const groups = await prisma.adapterConfig.groupBy({
        by: ["type", "storageRole"],
        _count: { _all: true },
    });
    const count = (type: string, role?: string) =>
        groups
            .filter((group) => group.type === type && (!role || group.storageRole === role))
            .reduce((sum, group) => sum + group._count._all, 0);

    return {
        databases: count("database"),
        sources: count("storage", STORAGE_ROLES.SOURCE),
        destinations: count("storage", STORAGE_ROLES.DESTINATION),
        notifications: count("notification"),
    };
}
