/**
 * The right to manage the accounts of the platform reaches as far as the platform group that gives
 * it: someone of a platform group of some tenants changes only an account whose tenants it all
 * reaches, an account of no tenant counting as one of the home tenant. Beyond that they change an
 * account like the admin of a tenant. A platform admin and a platform group of all tenants change
 * every account but a platform admin's, as before.
 */
import { describe, expect, it } from "vitest";
import { accountRefusal, BEYOND_REACH_ACCOUNT_REFUSAL, emailClaimScope, PLATFORM_ADMIN_ACCOUNT_REFUSAL, PLATFORM_GROUP_ACCOUNT_REFUSAL, type AccountActor } from "@/lib/auth/account-access";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { PlatformGroupShape } from "@/lib/auth/platform-group-caps";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

const P = PERMISSIONS;

/** Support manages the accounts of the platform and reads the jobs in Acme and Shop. */
const SUPPORT: PlatformGroupShape = { platformPermissions: [P.PLATFORM.ACCOUNTS_READ, P.PLATFORM.ACCOUNTS_WRITE], tenantPermissions: [P.JOBS.READ], allTenants: false, tenantIds: ["acme", "shop"] };

/** Nina holds Support and works in the home tenant, where she runs jobs. */
const NINA: AccountActor = { isPlatformAdmin: false, tenantId: HOME_TENANT_ID, permissions: [...SUPPORT.platformPermissions, P.JOBS.READ], platformGroupShape: SUPPORT, reach: SUPPORT.tenantIds };

const account = (...tenantIds: string[]) => ({ isPlatformAdmin: false, tenantIds });

describe("the accounts a platform group of some tenants changes", () => {
    it("changes an account whose tenants it all reaches", () => {
        expect(accountRefusal(NINA, account("acme"))).toBeNull();
        expect(accountRefusal(NINA, account("acme", "shop"))).toBeNull();
    });

    it("refuses an account of a tenant beyond it, and one that also works beyond it", () => {
        expect(accountRefusal(NINA, account("globex"))).toBe(BEYOND_REACH_ACCOUNT_REFUSAL);
        expect(accountRefusal(NINA, account("acme", "globex"))).toBe(BEYOND_REACH_ACCOUNT_REFUSAL);
    });

    it("counts an account of no tenant as one of the home tenant", () => {
        expect(accountRefusal(NINA, account())).toBe(BEYOND_REACH_ACCOUNT_REFUSAL);
        expect(accountRefusal({ ...NINA, reach: [HOME_TENANT_ID, "acme"] }, account())).toBeNull();
    });

    it("reaches nothing when the reach is left out", () => {
        expect(accountRefusal({ ...NINA, reach: undefined }, account("acme"))).toBe(BEYOND_REACH_ACCOUNT_REFUSAL);
    });

    it("never changes the account of a platform admin", () => {
        expect(accountRefusal(NINA, { isPlatformAdmin: true, tenantIds: ["acme"] })).toBe(PLATFORM_ADMIN_ACCOUNT_REFUSAL);
    });
});

describe("an account of a platform group, changed by a platform group of some tenants", () => {
    const helpdesk = (over: Partial<PlatformGroupShape> = {}): PlatformGroupShape => ({ platformPermissions: [], tenantPermissions: [P.JOBS.READ], allTenants: false, tenantIds: ["acme"], ...over });

    it("changes one whose platform group and tenants lie within hers", () => {
        expect(accountRefusal(NINA, { ...account("acme"), platformGroup: helpdesk() })).toBeNull();
    });

    it("refuses one whose platform group reaches beyond hers, or every tenant", () => {
        expect(accountRefusal(NINA, { ...account("acme"), platformGroup: helpdesk({ tenantIds: ["globex"] }) })).toBe(PLATFORM_GROUP_ACCOUNT_REFUSAL);
        expect(accountRefusal(NINA, { ...account("acme"), platformGroup: helpdesk({ allTenants: true, tenantIds: [] }) })).toBe(PLATFORM_GROUP_ACCOUNT_REFUSAL);
    });

    it("refuses one that works in a tenant beyond hers, or in no tenant without the home tenant", () => {
        expect(accountRefusal(NINA, { ...account("acme", "globex"), platformGroup: helpdesk() })).toBe(BEYOND_REACH_ACCOUNT_REFUSAL);
        expect(accountRefusal(NINA, { ...account(), platformGroup: helpdesk() })).toBe(BEYOND_REACH_ACCOUNT_REFUSAL);
    });
});

describe("beyond the reach, the rule for the admin of a tenant", () => {
    it("lets her change an account of the tenant she manages the users of, when it works there alone", () => {
        const admin = { ...NINA, tenantId: "globex", permissions: [...NINA.permissions, P.USERS.WRITE] };
        expect(accountRefusal(admin, account("globex"))).toBeNull();
        expect(accountRefusal(admin, account("globex", "initech"))).toBe(BEYOND_REACH_ACCOUNT_REFUSAL);
    });

    it("gives the right to manage the accounts of the platform no weight in a tenant it does not reach", () => {
        expect(accountRefusal({ ...NINA, tenantId: "globex" }, account("globex"))).toBe(BEYOND_REACH_ACCOUNT_REFUSAL);
    });
});

describe("a platform admin and a platform group of all tenants", () => {
    it("change every account but a platform admin's, as before", () => {
        const everyTenant: AccountActor = { ...NINA, platformGroupShape: { ...SUPPORT, allTenants: true, tenantIds: [] }, reach: "all" };
        for (const target of [account("globex"), account("acme", "globex"), account()]) expect(accountRefusal(everyTenant, target)).toBeNull();
        expect(accountRefusal(everyTenant, { isPlatformAdmin: true, tenantIds: [] })).toBe(PLATFORM_ADMIN_ACCOUNT_REFUSAL);

        const root: AccountActor = { isPlatformAdmin: true, tenantId: null, permissions: [] };
        expect(accountRefusal(root, { isPlatformAdmin: true, tenantIds: ["globex"] })).toBeNull();
    });
});

describe("the emails someone gives an account", () => {
    it("are any for a platform admin and a platform group of all tenants that manages the accounts", () => {
        expect(emailClaimScope({ isPlatformAdmin: true, permissions: [] })).toEqual({ platformLevel: true, tenantIds: [] });
        expect(emailClaimScope({ ...NINA, reach: "all" })).toEqual({ platformLevel: true, tenantIds: [] });
    });

    it("are those the providers of its tenants claim for a platform group of some tenants", () => {
        expect(emailClaimScope(NINA)).toEqual({ platformLevel: false, tenantIds: ["acme", "shop"] });
    });

    it("are those of the tenants of the account alone for the admin of a tenant", () => {
        expect(emailClaimScope({ isPlatformAdmin: false, permissions: [P.USERS.WRITE], reach: "all" })).toEqual({ platformLevel: false, tenantIds: [] });
    });
});
