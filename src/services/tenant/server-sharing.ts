import { sharesDatabases } from "./shared-servers";
import { tenantService } from "./tenant-service";

/** What the card Shared with tenants needs, on the page of a server and of a database connection. */
export interface ServerSharingInfo {
    /** The tenant of the server, the one the viewer works in. */
    tenantName: string;
    /** Whether the viewer gives databases away and changes the rules, which Share databases allows. */
    canAssign: boolean;
}

/** What the viewer may do with the databases of a shared server: see who holds them, and give them away. */
export interface SharingAccess {
    see: boolean;
    assign: boolean;
}

/**
 * Whether the servers of the tenant the viewer works in show the card Shared with tenants, null
 * when they do not: only to whoever may see the shared databases, only in the home tenant, only
 * while there is another tenant to give a database to, and never in All tenants, which has no
 * tenant and changes none. Without the right to share it shows read only.
 */
export async function serverSharingOf(tenantId: string | null, access: SharingAccess): Promise<ServerSharingInfo | null> {
    if (!access.see && !access.assign) return null;
    const canAssign = access.assign;
    if (!tenantId || !sharesDatabases(tenantId)) return null;
    const [tenants, tenant] = await Promise.all([tenantService.count(), tenantService.find(tenantId)]);
    return tenants > 1 && tenant ? { tenantName: tenant.name, canAssign } : null;
}
