import prisma from "@/lib/prisma";
import { scheduler } from "@/lib/scheduler";

export interface CreateJobInput {
    name: string;
    schedule: string;
    sourceId: string;
    destinationId: string;
    notificationIds?: string[];
    encryptionProfileId?: string;
    enabled?: boolean;
}

export interface UpdateJobInput {
    name?: string;
    schedule?: string;
    sourceId?: string;
    destinationId?: string;
    notificationIds?: string[];
    encryptionProfileId?: string;
    enabled?: boolean;
}

export class JobService {
    async getJobs() {
        return prisma.job.findMany({
            include: {
                source: true,
                destination: true,
                notifications: true,
                encryptionProfile: { select: { id: true, name: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
    }

    async getJobById(id: string) {
        return prisma.job.findUnique({
            where: { id },
            include: {
                source: true,
                destination: true,
                notifications: true,
                encryptionProfile: true
            }
        });
    }

    async createJob(input: CreateJobInput) {
        const { name, schedule, sourceId, destinationId, notificationIds, enabled, encryptionProfileId } = input;

        const newJob = await prisma.job.create({
            data: {
                name,
                schedule,
                sourceId,
                destinationId,
                enabled: enabled !== undefined ? enabled : true,
                encryptionProfileId: encryptionProfileId || null,
                notifications: {
                    connect: notificationIds?.map((id) => ({ id })) || []
                }
            },
            include: {
                source: true,
                destination: true,
                notifications: true,
            }
        });

        // Trigger scheduler refresh to pick up the new job
        await scheduler.refresh();

        return newJob;
    }

    async updateJob(id: string, input: UpdateJobInput) {
        const { name, schedule, sourceId, destinationId, notificationIds, enabled, encryptionProfileId } = input;

        const updatedJob = await prisma.job.update({
            where: { id },
            data: {
                name,
                schedule,
                enabled,
                sourceId,
                destinationId,
                encryptionProfileId: encryptionProfileId === "" ? null : encryptionProfileId,
                notifications: {
                    set: [], // Clear existing relations
                    connect: notificationIds?.map((id) => ({ id })) || []
                }
            },
            include: {
                source: true,
                destination: true,
                notifications: true,
            }
        });

        await scheduler.refresh();

        return updatedJob;
    }

    async deleteJob(id: string) {
        const deletedJob = await prisma.job.delete({
            where: { id },
        });

        await scheduler.refresh();

        return deletedJob;
    }
}

export const jobService = new JobService();
