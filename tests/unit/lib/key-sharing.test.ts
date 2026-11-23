import { describe, expect, it } from "vitest";
import { ownerPermissionsIn, PLATFORM_ADMIN_ROLE } from "@/lib/auth/owner-permissions";
import { keyAreas, knownKeyPermissions } from "@/lib/auth/permission-areas";
import { PERMISSIONS } from "@/lib/auth/permissions";

const SHARING = [PERMISSIONS.PLATFORM.SHARING_READ, PERMISSIONS.PLATFORM.SHARING_WRITE];

/** Someone of the MSP whose platform group shares databases and changes the settings, with no group in any tenant. */
const technician = {
    platformRole: null,
    memberships: [],
    platformGroup: {
        platformPermissions: JSON.stringify([PERMISSIONS.SETTINGS.WRITE, ...SHARING]),
        tenantPermissions: JSON.stringify([PERMISSIONS.SOURCES.VIEW]),
        allTenants: true,
        tenants: [],
    },
};

describe("what an API key may carry of the platform", () => {
    it("carries the sharing of databases only in a tenant that shares them, never the settings of the instance", () => {
        const inSharingTenant = ownerPermissionsIn(technician, "msp-two", true);
        expect(inSharingTenant).toEqual(expect.arrayContaining(SHARING));
        expect(inSharingTenant).not.toContain(PERMISSIONS.SETTINGS.WRITE);
        expect(inSharingTenant).toContain(PERMISSIONS.SOURCES.VIEW);

        expect(ownerPermissionsIn(technician, "acme", false)).not.toContain(PERMISSIONS.PLATFORM.SHARING_WRITE);
    });

    it("gives a key of a platform admin the sharing in a tenant that shares only", () => {
        const admin = { platformRole: PLATFORM_ADMIN_ROLE, memberships: [] };
        expect(ownerPermissionsIn(admin, "default", true)).toEqual(expect.arrayContaining(SHARING));
        expect(ownerPermissionsIn(admin, "acme", false)).not.toContain(PERMISSIONS.PLATFORM.SHARING_READ);
    });

    it("offers and keeps the sharing in the key editor of a tenant that shares only", () => {
        expect(keyAreas(true).map((area) => area.id)).toContain("platform-sharing");
        expect(keyAreas(false).map((area) => area.id)).not.toContain("platform-sharing");
        expect(knownKeyPermissions([PERMISSIONS.JOBS.READ, PERMISSIONS.PLATFORM.SHARING_WRITE, PERMISSIONS.SETTINGS.WRITE], true))
            .toEqual([PERMISSIONS.JOBS.READ, PERMISSIONS.PLATFORM.SHARING_WRITE]);
        expect(knownKeyPermissions([PERMISSIONS.PLATFORM.SHARING_WRITE], false)).toEqual([]);
    });

    it("offers and keeps the settings of the instance in the key editor of the home tenant only", () => {
        expect(keyAreas(false, true).map((area) => area.id)).toContain("settings");
        expect(keyAreas(true, false).map((area) => area.id)).not.toContain("settings");
        expect(keyAreas(false, false).map((area) => area.id)).toContain("tenant-settings");
        const stored = [PERMISSIONS.SETTINGS.READ, PERMISSIONS.SETTINGS.WRITE, PERMISSIONS.TENANT_SETTINGS.WRITE];
        expect(knownKeyPermissions(stored, false, true)).toEqual(stored);
        expect(knownKeyPermissions(stored, true, false)).toEqual([PERMISSIONS.TENANT_SETTINGS.WRITE]);
    });

    it("carries the tenants and the accounts in a key of the home tenant only, as far as the owner holds them", () => {
        const manager = {
            ...technician,
            platformGroup: { ...technician.platformGroup, platformPermissions: JSON.stringify([PERMISSIONS.SETTINGS.WRITE, PERMISSIONS.PLATFORM.TENANTS_WRITE, PERMISSIONS.PLATFORM.ACCOUNTS_READ, PERMISSIONS.PLATFORM.SIGN_IN_READ]) },
        };
        const home = ownerPermissionsIn(manager, "default", false);
        expect(home).toEqual(expect.arrayContaining([PERMISSIONS.PLATFORM.TENANTS_WRITE, PERMISSIONS.PLATFORM.ACCOUNTS_READ]));
        // What the platform group does not give stays out, and so do the settings and the sign-in.
        expect(home).not.toContain(PERMISSIONS.PLATFORM.TENANTS_READ);
        expect(home).not.toContain(PERMISSIONS.PLATFORM.ACCOUNTS_WRITE);
        expect(home).not.toContain(PERMISSIONS.PLATFORM.SIGN_IN_READ);
        expect(home).not.toContain(PERMISSIONS.SETTINGS.WRITE);

        expect(ownerPermissionsIn(manager, "acme", true)).not.toContain(PERMISSIONS.PLATFORM.TENANTS_WRITE);
        expect(ownerPermissionsIn({ platformRole: PLATFORM_ADMIN_ROLE, memberships: [] }, "default", false)).toEqual(expect.arrayContaining([PERMISSIONS.PLATFORM.TENANTS_WRITE, PERMISSIONS.PLATFORM.ACCOUNTS_WRITE]));
        expect(ownerPermissionsIn({ platformRole: PLATFORM_ADMIN_ROLE, memberships: [] }, "acme", false)).not.toContain(PERMISSIONS.PLATFORM.TENANTS_READ);
    });

    it("offers and keeps the tenants and the accounts in the key editor of the home tenant only", () => {
        const home = keyAreas(false, true).map((area) => area.id);
        expect(home).toEqual(expect.arrayContaining(["platform-tenants", "platform-accounts"]));
        expect(home).not.toContain("platform-sign-in");
        expect(home.filter((id) => id === "settings")).toHaveLength(1);
        expect(keyAreas(true, false).map((area) => area.id)).not.toContain("platform-tenants");

        const stored = [PERMISSIONS.PLATFORM.TENANTS_WRITE, PERMISSIONS.PLATFORM.SIGN_IN_READ, PERMISSIONS.PLATFORM.ACCOUNTS_READ];
        expect(knownKeyPermissions(stored, false, true)).toEqual([PERMISSIONS.PLATFORM.TENANTS_WRITE, PERMISSIONS.PLATFORM.ACCOUNTS_READ]);
        expect(knownKeyPermissions(stored, true, false)).toEqual([]);
    });
});
