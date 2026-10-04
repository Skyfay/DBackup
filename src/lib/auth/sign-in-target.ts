import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * Where every way of signing in leads. The Overview reads the marker once: a person who may set
 * DBackup up and has nothing to back up yet goes on to the Quick Setup, everyone else stays.
 */
export const AFTER_SIGN_IN = "/dashboard?from=sign-in";

/** The Quick Setup adds a source, a destination and a job, so it needs the right to add all three. */
export function canUseQuickSetup(permissions: readonly string[]): boolean {
    return (
        permissions.includes(PERMISSIONS.SOURCES.WRITE) &&
        permissions.includes(PERMISSIONS.DESTINATIONS.WRITE) &&
        permissions.includes(PERMISSIONS.JOBS.WRITE)
    );
}
