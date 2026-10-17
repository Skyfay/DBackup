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
            .toEqual([PERMISSIONS.JOBS.READ, PERMISSIONS.SETTINGS.WRITE, PERMISSIONS.PLATFORM.SHARING_WRITE]);
        expect(knownKeyPermissions([PERMISSIONS.PLATFORM.SHARING_WRITE], false)).toEqual([]);
    });
});
