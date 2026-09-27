import { compareVersions } from "@/lib/utils";
import type { VersionPeriod } from "./database-explorer-types";

/**
 * The rules of the Servers tab as plain functions: the versions a server ran, which backups
 * belong to which of them, and whether a server is too old for the backups of its engine.
 */

export interface HistoryRow {
    previousVersion: string | null;
    newVersion: string;
    detectedAt: Date;
}

/**
 * The versions a server ran, newest first, each from when the hourly check read it until the next
 * one came. A server without a history yet has its current version, since an unknown time.
 */
export function versionPeriods(rows: HistoryRow[], current: string | null): Omit<VersionPeriod, "kept" | "made">[] {
    const oldestFirst = [...rows].sort((a, b) => a.detectedAt.getTime() - b.detectedAt.getTime());
    const periods: Omit<VersionPeriod, "kept" | "made">[] = oldestFirst.map((row, index) => ({
        version: row.newVersion,
        since: row.detectedAt.toISOString(),
        until: oldestFirst[index + 1]?.detectedAt.toISOString() ?? null,
        change: row.previousVersion
            ? { kind: compareVersions(row.newVersion, row.previousVersion) < 0 ? "down" : "up", from: row.previousVersion }
            : null,
    }));
    if (periods.length === 0 && current) periods.push({ version: current, since: null, until: null, change: null });
    return periods.reverse();
}

/** Whether a moment lies in a version, which runs from its start up to the next one. */
export function inPeriod(period: Pick<VersionPeriod, "since" | "until">, at: number): boolean {
    const start = period.since ? Date.parse(period.since) : Number.NEGATIVE_INFINITY;
    const end = period.until ? Date.parse(period.until) : Number.POSITIVE_INFINITY;
    return at >= start && at < end;
}

/** A kept backup of a server: when it was made and the version of the server it records. */
export interface KeptBackup {
    serverId: string;
    createdAt: string;
    engineVersion: string | null;
}

/**
 * The newest kept backup of the same engine a server is too old to take, with the server that
 * made it. A backup restores only onto the same version or a newer one.
 */
export function behindOf<S extends { id: string; name: string; adapterId: string; version: string | null }>(
    server: S,
    servers: S[],
    kept: KeptBackup[],
): { version: string; serverName: string } | null {
    if (!server.version) return null;
    const sameEngine = new Map(servers.filter((entry) => entry.adapterId === server.adapterId).map((entry) => [entry.id, entry]));
    let newest: { version: string; serverName: string } | null = null;
    for (const backup of kept) {
        const maker = sameEngine.get(backup.serverId);
        if (!maker || !backup.engineVersion) continue;
        if (compareVersions(backup.engineVersion, server.version) <= 0) continue;
        if (!newest || compareVersions(backup.engineVersion, newest.version) > 0) newest = { version: backup.engineVersion, serverName: maker.name };
    }
    return newest;
}
