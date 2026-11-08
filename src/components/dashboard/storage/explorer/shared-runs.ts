import { rowsOf, sharedKey, starterOf, type SharedRow } from "@/components/dashboard/shared/shared-model";
import type { BackupRun, ExplorerFile } from "@/services/storage/explorer-types";
import type { SharedDatabase, SharedOverview } from "@/services/tenant/shared-databases";

/**
 * The backups of the databases another tenant's server gives to this one, as rows of the list of
 * every backup beside the tenant's own. A shared backup lies at no destination of the tenant, so it
 * has no copy and counts in no number about copies, and its job is the shared database. Plain
 * functions without React, so the rules can be tested.
 */

/** A row of the list of backups: a backup of an own job, or one of a shared database with `shared` set. */
export type ListRun = BackupRun & { shared?: SharedRow };
export type SharedRun = BackupRun & { shared: SharedRow };

export const isSharedRun = (run: ListRun): run is SharedRun => run.shared !== undefined;

/** What the key of a shared database in the Job filter starts with, beside the keys of the jobs. */
export const SHARED_JOB_PREFIX = "shared:";

/** A shared database as the Job filter and the timeline name it, beside the keys of the jobs. */
export const sharedJobKey = (database: Pick<SharedDatabase, "sourceId" | "databaseName">) => `${SHARED_JOB_PREFIX}${sharedKey(database)}`;

export const isSharedJobKey = (key: string) => key.startsWith(SHARED_JOB_PREFIX);

/** A shared backup in the shape of a backup of the list: its file is the dump of the one database. */
export function sharedRunOf(row: SharedRow): SharedRun {
    const file: ExplorerFile = {
        name: row.database.databaseName,
        path: `${SHARED_JOB_PREFIX}${row.id}`,
        size: row.dump?.stored ?? 0,
        lastModified: row.createdAt,
        createdAt: row.createdAt,
        databases: [row.databaseName],
        isEncrypted: row.encrypted,
        locked: false,
        backupType: "full",
        // The badge reads whether it passed, the trigger only matters for the panel of an own backup.
        verification: row.verification ? { verifiedAt: row.verification.at, passed: row.verification.passed, trigger: "scheduled" } : undefined,
    };
    return { path: file.path, jobKey: sharedJobKey(row.database), file, createdAt: row.createdAt, copies: [], shared: row };
}

/** Every shared backup as a row of the list, newest first. */
export function sharedRunsOf(overview: SharedOverview | null): SharedRun[] {
    return overview ? rowsOf(overview).map(sharedRunOf) : [];
}

/** The own backups and the shared ones in one list, newest first, both given newest first. */
export function mergeRuns(own: readonly BackupRun[], shared: readonly SharedRun[]): ListRun[] {
    if (shared.length === 0) return [...own];
    const merged: ListRun[] = [];
    let a = 0;
    let b = 0;
    while (a < own.length || b < shared.length) {
        const next = b >= shared.length || (a < own.length && Date.parse(own[a].createdAt) >= Date.parse(shared[b].createdAt)) ? own[a++] : shared[b++];
        merged.push(next);
    }
    return merged;
}

/** The quick filter of the list: every backup, the own ones, or the shared ones. */
export type QuickPick = "all" | "own" | "shared";

export const QUICK_PICKS: QuickPick[] = ["all", "own", "shared"];

export const isQuickPick = (value: string | null | undefined): value is QuickPick => value === "all" || value === "own" || value === "shared";

export function matchesQuick(run: ListRun, quick: QuickPick = "all"): boolean {
    if (quick === "all") return true;
    return quick === "shared" ? isSharedRun(run) : !isSharedRun(run);
}

const PROVIDER = "provider:";

/** A provider as the Destination filter names it, beside the ids of the destinations, since its destinations stay its own. */
export const providerValue = (name: string) => `${PROVIDER}${name}`;

export const isProviderValue = (value: string) => value.startsWith(PROVIDER);

/** The destinations and the providers a Destination filter holds. */
export function splitAt(values: readonly string[]): { at: string[]; providers: string[] } {
    return {
        at: values.filter((value) => !isProviderValue(value)),
        providers: values.filter(isProviderValue).map((value) => value.slice(PROVIDER.length)),
    };
}

/** Who started a shared backup, as the Started by filter names it, apart from the starters of the own backups. */
export function sharedStarterKey(row: Pick<SharedRow, "requestedBy" | "database">): string {
    return row.requestedBy ? `shared-request:${row.requestedBy.name ?? ""}` : `shared-schedule:${row.database.providerName}`;
}

/** "Schedule · Skyfay Hosting" or "Back up now · Sara Nguyen". */
export function sharedStarterLabel(row: Pick<SharedRow, "requestedBy" | "database">): string {
    const starter = starterOf(row);
    return `${starter.label} · ${starter.who}`;
}

/** What the search of the list finds a shared backup by: its database, the server and the provider. */
export function matchesSharedSearch(row: Pick<SharedRow, "database" | "databaseName">, text: string): boolean {
    return [row.database.databaseName, row.databaseName, row.database.serverName, row.database.providerName].some((value) => value.toLowerCase().includes(text));
}

/** The providers of the shared backups, by name, for the Destination filter. */
export function providersOf(databases: readonly Pick<SharedDatabase, "providerName">[]): string[] {
    return [...new Set(databases.map((database) => database.providerName))].sort((a, b) => a.localeCompare(b));
}
