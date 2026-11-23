import { describe, expect, it } from "vitest";
import { ONE_TENANT_PAGES, oneTenantPage } from "@/components/tenant/one-tenant-pages";

describe("pages of one tenant", () => {
    it("knows the pages that All tenants cannot show, by their address with a part or a sub-page", () => {
        expect(oneTenantPage("/dashboard/vault")?.title).toBe("Vault");
        expect(oneTenantPage("/dashboard/settings?part=recently-deleted")?.title).toBe("Settings");
        expect(oneTenantPage("/dashboard/users?tab=apikeys")?.title).toBe("Users & Groups");
        expect(oneTenantPage("/dashboard/templates")?.title).toBe("Templates");
        expect(oneTenantPage("/dashboard/setup")?.title).toBe("Quick Setup");
    });

    it("leaves out the pages that show every tenant and the ones of the platform", () => {
        for (const href of ["/dashboard", "/dashboard/jobs", "/dashboard/connections", "/dashboard/platform/users", "/dashboard/platform/settings", "/dashboard/vaults"]) {
            expect(oneTenantPage(href)).toBeNull();
        }
    });

    it("says in one line why it asks, without a dash or a semicolon", () => {
        for (const page of ONE_TENANT_PAGES) {
            expect(page.description).toMatch(/one tenant|of its own/);
            expect(page.description).not.toMatch(/[;—–]/);
        }
    });
});
