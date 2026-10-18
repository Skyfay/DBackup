/**
 * What someone of a platform group of some tenants reaches beyond the tenants they work in: the
 * tenants they look after on the Tenants page, the groups they give on the list of every account,
 * and the pictures of the people of the tenants. A membership in a tenant gives no right on the
 * platform, and a platform group of all tenants reaches every tenant.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { maySeePicture, type AccountViewer } from "@/services/user/account-visibility";
import { platformGroupService } from "@/services/user/platform-group-service";
import { viewerReach } from "@/services/user/users-all-model";

const P = PERMISSIONS;

/** Support reaches Acme and lets its people manage the users there. */
const SUPPORT = {
    id: "pg-support",
    platformPermissions: JSON.stringify([P.PLATFORM.TENANTS_READ, P.PLATFORM.TENANTS_WRITE]),
    tenantPermissions: JSON.stringify([P.USERS.READ, P.USERS.WRITE, P.JOBS.READ]),
    allTenants: false,
    tenants: [{ tenantId: "acme" }],
};

/** Nina holds Support and is a member of Globex with a group that lets her do everything there. */
function nina(group = SUPPORT) {
    prismaMock.user.findUnique.mockResolvedValue({
        platformGroup: group,
        memberships: [{ tenantId: "globex", group: { permissions: "[]", fullAccess: true } }],
    } as never);
}

beforeEach(() => {
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.findMany.mockReset();
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.auditLog.count.mockResolvedValue(0);
    prismaMock.apiKey.count.mockResolvedValue(0);
});

describe("the tenants a platform group looks after", () => {
    it("names among the listed tenants only those it reaches, every one for a group of all tenants", async () => {
        nina();
        expect(await platformGroupService.reachedAmong("nina", ["acme", "globex"])).toEqual(["acme"]);

        nina({ ...SUPPORT, allTenants: true, tenants: [] });
        expect(await platformGroupService.reachedAmong("nina", ["acme", "globex"])).toEqual(["acme", "globex"]);

        prismaMock.user.findUnique.mockResolvedValue({ platformGroup: null } as never);
        expect(await platformGroupService.reachedAmong("lena", ["acme"])).toEqual([]);
    });
});

describe("the groups someone of a platform group gives on the list of every account", () => {
    const GROUPS = [
        { id: "acme-ops", tenantId: "acme", permissions: JSON.stringify([P.JOBS.READ]), fullAccess: false },
        { id: "acme-admin", tenantId: "acme", permissions: "[]", fullAccess: true },
        { id: "globex-ops", tenantId: "globex", permissions: JSON.stringify([P.JOBS.READ]), fullAccess: false },
    ];

    it("gives only in the tenants the platform group reaches, never through a membership, and never a group beyond them", async () => {
        nina();

        expect(await viewerReach("nina", GROUPS)).toEqual(expect.objectContaining({ managedTenants: ["acme"], givableGroups: ["acme-ops"] }));
    });

    it("offers New user the tenants where she adds people, through her platform group or as the admin of a tenant, with the groups she may give there", async () => {
        // Support manages the users of Acme, her own group manages those of Globex.
        nina();
        expect(await viewerReach("nina", [...GROUPS, { id: "initech-ops", tenantId: "initech", permissions: JSON.stringify([P.JOBS.READ]), fullAccess: false }]))
            .toEqual(expect.objectContaining({ newUserTenants: ["acme", "globex"], newUserGroups: ["acme-ops", "globex-ops"] }));

        // With the right to manage the accounts of the platform, no membership and none to manage the users of a tenant, the tenants it reaches.
        prismaMock.user.findUnique.mockResolvedValue({ platformGroup: { ...SUPPORT, platformPermissions: JSON.stringify([P.PLATFORM.ACCOUNTS_READ, P.PLATFORM.ACCOUNTS_WRITE]), tenantPermissions: JSON.stringify([P.JOBS.READ]) }, memberships: [] } as never);
        expect(await viewerReach("nina", GROUPS)).toEqual(expect.objectContaining({ newUserTenants: ["acme"], newUserGroups: ["acme-ops"] }));
    });

    it("offers New user every tenant for a platform group of all tenants that manages the accounts, with the groups it may give", async () => {
        nina({ ...SUPPORT, platformPermissions: JSON.stringify([P.PLATFORM.ACCOUNTS_WRITE]), allTenants: true, tenants: [] });

        const reach = await viewerReach("nina", GROUPS);
        expect(reach.newUserTenants).toBeNull();
        expect(reach.newUserGroups).toEqual(["acme-ops", "globex-ops"]);
    });

    it("looks after every tenant with a platform group of all tenants", async () => {
        nina({ ...SUPPORT, allTenants: true, tenants: [] });

        const reach = await viewerReach("nina", GROUPS);
        expect(reach.managedTenants).toBeNull();
        // In Globex her own group gives her everything, so she gives its groups too.
        expect(reach.givableGroups).toEqual(["acme-ops", "globex-ops"]);
    });
});

describe("the pictures someone who may see the tenants sees", () => {
    const viewer: AccountViewer = { userId: "nina", tenantId: "globex", allTenants: false, isPlatformAdmin: false, permissions: [P.PLATFORM.TENANTS_READ] };

    it("shows the people of the tenants the platform group reaches, nobody of a tenant beyond it", async () => {
        nina();
        prismaMock.user.findMany.mockResolvedValue([{ id: "tom" }] as never);

        expect(await maySeePicture(viewer, "tom")).toBe(true);
        expect(await maySeePicture(viewer, "someone-of-initech")).toBe(false);
    });

    it("shows everyone to a platform group of all tenants, also through the right to see the accounts of the platform", async () => {
        nina({ ...SUPPORT, allTenants: true, tenants: [] });
        expect(await maySeePicture(viewer, "someone-of-initech")).toBe(true);
        expect(await maySeePicture({ ...viewer, permissions: [P.PLATFORM.ACCOUNTS_WRITE] }, "someone-of-initech")).toBe(true);
    });

    it("shows nobody beyond the tenants of a platform group of some tenants through the right to see the accounts of the platform", async () => {
        nina();
        expect(await maySeePicture({ ...viewer, permissions: [P.PLATFORM.ACCOUNTS_READ] }, "someone-of-initech")).toBe(false);
    });
});
