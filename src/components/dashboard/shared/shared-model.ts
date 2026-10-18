import type { SharedBackup, SharedBackupRef, SharedDatabase, SharedOverview, SharedPlace } from "@/services/tenant/shared-databases";
import type { SharedOnDemand } from "@/services/tenant/shared-on-demand";

/**
 * The rules of the backups shared with a tenant as plain functions: the rows of the Backups page,
 * who started them, and the words of a restore and of a backup on demand. A row is one backup of one
 * database another tenant's server gives to this tenant. A database that moved to another server is
 * one database, and its backups of the servers before belong to it.
 */

/** One backup with the database it belongs to. */
export interface SharedRow extends SharedBackup {
    database: SharedDatabase;
}

/** One key per database of a server, since two servers can hold a database of the same name. */
export function sharedKey(database: Pick<SharedDatabase, "sourceId" | "databaseName">): string {
    return `${database.sourceId}/${database.databaseName}`;
}

/** Whether a database is no longer the tenant's, or its server was deleted. Its backups of before stay to download. */
export function isFormer(database: Pick<SharedDatabase, "until" | "serverGone">): boolean {
    return database.until !== null || database.serverGone;
}

/** The tag beside a database that only downloads. */
export function formerLabel(database: Pick<SharedDatabase, "until" | "serverGone">): string {
    return database.serverGone ? "Server deleted" : "Former";
}

/** The server and name a backup was made at, when the database lived there before it moved. */
export function madeAt(row: Pick<SharedRow, "sourceId" | "databaseName" | "database">): SharedPlace | null {
    if (row.sourceId === row.database.sourceId && row.databaseName === row.database.databaseName) return null;
    return row.database.movedFrom.find((place) => place.sourceId === row.sourceId && place.databaseName === row.databaseName) ?? null;
}

/** "made as shop on Old MySQL", for a backup of a database that moved since. */
export function madeAtText(place: Pick<SharedPlace, "serverName" | "databaseName">, databaseName: string): string {
    return place.databaseName === databaseName ? `made on ${place.serverName}` : `made as ${place.databaseName} on ${place.serverName}`;
}

/** The backups with their databases, newest first. A backup of a database not listed is left out. */
export function rowsOf(overview: SharedOverview): SharedRow[] {
    const databases = new Map(overview.databases.map((database) => [sharedKey(database), database]));
    return overview.backups
        .flatMap((backup) => {
            const database = databases.get(backup.databaseKey);
            return database ? [{ ...backup, database }] : [];
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** What the actions name a backup by. */
export function backupRef(row: Pick<SharedRow, "sourceId" | "databaseName" | "id">): SharedBackupRef {
    return { sourceId: row.sourceId, databaseName: row.databaseName, backupId: row.id };
}

/** The other databases of the server a restore goes into that the tenant holds now, which it leaves alone. */
export function othersOnServer(databases: readonly SharedDatabase[], row: Pick<SharedRow, "database">): SharedDatabase[] {
    return databases.filter((database) => database.sourceId === row.database.sourceId && database.databaseName !== row.database.databaseName && !isFormer(database));
}

/** Who started a backup: the provider by its schedule, or someone of the tenant with Back up now. */
export function starterOf(row: Pick<SharedRow, "requestedBy" | "database">): { kind: "schedule" | "request"; label: string; who: string } {
    if (!row.requestedBy) return { kind: "schedule", label: "Schedule", who: row.database.providerName };
    return { kind: "request", label: "Back up now", who: row.requestedBy.name ?? "a removed account" };
}

/** The toast once a restore runs. */
export function restoreStarted(row: Pick<SharedRow, "database">): string {
    return `The restore of ${row.database.databaseName} started`;
}

/** Whether the tenant may start a backup of a database now: its provider allows it, the day has room and none runs. */
export function canBackUpNow(onDemand: SharedOnDemand | null): boolean {
    return onDemand !== null && onDemand.active === null && onDemand.usedToday < onDemand.perDay;
}

/** How many backups on demand are left today, like "2 of 3 left today". */
export function onDemandLine(onDemand: SharedOnDemand): string {
    if (onDemand.active) return onDemand.active.state === "running" ? "A backup runs now" : "A backup waits for its turn";
    const left = Math.max(0, onDemand.perDay - onDemand.usedToday);
    return left === 0 ? `All ${onDemand.perDay} of today used, the next one tomorrow` : `${left} of ${onDemand.perDay} left today`;
}
