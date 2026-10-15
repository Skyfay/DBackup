import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
    BEYOND_ALL_TENANTS,
    BEYOND_YOU_PLATFORM,
    BEYOND_YOUR_SCOPE,
    lockedAllTenants,
    lockedPlatformRight,
    lockedTenant,
    lockedTenantRight,
    platformGroupRefusal,
    type PlatformGroupActor,
    type PlatformGroupShape,
} from "@/lib/auth/platform-group-caps";
import { pickerLine, platformLine, platformSentences, scopeText, tenantLevelsText, tenantLine } from "@/lib/auth/platform-group-summary";

const P = PERMISSIONS;

/** Support: sees the tenants and the accounts, gives platform groups, runs jobs and restores in Acme and Shop. */
const SUPPORT: PlatformGroupShape = {
    platformPermissions: [P.PLATFORM.TENANTS_READ, P.PLATFORM.ACCOUNTS_READ, P.PLATFORM.ACCOUNTS_WRITE],
    tenantPermissions: [P.JOBS.READ, P.JOBS.EXECUTE, P.STORAGE.READ, P.STORAGE.RESTORE],
    allTenants: false,
    tenantIds: ["acme", "shop"],
};

/** Someone of Support, who manages the accounts of the platform. */
const NINA: PlatformGroupActor = { isPlatformAdmin: false, permissions: [...SUPPORT.platformPermissions, ...SUPPORT.tenantPermissions], group: SUPPORT };
const ROOT: PlatformGroupActor = { isPlatformAdmin: true, permissions: [], group: null };

const shape = (over: Partial<PlatformGroupShape>): PlatformGroupShape => ({ platformPermissions: [], tenantPermissions: [], allTenants: false, tenantIds: [], ...over });

describe("what someone of a platform group may give in a platform group", () => {
    it("gives the rights on the platform they hold, never more", () => {
        expect(lockedPlatformRight(NINA, P.PLATFORM.TENANTS_READ)).toBeNull();
        expect(lockedPlatformRight(NINA, P.PLATFORM.TENANTS_WRITE)).toBe(BEYOND_YOU_PLATFORM);
        expect(lockedPlatformRight(NINA, P.SETTINGS.READ)).toBe(BEYOND_YOU_PLATFORM);
    });

    it("gives the rights in the tenants their own platform group gives, whatever their group in the tenant they work in may do", () => {
        const inAdminTenant = { ...NINA, permissions: [...NINA.permissions, P.STORAGE.DELETE, P.JOBS.WRITE] };
        expect(lockedTenantRight(inAdminTenant, P.STORAGE.RESTORE)).toBeNull();
        expect(lockedTenantRight(inAdminTenant, P.STORAGE.DELETE)).toBe(BEYOND_YOU_PLATFORM);
    });

    it("reaches only the tenants their own platform group reaches, never All tenants from a pick of some", () => {
        expect(lockedTenant(NINA, "acme")).toBeNull();
        expect(lockedTenant(NINA, "praxis")).toBe(BEYOND_YOUR_SCOPE);
        expect(lockedAllTenants(NINA)).toBe(BEYOND_ALL_TENANTS);
        expect(lockedAllTenants({ ...NINA, group: { ...SUPPORT, allTenants: true } })).toBeNull();
        expect(lockedTenant({ ...NINA, group: { ...SUPPORT, allTenants: true } }, "praxis")).toBeNull();
    });

    it("refuses a group with any right or tenant beyond them, and names the rights", () => {
        expect(platformGroupRefusal(NINA, shape({ platformPermissions: [P.PLATFORM.TENANTS_READ], tenantPermissions: [P.JOBS.READ], tenantIds: ["acme"] }))).toBeNull();
        expect(platformGroupRefusal(NINA, shape({ platformPermissions: [P.PLATFORM.SHARING_WRITE] }))).toContain("Share databases");
        expect(platformGroupRefusal(NINA, shape({ tenantPermissions: [P.STORAGE.DELETE], tenantIds: ["acme"] }))).toContain("Delete");
        expect(platformGroupRefusal(NINA, shape({ tenantPermissions: [P.JOBS.READ], tenantIds: ["acme", "praxis"] }))).toBe("A platform group can only reach the tenants your own platform group reaches.");
        expect(platformGroupRefusal(NINA, shape({ tenantPermissions: [P.JOBS.READ], allTenants: true }))).toBe(BEYOND_ALL_TENANTS);
    });

    it("lets someone without a platform group of their own give no right in the tenants at all", () => {
        const settingsOnly: PlatformGroupActor = { isPlatformAdmin: false, permissions: [P.SETTINGS.READ], group: null };
        expect(platformGroupRefusal(settingsOnly, shape({ platformPermissions: [P.SETTINGS.READ] }))).toBeNull();
        expect(platformGroupRefusal(settingsOnly, shape({ tenantPermissions: [P.JOBS.READ], tenantIds: ["acme"] }))).not.toBeNull();
    });

    it("lets a platform admin give anything, every tenant included", () => {
        expect(platformGroupRefusal(ROOT, shape({ platformPermissions: [P.PLATFORM.TENANTS_WRITE, P.SETTINGS.WRITE], tenantPermissions: [P.STORAGE.DELETE], allTenants: true }))).toBeNull();
        expect(lockedTenant(ROOT, "praxis")).toBeNull();
    });
});

describe("what a platform group lets its members do, in words", () => {
    it("says what members see and change on the platform", () => {
        expect(platformLine(new Set([P.PLATFORM.TENANTS_READ, P.PLATFORM.SHARING_READ, P.PLATFORM.SHARING_WRITE]))).toBe("Sees the tenants, shares databases");
        expect(platformLine(new Set())).toBe("Nothing on the platform");
        expect(platformSentences(new Set([P.PLATFORM.TENANTS_READ])).at(-1)).toEqual({ text: "No accounts, settings, sign-in and shared databases", can: false });
    });

    it("says what members may do in the tenants, with the levels of the areas", () => {
        expect(tenantLine([])).toBe("Nothing in the tenants");
        expect(tenantLine(SUPPORT.tenantPermissions)).toBe("Runs jobs, restores backups, changes nothing");
        expect(tenantLevelsText(new Set(SUPPORT.tenantPermissions))).toBe("Jobs Use · Backups Custom");
    });

    it("names where it counts, and puts it all in one line for the picker of a user", () => {
        expect(scopeText({ allTenants: true, tenantIds: [] })).toBe("All tenants, new ones too");
        expect(scopeText({ allTenants: false, tenantIds: ["acme", "shop"] })).toBe("2 tenants");
        expect(pickerLine(SUPPORT)).toBe("Sees the tenants, manages the accounts · runs jobs, restores backups, changes nothing · 2 tenants");
    });
});
