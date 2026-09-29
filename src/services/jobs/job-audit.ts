import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { diffFields, type AuditField, type AuditValue } from "@/lib/core/audit-diff";
import type { AuditChange } from "@/lib/core/audit-types";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

/**
 * What the audit log keeps of a job: every setting the job form changes, as a person reads it,
 * with names in place of ids. A snapshot before a save and one after it give the changes of the
 * save. Reads never throw, a failed one leaves the entry shorter and the save goes on.
 */

const log = logger.child({ service: "JobAudit" });

/** The settings in the order of the form, each with the label the form gives it. The name is kept apart, see jobChangeDetails. */
export const JOB_AUDIT_FIELDS = {
    enabled: { label: "Runs on its schedule" },
    schedule: { label: "When it runs" },
    schedulePreset: { label: "Schedule preset" },
    source: { label: "Database" },
    databases: { label: "Databases" },
    folders: { label: "Folders" },
    leavesOut: { label: "Leaves out" },
    stopsContainers: { label: "Stops containers while reading" },
    backupMode: { label: "What a backup stores" },
    fullEveryDays: { label: "Full backup every" },
    verifyByHash: { label: "Detect changes by content" },
    destinations: { label: "Destinations" },
    compression: { label: "Compression" },
    dumpCompression: { label: "Dump compression" },
    encryption: { label: "Encryption key" },
    notificationTemplates: { label: "Notification templates" },
    notificationChannels: { label: "Notification channels" },
    notifyAfter: { label: "Notify" },
    fileNames: { label: "File names" },
    integrityChecks: { label: "Integrity checks" },
} satisfies Record<string, AuditField>;

export type JobAuditKey = keyof typeof JOB_AUDIT_FIELDS;

/** A job as the audit log reads it: its name and every setting of JOB_AUDIT_FIELDS. */
export type JobAuditSnapshot = { name: string } & Record<JobAuditKey, AuditValue>;

/** What an entry of a saved job holds. */
export interface JobChangeDetails {
    name: string;
    renamedFrom?: string;
    changes: AuditChange[];
}

const auditSelect = {
    name: true,
    schedule: true,
    enabled: true,
    databases: true,
    compression: true,
    pgCompression: true,
    notificationEvents: true,
    skipVerification: true,
    backupMode: true,
    fullEveryDays: true,
    verifyByHash: true,
    source: { select: { name: true, adapterId: true } },
    schedulePreset: { select: { name: true, schedule: true } },
    encryptionProfile: { select: { name: true } },
    namingTemplate: { select: { name: true } },
    destinations: {
        select: { retention: true, retentionPolicy: { select: { name: true } }, config: { select: { name: true } } },
        orderBy: { priority: "asc" },
    },
    sources: {
        select: {
            path: true,
            excludePatterns: true,
            stopContainers: true,
            config: { select: { name: true, adapterId: true } },
            excludePatternPresets: { select: { name: true } },
        },
        orderBy: { priority: "asc" },
    },
    notifications: { select: { name: true } },
    notificationTemplates: { select: { template: { select: { name: true } } }, orderBy: { priority: "asc" } },
} satisfies Prisma.JobSelect;

type JobAuditRow = Prisma.JobGetPayload<{ select: typeof auditSelect }>;

const COMPRESSION: Record<string, string> = { NONE: "None", GZIP: "Gzip", BROTLI: "Brotli" };
const DUMP_COMPRESSION: Record<string, string> = { GZIP: "Gzip", LZ4: "LZ4", ZSTD: "Zstd" };
const BACKUP_MODES: Record<string, string> = { FULL: "Every backup in full", INCREMENTAL: "Only what changed" };
const EVENTS = ["SUCCESS", "PARTIAL", "FAILED"] as const;
const EVENT_NAMES: Record<string, string> = { SUCCESS: "Success", PARTIAL: "Partial", FAILED: "Failed" };

function stringList(raw: string): string[] {
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
    } catch {
        return [];
    }
}

/** Picked databases, or all of them for a job that names none. Nothing for a job without a database. */
function databasesOf(row: JobAuditRow): AuditValue {
    if (!row.source) return null;
    const picked = stringList(row.databases);
    return picked.length > 0 ? picked : "All databases";
}

const folderOf = (source: JobAuditRow["sources"][number]) => `${source.path} on ${source.config.name}`;

/** Each pattern and preset a folder leaves out, with the folder, so a second folder changes nothing of the first. */
function leavesOutOf(row: JobAuditRow): string[] {
    return row.sources.flatMap((source) => [
        ...stringList(source.excludePatterns).map((pattern) => `${pattern} in ${folderOf(source)}`),
        ...source.excludePatternPresets.map((preset) => `${preset.name} preset in ${folderOf(source)}`),
    ]);
}

/** Only Docker volumes stop anything, for every other folder the setting does nothing. */
function stopsContainersOf(row: JobAuditRow): string[] {
    return row.sources.filter((source) => source.config.adapterId === "docker-volume" && source.stopContainers).map(folderOf);
}

/** The policy a destination follows, the default policy, or the inline setting of a job saved before policies. */
function retentionOf(destination: JobAuditRow["destinations"][number]): string {
    if (destination.retentionPolicy) return destination.retentionPolicy.name;
    const raw = destination.retention.trim();
    return !raw || raw === "{}" ? "Default policy" : "custom";
}

/** How pg_dump compresses, for a PostgreSQL source only. Older jobs store nothing, which pg_dump runs as Gzip at 6. */
function dumpCompressionOf(row: JobAuditRow): string | null {
    if (row.source?.adapterId !== "postgres") return null;
    if (!row.pgCompression) return "Gzip, level 6";
    if (row.pgCompression === "NONE") return "None";
    const [algo, level] = row.pgCompression.split(":");
    const name = DUMP_COMPRESSION[algo] ?? algo;
    return level ? `${name}, level ${level}` : name;
}

/** After which runs the channels of the job hear about one. The older stored forms read the same as the new ones. */
function notifyAfterOf(row: JobAuditRow): string | null {
    if (row.notifications.length === 0) return null;
    const raw = row.notificationEvents;
    const events = new Set<string>(
        raw === "ALWAYS" ? EVENTS : raw === "FAILURE_ONLY" ? ["PARTIAL", "FAILED"] : raw === "SUCCESS_ONLY" ? ["SUCCESS"] : raw.split("|")
    );
    if (EVENTS.every((event) => events.has(event))) return "After every run";
    if (events.size === 2 && events.has("PARTIAL") && events.has("FAILED")) return "When a run fails or is partial";
    if (events.size === 1 && events.has("SUCCESS")) return "When a run succeeds";
    return EVENTS.filter((event) => events.has(event)).map((event) => EVENT_NAMES[event]).join(", ") || null;
}

function snapshotOf(row: JobAuditRow): JobAuditSnapshot {
    // The chain settings only mean something while the job stores changes only.
    const incremental = row.backupMode === "INCREMENTAL";
    return {
        name: row.name,
        enabled: row.enabled,
        schedule: row.schedulePreset?.schedule ?? row.schedule,
        schedulePreset: row.schedulePreset?.name ?? null,
        source: row.source?.name ?? null,
        databases: databasesOf(row),
        folders: row.sources.map(folderOf),
        leavesOut: leavesOutOf(row),
        stopsContainers: stopsContainersOf(row),
        backupMode: BACKUP_MODES[row.backupMode] ?? row.backupMode,
        fullEveryDays: incremental ? `${row.fullEveryDays} ${row.fullEveryDays === 1 ? "day" : "days"}` : null,
        verifyByHash: incremental ? row.verifyByHash : null,
        destinations: row.destinations.map((destination) => `${destination.config.name} (${retentionOf(destination)})`),
        compression: COMPRESSION[row.compression] ?? row.compression,
        dumpCompression: dumpCompressionOf(row),
        encryption: row.encryptionProfile?.name ?? null,
        notificationTemplates: row.notificationTemplates.map((entry) => entry.template.name),
        notificationChannels: row.notifications.map((channel) => channel.name),
        notifyAfter: notifyAfterOf(row),
        fileNames: row.namingTemplate?.name ?? "Default template",
        integrityChecks: !row.skipVerification,
    };
}

/** A job with its settings as the audit log reads them. Null when the job is gone or could not be read. */
export async function jobAuditSnapshot(id: string): Promise<JobAuditSnapshot | null> {
    try {
        const row = await prisma.job.findUnique({ where: { id }, select: auditSelect });
        return row ? snapshotOf(row) : null;
    } catch (error) {
        log.warn("Could not read a job for the audit log", { jobId: id }, wrapError(error));
        return null;
    }
}

/** What a save of a job changed: its name, the name it had before a rename, and every other setting that moved. */
export function jobChangeDetails(before: JobAuditSnapshot, after: JobAuditSnapshot): JobChangeDetails {
    return {
        name: after.name,
        ...(before.name !== after.name ? { renamedFrom: before.name } : {}),
        changes: diffFields<JobAuditKey>(before, after, JOB_AUDIT_FIELDS),
    };
}

/** The name of a job, for an entry about it. Null when the job is gone or could not be read. */
export async function jobAuditName(id: string): Promise<string | null> {
    try {
        const job = await prisma.job.findUnique({ where: { id }, select: { name: true } });
        return job?.name ?? null;
    } catch (error) {
        log.warn("Could not read the name of a job for the audit log", { jobId: id }, wrapError(error));
        return null;
    }
}
