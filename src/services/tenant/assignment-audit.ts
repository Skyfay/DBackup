import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { auditService } from "@/services/audit-service";
import type { RuleRow } from "@/services/tenant/database-assignments";

/**
 * What the audit log keeps of a rule that gives the databases of a shared server away by their
 * name, written by the Server Actions of the page of a server and by the routes under
 * `/api/adapters/{id}/database-assignments/rules`, into the log of the tenant of the server.
 */

/** Who changed it: the person, or the owner of the API key of the request, which the entry names. */
export interface AssignmentAuthor {
    id: string;
    apiKeyId?: string | null;
}

function write(author: AssignmentAuthor, details: Record<string, unknown>, sourceId: string) {
    return author.apiKeyId
        ? auditService.log(author.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.ADAPTER, details, sourceId, { apiKeyId: author.apiKeyId })
        : auditService.log(author.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.ADAPTER, details, sourceId);
}

export function logRuleAdded(author: AssignmentAuthor, sourceId: string, rule: Pick<RuleRow, "pattern" | "tenantName" | "onDemandPerDay">) {
    return write(author, {
        change: "Assignment rule added", pattern: rule.pattern, tenant: rule.tenantName,
        ...(rule.onDemandPerDay !== null ? { onDemandPerDay: rule.onDemandPerDay } : {}),
    }, sourceId);
}

export function logRuleRemoved(author: AssignmentAuthor, sourceId: string, removed: { pattern: string; tenantName: string }) {
    return write(author, { change: "Assignment rule removed", pattern: removed.pattern, tenant: removed.tenantName }, sourceId);
}
