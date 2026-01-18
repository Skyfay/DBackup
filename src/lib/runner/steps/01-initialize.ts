import prisma from "@/lib/prisma";
import { RunnerContext } from "../types";
import { registry } from "@/lib/core/registry";
import { DatabaseAdapter, StorageAdapter } from "@/lib/core/interfaces";
import { registerAdapters } from "@/lib/adapters";

// Ensure adapters are loaded
registerAdapters();

export async function stepInitialize(ctx: RunnerContext) {
    ctx.log(`[Runner] Starting initialization for Job ID: ${ctx.jobId}`);

    // 1. Fetch Job
    const job = await prisma.job.findUnique({
        where: { id: ctx.jobId },
        include: {
            source: true,
            destination: true,
            notifications: true // Note: Check if relation name matches schema in your project
        }
    });

    if (!job) {
        throw new Error(`Job ${ctx.jobId} not found`);
    }

    if (!job.source || !job.destination) {
        throw new Error(`Job ${ctx.jobId} is missing source or destination linkage`);
    }

    ctx.job = job as any; // Cast for now, types aligned in interface

    // 2. Create Execution Record
    const execution = await prisma.execution.create({
        data: {
            jobId: job.id,
            status: "Running",
            logs: "[]",
            startedAt: ctx.startedAt,
        }
    });

    ctx.execution = execution;

    // 3. Resolve Adapters
    const sourceAdapter = registry.get(job.source.adapterId) as DatabaseAdapter;
    const destAdapter = registry.get(job.destination.adapterId) as StorageAdapter;

    if (!sourceAdapter) throw new Error(`Source adapter '${job.source.adapterId}' not found`);
    if (!destAdapter) throw new Error(`Destination adapter '${job.destination.adapterId}' not found`);

    ctx.sourceAdapter = sourceAdapter;
    ctx.destAdapter = destAdapter;

    ctx.log("Initialization complete. Adapters resolved.");
}
