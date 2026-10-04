import prisma from "@/lib/prisma";
import type { RetentionConfiguration } from "@/lib/core/retention";
import { currentGroupPattern, parseJsonStringArray } from "@/lib/exclude-groups";
import { readPolicy } from "@/services/storage/explorer-plan";
import type {
    ExcludeFolder,
    ExcludeRow,
    NamingRow,
    NotificationRow,
    RetentionRow,
    RetentionUse,
    ScheduleRow,
    TemplateConnection,
    TemplateJob,
    TemplatesModel,
} from "./templates-types";

/** A job with everything that ties it to a template. */
export interface JobRecord {
    id: string;
    name: string;
    enabled: boolean;
    schedule: string;
    /** The schedule of its preset, when it follows one. */
    presetSchedule: string | null;
    schedulePresetId: string | null;
    namingTemplateId: string | null;
    sourceType: string | null;
    incremental: boolean;
    /** JSON, like the job stores it. */
    databases: string;
    destinations: { configId: string; name: string; adapterId: string; retention: string; retentionPolicyId: string | null }[];
    folders: { id: string; configId: string; name: string; adapterId: string; path: string; presetIds: string[] }[];
}

interface Stamped {
    id: string;
    name: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface TemplateRecords {
    timezone: string;
    channels: TemplateConnection[];
    jobs: JobRecord[];
    retention: (Stamped & { config: string; isDefault: boolean; isSystem: boolean; prefills: TemplateConnection[] })[];
    naming: (Stamped & { pattern: string; isDefault: boolean; isSystem: boolean })[];
    schedules: (Stamped & { schedule: string })[];
    notifications: (Stamped & { isDefault: boolean; isSystem: boolean; channels: NotificationRow["channels"]; jobIds: string[] })[];
    excludes: (Stamped & { patterns: string; groups: string; excludedGroupPatterns: string; isDefault: boolean; isSystem: boolean })[];
}

/** A policy stored as JSON, keeping everything when it cannot be read, like the runner does. */
function configOf(config: string): RetentionConfiguration {
    try {
        return JSON.parse(config) as RetentionConfiguration;
    } catch {
        return { mode: "NONE" };
    }
}

function stamped(record: Stamped) {
    return {
        id: record.id,
        name: record.name,
        description: record.description,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
    };
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
}

/**
 * The Templates page from the rows of the database: every template with what uses it. A
 * destination without a policy or a setting of its own follows the default policy, and a job
 * without a template of its own the default file names, the way the runner resolves them.
 */
export function buildTemplatesModel(records: TemplateRecords): TemplatesModel {
    const defaultPolicy = records.retention.find((policy) => policy.isDefault);
    const defaultNaming = records.naming.find((template) => template.isDefault);
    const policyUses = new Map<string, RetentionUse[]>();
    const namingUses = new Map<string, NamingRow["uses"]>();
    const presetJobs = new Map<string, string[]>();
    const presetFolders = new Map<string, ExcludeFolder[]>();
    const retentionTotals = { destinations: 0, picked: 0, followDefault: 0, own: 0 };
    const namingTotals = { jobs: records.jobs.length, picked: 0, followDefault: 0 };
    const folders = { total: 0, withPreset: 0 };

    for (const job of records.jobs) {
        for (const destination of job.destinations) {
            retentionTotals.destinations += 1;
            const use = { jobId: job.id, destinationId: destination.configId, destinationName: destination.name, adapterId: destination.adapterId };
            if (destination.retentionPolicyId) {
                retentionTotals.picked += 1;
                push(policyUses, destination.retentionPolicyId, { ...use, how: "picked" });
            } else if (readPolicy(destination.retention)) {
                retentionTotals.own += 1;
            } else {
                retentionTotals.followDefault += 1;
                if (defaultPolicy) push(policyUses, defaultPolicy.id, { ...use, how: "default" });
            }
        }

        if (job.namingTemplateId) {
            namingTotals.picked += 1;
            push(namingUses, job.namingTemplateId, { jobId: job.id, how: "picked" });
        } else {
            namingTotals.followDefault += 1;
            if (defaultNaming) push(namingUses, defaultNaming.id, { jobId: job.id, how: "default" });
        }

        if (job.schedulePresetId) push(presetJobs, job.schedulePresetId, job.id);

        for (const folder of job.folders) {
            folders.total += 1;
            if (folder.presetIds.length > 0) folders.withPreset += 1;
            for (const presetId of folder.presetIds) {
                push(presetFolders, presetId, {
                    id: folder.id,
                    jobId: job.id,
                    connectionId: folder.configId,
                    connectionName: folder.name,
                    adapterId: folder.adapterId,
                    path: folder.path,
                });
            }
        }
    }

    const jobs: TemplateJob[] = records.jobs.map((job) => ({
        id: job.id,
        name: job.name,
        enabled: job.enabled,
        schedule: job.presetSchedule ?? job.schedule,
        sourceType: job.sourceType,
        hasFolders: job.folders.length > 0,
        incremental: job.incremental && job.folders.length > 0,
        databases: parseJsonStringArray(job.databases),
    }));

    const retention: RetentionRow[] = records.retention.map((policy) => ({
        ...stamped(policy),
        config: configOf(policy.config),
        isDefault: policy.isDefault,
        isSystem: policy.isSystem,
        uses: policyUses.get(policy.id) ?? [],
        prefills: policy.prefills,
    }));

    return {
        timezone: records.timezone,
        jobs,
        retention,
        retentionTotals,
        naming: records.naming.map((template) => ({
            ...stamped(template),
            pattern: template.pattern,
            isDefault: template.isDefault,
            isSystem: template.isSystem,
            uses: namingUses.get(template.id) ?? [],
        })),
        namingTotals,
        schedules: records.schedules.map((preset): ScheduleRow => ({ ...stamped(preset), schedule: preset.schedule, jobIds: presetJobs.get(preset.id) ?? [] })),
        notifications: records.notifications.map((template): NotificationRow => ({
            ...stamped(template),
            isDefault: template.isDefault,
            isSystem: template.isSystem,
            channels: template.channels,
            jobIds: template.jobIds,
        })),
        excludes: records.excludes.map((preset): ExcludeRow => ({
            ...stamped(preset),
            patterns: parseJsonStringArray(preset.patterns),
            groups: parseJsonStringArray(preset.groups),
            // An opt-out stored before a group folder matched at any depth still names that folder.
            excludedGroupPatterns: parseJsonStringArray(preset.excludedGroupPatterns).map(currentGroupPattern),
            isDefault: preset.isDefault,
            isSystem: preset.isSystem,
            folders: presetFolders.get(preset.id) ?? [],
        })),
        folders,
        channels: records.channels,
    };
}

const STAMPED = { id: true, name: true, description: true, createdAt: true, updatedAt: true } as const;
const CONNECTION = { select: { id: true, name: true, adapterId: true } } as const;

/** The time zone the scheduler reads schedules and names files in, UTC unless the settings name another. */
export async function schedulerTimezone(): Promise<string> {
    const setting = await prisma.systemSetting.findUnique({ where: { key: "system.timezone" } });
    return setting?.value || "UTC";
}

async function loadJobs(): Promise<JobRecord[]> {
    const jobs = await prisma.job.findMany({
        orderBy: { name: "asc" },
        select: {
            id: true,
            name: true,
            enabled: true,
            schedule: true,
            databases: true,
            backupMode: true,
            schedulePresetId: true,
            schedulePreset: { select: { schedule: true } },
            namingTemplateId: true,
            source: { select: { adapterId: true } },
            destinations: {
                orderBy: { priority: "asc" },
                select: { configId: true, retention: true, retentionPolicyId: true, config: { select: { name: true, adapterId: true } } },
            },
            sources: {
                orderBy: { priority: "asc" },
                select: { id: true, configId: true, path: true, config: { select: { name: true, adapterId: true } }, excludePatternPresets: { select: { id: true } } },
            },
        },
    });
    return jobs.map((job) => ({
        id: job.id,
        name: job.name,
        enabled: job.enabled,
        schedule: job.schedule,
        presetSchedule: job.schedulePreset?.schedule ?? null,
        schedulePresetId: job.schedulePresetId,
        namingTemplateId: job.namingTemplateId,
        sourceType: job.source?.adapterId ?? null,
        incremental: job.backupMode === "INCREMENTAL",
        databases: job.databases,
        destinations: job.destinations.map((destination) => ({
            configId: destination.configId,
            name: destination.config.name,
            adapterId: destination.config.adapterId,
            retention: destination.retention,
            retentionPolicyId: destination.retentionPolicyId,
        })),
        folders: job.sources.map((source) => ({
            id: source.id,
            configId: source.configId,
            name: source.config.name,
            adapterId: source.config.adapterId,
            path: source.path,
            presetIds: source.excludePatternPresets.map((preset) => preset.id),
        })),
    }));
}

/** Loads the Templates page. Only which connection a channel is, never its config, which holds secrets. */
export async function getTemplatesModel(): Promise<TemplatesModel> {
    const [timezone, jobs, retention, naming, schedules, notifications, excludes, channels] = await Promise.all([
        schedulerTimezone(),
        loadJobs(),
        prisma.retentionPolicy.findMany({
            orderBy: { name: "asc" },
            select: { ...STAMPED, config: true, isDefault: true, isSystem: true, adapterConfigs: { ...CONNECTION, orderBy: { name: "asc" } } },
        }),
        prisma.namingTemplate.findMany({ orderBy: { name: "asc" }, select: { ...STAMPED, pattern: true, isDefault: true, isSystem: true } }),
        prisma.schedulePreset.findMany({ orderBy: { name: "asc" }, select: { ...STAMPED, schedule: true } }),
        prisma.notificationTemplate.findMany({
            orderBy: { name: "asc" },
            select: {
                ...STAMPED,
                isDefault: true,
                isSystem: true,
                channels: { select: { id: true, configId: true, events: true, config: CONNECTION } },
                jobs: { select: { jobId: true } },
            },
        }),
        prisma.excludePatternPreset.findMany({
            orderBy: { name: "asc" },
            select: { ...STAMPED, patterns: true, groups: true, excludedGroupPatterns: true, isDefault: true, isSystem: true },
        }),
        // Only which connection each channel is. A config holds webhook URLs, tokens and passwords.
        prisma.adapterConfig.findMany({ where: { type: "notification" }, orderBy: { name: "asc" }, select: { id: true, name: true, adapterId: true } }),
    ]);

    return buildTemplatesModel({
        timezone,
        channels,
        jobs,
        retention: retention.map(({ adapterConfigs, ...policy }) => ({ ...policy, prefills: adapterConfigs })),
        naming,
        schedules,
        notifications: notifications.map(({ jobs: links, ...template }) => ({ ...template, jobIds: links.map((link) => link.jobId) })),
        excludes,
    });
}

