import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("next/navigation", () => ({ redirect: vi.fn((to: string) => { throw new Error(`redirect ${to}`); }) }));
vi.mock("@/lib/auth/access-control", () => ({
    getUserPermissions: async () => ["users:read", "groups:read", "api-keys:read", "audit:read"],
    getViewer: async () => ({ id: "u1", allTenants: true, tenantId: null, isPlatformAdmin: true }),
}));
vi.mock("@/services/tenant/tenant-service", () => ({ tenantService: { count: async () => 3 } }));
vi.mock("@/services/user/preference-service", () => ({ getTablePreferences: vi.fn(), getViewMode: vi.fn() }));
vi.mock("@/services/user/users-model", () => ({ getUsersPageAttention: vi.fn() }));
vi.mock("@/components/tenant/tenant-pick", () => ({ PickTenantPage: () => null }));
vi.mock("@/components/dashboard/users/users-client", () => ({ UsersClient: () => null }));

const { default: UsersPage } = await import("@/app/dashboard/users/page");

async function pickFor(query: Record<string, string>): Promise<string> {
    const page = (await UsersPage({ searchParams: Promise.resolve(query) })) as ReactElement<{ href: string }>;
    return page.props.href;
}

describe("Users & Groups opened in All tenants", () => {
    it("opens the tab and the record of its address in the tenant picked", async () => {
        expect(await pickFor({ tab: "apikeys" })).toBe("/dashboard/users?tab=apikeys");
        expect(await pickFor({ tab: "groups", open: "g1" })).toBe("/dashboard/users?tab=groups&open=g1");
        expect(await pickFor({})).toBe("/dashboard/users");
    });
});
