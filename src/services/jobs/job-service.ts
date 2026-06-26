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
    notificationTemplateIds?: string[];
    encryptionProfileId?: string;
    compression?: string;
    pgCompression?: string;
    enabled?: boolean;
    notificationEvents?: string;
    namingTemplateId?: string | null;
    schedulePresetId?: string | null;
    skipVerification?: boolean;
}

export interface UpdateJobInput {
    name?: string;
    schedule?: string;
    sourceId?: string;
    databases?: string[];
    destinations?: DestinationInput[];
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
}

const jobInclude = {
    source: true,
    destinations: {
        include: { config: true },
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
        const { name, schedule, sourceId, databases, destinations, notificationIds, notificationTemplateIds, enabled, encryptionProfileId, compression, pgCompression, notificationEvents, skipVerification } = input;

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
                skipVerification: skipVerification ?? false,
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
                }
            },
            include: jobInclude
        });

        scheduler.refresh().catch((e) => log.error("Scheduler refresh failed after createJob", {}, wrapError(e)));

        return newJob;
    }

    async updateJob(id: string, input: UpdateJobInput) {
        const { name, schedule, sourceId, databases, destinations, notificationIds, notificationTemplateIds, enabled, encryptionProfileId, compression, pgCompression, notificationEvents, namingTemplateId, skipVerification } = input;

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
                    sourceId,
                    databases: databases !== undefined ? JSON.stringify(databases) : undefined,
                    compression,
                    pgCompression,
                    notificationEvents,
                    namingTemplateId: namingTemplateId !== undefined ? (namingTemplateId ?? null) : undefined,
                    schedulePresetId: input.schedulePresetId !== undefined ? (input.schedulePresetId ?? null) : undefined,
                    encryptionProfileId: encryptionProfileId === "" ? null : encryptionProfileId,
                    skipVerification: skipVerification !== undefined ? skipVerification : undefined,
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
                notificationTemplates: original.notificationTemplates.length > 0
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
                }
            },
            include: jobInclude
        });

        scheduler.refresh().catch((e) => log.error("Scheduler refresh failed after cloneJob", {}, wrapError(e)));

        return clonedJob;
    }
}

export const jobService = new JobService();
