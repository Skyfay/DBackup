/**
 * Whoever changes how an account signs in can sign in as it, so the group the account holds caps
 * who changes it: nobody but a platform admin sets the password, resets the second factor, changes
 * the name or email of, or deletes an account whose group in one of its tenants may do more than
 * they may there, whether they act as the admin of the tenant or through the right to manage the
 * accounts of the platform.
 */
import { describe, expect, it } from "vitest";
import { accountRefusal, GROUP_BEYOND_ACCOUNT_REFUSAL, heldGroupBeyond, type AccountActor } from "@/lib/auth/account-access";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

const P = PERMISSIONS;

const group = (permissions: string[], fullAccess = false) => ({ permissions: JSON.stringify(permissions), fullAccess });
const ADMIN_GROUP = group([], true);
const VIEWERS = group([P.JOBS.READ]);

/** Ops manages the users of Acme and runs its jobs, but holds no full access there. */
const OPS: AccountActor = { isPlatformAdmin: false, tenantId: "acme", permissions: [P.USERS.READ, P.USERS.WRITE, P.JOBS.READ, P.JOBS.EXECUTE] };

/** Nina manages the accounts of the platform in Acme and Shop, and may read the jobs there. */
const NINA: AccountActor = {
    isPlatformAdmin: false,
    tenantId: HOME_TENANT_ID,
    permissions: [P.PLATFORM.ACCOUNTS_READ, P.PLATFORM.ACCOUNTS_WRITE],
    reach: ["acme", "shop"],
    permissionsByTenant: { acme: [P.JOBS.READ], shop: [P.JOBS.READ] },
};

describe("an account whose group may do more than the admin of its tenant", () => {
    it("is refused to the admin, for the password, the second factor, the name, the email and a delete alike", () => {
        expect(accountRefusal(OPS, { isPlatformAdmin: false, tenantIds: ["acme"], groups: [{ tenantId: "acme", group: ADMIN_GROUP }] })).toBe(GROUP_BEYOND_ACCOUNT_REFUSAL);
    });

    it("is refused for a single permission the admin lacks", () => {
        const deleters = group([P.JOBS.READ, P.STORAGE.DELETE]);
        expect(accountRefusal(OPS, { isPlatformAdmin: false, tenantIds: ["acme"], groups: [{ tenantId: "acme", group: deleters }] })).toBe(GROUP_BEYOND_ACCOUNT_REFUSAL);
    });

    it("leaves an account of a weaker group, and one without a group, to the admin", () => {
        expect(accountRefusal(OPS, { isPlatformAdmin: false, tenantIds: ["acme"], groups: [{ tenantId: "acme", group: VIEWERS }] })).toBeNull();
        expect(accountRefusal({ ...OPS, tenantId: HOME_TENANT_ID }, { isPlatformAdmin: false, tenantIds: [] })).toBeNull();
    });

    it("is changed by a platform admin", () => {
        expect(accountRefusal({ isPlatformAdmin: true, tenantId: "acme", permissions: [] }, { isPlatformAdmin: false, tenantIds: ["acme"], groups: [{ tenantId: "acme", group: ADMIN_GROUP }] })).toBeNull();
    });
});

describe("an account changed through the right to manage the accounts of the platform", () => {
    it("is refused when its group in one of its tenants may do more than the manager may there", () => {
        const target = { isPlatformAdmin: false, tenantIds: ["acme", "shop"], groups: [{ tenantId: "acme", group: VIEWERS }, { tenantId: "shop", group: ADMIN_GROUP }] };
        expect(accountRefusal(NINA, target)).toBe(GROUP_BEYOND_ACCOUNT_REFUSAL);
    });

    it("is changed while every group it holds stays within what the manager may in that tenant", () => {
        const target = { isPlatformAdmin: false, tenantIds: ["acme", "shop"], groups: [{ tenantId: "acme", group: VIEWERS }, { tenantId: "shop", group: VIEWERS }] };
        expect(accountRefusal(NINA, target)).toBeNull();
    });

    it("counts a tenant whose rights are unknown as one where the manager may do nothing", () => {
        expect(heldGroupBeyond({ ...NINA, permissionsByTenant: {} }, [{ tenantId: "acme", group: VIEWERS }])).toBe(true);
    });

    it("keeps the reasons of where the account works first", () => {
        const target = { isPlatformAdmin: false, tenantIds: ["globex"], groups: [{ tenantId: "globex", group: ADMIN_GROUP }] };
        expect(accountRefusal(NINA, target)).toMatch(/does not reach/);
    });
});
