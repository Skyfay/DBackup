import type { SharedBackup, SharedBackupRef, SharedDatabase, SharedOverview, SharedPlace } from "@/services/tenant/shared-databases";
import type { SharedOnDemand } from "@/services/tenant/shared-on-demand";

/**
 * The rules of the tab Shared with you as plain functions: the rows of the list, its numbers and
 * filters, and the words of a restore and of a backup on demand. A row is one backup of one
 * database another tenant's server gives to this tenant. A database that moved to another server is
 * one database, and its backups of the servers before belong to it.
 */

/** One backup with the database it belongs to. */
export interface SharedRow extends SharedBackup {
    database: SharedDatabase;
}

export type SharedState = "current" | "former";

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

export const stateOf = (row: SharedRow): SharedState => (isFormer(row.database) ? "former" : "current");

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

export function countOf(value: number, noun: string, plural = `${noun}s`): string {
    return `${value.toLocaleString()} ${value === 1 ? noun : plural}`;
}

export interface SharedSummary {
    current: number;
    former: number;
    backups: number;
    /** The newest dump of each current database together, null while no size of them is read. */
    newestDumps: number | null;
    /** Some newest dump has no size yet. */
    sizesMissing: boolean;
    newest: SharedRow | null;
    /** The backups whose last check failed. */
    failed: number;
    providers: string[];
    servers: number;
}

/** The numbers above the list, of the rows the filters leave and the databases they belong to. */
export function summarize(rows: readonly SharedRow[], databases: readonly SharedDatabase[]): SharedSummary {
    const newestOf = new Map<string, SharedRow>();
    for (const row of rows) {
        const key = sharedKey(row.database);
        if (!newestOf.has(key)) newestOf.set(key, row);
    }
    const currentNewest = [...newestOf.values()].filter((row) => !isFormer(row.database));
    const sized = currentNewest.filter((row) => row.dump !== null);
    return {
        current: databases.filter((database) => !isFormer(database)).length,
        former: databases.filter(isFormer).length,
        backups: rows.length,
        newestDumps: sized.length > 0 ? sized.reduce((sum, row) => sum + (row.dump?.stored ?? 0), 0) : null,
        sizesMissing: sized.length < currentNewest.length,
        newest: rows[0] ?? null,
        failed: rows.filter((row) => row.verification?.passed === false).length,
        providers: [...new Set(databases.map((database) => database.providerName))].sort((a, b) => a.localeCompare(b)),
        servers: new Set(databases.map((database) => database.sourceId)).size,
    };
}

/** The databases a filter can pick, by server, current ones first. */
export function databaseOptions(databases: readonly SharedDatabase[]): { value: string; label: string; group: string }[] {
    return [...databases]
        .sort((a, b) => a.serverName.localeCompare(b.serverName) || Number(isFormer(a)) - Number(isFormer(b)) || a.databaseName.localeCompare(b.databaseName))
        .map((database) => ({ value: sharedKey(database), label: database.databaseName, group: database.serverName }));
}

/** The servers a filter can pick, by name. */
export function serverOptions(databases: readonly SharedDatabase[]): { value: string; label: string }[] {
    const servers = new Map(databases.map((database) => [database.sourceId, database.serverName]));
    return [...servers].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

/** The other databases of the server a restore goes into that the tenant holds now, which it leaves alone. */
export function othersOnServer(databases: readonly SharedDatabase[], row: Pick<SharedRow, "database">): SharedDatabase[] {
    return databases.filter((database) => database.sourceId === row.database.sourceId && database.databaseName !== row.database.databaseName && !isFormer(database));
}

/** The line under a database that is no longer the tenant's, or since when it is. */
export function heldText(database: Pick<SharedDatabase, "since" | "until">, date: (iso: string) => string): string {
    return database.until ? `Yours from ${date(database.since)} to ${date(database.until)}` : `Yours since ${date(database.since)}`;
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
