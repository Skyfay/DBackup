import type { AuditOrigin } from "@/services/audit-service";
import { PLATFORM_LOG } from "@/services/system/settings-save";
import { membershipService } from "@/services/tenant/membership-service";

/** Who changes an account, as the log of the change depends on it. */
export interface AccountLogViewer {
    tenantId: string | null;
    allTenants?: boolean;
}

/**
 * The log a change of accounts goes into, read before the change. The tenant the viewer works in
 * keeps it while every account is one of its people, see `peopleOf`. A change of an account of
 * another tenant, or one made from All tenants, belongs to the platform and goes into the log of
 * the home tenant, so a customer never reads what someone did to the account of another one.
 */
export async function accountLogOrigin(viewer: AccountLogViewer, userIds: string | readonly string[]): Promise<AuditOrigin> {
    const tenantId = viewer.allTenants ? null : viewer.tenantId;
    if (!tenantId) return PLATFORM_LOG;
    const ids = typeof userIds === "string" ? [userIds] : userIds;
    const people = await Promise.all(ids.map((id) => membershipService.isPersonOf(id, tenantId)));
    return people.every(Boolean) ? { tenantId } : PLATFORM_LOG;
}
