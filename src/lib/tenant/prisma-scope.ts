import { Prisma } from "@prisma/client";
import { TenantScopeError } from "@/lib/logging/errors";
import { explicitScope, type TenantScope } from "./context";

/**
 * The models whose rows belong to one tenant, each with a `tenantId` column. Their child rows,
 * like the destinations of a job or the health checks of a connection, belong to the tenant of
 * their parent and are reached through it. A new model that holds data of a customer goes here,
 * and `tests/unit/tenant/tenant-isolation.test.ts` proves a second tenant does not see it.
 */
export const TENANT_MODELS: ReadonlySet<string> = new Set<Prisma.ModelName>([
    "AdapterConfig",
    "CredentialProfile",
    "EncryptionProfile",
    "RetentionPolicy",
    "NamingTemplate",
    "SchedulePreset",
    "ExcludePatternPreset",
    "Job",
    "NotificationTemplate",
    "Execution",
    "ApiKey",
    "Group",
    "AuditLog",
    "NotificationLog",
    "StorageSnapshot",
    "DeletedRecord",
    // The servers of the tenant whose databases its customers see, kept after a server is deleted.
    "SharedServer",
    // The backups a customer started of a database given to it, the customer's own.
    "SharedBackupRequest",
    // A destination or a channel the tenant shares with others, see src/services/sharing/.
    "ConnectionShare",
    // The recipients a tenant names for an email channel another tenant shares with it.
    "ChannelRecipients",
    // The listing of a destination as one tenant sees it. A destination shared with customers has
    // one per tenant, each with the backups of that tenant alone.
    "StorageListCache",
]);

/**
 * The rows that belong to a tenant through their parent, by the relation that leads to it. A query
 * that reads, changes or deletes them directly is narrowed through that relation, so an id of
 * another tenant finds nothing.
 */
export const CHILD_MODELS: Readonly<Record<string, string>> = {
    JobDestination: "job",
    JobSource: "job",
    JobNotificationTemplate: "job",
    NotificationTemplateChannel: "template",
    HealthCheckLog: "adapterConfig",
    DbVersionHistory: "adapterConfig",
    DatabaseListCache: "adapterConfig",
    // The tenants a connection is shared with, managed by the tenant that shares it.
    ConnectionShareTenant: "share",
    // Managed by the tenant of the shared server, through the SharedServer that outlives its
    // connection. The customer reads them through shared-databases.ts, which looks across tenants
    // on purpose and nowhere else.
    DatabaseAssignment: "server",
    DatabaseAssignmentRule: "server",
};

/** The scope of the request being handled, a tenant id for one tenant, null outside a request or without one. */
export type RequestScopeResolver = () => Promise<TenantScope | string | null>;

const FILTERED = new Set([
    "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany",
    "count", "aggregate", "groupBy", "update", "updateMany", "updateManyAndReturn", "delete", "deleteMany",
]);
const CREATES = new Set(["create", "createMany", "createManyAndReturn"]);
const READS = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);

/** Child rows that reading a server or a destination writes on the way, caches of what it holds. */
const CACHE_MODELS = new Set(["StorageListCache", "DatabaseListCache", "HealthCheckLog", "DbVersionHistory"]);

type Args = Record<string, unknown> & { where?: Record<string, unknown>; data?: unknown };

/** The filter is added as one more AND, so a unique field stays where Prisma looks for it. */
function narrow(where: Record<string, unknown> | undefined, filter: Record<string, unknown>): Record<string, unknown> {
    const and = where?.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
    return { ...where, AND: [...and, filter] };
}

/**
 * The arguments of one query on a child row, narrowed through its parent. A create names its
 * parent by id, which the write of the parent's tenant chose, so it passes as it is.
 */
export function scopeChildArgs(relation: string, operation: string, args: Args, tenantId: string): Args {
    if (CREATES.has(operation)) return args;
    if (operation === "upsert" || FILTERED.has(operation)) return { ...args, where: narrow(args.where, { [relation]: { tenantId } }) };
    throw new TenantScopeError(relation, `${relation} rows have no tenant filter for ${operation}`);
}

/** A row written for one tenant must not name another. Moving rows between tenants is for the system scope. */
function stamp(model: string, data: unknown, tenantId: string): Record<string, unknown> {
    const row = (data ?? {}) as Record<string, unknown>;
    if (row.tenantId !== undefined && row.tenantId !== tenantId) {
        throw new TenantScopeError(model, `${model} was written into another tenant`);
    }
    return { ...row, tenantId };
}

function keep(model: string, data: unknown, tenantId: string): unknown {
    const row = data as Record<string, unknown> | undefined;
    if (row && row.tenantId !== undefined && row.tenantId !== tenantId) {
        throw new TenantScopeError(model, `${model} was moved into another tenant`);
    }
    return data;
}

/** The arguments of one query, narrowed to a tenant. */
export function scopeArgs(model: string, operation: string, args: Args, tenantId: string): Args {
    if (CREATES.has(operation)) {
        const data = Array.isArray(args.data) ? args.data.map((row) => stamp(model, row, tenantId)) : stamp(model, args.data, tenantId);
        return { ...args, data };
    }
    if (operation === "upsert") {
        return {
            ...args,
            where: narrow(args.where, { tenantId }),
            create: stamp(model, args.create, tenantId),
            update: keep(model, args.update, tenantId),
        };
    }
    if (FILTERED.has(operation)) {
        const scoped: Args = { ...args, where: narrow(args.where, { tenantId }) };
        if (operation.startsWith("update")) scoped.data = keep(model, args.data, tenantId);
        return scoped;
    }
    // Anything Prisma adds later is refused until it is handled here, rather than run unfiltered.
    throw new TenantScopeError(model, `${model}.${operation} has no tenant filter`);
}

function named(model: string, data: unknown): void {
    const row = data as Record<string, unknown> | undefined;
    if (typeof row?.tenantId !== "string") {
        throw new TenantScopeError(model, `${model} was created for all tenants without naming one`);
    }
}

/**
 * The system scope reads and writes every tenant, but a row it creates names its tenant itself.
 * The column defaults to the home tenant for the migration, which would otherwise put a row of
 * a customer there without a word.
 */
export function systemArgs(model: string, operation: string, args: Args): Args {
    if (CREATES.has(operation)) {
        for (const row of Array.isArray(args.data) ? args.data : [args.data]) named(model, row);
    } else if (operation === "upsert") {
        named(model, args.create);
    }
    return args;
}

/**
 * All tenants reads every tenant and changes none: a change belongs to one tenant, and only there a
 * write can be checked against the rows it links to. Caches a read fills on the way are the one
 * exception.
 */
export function allTenantsArgs(model: string, operation: string, args: Args): Args {
    if (READS.has(operation) || CACHE_MODELS.has(model)) return args;
    throw new TenantScopeError(model, `${model}.${operation} needs one tenant, All tenants only reads`);
}

async function scopeOf(resolveRequestScope: RequestScopeResolver): Promise<TenantScope | null> {
    const explicit = explicitScope();
    if (explicit) return explicit;
    const resolved = await resolveRequestScope();
    return typeof resolved === "string" ? { kind: "tenant", tenantId: resolved } : resolved;
}

/**
 * Narrows every query on a tenant model to the tenant of the code that runs now. A scope set with
 * `runAsTenant` or `runAsSystem` wins, otherwise the request names it. Without either the query
 * fails, so a forgotten scope is an error and never a leak.
 */
export function tenantScopeExtension(resolveRequestScope: RequestScopeResolver) {
    return Prisma.defineExtension({
        name: "tenantScope",
        query: {
            $allModels: {
                async $allOperations({ model, operation, args, query }) {
                    const parent = CHILD_MODELS[model];
                    if (!TENANT_MODELS.has(model) && !parent) return query(args);

                    const scope = await scopeOf(resolveRequestScope);
                    if (!scope) throw new TenantScopeError(model);
                    if (scope.kind === "all") return query(allTenantsArgs(model, operation, args as Args));
                    if (parent) return query(scope.kind === "system" ? args : scopeChildArgs(parent, operation, args as Args, scope.tenantId));
                    if (scope.kind === "system") return query(systemArgs(model, operation, args as Args));
                    return query(scopeArgs(model, operation, args as Args, scope.tenantId));
                },
            },
        },
    });
}
