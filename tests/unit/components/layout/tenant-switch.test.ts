import { describe, expect, it } from "vitest";
import {
    breadcrumbTenant,
    canSwitch,
    countLine,
    healthNote,
    isHomeTenant,
    offersAllTenants,
    pageAfterSwitch,
    searchesTenants,
    sidebarHead,
    tenantInitials,
    type HeadInput,
} from "@/components/layout/tenant-switch";

const HOME = { id: "default", name: "Platform" };
const ACME = { id: "t-acme", name: "Acme GmbH" };
const SHOP = { id: "t-shop", name: "Shop" };

/** A platform admin of an instance of three tenants in the home tenant, unless a case says otherwise. */
function head(overrides: Partial<HeadInput> = {}) {
    return sidebarHead({
        tenants: [HOME, ACME, SHOP],
        activeTenantId: "default",
        allTenants: false,
        isPlatformAdmin: true,
        tenantCount: 3,
        version: "4.1.0",
        ...overrides,
    });
}

describe("the head of the sidebar", () => {
    it("names DBackup and its version while the instance has one tenant, every install before tenants", () => {
        expect(head({ tenants: [HOME], tenantCount: 1, isPlatformAdmin: false })).toEqual({ title: "DBackup", subtitle: "v4.1.0", menu: false, chevrons: false, logo: null });
    });

    it("names the instance from General and keeps DBackup beside the version", () => {
        expect(head({ tenants: [HOME], tenantCount: 1, isPlatformAdmin: false, instanceName: "Production" })).toMatchObject({ title: "Production", subtitle: "DBackup v4.1.0" });
    });

    it("still opens the menu of a platform admin with one tenant, for New tenant and Manage tenants, without the arrows of a switch", () => {
        expect(head({ tenants: [HOME], tenantCount: 1 })).toEqual({ title: "DBackup", subtitle: "v4.1.0", menu: true, chevrons: false, logo: null });
    });

    it("counts the tenants in All tenants", () => {
        expect(head({ activeTenantId: null, allTenants: true })).toEqual({ title: "All tenants", subtitle: "3 tenants", menu: true, chevrons: true, logo: null });
    });

    it("names the tenant a platform admin works in and its place in the menu", () => {
        expect(head({ activeTenantId: "t-acme" })).toEqual({ title: "Acme GmbH", subtitle: "Tenant 2 of 3", menu: true, chevrons: true, logo: null });
    });

    it("counts the place among the tenants of a member of several, not the tenants of the instance", () => {
        expect(head({ tenants: [ACME, SHOP], activeTenantId: "t-shop", isPlatformAdmin: false, tenantCount: 14 })).toMatchObject({ title: "Shop", subtitle: "Tenant 2 of 2", menu: true, chevrons: true });
    });

    it("tells a customer with one tenant to open that these are their backups, and leads to the Overview", () => {
        expect(head({ tenants: [ACME], activeTenantId: "t-acme", isPlatformAdmin: false, tenantCount: 14 })).toEqual({ title: "Acme GmbH", subtitle: "Your backups", menu: false, chevrons: false, logo: null });
    });

    it("falls back to the name of the instance for an account that works in no tenant", () => {
        expect(head({ tenants: [], activeTenantId: null, isPlatformAdmin: false, tenantCount: 3 })).toEqual({ title: "DBackup", subtitle: "v4.1.0", menu: false, chevrons: false, logo: null });
    });

    it("leaves the line under the name out while the version is unknown", () => {
        expect(head({ tenants: [HOME], tenantCount: 1, version: undefined }).subtitle).toBeNull();
    });

    it("shows the logo of the tenant it names, and the DBackup tile in All tenants and with one tenant", () => {
        const withLogo = { ...ACME, logo: "/api/tenants/t-acme/logo?v=1" };
        expect(head({ tenants: [HOME, withLogo, SHOP], activeTenantId: "t-acme" }).logo).toBe("/api/tenants/t-acme/logo?v=1");
        expect(head({ tenants: [withLogo], activeTenantId: "t-acme", isPlatformAdmin: false, tenantCount: 5 }).logo).toBe("/api/tenants/t-acme/logo?v=1");
        expect(head({ tenants: [HOME, withLogo, SHOP], activeTenantId: null, allTenants: true }).logo).toBeNull();
        expect(head({ tenants: [{ ...HOME, logo: "/api/tenants/default/logo?v=1" }], tenantCount: 1 }).logo).toBeNull();
    });
});

describe("the menu of the head", () => {
    it("offers a switch to someone who may open two tenants or more", () => {
        expect(canSwitch([])).toBe(false);
        expect(canSwitch([HOME])).toBe(false);
        expect(canSwitch([HOME, ACME])).toBe(true);
    });

    it("heads its list with All tenants only for whoever may open it, and only with more than one tenant", () => {
        expect(offersAllTenants(true, 3)).toBe(true);
        expect(offersAllTenants(true, 1)).toBe(false);
        expect(offersAllTenants(false, 3)).toBe(false);
    });

    it("opens the menu for someone of a platform group who may see the tenants, also with one tenant to open", () => {
        expect(head({ tenants: [ACME], activeTenantId: "t-acme", isPlatformAdmin: false, canSeeTenants: true, tenantCount: 5 })).toMatchObject({ menu: true, chevrons: false });
        expect(head({ tenants: [ACME], activeTenantId: "t-acme", isPlatformAdmin: false, canSeeTenants: false, tenantCount: 5 })).toMatchObject({ menu: false });
    });

    it("gets a search once it lists more than one tenant", () => {
        expect(searchesTenants(1)).toBe(false);
        expect(searchesTenants(2)).toBe(true);
    });

    it("counts the jobs and databases of a tenant in the singular and the plural", () => {
        expect(countLine({ jobs: 4, databases: 12 })).toBe("4 jobs · 12 databases");
        expect(countLine({ jobs: 1, databases: 1 })).toBe("1 job · 1 database");
        expect(countLine({ jobs: 0, databases: 0 })).toBe("0 jobs · 0 databases");
    });

    it("marks a tenant whose newest backup of a job failed or missed a copy, and nothing while all went through", () => {
        expect(healthNote("failed")).toMatch(/failed/);
        expect(healthNote("partial")).toMatch(/missed a copy/);
        expect(healthNote(null)).toBeNull();
        expect(healthNote(undefined)).toBeNull();
    });

    it("leads from the page of a record to the Overview, since the next tenant does not hold it", () => {
        expect(pageAfterSwitch("/dashboard/history/run")).toBe("/dashboard");
        expect(pageAfterSwitch("/dashboard/explorer/database")).toBe("/dashboard");
        expect(pageAfterSwitch("/dashboard/explorer/server")).toBe("/dashboard");
        expect(pageAfterSwitch("/dashboard/backups/restore")).toBe("/dashboard");
    });

    it("stays on a page of lists and loads it again", () => {
        expect(pageAfterSwitch("/dashboard")).toBeNull();
        expect(pageAfterSwitch("/dashboard/jobs")).toBeNull();
        expect(pageAfterSwitch("/dashboard/history")).toBeNull();
        expect(pageAfterSwitch("/dashboard/explorer")).toBeNull();
        expect(pageAfterSwitch("/dashboard/backups")).toBeNull();
        expect(pageAfterSwitch("/dashboard/platform/tenants")).toBeNull();
    });

    it("marks each tenant with its initials", () => {
        expect(tenantInitials("Acme Corp")).toBe("AC");
        expect(tenantInitials("shop")).toBe("SH");
        expect(tenantInitials("  ")).toBe("?");
    });

    it("knows the home tenant by its id", () => {
        expect(isHomeTenant("default")).toBe(true);
        expect(isHomeTenant("t1")).toBe(false);
    });
});

describe("the start of the breadcrumb", () => {
    const base = { tenants: [HOME, ACME], activeTenantId: "t-acme", allTenants: false, tenantCount: 2 };

    it("starts with the tenant the viewer works in while the instance has several", () => {
        expect(breadcrumbTenant(base)).toBe("Acme GmbH");
    });

    it("starts with the tenant of a customer who may open only that one", () => {
        expect(breadcrumbTenant({ ...base, tenants: [ACME], tenantCount: 14 })).toBe("Acme GmbH");
    });

    it("starts with no tenant in All tenants, which is none", () => {
        expect(breadcrumbTenant({ ...base, activeTenantId: null, allTenants: true })).toBeNull();
    });

    it("starts with no tenant while the instance has only one", () => {
        expect(breadcrumbTenant({ ...base, tenants: [HOME], activeTenantId: "default", tenantCount: 1 })).toBeNull();
    });
});
