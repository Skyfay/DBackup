import { ValidationError } from "@/lib/logging/errors";
import { matchesPattern } from "@/lib/tenant/database-owner";

/**
 * The customers' restores of shared databases that wait or run in this process, from the request
 * to the end of the run. Giving one of these databases to another tenant, taking it back, ending
 * the rule that gives it or moving it waits until the restore ended, see `assertNoSharedRestore`.
 * The restore checks again right before it writes, so a change that slips past this still never
 * lets an old dump overwrite a database that is no longer the customer's.
 */

/** A database a customer restores now, the place it writes into. */
export interface ActiveSharedRestore {
    sourceId: string;
    databaseName: string;
    /** The customer whose restore it is. */
    tenantId: string;
}

// On globalThis, like the other state of the process, so every module instance of a build sees the
// same holds, the action that gives a database away as well as the restore that holds it.
const ACTIVE_KEY = Symbol.for("dbackup.sharedRestoresActive");
const store = globalThis as typeof globalThis & { [ACTIVE_KEY]?: Map<string, { restore: ActiveSharedRestore; holds: number }> };
const active = (store[ACTIVE_KEY] ??= new Map<string, { restore: ActiveSharedRestore; holds: number }>());

const keyOf = (restore: ActiveSharedRestore) => JSON.stringify([restore.sourceId, restore.databaseName, restore.tenantId]);

/**
 * Marks the database as restored by the customer until the returned release is called. Holds of the
 * same restore stack, so the request and the run behind it can each hold it.
 */
export function holdSharedRestore(restore: ActiveSharedRestore): () => void {
    const key = keyOf(restore);
    const entry = active.get(key) ?? { restore: { ...restore }, holds: 0 };
    entry.holds++;
    active.set(key, entry);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        const current = active.get(key);
        if (!current) return;
        current.holds--;
        if (current.holds <= 0) active.delete(key);
    };
}

/** The restores that wait or run on the server, all of them or those whose database matches. */
export function sharedRestoresOn(sourceId: string, matches: (databaseName: string) => boolean = () => true): ActiveSharedRestore[] {
    return [...active.values()].map((entry) => entry.restore).filter((restore) => restore.sourceId === sourceId && matches(restore.databaseName));
}

/** What a change to who holds a database names: one name, or the pattern of a rule. */
export type HoldingChange = { databaseName: string } | { pattern: string };

/**
 * Refuses a change to who holds a database of the server while a customer restores it. `keeps`
 * lets through the restore of a tenant the change leaves the database with.
 */
export function assertNoSharedRestore(sourceId: string, change: HoldingChange, keeps: (tenantId: string) => boolean = () => false): void {
    const matches = "pattern" in change
        ? (databaseName: string) => matchesPattern(change.pattern, databaseName)
        : (databaseName: string) => databaseName === change.databaseName;
    const restore = sharedRestoresOn(sourceId, matches).find((entry) => !keeps(entry.tenantId));
    if (!restore) return;
    throw new ValidationError(`A customer restores ${restore.databaseName} right now. Try again once the restore ended.`);
}

/** Forgets every restore, for tests. */
export function resetSharedRestores(): void {
    active.clear();
}
