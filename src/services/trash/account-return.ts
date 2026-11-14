import { ValidationError } from "@/lib/logging/errors";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { foreignClaimsOf } from "@/services/sso/email-domain-claims";
import type { UserSnapshot } from "./trash-snapshot";

/**
 * A deleted account that comes back without any of its memberships, since their groups or tenants
 * are gone, comes back as an account of no tenant. Such an account counts as one of the home tenant,
 * or of the tenant whose sign-in provider claims its email (`userService.placelessTenantOf`). For
 * an account a customer's tenant made that is the move `membershipEndRefusal` refuses for the last
 * membership: the admin of the customer chose its password, deletes it, deletes its group and brings
 * it back among the platform's own people, whose providers then link it by its email. So it comes
 * back only where that place is the tenant of every membership it lost, or through a platform admin.
 */

export const RETURNS_IN_NO_TENANT = "Its group is gone, so this account would come back in no tenant and count as one of another tenant. A platform admin restores it, or delete it for good.";

/** Where a deleted account would count as one of without a membership, and whether whoever restores it may put it there anyway. */
export interface PlacelessReturn {
    /** The tenant it counts as one of while no platform role or group holds it. */
    place: string;
    /** A platform admin restores it wherever it lands. */
    allowed: boolean;
}

/** The strict answer for a restore that names nobody: the home tenant, and nobody who may place it elsewhere. */
export const HOME_RETURN: PlacelessReturn = { place: HOME_TENANT_ID, allowed: false };

/**
 * The place of a deleted account by the email it comes back with, read before the transaction of
 * the restore, which holds the one connection to SQLite.
 */
export async function placelessReturnOf(snapshot: UserSnapshot, newEmail: string | undefined, caller: { isPlatformAdmin: boolean }): Promise<PlacelessReturn> {
    const email = newEmail ? newEmail.trim().toLowerCase() : snapshot.record.email;
    const claim = (await foreignClaimsOf([{ id: snapshot.record.id, email }])).get(snapshot.record.id);
    return { place: claim ?? HOME_TENANT_ID, allowed: caller.isPlatformAdmin };
}

/**
 * Refuses the return of an account that lost every membership into a place other than the tenants
 * it worked in. An account that held none, or that a platform role or group holds, passes.
 *
 * @throws ValidationError with `RETURNS_IN_NO_TENANT`.
 */
export function assertKeepsItsPlace(
    account: { platformRole: string | null; platformGroupId: string | null },
    memberships: readonly { tenantId: string }[],
    kept: number,
    placeless: PlacelessReturn
): void {
    if (memberships.length === 0 || kept > 0 || placeless.allowed) return;
    if (account.platformRole || account.platformGroupId) return;
    if (memberships.some((membership) => membership.tenantId !== placeless.place)) throw new ValidationError(RETURNS_IN_NO_TENANT);
}
