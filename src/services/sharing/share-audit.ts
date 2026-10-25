import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { auditService } from "@/services/audit-service";
import type { ShareChange, ShareSettings } from "@/services/sharing/connection-shares";

/**
 * What the audit log keeps of a change of who gets a destination or a channel: an entry in the log
 * of the tenant that shares it, and one in the log of each tenant that lost it with what it lost,
 * which `withdrawnConnections` reads back for the note of its Connections page. The Server Actions
 * and `PUT /api/adapters/{id}/share` write the same.
 */

const resourceOf = (kind: string) => (kind === "destination" ? AUDIT_RESOURCES.DESTINATION : AUDIT_RESOURCES.ADAPTER);

/** Who changed it: the person, or the owner of the API key of the request, which the entries name. */
export interface ShareAuthor {
    id: string;
    apiKeyId?: string | null;
}

/** Writes an entry, naming the API key when there is one, in the log of the tenant given or of the request. */
function write(author: ShareAuthor, resource: string, details: Record<string, unknown>, configId: string, tenantId?: string) {
    const origin = { ...(tenantId ? { tenantId } : {}), ...(author.apiKeyId ? { apiKeyId: author.apiKeyId } : {}) };
    return Object.keys(origin).length > 0
        ? auditService.log(author.id, AUDIT_ACTIONS.UPDATE, resource, details, configId, origin)
        : auditService.log(author.id, AUDIT_ACTIONS.UPDATE, resource, details, configId);
}

/** Logs a change of who gets a connection, in the log of its tenant and in the log of each tenant that lost it. */
export async function logShareChange(author: ShareAuthor, configId: string, result: ShareChange, settings: Pick<ShareSettings, "allTenants">, kept: string[]) {
    const resource = resourceOf(result.kind);
    if (result.gained.length > 0 || settings.allTenants) {
        await write(author, resource, { name: result.name, action: "share", tenants: settings.allTenants ? "all tenants" : kept.join(", ") }, configId);
    }
    if (result.losses.length > 0) {
        await write(author, resource, { name: result.name, action: "unshare", tenants: result.losses.map((loss) => loss.name).join(", ") }, configId);
    }
    // A tenant that never used a connection shared with every tenant hears nothing of it, see `noted`.
    for (const loss of result.losses.filter((entry) => entry.noted)) {
        await write(author, resource, {
            name: result.name,
            action: "unshare",
            tenants: loss.name,
            ...(loss.jobs.length > 0 ? { jobs: loss.jobs } : {}),
            ...(loss.templates.length > 0 ? { templates: loss.templates } : {}),
            ...(loss.backups > 0 ? { backups: loss.backups } : {}),
        }, configId, loss.tenantId);
    }
}
