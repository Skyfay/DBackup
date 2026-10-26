import type { AuthContext } from "@/lib/auth/access-control";
import { readsConfigBackups } from "@/lib/server/config-backup-guard";
import { CONFIG_BACKUP_DESTINATION_LOCKED, CONFIG_BACKUP_KEY_LOCKED, CONFIG_BACKUP_LOGIN_LOCKED } from "@/lib/core/config-backup-locks";
import { getConfigBackupTargets } from "@/services/config/config-backup-targets";

/**
 * The guard of what the configuration backup goes through: its destination, the saved logins of
 * that destination and its key. Whoever changes the destination or its login sends the next file
 * where they like, and whoever holds the key opens it, so only a platform admin with a session
 * changes, deletes or reveals them, never an API key. Reading their names and using them in a job
 * stays open to whoever may do that.
 */

/** The records an action touches, by kind. */
export interface ConfigBackupTargetQuery {
    connectionIds?: readonly string[];
    credentialIds?: readonly string[];
    profileIds?: readonly string[];
}

type Caller = Pick<AuthContext, "isPlatformAdmin" | "authMethod">;

/** Why the caller may not change, delete or reveal these records, or null when they may. */
export async function configBackupTargetRefusal(caller: Caller, query: ConfigBackupTargetQuery): Promise<string | null> {
    if (readsConfigBackups(caller)) return null;
    const { connectionIds = [], credentialIds = [], profileIds = [] } = query;
    if (connectionIds.length + credentialIds.length + profileIds.length === 0) return null;

    const targets = await getConfigBackupTargets();
    if (targets.storageId && connectionIds.includes(targets.storageId)) return CONFIG_BACKUP_DESTINATION_LOCKED;
    if (credentialIds.some((id) => targets.credentialIds.includes(id))) return CONFIG_BACKUP_LOGIN_LOCKED;
    if (targets.profileId && profileIds.includes(targets.profileId)) return CONFIG_BACKUP_KEY_LOCKED;
    return null;
}

/** The same as the 403 answer of a route, or null. */
export async function configBackupTargetResponse(caller: Caller, query: ConfigBackupTargetQuery): Promise<Response | null> {
    const message = await configBackupTargetRefusal(caller, query);
    return message ? Response.json({ success: false, error: message, message }, { status: 403 }) : null;
}
