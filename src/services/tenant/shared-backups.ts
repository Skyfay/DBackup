import crypto from "crypto";
import prisma from "@/lib/prisma";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { matchesPattern, ownerAt, type AssignmentFact, type RuleFact } from "@/lib/tenant/database-owner";
import { normalizePath } from "@/services/storage/explorer-model";
import { storageService, type RichFileInfo } from "@/services/storage/storage-service";

/**
 * The backups of a shared server as plain records: every backup of the server at the destinations
 * of its tenant, read from the cached listings, and the backups of one database from the time a
 * customer held it. Both sides read them here, the owner for how many backups each database has
 * and the customer for its own, so they never count differently.
 */

/** Who a database of a server belonged to and when, as `database-owner.ts` reads it. */
export interface OwnerFacts {
    assignments: AssignmentFact[];
    rules: RuleFact[];
}

export async function factsOf(sourceId: string): Promise<OwnerFacts> {
    const [assignments, rules] = await Promise.all([
        prisma.databaseAssignment.findMany({ where: { sourceId }, select: { databaseName: true, tenantId: true, validFrom: true, validUntil: true, movedToSourceId: true, createdAt: true } }),
        prisma.databaseAssignmentRule.findMany({ where: { sourceId }, select: { id: true, pattern: true, tenantId: true, priority: true, validFrom: true, validUntil: true, createdAt: true } }),
    ]);
    return { assignments, rules };
}

/** One backup of the server as one destination lists it. */
export interface ServerBackupFile {
    destinationId: string;
    file: RichFileInfo & { createdAt: string };
}

/** Whether a row of a listing is a backup of the server, by the server it names or else by its job. */
function fromServer(file: RichFileInfo, sourceId: string, jobsOfServer: Set<string>): boolean {
    if (file.sourceId) return file.sourceId === sourceId;
    return !!file.jobId && jobsOfServer.has(file.jobId);
}

/**
 * Every backup of a server that lets one database out on its own, at every destination of the
 * server's tenant, so a backup of a job deleted since still counts. An archive of earlier versions
 * holds the whole server in one file and is left out. A deleted server that shared databases still
 * has its backups, found by the server they name.
 */
export async function serverBackupFiles(sourceId: string): Promise<ServerBackupFile[]> {
    const source = (await prisma.adapterConfig.findFirst({ where: { id: sourceId, type: "database" }, select: { tenantId: true } }))
        ?? (await prisma.sharedServer.findUnique({ where: { id: sourceId }, select: { tenantId: true } }));
    if (!source) return [];
    const [jobs, destinations] = await Promise.all([
        prisma.job.findMany({ where: { sourceId }, select: { id: true } }),
        prisma.adapterConfig.findMany({ where: { tenantId: source.tenantId, type: "storage", storageRole: STORAGE_ROLES.DESTINATION }, select: { id: true }, orderBy: { name: "asc" } }),
    ]);
    const jobsOfServer = new Set(jobs.map((job) => job.id));

    const found: ServerBackupFile[] = [];
    for (const destination of destinations) {
        // The listing of the server's tenant, never one of a customer the destination is shared with.
        const listing = await storageService.readCachedListing(destination.id, source.tenantId);
        for (const file of listing?.files ?? []) {
            if (!file.hasFileIndex || !file.createdAt || !file.databases?.length) continue;
            if (!fromServer(file, sourceId, jobsOfServer)) continue;
            found.push({ destinationId: destination.id, file: { ...file, createdAt: file.createdAt } });
        }
    }
    return found;
}

/** The key of a backup however many destinations hold it, the same at each of them. */
export const backupKeyOf = (path: string) => normalizePath(path);

/** When each database of the server was backed up, one entry per backup, for the owner's pages. */
export function backupDatesByDatabase(files: readonly ServerBackupFile[]): Map<string, string[]> {
    const seen = new Set<string>();
    const dates = new Map<string, string[]>();
    for (const { file } of files) {
        const key = backupKeyOf(file.path);
        if (seen.has(key)) continue;
        seen.add(key);
        for (const name of file.databases ?? []) {
            const list = dates.get(name);
            if (list) list.push(file.createdAt);
            else dates.set(name, [file.createdAt]);
        }
    }
    for (const list of dates.values()) list.sort();
    return dates;
}

/** A copy a shared backup can be read from. Never leaves the server. */
export interface SharedCopy {
    destinationId: string;
    file: string;
    profileId: string | null;
}

/** One backup of one database from the time a customer held it, with the copies it lies in. */
export interface SharedBackupRecord {
    /** Names the backup to the customer without its path or its destinations. */
    id: string;
    sourceId: string;
    databaseName: string;
    createdAt: string;
    encrypted: boolean;
    /** The last check of the backup, a passed one over a failed one of another copy. */
    verification: { at: string; passed: boolean } | null;
    /** A copy whose check passed first. */
    copies: SharedCopy[];
}

/** An id that names a backup of a database without saying where it lies or what it is called. */
export function sharedBackupId(sourceId: string, databaseName: string, path: string): string {
    return crypto.createHash("sha256").update(`${sourceId}\n${databaseName}\n${backupKeyOf(path)}`).digest("hex").slice(0, 32);
}

/** Whether a customer ever held the database, by its name or by a rule. */
export function everOwned(facts: OwnerFacts, tenantId: string, databaseName: string): boolean {
    return facts.assignments.some((fact) => fact.tenantId === tenantId && fact.databaseName === databaseName)
        || facts.rules.some((fact) => fact.tenantId === tenantId && matchesPattern(fact.pattern, databaseName));
}

function verificationOf(copies: readonly ServerBackupFile[]): SharedBackupRecord["verification"] {
    const checks = copies.flatMap(({ file }) => (file.verification ? [file.verification] : []));
    const passed = checks.filter((check) => check.passed).sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt))[0];
    if (passed) return { at: passed.verifiedAt, passed: true };
    const failed = checks.sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt))[0];
    return failed ? { at: failed.verifiedAt, passed: false } : null;
}

/**
 * The backups of a database a customer may see: those made while it was theirs, one per backup
 * however many destinations hold it, newest first.
 */
export function sharedBackupsOf(tenantId: string, sourceId: string, databaseName: string, files: readonly ServerBackupFile[], facts: OwnerFacts): SharedBackupRecord[] {
    if (!everOwned(facts, tenantId, databaseName)) return [];
    const byBackup = new Map<string, ServerBackupFile[]>();
    for (const entry of files) {
        if (!entry.file.databases?.includes(databaseName)) continue;
        if (ownerAt(facts.assignments, facts.rules, databaseName, new Date(entry.file.createdAt)) !== tenantId) continue;
        const key = backupKeyOf(entry.file.path);
        const list = byBackup.get(key);
        if (list) list.push(entry);
        else byBackup.set(key, [entry]);
    }

    return [...byBackup.values()]
        .map((copies): SharedBackupRecord => {
            const [first] = copies;
            const ordered = [...copies].sort((a, b) => Number(!!b.file.verification?.passed) - Number(!!a.file.verification?.passed));
            return {
                id: sharedBackupId(sourceId, databaseName, first.file.path),
                sourceId,
                databaseName,
                createdAt: first.file.createdAt,
                encrypted: copies.some(({ file }) => !!file.isEncrypted),
                verification: verificationOf(copies),
                copies: ordered.map(({ destinationId, file }) => ({ destinationId, file: file.path, profileId: file.encryptionProfileId ?? null })),
            };
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * The name a customer downloads a dump under, like `2026-10-15_0214_shop.sql`. The archive's own
 * name starts with the job of the server's tenant, so the time of the backup takes its place.
 */
export function sharedDumpName(archiveFile: string, fileName: string, createdAt: string): string {
    const base = archiveFile.split(/[\\/]/).pop() ?? archiveFile;
    const stem = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
    const dump = fileName.startsWith(`${stem}_`) ? fileName.slice(stem.length + 1) : fileName;
    const stamp = createdAt.slice(0, 16).replace("T", "_").replace(":", "");
    return `${stamp}_${dump}`;
}
