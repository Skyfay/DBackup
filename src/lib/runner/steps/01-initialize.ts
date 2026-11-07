import prisma from "@/lib/prisma";
import { RunnerContext, DestinationContext, DirectorySourceContext } from "../types";
import { registry } from "@/lib/core/registry";
import { DatabaseAdapter, StorageAdapter } from "@/lib/core/interfaces";
import { registerAdapters } from "@/lib/adapters";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { ownDataRefusal, ownVolumeRefusal } from "@/lib/adapters/own-data";
import { jobFolderRefusal } from "./job-folder-check";
import { resolveExcludePatterns, parseJsonStringArray } from "@/lib/exclude-groups";
import { RetentionConfiguration } from "@/lib/core/retention";
import { isAirGapped } from "@/lib/core/air-gap";
import { SHARED_STORAGE_FAILURE, storageView } from "@/lib/tenant/storage-view";
import { destinationAccess } from "@/services/sharing/destination-access";
import { logger } from "@/lib/logging/logger";
import { ConfigurationError, wrapError } from "@/lib/logging/errors";
import { CONFIG_BACKUP_FOLDER_NAME, isConfigBackupFolderName } from "@/lib/core/config-backup-path";
import { JOB_FOLDER_NAME, isUnsafeJobFolderName } from "@/lib/core/job-folder";
import { assertSourceFolder } from "@/lib/archive/remote-paths";

const log = logger.child({ step: "initialize" });

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
                include: { config: true, excludePatternPresets: true },
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

    // A job writes into the folder its name gives, so one called like the folder of the
    // configuration backup would write among its files. A save refuses the name, this stops a job
    // that got it before or came back from Recently deleted or an older file.
    if (isConfigBackupFolderName(job.name)) {
        throw new ConfigurationError("job", `${CONFIG_BACKUP_FOLDER_NAME} Rename it to run it again.`);
    }
    // Nor one whose name leads out of its own folder, into the root of a destination or beside it.
    if (isUnsafeJobFolderName(job.name)) {
        throw new ConfigurationError("job", `${JOB_FOLDER_NAME} Rename it to run it again.`);
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

    // A run limited to some databases backs up those alone, never the folders of the job.
    if (ctx.onlyDatabases) {
        if (!job.source) throw new Error(`Job ${ctx.jobId} has no database source, so it cannot back up ${ctx.onlyDatabases.join(", ")} alone`);
        if (job.sources.length > 0) ctx.log(`This run backs up ${ctx.onlyDatabases.join(", ")} alone and leaves the ${job.sources.length} folder source(s) of the job out.`);
    }

    // 3b. Resolve Directory Sources (JobSource[]) - empty array for every job without one
    ctx.sources = [];
    for (const src of ctx.onlyDatabases ? [] : job.sources) {
        const adapter = registry.get(src.config.adapterId) as StorageAdapter;
        if (!adapter) {
            ctx.log(`Warning: Directory source adapter '${src.config.adapterId}' for '${src.config.name}' not found. Skipping.`, 'warning');
            continue;
        }

        // Exclude patterns are the union of every live-linked preset's current patterns (if any -
        // re-read fresh here so editing a preset later applies retroactively, same as naming
        // templates/schedule presets) and this source's own job-specific patterns.
        //
        // A preset's patterns come from the curated groups it references plus its own entries,
        // resolved here rather than stored, so a group extended in a later release applies to
        // existing jobs without anyone editing them.
        const presetPatterns: string[] = src.excludePatternPresets.flatMap((p) => resolveExcludePatterns({
            groups: parseJsonStringArray(p.groups),
            excludedGroupPatterns: parseJsonStringArray(p.excludedGroupPatterns),
            patterns: parseJsonStringArray(p.patterns),
        }));
        const ownPatterns: string[] = JSON.parse(src.excludePatterns || "[]");
        const excludePatterns = [...new Set([...presetPatterns, ...ownPatterns])];

        // A save refuses a folder that leaves its connection, this stops a job saved before that.
        try {
            assertSourceFolder(src.path);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new ConfigurationError(src.config.adapterId, `Job ${job.name}, source ${src.config.name}: ${reason} Edit the job to run it again.`);
        }

        const sourceConfig = await resolveAdapterConfig(src.config) as Record<string, unknown>;
        // "/" is the form's sentinel for "the whole adapter" (see DirectoryBrowseDialog in job-form.tsx).
        // "" is what every storage adapter's list()/download() actually treats as its own root.
        const remotePath = src.path === "/" ? "" : src.path;
        // No run reads the own data of DBackup, whoever saved the connection or the folder, since
        // a link may point there by now, see `own-data.ts`.
        const ownData = await ownDataRefusal(src.config.adapterId, sourceConfig, { subPath: remotePath })
            ?? await ownVolumeRefusal(src.config.adapterId, sourceConfig, remotePath);
        if (ownData) throw new ConfigurationError(src.config.adapterId, `${src.config.name}: ${ownData}`);

        const sourceCtx: DirectorySourceContext = {
            jobSourceId: src.id,
            configId: src.config.id,
            configName: src.config.name,
            tenantId: src.config.tenantId,
            adapter,
            config: sourceConfig as any,
            remotePath,
            excludePatterns,
            priority: src.priority,
            stopContainers: src.stopContainers,
        };
        ctx.sources.push(sourceCtx);
    }

    if (!ctx.onlyDatabases && job.sources.length > 0 && ctx.sources.length === 0) {
        throw new Error(`Job ${ctx.jobId}: No valid directory source adapters could be resolved`);
    }

    // 4. Resolve Destination Adapters
    ctx.destinations = [];
    for (const dest of job.destinations) {
        const plain = registry.get(dest.config.adapterId) as StorageAdapter;
        if (!plain) {
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

        // A destination another tenant shares takes the backups of this tenant into its folder there,
        // and only while it is shared with it. Without a key a run writes nothing to one that asks for it.
        const { mode, provided } = await destinationAccess(dest.config, job.tenantId);
        let refusal = !mode
            ? `${dest.config.name} is no longer shared with this tenant`
            : provided?.encryptedOnly && !job.encryptionProfileId
                ? `${dest.config.name} takes only encrypted backups. Pick a key under Encryption`
                : undefined;
        const adapter = storageView(plain, mode ?? { kind: "own" });
        // The login of a destination the run may not use is never read. When the settings of a
        // destination another tenant shares cannot be used, the customer's run reads no word of
        // them and the upload there is refused, like a storage of that tenant that does not answer.
        let config: Record<string, unknown> = {};
        if (!refusal) {
            try {
                config = await resolveAdapterConfig(dest.config) as Record<string, unknown>;
            } catch (error: unknown) {
                if (mode?.kind !== "customer") throw error;
                log.warn("The settings of a destination shared with this tenant could not be used", { configId: dest.config.id, tenantId: job.tenantId }, wrapError(error));
                refusal = SHARED_STORAGE_FAILURE;
            }
        }
        // No run writes into the own data of DBackup, the destination of the configuration backup
        // only into the folder of its own files, see `own-data.ts`. The folder of the job below the
        // destination counts too, since a link there may lead into it, for a customer below its
        // folder on a destination another tenant shares, where its files really land.
        if (!refusal) refusal = (await jobFolderRefusal(dest.config.adapterId, config, dest.config.id, job.name, mode?.kind === "customer" ? mode.tenantId : undefined)) ?? undefined;

        const destCtx: DestinationContext = {
            configId: dest.config.id,
            configName: dest.config.name,
            adapter,
            refusal,
            ...(mode?.kind === "customer" ? { customer: mode.tenantId } : {}),
            config,
            retention,
            retentionPolicyName,
            retentionPolicySource,
            priority: dest.priority,
            adapterId: dest.config.adapterId,
            airGapped: isAirGapped(dest.config),
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
