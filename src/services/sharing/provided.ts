import prisma from "@/lib/prisma";
import { runAsSystem } from "@/lib/tenant/context";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";

/**
 * The destinations and notification channels other tenants share with a tenant. A connection stays
 * in the tenant that shares it, so the customer's own scope never finds it: this module reads across
 * tenants on purpose, in the system scope, and every reader of a provided connection asks it. A
 * connection counts as provided while its tenant shares with customers and its share names the
 * tenant, or every tenant.
 */

/** The kinds of connection a tenant shares: a destination of backups or a notification channel. */
export type SharedKind = "destination" | "channel";

/** A connection another tenant shares with a tenant, with what the customer may know of it. */
export interface ProvidedConnection {
    id: string;
    name: string;
    type: string;
    adapterId: string;
    storageRole: string;
    metadata: string | null;
    lastStatus: string;
    lastHealthCheck: Date | null;
    createdAt: Date;
    updatedAt: Date;
    /** The tenant that shares it. */
    providerId: string;
    providerName: string;
    allTenants: boolean;
    /** A destination: a job writes to it only with a key of its Vault. */
    encryptedOnly: boolean;
    /** An email channel: the customer names the recipients. */
    ownRecipients: boolean;
}

/** The adapters of the email channels, whose recipients a customer may name itself. */
export const EMAIL_ADAPTER_IDS: readonly string[] = ["email"];

export const isEmailChannel = (adapterId: string) => EMAIL_ADAPTER_IDS.includes(adapterId);

/** The kind of a connection, or null for one a tenant cannot share: a database or a directory source. */
export function sharedKindOf(config: { type: string; storageRole?: string | null }): SharedKind | null {
    if (config.type === "notification") return "channel";
    if (config.type === "storage" && (config.storageRole ?? STORAGE_ROLES.DESTINATION) === STORAGE_ROLES.DESTINATION) return "destination";
    return null;
}

const KIND_FILTER: Record<SharedKind, Record<string, unknown>> = {
    destination: { type: "storage", storageRole: STORAGE_ROLES.DESTINATION },
    channel: { type: "notification" },
};

const SELECT = {
    id: true, name: true, type: true, adapterId: true, storageRole: true, metadata: true, lastStatus: true, lastHealthCheck: true,
    createdAt: true, updatedAt: true, tenantId: true,
    share: { select: { allTenants: true, encryptedOnly: true, ownRecipients: true } },
} as const;

/**
 * The connections other tenants share with `tenantId`, of one kind or both, or of the ids given.
 * Read in the system scope, so it answers the same in every scope it runs in. The restore of a job
 * from Recently deleted asks the same inside its transaction, see `providedThrough` in
 * `trash-restore.ts`, which changes with this rule.
 */
export async function providedTo(tenantId: string, filter: { kind?: SharedKind; ids?: readonly string[] } = {}): Promise<ProvidedConnection[]> {
    if (filter.ids && filter.ids.length === 0) return [];
    return runAsSystem(async () => {
        const rows = await prisma.adapterConfig.findMany({
            where: {
                ...(filter.kind ? KIND_FILTER[filter.kind] : {}),
                ...(filter.ids ? { id: { in: [...filter.ids] } } : {}),
                tenantId: { not: tenantId },
                share: { is: { OR: [{ allTenants: true }, { tenants: { some: { tenantId } } }] } },
            },
            select: SELECT,
            orderBy: { name: "asc" },
        });
        if (rows.length === 0) return [];
        const providers = await prisma.tenant.findMany({
            where: { id: { in: [...new Set(rows.map((row) => row.tenantId))] }, sharesWithCustomers: true },
            select: { id: true, name: true },
        });
        const names = new Map(providers.map((provider) => [provider.id, provider.name]));
        return rows.flatMap((row) => {
            const providerName = names.get(row.tenantId);
            // A share of a tenant that shares no longer, or of a connection that is no destination or channel, gives nothing.
            if (!providerName || !row.share || !sharedKindOf(row)) return [];
            const { share, tenantId: providerId, ...rest } = row;
            return [{ ...rest, providerId, providerName, ...share }];
        });
    });
}

/** The connection with this id when another tenant shares it with `tenantId`, else null. */
export async function providedConnection(configId: string, tenantId: string): Promise<ProvidedConnection | null> {
    return (await providedTo(tenantId, { ids: [configId] }))[0] ?? null;
}

/** The ids among `ids` that other tenants share with `tenantId`. */
export async function providedIds(tenantId: string, ids: readonly string[]): Promise<Set<string>> {
    return new Set((await providedTo(tenantId, { ids })).map((connection) => connection.id));
}
