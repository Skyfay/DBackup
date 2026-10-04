import prisma from "@/lib/prisma";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { normalizeDatabaseMapping } from "@/services/restore/database-mapping";
import type { FileRestoreTarget } from "@/services/restore/file-restore";
import type { RestoreScope } from "@/services/restore/types";

/**
 * What the audit log names of a backup and of what was done with it. Entries keep names, since an
 * id says nothing once the destination, the job or the connection is gone. Reads never throw, a
 * failed one leaves the entry shorter and the action it records goes on.
 */

const log = logger.child({ service: "BackupAudit" });

export interface BackupAuditDetails {
    /** The path of the backup at its destination. */
    file: string;
    destination?: string;
    /** The job whose folder the backup lies in, while a job of that name exists. */
    job?: string;
}

/** The folder of the job a backup lies in, as the runner writes it: `<job>/<file>` or `<job>/<chain>/<file>`. */
function jobFolderOf(file: string): string | null {
    // Some routes hand the path on from an unchecked body.
    if (typeof file !== "string") return null;
    const parts = file.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    // Older versions put every job folder under a shared `backups` folder.
    return parts[0] === "backups" && parts.length > 2 ? parts[1] : parts[0];
}

/** The names of connections by id, the ones that could not be read left out. */
async function connectionNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    try {
        const rows = await prisma.adapterConfig.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
        return new Map(rows.map((row) => [row.id, row.name]));
    } catch (error) {
        log.warn("Could not name connections for the audit log", { count: ids.length }, wrapError(error));
        return new Map();
    }
}

/** The name of a destination, for an entry about several backups at it. Null when it could not be read. */
export async function destinationAuditName(destinationId: string): Promise<string | null> {
    return (await connectionNames([destinationId])).get(destinationId) ?? null;
}

/** The job a backup belongs to, by the folder it lies in. Null when no job has that name any more. */
async function jobOfFolder(folder: string | null): Promise<string | null> {
    if (!folder) return null;
    try {
        const job = await prisma.job.findFirst({ where: { name: folder }, select: { name: true } });
        return job?.name ?? null;
    } catch (error) {
        log.warn("Could not name the job of a backup for the audit log", {}, wrapError(error));
        return null;
    }
}

/** A backup by its path, the name of its destination and the job it belongs to. */
export async function backupAuditDetails(destinationId: string, file: string): Promise<BackupAuditDetails> {
    const [names, job] = await Promise.all([connectionNames([destinationId]), jobOfFolder(jobFolderOf(file))]);
    const destination = names.get(destinationId);
    return { file, ...(destination ? { destination } : {}), ...(job ? { job } : {}) };
}

/** A restore as the request asked for it. Everything past the backup comes unchecked from the body. */
export interface RestoreAuditInput {
    destinationId: string;
    file: string;
    executionId?: string;
    scope?: RestoreScope;
    targetSourceId?: unknown;
    targetDatabaseName?: unknown;
    /** An object of renames or a list of entries. */
    databaseMapping?: unknown;
    /** Entries with the connection each folder goes into. */
    directoryMapping?: unknown;
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

/** The databases a restore picked, with the name each one got when it was renamed. None when it restores all of them. */
function restoredDatabases(mapping: unknown, targetDatabaseName: unknown): string[] {
    let entries: ReturnType<typeof normalizeDatabaseMapping>;
    try {
        entries = normalizeDatabaseMapping(mapping);
    } catch {
        entries = undefined;
    }
    if (entries) {
        return entries
            .filter((entry) => entry.selected)
            .map((entry) => (entry.targetName === entry.originalName ? entry.originalName : `${entry.originalName} as ${entry.targetName}`));
    }
    const single = text(targetDatabaseName);
    return single ? [single] : [];
}

/** The connections the picked folders go into. */
function folderTargetsOf(mapping: unknown): string[] {
    if (!Array.isArray(mapping)) return [];
    return mapping.flatMap((entry: unknown) => {
        if (!entry || typeof entry !== "object") return [];
        const { selected, targetConfigId } = entry as Record<string, unknown>;
        const id = selected === true ? text(targetConfigId) : null;
        return id ? [id] : [];
    });
}

/** A restore of a backup: the backup, the connections it went into and the databases it picked. */
export async function restoreAuditDetails(input: RestoreAuditInput): Promise<Record<string, unknown>> {
    const withDatabases = input.scope !== "files";
    const withFolders = input.scope !== "databases";
    const source = withDatabases ? text(input.targetSourceId) : null;
    const targetIds = [...new Set([...(source ? [source] : []), ...(withFolders ? folderTargetsOf(input.directoryMapping) : [])])];

    const [backup, names] = await Promise.all([backupAuditDetails(input.destinationId, input.file), connectionNames(targetIds)]);
    const target = targetIds.flatMap((id) => names.get(id) ?? []).join(", ");
    const databases = withDatabases ? restoredDatabases(input.databaseMapping, input.targetDatabaseName) : [];

    return {
        action: "restore",
        ...backup,
        ...(target ? { target } : {}),
        ...(databases.length > 0 ? { databases } : {}),
        ...(input.executionId ? { executionId: input.executionId } : {}),
    };
}

/** Where a restore of files wrote them: back where they came from, or a folder of a connection. */
export async function fileRestoreTarget(target: Exclude<FileRestoreTarget, { kind: "download" }>): Promise<{ target?: string; targetPath?: string }> {
    if (target.kind === "origin") return { target: "Original location" };
    const name = (await connectionNames([target.configId])).get(target.configId);
    return { ...(name ? { target: name } : {}), targetPath: target.basePath };
}
