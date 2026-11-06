import type { AuthContext } from "@/lib/auth/access-control";
import { readsConfigBackups } from "@/lib/server/config-backup-guard";
import { CONFIG_BACKUP_DESTINATION_LOCKED, CONFIG_BACKUP_KEY_LOCKED, CONFIG_BACKUP_LOGIN_APPLY_LOCKED, CONFIG_BACKUP_LOGIN_LOCKED } from "@/lib/core/config-backup-locks";
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

/**
 * 403 when a request names the destination of the configuration backup as the saved connection
 * whose secrets fill a config it submits, or that it copies, else null. Such a config keeps the
 * host the caller sent, so its stored password or keys would go wherever the caller points them.
 * For the form routes (test connection, folder browse, access check) and the copy of a connection.
 */
export async function storedSecretsRefusal(caller: Caller, configId: unknown): Promise<Response | null> {
    if (typeof configId !== "string" || !configId) return null;
    return configBackupTargetResponse(caller, { connectionIds: [configId] });
}

/**
 * 403 when a request names a saved login of the destination of the configuration backup for a
 * config it brings along or for a connection it creates or changes, else null. The login would
 * sign in wherever that config points, so its password or key would go to a host of the caller's
 * choosing. For the form routes (test connection, folder browse, access check, snapshot check, SSH
 * test, remote file browser) and for creating or changing a connection. An id that is no string
 * names nothing.
 */
export async function savedLoginRefusal(caller: Caller, ...ids: unknown[]): Promise<Response | null> {
    if (readsConfigBackups(caller)) return null;
    const named = ids.filter((id): id is string => typeof id === "string" && id.length > 0);
    if (named.length === 0) return null;
    const { credentialIds } = await getConfigBackupTargets();
    if (!named.some((id) => credentialIds.includes(id))) return null;
    const message = CONFIG_BACKUP_LOGIN_APPLY_LOCKED;
    return Response.json({ success: false, error: message, message }, { status: 403 });
}
