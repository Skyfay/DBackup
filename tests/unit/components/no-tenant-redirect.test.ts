// @vitest-environment node
/**
 * An account in no tenant, like someone whose group an upgrade took away, opens a page of tenant
 * records from a bookmark. It lands on the Overview, which says why, instead of the error page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    viewer: null as null | { tenantId: string | null; allTenants: boolean },
    redirect: vi.fn((to: string) => {
        throw new Error(`redirect ${to}`);
    }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/access-control", () => ({ getViewer: async () => mocks.viewer }));

import { redirectWithoutTenant } from "@/app/dashboard/no-tenant-redirect";

describe("redirectWithoutTenant", () => {
    beforeEach(() => {
        mocks.redirect.mockClear();
    });

    it("sends an account in no tenant to the Overview", async () => {
        mocks.viewer = { tenantId: null, allTenants: false };
        await expect(redirectWithoutTenant()).rejects.toThrow("redirect /dashboard");
    });

    it("keeps someone in a tenant on the page", async () => {
        mocks.viewer = { tenantId: "default", allTenants: false };
        await redirectWithoutTenant();
        expect(mocks.redirect).not.toHaveBeenCalled();
    });

    it("keeps All tenants on the page", async () => {
        mocks.viewer = { tenantId: null, allTenants: true };
        await redirectWithoutTenant();
        expect(mocks.redirect).not.toHaveBeenCalled();
    });

    it("leaves a page without a session to its own check", async () => {
        mocks.viewer = null;
        await redirectWithoutTenant();
        expect(mocks.redirect).not.toHaveBeenCalled();
    });
});
