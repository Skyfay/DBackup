/**
 * A platform group gives its rights in the tenants of its scope and nowhere else, also to someone
 * who is a member of another tenant with a smaller group there. Mutation testing showed that the
 * check of the scope in `platformTenantRightsIn` could go without a failing test: such a person
 * would then hold the rights of the platform group in every tenant they belong to.
 */
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
    ownerPermissionsIn,
    permissionsIn,
    platformTenantRightsIn,
    type OwnerMembership,
    type PlatformGroupGrant,
} from "@/lib/auth/owner-permissions";

const P = PERMISSIONS;

/** Support of the MSP: runs and restores the backups of Acme, and no other tenant. */
const ACME_SUPPORT: PlatformGroupGrant = {
    platformPermissions: "[]",
    tenantPermissions: JSON.stringify([P.JOBS.READ, P.JOBS.WRITE, P.JOBS.EXECUTE, P.STORAGE.RESTORE, P.USERS.WRITE]),
    allTenants: false,
    tenants: [{ tenantId: "acme" }],
};

/** Nina of the MSP is also a member of Globex, where she may only look at the jobs. */
const NINA: OwnerMembership[] = [
    { tenantId: "globex", group: { permissions: JSON.stringify([P.JOBS.READ]), fullAccess: false } },
];

describe("the rights a platform group gives in a tenant", () => {
    it("count in a tenant of its scope", () => {
        expect(platformTenantRightsIn(ACME_SUPPORT, "acme")).toEqual(expect.arrayContaining([P.JOBS.WRITE, P.STORAGE.RESTORE, P.USERS.WRITE]));
    });

    it("count in no tenant beyond its scope, and outside any tenant", () => {
        expect(platformTenantRightsIn(ACME_SUPPORT, "globex")).toEqual([]);
        expect(platformTenantRightsIn(ACME_SUPPORT, null)).toEqual([]);
    });

    it("leave someone who is a member of another tenant with the group they hold there", () => {
        const inGlobex = permissionsIn(NINA, "globex", ACME_SUPPORT);

        expect(inGlobex).toContain(P.JOBS.READ);
        for (const right of [P.JOBS.WRITE, P.JOBS.EXECUTE, P.STORAGE.RESTORE, P.USERS.WRITE]) expect(inGlobex).not.toContain(right);
        // In Acme the platform group counts, without a membership there.
        expect(permissionsIn(NINA, "acme", ACME_SUPPORT)).toEqual(expect.arrayContaining([P.JOBS.WRITE, P.STORAGE.RESTORE]));
    });

    it("never reach a key of that other tenant through its owner", () => {
        const owner = { platformRole: null, memberships: NINA, platformGroup: ACME_SUPPORT };
        const keyInGlobex = ownerPermissionsIn(owner, "globex");

        expect(keyInGlobex).toContain(P.JOBS.READ);
        for (const right of [P.JOBS.WRITE, P.JOBS.EXECUTE, P.STORAGE.RESTORE, P.USERS.WRITE]) expect(keyInGlobex).not.toContain(right);
        expect(ownerPermissionsIn(owner, "acme")).toEqual(expect.arrayContaining([P.JOBS.WRITE, P.STORAGE.RESTORE]));
    });
});
