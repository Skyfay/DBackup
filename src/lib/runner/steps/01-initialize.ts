import prisma from "@/lib/prisma";
import { RunnerContext, DestinationContext, DirectorySourceContext } from "../types";
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
            sources: {
                include: { config: true, excludePatternPreset: true },
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

    // A job needs at least one source: a database source, or one or more directory sources.
    // Mirrors the JobService.createJob/updateJob validation (defense in depth for jobs created
    // before that validation existed, or edited directly in the DB).
    if (!job.source && (!job.sources || job.sources.length === 0)) {
        throw new Error(`Job ${ctx.jobId} has no source configured (neither a database source nor directory sources)`);
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

    // 3. Resolve Source Adapter (optional - a directory-only job has no database source)
    if (job.source) {
        const sourceAdapter = registry.get(job.source.adapterId) as DatabaseAdapter;
        if (!sourceAdapter) throw new Error(`Source adapter '${job.source.adapterId}' not found`);
        ctx.sourceAdapter = sourceAdapter;
    }

    // 3b. Resolve Directory Sources (JobSource[]) - empty array for every job without one
    ctx.sources = [];
    for (const src of job.sources) {
        const adapter = registry.get(src.config.adapterId) as StorageAdapter;
        if (!adapter) {
            ctx.log(`Warning: Directory source adapter '${src.config.adapterId}' for '${src.config.name}' not found. Skipping.`, 'warning');
            continue;
        }

        // Exclude patterns are the union of the live-linked preset's current patterns (if any -
        // re-read fresh here so editing the preset later applies retroactively, same as naming
        // templates/schedule presets) and this source's own job-specific patterns.
        const presetPatterns: string[] = src.excludePatternPreset ? JSON.parse(src.excludePatternPreset.patterns || "[]") : [];
        const ownPatterns: string[] = JSON.parse(src.excludePatterns || "[]");
        const excludePatterns = [...new Set([...presetPatterns, ...ownPatterns])];

        const sourceCtx: DirectorySourceContext = {
            jobSourceId: src.id,
            configId: src.config.id,
            configName: src.config.name,
            adapter,
            config: await resolveAdapterConfig(src.config) as any,
            remotePath: src.path,
            excludePatterns,
            priority: src.priority,
        };
        ctx.sources.push(sourceCtx);
    }

    if (job.sources.length > 0 && ctx.sources.length === 0) {
        throw new Error(`Job ${ctx.jobId}: No valid directory source adapters could be resolved`);
    }

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
    const sourceLabel = job.source?.name ?? (ctx.sources.length > 0 ? `${ctx.sources.length} directory source(s)` : 'none');
    ctx.log(`Initialization complete. Source: ${sourceLabel}, Destinations: [${destNames}] (${ctx.destinations.length})`);
}
