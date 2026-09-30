import type prisma from "@/lib/prisma";
import type { AppConfigurationBackup, RestoreOptions } from "@/lib/types/config-backup";

/** Every write of a restore goes through one transaction, on the client with its extensions. */
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * A record of the file that merged into one of the same name here keeps the id it has here, so
 * everything that links to it follows. Each map turns an id of the file into the id here.
 */
export interface IdMaps {
    credentials: Map<string, string>;
    adapters: Map<string, string>;
    profiles: Map<string, string>;
    jobs: Map<string, string>;
    groups: Map<string, string>;
    users: Map<string, string>;
}

/** Ids known to exist here, written by this restore or found once, so a link is checked only once. */
export interface KnownIds {
    adapters: Set<string>;
    profiles: Set<string>;
    jobs: Set<string>;
    users: Set<string>;
}

export interface ImportContext {
    tx: Tx;
    data: AppConfigurationBackup;
    opts: RestoreOptions;
    ids: IdMaps;
    known: KnownIds;
    /** What did not come back as it was, told to whoever restored. */
    notes: string[];
}

/** What a restore could not bring back as it was. */
export interface ImportResult {
    notes: string[];
}

export function createImportContext(tx: Tx, data: AppConfigurationBackup, opts: RestoreOptions): ImportContext {
    return {
        tx,
        data,
        opts,
        ids: { credentials: new Map(), adapters: new Map(), profiles: new Map(), jobs: new Map(), groups: new Map(), users: new Map() },
        known: { adapters: new Set(), profiles: new Set(), jobs: new Set(), users: new Set() },
        notes: [],
    };
}

/** The id a record of the file has here. */
export function idHere(map: Map<string, string>, id: string): string {
    return map.get(id) ?? id;
}

/** Whether a record exists here, asking the database only for an id this restore did not write. */
export async function exists(known: Set<string>, id: string, find: () => Promise<unknown>): Promise<boolean> {
    if (known.has(id)) return true;
    if (!(await find())) return false;
    known.add(id);
    return true;
}

/** "1 job" or "2 jobs". */
export function counted(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
}

/** "Shop, CRM and Wiki". */
export function listed(names: string[]): string {
    if (names.length <= 1) return names.join("");
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
