import { PERMISSIONS, type Permission } from "./permissions";

/**
 * Who may cancel a run: whoever may start a run of its kind. A backup needs the right to run jobs,
 * a restore the right to restore, so nobody who may only run backups aborts a restore, the
 * provider's run of a customer's restore of a shared database included. Plain rules, read by the
 * cancel route and the History pages alike.
 */

/** The right each type of run needs to be cancelled, the one that starts it. */
export const CANCEL_RIGHTS: Readonly<Record<string, Permission>> = {
    Backup: PERMISSIONS.JOBS.EXECUTE,
    Restore: PERMISSIONS.STORAGE.RESTORE,
    // Run now of a system task.
    IntegrityCheck: PERMISSIONS.SETTINGS.WRITE,
    // A check of copies, which whoever sees the backups starts.
    Verification: PERMISSIONS.STORAGE.READ,
};

/** Someone who cancels a run, as `AuthContext` or `getViewer` hand them on. */
export interface RunCanceller {
    permissions: readonly string[];
    isPlatformAdmin: boolean;
    /** A platform admin in All tenants, who changes no tenant. */
    allTenants: boolean;
    /** A page and a Server Action always have a session. */
    authMethod?: "session" | "apikey";
}

function holds(caller: RunCanceller, permission: Permission): boolean {
    if (caller.allTenants) return false;
    return caller.isPlatformAdmin || caller.permissions.includes(permission);
}

/**
 * Whether the caller may cancel a run of the type. The configuration restore and a type this list
 * does not know are for a platform admin with a session alone, like the configuration restore itself.
 */
export function mayCancelRun(caller: RunCanceller, type: string): boolean {
    const right = Object.hasOwn(CANCEL_RIGHTS, type) ? CANCEL_RIGHTS[type] : undefined;
    if (right) return holds(caller, right);
    return caller.isPlatformAdmin && !caller.allTenants && (caller.authMethod ?? "session") === "session";
}

/** The rights of which the caller holds one at least to cancel any run, checked before a run is read. */
export const CANCEL_PERMISSIONS: readonly Permission[] = [...new Set(Object.values(CANCEL_RIGHTS))];

/** The types of runs the caller may cancel, for a page that shows Cancel only where it works. */
export function cancellableRunTypes(caller: RunCanceller): string[] {
    const types = Object.keys(CANCEL_RIGHTS).filter((type) => mayCancelRun(caller, type));
    if (mayCancelRun(caller, "System Restore")) types.push("System Restore");
    return types;
}
