import { ValidationError } from "@/lib/logging/errors";
import { OUTSIDE_REACH, reachCovers, type PlatformReach } from "@/lib/tenant/sharing-reach";

/**
 * Who someone of a platform group of some tenants shares a destination or a channel with: the
 * tenants their platform group reaches. Every tenant needs a reach of every tenant, and so does a
 * change of a share with every tenant. The tenants beyond the reach that a share names already keep
 * it as it is, and its terms, which hold for them too, stay as they are.
 */

/** The share as it is stored, null for a connection nobody gets. */
export interface StoredShare {
    allTenants: boolean;
}

/** Who gets the connection after a change. */
export interface WantedShare {
    allTenants: boolean;
    tenantIds: readonly string[];
}

/** What the share page tells the viewer of their reach, all empty for whoever reaches every tenant. */
export interface ShareReachView {
    /** The tenants that get it now beyond the reach, which a change keeps as they are. */
    outside: { id: string; name: string }[];
    /** Why All tenants cannot be picked, and while the share covers every tenant why nothing changes. */
    allTenants: string | null;
    /** Why the terms cannot change: they hold for tenants beyond the reach too. */
    terms: string | null;
}

export const FULL_REACH: ShareReachView = { outside: [], allTenants: null, terms: null };

/** What the viewer of a share may not change, see `ShareReachView`. */
export function shareReachView(input: { name: string; share: StoredShare | null; customers: readonly { id: string; name: string }[]; reach: PlatformReach }): ShareReachView {
    if (input.reach === "all") return FULL_REACH;
    const outside = input.customers.filter((tenant) => !reachCovers(input.reach, tenant.id));
    return {
        outside: [...outside],
        allTenants: input.share?.allTenants ? OUTSIDE_REACH.sharedWithEvery(input.name) : OUTSIDE_REACH.everyTenant,
        terms: outside.length > 0 ? OUTSIDE_REACH.terms(outside.map((tenant) => tenant.name)) : null,
    };
}

/**
 * The tenants a change gives the connection to, bound to the reach: the picked tenants it reaches,
 * and the tenants beyond it that the share names now. Refuses every tenant without a reach of every
 * tenant, a change of a share with every tenant, a picked tenant beyond the reach, and other terms
 * while a tenant beyond the reach gets it.
 */
export function boundToReach(input: {
    name: string;
    share: StoredShare | null;
    /** The tenants that get it now. */
    before: readonly string[];
    wanted: WantedShare;
    /** Whether the change stores other terms than the share has, the encryption of a destination or the recipients of an email channel. */
    termsChanged: boolean;
    reach: PlatformReach;
    nameOf: (tenantId: string) => string;
}): { allTenants: boolean; tenantIds: string[] } {
    const { share, wanted, reach } = input;
    if (reach === "all") return { allTenants: wanted.allTenants, tenantIds: [...new Set(wanted.tenantIds)] };
    if (share?.allTenants) throw new ValidationError(OUTSIDE_REACH.sharedWithEvery(input.name));
    if (wanted.allTenants) throw new ValidationError(OUTSIDE_REACH.everyTenant);

    const outside = input.before.filter((id) => !reachCovers(reach, id));
    const foreign = wanted.tenantIds.find((id) => !reachCovers(reach, id) && !outside.includes(id));
    if (foreign) throw new ValidationError(OUTSIDE_REACH.share(input.nameOf(foreign)));
    if (input.termsChanged && outside.length > 0) throw new ValidationError(OUTSIDE_REACH.terms(outside.map(input.nameOf)));
    return { allTenants: false, tenantIds: [...new Set([...wanted.tenantIds.filter((id) => reachCovers(reach, id)), ...outside])] };
}
