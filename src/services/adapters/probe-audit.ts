import type { AuthContext } from "@/lib/auth/access-control";
import { dialedHosts, hostOf } from "@/lib/adapters/dialed-hosts";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { ConflictError, NotFoundError, PermissionError, ValidationError } from "@/lib/logging/errors";
import { auditService } from "@/services/audit-service";
import { connectionPlace, credentialPlace } from "@/services/audit/record-names";

/**
 * A look at a server a picker or a connection form takes with its login, like listing its folders
 * or asking whether it makes snapshots. It reaches a server of the caller's choosing like the test
 * of a connection, so the audit log keeps it once it ran, whether the server answered or not.
 * `volume_list` and `volume_sizes` read the volumes of a Docker connection, `path_check` whether a
 * folder of a restore target holds files, `token_check` whether a saved login of a cloud drive is
 * still authorized, `storage_check` lists destinations again for Check now, and `sso_check` reads
 * the endpoints of a sign-in provider from the address its dialog names.
 */
export type ProbeAction = "folder_browse" | "snapshot_check" | "volume_list" | "volume_sizes" | "path_check" | "token_check" | "storage_check" | "sso_check";

/** Who looked, as a route knows them: a request with its API key, or the session of a viewer. */
export type ProbeActor = Pick<AuthContext, "userId" | "authMethod" | "apiKeyId">;

/** What was looked at. */
export interface ProbeTarget {
    adapterId?: string;
    /** The config of the form, read only for the host it dials. */
    config?: unknown;
    /** The host when the route knows it better than the adapter, like the SFTP browse of a path field. */
    host?: unknown;
    /** The folders of the server DBackup runs on. */
    local?: boolean;
    /** The saved connection, or the saved login of `token_check`, named in the entry and linked by its id. */
    record?: { id: string; name: string | null };
    /** The folder a `path_check` looked at. */
    path?: string;
    /** The names of the destinations of a `storage_check`. */
    names?: string[];
    /** The log of a look about no saved record, like `sso_check` in the log of the platform. */
    place?: { tenantId: string };
}

function hostOfTarget(target: ProbeTarget): string | null {
    if (target.host !== undefined) return hostOf(target.host);
    if (!target.adapterId || !target.config || typeof target.config !== "object") return null;
    try {
        return dialedHosts(target.adapterId, target.config as Record<string, unknown>)[0] ?? null;
    } catch {
        // An address no client reads names no host.
        return null;
    }
}

/**
 * The tenant whose log keeps the entry of a look at a saved record: the tenant of the connection, or
 * of the saved login for `token_check`. In All tenants no tenant runs, so the entry would land in the
 * home log otherwise. Inside a tenant the record is one of its own, a record it does not see has none.
 */
async function placeOf(action: ProbeAction, record: { id: string }): Promise<string | undefined> {
    const place = action === "token_check" ? await credentialPlace(record.id) : await connectionPlace(record.id);
    return place?.tenantId;
}

/**
 * Writes one look at a server into the audit log, with the adapter, the host and the name of the
 * saved connection, never the config. A check of a saved login is an entry of that login. An entry
 * about a saved record goes into the log of the tenant of that record, see `placeOf`.
 */
export async function logProbe(actor: ProbeActor, action: ProbeAction, target: ProbeTarget, success: boolean): Promise<void> {
    const host = hostOfTarget(target);
    const resource = action === "token_check" ? AUDIT_RESOURCES.CREDENTIAL
        : action === "sso_check" ? AUDIT_RESOURCES.SSO_PROVIDER
        : AUDIT_RESOURCES.ADAPTER;
    const details = {
        action,
        ...(target.record?.name ? { name: target.record.name } : {}),
        ...(target.adapterId ? { adapter: target.adapterId } : {}),
        ...(host ? { host } : {}),
        ...(target.local ? { local: true } : {}),
        ...(target.path !== undefined ? { path: target.path } : {}),
        ...(target.names ? { names: target.names } : {}),
        success,
    };
    // A look from a form is about no saved record, so its entry links none.
    if (target.record) {
        const tenantId = await placeOf(action, target.record);
        await auditService.logFor(actor, AUDIT_ACTIONS.EXECUTE, resource, details, target.record.id, { tenantId });
    } else if (target.place) await auditService.logFor(actor, AUDIT_ACTIONS.EXECUTE, resource, details, undefined, target.place);
    else await auditService.logFor(actor, AUDIT_ACTIONS.EXECUTE, resource, details);
}

/** A refusal before anything was dialed, which no entry notes. */
function isRefusal(error: unknown): boolean {
    return error instanceof PermissionError || error instanceof ValidationError || error instanceof NotFoundError || error instanceof ConflictError;
}

/**
 * Runs a look at a server and writes it into the audit log once it ran, see `logProbe`. A refusal,
 * like a host in the local network of a tenant that may not reach it, ran nothing and writes nothing.
 */
export async function auditedProbe<T>(actor: ProbeActor, action: ProbeAction, target: ProbeTarget, run: () => Promise<T>): Promise<T> {
    let result: T;
    try {
        result = await run();
    } catch (error: unknown) {
        if (!isRefusal(error)) await logProbe(actor, action, target, false);
        throw error;
    }
    await logProbe(actor, action, target, true);
    return result;
}
