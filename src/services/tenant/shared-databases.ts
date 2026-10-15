import path from "path";
import prisma from "@/lib/prisma";
import { generateFileDownloadToken } from "@/lib/auth/download-tokens";
import { NotFoundError, ValidationError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { getTempDir } from "@/lib/temp-dir";
import { runAsSystem } from "@/lib/tenant/context";
import type { DatabasePlace } from "@/lib/tenant/database-owner";
import { writeDatabaseDump } from "@/services/restore/archive-download";
import { restoreService } from "@/services/restore/restore-service";
import { factsOf, serverBackupFiles, sharedBackupsOf, sharedDumpName, type OwnerFacts, type ServerBackupFile, type SharedBackupRecord } from "./shared-backups";
import { dumpSizes, type DumpSize } from "./shared-dump-sizes";
import { onDemandStates, type SharedOnDemand } from "./shared-on-demand";
import { groupOfBackup, placeKey, restoreTarget, tenantPlaces, type HeldPlace, type TenantPlaces } from "./shared-places";

/**
 * What a customer sees of the databases given to them on a shared server: those databases, their
 * backups from the time they were theirs, a download of the one dump and a restore into the same
 * database. The server, its job, its destinations and the other databases belong to another tenant,
 * so this module reads across tenants on purpose, in the system scope, and hands out nothing but
 * the one database: no destination, no path of a backup and no size but the one of its dump. Every
 * action checks the backup again from scratch, never from what the browser sends along.
 *
 * A database that moved to another server is one database with the backups of every server it lived
 * on, and a backup of an earlier server restores into it at its place of now. A database of a server
 * whose connection was deleted keeps its backups to download and restores none.
 */

const log = logger.child({ service: "SharedDatabases" });

/** Where a database lived before it moved to its place of now. */
export interface SharedPlace {
    sourceId: string;
    serverName: string;
    databaseName: string;
    from: string;
    /** When it moved on, or stopped being theirs there. */
    until: string | null;
    serverGone: boolean;
}

export interface SharedDatabase {
    sourceId: string;
    serverName: string;
    adapterId: string;
    databaseName: string;
    /** The tenant that runs the server and its backups. */
    providerName: string;
    /** When the customer's backups of it start, on the first server it lived on. */
    since: string;
    /** When it stopped being theirs, null while it is. Its backups from before stay. */
    until: string | null;
    /** The connection of its server was deleted: its backups only download. */
    serverGone: boolean;
    /** When the server was deleted, if it was. */
    serverDeletedAt: string | null;
    /** The servers and names it lived on before it moved here, oldest first. */
    movedFrom: SharedPlace[];
    /** Backups the customer may start of it, null where the provider allows none or it is not theirs now. */
    onDemand: SharedOnDemand | null;
}

export interface SharedBackup {
    /** Names the backup in the actions, without saying where it lies. */
    id: string;
    /** The server and the name of the database where the backup was made, which a moved database left since. */
    sourceId: string;
    databaseName: string;
    /** The database it belongs to now, the `sourceId/databaseName` of a SharedDatabase. */
    databaseKey: string;
    createdAt: string;
    encrypted: boolean;
    verification: { at: string; passed: boolean } | null;
    /** The size of the dump of this database alone, null until it was read from the backup. */
    dump: DumpSize | null;
}

/** Everything the tab Shared with you shows. */
export interface SharedOverview {
    databases: SharedDatabase[];
    /** Every backup of every database, newest first. */
    backups: SharedBackup[];
}

/** One backup of one database, as an action names it: the place it was made at and its id. */
export interface SharedBackupRef {
    sourceId: string;
    databaseName: string;
    backupId: string;
}

/** Whether any database of another tenant's server was ever given to the tenant, for the Backups page. */
export function hasSharedDatabases(tenantId: string): Promise<boolean> {
    return runAsSystem(async () => {
        if ((await prisma.databaseAssignment.count({ where: { tenantId } })) > 0) return true;
        // A rule counts once it gives a database, which only the list of the server tells.
        if ((await prisma.databaseAssignmentRule.count({ where: { tenantId } })) === 0) return false;
        return (await listSharedDatabases(tenantId)).length > 0;
    });
}

/** The databases of the tenant from its places: one per database, with the places it lived before. */
async function databasesOf(tenantId: string, held: TenantPlaces, now: Date): Promise<SharedDatabase[]> {
    const providers = new Map((await prisma.tenant.findMany({
        where: { id: { in: [...new Set([...held.servers.values()].map((server) => server.tenantId))] } },
        select: { id: true, name: true },
    })).map((tenant) => [tenant.id, tenant.name]));
    const serverOf = (sourceId: string) => held.servers.get(sourceId);

    const groups = new Map<string, HeldPlace[]>();
    for (const [key, place] of held.places) {
        const group = held.groupOf.get(key) ?? key;
        groups.set(group, [...(groups.get(group) ?? []), place]);
    }

    const databases: (SharedDatabase & { perDay: number | null })[] = [];
    for (const [key, members] of groups) {
        const place = held.places.get(key) ?? members[0];
        const server = serverOf(place.sourceId);
        const earlier = members.filter((member) => member !== place).sort((a, b) => a.from.getTime() - b.from.getTime());
        databases.push({
            sourceId: place.sourceId,
            serverName: server?.name ?? "A former server",
            adapterId: server?.adapterId ?? "",
            databaseName: place.databaseName,
            providerName: (server && providers.get(server.tenantId)) ?? "Another tenant",
            since: new Date(Math.min(...members.map((member) => member.from.getTime()))).toISOString(),
            until: place.until?.toISOString() ?? null,
            serverGone: !server?.live,
            serverDeletedAt: server?.deletedAt?.toISOString() ?? null,
            movedFrom: earlier.map((member) => ({
                sourceId: member.sourceId,
                serverName: serverOf(member.sourceId)?.name ?? "A former server",
                databaseName: member.databaseName,
                from: member.from.toISOString(),
                until: member.until?.toISOString() ?? null,
                serverGone: !serverOf(member.sourceId)?.live,
            })),
            onDemand: null,
            perDay: place.until === null ? place.onDemandPerDay : null,
        });
    }

    const allowing = databases.flatMap((database) => (database.perDay !== null && !database.serverGone ? [{ ...database, perDay: database.perDay }] : []));
    const states = await onDemandStates(tenantId, allowing, now);
    return databases
        .map(({ perDay: _perDay, ...database }) => ({ ...database, onDemand: states.get(placeKey(database)) ?? null }))
        .sort((a, b) => a.serverName.localeCompare(b.serverName) || a.databaseName.localeCompare(b.databaseName));
}

/** The databases given to a tenant, current and former ones, by server and name. */
export function listSharedDatabases(tenantId: string, now = new Date()): Promise<SharedDatabase[]> {
    return runAsSystem(async () => databasesOf(tenantId, await tenantPlaces(tenantId, now), now));
}

/** The backups made at some places, with the copies they lie in, which never leave this module. */
async function recordsOf(tenantId: string, places: readonly DatabasePlace[]): Promise<SharedBackupRecord[]> {
    const servers = new Map<string, { files: ServerBackupFile[]; facts: OwnerFacts }>();
    const records: SharedBackupRecord[] = [];
    for (const place of places) {
        let server = servers.get(place.sourceId);
        if (!server) {
            const [files, facts] = await Promise.all([serverBackupFiles(place.sourceId), factsOf(place.sourceId)]);
            server = { files, facts };
            servers.set(place.sourceId, server);
        }
        records.push(...sharedBackupsOf(tenantId, place.sourceId, place.databaseName, server.files, server.facts));
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The databases given to the tenant and every backup of them from their time, with the size of each dump. */
export function sharedOverview(tenantId: string, now = new Date()): Promise<SharedOverview> {
    return runAsSystem(async () => {
        const held = await tenantPlaces(tenantId, now);
        const databases = await databasesOf(tenantId, held, now);
        const records = await recordsOf(tenantId, [...held.places.values()]);
        const sizes = await dumpSizes(records);
        return {
            databases,
            backups: records.map(({ copies: _copies, ...record }) => ({
                ...record,
                databaseKey: groupOfBackup(held, tenantId, record, record.createdAt),
                dump: sizes.get(record.id) ?? null,
            })),
        };
    });
}

/** The backup an action names, checked again, or a NotFoundError for anything else. */
async function checkedBackup(tenantId: string, ref: SharedBackupRef): Promise<SharedBackupRecord> {
    const backup = (await recordsOf(tenantId, [ref])).find((entry) => entry.id === ref.backupId);
    if (!backup || backup.copies.length === 0) throw new NotFoundError("Backup", ref.backupId);
    return backup;
}

/**
 * Pulls the dump of the one database out of a backup into a temp file, for the browser to collect
 * with the token through `GET /api/storage/[id]/download?token=`, which only the user who asked for
 * it gets. A copy that cannot be read hands over to the next one.
 */
export function prepareSharedDownload(tenantId: string, userId: string, ref: SharedBackupRef): Promise<{ token: string; storageId: string; fileName: string }> {
    return runAsSystem(async () => {
        const backup = await checkedBackup(tenantId, ref);
        let failure: unknown = null;
        for (const copy of backup.copies) {
            const tempFile = path.join(getTempDir(), `shared_${backup.id}_${Date.now()}`);
            try {
                const written = await writeDatabaseDump(
                    {
                        storageConfigId: copy.destinationId,
                        file: copy.file,
                        database: ref.databaseName,
                        // The key the backup names, never a search through the keys of every tenant.
                        ...(copy.profileId ? { keyOverride: { profileId: copy.profileId } } : {}),
                    },
                    tempFile
                );
                const fileName = sharedDumpName(copy.file, written.fileName, backup.createdAt);
                const token = generateFileDownloadToken({ storageId: copy.destinationId, file: copy.file, userId, tempFile, fileName, contentType: "application/octet-stream" });
                return { token, storageId: copy.destinationId, fileName };
            } catch (error: unknown) {
                failure = error;
                log.warn("A copy of a shared backup could not be read", { destinationId: copy.destinationId }, wrapError(error));
            }
        }
        throw failure ?? new NotFoundError("Backup", ref.backupId);
    });
}

/**
 * Restores the one database of a backup into the same database on its server, or where it moved to
 * since, under its name there. The run shows in the customer's history. Nothing else of the backup
 * is restored, and no other target is possible. The backup has to be from the customer's time and
 * the database theirs now on a server that exists, so a former customer never writes over a database
 * that belongs to someone else since.
 */
export async function restoreSharedBackup(tenantId: string, ref: SharedBackupRef, triggerLabel: string, now = new Date()): Promise<{ executionId: string; target: DatabasePlace }> {
    const { backup, target } = await runAsSystem(async () => {
        const checked = await checkedBackup(tenantId, ref);
        const found = await restoreTarget(tenantId, ref, checked.createdAt, now);
        if (!found.target) throw new ValidationError(found.reason ?? "This backup can only be downloaded.");
        return { backup: checked, target: found.target };
    });
    // A copy whose check passed comes first.
    const [copy] = backup.copies;
    const result = await restoreService.restoreShared(
        {
            storageConfigId: copy.destinationId,
            file: copy.file,
            scope: "databases",
            targetSourceId: target.sourceId,
            databaseMapping: [{ originalName: ref.databaseName, targetName: target.databaseName, selected: true }],
            ...(copy.profileId ? { keyOverride: { profileId: copy.profileId } } : {}),
            triggerInfo: { type: "Manual", label: triggerLabel },
            shared: { databaseName: target.databaseName },
        },
        tenantId
    );
    return { executionId: result.executionId, target };
}
