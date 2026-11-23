import prisma from "@/lib/prisma";
import { namedTenants } from "@/lib/core/audit-tenants";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { auditService } from "@/services/audit-service";
import type { RuleRow } from "@/services/tenant/database-assignments";

/**
 * What the audit log keeps of a change of who holds the databases of a shared server: assignments,
 * rules, moves and backups on demand, written by the Server Actions of the page of a server and by
 * the routes under `/api/adapters/{id}/database-assignments`, into the log of the tenant of the
 * server. Every entry names the server in `details.name`, which `describeEntry` reads, and a
 * customer it names by `tenant` by its id in `tenantId` too, so the log of the home tenant shows it
 * only to whoever reaches that customer (`aboutReachedTenants` in `services/audit/log-reach.ts`).
 * The filter reads `tenantId` anywhere in the JSON text, so a tenant goes there at the top level
 * only, through `namedTenants`, never inside a list.
 */

/** Who changed it: the person, or the owner of the API key of the request, which the entry names. */
export interface AssignmentAuthor {
    id: string;
    apiKeyId?: string | null;
}

/** The name of the server, read after the change, which the services refuse for a server that is gone. */
async function serverName(sourceId: string): Promise<string | null> {
    return (await prisma.adapterConfig.findFirst({ where: { id: sourceId }, select: { name: true } }))?.name ?? null;
}

async function write(author: AssignmentAuthor, details: Record<string, unknown>, sourceId: string) {
    const name = await serverName(sourceId);
    const entry = { ...(name ? { name } : {}), ...details };
    return author.apiKeyId
        ? auditService.log(author.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.ADAPTER, entry, sourceId, { apiKeyId: author.apiKeyId })
        : auditService.log(author.id, AUDIT_ACTIONS.UPDATE, AUDIT_RESOURCES.ADAPTER, entry, sourceId);
}

/**
 * A batch of assignments, each database with the tenant it went to in `to`, null for a take-back,
 * and every tenant of the batch by `namedTenants` at the top level: those it gave to and those that
 * held a database before (`tenants` of `databaseAssignmentService.assign`). So a reader of some
 * tenants reads the batch only while it reaches every one of them, its own take-back included.
 */
export function logDatabasesAssigned(author: AssignmentAuthor, sourceId: string, changes: readonly { databaseName: string; tenantId: string | null }[], tenants: readonly string[]) {
    return write(author, {
        change: "Databases assigned",
        databases: changes.map((change) => ({ name: change.databaseName, to: change.tenantId })),
        ...namedTenants(tenants),
    }, sourceId);
}

/** A change of who holds the databases, like `{ change: "Database moved" }`, with the name of the server. */
export function logAssignmentChange(author: AssignmentAuthor, sourceId: string, details: Record<string, unknown>) {
    return write(author, details, sourceId);
}

export function logRuleAdded(author: AssignmentAuthor, sourceId: string, rule: Pick<RuleRow, "pattern" | "tenantId" | "tenantName" | "onDemandPerDay">) {
    return write(author, {
        change: "Assignment rule added", pattern: rule.pattern, tenant: rule.tenantName, tenantId: rule.tenantId,
        ...(rule.onDemandPerDay !== null ? { onDemandPerDay: rule.onDemandPerDay } : {}),
    }, sourceId);
}

export function logRuleRemoved(author: AssignmentAuthor, sourceId: string, removed: { pattern: string; tenantId: string; tenantName: string }) {
    return write(author, { change: "Assignment rule removed", pattern: removed.pattern, tenant: removed.tenantName, tenantId: removed.tenantId }, sourceId);
}
