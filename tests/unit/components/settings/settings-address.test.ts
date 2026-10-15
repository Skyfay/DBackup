import { describe, expect, it } from "vitest";
import { platformSettingsRoute, settingsRoute } from "@/components/dashboard/settings/settings-address";
import { tenantPartFromAddress, tenantPartStates, tenantSettingsIndex } from "@/components/dashboard/tenant-settings/tenant-settings-parts";
import { grantableIn, groupCapRefusal, lockedFor } from "@/lib/auth/group-caps";
import { groupsOfTenant } from "@/components/dashboard/users/user-access";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import type { TenantSettingsModel } from "@/services/tenant/tenant-settings-model";

describe("where an address of the settings leads", () => {
    it("keeps Settings the settings of the instance with one tenant, every install before tenants", () => {
        expect(settingsRoute({ several: false, part: "passwords", tab: null, query: "part=passwords" })).toEqual({ kind: "platform" });
        expect(settingsRoute({ several: false, part: null, tab: null, query: "" })).toEqual({ kind: "platform" });
        expect(platformSettingsRoute({ several: false, part: "https", query: "part=https" })).toEqual({ kind: "redirect", to: "/dashboard/settings?part=https" });
    });

    it("opens the tenant settings with several tenants, and an old link to a part of the instance under Platform", () => {
        expect(settingsRoute({ several: true, part: null, tab: null, query: "" })).toEqual({ kind: "tenant" });
        expect(settingsRoute({ several: true, part: "profile", tab: null, query: "part=profile" })).toEqual({ kind: "tenant" });
        expect(settingsRoute({ several: true, part: "tasks", tab: null, query: "part=tasks" })).toEqual({ kind: "redirect", to: "/dashboard/platform/settings?part=tasks" });
        expect(settingsRoute({ several: true, part: "notifications", tab: null, query: "part=notifications" })).toEqual({ kind: "redirect", to: "/dashboard/platform/settings?part=notifications" });
        // A tab of the page before its parts, from a bookmark.
        expect(settingsRoute({ several: true, part: null, tab: "certificate", query: "tab=certificate" })).toEqual({ kind: "redirect", to: "/dashboard/platform/settings?tab=certificate" });
        expect(platformSettingsRoute({ several: true, part: "tasks", query: "part=tasks" })).toEqual({ kind: "platform" });
    });

    it("leads the parts that became pages to their page, with one tenant and with several", () => {
        for (const several of [false, true]) {
            expect(settingsRoute({ several, part: "tenants", tab: null, query: "" })).toEqual({ kind: "redirect", to: "/dashboard/platform/tenants" });
        }
    });

    it("keeps Recently deleted a part of Settings with one tenant and of the tenant settings with several", () => {
        const query = "part=recently-deleted";
        expect(settingsRoute({ several: false, part: "recently-deleted", tab: null, query })).toEqual({ kind: "platform" });
        expect(settingsRoute({ several: true, part: "recently-deleted", tab: null, query })).toEqual({ kind: "tenant" });
        // A link to it under the settings of the platform lands in the tenant settings, where it belongs.
        expect(platformSettingsRoute({ several: true, part: "recently-deleted", query })).toEqual({ kind: "redirect", to: "/dashboard/settings?part=recently-deleted" });
        expect(platformSettingsRoute({ several: false, part: "recently-deleted", query })).toEqual({ kind: "redirect", to: "/dashboard/settings?part=recently-deleted" });
        expect(tenantPartFromAddress("recently-deleted")).toBe("recently-deleted");
    });

    it("never mixes up the notifications of the tenant with the ones of the platform", () => {
        expect(tenantPartFromAddress("tenant-notifications")).toBe("tenant-notifications");
        expect(tenantPartFromAddress("notifications")).toBeNull();
        expect(tenantSettingsIndex().some((entry) => entry.id === "event:backup_failure")).toBe(true);
    });
});

describe("the state beside each part of the tenant settings", () => {
    const model = (overrides: Partial<TenantSettingsModel> = {}): TenantSettingsModel => ({
        tenant: { id: "t-acme", name: "Acme", isHome: false, logo: null, jobs: 4, databases: 12 },
        notifications: { channels: [], defaultChannels: [], events: [] },
        trash: { rows: [], canManage: true },
        canManage: true,
        isPlatformAdmin: false,
        tenantCount: 3,
        ...overrides,
    });

    it("says when a logo is set and when the tenant has no channel yet", () => {
        expect(tenantPartStates(model())).toEqual({ "tenant-notifications": { text: "No channel", tone: "warning" } });
        const withLogo = model({ tenant: { ...model().tenant, logo: { url: "/api/tenants/t-acme/logo?v=1", mimeType: "image/png", size: 10, updatedAt: "x" } } });
        expect(tenantPartStates(withLogo).profile).toEqual({ text: "logo set" });
    });

    it("counts what waits in Recently deleted, and says nothing while it is empty", () => {
        expect(tenantPartStates(model())["recently-deleted"]).toBeUndefined();
        const row = { id: "d-1", kind: "job" as const, recordId: "j-1", name: "Nightly", detail: null, deletedAt: "x", deletedByName: null, expiresAt: "y", tenantId: "t-acme" };
        expect(tenantPartStates(model({ trash: { rows: [row, { ...row, id: "d-2" }], canManage: false } }))["recently-deleted"]).toEqual({ text: "2" });
    });

    it("finds Recently deleted with the search of the tenant settings", () => {
        expect(tenantSettingsIndex().some((entry) => entry.part === "recently-deleted" && entry.id === "recently-deleted")).toBe(true);
    });

    it("leads the home tenant to the notifications of the platform", () => {
        expect(tenantPartStates(model({ notifications: null }))["tenant-notifications"]).toEqual({ text: "Platform" });
    });
});

describe("what a group of a tenant may hold", () => {
    it("never offers the settings of the instance outside the home tenant", () => {
        expect(grantableIn(PERMISSIONS.SETTINGS.WRITE, HOME_TENANT_ID)).toBe(true);
        expect(grantableIn(PERMISSIONS.SETTINGS.WRITE, "t-acme")).toBe(false);
        expect(grantableIn(PERMISSIONS.TENANT_SETTINGS.WRITE, "t-acme")).toBe(true);
    });

    it("locks in the editor what the viewer may not do, never for a platform admin", () => {
        const viewer = { platformAdmin: false, permissions: [PERMISSIONS.JOBS.READ] };
        expect(lockedFor(viewer, PERMISSIONS.JOBS.READ)).toBeNull();
        expect(lockedFor(viewer, PERMISSIONS.JOBS.WRITE)).toMatch(/You may not do this yourself/);
        expect(lockedFor({ platformAdmin: true, permissions: [] }, PERMISSIONS.JOBS.WRITE)).toBeNull();
    });

    it("names what the actor lacks, at most three of it", () => {
        const actor = { isPlatformAdmin: false, tenantId: "t-acme", permissions: [] };
        const refused = groupCapRefusal(actor, [PERMISSIONS.JOBS.READ, PERMISSIONS.JOBS.WRITE, PERMISSIONS.JOBS.EXECUTE, PERMISSIONS.HISTORY.READ]);
        expect(refused).toMatch(/You may not: .+ and 1 more\.$/);
        expect(groupCapRefusal({ ...actor, tenantId: null }, [])).toBe("Open a tenant to change its groups.");
    });

    it("offers on the list of every account the groups of each tenant alone", () => {
        const groups = [
            { id: "g-home", name: "Admin", tenantId: HOME_TENANT_ID, members: 1, permissions: [], superAdmin: true },
            { id: "g-acme", name: "Admin", tenantId: "t-acme", members: 2, permissions: [], superAdmin: true },
        ];
        expect(groupsOfTenant(groups, "t-acme").map((group) => group.id)).toEqual(["g-acme"]);
    });
});
