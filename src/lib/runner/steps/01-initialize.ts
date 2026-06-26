import prisma from "@/lib/prisma";
import { RunnerContext, DestinationContext } from "../types";
import { registry } from "@/lib/core/registry";
import { DatabaseAdapter, StorageAdapter } from "@/lib/core/interfaces";
import { registerAdapters } from "@/lib/adapters";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { RetentionConfiguration } from "@/lib/core/retention";

// Ensure adapters are loaded
registerAdapters();

export async function stepInitialize(ctx: RunnerContext) {
    ctx.log(`[Runner] Starting initialization for Job ID: ${ctx.jobId}`);

    // 1. Fetch Job
    const job = await prisma.job.findUnique({
        where: { id: ctx.jobId },
        include: {
            source: true,
            destinations: {
                include: { config: true },
                orderBy: { priority: 'asc' }
            },
            notifications: true,
            notificationTemplates: {
                include: {
                    template: {
                        include: { channels: { include: { config: true } } }
                    }
                },
                orderBy: { priority: 'asc' }
            }
        }
    });

    if (!job) {
        throw new Error(`Job ${ctx.jobId} not found`);
    }

    if (!job.source) {
        throw new Error(`Job ${ctx.jobId} is missing source linkage`);
    }

    if (!job.destinations || job.destinations.length === 0) {
        throw new Error(`Job ${ctx.jobId} has no destinations configured`);
    }

    ctx.job = job as any;

    // 2. Create Execution Record
    if (!ctx.execution) {
        const execution = await prisma.execution.create({
            data: {
                jobId: job.id,
                status: "Running",
                logs: "[]",
                startedAt: ctx.startedAt,
            }
        });
        ctx.execution = execution;
    }

    // 3. Resolve Source Adapter
    const sourceAdapter = registry.get(job.source.adapterId) as DatabaseAdapter;
    if (!sourceAdapter) throw new Error(`Source adapter '${job.source.adapterId}' not found`);
    ctx.sourceAdapter = sourceAdapter;

    // 4. Resolve Destination Adapters
    ctx.destinations = [];
    for (const dest of job.destinations) {
        const adapter = registry.get(dest.config.adapterId) as StorageAdapter;
        if (!adapter) {
            ctx.log(`Warning: Destination adapter '${dest.config.adapterId}' for '${dest.config.name}' not found. Skipping.`, 'warning');
            continue;
        }

        let retention: RetentionConfiguration = { mode: 'NONE' };
        let retentionPolicyName: string | undefined;
        let retentionPolicySource: DestinationContext['retentionPolicySource'] = 'none';
        try {
            if (dest.retentionPolicyId) {
                // Policy template takes priority over the legacy per-destination retention JSON
                const policy = await prisma.retentionPolicy.findUnique({ where: { id: dest.retentionPolicyId } });
                if (policy?.config) {
                    retention = JSON.parse(policy.config as string);
                    retentionPolicyName = policy.name;
                    retentionPolicySource = 'template';
                }
            } else if (dest.retention && dest.retention !== '{}') {
                retention = JSON.parse(dest.retention);
                retentionPolicySource = 'legacy';
            } else {
                // No per-destination policy and no legacy config - fall back to the system default retention policy
                const defaultPolicy = await prisma.retentionPolicy.findFirst({ where: { isDefault: true } });
                if (defaultPolicy?.config) {
                    retention = JSON.parse(defaultPolicy.config as string);
                    retentionPolicyName = defaultPolicy.name;
                    retentionPolicySource = 'default';
                }
            }
        } catch {
            ctx.log(`Warning: Failed to parse retention config for destination '${dest.config.name}'. Using NONE.`, 'warning');
        }

        const destCtx: DestinationContext = {
            configId: dest.config.id,
            configName: dest.config.name,
            adapter,
            config: await resolveAdapterConfig(dest.config) as any,
            retention,
            retentionPolicyName,
            retentionPolicySource,
            priority: dest.priority,
            adapterId: dest.config.adapterId,
        };
        ctx.destinations.push(destCtx);
    }

    if (ctx.destinations.length === 0) {
        throw new Error(`Job ${ctx.jobId}: No valid destination adapters could be resolved`);
    }

    const destNames = ctx.destinations.map(d => d.configName).join(', ');
    ctx.log(`Initialization complete. Source: ${job.source.name}, Destinations: [${destNames}] (${ctx.destinations.length})`);
}
