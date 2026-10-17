import { getAdapterOptions, type AdapterListItemDTO } from "@/lib/adapters/dto";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { currentTenantId } from "@/lib/tenant/current";
import { isEmailChannel, providedTo, type ProvidedConnection, type SharedKind } from "./provided";
import { recipientsOf } from "./channel-recipients";

/**
 * The connections a tenant picks from and lists: its own, and the destinations and channels other
 * tenants share with it, each marked with who shares it. A provided connection carries nothing of
 * its address, login or settings, the customer only names it in its jobs and templates.
 */

const KIND_OF_TYPE: Record<string, SharedKind | undefined> = { storage: "destination", notification: "channel" };

/** A provided connection as a row of a list or a picker. */
export async function providedItem(connection: ProvidedConnection, tenantId: string): Promise<AdapterListItemDTO> {
    const ownRecipients = isEmailChannel(connection.adapterId) && connection.ownRecipients;
    return {
        id: connection.id,
        name: connection.name,
        type: connection.type,
        adapterId: connection.adapterId,
        config: "{}",
        secretStatus: {},
        metadata: connection.metadata,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
        primaryCredentialId: null,
        sshCredentialId: null,
        defaultRetentionPolicyId: null,
        lastHealthCheck: connection.lastHealthCheck,
        lastStatus: connection.lastStatus,
        // Why the storage of another tenant fails stays with that tenant.
        lastError: null,
        consecutiveFailures: 0,
        // The column default, which a channel carries too. Only destinations are shared of storage.
        storageRole: STORAGE_ROLES.DESTINATION,
        supportsBrowse: false,
        tenantId,
        provided: {
            providerId: connection.providerId,
            providerName: connection.providerName,
            encryptedOnly: connection.encryptedOnly,
            ownRecipients,
            ...(ownRecipients ? { recipients: await recipientsOf(connection.id, tenantId) } : {}),
        },
    };
}

/** The connections other tenants share with the tenant that runs now, of one type. None outside a tenant. */
export async function providedItems(type: string, role?: string | null): Promise<AdapterListItemDTO[]> {
    const kind = KIND_OF_TYPE[type];
    if (!kind || (type === "storage" && role && role !== STORAGE_ROLES.DESTINATION)) return [];
    const tenantId = await currentTenantId();
    if (!tenantId) return [];
    const provided = await providedTo(tenantId, { kind });
    return Promise.all(provided.map((connection) => providedItem(connection, tenantId)));
}

/** The connections of one type a form of the tenant that runs now picks from, its own first. */
export async function connectionOptions(type: "database" | "storage" | "notification"): Promise<AdapterListItemDTO[]> {
    const [own, provided] = await Promise.all([getAdapterOptions(type), providedItems(type)]);
    return [...own, ...provided];
}
