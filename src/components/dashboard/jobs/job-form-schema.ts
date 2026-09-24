import { z } from "zod";
import { DEFAULT_RETENTION_SENTINEL } from "@/components/templates/retention-policy-picker";
import { isValidCron } from "@/lib/core/cron";
import type { JobListItem } from "@/services/jobs/job-list-service";

/** A connection a job can use, as the page hands it to the form. */
export interface AdapterOption {
    id: string;
    name: string;
    adapterId: string;
    /** What kind of connection it is, like "database", so one added from a field shows in the fields of its kind only. */
    type?: string;
    metadata?: string | null;
    usableAsSource?: boolean;
    storageRole?: string;
    /** Whether the folder picker can browse this connection's root. */
    supportsBrowse?: boolean;
    /** The config without its secrets, for where the connection points. */
    config?: string;
    lastStatus?: string;
}

export interface EncryptionOption {
    id: string;
    name: string;
    description?: string | null;
    /** How many jobs encrypt their backups with the key. */
    jobCount?: number;
}

/** What the form edits: a job from the list, or nothing for a new one. */
export type JobFormJob = JobListItem;

export type PgCompressionAlgo = "LEGACY" | "NONE" | "GZIP" | "LZ4" | "ZSTD";

export const PG_LEVELS: Record<string, { default: number; values: number[] }> = {
    GZIP: { default: 6, values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
    LZ4: { default: 1, values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
    ZSTD: { default: 3, values: Array.from({ length: 22 }, (_, index) => index + 1) },
};

/** The major version in a version string like "16.2" or "PostgreSQL 14.1". */
export function parsePgMajorVersion(metadata: string | null | undefined): number | null {
    if (!metadata) return null;
    try {
        const parsed = JSON.parse(metadata);
        const version: string = parsed.engineVersion || parsed.version || "";
        const match = version.match(/(\d+)\./);
        return match ? parseInt(match[1], 10) : null;
    } catch {
        return null;
    }
}

export function parsePgCompression(pgCompression: string | undefined): { algo: PgCompressionAlgo; level: number } {
    if (!pgCompression) return { algo: "LEGACY", level: 6 };
    if (pgCompression === "NONE") return { algo: "NONE", level: 0 };
    const colon = pgCompression.indexOf(":");
    if (colon === -1) return { algo: "LEGACY", level: 6 };
    const algo = pgCompression.slice(0, colon).toUpperCase() as PgCompressionAlgo;
    const level = parseInt(pgCompression.slice(colon + 1), 10);
    return { algo, level: isNaN(level) ? (PG_LEVELS[algo]?.default ?? 6) : level };
}

const destinationSchema = z.object({
    configId: z.string().min(1, "Pick a destination."),
    // Legacy inline retention, sent back untouched. Destinations follow a retention policy now,
    // and a typed object here would only strip fields it does not know on every save.
    retention: z.record(z.string(), z.unknown()),
    retentionPolicyId: z.string().optional(),
});

const directorySourceSchema = z.object({
    configId: z.string().min(1, "Pick a connection."),
    path: z.string().min(1, "Enter a path or browse for one."),
    excludePatterns: z.array(z.string()),
    excludePatternPresetIds: z.array(z.string()),
    stopContainers: z.boolean(),
});

export const jobSchema = z
    .object({
        name: z.string().trim().min(1, "Give the job a name."),
        enabled: z.boolean(),
        /** Own cron expression, or one that follows a schedule preset. */
        scheduleMode: z.enum(["own", "preset"]),
        schedule: z.string().trim().min(1, "Pick when the job runs."),
        schedulePresetId: z.string().nullable(),
        /** A database, folders from storage connections, or both. */
        sourceMode: z.enum(["db", "dirs", "both"]),
        sourceId: z.string(),
        /** Every database of the server, also ones added later, or the picked ones. */
        databaseScope: z.enum(["all", "some"]),
        databases: z.array(z.string()),
        directorySources: z.array(directorySourceSchema),
        destinations: z.array(destinationSchema).min(1, "Add at least one destination."),
        encryptionProfileId: z.string(),
        namingTemplateId: z.string().optional(),
        compression: z.enum(["NONE", "GZIP", "BROTLI"]),
        pgCompressionAlgo: z.enum(["LEGACY", "NONE", "GZIP", "LZ4", "ZSTD"]),
        pgCompressionLevel: z.number().int().min(0).max(22),
        notificationIds: z.array(z.string()),
        notificationEvents: z.array(z.enum(["SUCCESS", "PARTIAL", "FAILED"])),
        notificationTemplateIds: z.array(z.string()),
        skipVerification: z.boolean(),
        backupMode: z.enum(["FULL", "INCREMENTAL"]),
        fullEveryDays: z.number({ message: "Enter a number of days." }).int().min(1, "At least one day.").max(365, "At most 365 days."),
        verifyByHash: z.boolean(),
    })
    .superRefine((values, ctx) => {
        if (values.scheduleMode === "preset" && !values.schedulePresetId) {
            ctx.addIssue({ code: "custom", path: ["schedulePresetId"], message: "Pick the preset the job follows." });
        }
        // A schedule the scheduler cannot read would never run. The picker says what is wrong.
        if (values.scheduleMode === "own" && values.schedule.trim() !== "" && !isValidCron(values.schedule)) {
            ctx.addIssue({ code: "custom", path: ["schedule"], message: "The scheduler cannot read this schedule." });
        }
        if (values.sourceMode !== "dirs" && !values.sourceId) {
            ctx.addIssue({ code: "custom", path: ["sourceId"], message: "Pick the database to back up." });
        }
        if (values.sourceMode !== "dirs" && values.databaseScope === "some" && values.databases.length === 0) {
            ctx.addIssue({ code: "custom", path: ["databases"], message: "Pick at least one database, or back up all of them." });
        }
        if (values.sourceMode !== "db" && values.directorySources.length === 0) {
            ctx.addIssue({ code: "custom", path: ["directorySources"], message: "Add at least one folder." });
        }
        // The same folder of the same connection twice would only back it up twice.
        const seen = new Set<string>();
        values.directorySources.forEach((source, index) => {
            const key = `${source.configId}::${source.path}`;
            if (source.configId && source.path && seen.has(key)) {
                ctx.addIssue({ code: "custom", path: ["directorySources", index, "path"], message: "This folder is in the list already." });
            }
            seen.add(key);
        });
    });

export type JobFormValues = z.infer<typeof jobSchema>;
export type DirectorySourceValue = JobFormValues["directorySources"][number];
export type DestinationValue = JobFormValues["destinations"][number];

export const NO_ENCRYPTION = "no-encryption";
const ALL_EVENTS: JobFormValues["notificationEvents"] = ["SUCCESS", "PARTIAL", "FAILED"];

function parseEvents(raw?: string | null): JobFormValues["notificationEvents"] {
    if (!raw || raw === "ALWAYS") return ALL_EVENTS;
    if (raw === "FAILURE_ONLY") return ["PARTIAL", "FAILED"];
    if (raw === "SUCCESS_ONLY") return ["SUCCESS"];
    return raw.split("|").filter((event): event is "SUCCESS" | "PARTIAL" | "FAILED" => ALL_EVENTS.includes(event as "SUCCESS"));
}

function parseRetention(raw: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

function parseDatabases(raw: string | undefined): string[] {
    try {
        const parsed: unknown = JSON.parse(raw ?? "[]");
        return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
    } catch {
        return [];
    }
}

/** A policy id, the default policy for a destination that names none, or nothing for its own inline setting. */
function initialPolicy(destination: { retentionPolicyId: string | null; retention: string }): string | undefined {
    if (destination.retentionPolicyId) return destination.retentionPolicyId;
    if (!destination.retention || destination.retention === "{}") return DEFAULT_RETENTION_SENTINEL;
    return undefined;
}

export function emptyDestination(): DestinationValue {
    return { configId: "", retention: {}, retentionPolicyId: DEFAULT_RETENTION_SENTINEL };
}

/** The values the form starts with, from the job it edits or the defaults of a new one. */
export function jobDefaults(job: JobFormJob | null): JobFormValues {
    const pg = parsePgCompression(job?.pgCompression);
    const hasFolders = (job?.sources.length ?? 0) > 0;
    return {
        name: job?.name ?? "",
        enabled: job?.enabled ?? true,
        scheduleMode: job?.schedulePresetId ? "preset" : "own",
        schedule: job?.schedule ?? "0 3 * * *",
        schedulePresetId: job?.schedulePresetId ?? null,
        sourceMode: job ? (job.sourceId && hasFolders ? "both" : hasFolders ? "dirs" : "db") : "db",
        sourceId: job?.sourceId ?? "",
        databaseScope: parseDatabases(job?.databases).length > 0 ? "some" : "all",
        databases: parseDatabases(job?.databases),
        directorySources: (job?.sources ?? []).map((source) => ({
            configId: source.configId,
            path: source.path,
            excludePatterns: source.excludePatterns,
            excludePatternPresetIds: source.excludePatternPresetIds,
            stopContainers: source.stopContainers,
        })),
        destinations: job?.destinations.length
            ? job.destinations.map((destination) => ({
                configId: destination.configId,
                retention: parseRetention(destination.retention),
                retentionPolicyId: initialPolicy(destination),
            }))
            : [emptyDestination()],
        encryptionProfileId: job?.encryptionProfileId ?? NO_ENCRYPTION,
        namingTemplateId: job?.namingTemplateId ?? undefined,
        compression: (job?.compression as JobFormValues["compression"]) ?? "NONE",
        pgCompressionAlgo: pg.algo,
        pgCompressionLevel: pg.level,
        notificationIds: job?.notifications.map((channel) => channel.id) ?? [],
        notificationEvents: parseEvents(job?.notificationEvents),
        notificationTemplateIds: job?.notificationTemplates.map((entry) => entry.templateId) ?? [],
        skipVerification: job?.skipVerification ?? false,
        backupMode: (job?.backupMode as JobFormValues["backupMode"]) ?? "FULL",
        fullEveryDays: job?.fullEveryDays ?? 7,
        verifyByHash: job?.verifyByHash ?? false,
    };
}

/** The request body of the job API, for the values of the form. Parts the source mode leaves out are sent empty. */
export function toJobPayload(values: JobFormValues, sourceAdapterId: string | undefined) {
    const withDatabase = values.sourceMode !== "dirs";
    const withFolders = values.sourceMode !== "db";
    // pg_dump compresses itself, so the setting only means something for a PostgreSQL source.
    let pgCompression = "";
    if (withDatabase && sourceAdapterId === "postgres" && values.pgCompressionAlgo !== "LEGACY") {
        pgCompression = values.pgCompressionAlgo === "NONE" ? "NONE" : `${values.pgCompressionAlgo}:${values.pgCompressionLevel}`;
    }

    return {
        name: values.name.trim(),
        schedule: values.schedule.trim(),
        enabled: values.enabled,
        schedulePresetId: values.scheduleMode === "preset" ? values.schedulePresetId : null,
        sourceId: withDatabase ? values.sourceId : "",
        databases: withDatabase && values.databaseScope === "some" ? values.databases : [],
        sources: withFolders
            ? values.directorySources.map((source, index) => ({ ...source, priority: index }))
            : [],
        destinations: values.destinations.map((destination, index) => ({
            configId: destination.configId,
            priority: index,
            // The default policy is stored as an empty setting and no policy, so the runner looks it up when it runs.
            retention: destination.retentionPolicyId === DEFAULT_RETENTION_SENTINEL ? {} : destination.retention,
            retentionPolicyId: destination.retentionPolicyId === DEFAULT_RETENTION_SENTINEL ? null : destination.retentionPolicyId || null,
        })),
        encryptionProfileId: values.encryptionProfileId === NO_ENCRYPTION ? "" : values.encryptionProfileId,
        namingTemplateId: values.namingTemplateId || null,
        compression: values.compression,
        pgCompression,
        notificationIds: values.notificationIds,
        notificationEvents: values.notificationEvents.join("|") || ALL_EVENTS.join("|"),
        notificationTemplateIds: values.notificationTemplateIds,
        skipVerification: values.skipVerification,
        // Only folders are stored incrementally, database dumps are always full.
        backupMode: withFolders ? values.backupMode : "FULL",
        fullEveryDays: values.fullEveryDays,
        verifyByHash: values.verifyByHash,
    };
}
