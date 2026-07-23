import prisma from "@/lib/prisma";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { scheduler } from "@/lib/server/scheduler";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import type { DatabaseAdapter } from "@/lib/core/interfaces";

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

const jobInclude = {
    source: true,
    destinations: {
        include: { config: true },
        orderBy: { priority: 'asc' as const }
    },
    sources: {
        include: { config: true, excludePatternPresets: true },
        orderBy: { priority: 'asc' as const }
    },
    notifications: true,
    notificationTemplates: {
        include: {
            template: {
                include: { channels: { include: { config: true } } }
            }
        },
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
     * - a database source combined with directory sources actually supports combination (dumpOne)
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
            if (!adapter?.dumpOne) {
                throw new Error(`Database adapter "${sourceConfig.adapterId}" does not support combined backups with directory sources.`);
            }
        }
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
        const configs = await prisma.adapterConfig.findMany({ where: { id: { in: configIds } } });
        for (const configId of configIds) {
            const config = configs.find((c) => c.id === configId);
            if (!config) {
                throw new Error(`Destination references unknown adapter "${configId}".`);
            }
            if (config.type !== "storage" || config.storageRole !== STORAGE_ROLES.DESTINATION) {
                throw new Error(`Adapter "${config.name}" is not a backup destination.`);
            }
        }
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
                            excludePatternPresets: {
                                connect: (s.excludePatternPresetIds || []).map((id) => ({ id })),
                            },
                        }))
                    }
                    : undefined
            },
            include: jobInclude
        });

        scheduler.refresh().catch((e) => log.error("Scheduler refresh failed after createJob", {}, wrapError(e)));

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
            await this.validateJobDestinations(destinations);
        }

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

            // Update directory sources if provided. createMany() can't set the excludePatternPresets
            // m2m relation, so each source is created individually instead.
            if (sources) {
                await tx.jobSource.deleteMany({ where: { jobId: id } });
                await Promise.all(sources.map((s) =>
                    tx.jobSource.create({
                        data: {
                            jobId: id,
                            configId: s.configId,
                            priority: s.priority,
                            path: s.path,
                            excludePatterns: JSON.stringify(s.excludePatterns || []),
                            excludePatternPresets: {
                                connect: (s.excludePatternPresetIds || []).map((presetId) => ({ id: presetId })),
                            },
                        }
                    })
                ));
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
                    notifications: {
                        set: [],
                        connect: notificationIds?.map((id) => ({ id })) || []
                    }
                },
                include: jobInclude
            });
        });

        scheduler.refresh().catch((e) => log.error("Scheduler refresh failed after updateJob", {}, wrapError(e)));

        return updatedJob;
    }

    async deleteJob(id: string) {
        const deletedJob = await prisma.job.delete({
            where: { id },
        });

        scheduler.refresh().catch((e) => log.error("Scheduler refresh failed after deleteJob", {}, wrapError(e)));

        return deletedJob;
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
                        retention: d.retention
                    }))
                },
                sources: original.sources.length
                    ? {
                        create: original.sources.map((s) => ({
                            configId: s.configId,
                            priority: s.priority,
                            path: s.path,
                            excludePatterns: s.excludePatterns,
                            excludePatternPresets: {
                                connect: s.excludePatternPresets.map((p) => ({ id: p.id })),
                            },
                        }))
                    }
                    : undefined
            },
            include: jobInclude
        });

        scheduler.refresh().catch((e) => log.error("Scheduler refresh failed after cloneJob", {}, wrapError(e)));

        return clonedJob;
    }
}

export const jobService = new JobService();
