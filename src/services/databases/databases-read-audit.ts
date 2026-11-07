import type { AuthContext } from "@/lib/auth/access-control";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { auditService } from "@/services/audit-service";
import { connectionPlace } from "@/services/audit/record-names";

/** What a read of the databases of a server names: the saved source, or the adapter of a form. */
export interface DatabasesReadTarget {
    /** The saved source the read ran for, or whose form brought its config. */
    sourceId?: unknown;
    adapterId?: unknown;
}

/**
 * Writes a read of the databases of a server into the audit log, once the read ran, whether the
 * server answered or not, like the test of a connection. A read reaches the server with the login
 * of the source, so it is no read of DBackup's own data. It names the saved source when there is
 * one, else it reads as one of a new connection. The entry of a saved source goes into the log of
 * its tenant, also from All tenants, where no tenant runs.
 */
export async function logDatabasesRead(ctx: AuthContext, target: DatabasesReadTarget, success: boolean): Promise<void> {
    const sourceId = typeof target.sourceId === "string" && target.sourceId ? target.sourceId : undefined;
    const place = sourceId ? await connectionPlace(sourceId) : null;
    const name = place?.name ?? null;
    await auditService.logFor(ctx, AUDIT_ACTIONS.EXECUTE, AUDIT_RESOURCES.SOURCE, {
        action: "databases_read",
        ...(name ? { name } : { form: true }),
        ...(typeof target.adapterId === "string" && target.adapterId ? { adapter: target.adapterId } : {}),
        success,
    }, name ? sourceId : undefined, { tenantId: place?.tenantId });
}

/** Runs a read of the databases and writes it into the audit log once it ran, see `logDatabasesRead`. */
export async function auditedDatabasesRead<T>(ctx: AuthContext, target: DatabasesReadTarget, read: () => Promise<T>): Promise<T> {
    let result: T;
    try {
        result = await read();
    } catch (error: unknown) {
        await logDatabasesRead(ctx, target, false);
        throw error;
    }
    await logDatabasesRead(ctx, target, true);
    return result;
}
