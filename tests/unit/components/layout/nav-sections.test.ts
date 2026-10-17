import { describe, expect, it } from "vitest";
import { ALL_NAV_ITEMS, isActiveRoute, navSections, platformLine, type NavState } from "@/components/layout/nav-sections";
import { breadcrumbs } from "@/components/layout/breadcrumbs";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ALL_TENANTS_PERMISSIONS } from "@/lib/auth/owner-permissions";

const everything = () => true;
const only = (...allowed: string[]) => (permission: string) => allowed.includes(permission);

/** The sections by their label, each with the addresses and labels of its entries. */
function sections(state: Partial<NavState>, can: (permission: string) => boolean = everything) {
    const shown = navSections({ tenantCount: 1, isPlatformAdmin: false, ...state }, can);
    return Object.fromEntries(shown.map((group) => [group.label, group.items.map((item) => `${item.label} ${item.href}`)]));
}

/** An admin of a customer: everything of the tenant, the tenant settings, none of the instance's settings. */
const TENANT_ADMIN = only(
    PERMISSIONS.VAULT.READ, PERMISSIONS.TEMPLATES.READ, PERMISSIONS.USERS.READ, PERMISSIONS.GROUPS.READ,
    PERMISSIONS.TENANT_SETTINGS.READ, PERMISSIONS.TENANT_SETTINGS.WRITE, PERMISSIONS.JOBS.READ, PERMISSIONS.STORAGE.READ,
);

describe("the sidebar with one tenant, every install before tenants", () => {
    it("keeps Administration as it was, with Recently deleted a part of the settings of the instance", () => {
        expect(sections({ tenantCount: 1, isPlatformAdmin: true }).Administration).toEqual([
            "Vault /dashboard/vault",
            "Templates /dashboard/templates",
            "Users & Groups /dashboard/users",
            "Settings /dashboard/settings",
        ]);
    });

    it("has no section Platform, not even for a platform admin", () => {
        expect(sections({ tenantCount: 1, isPlatformAdmin: true }).Platform).toBeUndefined();
    });

    it("shows Settings to whoever may read the settings of the instance, with the sign-in providers of Users & Groups", () => {
        // The settings show the sign-in providers too, which are a tab of Users & Groups with one tenant.
        expect(sections({ tenantCount: 1 }, only(PERMISSIONS.SETTINGS.READ)).Administration).toEqual(["Users & Groups /dashboard/users", "Settings /dashboard/settings"]);
        expect(sections({ tenantCount: 1 }, only(PERMISSIONS.PLATFORM.SIGN_IN_READ)).Administration).toEqual(["Users & Groups /dashboard/users"]);
        // Recently deleted sits inside Settings, so the right to read it alone opens no page of its own.
        expect(sections({ tenantCount: 1 }, only(PERMISSIONS.TENANT_SETTINGS.READ)).Administration).toBeUndefined();
    });
});

describe("the sidebar with more than one tenant", () => {
    it("gives a platform admin Platform below Administration, in a tenant and in All tenants", () => {
        for (const state of [{ allTenants: false }, { allTenants: true }]) {
            const shown = navSections({ tenantCount: 3, isPlatformAdmin: true, ...state }, everything);
            expect(shown.map((group) => group.label)).toEqual(["General", "Backup", "Explorer", "Administration", "Platform"]);
            expect(shown.at(-1)?.platform).toBe(true);
        }
        expect(sections({ tenantCount: 3, isPlatformAdmin: true }).Platform).toEqual([
            "Tenants /dashboard/platform/tenants",
            "Users & Groups /dashboard/platform/users",
            "Settings /dashboard/platform/settings",
        ]);
    });

    it("keeps Administration about the open tenant, whose Settings are the tenant settings with Recently deleted", () => {
        expect(sections({ tenantCount: 3 }, TENANT_ADMIN).Administration).toEqual([
            "Vault /dashboard/vault",
            "Templates /dashboard/templates",
            "Users & Groups /dashboard/users",
            "Settings /dashboard/settings",
        ]);
        // The settings of the instance alone no longer open Settings under Administration.
        expect(sections({ tenantCount: 3 }, only(PERMISSIONS.SETTINGS.READ)).Administration).toBeUndefined();
    });

    it("never shows Platform to a customer, whatever they may do in their tenant", () => {
        // The settings of the instance count from the home tenant only, and the rights on the
        // platform come from a platform group only, so no customer holds them.
        const allButInstanceSettings = (permission: string) => !permission.startsWith("settings:") && !permission.startsWith("platform-");
        expect(sections({ tenantCount: 3 }, allButInstanceSettings).Platform).toBeUndefined();
        expect(sections({ tenantCount: 3 }, TENANT_ADMIN).Platform).toBeUndefined();
    });

    it("shows Platform with its Settings and the sign-in providers to someone of the home tenant who holds them but is no platform admin", () => {
        // The settings show the sign-in providers too, which are a tab of Users & Groups of the platform.
        expect(sections({ tenantCount: 3 }, only(PERMISSIONS.SETTINGS.READ)).Platform).toEqual(["Users & Groups /dashboard/platform/users", "Settings /dashboard/platform/settings"]);
    });

    it("shows a platform admin in All tenants every entry, which the pages answer with a pick of the tenant", () => {
        const shown = sections({ tenantCount: 3, isPlatformAdmin: true, allTenants: true }, only(...ALL_TENANTS_PERMISSIONS));
        expect(shown.Administration).toContain("Settings /dashboard/settings");
    });

    it("never gives Recently deleted an entry of its own, since it is a part of Settings", () => {
        for (const tenantCount of [1, 3]) {
            const entries = Object.values(sections({ tenantCount, isPlatformAdmin: true })).flat();
            expect(entries.filter((entry) => entry.startsWith("Recently deleted"))).toEqual([]);
        }
        expect(ALL_NAV_ITEMS.map((item) => item.href)).not.toContain("/dashboard/recently-deleted");
    });

    it("counts every tenant beside the label Platform", () => {
        expect(platformLine(4)).toBe("all 4 tenants");
        expect(platformLine(1200)).toBe("all 1,200 tenants");
    });

    it("names the platform group beside the label Platform for someone who sees it through one", () => {
        expect(platformLine(4, "Support")).toBe("through Support");
        expect(platformLine(4, null)).toBe("all 4 tenants");
    });

});

describe("the section Platform for someone of a platform group", () => {
    it("shows Tenants alone to a group that may only see the tenants", () => {
        expect(sections({ tenantCount: 3 }, only(PERMISSIONS.PLATFORM.TENANTS_READ)).Platform).toEqual(["Tenants /dashboard/platform/tenants"]);
    });

    it("shows Users & Groups to a group that sees the accounts or the sign-in providers", () => {
        expect(sections({ tenantCount: 3 }, only(PERMISSIONS.PLATFORM.ACCOUNTS_READ)).Platform).toEqual(["Users & Groups /dashboard/platform/users"]);
        expect(sections({ tenantCount: 3 }, only(PERMISSIONS.PLATFORM.SIGN_IN_READ)).Platform).toEqual(["Users & Groups /dashboard/platform/users"]);
    });

    it("shows each entry its right opens, in the order of the section, and Settings for the settings of the instance", () => {
        const can = only(PERMISSIONS.PLATFORM.TENANTS_READ, PERMISSIONS.PLATFORM.ACCOUNTS_READ, PERMISSIONS.SETTINGS.READ);
        expect(sections({ tenantCount: 3 }, can).Platform).toEqual([
            "Tenants /dashboard/platform/tenants",
            "Users & Groups /dashboard/platform/users",
            "Settings /dashboard/platform/settings",
        ]);
    });

    it("leaves the section out while none of its entries shows, like for a group that only shares databases", () => {
        expect(sections({ tenantCount: 3 }, only(PERMISSIONS.PLATFORM.SHARING_WRITE, PERMISSIONS.JOBS.READ)).Platform).toBeUndefined();
    });

    it("still has no Platform with one tenant, whatever rights a platform group gives", () => {
        expect(sections({ tenantCount: 1 }, only(PERMISSIONS.PLATFORM.TENANTS_READ, PERMISSIONS.PLATFORM.ACCOUNTS_READ)).Platform).toBeUndefined();
    });
});

describe("the entries that depend on the tenant", () => {
    it("shows Quick Setup only while it is offered", () => {
        expect(sections({ showQuickSetup: true }).General).toContain("Quick Setup /dashboard/setup");
        expect(sections({ showQuickSetup: false }).General).toEqual(["Overview /dashboard"]);
    });

    it("leaves the Database Explorer out of a tenant without a database connection of its own, also for a platform admin", () => {
        expect(sections({ tenantCount: 3, ownDatabases: true }).Explorer).toContain("Database Explorer /dashboard/explorer");
        expect(sections({ tenantCount: 3, ownDatabases: false }).Explorer).toEqual(["History /dashboard/history"]);
        expect(sections({ tenantCount: 3, isPlatformAdmin: true, ownDatabases: false }).Explorer).toEqual(["History /dashboard/history"]);
        // Left out, as in every caller from before, the entry shows.
        expect(sections({ tenantCount: 3 }).Explorer).toContain("Database Explorer /dashboard/explorer");
    });

    it("knows the icon of every page any viewer can get, for the search", () => {
        const hrefs = ALL_NAV_ITEMS.map((item) => item.href);
        expect(hrefs).toEqual(expect.arrayContaining(["/dashboard/platform/tenants", "/dashboard/platform/users", "/dashboard/platform/settings", "/dashboard/settings"]));
    });

    it("marks Settings of the tenant and Settings of the platform apart", () => {
        expect(isActiveRoute("/dashboard/platform/settings", "/dashboard/settings")).toBe(false);
        expect(isActiveRoute("/dashboard/settings", "/dashboard/settings")).toBe(true);
        expect(isActiveRoute("/dashboard/jobs", "/dashboard")).toBe(false);
    });
});

describe("the breadcrumb of the header", () => {
    it("starts with the tenant inside a tenant of several", () => {
        expect(breadcrumbs("/dashboard/settings", "Acme GmbH")).toEqual([
            { name: "Acme GmbH", href: "/dashboard" },
            { name: "Settings", href: "/dashboard/settings" },
        ]);
    });

    it("starts the pages of Platform with Platform, which has no page and belongs to no tenant", () => {
        expect(breadcrumbs("/dashboard/platform/users", "Acme GmbH")).toEqual([
            { name: "Platform", href: null, platform: true },
            { name: "Users & Groups", href: "/dashboard/platform/users" },
        ]);
    });

    it("names Dashboard with one tenant", () => {
        expect(breadcrumbs("/dashboard/settings", null).map((crumb) => crumb.name)).toEqual(["Dashboard", "Settings"]);
    });
});
