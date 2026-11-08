import { diffFields, type AuditField } from "@/lib/core/audit-diff";
import { AUDIT_ACTIONS, AUDIT_RESOURCES, type AuditChange } from "@/lib/core/audit-types";
import { auditService } from "@/services/audit-service";
import type { ShareChange, ShareSettings, ShareTerms } from "@/services/sharing/connection-shares";

/**
 * What the audit log keeps of a change of who gets a destination or a channel: an entry for each
 * tenant that got it or lost it in the log of the tenant that shares it, one there when what the
 * tenants may put on it changed, and one in the log of each tenant that lost it with what it lost,
 * which `withdrawnConnections` reads back for the note of its Connections page. A save that changed
 * nothing writes nothing. The Server Actions and `PUT /api/adapters/{id}/share` write the same.
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

/** The terms in the words of the share dialog. */
const TERM_FIELDS: Record<keyof ShareTerms, AuditField> = {
    encryptedOnly: { label: "Only encrypted backups" },
    ownRecipients: { label: "Who gets the mail" },
};

/** The terms as the dialog shows them: whether only encrypted backups go on a destination, whose recipients an email channel mails. */
function termValues(terms: ShareTerms, kind: ShareChange["kind"]) {
    return kind === "destination"
        ? { encryptedOnly: terms.encryptedOnly }
        : { ownRecipients: terms.ownRecipients ? "The recipients each tenant picks" : "The recipients set here" };
}

/** What a save changed of the terms of a share, empty when it changed none. */
export function shareTermChanges(change: Pick<ShareChange, "kind" | "terms">): AuditChange[] {
    if (!change.terms) return [];
    return diffFields(termValues(change.terms.before, change.kind), termValues(change.terms.after, change.kind), TERM_FIELDS);
}

/**
 * Logs a change of who gets a connection, in the log of its tenant and in the log of each tenant
 * that lost it. The log of its tenant gets one entry for each tenant that got it or lost it, which
 * names that tenant by `tenantId` too, so a reader of the log of the home tenant whose platform
 * group reaches some tenants only reads the entries of those (`aboutReachedTenants` in
 * `services/audit/log-reach.ts`). A share with every tenant names none, and is written only when
 * it was not shared with every tenant before. A change of the terms is one entry with its
 * `changes`, which names no tenant.
 */
export async function logShareChange(author: ShareAuthor, configId: string, result: ShareChange, settings: Pick<ShareSettings, "allTenants">) {
    const resource = resourceOf(result.kind);
    if (settings.allTenants) {
        if (!result.wasAllTenants) await write(author, resource, { name: result.name, action: "share", tenants: "all tenants" }, configId);
    } else {
        for (const tenant of result.gainedTenants) {
            await write(author, resource, { name: result.name, action: "share", tenants: tenant.name, tenantId: tenant.tenantId }, configId);
        }
    }
    for (const loss of result.losses) {
        await write(author, resource, { name: result.name, action: "unshare", tenants: loss.name, tenantId: loss.tenantId }, configId);
    }
    const terms = shareTermChanges(result);
    if (terms.length > 0) await write(author, resource, { name: result.name, action: "shareTerms", changes: terms }, configId);
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
