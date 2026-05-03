import prisma from "@/lib/prisma";
import { scheduler } from "@/lib/scheduler";
import { logger } from "@/lib/logger";
import { wrapError } from "@/lib/errors";

const log = logger.child({ service: "JobService" });

export interface DestinationInput {
    configId: string;
    priority: number;
    retention: string; // JSON RetentionConfiguration
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
    multiDbBackupType?: string;
    pgCompression?: string;
    enabled?: boolean;
    notificationEvents?: string;
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
    multiDbBackupType?: string;
    pgCompression?: string;
    enabled?: boolean;
    notificationEvents?: string;
}

const jobInclude = {
    source: true,
    destinations: {
        include: { config: true },
        orderBy: { priority: 'asc' as const }
    },
    notifications: true,
    encryptionProfile: { select: { id: true, name: true } }
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
        const { name, schedule, sourceId, databases, destinations, notificationIds, enabled, encryptionProfileId, compression, multiDbBackupType, pgCompression, notificationEvents } = input;

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
                compression: compression || "NONE",
                multiDbBackupType: multiDbBackupType || "SINGLE_TAR",
                pgCompression: pgCompression ?? "",
                notificationEvents: notificationEvents || "ALWAYS",
                notifications: {
                    connect: notificationIds?.map((id) => ({ id })) || []
                },
                destinations: {
                    create: destinations.map((d) => ({
                        configId: d.configId,
                        priority: d.priority,
                        retention: d.retention || "{}"
                    }))
                }
            },
            include: jobInclude
        });

        scheduler.refresh().catch((e) => log.error("Scheduler refresh failed after createJob", {}, wrapError(e)));

        return newJob;
    }

    async updateJob(id: string, input: UpdateJobInput) {
        const { name, schedule, sourceId, databases, destinations, notificationIds, enabled, encryptionProfileId, compression, multiDbBackupType, pgCompression, notificationEvents } = input;

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
                        retention: d.retention || "{}"
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
                    multiDbBackupType,
                    pgCompression,
                    notificationEvents,
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
}

export const jobService = new JobService();
