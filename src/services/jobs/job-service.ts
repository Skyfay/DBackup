import prisma from "@/lib/prisma";
import { scheduler } from "@/lib/server/scheduler";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ service: "JobService" });

export interface DestinationInput {
    configId: string;
    priority: number;
    retention: string; // JSON RetentionConfiguration
    retentionPolicyId?: string | null;
}

export interface CreateJobInput {
    name: string;
    schedule: string;
    sourceId: string;
    databases?: string[];
    destinations: DestinationInput[];
    notificationIds?: string[];
    encryptionProfileId?: string;
    compression?: string;
    pgCompression?: string;
    enabled?: boolean;
    notificationEvents?: string;
    namingTemplateId?: string | null;
    schedulePresetId?: string | null;
}

export interface UpdateJobInput {
    name?: string;
    schedule?: string;
    sourceId?: string;
    databases?: string[];
    destinations?: DestinationInput[];
    notificationIds?: string[];
    encryptionProfileId?: string;
    compression?: string;
    pgCompression?: string;
    enabled?: boolean;
    notificationEvents?: string;
    namingTemplateId?: string | null;
    schedulePresetId?: string | null;
}

const jobInclude = {
    source: true,
    destinations: {
        include: { config: true },
        orderBy: { priority: 'asc' as const }
    },
    notifications: true,
    encryptionProfile: { select: { id: true, name: true } },
    schedulePreset: { select: { id: true, name: true, schedule: true } },
    executions: {
        take: 1,
        orderBy: { startedAt: 'desc' as const },
        select: { startedAt: true, status: true }
    }
};

export class JobService {
    async getJobs() {
        return prisma.job.findMany({
            include: jobInclude,
            orderBy: { createdAt: 'desc' }
        });
    }

    async getJobById(id: string) {
        return prisma.job.findUnique({
            where: { id },
            include: {
                source: true,
                destinations: {
                    include: { config: true },
                    orderBy: { priority: 'asc' }
                },
                notifications: true,
                encryptionProfile: true
            }
        });
    }

    async createJob(input: CreateJobInput) {
        const { name, schedule, sourceId, databases, destinations, notificationIds, enabled, encryptionProfileId, compression, pgCompression, notificationEvents } = input;

        // Check name uniqueness
        const existingByName = await prisma.job.findFirst({ where: { name } });
        if (existingByName) {
            throw new Error(`A job with the name "${name}" already exists.`);
        }

        const newJob = await prisma.job.create({
            data: {
                name,
                schedule,
                sourceId,
                databases: JSON.stringify(databases || []),
                enabled: enabled !== undefined ? enabled : true,
                encryptionProfileId: encryptionProfileId || null,
                namingTemplateId: input.namingTemplateId ?? null,
                schedulePresetId: input.schedulePresetId ?? null,
                compression: compression || "NONE",
                pgCompression: pgCompression ?? "",
                notificationEvents: notificationEvents || "ALWAYS",
                notifications: {
                    connect: notificationIds?.map((id) => ({ id })) || []
                },
                destinations: {
                    create: destinations.map((d) => ({
                        configId: d.configId,
                        priority: d.priority,
                        retention: d.retention || "{}",
                        retentionPolicyId: d.retentionPolicyId ?? null,
                    }))
                }
            },
            include: jobInclude
        });

        scheduler.refresh().catch((e) => log.error("Scheduler refresh failed after createJob", {}, wrapError(e)));

        return newJob;
    }

    async updateJob(id: string, input: UpdateJobInput) {
        const { name, schedule, sourceId, databases, destinations, notificationIds, enabled, encryptionProfileId, compression, pgCompression, notificationEvents, namingTemplateId } = input;

        // Check name uniqueness (excluding current job)
        if (name) {
            const existingByName = await prisma.job.findFirst({ where: { name, id: { not: id } } });
            if (existingByName) {
                throw new Error(`A job with the name "${name}" already exists.`);
            }
        }

        const updatedJob = await prisma.$transaction(async (tx) => {
            // Update destinations if provided
            if (destinations) {
                // Remove existing destinations
                await tx.jobDestination.deleteMany({ where: { jobId: id } });
                // Create new ones
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

            return tx.job.update({
                where: { id },
                data: {
                    name,
                    schedule,
                    enabled,
                    sourceId,
                    databases: databases !== undefined ? JSON.stringify(databases) : undefined,
                    compression,
                    pgCompression,
                    notificationEvents,
                    namingTemplateId: namingTemplateId !== undefined ? (namingTemplateId ?? null) : undefined,
                    schedulePresetId: input.schedulePresetId !== undefined ? (input.schedulePresetId ?? null) : undefined,
                    encryptionProfileId: encryptionProfileId === "" ? null : encryptionProfileId,
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
                notifications: true,
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
                destinations: {
                    create: original.destinations.map((d) => ({
                        configId: d.configId,
                        priority: d.priority,
                        retention: d.retention
                    }))
                }
            },
            include: jobInclude
        });

        scheduler.refresh().catch((e) => log.error("Scheduler refresh failed after cloneJob", {}, wrapError(e)));

        return clonedJob;
    }
}

export const jobService = new JobService();
