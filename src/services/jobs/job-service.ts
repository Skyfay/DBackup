import prisma from "@/lib/prisma";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { scheduler } from "@/lib/server/scheduler";
import { logger } from "@/lib/logging/logger";
import { ValidationError, wrapError } from "@/lib/logging/errors";
import { registry } from "@/lib/core/registry";
import { isCombinableWithDirectories } from "@/lib/adapters/combinable";
import { registerAdapters } from "@/lib/adapters";
import { runBulk, type BulkResult } from "@/lib/core/bulk";
import { invalidateDashboardCache } from "@/services/dashboard/cache";
import type { DatabaseAdapter } from "@/lib/core/interfaces";
import { keepInTrash } from "@/services/trash/trash-snapshot";
import type { DeleteOptions } from "@/services/trash/trash-types";
import { assertOwnRecords } from "@/lib/tenant/references";
import { currentTenantId } from "@/lib/tenant/current";
import { providedTo } from "@/services/sharing/provided";
import { TENANTS_FOLDER, isTenantsFolderName } from "@/lib/tenant/storage-view";

registerAdapters();

const log = logger.child({ service: "JobService" });

export interface DestinationInput {
    configId: string;
    priority: number;
    retention: string; // JSON RetentionConfiguration
    retentionPolicyId?: string | null;
}

export interface SourceInput {
    configId: string;
    priority: number;
    path: string;
    excludePatterns?: string[];
    excludePatternPresetIds?: string[];
    /**
     * Whether the adapter may stop whatever holds this source open while it is read.
     *
     * Undefined means yes, matching the column default. Only adapters that stop anything at
     * all consult it, so it is inert for every source type shipping today.
     */
    stopContainers?: boolean;
}

export interface CreateJobInput {
    name: string;
    schedule: string;
    sourceId?: string;
    databases?: string[];
    destinations: DestinationInput[];
    sources?: SourceInput[];
    notificationIds?: string[];
    notificationTemplateIds?: string[];
    encryptionProfileId?: string;
    compression?: string;
    pgCompression?: string;
    enabled?: boolean;
    notificationEvents?: string;
    namingTemplateId?: string | null;
    schedulePresetId?: string | null;
    skipVerification?: boolean;
    backupMode?: string;
    fullEveryDays?: number;
    verifyByHash?: boolean;
}

export interface UpdateJobInput {
    name?: string;
    schedule?: string;
    sourceId?: string;
    databases?: string[];
    destinations?: DestinationInput[];
    sources?: SourceInput[];
    notificationIds?: string[];
    notificationTemplateIds?: string[];
    encryptionProfileId?: string;
    compression?: string;
    pgCompression?: string;
    enabled?: boolean;
    notificationEvents?: string;
    namingTemplateId?: string | null;
    schedulePresetId?: string | null;
    skipVerification?: boolean;
    backupMode?: string;
    fullEveryDays?: number;
    verifyByHash?: boolean;
}

/**
 * A connection of a job as it may leave this service: which one it is, never its config. The jobs
 * reach the browser and API clients through the routes, and a config holds hosts, logins, keys and
 * webhook URLs, even in their encrypted form. The runner loads what it needs itself.
 */
const connection = { select: { id: true, name: true, type: true, adapterId: true } } as const;

const jobInclude = {
    source: connection,
    destinations: {
        include: { config: connection },
        orderBy: { priority: 'asc' as const }
    },
    sources: {
        include: { config: connection, excludePatternPresets: { select: { id: true } } },
        orderBy: { priority: 'asc' as const }
    },
    notifications: connection,
    notificationTemplates: {
        include: { template: { select: { id: true, name: true } } },
        orderBy: { priority: 'asc' as const }
    },
    encryptionProfile: { select: { id: true, name: true } },
    schedulePreset: { select: { id: true, name: true, schedule: true } },
    executions: {
        take: 1,
        orderBy: { startedAt: 'desc' as const },
        select: { startedAt: true, status: true }
    }
};

/**
 * JobSource.excludePatterns is stored as a JSON-encoded string column - parsed back into a real
 * string[] for every source before handing job data to API/UI consumers, mirroring the JSON.parse
 * already performed by the runner (src/lib/runner/steps/01-initialize.ts). excludePatternPresets
 * (the linked-preset relation, fully hydrated by jobInclude) is likewise flattened down to just the
 * id list the form actually needs.
 */
function parseSourceExcludePatterns<T extends { excludePatterns: string; excludePatternPresets: { id: string }[] }>(
    sources: T[]
): (Omit<T, "excludePatterns" | "excludePatternPresets"> & { excludePatterns: string[]; excludePatternPresetIds: string[] })[] {
    return sources.map(({ excludePatterns, excludePatternPresets, ...rest }) => {
        let parsed: string[] = [];
        try {
            const p = JSON.parse(excludePatterns);
            if (Array.isArray(p)) parsed = p.filter((v): v is string => typeof v === "string");
        } catch {
            // malformed/legacy data - fall back to no exclusions
        }
        return { ...rest, excludePatterns: parsed, excludePatternPresetIds: excludePatternPresets.map((p) => p.id) };
    });
}

export class JobService {
    async getJobs() {
        const jobs = await prisma.job.findMany({
            include: jobInclude,
            orderBy: { createdAt: 'desc' }
        });
        return jobs.map((job) => ({ ...job, sources: parseSourceExcludePatterns(job.sources) }));
    }

    async getJobById(id: string) {
        const job = await prisma.job.findUnique({
            where: { id },
            include: jobInclude
        });
        if (!job) return job;
        return { ...job, sources: parseSourceExcludePatterns(job.sources) };
    }

    /**
     * Resolves the effective (post-update) source state for validation. When sourceId/sources
     * aren't part of this call (undefined), falls back to the job's current stored state -
     * only fetched from the DB when actually needed (jobId set and a field is unspecified).
     */
    private async resolveEffectiveSourceState(jobId: string | null, sourceId: string | null | undefined, sources: SourceInput[] | undefined) {
        let effectiveSourceId = sourceId;
        let effectiveSourceCount = sources?.length;

        if (jobId && (effectiveSourceId === undefined || effectiveSourceCount === undefined)) {
            const current = await prisma.job.findUnique({
                where: { id: jobId },
                select: { sourceId: true, sources: { select: { id: true } } }
            });
            if (!current) {
                throw new Error(`Job with id "${jobId}" not found.`);
            }
            if (effectiveSourceId === undefined) effectiveSourceId = current.sourceId;
            if (effectiveSourceCount === undefined) effectiveSourceCount = current.sources.length;
        }

        return { effectiveSourceId: effectiveSourceId || null, effectiveSourceCount: effectiveSourceCount ?? 0 };
    }

    /**
     * Enforces the "a job needs at least one source" invariant and validates that:
     * - every directory source points at a storage adapter whose role is SOURCE
     * - a database source combined with directory sources is on the combinable list
     * This mirrors the destinations.length===0 guard already enforced at runner init time
     * (defense in depth), plus the source-role/combinability checks this feature introduces.
     */
    private async validateJobSources(jobId: string | null, sourceId: string | null | undefined, sources: SourceInput[] | undefined) {
        const { effectiveSourceId, effectiveSourceCount } = await this.resolveEffectiveSourceState(jobId, sourceId, sources);

        if (!effectiveSourceId && effectiveSourceCount === 0) {
            throw new Error("Job must have at least one source: a database source or one or more directory sources.");
        }

        if (sources && sources.length > 0) {
            const configIds = [...new Set(sources.map((s) => s.configId))];
            const configs = await prisma.adapterConfig.findMany({ where: { id: { in: configIds } } });
            for (const configId of configIds) {
                const config = configs.find((c) => c.id === configId);
                if (!config) {
                    throw new Error(`Directory source references unknown adapter "${configId}".`);
                }
                if (config.type !== "storage" || config.storageRole !== STORAGE_ROLES.SOURCE) {
                    throw new Error(`Adapter "${config.name}" is not a directory source.`);
                }
            }
        }

        if (effectiveSourceId && effectiveSourceCount > 0) {
            const sourceConfig = await prisma.adapterConfig.findUnique({ where: { id: effectiveSourceId } });
            if (!sourceConfig) {
                throw new Error(`Source adapter "${effectiveSourceId}" not found.`);
            }
            const adapter = registry.get(sourceConfig.adapterId) as DatabaseAdapter | undefined;
            if (!adapter?.dumpOne || !isCombinableWithDirectories(sourceConfig.adapterId)) {
                throw new Error(`Database adapter "${sourceConfig.adapterId}" does not support combined backups with directory sources.`);
            }
        }
    }

    /**
     * Refuses a link to a record of another tenant. Every connection is named here, the sources and
     * destinations too, so the check does not hang on which fields an update carries.
     */
    private async assertOwnReferences(input: CreateJobInput | UpdateJobInput, jobId?: string) {
        // A destination another tenant shares with this one is no record of its own, and fine to name.
        const shared = await this.providedDestinations((input.destinations ?? []).map((destination) => destination.configId));
        await assertOwnRecords(prisma, {
            job: jobId ? [jobId] : [],
            adapterConfig: [
                input.sourceId,
                ...(input.notificationIds ?? []),
                ...(input.destinations ?? []).map((destination) => destination.configId).filter((id) => !shared.has(id)),
                ...(input.sources ?? []).map((source) => source.configId),
            ],
            encryptionProfile: [input.encryptionProfileId],
            namingTemplate: [input.namingTemplateId],
            schedulePreset: [input.schedulePresetId],
            notificationTemplate: input.notificationTemplateIds ?? [],
            retentionPolicy: (input.destinations ?? []).map((destination) => destination.retentionPolicyId),
            excludePatternPreset: (input.sources ?? []).flatMap((source) => source.excludePatternPresetIds ?? []),
        });
    }

    /**
     * Rejects destinations that are not storage adapters in the DESTINATION role.
     *
     * The counterpart to the directory-source check above, which existed on its own for a
     * while: without this, a directory source could be picked as a backup target and the
     * runner would write `<root>/<jobName>/` into the very tree the job reads from.
     */
    private async validateJobDestinations(destinations: DestinationInput[] | undefined) {
        if (!destinations || destinations.length === 0) return;

        const configIds = [...new Set(destinations.map((d) => d.configId))];
        const [configs, shared] = await Promise.all([
            prisma.adapterConfig.findMany({ where: { id: { in: configIds } } }),
            this.providedDestinations(configIds),
        ]);
        for (const configId of configIds) {
            const config = configs.find((c) => c.id === configId);
            if (!config) {
                if (shared.has(configId)) continue;
                throw new Error(`Destination references unknown adapter "${configId}".`);
            }
            if (config.type !== "storage" || config.storageRole !== STORAGE_ROLES.DESTINATION) {
                throw new Error(`Adapter "${config.name}" is not a backup destination.`);
            }
        }
    }

    /** The destinations among `configIds` that other tenants share with the tenant that runs now, with their terms. */
    private async providedDestinations(configIds: string[]): Promise<Map<string, { name: string; encryptedOnly: boolean }>> {
        const tenantId = await currentTenantId();
        if (!tenantId || configIds.length === 0) return new Map();
        const provided = await providedTo(tenantId, { kind: "destination", ids: configIds });
        return new Map(provided.map((connection) => [connection.id, { name: connection.name, encryptedOnly: connection.encryptedOnly }]));
    }

    /**
     * Refuses a job called like the folder a shared destination keeps for the customers, while it
     * writes to a destination this tenant shares. Its backups would land among theirs. An update
     * counts the name and the destinations it keeps too.
     */
    private async assertNotTenantsFolder(jobId: string | null, name: string | undefined, destinations: DestinationInput[] | undefined) {
        const kept = jobId && (name === undefined || destinations === undefined)
            ? await prisma.job.findUnique({ where: { id: jobId }, select: { name: true, destinations: { select: { configId: true } } } })
            : null;
        const finalName = name ?? kept?.name;
        if (!finalName || !isTenantsFolderName(finalName)) return;
        const configIds = (destinations ?? kept?.destinations ?? []).map((destination) => destination.configId);
        if (configIds.length === 0) return;
        const shared = await prisma.connectionShare.count({ where: { id: { in: configIds } } });
        if (shared > 0) throw new ValidationError(`A job writing to a destination this tenant shares cannot be called ${TENANTS_FOLDER}, that folder holds the backups of its customers.`);
    }

    /**
     * Refuses a job without a key that writes to a destination whose tenant takes only encrypted
     * backups from its customers. An update counts the destinations and the key it keeps too.
     */
    private async assertEncryptionAsked(jobId: string | null, destinations: DestinationInput[] | undefined, encryptionProfileId: string | undefined) {
        const kept = jobId && (destinations === undefined || encryptionProfileId === undefined)
            ? await prisma.job.findUnique({ where: { id: jobId }, select: { encryptionProfileId: true, destinations: { select: { configId: true } } } })
            : null;
        const configIds = (destinations ?? kept?.destinations ?? []).map((destination) => destination.configId);
        const key = encryptionProfileId === undefined ? kept?.encryptionProfileId ?? null : encryptionProfileId || null;
        if (key || configIds.length === 0) return;
        const asking = [...(await this.providedDestinations(configIds)).values()].find((destination) => destination.encryptedOnly);
        if (asking) throw new ValidationError(`${asking.name} takes only encrypted backups. Pick a key under Encryption.`);
    }

    async createJob(input: CreateJobInput) {
        const { name, schedule, sourceId, databases, destinations, sources, notificationIds, notificationTemplateIds, enabled, encryptionProfileId, compression, pgCompression, notificationEvents, skipVerification, backupMode, fullEveryDays, verifyByHash } = input;

        // Check name uniqueness
        const existingByName = await prisma.job.findFirst({ where: { name } });
        if (existingByName) {
            throw new Error(`A job with the name "${name}" already exists.`);
        }

        await this.validateJobSources(null, sourceId || null, sources);
        await this.validateJobDestinations(destinations);
        await this.assertOwnReferences(input);
        await this.assertEncryptionAsked(null, destinations, encryptionProfileId);
        await this.assertNotTenantsFolder(null, name, destinations);

        const newJob = await prisma.job.create({
            data: {
                name,
                schedule,
                sourceId: sourceId || null,
                databases: JSON.stringify(databases || []),
                enabled: enabled !== undefined ? enabled : true,
                encryptionProfileId: encryptionProfileId || null,
                namingTemplateId: input.namingTemplateId ?? null,
                schedulePresetId: input.schedulePresetId ?? null,
                compression: compression || "NONE",
                pgCompression: pgCompression ?? "",
                notificationEvents: notificationEvents || "ALWAYS",
                skipVerification: skipVerification ?? false,
                backupMode: backupMode ?? "FULL",
                fullEveryDays: fullEveryDays ?? 7,
                verifyByHash: verifyByHash ?? false,
                notifications: {
                    connect: notificationIds?.map((id) => ({ id })) || []
                },
                notificationTemplates: notificationTemplateIds?.length
                    ? {
                        create: notificationTemplateIds.map((templateId, i) => ({
                            templateId,
                            priority: i,
                        }))
                    }
                    : undefined,
                destinations: {
                    create: destinations.map((d) => ({
                        configId: d.configId,
                        priority: d.priority,
                        retention: d.retention || "{}",
                        retentionPolicyId: d.retentionPolicyId ?? null,
                    }))
                },
                sources: sources?.length
                    ? {
                        create: sources.map((s) => ({
                            configId: s.configId,
                            priority: s.priority,
                            path: s.path,
                            excludePatterns: JSON.stringify(s.excludePatterns || []),
                            ...(s.stopContainers !== undefined ? { stopContainers: s.stopContainers } : {}),
                            excludePatternPresets: {
                                connect: (s.excludePatternPresetIds || []).map((id) => ({ id })),
                            },
                        }))
                    }
                    : undefined
            },
            include: jobInclude
        });

        this.jobsChanged("createJob");

        return newJob;
    }

    async updateJob(id: string, input: UpdateJobInput) {
        const { name, schedule, sourceId, databases, destinations, sources, notificationIds, notificationTemplateIds, enabled, encryptionProfileId, compression, pgCompression, notificationEvents, namingTemplateId, skipVerification, backupMode, fullEveryDays, verifyByHash } = input;

        // Check name uniqueness (excluding current job)
        if (name) {
            const existingByName = await prisma.job.findFirst({ where: { name, id: { not: id } } });
            if (existingByName) {
                throw new Error(`A job with the name "${name}" already exists.`);
            }
        }

        if (sourceId !== undefined || sources !== undefined) {
            await this.validateJobSources(id, sourceId !== undefined ? (sourceId || null) : undefined, sources);
        }
        // Checked whenever they are given, an update may name its destinations alone.
        await this.validateJobDestinations(destinations);
        await this.assertOwnReferences(input, id);
        await this.assertEncryptionAsked(id, destinations, encryptionProfileId);
        await this.assertNotTenantsFolder(id, name, destinations);

        const updatedJob = await prisma.$transaction(async (tx) => {
            // Update destinations if provided
            if (destinations) {
                await tx.jobDestination.deleteMany({ where: { jobId: id } });
                await tx.jobDestination.createMany({
                    data: destinations.map((d) => ({
                        jobId: id,
                        configId: d.configId,
                        priority: d.priority,
                        retention: d.retention || "{}",
                        retentionPolicyId: d.retentionPolicyId ?? null,
                    }))
                });
            }

            // Update directory sources if provided.
            //
            // Matched on (configId, path) and updated in place rather than replaced.
            // A JobSource id is not an internal detail: it is the `src` key every archive
            // index uses to attribute files, and what the chain planner compares to decide
            // whether the source set changed. Deleting and recreating them - which the form
            // triggers on *every* save, because it always submits `sources` - would mint new
            // ids, force a full backup after any unrelated edit, and leave older backups
            // pointing at sources that no longer exist, breaking "restore to original
            // location" for them.
            if (sources) {
                const existing = await tx.jobSource.findMany({ where: { jobId: id } });
                const keyOf = (s: { configId: string; path: string }) => `${s.configId}\u0000${s.path}`;
                const byKey = new Map(existing.map((row) => [keyOf(row), row]));
                const wanted = new Set(sources.map(keyOf));

                // Rows the user removed. Genuinely gone, so their id going with them is correct.
                const removed = existing.filter((row) => !wanted.has(keyOf(row)));
                if (removed.length > 0) {
                    await tx.jobSource.deleteMany({ where: { id: { in: removed.map((r) => r.id) } } });
                }

                for (const s of sources) {
                    const match = byKey.get(keyOf(s));
                    const data = {
                        priority: s.priority,
                        excludePatterns: JSON.stringify(s.excludePatterns || []),
                        // Left untouched when the caller did not send it, so an older client
                        // or a partial update cannot silently reset the choice to the default.
                        ...(s.stopContainers !== undefined ? { stopContainers: s.stopContainers } : {}),
                        excludePatternPresets: {
                            set: (s.excludePatternPresetIds || []).map((presetId) => ({ id: presetId })),
                        },
                    };
                    if (match) {
                        await tx.jobSource.update({ where: { id: match.id }, data });
                    } else {
                        await tx.jobSource.create({
                            data: {
                                jobId: id,
                                configId: s.configId,
                                path: s.path,
                                ...data,
                                excludePatternPresets: {
                                    connect: (s.excludePatternPresetIds || []).map((presetId) => ({ id: presetId })),
                                },
                            }
                        });
                    }
                }
            }

            // Update notification templates if provided
            if (notificationTemplateIds !== undefined) {
                await tx.jobNotificationTemplate.deleteMany({ where: { jobId: id } });
                if (notificationTemplateIds.length > 0) {
                    await tx.jobNotificationTemplate.createMany({
                        data: notificationTemplateIds.map((templateId, i) => ({
                            jobId: id,
                            templateId,
                            priority: i,
                        }))
                    });
                }
            }

            return tx.job.update({
                where: { id },
                data: {
                    name,
                    schedule,
                    enabled,
                    sourceId: sourceId !== undefined ? (sourceId || null) : undefined,
                    databases: databases !== undefined ? JSON.stringify(databases) : undefined,
                    compression,
                    pgCompression,
                    notificationEvents,
                    namingTemplateId: namingTemplateId !== undefined ? (namingTemplateId ?? null) : undefined,
                    schedulePresetId: input.schedulePresetId !== undefined ? (input.schedulePresetId ?? null) : undefined,
                    encryptionProfileId: encryptionProfileId === "" ? null : encryptionProfileId,
                    skipVerification: skipVerification !== undefined ? skipVerification : undefined,
                    backupMode: backupMode !== undefined ? backupMode : undefined,
                    fullEveryDays: fullEveryDays !== undefined ? fullEveryDays : undefined,
                    verifyByHash: verifyByHash !== undefined ? verifyByHash : undefined,
                    // Replaced only when the update names them, so a partial update keeps the channels.
                    notifications: notificationIds !== undefined
                        ? { set: [], connect: notificationIds.map((channelId) => ({ id: channelId })) }
                        : undefined,
                },
                include: jobInclude
            });
        });

        this.jobsChanged("updateJob");

        return updatedJob;
    }

    /** Deletes a job, which waits in Recently deleted unless `permanently`. Its runs stay in History. */
    async deleteJob(id: string, options: DeleteOptions = {}) {
        const deletedJob = await prisma.$transaction(async (tx) => {
            if (!options.permanently) await keepInTrash(tx, "job", id, options.by);
            return tx.job.delete({ where: { id } });
        });

        this.jobsChanged("deleteJob");

        return deletedJob;
    }

    /**
     * Deletes several jobs, reporting per-job outcomes instead of aborting on the first failure.
     *
     * The scheduler is refreshed once at the end rather than per job. It re-reads every
     * job on each call, so refreshing inside the loop would repeat the identical full
     * rebuild N times to reach the same state.
     */
    async deleteJobs(ids: string[], options: DeleteOptions = {}): Promise<BulkResult> {
        const names = await this.jobNamesById(ids);

        const result = await runBulk(
            ids,
            async (id) => {
                await prisma.$transaction(async (tx) => {
                    if (!options.permanently) await keepInTrash(tx, "job", id, options.by);
                    await tx.job.delete({ where: { id } });
                });
            },
            (id) => names.get(id)
        );

        if (result.succeeded.length > 0) {
            this.jobsChanged("deleteJobs");
        }

        return result;
    }

    /**
     * Enables or pauses several jobs.
     *
     * Absolute rather than a toggle: flipping each job in a mixed selection would only
     * re-scramble it, so the caller states the target state it wants.
     */
    async setJobsEnabled(ids: string[], enabled: boolean): Promise<BulkResult> {
        const names = await this.jobNamesById(ids);

        const result = await runBulk(
            ids,
            async (id) => { await prisma.job.update({ where: { id }, data: { enabled } }); },
            (id) => names.get(id)
        );

        if (result.succeeded.length > 0) {
            scheduler.refresh().catch((e) => log.error("Scheduler refresh failed after setJobsEnabled", {}, wrapError(e)));
        }

        return result;
    }

    /** Names for the failure list, read up front because a deleted job cannot be named after. */
    private async jobNamesById(ids: string[]): Promise<Map<string, string>> {
        const jobs = await prisma.job.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
        });
        return new Map(jobs.map((job) => [job.id, job.name]));
    }

    async cloneJob(id: string, name?: string) {
        const original = await prisma.job.findUnique({
            where: { id },
            include: {
                destinations: true,
                sources: { include: { excludePatternPresets: { select: { id: true } } } },
                notifications: true,
                notificationTemplates: { orderBy: { priority: 'asc' as const } },
            }
        });

        if (!original) {
            throw new Error(`Job with id "${id}" not found.`);
        }

        // The copy links what the original links, read through relations the tenant filter leaves
        // alone. A link to a record of another tenant is refused rather than copied.
        const shared = await this.providedDestinations(original.destinations.map((destination) => destination.configId));
        await assertOwnRecords(prisma, {
            adapterConfig: [
                original.sourceId,
                ...original.notifications.map((channel) => channel.id),
                ...original.destinations.map((destination) => destination.configId).filter((id) => !shared.has(id)),
                ...original.sources.map((source) => source.configId),
            ],
            encryptionProfile: [original.encryptionProfileId],
            namingTemplate: [original.namingTemplateId],
            schedulePreset: [original.schedulePresetId],
            notificationTemplate: original.notificationTemplates.map((template) => template.templateId),
            retentionPolicy: original.destinations.map((destination) => destination.retentionPolicyId),
            excludePatternPreset: original.sources.flatMap((source) => source.excludePatternPresets.map((preset) => preset.id)),
        });

        // The terms of a shared destination may have changed since the original was saved, so the
        // copy passes the checks of a new job: a key where only encrypted backups are taken.
        await this.assertEncryptionAsked(null, original.destinations, original.encryptionProfileId ?? "");

        // Use provided name or generate a unique one: "X (Copy)", then "X (Copy 2)", etc.
        let uniqueName: string;
        if (name) {
            uniqueName = name;
        } else {
            const baseName = `${original.name} (Copy)`;
            uniqueName = baseName;
            let counter = 2;
            while (await prisma.job.findFirst({ where: { name: uniqueName } })) {
                uniqueName = `${original.name} (Copy ${counter})`;
                counter++;
            }
        }
        await this.assertNotTenantsFolder(null, uniqueName, original.destinations);

        // The copy has every setting of the original and only starts paused, so it does not run
        // beside it before it is checked. Its incremental chain starts over, since chains are kept
        // per job.
        const clonedJob = await prisma.job.create({
            data: {
                name: uniqueName,
                schedule: original.schedule,
                sourceId: original.sourceId,
                databases: original.databases,
                enabled: false,
                encryptionProfileId: original.encryptionProfileId ?? null,
                compression: original.compression,
                pgCompression: original.pgCompression,
                notificationEvents: original.notificationEvents,
                schedulePresetId: original.schedulePresetId ?? null,
                namingTemplateId: original.namingTemplateId ?? null,
                skipVerification: original.skipVerification,
                backupMode: original.backupMode,
                fullEveryDays: original.fullEveryDays,
                verifyByHash: original.verifyByHash,
                notifications: {
                    connect: original.notifications.map((n) => ({ id: n.id }))
                },
                notificationTemplates: (original.notificationTemplates?.length ?? 0) > 0
                    ? {
                        create: original.notificationTemplates.map((nt) => ({
                            templateId: nt.templateId,
                            priority: nt.priority,
                        }))
                    }
                    : undefined,
                destinations: {
                    create: original.destinations.map((d) => ({
                        configId: d.configId,
                        priority: d.priority,
                        retention: d.retention,
                        retentionPolicyId: d.retentionPolicyId ?? null,
                    }))
                },
                sources: original.sources.length
                    ? {
                        create: original.sources.map((s) => ({
                            configId: s.configId,
                            priority: s.priority,
                            path: s.path,
                            excludePatterns: s.excludePatterns,
                            stopContainers: s.stopContainers,
                            useStagingCache: s.useStagingCache,
                            excludePatternPresets: {
                                connect: s.excludePatternPresets.map((p) => ({ id: p.id })),
                            },
                        }))
                    }
                    : undefined
            },
            include: jobInclude
        });

        this.jobsChanged("cloneJob");

        return clonedJob;
    }

    /**
     * Reloads the schedule after jobs were added, changed or removed. It also drops the cached
     * connection overview, whose count of jobs per connection decides which connections the
     * Connections page lets you delete.
     */
    private jobsChanged(action: string) {
        scheduler.refresh().catch((e) => log.error(`Scheduler refresh failed after ${action}`, {}, wrapError(e)));
        invalidateDashboardCache();
    }
}

export const jobService = new JobService();
