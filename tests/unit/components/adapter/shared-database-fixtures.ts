import type { AdapterConfig } from "@/components/adapter/types";
import type { ProvidedDatabase, SharedServerTerms } from "@/services/sharing/shared-server-rows";
import type { SharedBackup, SharedDatabase } from "@/services/tenant/shared-databases";
import type { SharedOnDemand } from "@/services/tenant/shared-on-demand";

/** Rows of the list of databases as the Connections page gets them, for the tests of its parts. */

export function connection(id: string, extra: Partial<AdapterConfig> = {}): AdapterConfig {
    return {
        id, name: id, adapterId: "postgres", type: "database", config: "{}", createdAt: "2026-09-01T00:00:00.000Z",
        lastHealthCheck: "2026-10-17T10:00:00.000Z", lastStatus: "ONLINE",
        overview: { usedBy: { jobs: 1, templates: 0 }, lastBackup: null, health: [], checksPassed: 100, latencyMs: 4, credentialName: null, retentionName: null, stored: null, lastSent: null },
        ...extra,
    };
}

export function sharedBackup(id: string, databaseName: string, createdAt: string, extra: Partial<SharedBackup> = {}): SharedBackup {
    return {
        id, sourceId: "srv-mysql", databaseName, databaseKey: `srv-mysql/${databaseName}`, createdAt, encrypted: true,
        verification: { at: createdAt, passed: true }, dump: { stored: 412_000_000, unpacked: 900_000_000 }, requestedBy: null, ...extra,
    };
}

/** One database of the server the tenant holds, with what its provider allows of Back up now and its newest backup. */
export function provided(databaseName: string, onDemand: SharedOnDemand | null = null, newest: SharedBackup | null = null): ProvidedDatabase {
    const database: SharedDatabase = {
        sourceId: "srv-mysql", serverName: "Shared MySQL 8.0", adapterId: "mysql", databaseName, providerName: "Skyfay Hosting",
        since: "2026-10-01T00:00:00.000Z", until: null, serverGone: false, serverDeletedAt: null, movedFrom: [], onDemand,
    };
    return { database, backups: newest ? 1 : 0, lastBackup: newest ? { at: newest.createdAt, passed: true } : null, newest };
}

export function serverTerms(databases: ProvidedDatabase[], extra: Partial<SharedServerTerms> = {}): SharedServerTerms {
    const newest = databases.flatMap((entry) => (entry.newest ? [entry.newest] : [])).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return {
        sourceId: "srv-mysql", serverName: "Shared MySQL 8.0", providerName: "Skyfay Hosting", databases,
        backups: databases.reduce((sum, entry) => sum + entry.backups, 0), lastBackup: newest ? { at: newest.createdAt, passed: true } : null,
        schedule: "0 2 * * *", rules: [], ...extra,
    };
}

/** A server of another tenant as a row, which carries no health and no job of the tenant. */
export function sharedRow(databases: ProvidedDatabase[], extra: Partial<SharedServerTerms> = {}): AdapterConfig {
    const terms = serverTerms(databases, extra);
    return {
        id: `shared:${terms.sourceId}`, name: terms.serverName, adapterId: "mysql", type: "database", config: "{}",
        createdAt: "2026-10-01T00:00:00.000Z", lastHealthCheck: null, lastStatus: "ONLINE", overview: null, sharedServer: terms,
    };
}
