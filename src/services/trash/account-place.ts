import prisma from "@/lib/prisma";
import { PLATFORM_ADMIN_ROLE } from "@/lib/auth/owner-permissions";
import { runAsSystem } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

/** Where the entry of a deleted account waits in Recently deleted, and whether only a platform admin handles it. */
export interface AccountTrashPlace {
    tenantId: string;
    superAdminOnly: boolean;
}

/** What of an account decides where its entry waits. */
export interface AccountTrashShape {
    platformRole: string | null;
    platformGroupId: string | null;
    memberships: readonly { tenantId: string }[];
    apiKeys: readonly { tenantId: string }[];
}

/**
 * An account belongs to no tenant, so where it waits depends on the account, never on the tenant it
 * was deleted from. One of exactly one tenant, with no platform role, no platform group and no keys
 * elsewhere, waits in that tenant for its admins. Bringing back any other account makes someone a
 * platform admin, gives a platform group again, or puts it back into several tenants or into none.
 * Only a platform admin decides that, in the home tenant.
 */
export function accountTrashPlace(account: AccountTrashShape): AccountTrashPlace {
    const only = account.memberships.length === 1 ? account.memberships[0].tenantId : null;
    const ofOneTenant = !!only && account.platformRole !== PLATFORM_ADMIN_ROLE && !account.platformGroupId && account.apiKeys.every((key) => key.tenantId === only);
    return ofOneTenant && only ? { tenantId: only, superAdminOnly: false } : { tenantId: HOME_TENANT_ID, superAdminOnly: true };
}

/**
 * Where the entry of this account would wait once deleted, null for an account that does not exist.
 * Read in the system scope, since its memberships and keys lie in every tenant.
 */
export async function accountTrashPlaceOf(userId: string): Promise<AccountTrashPlace | null> {
    const account = await runAsSystem(() =>
        prisma.user.findUnique({
            where: { id: userId },
            select: { platformRole: true, platformGroupId: true, memberships: { select: { tenantId: true } }, apiKeys: { select: { tenantId: true } } },
        })
    );
    return account ? accountTrashPlace(account) : null;
}
